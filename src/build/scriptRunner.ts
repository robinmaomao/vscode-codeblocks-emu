/**
 * pre/post build 脚本引擎 —— 对应 compilergcc 的 pre/post build steps
 *
 * 移植自 codeblocks-src/src/plugins/compilergcc（GPL v3，逻辑独立重写）。
 * 支持两类：
 *   1. 外部命令（直接 shell 执行）
 *   2. Squirrel 脚本（Code::Blocks 用 .script/.sc；此处简化为可执行脚本）
 *
 * Code::Blocks 的 pre/post build step 支持宏（如 $(TARGET_OUTPUT_FILE)），
 * 此处实现宏展开后交由 shell 执行。
 */
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import { decodeText } from '../tools/encoding';
import { getWindowsSystemPath } from '../tools/windowsPath';
import { upperDrive } from '../tools/pathCase';
import { BuildCancelHandle, killProcessTree, reapOrphans, snapshotDescendantPids } from './cancelToken';
import { replaceCbMacros } from '../compiler/cbMacros';
import { buildLogPrefs } from './logLang';

/** 展开命令中的宏（Code::Blocks 变量风格） */
export function expandMacros(cmd: string, vars: Record<string, string>): string {
  let out = cmd;
  for (const [key, value] of Object.entries(vars)) {
    // $(KEY) 风格
    out = out.replace(new RegExp('\\$\\(' + key + '\\)', 'g'), value);
    // $KEY 风格（仅当 KEY 后跟非字母数字）
    out = out.replace(new RegExp('\\$' + key + '(?![A-Za-z0-9_])', 'g'), value);
  }
  return out;
}

/**
 * 递归展开宏（对齐 Code::Blocks macrosmanager ReplaceMacros 的迭代替换：
 * 变量值里可以引用其它变量，最多迭代 5 轮直到稳定）。
 */
export function replaceAllMacros(cmd: string, vars: Record<string, string>): string {
  let cur = cmd;
  for (let i = 0; i < 5; i++) {
    const next = expandMacros(cur, vars);
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

export interface ScriptResult {
  success: boolean;
  output: string;
  /**
   * 宽限到期时管道仍未关闭 ⇒ 命令本体已结束但仍有后台进程持有 stdout/stderr
   * （`start` / GUI / 守护进程）：构建不再等待（对齐 CodeBlocks），仅记录用于日志提示。
   * 宽限设为 0 时不做该观察（严格对齐 CodeBlocks：不检测、不提示）。
   */
  trailingBackground?: boolean;
  /** 是否因超时（codeblocks.build.scriptCommandTimeoutMs）被强杀 */
  timedOut?: boolean;
}

/** 命令结束后管道排空的宽限默认值（设置 codeblocks.build.scriptExitGraceMs；0 = 立即结束） */
export const SCRIPT_EXIT_GRACE_DEFAULT_MS = 1500;
/** 宽限上限（防止误配置把构建拖住） */
export const SCRIPT_EXIT_GRACE_MAX_MS = 60_000;
/** 单条脚本命令耗时提示阈值（超过则在日志中给出耗时行） */
export const SCRIPT_SLOW_HINT_MS = 3000;
/** 长命令心跳间隔（运行期间周期性输出「仍在运行」，让「脚本慢」与「扩展慢」一眼可辨） */
export const SCRIPT_HEARTBEAT_MS = 5000;
/** 脚本命令超时上限（设置 codeblocks.build.scriptCommandTimeoutMs；默认 0 = 不超时，对齐 CodeBlocks 无限等待） */
export const SCRIPT_TIMEOUT_MAX_MS = 3_600_000;
/** 超时杀树后收割孤儿进程的轮数/间隔（毫秒）：覆盖脚本被杀后继续 spawn 的后台进程 */
export const SCRIPT_REAP_ROUNDS = 6;
export const SCRIPT_REAP_INTERVAL_MS = 800;
/** 命令本体退出后，管道「安静」多久即可立即收尾（毫秒）——宽限 = 上限，不再是固定等待时长 */
export const SCRIPT_EXIT_QUIET_MS = 250;
/** 安静期检查间隔（毫秒）——决定提前收尾的精度（最大额外延迟约等于该值） */
export const SCRIPT_EXIT_QUIET_POLL_MS = 25;
/** 命令启动后延迟采集进程树 PID 的时间（ms）：等 shell/中间 cmd 建好，又能覆盖整个命令生命周期 */
export const SCRIPT_TREE_SNAPSHOT_DELAY_MS = 150;
/** 命令运行期间的进程树采集次数与间隔（ms）：wmic 枚举约 0.4s，采 4 次即可覆盖 10s+ 的命令 */
export const SCRIPT_TREE_SNAPSHOT_COUNT = 4;
export const SCRIPT_TREE_SNAPSHOT_INTERVAL_MS = 2500;

/**
 * 脚本结束后的管道排空宽限（毫秒）。
 *
 * 命令本体（cmd.exe）退出后，再等这段时间把管道尾部缓冲的输出收全；期间若管道关闭则提前收尾。
 * 无 vscode 宿主（headless 单测）时回退默认；非法/负值钳制为 0，上限 SCRIPT_EXIT_GRACE_MAX_MS。
 */
export function scriptExitGraceMs(): number {
  let raw: unknown = SCRIPT_EXIT_GRACE_DEFAULT_MS;
  try {
    // 惰性 require：headless 单测无 vscode 宿主时回退默认（与 compilerCachePrefix 同款）
    const vs: typeof import('vscode') = require('vscode');
    raw = vs.workspace.getConfiguration('codeblocks').get<number>('build.scriptExitGraceMs', SCRIPT_EXIT_GRACE_DEFAULT_MS);
  } catch { /* 无宿主：默认值 */ }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(SCRIPT_EXIT_GRACE_MAX_MS, Math.floor(n));
}

/**
 * 单条 pre/post-build 脚本命令的超时（毫秒；0 = 不超时，对齐 CodeBlocks 的无限等待）。
 *
 * 仅作用于脚本命令（编译/链接不受影响）；超时后强杀整棵进程树并把该命令记为失败。
 * 无 vscode 宿主（headless 单测）时回退默认；非法/负值钳制为 0，上限 SCRIPT_TIMEOUT_MAX_MS。
 */
export function scriptCommandTimeoutMs(): number {
  let raw: unknown = 0;
  try {
    const vs: typeof import('vscode') = require('vscode');
    raw = vs.workspace.getConfiguration('codeblocks').get<number>('build.scriptCommandTimeoutMs', 0);
  } catch { /* 无宿主：默认值（不超时） */ }
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(SCRIPT_TIMEOUT_MAX_MS, Math.floor(n));
}

/** 解码子进程输出：UTF-8 严格优先，失败回退 GBK（中文 Windows） */
function decodeOutput(buf: Buffer): string {
  return decodeText(buf);
}

/** 合并 PATH 段并去重（Windows 分号分隔，忽略大小写去重，保持顺序） */
function mergePath(...parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const seg of part.split(';')) {
      const s = seg.trim();
      const key = s.toLowerCase();
      if (s && !seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
    }
  }
  return out.join(';');
}

/**
 * 执行单条脚本命令（可附加环境变量，如编译器 bin 目录加入 PATH；cancel 提供时注册子进程并支持强杀）。
 *
 * @param onOutputLine 实时输出回调（逐行、已解码、行尾 \r 已去除；命令收尾时 flush 无换行的尾行）
 */
export function runScriptCommand(
  command: string,
  cwd: string,
  vars: Record<string, string>,
  extraPath?: string,
  cancel?: BuildCancelHandle,
  onOutputLine?: (line: string) => void,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    // 取消检查点：spawn 前
    if (cancel?.isCancelled()) {
      resolve({ success: false, output: '' });
      return;
    }
    const expanded = replaceCbMacros(command, { vars, basePath: cwd });
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (process.platform === 'win32') {
      // Windows：实时读取系统 PATH（注册表 Machine+User），宿主进程 PATH 快照可能过期
      env.PATH = mergePath(getWindowsSystemPath(), env.PATH ?? '');
    }
    if (extraPath) {
      const sep = process.platform === 'win32' ? ';' : ':';
      env.PATH = extraPath + sep + (env.PATH ?? '');
    }
    const proc = spawn(expanded, {
      cwd: upperDrive(cwd),
      shell: true,
      env,
    });
    // 注册进取消源：cancel() 时强杀整棵进程树
    cancel?.register(proc);
    let output = '';
    const grace = scriptExitGraceMs();
    const timeout = scriptCommandTimeoutMs();
    let settled = false;
    let graceTimer: NodeJS.Timeout | undefined;
    let quietTimer: NodeJS.Timeout | undefined;
    let timeoutTimer: NodeJS.Timeout | undefined;
    let timedOut = false;
    /** 最近一次收到输出的时刻（用于「管道安静期」判定） */
    let lastDataAt = Date.now();
    // 逐行解码状态：待解码字节 + 粘性编码（首个非空数据块探测一次，避免短行误判）
    let pending: Buffer[] = [];
    let decoder: InstanceType<typeof TextDecoder> | undefined;

    /** 行解码器：UTF-8 严格成功则用 UTF-8，否则整条命令回退 GBK（与原「整段解码」结论一致） */
    const lineDecoder = (): InstanceType<typeof TextDecoder> => {
      if (!decoder) {
        const head = pending.length ? Buffer.concat(pending) : Buffer.alloc(0);
        try {
          new TextDecoder('utf-8', { fatal: true }).decode(head);
          decoder = new TextDecoder('utf-8', { fatal: false });
        } catch {
          decoder = new TextDecoder('gbk', { fatal: false });
        }
      }
      return decoder;
    };

    /** 取出缓冲中已完成的行（按最后一个 \n 切分；\n 不属于 UTF-8/GBK 多字节序列 ⇒ 切分安全） */
    const flushLines = (final: boolean): void => {
      if (!pending.length) return;
      const buf = Buffer.concat(pending);
      const lastNl = buf.lastIndexOf(0x0a);
      let head: Buffer;
      let rest: Buffer;
      if (lastNl >= 0) {
        head = buf.subarray(0, lastNl + 1);
        rest = buf.subarray(lastNl + 1);
      } else {
        head = final ? buf : Buffer.alloc(0);
        rest = final ? Buffer.alloc(0) : buf;
      }
      if (head.length) {
        const text = lineDecoder().decode(head);
        output += text;
        if (onOutputLine) {
          for (const line of text.split('\n')) {
            const trimmed = line.replace(/\r$/, '');
            if (trimmed) onOutputLine(trimmed);
          }
        }
      }
      pending = rest.length ? [rest] : [];
    };

    const finish = (success: boolean, trailingBackground: boolean): void => {
      if (settled) return;
      settled = true;
      if (graceTimer) {
        clearTimeout(graceTimer);
        graceTimer = undefined;
      }
      if (quietTimer) {
        clearInterval(quietTimer);
        quietTimer = undefined;
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = undefined;
      }
      cancel?.unregister(proc);
      // 命令已结束：把无换行的尾行也交给日志（不再等管道关闭）
      flushLines(true);
      resolve({ success, output, trailingBackground, timedOut });
    };
    proc.stdout?.on('data', (d: Buffer) => {
      lastDataAt = Date.now();
      pending.push(d);
      flushLines(false);
    });
    proc.stderr?.on('data', (d: Buffer) => {
      lastDataAt = Date.now();
      pending.push(d);
      flushLines(false);
    });
    proc.on('exit', (code) => {
      // 命令本体结束（对齐 CodeBlocks wxExecute 同步等待语义）。
      // 不再等 close：close 会等所有 stdio 管道关闭，脚本启动的后台进程一旦继承管道，
      // post-build 会被拖到它们退出为止（实测 start /b 场景白等 5.1s）。
      // 宽限是**上限**（不再是固定等待）：期间 close 到达即收尾；管道安静 SCRIPT_EXIT_QUIET_MS 即收尾
      // （尾部输出保障不变——输出是流式读取的，安静期只用于确认没有在途数据）；
      // 宽限到期仍无 close/安静 ⇒ 后台进程仍持有输出（标记 trailingBackground，构建继续）。
      const ok = code === 0;
      if (grace > 0) {
        graceTimer = setTimeout(() => finish(ok, true), grace);
        // 安静期检查：命令本体退出后，若一段时间内没有新的输出就提前收尾。
        // 若此时管道其实已关闭（close 事件尚未派发），按「无后台进程」收尾，避免误报说明行。
        quietTimer = setInterval(() => {
          if (Date.now() - lastDataAt < SCRIPT_EXIT_QUIET_MS) return;
          const pipesClosed = (proc.stdout === null || proc.stdout.closed)
            && (proc.stderr === null || proc.stderr.closed);
          finish(ok, !pipesClosed);
        }, SCRIPT_EXIT_QUIET_POLL_MS);
        quietTimer.unref?.();
      } else {
        // 宽限 0：命令本体结束即继续，不做后台进程观察（严格等同 CodeBlocks：不检测、不提示）
        finish(ok, false);
      }
    });
    proc.on('close', (code) => finish(code === 0, false));
    proc.on('error', (err) => {
      pending.push(Buffer.from(err.message, 'utf-8'));
      flushLines(true);
      finish(false, false);
    });
    // 可选超时（默认关闭）：到期强杀整棵进程树并把该命令记为失败。
    // 杀树是「瞬时快照」式的：快照后才出现的子孙、以及「根已退出」时 taskkill 的空操作，
    // 都会让脚本继续解释后续行并启动 start /b 后台进程（实测杀树后 1~10s 仍有新进程且长期存活）。
    // 因此运行期多次采集进程树 PID（中间 cmd 退出后，其子进程的 PPID 值仍指向它，
    // 收割时可按「父 PID ∈ 已终止集合」追出孤儿）；超时后按该集合多轮收割。
    if (timeout > 0) {
      const pid0 = proc.pid;
      const treePids: number[] = [];
      let snapshots = 0;
      const takeSnapshot = (): void => {
        if (settled || pid0 === undefined || snapshots >= SCRIPT_TREE_SNAPSHOT_COUNT) return;
        snapshots++;
        snapshotDescendantPids(pid0).then((pids) => {
          for (const p of pids) if (!treePids.includes(p)) treePids.push(p);
          if (!settled) setTimeout(takeSnapshot, SCRIPT_TREE_SNAPSHOT_INTERVAL_MS);
        }).catch(() => { /* ignore */ });
      };
      if (pid0 !== undefined) setTimeout(takeSnapshot, SCRIPT_TREE_SNAPSHOT_DELAY_MS);
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        const pid = proc.pid;
        // 立即杀树（不等待采集结果）：超时语义优先；收割用「根 PID + 运行期采集到的整棵树」集合，
        // 覆盖中间 cmd 已退出、PPID 链断掉的孤儿（treePids 在 finish 后不再增长）。
        killProcessTree(proc);
        if (pid !== undefined) {
          reapOrphans([pid, ...treePids], SCRIPT_REAP_ROUNDS, SCRIPT_REAP_INTERVAL_MS);
        }
        finish(false, false);
      }, timeout);
    }
  });
}

/** 依次执行多条脚本命令（可附加编译器 bin 目录到 PATH；cancel 提供时命令间检查 + 活动命令强杀） */
export async function runScriptCommands(
  commands: string[],
  cwd: string,
  vars: Record<string, string>,
  onLog?: (line: string) => void,
  extraPath?: string,
  cancel?: BuildCancelHandle,
): Promise<boolean> {
  let ok = true;
  const total = commands.length;
  for (let i = 0; i < total; i++) {
    // 取消检查点：不再执行后续脚本命令（正在执行的由 cancel() 强杀）
    if (cancel?.isCancelled()) {
      ok = false;
      break;
    }
    const cmd = commands[i];
    // 脚本命令编号（[script 1-5]，连字符避免 Output 面板误判为路径链接；plainCbLog 模式关闭编号）
    const numbered = `[script ${i + 1}-${total}]`;
    const enhanced = !!onLog && !buildLogPrefs().plain;
    if (onLog) onLog(buildLogPrefs().plain ? cmd : `${numbered} ${cmd}`);
    const t0 = Date.now();
    // 实时输出（缩进两空格，与脚本命令区分层次）——不再等命令结束才回放，卡住期间也能看到进展
    const streamLine = onLog ? (line: string) => onLog(`  ${line}`) : undefined;
    // 心跳：长命令期间周期性提示，让「脚本自身慢/网络等待」与「扩展卡住」一眼可分
    let heartbeatTimer: NodeJS.Timeout | undefined;
    let heartbeatCount = 0;
    if (enhanced) {
      heartbeatTimer = setInterval(() => {
        heartbeatCount++;
        const secs = ((Date.now() - t0) / 1000).toFixed(0);
        onLog(heartbeatCount === 1
          ? `  ${numbered} 仍在运行 (${secs}s)…（若是网络盘/服务等待：可在脚本内设置超时，或点「停止构建」终止）`
          : `  ${numbered} 仍在运行 (${secs}s)…`);
      }, SCRIPT_HEARTBEAT_MS);
      heartbeatTimer.unref?.();
    }
    let r: ScriptResult;
    try {
      r = await runScriptCommand(cmd, cwd, vars, extraPath, cancel, streamLine);
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
    }
    const elapsed = Date.now() - t0;
    // 可诊断性（plainCbLog 模式保持纯 CB 输出）：超时 / 后台进程 / 慢命令各给一行说明
    if (enhanced) {
      if (r.timedOut) {
        onLog(`  ${numbered} 超时（${(elapsed / 1000).toFixed(1)}s > ${(scriptCommandTimeoutMs() / 1000).toFixed(1)}s），已终止该命令`);
      }
      if (r.trailingBackground) {
        onLog(`  ${numbered} 后台进程仍在运行（不阻塞构建；如需等待请改用前台命令或 start /wait）`);
      }
      if (elapsed >= SCRIPT_SLOW_HINT_MS) {
        onLog(`  ${numbered} 耗时 ${(elapsed / 1000).toFixed(1)}s（命令自身运行时）`);
      }
    }
    if (!r.success) ok = false;
  }
  return ok;
}

/** 为构建目标构造宏变量（对应 Code::Blocks macrosmanager.cpp 的构建变量） */
export function buildMacroVars(
  basePath: string,
  outputFilename: string,
  targetTitle: string,
  objectOutput = '.objs/',
  projectTitle = targetTitle,
  projectFilename = outputFilename,
  compilerDir = '',
): Record<string, string> {
  // Windows 下宏值用原生分隔符 + 大写盘符（= CB UnixFilename 后 FixPathSeparators 的净效果），其它平台保持原生分隔符。
  const win = process.platform === 'win32';
  const toNative = (s: string): string => (win ? s.replace(/\//g, '\\') : s);
  const out = toNative(outputFilename);
  // 去掉文件名，保留目录（含结尾分隔符）；无目录则为空
  const sepIdx = Math.max(out.lastIndexOf('/'), out.lastIndexOf('\\'));
  const outDir = sepIdx >= 0 ? out.slice(0, sepIdx + 1) : '';
  const baseName = sepIdx >= 0 ? out.slice(sepIdx + 1) : out;
  const stem = baseName.replace(/\.[^.]+$/, '');
  // 项目根目录宏：对齐 Code::Blocks GetBasePath()（带结尾分隔符）+ FixPathSeparators（原生分隔符）
  const projDir = (win ? upperDrive(basePath) : basePath.replace(/\\/g, '/')).replace(/[\\/]$/, '') + (win ? '\\' : '/');

  return {
    // 目标相关（macrosmanager.cpp）
    TARGET_OUTPUT_FILE: out,
    TARGET_OUTPUT_FILENAME: baseName,
    TARGET_OUTPUT_BASENAME: stem,
    TARGET_OUTPUT_DIR: outDir,
    TARGET_NAME: targetTitle,
    TARGET_OBJECT_DIR: win ? objectOutput : objectOutput.replace(/\\/g, '/'),
    // 项目相关（对齐 cbProject::GetTitle / GetFilename 语义）
    PROJECT_DIR: projDir,
    PROJECT_DIRECTORY: projDir,
    PROJECT_NAME: projectTitle,
    PROJECTNAME: projectTitle,
    PROJECT_FILENAME: projectFilename,
    // 目标编译器目录（macrosmanager.cpp:396 MasterPath.GetPathWithSep）
    TARGET_COMPILER_DIR: compilerDir ? toNative(compilerDir.replace(/[\\/]$/, '') + (win ? '\\' : '/')) : '',
    // 静态宏（macrosmanager.cpp:128-163）
    AMP: '&',
    PLATFORM: win ? 'msw' : 'unix',
    CMD_NULL: win ? 'NUL' : '/dev/null',
    CMD_CP: win ? 'cmd /c copy' : 'cp --preserve=timestamps',
    CMD_RM: win ? 'cmd /c del' : 'rm',
    CMD_MV: win ? 'cmd /c move' : 'mv',
    CMD_MKDIR: win ? 'cmd /c md' : 'mkdir -p',
    CMD_RMDIR: win ? 'cmd /c rd' : 'rmdir',
  };
}
