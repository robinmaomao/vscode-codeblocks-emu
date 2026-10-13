/**
 * 构建取消源 —— 编译随时停止的核心机制
 *
 * 持有取消标志与活动子进程注册表：
 *  - isCancelled() 供构建各检查点查询（目标间/单元间/脚本命令间/链接前）；
 *  - register/unregister 追踪 spawn 出的子进程；
 *  - cancel() 置位标志并强杀所有活动子进程（Windows 用 taskkill /T /F 杀整棵进程树，
 *    cmd.exe → gcc → cc1/as/ld 的孙子进程一并终止）。
 */
import { ChildProcess, execFile, spawn } from 'child_process';

export interface BuildCancelHandle {
  /** 是否已请求取消 */
  isCancelled(): boolean;
  /** 注册活动子进程（spawn 后立即注册，close/error 后注销） */
  register(proc: ChildProcess): void;
  /** 注销子进程 */
  unregister(proc: ChildProcess): void;
}

export class BuildCancelSource implements BuildCancelHandle {
  private cancelled = false;
  private active = new Set<ChildProcess>();

  isCancelled(): boolean {
    return this.cancelled;
  }

  register(proc: ChildProcess): void {
    if (this.cancelled) {
      // 竞态防御：取消已发生而进程刚 spawn 出来，立即强杀，不让新进程继续运行
      killProcessTree(proc);
      return;
    }
    this.active.add(proc);
  }

  unregister(proc: ChildProcess): void {
    this.active.delete(proc);
  }

  /** 请求取消：置位标志 + 强杀所有活动子进程（整棵进程树） */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    for (const proc of [...this.active]) {
      killProcessTree(proc);
    }
  }
}

/** 强杀进程树：Windows 用 taskkill /T /F（覆盖 shell:true 的 cmd.exe 孙进程），其它平台 SIGKILL */
export function killProcessTree(proc: ChildProcess): void {
  try {
    if (proc.pid === undefined) return;
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(proc.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.on('error', () => {
        // taskkill 不可用等：回退直接 kill
        try { proc.kill(); } catch { /* ignore */ }
      });
    } else {
      proc.kill('SIGKILL');
    }
  } catch {
    try { proc.kill(); } catch { /* ignore */ }
  }
}

/** 孤儿回收的最大轮数上限（防御：异常调用） */
const MAX_REAP_ROUNDS = 12;

/**
 * 以 PowerShell 执行脚本并取回 stdout（Windows）。
 *
 * 用 `-EncodedCommand`（UTF-16LE base64）而不是 `-Command`：后者在参数含引号/反斜杠时会被
 * 命令行解析层层剥引号，实测会出现「表达式缺少值」之类的解析失败（静默失效）。
 * 返回 ok=false 表示 PowerShell 自身失败（未安装/被拒/超时），与「执行成功但无输出」可区分。
 */
function runPowerShell(script: string, timeoutMs = 20000): Promise<{ ok: boolean; out: string }> {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, out: '' });
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    try {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        { windowsHide: true, timeout: timeoutMs, encoding: 'utf8' },
        (err, stdout) => resolve({ ok: !err, out: err ? '' : String(stdout || '').trim() }));
    } catch {
      resolve({ ok: false, out: '' });
    }
  });
}

/** 进程 (PID, 父 PID) 对 */
interface ProcPair { pid: number; ppid: number }

/**
 * 枚举全进程 (PID, 父 PID)。
 *
 * 优先 `wmic`：本机实测 415ms（395 进程），而 PowerShell `Get-CimInstance Win32_Process`
 * 需约 2.7s——快照延迟直接决定「能否在中间 cmd 退出前记下它的 PID」，因此这点很关键。
 * `wmic` 已被微软标记弃用（新版 Windows 可能未预装）→ 失败时回退 CIM（同样正确，只是慢）。
 */
function listProcessPairs(): Promise<ProcPair[]> {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    execFile('wmic', ['process', 'get', 'ProcessId,ParentProcessId', '/format:csv'],
      { windowsHide: true, timeout: 20000, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (!err && stdout) {
          const rows = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          if (rows.length > 1) {
            const header = rows[0].split(',').map((s) => s.trim().toLowerCase());
            const ppidIdx = header.indexOf('parentprocessid');
            const pidIdx = header.indexOf('processid');
            if (ppidIdx >= 0 && pidIdx >= 0) {
              const pairs: ProcPair[] = [];
              for (const row of rows.slice(1)) {
                const cols = row.split(',');
                const pid = Number(cols[pidIdx]);
                const ppid = Number(cols[ppidIdx]);
                if (Number.isFinite(pid) && pid > 0) {
                  pairs.push({ pid, ppid: Number.isFinite(ppid) ? ppid : 0 });
                }
              }
              if (pairs.length) { resolve(pairs); return; }
            }
          }
        }
        runPowerShell([
          '$ErrorActionPreference = "SilentlyContinue"',
          'Get-CimInstance Win32_Process | ForEach-Object { "{0}|{1}" -f $_.ProcessId, $_.ParentProcessId }',
        ].join('\n')).then(({ out }) => {
          resolve(out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((row) => {
            const [pid, ppid] = row.split('|');
            return { pid: Number(pid), ppid: Number(ppid) };
          }).filter((p) => Number.isFinite(p.pid) && p.pid > 0));
        }).catch(() => resolve([]));
      });
  });
}

/**
 * 采集「以 rootPid 为祖先」的进程 PID 集合（不含 root 自身；Windows）。
 *
 * 用途：脚本超时被强杀时，集合里的 PID 都是「我们终止过/尝试终止过」的进程；
 * 其子进程（含中间 cmd 已退出后仍活着、PPID 指向已死 PID 的孤儿）可在稍后按 PPID 收割。
 *
 * 内部按 PPID 建索引做多轮 BFS：即使中间层已退出，只要**子进程还在进程表里**，
 * 它的 PPID 仍指向那个已消失的 PID，因此仍能被追出来。
 * 枚举失败（WMI 瞬时不可用等）会重试一次，避免采集结果为空导致漏收割。
 */
export async function snapshotDescendantPids(rootPid: number, attempts = 2): Promise<number[]> {
  if (!Number.isFinite(rootPid) || rootPid <= 0) return [];
  for (let i = 0; i < Math.max(1, attempts); i++) {
    const pairs = await listProcessPairs();
    if (pairs.length) {
      const children = new Map<number, number[]>();
      for (const { pid, ppid } of pairs) {
        const list = children.get(ppid);
        if (list) list.push(pid); else children.set(ppid, [pid]);
      }
      const seen = new Set<number>([Math.trunc(rootPid)]);
      const found: number[] = [];
      const queue: number[] = [Math.trunc(rootPid)];
      while (queue.length) {
        const cur = queue.shift() as number;
        for (const child of children.get(cur) ?? []) {
          if (seen.has(child)) continue;
          seen.add(child);
          found.push(child);
          queue.push(child);
        }
      }
      return found;
    }
  }
  return [];
}

/**
 * 收割「已被杀掉进程的孤儿后代」（Windows）。
 *
 * 背景（实测）：`taskkill /T /F` 是**瞬时快照**式的杀树：快照之后才产生的子孙会逃逸；
 * 若在 taskkill 执行前根进程就已退出，则整次杀树变成空操作（实测输出「没有找到进程」），
 * 此时脚本仍在解释后续行，可能启动 `start /b …` 的后台进程（实测该进程随后一直存活）。
 *
 * 因此这里按「父 PID ∈ 已知被终止集合」多轮枚举并强杀：孤儿进程即使父进程已消失，
 * 其 PPID 仍指向那个 PID 值，可被稳定命中；多轮则覆盖「越晚才被创建的后台进程」。
 * 仅在脚本超时（用户显式启用 codeblocks.build.scriptCommandTimeoutMs）路径调用。
 */
export function reapOrphans(knownPids: number[], rounds = 6, intervalMs = 800): void {
  if (process.platform !== 'win32') return;
  // 自身 PID 绝不参与：一是 PID 复用可能让「已消失的 root PID」被无关进程占用，
  // 二是绝不能因为集合里混入自身 PID 而连带杀掉自己派生的进程（PS/taskkill 助手、其它构建子进程）。
  let known = knownPids.filter((n) => Number.isFinite(n) && n > 4 && n !== process.pid).map((n) => Math.trunc(n));
  if (!known.length) return;
  const total = Math.max(1, Math.min(MAX_REAP_ROUNDS, rounds));
  const runRound = (remaining: number): void => {
    if (remaining <= 0) return;
    listProcessPairs().then((pairs) => {
      const hits = pairs
        .filter((p) => known.includes(p.ppid) && !known.includes(p.pid) && p.pid !== process.pid)
        .map((p) => p.pid);
      if (hits.length) {
        known = [...known, ...hits];
        // 逐个杀（各带 /T 覆盖其子孙）；taskkill 不可用时不影响后续轮次
        for (const pid of hits) {
          try {
            execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15000 }, () => { /* ignore */ });
          } catch { /* ignore */ }
        }
      }
      if (remaining > 1) setTimeout(() => runRound(remaining - 1), intervalMs);
    }).catch(() => {
      if (remaining > 1) setTimeout(() => runRound(remaining - 1), intervalMs);
    });
  };
  runRound(total);
}
