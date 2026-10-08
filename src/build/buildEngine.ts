/**
 * 构建引擎 —— 对应 compilergcc/directcommands.cpp + 进程派生
 *
 * 直接生成编译/链接命令并派生进程执行，不依赖 tasks.json。
 * 核心：构建图遍历（按文件 → 目标链接）+ 并行编译 + 输出捕获。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';
import { Project, BuildTarget, ProjectFile, TargetType, CommandType, CompilerLineType, supportsCurrentPlatform } from '../model/types';
import { FileType, fileTypeOf, fileExt, isCompilableFileType, isLinkableFileType, isCppSource, isClangdIndexable } from '../model/fileTypes';
import { Compiler } from '../compiler/compiler';
import { CommandGenerator, computeStaticOutput, quoteIfNeeded, clearBackticksCache } from '../compiler/commandGenerator';
import { OutputParser } from './outputParser';
import { CbOutput } from './cbChannel';
import { isCompilerUsable, renderInvalidCompilerMessage, renderTriedCompilerPaths, triedCompilerPaths } from './invalidCompiler';
import { runScriptCommands } from './scriptRunner';
import { replaceCbMacros, cbBuiltinVars, envVarMap } from '../compiler/cbMacros';
import { buildLogPrefs, msg } from './logLang';
import { BuildCancelHandle } from './cancelToken';
import { BuildProfiler } from './buildProfiler';
import { decodeText } from '../tools/encoding';
import { isExecutableTargetType, resolveExecutablePath, executableCandidates } from './outputPath';
import { applyResponseFile, compareFilesByWeight, linkRespBase } from './commandLine';
import { clearCompilerCacheResolveCache, normalizeCompilerCacheKind, resolveCompilerCachePathCached } from './compilerCache';
import { upperDrive, shortPathWin } from '../tools/pathCase';
import { getWindowsSystemPath } from '../tools/windowsPath';
import { LruCache } from '../tools/lru';

/** R4：编译缓存缺失告警跨引擎去抖窗口（工作区构建逐项目建引擎，同一配置只提醒一次） */
const COMPILER_CACHE_WARN_DEBOUNCE_MS = 10_000;
let lastCompilerCacheWarnKey = '';
let lastCompilerCacheWarnAt = 0;

/** 结构化的诊断信息（供 Build Log 视图展示，文件为绝对路径） */
export interface StructuredDiagnostic {
  severity: 'error' | 'warning';
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface BuildOptions {
  rebuild?: boolean;
  clean?: boolean;
  /** 原始编译输出行；severity 由解析器判定（error/warning/info） */
  onLine?: (line: string, severity?: 'error' | 'warning' | 'info') => void;
  onDiagnostic?: (diag: vscode.Diagnostic, fileUri?: vscode.Uri) => void;
  /** 结构化诊断回调（Build Log 视图收集错误/警告） */
  onStructuredDiagnostic?: (d: StructuredDiagnostic) => void;
  /** 取消句柄（null 时不支持取消；提供后各检查点查询 + 活动子进程注册强杀） */
  cancel?: BuildCancelHandle;
}

/** 单次构建目标级统计（供 Build Log 视图展示） */
export interface BuildTargetStats {
  success: boolean;       // 本目标构建是否成功（含编译/链接/脚本）
  compiledCount: number;  // 本次实际编译的文件数
  skippedCount: number;   // 增量跳过数
  failedCount: number;    // 编译失败文件数
  linkSuccess: boolean;
  linkSkipped: boolean;   // static lib 无链接步骤
  /** 构建是否被用户取消（取消 ≠ 失败：failedCount 不计被强杀的编译进程） */
  cancelled?: boolean;
  /** 本目标是否产生了实际命令（编译/链接/打包；对齐状态机 bsTargetBuild 的 hasCommands，门控项目 post-build） */
  hadCommands: boolean;
  outputFilename?: string;
}

/** 编译单元：一个文件的一条编译命令 */
interface CompileUnit {
  target: BuildTarget;
  file: ProjectFile;
  command: string;
  cwd: string;
  /** 是否为 PCH 头文件（需先于同组其它文件编译） */
  isPch: boolean;
  /** 响应文件基础路径（对齐 CheckForToLongCommandLine 命名：对象目录/源文件名） */
  respBase?: string;
}

/** 跨构建持久化的 include 依赖缓存（BuildEngine 每次构建新建实例，故用模块级静态缓存；LRU 上限防无界增长） */
const depsIncludeCache = new LruCache<string, { srcMtimeMs: number; srcSize: number; dirsKey: string; includes: string[] }>(2000);

/** 正斜杠归一化（供 PCH 对象路径等使用） */
function toUnix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** hasCppFilesToLink 判定 —— 对齐 CB GenerateCommandLine:258-288/585 + directcommands.cpp:772/903：按 compilerVar（CPP→C++，CC→C），扩展名仅回退（L8） */
function fileUsesCppCompiler(f: ProjectFile): boolean {
  if (f.compilerVar === 'CPP') return true;
  if (f.compilerVar === 'CC' || f.compilerVar === 'WINDRES') return false;
  return isCppSource(f.relativeFilename);
}

export class BuildEngine {
  private parser: OutputParser;
  /** 编译/链接子进程环境（PATH 前置编译器 bin 目录，对齐 CodeBlocks Init 的 PATH 重构） */
  private buildEnv: NodeJS.ProcessEnv | undefined;
  /** 最近一次 build() 的累计统计（供 Build Log 视图读取） */
  lastStats: BuildTargetStats | undefined;
  /** 最近一次构建的单文件编译耗时（供汇总「最慢 Top 3」） */
  lastCompileTimings: { file: string; ms: number }[] = [];
  /**
   * 最近一次 build() 实际执行的命令（第六轮 F8；供 HTML 构建日志 full_command_line 命令行块）：
   * 编译/链接/打包命令（响应文件改写后、spawn 前）+ pre/post 脚本命令，对齐 CB 记录队列命令（compilergcc.cpp:1330-1338）。
   */
  lastCommands: string[] = [];
  /** 本次构建的单文件编译耗时（并发 push，JS 单线程安全） */
  private compileTimings: { file: string; ms: number }[] = [];
  /** M0 阶段计时探针（CB_BUILD_PROFILE=1 启用；构建结束渲染 [profile] 块） */
  private prof: BuildProfiler | undefined;
  /** 探针：本次构建起始时间（总计基准） */
  private profBuildStartMs = 0;
  /** 探针：当前目标键前缀（'<目标名>/'） */
  private profPrefix = '';
  /** 探针：当前目标起始时间（首编译 spawn 延迟基准） */
  private profTargetStartMs = 0;
  /** 探针：当前目标是否已记录首个 spawn */
  private profFirstSpawnSeen = false;

  constructor(
    private project: Project,
    private compiler: Compiler,
    private output: CbOutput,
    private resolveCompiler?: (id: string) => Compiler | undefined,
  ) {
    // 使用编译器 XML 加载的正则；若为空则回退内置正则
    this.parser = new OutputParser(compiler.regexes.length ? compiler.regexes : undefined);
  }

  // ———— M0 阶段计时探针辅助（探针关闭时全部直通，零输出、无行为变化） ————

  /** 带完整键的同步计时（探针关闭时直通） */
  private profTime<T>(key: string, fn: () => T): T {
    return this.prof ? this.prof.time(key, fn) : fn();
  }

  /** 带完整键的异步计时（探针关闭时直通） */
  private profTimeAsync<T>(key: string, fn: () => Promise<T>): Promise<T> {
    return this.prof ? this.prof.timeAsync(key, fn) : fn();
  }

  /** 累加一条时长（探针关闭时无操作） */
  private profAdd(key: string, ms: number): void {
    this.prof?.add(key, ms);
  }

  /** M0 探针：isUpToDate 计时包装（探针关闭时直通） */
  private profIsUpToDate(file: ProjectFile, object: string, includeDirs: string[], depsCache: Map<string, number>): boolean {
    if (!this.prof) return this.isUpToDate(file.absolutePath, object, includeDirs, depsCache);
    const t0 = Date.now();
    const r = this.isUpToDate(file.absolutePath, object, includeDirs, depsCache);
    this.prof.add(`${this.profPrefix}增量判定`, Date.now() - t0);
    return r;
  }

  /** M0 探针：渲染 [profile] 块到输出通道（构建收尾调用；仅探针启用时输出） */
  private emitBuildProfile(): void {
    const prof = this.prof;
    if (!prof) return;
    this.prof = undefined;
    if (this.profBuildStartMs) prof.mark('总计', this.profBuildStartMs);
    for (const line of prof.render()) this.output.info(`[Code::Blocks][profile] ${line}`);
  }

  /**
   * 切换到目标声明编译器 —— 对齐 directcommands 各处 CompilerFactory::GetCompiler(target->GetCompilerID())
   * （593/634/722/965/1011/1167：模板/开关/程序/错误正则全套按目标切换）
   */
  private switchCompiler(target: BuildTarget): void {
    if (!this.resolveCompiler) return;
    const c = this.resolveCompiler(target.compilerId || this.project.compilerId);
    if (!c || c === this.compiler) return;
    this.compiler = c;
    // 错误/警告正则随编译器切换（对齐 CB 按 job 编译器 ParseOutput）
    this.parser = new OutputParser(c.regexes.length ? c.regexes : undefined);
  }

  /**
   * 无效编译器报错 —— 结构对齐 CompilerGCC::PrintInvalidCompiler（compilergcc.cpp:1756-1786）：
   * 主消息 + 已注册编译器的尝试路径 + finalMessage，三条独立错误条目（对齐 CB 三次 LogError）。
   * 文案为扩展适配；消息渲染与可用性检查见纯模块 invalidCompiler.ts（构建与运行入口共用）。
   */
  private reportInvalidCompiler(target: BuildTarget, c: Compiler | undefined, displayName: string | null, finalMessage = 'Skipping...'): void {
    this.output.error(renderInvalidCompilerMessage(`${this.project.title} - ${target.title}`, displayName));
    if (c) {
      const tried = renderTriedCompilerPaths(triedCompilerPaths(c));
      if (tried) this.output.error(tried);
    }
    this.output.error(finalMessage);
  }

  /** CommandsOnly 目标是否编译其文件（设置 codeblocks.build.compileCommandsOnlyTargets；默认 false 保持扩展原行为，true 对齐 CB 的空存根编译） */
  private compileCommandsOnlyTargets(): boolean {
    try {
      return vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.compileCommandsOnlyTargets', false) === true;
    } catch {
      return false;
    }
  }

  /**
   * 构建/清理 Banner —— 对齐 PrintBanner（compilergcc.cpp:1786-1830）：
   * "-------------- <Action>: <target> in <project> (compiler: <name>)---------------"（左 14 连字符+空格，右 15 连字符）。
   */
  private printBanner(action: 'Build' | 'Clean' | 'Build file', target: BuildTarget): void {
    this.output.info('');
    this.output.info(
      `-------------- ${action}: ${target.title} in ${this.project.title} (compiler: ${this.compiler.name})---------------`,
    );
    this.output.info(`  编译器程序: ${this.compiler.programs.C}`);
  }

  /** 构建主循环 —— 对应 GetCompileCommands + GetTargetLinkCommands；项目级 pre/post 在目标循环外各执行一次（对齐状态机 bsProjectPreBuild/bsProjectPostBuild） */
  async build(targetTitle?: string | string[], options: BuildOptions = {}): Promise<boolean> {
    // 对齐 Build()/Rebuild()/BuildWorkspace()：每轮构建清空反引号缓存（cbClearBackticksCache，Clean 单命令不清）
    clearBackticksCache();
    // 第六轮 F8：命令记录按每轮构建重置（HTML 日志 full_command_line）
    this.lastCommands = [];
    // R4：编译缓存已启用但工具缺失 → 每轮构建告警一次（命令生成回退原编译器，构建行为不受影响）
    this.warnCompilerCacheMissing();
    // M0 阶段计时探针：设置 codeblocks.build.profile 或环境变量 CB_BUILD_PROFILE=1 启用（默认关闭时零开销）
    this.profBuildStartMs = Date.now();
    const profEnabled = BuildProfiler.enabled()
      || vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.profile', false) === true;
    this.prof = profEnabled ? new BuildProfiler() : undefined;

    // 编译/链接子进程 PATH 注入：bin + masterPath + extra_paths + 系统 PATH（对齐 SetupEnvironment:795-830：ReplaceMacros 展开 + 去尾分隔符 + 去重）
    const profEnvT0 = Date.now();
    const expandEnvPath = (p: string): string =>
      replaceCbMacros(p, {
        vars: envVarMap(this.project.envVars),
        customVars: this.project.customVariables ?? {},
        basePath: this.project.basePath,
      }).replace(/[\\/]+$/, '');
    const masterPath = this.compiler.masterPath ? expandEnvPath(this.compiler.masterPath) : '';
    const extraPaths = (this.compiler.extraPaths ?? []).map(expandEnvPath);
    const parts = process.platform === 'win32'
      ? [this.compilerBinPath(), masterPath, ...extraPaths, getWindowsSystemPath(), process.env.PATH ?? '']
      : [this.compilerBinPath(), masterPath, ...extraPaths, process.env.PATH ?? ''];
    const sep = process.platform === 'win32' ? ';' : ':';
    const seen = new Set<string>();
    const merged = parts.filter(Boolean).filter((p) => {
      const k = process.platform === 'win32' ? p.toLowerCase() : p;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).join(sep);
    this.buildEnv = { ...(process.env as NodeJS.ProcessEnv), PATH: merged };
    this.prof?.mark('环境准备', profEnvT0);

    // 无目标标题：只构建纳入 All 的目标（对齐 GetCompileCommands(target=null) 的 includeInTargetAll 过滤）
    const titles = targetTitle ? (Array.isArray(targetTitle) ? targetTitle : [targetTitle]) : undefined;
    let targets = titles
      ? this.project.buildTargets.filter((t) => titles.includes(t.title))
      : this.project.buildTargets.filter((t) => t.includeInTargetAll !== false);
    // 没有任何目标纳入 All 时回退构建全部（防御，避免 Build 无动作）
    if (!titles && targets.length === 0) {
      targets = this.project.buildTargets;
    }

    // 平台过滤 + 无效编译器过滤 —— 对齐 PreprocessJob:2745-2764 的单循环顺序：
    // 先「不支持当前平台」告警跳过（:2749-2756，原文 "<工程> - <目标>" does not support the current platform. Skipping...），
    // 再 CompilerValid + PrintInvalidCompiler（:2759-2764：编译器 ID 未注册或 masterPath 指向的编译器程序缺失 → 报错并跳过该目标）
    let invalidCompilerSkipped = 0;
    let platformSkipped = 0;
    const jobTargets: BuildTarget[] = [];
    for (const t of targets) {
      if (!supportsCurrentPlatform(t.platforms)) {
        platformSkipped++;
        this.output.warn(`"${this.project.title} - ${t.title}" does not support the current platform. Skipping...`);
        continue;
      }
      const id = t.compilerId || this.project.compilerId;
      const c = this.resolveCompiler ? this.resolveCompiler(id) : this.compiler;
      if (c === undefined || !isCompilerUsable(c)) {
        invalidCompilerSkipped++;
        this.reportInvalidCompiler(t, c, c ? c.name : (id || null));
        continue;
      }
      jobTargets.push(t);
    }
    targets = jobTargets;

    if (targets.length === 0) {
      // 收尾行对齐 NotifyJobDone（compilergcc.cpp:4123-4140）：任务列表为空（平台/无效编译器跳过）→ "Nothing to be done (all items are up-to-date)."
      // 保护性差异（P3-B）：CB 日志到此为止（内部同样按失败返回）；扩展随后照常输出失败行/汇总，便于 VS Code 端明确失败原因
      if (invalidCompilerSkipped > 0 || platformSkipped > 0) {
        this.output.info('[Code::Blocks] Nothing to be done (all items are up-to-date).');
      }
      vscode.window.showWarningMessage('没有可构建的目标');
      this.emitBuildProfile();
      return false;
    }

    // 项目级 pre-build（bsProjectPreBuild）：目标循环前执行一次；
    // 宏按第一个目标上下文展开（对齐 GetPreBuildCommands(0) 用 GetCurrentlyCompilingTarget()）
    if (this.project.commandsBeforeBuild.length) {
      const first = targets[0];
      this.switchCompiler(first);
      this.output.info('[Code::Blocks] 执行项目 pre-build 脚本...');
      const preCmds = this.project.commandsBeforeBuild.map((c) => this.expandScriptMacros(first, c));
      this.lastCommands.push(...preCmds);
      const preOk = await this.profTimeAsync('项目/pre-build', () => runScriptCommands(
        preCmds,
        this.project.basePath,
        this.targetMacroVars(first),
        (l) => this.output.info(l),
        this.compilerBinPath(),
        options.cancel,
      ));
      if (options.cancel?.isCancelled()) {
        this.lastStats = { success: false, cancelled: true, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, hadCommands: false };
        this.emitBuildProfile();
        return false;
      }
      if (!preOk) {
        this.output.error('[Code::Blocks] 项目 pre-build 脚本失败');
        this.lastStats = { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, hadCommands: false };
        this.emitBuildProfile();
        return false;
      }
    }

    // 累计各目标的统计结果（供 Build Log 视图）
    let compiledCount = 0;
    let skippedCount = 0;
    let failedCount = 0;
    let linkSuccess = true;
    let linkSkipped = true;
    let outputFilename: string | undefined;

    let ok = true;
    let cancelled = false;
    let lastHadCommands = false;
    for (const target of targets) {
      // 取消检查点：目标之间（多目标 / 工作区多项目构建）
      if (options.cancel?.isCancelled()) {
        cancelled = true;
        break;
      }
      // 构建 Banner —— 对齐 PrintBanner（bsTargetPreBuild，每个目标构建前打印；位于项目 pre-build 之后）；
      // 编译器显示名按目标编译器（对齐 GetCompiler(target->GetCompilerID())）
      this.switchCompiler(target);
      this.printBanner('Build', target);
      const result = await this.buildTarget(target, options);
      // 无论成功失败都累加统计（失败时统计已累计的部分）
      lastHadCommands = result.hadCommands;
      compiledCount += result.compiledCount;
      skippedCount += result.skippedCount;
      failedCount += result.failedCount;
      linkSuccess = linkSuccess && result.linkSuccess;
      linkSkipped = linkSkipped && result.linkSkipped;
      if (result.outputFilename) outputFilename = result.outputFilename;
      if (result.cancelled) {
        cancelled = true;
        break;
      }
      if (!result.success) {
        ok = false;
        break;
      }
    }

    // 项目级 post-build（bsProjectPostBuild）：全部目标成功后执行一次（最后一个目标上下文展开）；
    // 门控对齐状态机：m_RunProjectPostBuild = 最后一个目标 hasCommands，除非项目级 alwaysRunPostBuildSteps
    if (ok && !cancelled && this.project.commandsAfterBuild.length && (lastHadCommands || this.project.alwaysRunPostBuildSteps)) {
      const last = targets[targets.length - 1];
      this.switchCompiler(last);
      this.output.info('[Code::Blocks] 执行项目 post-build 脚本...');
      const postCmds = this.project.commandsAfterBuild.map((c) => this.expandScriptMacros(last, c));
      this.lastCommands.push(...postCmds);
      const postOk = await this.profTimeAsync('项目/post-build', () => runScriptCommands(
        postCmds,
        this.project.basePath,
        this.targetMacroVars(last),
        (l) => this.output.info(l),
        this.compilerBinPath(),
        options.cancel,
      ));
      if (options.cancel?.isCancelled()) {
        cancelled = true;
      } else if (!postOk) {
        this.output.error('[Code::Blocks] 项目 post-build 脚本失败');
        ok = false;
      }
    }

    this.lastStats = { success: ok, cancelled, compiledCount, skippedCount, failedCount, linkSuccess, linkSkipped, hadCommands: lastHadCommands, outputFilename };
    this.emitBuildProfile();
    return ok;
  }

  /**
   * 目标宏变量（内置全集 + `<Environment>` 项目/目标环境变量 + 项目自定义变量）——
   * 对齐 macrosmanager RecalcVars：目标变量后读覆盖项目（envVarMap 参数顺序）；
   * 环境变量在前、内置宏在后 → 内置宏优先（保护 TARGET_* 等核心宏）；
   * 项目自定义变量（扩展增强）最后合并保持既有优先级。
   */
  private targetMacroVars(target: BuildTarget): Record<string, string> {
    const vars = cbBuiltinVars(this.project.basePath, target.outputFilename, target.title, target.objectOutput, this.project.title, this.project.filename, this.compiler.masterPath);
    return { ...envVarMap(this.project.envVars, target.envVars), ...vars, ...this.project.customVariables };
  }

  /** 展开 pre/post 命令中的编译宏（$compiler/$options/$includes 等），对齐 GenerateCommandLine */
  private expandScriptMacros(target: BuildTarget, cmd: string): string {
    const generator = new CommandGenerator(this.project, this.compiler);
    return generator.generateFromTemplate(cmd, { target, pf: null, file: '', object: '', flatObject: '', deps: '', noCompilerCache: true });
  }

  /**
   * R4：编译缓存工具缺失告警（每引擎一次；跨引擎 10s 去抖——工作区构建逐项目建引擎）。
   * 每次构建先清一次解析缓存再探测：工具在 VS Code 运行期间被安装/补齐时，
   * **下一个构建**即可生效（无需重载窗口或运行「重新检测」）；未解析到时命令生成
   * 静默回退原编译器，这里在输出通道说明原因与出路（安装引导 / compilerCachePath）。
   */
  private compilerCacheWarned = false;
  private warnCompilerCacheMissing(): void {
    if (this.compilerCacheWarned) return;
    try {
      const cfg = vscode.workspace.getConfiguration('codeblocks');
      const kind = normalizeCompilerCacheKind(cfg.get<string>('build.compilerCache', 'none'));
      if (kind === 'none') return;
      const explicit = cfg.get<string>('build.compilerCachePath', '') || '';
      // 每构建重探（清会话缓存）：运行中安装工具 → 下一构建自动生效
      clearCompilerCacheResolveCache();
      if (resolveCompilerCachePathCached(kind, explicit)) return;
      // 跨引擎去抖：工作区构建 = 每项目一个引擎 → 同一配置窗口期内只告警一次
      const now = Date.now();
      const warnKey = `${kind}\u0000${explicit}`;
      if (warnKey === lastCompilerCacheWarnKey && now - lastCompilerCacheWarnAt < COMPILER_CACHE_WARN_DEBOUNCE_MS) return;
      lastCompilerCacheWarnKey = warnKey;
      lastCompilerCacheWarnAt = now;
      this.compilerCacheWarned = true;
      this.output.warn(
        `[Code::Blocks] 编译缓存 ${kind} 已启用但未找到可执行文件` +
        `${explicit ? `（codeblocks.build.compilerCachePath = ${explicit} 无效）` : '（PATH 与常见安装目录均未命中）'}` +
        `——本次构建回退使用原编译器；可运行命令「Code::Blocks: Install Compiler Cache」获取安装指引，或为 compilerCachePath 设置正确的可执行文件路径。`,
      );
    } catch {
      // 无 vscode 宿主（headless 单测）或读取失败：静默（构建不受影响）
    }
  }

  /**
   * 收集所有目标的编译单元命令（不执行、不做增量判断），
   * 供 clangd / cpptools 的 compile_commands.json 使用。
   * 返回标准 LSP compile_commands 条目：{ directory, command, file }。
   */
  collectCompileCommands(targetTitle?: string): { directory: string; command: string; file: string; objectRel: string; targetTitle: string }[] {
    const targets = targetTitle
      ? this.project.buildTargets.filter((t) => t.title === targetTitle)
      : this.project.buildTargets;

    const entries: { directory: string; command: string; file: string; objectRel: string; targetTitle: string }[] = [];

    for (const target of targets) {
      // 平台过滤（对齐 GenerateCommandLine:238：目标不支持当前平台 → 不生成编译命令）
      if (!supportsCurrentPlatform(target.platforms)) continue;
      // CommandsOnly 目标默认不编译（开关关闭时同样不生成 clangd 条目）
      if (target.targetType === TargetType.CommandsOnly && !this.compileCommandsOnlyTargets()) continue;
      // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())）
      this.switchCompiler(target);
      const generator = new CommandGenerator(this.project, this.compiler);
      // 对齐 GetProjectFilesSortedByWeight（directcommands.cpp:143-157）：目标文件列表权威，空目标不编译工程全部文件（L6）
      const files = target.files;
      const hasCpp = files.some((f) => fileUsesCppCompiler(f));

      for (const file of files) {
        // 跳过不参与编译的文件（<Option compile="0"/>）
        if (file.compile === false) continue;

        const custom = file.customBuildCommands?.[target.compilerId];
        const isCustom = custom !== undefined && custom.use;
        // 自定义 buildCommand 文件（custom.ld/custom.xm 等链接脚本/资源）不是 C/C++ 源文件，
        // clangd 无法解析，compile_commands.json 里跳过（构建仍照常处理它们）。
        if (isCustom) continue;
        // 只收集 clangd 可索引的 C/C++ 源文件（.rc 资源脚本 clangd 无法解析）
        if (!isClangdIndexable(file.relativeFilename)) continue;

        const objectRel = this.objectPathRelative(target, file);

        const command = generator.generate(CommandType.CompileObjectCmd, {
          target,
          pf: file,
          file: file.absolutePath,
          object: objectRel,
          flatObject: this.objectPathRelativeFlat(target, file),
          deps: this.depsPathFor(target, file),
          hasCppFilesToLink: hasCpp,
          nativeSep: false,
          // R4：clangd 编译数据库不注入编译缓存前缀（保证 clangd 语义与工程真实命令行匹配）
          noCompilerCache: true,
        });
        if (command) {
          entries.push({ directory: this.project.basePath, command, file: file.absolutePath, objectRel, targetTitle: target.title });
        }
      }
    }
    return entries;
  }

  /**
   * 收集 Makefile 导出数据（B4：字面编译/链接命令 + 对象依赖；不执行、不做增量判断）。
   * 编译单元与 buildTarget 循环使用同一 makeCompileUnit，链接/打包与同一套
   * linkObjectRelative / linkObjectsPrependHack / computeStaticOutput 参数，保证与真实构建一致。
   * CommandsOnly 目标（默认不编译）与平台不支持的目标跳过。
   */
  collectMakefileData(targetTitle?: string): {
    targetTitle: string;
    output: string;
    compile: { object: string; source: string; command: string }[];
    link?: { kind: 'link' | 'archive'; command: string; objects: string[] };
  }[] {
    const targets = targetTitle
      ? this.project.buildTargets.filter((t) => t.title === targetTitle)
      : this.project.buildTargets;
    const result: {
      targetTitle: string;
      output: string;
      compile: { object: string; source: string; command: string }[];
      link?: { kind: 'link' | 'archive'; command: string; objects: string[] };
    }[] = [];

    for (const target of targets) {
      if (!supportsCurrentPlatform(target.platforms)) continue;
      if (target.targetType === TargetType.CommandsOnly && !this.compileCommandsOnlyTargets()) continue;
      this.switchCompiler(target);
      const generator = new CommandGenerator(this.project, this.compiler);
      // 对齐 GetProjectFilesSortedByWeight：目标文件列表权威（L6）
      const files = target.files;
      const sortedFiles = [...files].sort(compareFilesByWeight);
      const hasCpp = sortedFiles.some((f) => fileUsesCppCompiler(f));

      // 编译单元（与 buildTarget 1b 相同的过滤：compile=false / compilerVar 空）
      const compile: { object: string; source: string; command: string }[] = [];
      for (const file of sortedFiles) {
        if (file.compile === false) continue;
        if (!file.compilerVar) continue;
        const made = this.makeCompileUnit(target, file, generator, hasCpp);
        if (!made.unit) continue;
        compile.push({
          object: this.objectPathFor(target, file),
          source: file.absolutePath,
          command: made.unit.command,
        });
      }

      // 链接对象集合（与 buildTarget 1a 一致）
      const linkFiles: ProjectFile[] = [];
      const resFiles: ProjectFile[] = [];
      for (const file of sortedFiles) {
        if (file.link === false) continue;
        const ftL = fileTypeOf(file.relativeFilename);
        if (!isLinkableFileType(ftL)) continue;
        const prog = ftL === FileType.Resource
          ? this.compiler.programs.WINDRES
          : file.compilerVar === 'CPP' ? this.compiler.programs.CPP : this.compiler.programs.C;
        if (!prog) continue;
        if (ftL === FileType.Resource) resFiles.push(file);
        else linkFiles.push(file);
      }

      let link: { kind: 'link' | 'archive'; command: string; objects: string[] } | undefined;
      if (target.targetType !== TargetType.CommandsOnly && (linkFiles.length || resFiles.length)) {
        const isOw = (target.compilerId || '').toLowerCase() === 'ow';
        const allObjectsAbs = [...linkFiles, ...resFiles].map((f) => this.linkObjectAbs(target, f));
        if (target.targetType === TargetType.StaticLib) {
          const hack = generator.linkObjectsPrependHack();
          const objects = linkFiles.map((f) => hack + quoteIfNeeded(this.linkObjectRelative(target, f)));
          const objectsFlat = linkFiles.map((f) => hack + quoteIfNeeded(this.linkObjectRelativeFlat(target, f)));
          const objectSep = isOw ? ' ' : this.compiler.switches.objectSeparator;
          const cmd = generator.generate(CommandType.LinkStaticCmd, {
            target, pf: null, file: '', object: objects.join(objectSep), flatObject: objectsFlat.join(objectSep), deps: '', hasCppFilesToLink: false,
          });
          if (cmd) link = { kind: 'archive', command: cmd, objects: allObjectsAbs };
        } else {
          const linkObjects = linkFiles.map((f) => quoteIfNeeded(this.linkObjectRelative(target, f)));
          const resObjects = resFiles.map((f) => quoteIfNeeded(this.objectPathRelative(target, f)));
          const linkObjectsFlat = linkFiles.map((f) => quoteIfNeeded(this.linkObjectRelativeFlat(target, f)));
          const linkObjectStr = isOw
            ? (linkObjects.length ? 'file ' : '') + linkObjects.join(' ')
            : linkObjects.join(this.compiler.switches.objectSeparator);
          const resObjectStr = isOw
            ? resObjects.map((o) => 'option resource=' + o).join(' ')
            : resObjects.join(this.compiler.switches.objectSeparator);
          const cmd = generator.generate(this.linkCommandType(target), {
            target, pf: null, file: '', object: linkObjectStr,
            flatObject: linkObjectsFlat.join(isOw ? ' ' : this.compiler.switches.objectSeparator),
            deps: resObjectStr, hasCppFilesToLink: linkFiles.some((f) => f.compilerVar === 'CPP'),
          });
          if (cmd) link = { kind: 'link', command: cmd, objects: allObjectsAbs };
        }
      }

      result.push({
        targetTitle: target.title,
        output: this.expectedOutputFile(target),
        compile,
        link,
      });
    }
    return result;
  }

  /**
   * 文件是否可能产生编译命令（对齐 GetCompileFileCommand 分类：自定义命令 / 可编译类型 / PCH 头文件 / 生成器文件）。
   * A2：把「过期判定」提前到命令生成前（对齐 GetTargetCompileCommands:558「force || IsObjectOutdated → GetCompileFileCommand」）
   * 时需先据此分类——非候选文件保持原有「条目计数」路径且不触发命令生成；makeCompileUnit 与本判定共用同一条件。
   */
  private isCompileCandidate(target: BuildTarget, file: ProjectFile): boolean {
    const custom = file.customBuildCommands?.[target.compilerId];
    if (custom !== undefined && custom.use) return true;
    const ft = fileTypeOf(file.relativeFilename);
    if (isCompilableFileType(ft)) return true;
    if (ft === FileType.Header && this.compiler.switches.supportsPCH) return true;
    return (file.generatedFiles?.length ?? 0) > 0;
  }

  /**
   * 构造单个文件的编译单元 —— 对齐 GetCompileFileCommand（directcommands.cpp:262）。
   * 整目标构建（1b 循环）与单文件编译（compileFile）复用本方法，保证两条路径产出的命令字节级一致。
   * - compile=false / compilerVar 为空由调用方先行过滤；
   * - not-compilable：非自定义命令、非可编译类型、非 PCH 头文件、非生成器文件；
   * - no-command：命令展开后为空/纯空白（工具未匹配/程序缺失）。
   */
  private makeCompileUnit(
    target: BuildTarget,
    file: ProjectFile,
    generator: CommandGenerator,
    hasCpp: boolean,
  ): { unit?: CompileUnit; reason: 'ok' | 'not-compilable' | 'no-command' } {
    const custom = file.customBuildCommands?.[target.compilerId];
    const isCustom = custom !== undefined && custom.use;
    const ft = fileTypeOf(file.relativeFilename);
    const isHeader = ft === FileType.Header;
    // 自定义命令文件（custom.ld/custom.xm 等）或可编译类型（源文件/资源文件）才编译；
    // 头文件在编译器 supportsPCH 时也编译为 .gch（对齐 GetCompileFileCommand 的 is_header && supportsPCH）；
    // 生成器文件（编译器工具 gen 属性声明生成文件）也编译（对齐 AddFile localCompile 的 !GenFilesHackMap.empty()）
    // A2：与 isCompileCandidate 同一条件（收集循环已提前分类；此处保留以维持单文件编译路径语义）。
    if (!this.isCompileCandidate(target, file)) {
      return { reason: 'not-compilable' };
    }

    // 绝对对象路径用于增量判断/响应文件基础名，相对对象路径用于命令行（避免含空格路径）
    const objectRel = this.objectPathRelative(target, file);
    const object = this.objectPathFor(target, file);
    const deps = this.depsPathFor(target, file);

    let command: string;
    if (isCustom) {
      // 自定义编译命令：直接展开 $compiler/$file 等内置宏 + $(...) 变量
      command = this.expandCustomCommand(custom.command, generator, target, file, objectRel);
    } else {
      // 源文件路径（对齐 GetCompileFileCommand：UseFullSourcePaths 时绝对路径（资源文件再转短路径），否则相对路径）
      const srcFile = this.compiler.switches.useFullSourcePaths
        ? (ft === FileType.Resource && process.platform === 'win32'
            ? shortPathWin(file.absolutePath)
            : file.absolutePath)
        : file.relativeFilename;
      // 资源文件走 CompileResourceCmd（windres），其余走 CompileObjectCmd（对齐 GetCompileFileCommand）
      const cmdType = ft === FileType.Resource ? CommandType.CompileResourceCmd : CommandType.CompileObjectCmd;
      command = generator.generate(cmdType, {
        target,
        pf: file,
        file: srcFile,
        object: objectRel,
        // flatObject 恒为扁平命名（对齐 pfd.object_file_flat，与 useFlatObjects 无关）
        flatObject: this.objectPathRelativeFlat(target, file),
        deps,
        hasCppFilesToLink: hasCpp,
      });
    }
    // PCH 头文件：编译前删除旧 .gch（对齐 directcommands.cpp 的 wxRemoveFile，避免陈旧产物）
    if (isHeader) {
      command = `cmd /c if exist "${objectRel}" del "${objectRel}"\n${command}`;
    }
    // 对齐 AddCommandsToArray：展开后为空/纯空白的命令（如 buildCommand=" " 的 no-op）不执行
    if (!command || command.trim() === '') {
      return { reason: 'no-command' };
    }
    return {
      reason: 'ok',
      unit: {
        target,
        file,
        command,
        cwd: this.project.basePath,
        isPch: isHeader,
        // 响应文件基础名对齐 CheckForToLongCommandLine：对象目录 + 源文件名（含扩展）→ <对象目录>/<源文件名>.respFile
        respBase: path.join(path.dirname(object), path.basename(file.relativeFilename)),
      },
    };
  }

  /**
   * 单文件编译 —— 对齐 directcommands.cpp CompileFile：只编译指定源文件
   * （自定义 buildCommand 文件同样支持；增量判断与整目标构建一致）。返回是否成功。
   */
  async compileFile(targetTitle: string, fileRel: string, options: BuildOptions): Promise<boolean> {
    const target = this.project.buildTargets.find((t) => t.title === targetTitle);
    if (!target) {
      this.output.error(`[Code::Blocks] 未找到构建目标: ${targetTitle}`);
      return false;
    }
    // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())）
    this.switchCompiler(target);
    // 对齐 GetProjectFilesSortedByWeight：目标文件列表权威（L6）
    const files = target.files;
    const file = files.find((f) => f.relativeFilename === fileRel);
    if (!file) {
      this.output.error(`[Code::Blocks] 文件不在目标 "${targetTitle}" 中: ${fileRel}`);
      return false;
    }
    // 对齐 GetBuildTargetForFile（compilergcc.cpp:3119-3145）：文件未归属当前目标（或未归属任何目标）→ 拒绝
    if (!file.buildTargets.includes(targetTitle)) {
      this.output.error(`[Code::Blocks] error: Cannot find target for file: ${fileRel}`);
      return false;
    }
    // CommandsOnly 目标默认不编译文件（对齐扩展默认行为；开启 codeblocks.build.compileCommandsOnlyTargets 时按 CB 空存根编译）
    if (target.targetType === TargetType.CommandsOnly && !this.compileCommandsOnlyTargets()) {
      this.output.warn(`[Code::Blocks] CommandsOnly 目标 "${targetTitle}" 默认不编译文件（可开启设置 codeblocks.build.compileCommandsOnlyTargets 对齐 CB）`);
      return false;
    }
    // 单文件编译 Banner —— 对齐 PrintBanner(baBuildFile)（CompileFile:3156）
    this.printBanner('Build file', target);
    if (file.compile === false) {
      this.output.warn(`[Code::Blocks] 文件被排除编译（compile="0"），跳过: ${fileRel}`);
      return false;
    }
    if (!file.compilerVar) {
      this.output.warn(`[Code::Blocks] Cannot resolve compiler var for project file: ${fileRel}`);
      return false;
    }

    const generator = new CommandGenerator(this.project, this.compiler);
    const hasCpp = files.some((f) => fileUsesCppCompiler(f));
    const made = this.makeCompileUnit(target, file, generator, hasCpp);
    if (made.reason === 'not-compilable') {
      this.output.info(`[Code::Blocks] 跳过（非可编译文件）: ${fileRel}`);
      return false;
    }
    if (made.reason === 'no-command') {
      this.output.warn(`[Code::Blocks] Skipping file (no compiler program set): ${fileRel}`);
      return false;
    }
    const unit = made.unit!;

    // 增量判断（对齐 CompileFile 的 IsObjectOutdated 前置检查；deps 目录用关系合并后的有序目录，对齐 DepsSearchStart）
    const object = this.objectPathFor(target, file);
    if (!options.rebuild && this.isUpToDate(file.absolutePath, object, this.getIncludeDirs(target, generator), new Map())) {
      this.output.info(`[Code::Blocks] ${fileRel} ${msg('已是最新', 'is up to date')}`);
      return true;
    }

    // 对象父目录缺失则创建（对齐 CompileFile 的 CreateDirRecursively）
    const objectDir = path.dirname(object);
    if (objectDir && !this.ensureDir(objectDir, 'debug')) {
      this.output.error(`[Code::Blocks] 创建对象目录失败: ${objectDir}`);
      return false;
    }

    this.output.info(`[Code::Blocks] ${msg('编译文件', 'Compiling')}: ${fileRel}`);
    if (this.verboseOutput()) {
      this.output.info(unit.command);
    }
    return this.runSingleCommand(unit.command, unit.cwd, options, unit.respBase);
  }

  /**
   * 单文件清理 —— 对齐 CB 25.03 OnCleanFile（compilergcc.cpp:3275-3312）：只删除对象文件。
   * （GetCleanSingleFileCommand 在 25.03 中无调用方；.depend 仅全量 Clean 删除）
   */
  cleanFile(targetTitle: string, fileRel: string): void {
    const target = this.project.buildTargets.find((t) => t.title === targetTitle);
    if (!target) return;
    // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())）
    this.switchCompiler(target);
    // 对齐 GetProjectFilesSortedByWeight：目标文件列表权威（L6）
    const files = target.files;
    const file = files.find((f) => f.relativeFilename === fileRel);
    if (!file) return;
    // 对齐 GetBuildTargetForFile：文件未归属当前目标（或未归属任何目标）→ 静默跳过
    if (!file.buildTargets.includes(targetTitle)) return;
    if (!file.compilerVar) {
      this.output.warn(`[Code::Blocks] Cannot resolve compiler var for project file: ${fileRel}`);
      return;
    }
    const objectRel = this.objectPathRelative(target, file);
    if (objectRel && objectRel !== fileRel) {
      const objAbs = this.objectPathFor(target, file);
      if (this.removeFileIfExists(objAbs)) {
        this.output.info(`[Code::Blocks] Deleted: ${objectRel}`);
      } else {
        this.output.debug(`[Code::Blocks] 无对象文件可清理: ${fileRel}`);
      }
    } else {
      this.output.debug(`[Code::Blocks] 无对象文件可清理: ${fileRel}`);
    }
  }

  /**
   * 构造「已取消」统计对象 —— 取消不是失败：
   * failedCount 不计被强杀的编译进程，success=false 但 cancelled=true 供上层区分。
   */
  private cancelledStats(target: BuildTarget, compiledCount: number, skippedCount: number): BuildTargetStats {
    return {
      success: false,
      cancelled: true,
      compiledCount,
      skippedCount,
      failedCount: 0,
      linkSuccess: false,
      linkSkipped: target.targetType === TargetType.StaticLib,
      hadCommands: compiledCount > 0,
      outputFilename: target.outputFilename,
    };
  }

  /** 构建单个目标（始终返回统计对象，用 success 标记成败） */
  private async buildTarget(target: BuildTarget, options: BuildOptions): Promise<BuildTargetStats> {
    // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())；banner 已在 build() 切换，此处幂等）
    this.switchCompiler(target);
    // M0 探针：目标级键前缀 + 首编译 spawn 延迟基准（目标处理起点）
    this.profPrefix = `${target.title}/`;
    this.profTargetStartMs = Date.now();
    this.profFirstSpawnSeen = false;
    // 本次目标构建的耗时记录（提前 return 路径也要清空，避免汇总显示上次构建的 Top3）
    this.compileTimings = [];
    this.lastCompileTimings = [];
    const macroVars = this.targetMacroVars(target);
    const generator = new CommandGenerator(this.project, this.compiler);

    // 展开 pre/post 命令中的编译宏（$compiler/$options/$includes 等），对齐 Code::Blocks GenerateCommandLine
    // （directcommands.cpp GetPreBuildCommands：GenerateCommandLine(cmd, target, 0, "", ...)）
    const expandScriptMacros = (cmd: string): string =>
      generator.generateFromTemplate(cmd, { target, pf: null, file: '', object: '', flatObject: '', deps: '', noCompilerCache: true });

    // 构建脚本（<Script file>）：Code::Blocks 用 Squirrel 脚本引擎，扩展暂不支持，明确警告跳过
    const buildScripts = [...this.project.buildScripts, ...target.buildScripts];
    for (const s of buildScripts) {
      this.output.warn(`[Code::Blocks] 暂不支持 Squirrel 构建脚本，已跳过: ${s}`);
    }

    if (target.targetType === TargetType.CommandsOnly && !this.compileCommandsOnlyTargets()) {
      // 默认行为：仅执行目标级 pre/post build 命令（项目级在 build() 层各执行一次，对齐状态机 bsProjectPreBuild/bsProjectPostBuild）
      // （开启 codeblocks.build.compileCommandsOnlyTargets 时对齐 CB：照常编译文件，命令不带选项/include）
      const runAndCheck = async (cmds: string[], phase: 'pre' | 'post'): Promise<boolean | undefined> => {
        if (!cmds.length) return true;
        this.output.info(`[Code::Blocks] 执行目标 ${phase}-build 脚本 (${target.title})...`);
        this.lastCommands.push(...cmds);
        const r = await runScriptCommands(cmds, this.project.basePath, macroVars, (l) => this.output.info(l), this.compilerBinPath(), options.cancel);
        if (r) return true;
        if (options.cancel?.isCancelled()) return undefined;
        this.output.error(`[Code::Blocks] 目标 "${target.title}" ${phase}-build 脚本失败`);
        return false;
      };
      const pre = target.commandsBeforeBuild.map(expandScriptMacros);
      const post = target.commandsAfterBuild.map(expandScriptMacros);
      const preR = await runAndCheck(pre, 'pre');
      if (preR === undefined) return this.cancelledStats(target, 0, 0);
      if (preR === false) {
        return { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, hadCommands: false, outputFilename: target.outputFilename };
      }
      const postR = await runAndCheck(post, 'post');
      if (postR === undefined) return this.cancelledStats(target, 0, 0);
      if (postR === false) {
        return { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: true, hadCommands: false, outputFilename: target.outputFilename };
      }
      // CommandsOnly 目标的「命令」= 目标级 post 命令（对齐 GetTargetLinkCommands ttCommandsOnly 分支把 post 命令作为链接命令产出）
      return { success: true, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: true, linkSkipped: true, hadCommands: target.commandsAfterBuild.length > 0 };
    }

    // 全量编译（rebuild）对齐 CodeBlocks Rebuild：先删除对象输出目录，再全量编译
    if (options.rebuild) {
      this.cleanTarget(target);
    }

    // 目标级 pre-build 脚本（项目级在 build() 层执行一次，对齐状态机）
    const preCommands = [...target.commandsBeforeBuild].map(expandScriptMacros);

    // 0. pre-build 脚本
    if (preCommands.length) {
      this.output.info(`[Code::Blocks] 执行目标 pre-build 脚本 (${target.title})...`);
      this.lastCommands.push(...preCommands);
      const preOk = await this.profTimeAsync(this.profPrefix + '目标 pre-build', () => runScriptCommands(preCommands, this.project.basePath, macroVars, (l) => this.output.info(l), this.compilerBinPath(), options.cancel));
      if (!preOk) {
        // 取消优先判定（被强杀的脚本进程返回失败，但语义是取消）
        if (options.cancel?.isCancelled()) {
          return this.cancelledStats(target, 0, 0);
        }
        this.output.error(`[Code::Blocks] 目标 "${target.title}" pre-build 脚本失败`);
        return { success: false, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: false, linkSkipped: target.targetType === TargetType.StaticLib, hadCommands: false, outputFilename: target.outputFilename };
      }
    }

    // 1. 编译所有文件（增量：跳过未变更文件）
    const units: CompileUnit[] = [];
    // 对齐 GetProjectFilesSortedByWeight：目标文件列表权威（L6）
    const files = target.files;
    // 按 weight 排序（对齐 GetProjectFilesSortedByWeight：weight 升序，同 weight 按文件名）
    const sortedFiles = [...files].sort(compareFilesByWeight);
    const hasCpp = sortedFiles.some((f) => fileUsesCppCompiler(f));

    // 头文件依赖扫描（增量编译）：目录集 = 关系合并后的有序 include 目录 + 反引号派生目录（对齐 DepsSearchStart），
    // 再逐个展开宏（含项目自定义变量，对齐 depsAddSearchDir 前的 ReplaceMacros）
    const includeDirs = this.getIncludeDirs(target, generator).map((d) =>
      replaceCbMacros(d, { vars: macroVars, customVars: this.project.customVariables ?? {} }),
    );
    const depsCache = new Map<string, number>();

    // 1a. 链接对象集合（独立于编译，对应 GetTargetLinkCommands：link=true 且可链接类型。
    //     对齐 CodeBlocks GetProjectFilesSortedByWeight(target, false, true) 只过滤 !pf->link，
    //     link 默认值由文件类型决定（.c/.cpp 等可链接，.xm/.ld 等不可链接）——
    //     因此带自定义 buildCommand 的 .c 文件仍须参与链接，
    //     而 custom.ld/custom.xm 因扩展名非可链接类型被 isLinkableFileType 排除；
    //     资源文件（.rc）单独到 resFiles（$link_resobjects），其余到 linkFiles（$link_objects））
    const linkFiles: ProjectFile[] = [];
    const resFiles: ProjectFile[] = [];
    for (const file of sortedFiles) {
      if (file.link === false) continue;
      const ftL = fileTypeOf(file.relativeFilename);
      if (!isLinkableFileType(ftL)) continue;
      // 对齐 GetTargetLinkCommands：$compiler 宏为空（对应文件编译器程序缺失）→ 跳过并提示
      const prog = ftL === FileType.Resource
        ? this.compiler.programs.WINDRES
        : file.compilerVar === 'CPP' ? this.compiler.programs.CPP : this.compiler.programs.C;
      if (!prog) {
        this.output.debug(`[Code::Blocks] Skipping file (no compiler program set): ${file.relativeFilename}`);
        continue;
      }
      if (ftL === FileType.Resource) {
        resFiles.push(file);
      } else {
        linkFiles.push(file);
      }
    }

    // 1b. 编译单元（对应 GetCompileFileCommand：compile=true 且可编译类型或自定义命令）
    let skippedCount = 0;
    // 生成文件单元延后编译（对齐 GetCompileFileCommand 的「生成器命令 → COMPILER_WAIT → 生成文件命令」：
    // 生成器先产出源文件，生成文件才能编译）
    const deferredUnits: CompileUnit[] = [];
    // CB 条目计数强制（对齐 GetTargetCompileCommands:585「GetLinkCommands(target, ret.GetCount() != counter)」）：
    // 编译列表中「过期但无可执行命令」的文件（自定义空命令 / 工具未匹配）在 CB 中同样产生日志条目
    // （directcommands.cpp:350 Skipping 行 / :357 Compiling 行）→ 链接阶段被强制。
    // 此类文件的对象永不产生（如 custom.ld → <对象目录>/custom.o），故每次构建都强制重链接/重新打包（与 CB 一致）。
    const staleNoopFiles: string[] = [];
    // CB else 分支条目（对齐 GetTargetCompileCommands:562-566）：源文件缺失时 IsObjectOutdated 返回 false 但
    // errorStr 非空 → WARNING 条目计入 ret → 同样强制链接（WARNING 文案由 isUpToDate 输出）。
    const missingSourceFiles: string[] = [];
    // M0 探针：收集阶段（全循环 = 增量判定 + 命令生成 + 过滤）
    const profCollectT0 = Date.now();
    for (const file of sortedFiles) {
      // 跳过不参与编译的文件（<Option compile="0"/>）
      if (file.compile === false) continue;
      // 对齐 CB：源缺失的编译文件（含 compilerVar 为空者——else 分支在 GetCompileFileCommand 之前判定）计入 WARNING 条目 → 强制。
      // autoGeneratedBy 在 CB 主循环被跳过（directcommands.cpp:553）不产生条目；rebuild 走 force 分支（命令失败中止），无需计入。
      if (!options.rebuild && !file.autoGeneratedBy && !fs.existsSync(file.absolutePath)) {
        missingSourceFiles.push(file.relativeFilename);
      }
      // 对齐 GetCompileFileCommand：compilerVar 为空 → 跳过（Cannot resolve compiler var；CB 返回空数组不产生条目，故不强制链接）
      if (!file.compilerVar) {
        // 对齐 CB else 分支（directcommands.cpp:562-566）：WARNING 在 GetCompileFileCommand 的 compilerVar
        // 判定之前输出（IsObjectOutdated 先于它执行），源缺失时此处补齐文案（强制已由 missingSourceFiles 计入）。
        if (!options.rebuild && !file.autoGeneratedBy && !fs.existsSync(file.absolutePath)) {
          this.output.warn(`WARNING: Can't read file's timestamp: ${file.absolutePath}`);
        }
        this.output.debug(`[Code::Blocks] Cannot resolve compiler var for project file: ${file.relativeFilename}`);
        continue;
      }

      const isHeader = fileTypeOf(file.relativeFilename) === FileType.Header;

      // A2：非编译候选文件（GetCompileFileCommand 分类以外的文件）不生成命令；
      // 过期（对象永不产生）时按条目计数强制重链（对齐 directcommands.cpp:350 Skipping 条目语义）。
      if (!this.isCompileCandidate(target, file)) {
        // autoGeneratedBy 文件在 CB 主循环被跳过（directcommands.cpp:553），不产生条目。
        if (!file.autoGeneratedBy
          && (options.rebuild || !this.profIsUpToDate(file, this.objectPathFor(target, file), includeDirs, depsCache))) {
          staleNoopFiles.push(file.relativeFilename);
        }
        continue;
      }

      // 绝对对象路径用于增量判断，相对对象路径用于命令行（避免含空格路径）
      const object = this.objectPathFor(target, file);

      // A2（对齐 GetTargetCompileCommands:558「force || IsObjectOutdated → GetCompileFileCommand」）：
      // 先判过期，up-to-date 文件不再生成命令（原实现先生成后丢弃，纯浪费 ~0.25–0.31s/次）；
      // （Code::Blocks 对自定义 buildCommand 文件同样执行 IsObjectOutdated 判断）
      if (!options.rebuild && this.profIsUpToDate(file, object, includeDirs, depsCache)) {
        skippedCount++;
        if (this.verboseOutput()) {
          this.output.info(`[Skipping] ${file.relativeFilename} (up to date)`);
        } else {
          this.output.debug(`[Skipping] ${file.relativeFilename} (up to date)`);
        }
        continue;
      }

      // 过期/强制：生成命令（对齐 GetCompileFileCommand）
      const made = this.prof
        ? this.prof.time(`${this.profPrefix}命令生成`, () => this.makeCompileUnit(target, file, generator, hasCpp))
        : this.makeCompileUnit(target, file, generator, hasCpp);
      if (made.reason === 'not-compilable' || made.reason === 'no-command') {
        // 此处必为过期/强制（up-to-date 已在上方过滤）：仍产生条目 → 计入强制链接（对齐 IsObjectOutdated=true 语义）。
        // no-command 的 debug 日志同样只在过期/强制分支出现（CB 不生成命令时亦不打印）。
        if (!file.autoGeneratedBy) {
          staleNoopFiles.push(file.relativeFilename);
        }
        if (made.reason === 'no-command' && !isHeader) {
          // 对齐 GetCompileFileCommand：命令为空（工具未匹配/程序缺失）→ 跳过日志（头文件除外）
          this.output.debug(`[Code::Blocks] Skipping file (no compiler program set): ${file.relativeFilename}`);
        }
        continue;
      }
      const unit = made.unit!;

      // 生成文件延后到所有常规编译之后（保证生成器已产出源文件）
      if (file.autoGeneratedBy) deferredUnits.push(unit);
      else units.push(unit);
    }
    // M0 探针：收集阶段结束（增量判定 + 命令生成 + 过滤的合计）
    this.profAdd(`${this.profPrefix}收集阶段`, Date.now() - profCollectT0);
    if (this.prof) {
      this.prof.count(`${this.profPrefix}收集统计(目标文件数)`, sortedFiles.length);
      this.prof.count(`${this.profPrefix}收集统计(待编译)`, units.length + deferredUnits.length);
      this.prof.count(`${this.profPrefix}收集统计(跳过)`, skippedCount);
      this.prof.count(`${this.profPrefix}收集统计(过期noop)`, staleNoopFiles.length);
    }

    // 创建所有对象文件的父目录（对应 CodeBlocks 的 CreateDirRecursively）
    // 否则 GCC 无法创建 Output\obj\plugin\xxx.o 等子目录下的对象文件
    this.prof
      ? this.prof.time(`${this.profPrefix}对象目录创建`, () => this.ensureObjectDirs([...units, ...deferredUnits]))
      : this.ensureObjectDirs([...units, ...deferredUnits]);

    // 无需要编译的文件（且输出已存在）→ 目标已最新；但外部依赖更新仍需重链接（对齐 GetTargetLinkCommands：AreExternalDepsOutdated 先于 !force 返回）
    if (units.length === 0 && deferredUnits.length === 0) {
      const outAbs = this.resolveOutputFile(target);
      if (fs.existsSync(outAbs)) {
        // CommandsOnly 已在上方 return，此处目标必为可链接类型
        // 外部依赖缺失同样输出 WARNING（对齐 GetTargetLinkCommands:707-720）
        const missing: string[] = [];
        const externalForce = this.areExternalDepsOutdated(target, outAbs, missing);
        if (missing.length) {
          this.output.warn(`WARNING: Target '${this.project.title}/${target.title}': Unable to resolve ${missing.length} external dependency/ies:`);
          for (const m of missing) this.output.debug(`        ${m}`);
        }
        // 链接输入（.ld 等，保护性增强）比输出新 → 强制重链接（继续进入链接/打包阶段，日志在链接块输出）
        const linkInputForce = this.linkInputsOutdated(target, outAbs) !== null;
        // CB 条目计数强制（对齐 directcommands.cpp:585）：过期但无可执行命令 / 源缺失的编译文件同样产生条目 → 强制链接/打包
        if (!externalForce && !linkInputForce && staleNoopFiles.length === 0 && missingSourceFiles.length === 0) {
          this.output.info('[Code::Blocks] Nothing to be done (all items are up-to-date).');
          // 目标已最新（hasCommands=false）：仅当 alwaysRunPostBuildSteps 为真时才执行 post-build（对齐 CodeBlocks）
          if (!(await this.runPostBuild(target, macroVars, expandScriptMacros, false, options))) {
            if (options.cancel?.isCancelled()) {
              return this.cancelledStats(target, 0, skippedCount);
            }
            return {
              success: false, compiledCount: 0, skippedCount, failedCount: 0,
              linkSuccess: false, linkSkipped: target.targetType === TargetType.StaticLib,
              hadCommands: false, outputFilename: target.outputFilename,
            };
          }
          return {
            success: true, compiledCount: 0, skippedCount, failedCount: 0,
            linkSuccess: true, linkSkipped: target.targetType === TargetType.StaticLib,
            hadCommands: false, outputFilename: target.outputFilename,
          };
        }
        // 外部依赖或链接输入更新：继续执行链接/打包阶段（重新检查会输出 WARNING / Re-linking 日志）
      }
      // 输出缺失但无新编译：仍尝试链接（对象可能已存在）
    }

    // 并行编译（受配置限制）；生成文件在常规编译全部完成后执行
    const totalUnits = units.length + deferredUnits.length;
    const compileStartMs = Date.now();
    const maxJobs = this.maxJobs();
    const results = await this.runInParallel(units, maxJobs, options, totalUnits);
    // 失败即停：常规编译出现失败时不再派发生成文件单元（对齐 CB OnJobEnd 清队列语义）
    if (deferredUnits.length && !results.includes(undefined)) {
      results.push(...(await this.runInParallel(deferredUnits, maxJobs, options, totalUnits)));
    }
    const compileSec = ((Date.now() - compileStartMs) / 1000).toFixed(1);
    // M0 探针：编译墙钟（并行调度全程；含宿主输出解析，解析单独另行统计）
    this.profAdd(`${this.profPrefix}编译墙钟`, Date.now() - compileStartMs);
    this.lastCompileTimings = [...this.compileTimings];

    // 取消检查点：被强杀的编译进程 close 返回失败，但语义是取消而非失败（failedCount 不计）
    if (options.cancel?.isCancelled()) {
      return this.cancelledStats(target, results.filter((r) => r).length, skippedCount);
    }

    const failedCount = results.filter((r) => r === false).length;
    if (failedCount > 0) {
      // 失败即停统计（对齐 CB 清队列）：未派发单元（undefined）不计入失败，仅提示
      const notDispatched = results.filter((r) => r === undefined).length;
      if (notDispatched > 0) {
        this.output.info(`[Code::Blocks] ${msg(`编译失败，剩余 ${notDispatched} 个单元未派发（失败即停，对齐 CB 清队列）`, `Compilation failed: ${notDispatched} unit(s) not dispatched (fail-fast, CB queue-clear semantics)`)}`);
      }
      this.output.error(`[Code::Blocks] 目标 "${target.title}" 编译失败`);
      return {
        success: false,
        compiledCount: results.filter((r) => r === true).length, // 编译成功的文件数（未派发单元不计）
        skippedCount,
        failedCount,
        linkSuccess: false,
        linkSkipped: target.targetType === TargetType.StaticLib,
        hadCommands: totalUnits > 0,
        outputFilename: target.outputFilename,
      };
    }
    // 编译阶段完成耗时（对齐 Code::Blocks 阶段化日志）
    this.output.info(`[Code::Blocks] ${msg(`编译完成 ${totalUnits} 个文件 (${compileSec}s)`, `Compiled ${totalUnits} files (${compileSec}s)`)}`);

    // 2. 链接（CommandsOnly/static lib 不链接；CommandsOnly 已在上面 return 或按开关跳过链接）
    let linkSuccess = true;
    let linkExecuted = false;
    let archiveExecuted = false;
    if (target.targetType !== TargetType.StaticLib && target.targetType !== TargetType.CommandsOnly) {
      // 对齐 GetTargetLinkCommands：无可链接对象文件 → 跳过链接阶段（即使输出缺失也不链接）
      if (linkFiles.length === 0 && resFiles.length === 0) {
        this.output.info('[Code::Blocks] Linking stage skipped (build target has no object files to link)');
      } else {
        // 链接对象 = 所有参与链接的标准源文件对象（不论本次是否重编译）
        // （custom.ld → custom.o 是链接脚本、custom.xm → customxm.o 是资源，均不参与链接）
        // 逐对象加引号（对齐 pfDetails::Update:579-583 QuoteStringIfNeeded + GetTargetLinkCommands objectSeparator 拼接）
        const isOw = (target.compilerId || '').toLowerCase() === 'ow';
        const linkObjects = linkFiles.map((f) => quoteIfNeeded(this.linkObjectRelative(target, f)));
        const resObjects = resFiles.map((f) => quoteIfNeeded(this.objectPathRelative(target, f)));
        // 扁平对象列表（对齐 GetTargetLinkCommands 的 FlatLinkFiles：恒为扁平命名，与 useFlatObjects 无关）
        const linkObjectsFlat = linkFiles.map((f) => quoteIfNeeded(this.linkObjectRelativeFlat(target, f)));
        // OpenWatcom 特例（对齐 GetTargetLinkCommands:752-753/785-788）：链接对象前加 "file "、资源对象改 "option resource="、空格拼接
        const linkObjectStr = isOw
          ? (linkObjects.length ? 'file ' : '') + linkObjects.join(' ')
          : linkObjects.join(this.compiler.switches.objectSeparator);
        const resObjectStr = isOw
          ? resObjects.map((o) => 'option resource=' + o).join(' ')
          : resObjects.join(this.compiler.switches.objectSeparator);
        const linkObjectsAbs = linkFiles.map((f) => this.linkObjectAbs(target, f));
        // 资源对象同样参与增量判断（对齐 GetTargetLinkCommands 的时间戳检查遍历所有对象）
        const allObjectsAbs = [...linkObjectsAbs, ...resFiles.map((f) => this.objectPathFor(target, f))];

        // 增量：输出已存在且比所有链接对象新 → 跳过链接（对应 GetTargetLinkCommands 时间戳检查）；
        // 外部依赖检查（对齐 AreExternalDepsOutdated：库/外部依赖/附加输出更新 → 强制重链接）
        const outputAbs = this.resolveOutputFile(target);
        let forceLink = options.rebuild || !this.linkObjectsUpToDate(outputAbs, allObjectsAbs);
        const missing: string[] = [];
        if (this.areExternalDepsOutdated(target, outputAbs, missing)) forceLink = true;
        if (missing.length) {
          this.output.warn(`WARNING: Target '${this.project.title}/${target.title}': Unable to resolve ${missing.length} external dependency/ies:`);
          for (const m of missing) this.output.debug(`        ${m}`);
        }
        // 链接输入（.ld/.lds/.def 等非编译文件）比输出新 → 强制重链接（保护性增强；仿 CB AreExternalDepsOutdated 的 DebugLog 文案）
        const newerLinkInput = this.linkInputsOutdated(target, outputAbs);
        if (newerLinkInput) {
          forceLink = true;
          const rel = path.relative(this.project.basePath, newerLinkInput).replace(/\\/g, '/');
          this.output.info(`[Code::Blocks] ${msg(`链接输入 "${rel}" 有更新，重新链接`, `Re-linking because '${rel}' is newer`)}`);
        }
        // CB 条目计数强制（对齐 GetTargetCompileCommands:585）：过期但无可执行命令的编译文件在 CB 中
        // 产生日志条目 → 每次构建都强制链接（对象永不产生，如 custom.ld 自定义空命令）
        if (staleNoopFiles.length) {
          forceLink = true;
          const names = staleNoopFiles.slice(0, 3).join('、') + (staleNoopFiles.length > 3 ? '…' : '');
          this.output.info(`[Code::Blocks] ${msg(`目标 "${target.title}" 含 ${staleNoopFiles.length} 个过期且无可执行命令的编译文件（${names}），强制链接（对齐 CB 条目计数）`, `Target "${target.title}" has ${staleNoopFiles.length} stale compile file(s) without an executable command (${names}); forcing link (CB entry-count parity)`)}`);
        }
        // CB 条目计数补全（同 :585）：编译阶段产生过任何条目即强制——真实自定义命令本身也是条目，
        // 其对象永不产生（如 custom.ld 自定义命令），对象时间戳链路无法触发重链；普通工程零影响（对象已更新→本就强制）。
        if (totalUnits > 0) forceLink = true;
        // CB else 分支条目：源缺失的编译文件 → WARNING 条目计入强制（WARNING 已由 isUpToDate 输出）
        if (missingSourceFiles.length) forceLink = true;
        if (forceLink) {
          // 创建输出目录（如 Output\bin），否则链接器无法写 app.elf；失败则中止本目标（对齐 GetTargetLinkCommands 的目录错误提示，用日志替代阻塞弹窗）
          if (!this.ensureDir(path.dirname(outputAbs))) {
            this.output.error(`[Code::Blocks] 无法创建输出目录，目标 "${target.title}" 中止`);
            return {
              success: false,
              compiledCount: totalUnits,
              skippedCount,
              failedCount: 0,
              linkSuccess: false,
              linkSkipped: false,
              hadCommands: true,
              outputFilename: target.outputFilename,
            };
          }

          const linkCommand = generator.generate(this.linkCommandType(target), {
            target,
            pf: null,
            file: '',
            object: linkObjectStr,
            flatObject: linkObjectsFlat.join(isOw ? ' ' : this.compiler.switches.objectSeparator),
            deps: resObjectStr,
            hasCppFilesToLink: linkFiles.some((f) => f.compilerVar === 'CPP'),
          });
          if (linkCommand) {
            this.output.info(linkCommand);
            // 对齐 GetTargetLinkCommands:917 的 Linking <kind>: <output>（kind 映射 853-879）
            this.output.info(`[Code::Blocks] Linking ${this.linkKind(target)}: ${this.expandedOutputFilename(target)}`);
            const linkStartMs = Date.now();
            linkExecuted = true;
            // 链接响应文件基础名对齐 CheckForToLongCommandLine：对象输出目录（空→.objs）+ <title>_link.respFile
            const respBase = linkRespBase(this.project.basePath, target.objectOutput, target.title);
            const linkOk = await this.runCommand(linkCommand, this.project.basePath, options, respBase);
            const linkSec = ((Date.now() - linkStartMs) / 1000).toFixed(1);
            // M0 探针：链接墙钟
            this.profAdd(`${this.profPrefix}链接`, Date.now() - linkStartMs);
            if (!linkOk) {
              // 取消优先判定（被强杀的链接器返回失败，但语义是取消）
              if (options.cancel?.isCancelled()) {
                return this.cancelledStats(target, totalUnits, skippedCount);
              }
              this.output.error(`[Code::Blocks] ${msg(`目标 "${target.title}" 链接失败`, `Target "${target.title}" failed to link`)}`);
              return {
                success: false,
                compiledCount: totalUnits,
                skippedCount,
                failedCount: 0,
                linkSuccess: false,
                linkSkipped: false,
                hadCommands: true,
                outputFilename: target.outputFilename,
              };
            }
            if (!buildLogPrefs().plain) {
              this.output.info(`✔️ [Linked] ${path.relative(this.project.basePath, outputAbs)} (${linkSec}s)`);
            }
          } else {
            // 对齐 GetTargetLinkCommands：无链接器程序时提示跳过
            this.output.debug(`[Code::Blocks] Skipping linking (no linker program set): ${outputAbs}`);
          }
        } else {
          this.output.info(`[Code::Blocks] ${msg(`目标 "${target.title}" 链接已是最新，跳过链接`, `Target "${target.title}" is up to date, linking skipped`)}`);
        }
      }
    } else if (target.targetType === TargetType.StaticLib) {
      // 对齐 GetTargetLinkCommands：无可链接对象文件 → 跳过打包阶段
      if (linkFiles.length === 0 && resFiles.length === 0) {
        this.output.info('[Code::Blocks] Linking stage skipped (build target has no object files to link)');
      } else {
        // 静态库用 ar 打包（对齐 Code::Blocks LinkStatic 模板，含 $lib_linker 引号与多行命令拆分）
        // 逐对象加引号（同链接阶段，对齐 pfDetails::Update 的 QuoteStringIfNeeded）；
        // $±link_objects prependHack（对齐 GetTargetLinkCommands:724-742）：bcc/dmc 等模板要求对象前加 -/+；
        // OpenWatcom 特例：空格拼接（对齐 GetTargetLinkCommands:795-804）
        const isOw = (target.compilerId || '').toLowerCase() === 'ow';
        const hack = generator.linkObjectsPrependHack();
        const objects = linkFiles.map((f) => hack + quoteIfNeeded(this.linkObjectRelative(target, f)));
        const objectsFlat = linkFiles.map((f) => hack + quoteIfNeeded(this.linkObjectRelativeFlat(target, f)));
        const objectSep = isOw ? ' ' : this.compiler.switches.objectSeparator;
        const staticOut = computeStaticOutput(
          this.expandedOutputFilename(target),
          this.compiler.switches,
          target.prefixAuto,
          target.extensionAuto,
        );
        const staticOutAbs = path.join(this.project.basePath, staticOut);
        const linkObjectsAbs = linkFiles.map((f) => this.linkObjectAbs(target, f));
        // 增量：静态库已存在且比所有对象新 → 跳过打包；外部依赖更新 → 强制重新打包
        let forceArchive = options.rebuild || !this.linkObjectsUpToDate(staticOutAbs, linkObjectsAbs);
        const missing: string[] = [];
        if (this.areExternalDepsOutdated(target, staticOutAbs, missing)) forceArchive = true;
        // 链接输入（.ld 等）比静态库输出新 → 强制重新打包（保护性增强）
        const newerArchiveInput = this.linkInputsOutdated(target, staticOutAbs);
        if (newerArchiveInput) {
          forceArchive = true;
          const rel = path.relative(this.project.basePath, newerArchiveInput).replace(/\\/g, '/');
          this.output.info(`[Code::Blocks] ${msg(`链接输入 "${rel}" 有更新，重新打包`, `Re-archiving because '${rel}' is newer`)}`);
        }
        // CB 条目计数强制（对齐 GetTargetCompileCommands:585）：过期但无可执行命令的编译文件 → 每次构建都强制重新打包
        if (staleNoopFiles.length) {
          forceArchive = true;
          const names = staleNoopFiles.slice(0, 3).join('、') + (staleNoopFiles.length > 3 ? '…' : '');
          this.output.info(`[Code::Blocks] ${msg(`目标 "${target.title}" 含 ${staleNoopFiles.length} 个过期且无可执行命令的编译文件（${names}），强制重新打包（对齐 CB 条目计数）`, `Target "${target.title}" has ${staleNoopFiles.length} stale compile file(s) without an executable command (${names}); forcing archive (CB entry-count parity)`)}`);
        }
        // CB 条目计数补全（同 :585）：真实自定义命令本身也是条目 → 编译过任何单元即强制重新打包（对象永不产生时同样成立）
        if (totalUnits > 0) forceArchive = true;
        // CB else 分支条目：源缺失的编译文件 → WARNING 条目计入强制（WARNING 已由 isUpToDate 输出）
        if (missingSourceFiles.length) forceArchive = true;
        if (missing.length) {
          this.output.warn(`WARNING: Target '${this.project.title}/${target.title}': Unable to resolve ${missing.length} external dependency/ies:`);
          for (const m of missing) this.output.debug(`        ${m}`);
        }
        if (forceArchive) {
          // 创建静态库输出目录（如 bin\Debug），否则 ar 无法写 libdep_lib.a；失败则中止本目标
          if (!this.ensureDir(path.dirname(staticOutAbs))) {
            this.output.error(`[Code::Blocks] 无法创建输出目录，目标 "${target.title}" 中止`);
            return {
              success: false,
              compiledCount: totalUnits,
              skippedCount,
              failedCount: 0,
              linkSuccess: false,
              linkSkipped: true,
              hadCommands: true,
              outputFilename: target.outputFilename,
            };
          }
          const arCmd = generator.generate(CommandType.LinkStaticCmd, {
            target,
            pf: null,
            file: '',
            object: objects.join(objectSep),
            flatObject: objectsFlat.join(objectSep),
            deps: '',
            hasCppFilesToLink: false,
          });
          if (arCmd) {
            this.output.info(arCmd);
            // 对齐 GetTargetLinkCommands:917（静态库同走 Linking 行，kind = static library）
            this.output.info(`[Code::Blocks] Linking ${this.linkKind(target)}: ${this.expandedOutputFilename(target)}`);
            const arStartMs = Date.now();
            archiveExecuted = true;
            const respBase = linkRespBase(this.project.basePath, target.objectOutput, target.title);
            const ok = await this.runCommand(arCmd, this.project.basePath, options, respBase);
            const arSec = ((Date.now() - arStartMs) / 1000).toFixed(1);
            // M0 探针：打包墙钟（ar）
            this.profAdd(`${this.profPrefix}打包(ar)`, Date.now() - arStartMs);
            if (!ok) {
              // 取消优先判定（被强杀的 ar 返回失败，但语义是取消）
              if (options.cancel?.isCancelled()) {
                return this.cancelledStats(target, totalUnits, skippedCount);
              }
              return {
                success: false,
                compiledCount: totalUnits,
                skippedCount,
                failedCount: 0,
                linkSuccess: false,
                linkSkipped: true,
                hadCommands: true,
                outputFilename: target.outputFilename,
              };
            }
            if (!buildLogPrefs().plain) {
              this.output.info(`✔️ [Archived] ${staticOut} (${arSec}s)`);
            }
          } else {
            // 对齐 GetTargetLinkCommands：无打包程序时提示跳过
            this.output.debug(`[Code::Blocks] Skipping linking (no linker program set): ${staticOutAbs}`);
          }
        } else {
          this.output.info(`[Code::Blocks] ${msg(`目标 "${target.title}" 静态库已是最新，跳过打包`, `Target "${target.title}" is up to date, archiving skipped`)}`);
        }
      }
    }

    // 3. 目标级 post-build 脚本（对齐 CodeBlocks 状态机 bsTargetPostBuild；项目级在 build() 层执行）
    if (!(await this.runPostBuild(target, macroVars, expandScriptMacros, true, options))) {
      if (options.cancel?.isCancelled()) {
        return this.cancelledStats(target, totalUnits, skippedCount);
      }
      return {
        success: false,
        compiledCount: totalUnits,
        skippedCount,
        failedCount: 0,
        linkSuccess,
        linkSkipped: target.targetType === TargetType.StaticLib,
        hadCommands: totalUnits > 0 || linkExecuted || archiveExecuted,
        outputFilename: target.outputFilename,
      };
    }

    return {
      success: true,
      compiledCount: totalUnits,
      skippedCount,
      failedCount: 0,
      linkSuccess,
      linkSkipped: target.targetType === TargetType.StaticLib,
      hadCommands: totalUnits > 0 || linkExecuted || archiveExecuted,
      outputFilename: target.outputFilename,
    };
  }

  /**
   * 执行目标级 post-build 步骤 —— 对齐 CodeBlocks 状态机 bsTargetPostBuild：
   * 条件：hasCommands（有编译/链接动作）或 alwaysRunPostBuildSteps 标志为真时才执行。
   * 项目级 post-build 在 build() 层执行（bsProjectPostBuild，每次构建一次）。
   */
  private async runPostBuild(
    target: BuildTarget,
    macroVars: Record<string, string>,
    expandScriptMacros: (cmd: string) => string,
    hasCommands: boolean,
    options: BuildOptions,
  ): Promise<boolean> {
    const targetPost = [...target.commandsAfterBuild].map(expandScriptMacros);
    const extraPath = this.compilerBinPath();

    if (targetPost.length && (hasCommands || target.alwaysRunPostBuildSteps)) {
      this.output.info(`[Code::Blocks] 执行目标 post-build 脚本 (${target.title})...`);
      this.lastCommands.push(...targetPost);
      const ok = await this.profTimeAsync(`${this.profPrefix}目标 post-build`, () => runScriptCommands(targetPost, this.project.basePath, macroVars, (l) => this.output.info(l), extraPath, options.cancel));
      if (!ok) {
        if (options.cancel?.isCancelled()) return false;
        this.output.error(`[Code::Blocks] 目标 "${target.title}" post-build 脚本失败`);
        return false;
      }
    }
    return true;
  }

  private linkCommandType(target: BuildTarget): CommandType {
    switch (target.targetType) {
      case TargetType.ConsoleOnly: return CommandType.LinkConsoleExeCmd;
      case TargetType.DynamicLib: return CommandType.LinkDynamicCmd;
      case TargetType.Native: return CommandType.LinkNativeCmd;
      case TargetType.StaticLib: return CommandType.LinkStaticCmd;
      default: return CommandType.LinkExeCmd;
    }
  }

  /** 链接阶段 kind_of_output 文案（对齐 GetTargetLinkCommands:853-879） */
  private linkKind(target: BuildTarget): string {
    switch (target.targetType) {
      case TargetType.ConsoleOnly: return 'console executable';
      case TargetType.DynamicLib: return 'dynamic library';
      case TargetType.StaticLib: return 'static library';
      case TargetType.Native: return 'native';
      default: return 'executable';
    }
  }

  /** 编译器 bin 目录（用于把交叉编译器工具加入脚本执行的 PATH） */
  private compilerBinPath(): string {
    // 优先从完整程序路径推导（如 .../toolchain/bin/riscv32-elf-gcc.exe → .../toolchain/bin）
    const c = this.compiler.programs.C;
    if (c && (c.includes('/') || c.includes('\\'))) {
      return path.dirname(c);
    }
    // 回退：masterPath + bin
    if (this.compiler.masterPath) {
      return path.join(this.compiler.masterPath, 'bin');
    }
    return '';
  }

  /** 展开自定义编译命令（custom.ld/custom.xm 等 <Option buildCommand>） */
  private expandCustomCommand(
    cmd: string,
    generator: CommandGenerator,
    target: BuildTarget,
    file: ProjectFile,
    object: string,
  ): string {
    return generator.generateFromTemplate(cmd, {
      target,
      pf: file,
      // 对齐 GetCompileFileCommand 的源文件路径选择：UseFullSourcePaths 时绝对路径，否则相对路径
      file: this.compiler.switches.useFullSourcePaths ? file.absolutePath : file.relativeFilename,
      object,
      // flatObject 恒为扁平命名（对齐 pfd.object_file_flat）
      flatObject: this.objectPathRelativeFlat(target, file),
      deps: this.depsPathFor(target, file),
      hasCppFilesToLink: false,
      // R4：自定义 buildCommand 不注入编译缓存前缀（命令内容由用户在工程内定义，保持逐字展开）
      noCompilerCache: true,
    });
  }

  /**
   * 增量编译判断 —— 对应 CodeBlocks DirectCommands::IsObjectOutdated：
   * 源文件 mtime 与 #include 依赖头文件 mtime 均不晚于对象文件，才认为无需重编译。
   */
  private isUpToDate(
    sourceFile: string,
    objectFile: string,
    includeDirs: string[],
    depsCache: Map<string, number>,
  ): boolean {
    let srcStat: fs.Stats;
    let objStat: fs.Stats;
    try {
      srcStat = fs.statSync(sourceFile);
    } catch {
      // 对齐 IsObjectOutdated：源文件不存在 → 不编译并输出 WARNING；存在但时间戳读取失败 → 回退编译
      if (!fs.existsSync(sourceFile)) {
        this.output.warn(`WARNING: Can't read file's timestamp: ${sourceFile}`);
        return true;
      }
      return false;
    }
    try {
      objStat = fs.statSync(objectFile);
    } catch {
      // 对象文件不存在 → 需要编译
      return false;
    }
    if (objStat.mtimeMs < srcStat.mtimeMs) return false; // 源文件比对象新 → 需编译
    // skip_include_deps：跳过 include 依赖扫描（对齐 CodeBlocks /skip_include_deps 设置）
    if (vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.skipIncludeDeps', false)) {
      return true;
    }
    // 扫描 #include 依赖，头文件更新也触发重编译（对应 depsScanForHeaders + depsGetNewest）
    const newestDep = this.depsNewestMtime(sourceFile, includeDirs, depsCache);
    return newestDep <= objStat.mtimeMs;
  }

  /**
   * 预期输出文件路径（Makefile 导出用；B4）：
   * 与 resolveOutputFile 不同，不做存在性回退，而是按平台规则预判真实产物——
   * Windows 下 exe 类目标即使扩展名写了 app（MinGW 链接器实际产出 app.exe）也返回 app.exe，
   * 否则 make 目标（无扩展名）永不满足、每次全量重链接。
   */
  private expectedOutputFile(target: BuildTarget): string {
    if (target.targetType === TargetType.StaticLib) {
      return this.resolveOutputFile(target);
    }
    const out = this.expandedOutputFilename(target);
    const exeType = isExecutableTargetType(target.targetType);
    if (process.platform === 'win32' && exeType && !out.toLowerCase().endsWith('.exe')) {
      return executableCandidates(this.project.basePath, out, process.platform, exeType)[1];
    }
    return executableCandidates(this.project.basePath, out, process.platform, exeType)[0];
  }

  /**
   * 解析目标实际输出文件路径。
   * Windows 下 MinGW 链接器会为无扩展名的 `-o` 输出自动追加 `.exe`
   * （如 .cbp 的 output="bin/Debug/hello"，实际产出 bin/Debug/hello.exe），
   * 因此时间戳判断需先解析出真实存在的文件。
   */
  private resolveOutputFile(target: BuildTarget): string {
    // 输出文件名宏展开（对齐 GetTargetLinkCommands/GetTargetCleanCommands 的 ReplaceMacros）
    const output = this.expandedOutputFilename(target);
    // 静态库实际输出带 lib 前缀 + .a（computeStaticOutput），而非原始 outputFilename
    if (target.targetType === TargetType.StaticLib) {
      return path.join(
        this.project.basePath,
        computeStaticOutput(output, this.compiler.switches, target.prefixAuto, target.extensionAuto),
      );
    }
    return resolveExecutablePath(
      this.project.basePath, output, process.platform, isExecutableTargetType(target.targetType),
    );
  }

  /**
   * 链接增量判断 —— 对应 CodeBlocks DirectCommands::GetTargetLinkCommands 的时间戳检查：
   * 输出文件存在且 mtime 不早于所有链接对象，才认为无需重新链接。
   */
  private linkObjectsUpToDate(outputAbs: string, objectPaths: string[]): boolean {
    try {
      const outStat = fs.statSync(outputAbs);
      for (const o of objectPaths) {
        const objStat = fs.statSync(o);
        if (objStat.mtimeMs > outStat.mtimeMs) return false; // 对象比输出新 → 需链接
      }
      return true;
    } catch {
      // 输出或任一对象不存在 → 需要链接
      return false;
    }
  }

  /** 输出文件名宏展开（对齐 ReplaceMacros(target->GetOutputFilename(), target)） */
  private expandedOutputFilename(target: BuildTarget): string {
    return replaceCbMacros(target.outputFilename, {
      vars: this.targetMacroVars(target),
      customVars: this.project.customVariables ?? {},
    });
  }

  /** 文件 mtime（毫秒，失败返回 0，对齐 depsTimeStamp 语义） */
  private fileMtime(p: string): number {
    if (!p) return 0;
    try {
      return fs.statSync(p).mtimeMs;
    } catch {
      return 0;
    }
  }

  /**
   * 外部依赖过期检查 —— 对齐 AreExternalDepsOutdated（directcommands.cpp:1007）：
   * 1. 输出存在时：链接库（目标+项目+编译器全局）在库目录中找到的 .a/.lib 比输出新 → 强制重链接；
   * 2. external_deps 比 additional_output 或输出新 → 强制重链接；缺失依赖计入 filesMissing（WARNING）。
   */
  private areExternalDepsOutdated(target: BuildTarget, buildOutput: string, filesMissing: string[]): boolean {
    // CB 构建时 CWD 已切到项目目录；扩展在宿主进程做时间戳检查，相对路径须以项目根为基准
    const absFromProject = (p: string): string => (path.isAbsolute(p) ? p : path.join(this.project.basePath, p));
    let timeOutput = 0;
    if (buildOutput) {
      timeOutput = this.fileMtime(buildOutput);
      if (timeOutput > 0) {
        // 库列表：目标 + 项目 + 编译器全局（对齐 AppendArray 顺序）
        const libs = [...target.linkLibs, ...this.project.linkLibs, ...(this.compiler.linkLibs ?? [])];
        const libDirs = [...target.libDirs, ...this.project.libDirs, ...(this.compiler.libDirs ?? [])];
        const macros = this.targetMacroVars(target);
        for (let lib of libs) {
          if (!lib) continue;
          // 用户直接指向带路径的库：不经过库目录直接检查（ReplaceMacros + UnixFilename）
          if (lib.includes('/') || lib.includes('\\')) {
            lib = replaceCbMacros(lib, { vars: macros, customVars: this.project.customVariables ?? {} }).replace(/\\/g, '/');
            if (this.fileMtime(absFromProject(lib)) > timeOutput) return true;
            continue;
          }
          if (!lib.startsWith(this.compiler.switches.libPrefix)) lib = this.compiler.switches.libPrefix + lib;
          if (!lib.endsWith('.' + this.compiler.switches.libExtension)) lib += '.' + this.compiler.switches.libExtension;
          for (const dir of libDirs) {
            const cand = replaceCbMacros(path.join(absFromProject(dir), lib), {
              vars: macros,
              customVars: this.project.customVariables ?? {},
            }).replace(/\\/g, '/');
            if (this.fileMtime(cand) > timeOutput) return true;
          }
        }
      }
    }

    // 外部依赖 / 附加输出（cbp 中为分号分隔列表）
    const macros = this.targetMacroVars(target);
    for (const dep of target.externalDeps) {
      if (!dep) continue;
      const depExp = absFromProject(replaceCbMacros(dep, { vars: macros, customVars: this.project.customVariables ?? {} }));
      const timeExtDep = this.fileMtime(depExp);
      // 依赖缺失：不需重链接，但记录 WARNING
      if (timeExtDep <= 0) {
        filesMissing.push(depExp);
        continue;
      }
      // 检查附加输出文件
      for (const add of target.additionalOutput) {
        if (!add) continue;
        const addExp = absFromProject(replaceCbMacros(add, { vars: macros, customVars: this.project.customVariables ?? {} }));
        const timeAdd = this.fileMtime(addExp);
        if (timeAdd <= 0) {
          filesMissing.push(addExp);
          continue;
        }
        if (timeExtDep > timeAdd) return true;
      }
      // 无输出（commands-only）时继续检查其它依赖
      if (!buildOutput) continue;
      // 输出不存在 → 重链接
      if (timeOutput <= 0) return true;
      // 外部依赖比输出新 → 重链接
      if (timeExtDep > timeOutput) return true;
    }
    return false;
  }

  /** 链接输入扩展名列表（设置 codeblocks.build.linkInputExtensions，默认 xm；显式空数组 [] = 关闭增强） */
  private linkInputExtensions(): string[] {
    const defaults = ['xm'];
    const raw = vscode.workspace.getConfiguration('codeblocks').get<unknown>('build.linkInputExtensions', defaults);
    // 误配容错（避免静默失效）：字符串（'ld, lds' / '.ld' / '*.ld'）按分隔符拆分；
    // 其它非数组值（true/数字/对象/空串）回退默认列表；仅显式空数组 [] 表示关闭（文档约定）。
    let list: unknown[];
    if (Array.isArray(raw)) list = raw;
    else if (typeof raw === 'string' && raw.trim() !== '') list = raw.split(/[;,\s]+/);
    else list = defaults;
    return [...new Set(
      list
        .map((e) => String(e).trim().toLowerCase().replace(/^\*\./, '').replace(/^\./, ''))
        .filter((e) => e.length > 0),
    )];
  }

  /**
   * 链接输入新鲜度检查（保护性增强，非 CodeBlocks 原生行为）：
   * 工程内非编译文件（custom.ld 链接脚本、custom.xm 资源、.icf/.def/.lds 等）不产生对象文件，
   * 改动后无法进入对象时间戳链路，此前仅 external_deps 能触发重链接。这里按扩展名白名单检查其 mtime：
   * 比输出新 → 返回该文件绝对路径（调用方强制重链接/重新打包），否则返回 null。
   * 输出不存在时不判定（既有逻辑必然重链接）。
   * compile=1 且带自定义编译命令（use=1）的文件不在此列：其链接强制由 CB 条目计数规则负责
   * （见 staleNoopFiles/编译单元，对齐 GetTargetCompileCommands:585——对象永不产生 → 每次构建都强制链接）；
   * compile=false 的文件即便带自定义命令仍按 mtime 触发（命令不执行、CB 亦无动作，属保护性增强）。
   */
  private linkInputsOutdated(target: BuildTarget, buildOutput: string): string | null {
    const exts = this.linkInputExtensions();
    if (!exts.length || !buildOutput) return null;
    const timeOutput = this.fileMtime(buildOutput);
    if (timeOutput <= 0) return null;
    let newest: string | null = null;
    let newestTime = 0;
    for (const file of target.files) {
      // 已参与编译/链接链路的文件由对象时间戳与 #include 扫描覆盖，这里只认非编译、非链接对象文件；
      // compile=1 且带自定义编译命令（use=1）的文件由 CB 条目计数规则强制（staleNoopFiles/编译单元），
      // 此处跳过避免双重计入；compile=false 的即便带自定义命令仍按 mtime 触发（命令不执行，保护性增强）
      const ft = fileTypeOf(file.relativeFilename);
      if (isCompilableFileType(ft) || isLinkableFileType(ft)) continue;
      if (file.customBuildCommands?.[target.compilerId]?.use && file.compile) continue;
      if (!exts.includes(fileExt(file.relativeFilename))) continue;
      const abs = path.isAbsolute(file.relativeFilename)
        ? file.relativeFilename
        : path.join(this.project.basePath, file.relativeFilename);
      const t = this.fileMtime(abs);
      if (t > timeOutput && t > newestTime) {
        newest = abs;
        newestTime = t;
      }
    }
    return newest;
  }

  /** 收集目标的 include 搜索目录（关系合并后的有序目录 + 反引号派生目录；对齐 DepsSearchStart 的 GetCompilerSearchDirs） */
  private getIncludeDirs(target: BuildTarget, generator?: CommandGenerator): string[] {
    if (generator) return generator.getCompilerSearchDirs(target.title);
    const dirs = [...this.project.includeDirs, ...target.includeDirs];
    // 对齐 CB GetIncludeDirs:808-811：cwd 类目录参与依赖扫描
    if (this.compiler.includePrjCwd) dirs.push(this.project.basePath);
    if (this.compiler.includeFileCwd) dirs.push('.');
    return dirs;
  }

  /** 递归扫描 #include "..." 依赖树，返回依赖头文件的最大 mtime（毫秒，不含文件自身） */
  private depsNewestMtime(
    fileAbs: string,
    includeDirs: string[],
    cache: Map<string, number>,
    inProgress?: Set<string>,
  ): number {
    // 盘符归一化（e:\ → E:\），让同一文件以不同大小写盘符访问时命中同一缓存条目
    const key = upperDrive(path.resolve(fileAbs));
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const inProg = inProgress ?? new Set<string>();
    if (inProg.has(key)) return 0; // 循环 include，中断递归
    inProg.add(key);

    let newest = 0;
    for (const resolved of this.scanIncludes(key, includeDirs)) {
      try {
        newest = Math.max(newest, fs.statSync(resolved).mtimeMs);
      } catch {
        continue;
      }
      newest = Math.max(newest, this.depsNewestMtime(resolved, includeDirs, cache, inProg));
    }
    inProg.delete(key);
    cache.set(key, newest);
    return newest;
  }

  /**
   * 扫描源文件的 #include 依赖列表。
   * 跨构建持久化缓存：源文件 mtime 与 include 搜索目录均未变时直接复用，避免每次构建重复读文件。
   */
  private scanIncludes(fileAbs: string, includeDirs: string[]): string[] {
    let srcStat: fs.Stats;
    try {
      srcStat = fs.statSync(fileAbs);
    } catch {
      return [];
    }
    const srcMtimeMs = srcStat.mtimeMs;
    const srcSize = srcStat.size;
    const norm = (d: string): string => (process.platform === 'win32' ? d.toLowerCase() : d);
    const dirsKey = includeDirs
      .map((d) => (path.isAbsolute(d) ? path.normalize(d) : path.join(this.project.basePath, d)))
      .map(norm)
      .join('|');
    const entry = depsIncludeCache.get(fileAbs);
    if (entry && entry.srcMtimeMs === srcMtimeMs && entry.srcSize === srcSize && entry.dirsKey === dirsKey) {
      return entry.includes;
    }
    const includes: string[] = [];
    try {
      const raw = fs.readFileSync(fileAbs, 'utf-8');
      // 剥离注释与字符串后再匹配（注释里的 #include 不计依赖；字符串内的 # 不是预处理指令）
      const content = this.stripCommentsAndStrings(raw);
      // 同时匹配双引号与尖括号 include
      const re = /^\s*#\s*include\s*(?:"([^"]+)"|<([^>]+)>)/gm;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const quoted = m[1];
        const angled = m[2];
        const resolved = this.resolveInclude(quoted ?? angled, fileAbs, includeDirs, quoted === undefined);
        if (resolved) includes.push(resolved);
      }
    } catch {
      // 文件读取失败（如二进制/无权限），忽略其依赖
    }
    depsIncludeCache.set(fileAbs, { srcMtimeMs, srcSize, dirsKey, includes });
    return includes;
  }

  /** 解析 #include 头文件的实际路径：双引号先查源文件目录再查 include 目录；尖括号只查 include 目录 */
  private resolveInclude(inc: string, fromFile: string, includeDirs: string[], angleBracket = false): string | undefined {
    // 1. 双引号：相对当前源文件所在目录（C 编译器默认行为）
    if (!angleBracket) {
      const cand = path.resolve(path.dirname(fromFile), inc);
      if (fs.existsSync(cand)) return cand;
    }
    // 2. 相对项目 include 目录（相对路径基于项目根目录解析）
    for (const dir of includeDirs) {
      const base = path.isAbsolute(dir) ? dir : path.join(this.project.basePath, dir);
      const cand = path.resolve(base, inc);
      if (fs.existsSync(cand)) return cand;
    }
    return undefined;
  }

  /**
   * 剥离 C 源码中的注释与字符串/字符常量，供 #include 扫描使用：
   * 1. 块注释全局剥离（保留换行，跨行）；
   * 2. #include 行原样保留（引号内是头文件名，不能剥字符串）；
   * 3. 其余行先剥字符串/字符常量（避免字符串里的 # 或 // 被误认）再截行注释。
   */
  private stripCommentsAndStrings(src: string): string {
    // 1. 块注释 → 等宽空格（保留换行）
    const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
    const lines = noBlock.split('\n');
    const out: string[] = [];
    for (const rawLine of lines) {
      if (/^\s*#\s*include\b/.test(rawLine)) {
        // #include 行：保留（引号内容即头文件名），仅截行注释
        out.push(rawLine.replace(/\/\/.*$/, ''));
        continue;
      }
      // 其它行：先剥字符串/字符常量，再截行注释
      out.push(this.stripStrings(rawLine).replace(/\/\/.*$/, ''));
    }
    return out.join('\n');
  }

  /** 剥离单行中的字符串/字符常量（替换为等宽空格，处理转义引号） */
  private stripStrings(line: string): string {
    let out = '';
    let i = 0;
    while (i < line.length) {
      const c = line[i];
      if (c === '"' || c === "'") {
        const q = c;
        out += ' ';
        i++;
        while (i < line.length && line[i] !== q) {
          if (line[i] === '\\') i++; // 跳过转义字符
          i++;
        }
        i++;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  /**
   * 删除目标的构建产物 —— 对齐 GetTargetCleanCommands（directcommands.cpp:955-1000）：
   * 逐个删除对象文件与输出文件（不删目录，避免误删 obj 目录里用户自放的文件）。
   * 供 rebuild（先 Clean 再 Build）与 Clean 命令复用。
   */
  cleanTarget(target: BuildTarget): void {
    // 无效编译器目标：跳过对象清理（对齐 GetTargetCleanCommands:966 的 compiler==null 分支与
    // PrintBanner:1788 的 CompilerValid 早退）；输出文件删除在 compiler 检查之外（对齐 981-988）
    const id = target.compilerId || this.project.compilerId;
    const resolved = this.resolveCompiler ? this.resolveCompiler(id) : this.compiler;
    // 对齐 GetTargetCleanCommands（directcommands.cpp:958-977）：仅编译器未注册（nullptr）跳过对象删除；
    // 编译器存在但 masterPath 无效仍删除对象（L18）
    const unresolved = !resolved;
    if (unresolved) {
      this.output.debug(`[Code::Blocks] 目标 "${target.title}" 编译器未注册，跳过对象清理`);
    } else {
      // 每目标编译器（对齐 GetCompiler(target->GetCompilerID())，needDependencies 随目标编译器取）
      this.switchCompiler(target);
      // Clean Banner —— 对齐状态机 bsTargetClean 的 PrintBanner(baClean)
      this.printBanner('Clean', target);
    }
    let removed = 0;
    if (!unresolved) {
      // 对齐 GetProjectFilesSortedByWeight：目标文件列表权威（L6）
      const files = target.files;
      for (const file of files) {
        if (file.compile === false) continue;
        if (!file.buildTargets.includes(target.title) && file.buildTargets.length > 0) continue;
        const objAbs = this.objectPathFor(target, file);
        if (this.removeFileIfExists(objAbs)) {
          removed++;
          // 详细输出：逐文件删除列表（对齐 Code::Blocks Clean 逐条删除命令）
          if (this.verboseOutput()) {
            this.output.info(`[Clean] ${path.relative(this.project.basePath, objAbs)}`);
          }
        }
        // distclean：同时删除 deps 依赖文件（对齐 GetTargetCleanCommands 的 ret.Add(pfd.dep_file_absolute_native)；
        // Clean 与 Rebuild 均以 distclean=true 执行，compilergcc.cpp bsTargetClean → GetCleanCommands(bt, true)）
        const depAbs = this.depsPathFor(target, file);
        if (this.removeFileIfExists(depAbs)) {
          removed++;
          if (this.verboseOutput()) {
            this.output.info(`[Clean] ${path.relative(this.project.basePath, depAbs)}`);
          }
        }
        // 自动生成文件：同时删除本体（对齐 GetTargetCleanCommands：if (pf->AutoGeneratedBy()) ret.Add(pf->file.GetFullPath())）
        if (file.autoGeneratedBy) {
          if (this.removeFileIfExists(file.absolutePath)) {
            removed++;
            if (this.verboseOutput()) {
              this.output.info(`[Clean] ${path.relative(this.project.basePath, file.absolutePath)}`);
            }
          }
        }
      }
    }
    // 输出文件（含 Windows 无扩展名输出自动追加的 .exe 变体；CommandsOnly 无输出，对齐 GetTargetCleanCommands）
    if (target.targetType !== TargetType.CommandsOnly && target.outputFilename) {
      const out = this.resolveOutputFile(target);
      if (this.removeFileIfExists(out)) {
        removed++;
        if (this.verboseOutput()) {
          this.output.info(`[Clean] ${path.relative(this.project.basePath, out)}`);
        }
      }
      if (process.platform === 'win32' && !out.toLowerCase().endsWith('.exe')) {
        if (this.removeFileIfExists(out + '.exe')) {
          removed++;
          if (this.verboseOutput()) {
            this.output.info(`[Clean] ${path.relative(this.project.basePath, out + '.exe')}`);
          }
        }
      }
      // 动态库：同时删除 import 库（对齐 GetTargetCleanCommands ttDynamicLib → GetStaticLibFilename；
      // import 库默认基础名 = 输出去扩展名（GetDynamicLibImportFilename 的 $(TARGET_OUTPUT_DIR)$(TARGET_OUTPUT_BASENAME)），
      // 强制平台默认前缀/扩展且大小写不敏感，对齐 SetupOutputFilenames）
      if (target.targetType === TargetType.DynamicLib) {
        const out = this.expandedOutputFilename(target);
        const outP = path.parse(out);
        const impBase = target.impLib || path.join(outP.dir, outP.name);
        const imp = path.join(
          this.project.basePath,
          computeStaticOutput(impBase, this.compiler.switches, true, true, true),
        );
        if (this.removeFileIfExists(imp)) {
          removed++;
          if (this.verboseOutput()) {
            this.output.info(`[Clean] ${path.relative(this.project.basePath, imp)}`);
          }
        }
      }
    }
    // 响应文件清理（保护性增强，codeblocks.build.cleanResponseFiles，默认关；CB 从不清理）
    removed += this.cleanResponseFiles(target);
    this.output.info(`[Code::Blocks] Cleaned "${this.project.title} - ${target.title}": 删除 ${removed} 个文件`);
  }

  /**
   * 删除对象输出目录下的响应文件（*.respFile）——保护性增强（设置 codeblocks.build.cleanResponseFiles，默认关；
   * Code::Blocks 从不清理响应文件，默认关保持对齐）。开启后 Clean/Rebuild 一并清理，避免旧响应文件永久遗留。
   * 返回删除数量。
   */
  private cleanResponseFiles(target: BuildTarget): number {
    if (vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.cleanResponseFiles', false) !== true) {
      return 0;
    }
    const objDir = path.join(this.project.basePath, target.objectOutput || '.objs');
    const stale: string[] = [];
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return; // 目录不存在等：无可清理
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.isFile() && /\.respFile$/i.test(e.name)) stale.push(p);
      }
    };
    walk(objDir);
    let count = 0;
    for (const p of stale) {
      if (this.removeFileIfExists(p)) {
        count++;
        if (this.verboseOutput()) {
          this.output.info(`[Clean] ${path.relative(this.project.basePath, p)}`);
        }
      }
    }
    return count;
  }

  /** 删除存在的文件，返回是否真的删除了 */
  private removeFileIfExists(p: string): boolean {
    try {
      if (!p || !fs.existsSync(p)) return false;
      fs.rmSync(p, { force: true });
      return true;
    } catch (e) {
      this.output.error(`[Code::Blocks] 删除失败: ${p}: ${(e as Error).message}`);
      return false;
    }
  }

  /** 详细输出开关（codeblocks.build.verboseOutput，默认 false；编译器 XML logging=full 时强制，对齐 CB clogFull） */
  private verboseOutput(): boolean {
    return vscode.workspace.getConfiguration('codeblocks').get<boolean>('build.verboseOutput', false)
      || this.compiler.switches.logging === 'full';
  }

  /** 对象文件的绝对路径（增量判断用） */
  private objectPathFor(target: BuildTarget, file: ProjectFile): string {
    return path.join(this.project.basePath, this.objectPathRelative(target, file));
  }

  /**
   * 相对项目根的对象路径（命令行用，对齐 pfDetails::Update + GetObjName 命名规则）：
   * - 普通源文件：objDir + <相对路径> + name.o（UseFlatObjects 时只有文件名）
   * - 资源文件 .rc：name.res（FileFilters::RESOURCEBIN_EXT）
   * - PCH 头文件：<原名>.<gch>（保留 .h），pch_mode=2 放源文件旁、否则放 obj 目录
   */
  private objectPathRelative(target: BuildTarget, file: ProjectFile): string {
    // 生成器文件的对象 = 第一个生成文件的对象（对齐 pfDetails::Update:468-472）
    if ((file.generatedFiles?.length ?? 0) > 0) {
      const first = this.project.files.find((f) => f.relativeFilename === file.generatedFiles[0]);
      if (first) return this.objectPathRelative(target, first);
    }
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Header && this.compiler.switches.supportsPCH) {
      return this.pchObjectRelative(target, file);
    }
    const objDir = target.objectOutput || '.objs';
    const rel = file.relativeToCommonTopLevelPath || file.relativeFilename;
    if (path.isAbsolute(rel)) {
      // 跨卷文件对象路径（对齐 projectfile.cpp:474-492：objOut += 卷名，去卷路径拼接）。
      // CB 的 wxFileName::GetVolume() 不含冒号（SplitVolume 取 posFirstColon 之前）→ CB 输出
      // obj\Debug\D\Source\foo.o；此处同样取卷字母（去冒号）→ 与 CB 一致（非差异）。
      // UNC（root 以 // 开头）：卷 = server/share 两个目录段（对齐 CB objOut += fileVol 的意图；
      // 保护性修正——CB 自身因 AfterFirst 双重拼接会重复 server/share 段，不继承该 bug）。
      const parsedAbs = path.parse(rel);
      const volLetter = (parsedAbs.root ?? '').replace(/[:\\/]/g, '');
      const extAbs = ft === FileType.Resource ? 'res' : this.compiler.switches.objectExtension;
      const nameAbs = this.project.extendedObjNames ? parsedAbs.base + '.' + extAbs : parsedAbs.name + '.' + extAbs;
      if (volLetter) {
        const withoutVol = parsedAbs.dir.slice(parsedAbs.root.length);
        const volSegs = parsedAbs.root.startsWith('//')
          ? parsedAbs.root.split('/').filter((s) => s.length > 0)
          : [volLetter];
        return path.join(objDir, ...volSegs, withoutVol, nameAbs);
      }
      // 无卷信息：回退源文件旁（原行为）
      return path.join(parsedAbs.dir, nameAbs);
    }
    const parsed = path.parse(rel);
    const ext = ft === FileType.Resource ? 'res' : this.compiler.switches.objectExtension;
    const flat = this.compiler.switches.useFlatObjects;
    // extended_obj_names：保留原扩展名再追加（foo.c → foo.c.o，projectfile.cpp SetObjName）
    const name = this.project.extendedObjNames
      ? path.basename(rel) + '.' + ext
      : parsed.name + '.' + ext;
    return path.join(objDir, flat ? '' : path.dirname(rel), name);
  }

  /** PCH 头文件对象路径（对齐 projectfile.cpp:229-243 GetObjName + 410-459 pfDetails::Update） */
  private pchObjectRelative(target: BuildTarget, file: ProjectFile): string {
    const gch = this.compiler.switches.PCHExtension || 'gch';
    if (this.project.pchMode === 2) {
      // pchSourceFile：源文件旁（项目相对原路径 + .gch），不进 obj 目录
      return toUnix(file.relativeFilename) + '.' + gch;
    }
    if (this.project.pchMode === 0) {
      // pchSourceDir：<源文件目录>/<原名>.<gch>/<target>_<扁平化名字>（projectfile.cpp:414-431）
      const src = toUnix(file.relativeFilename);
      const dir = path.dirname(src);
      const fullName = path.basename(src);
      const inner = (target.title + '_' + (file.relativeToCommonTopLevelPath || file.relativeFilename))
        .replace(/[/\\]/g, '_')
        .replace(/\./g, '_');
      return path.join(dir, fullName + '.' + gch, inner);
    }
    // pchObjectDir（默认）：对象输出目录 + <原名>.gch（如 include/all.h.gch）
    const objDir = target.objectOutput || '.objs';
    const rel = toUnix(file.relativeToCommonTopLevelPath || file.relativeFilename);
    return path.join(objDir, rel + '.' + gch);
  }

  /** 链接对象相对路径：项目内直接加入的 .o/.a 用原路径（对齐 pfDetails::Update ftObject/ftStaticLib） */
  private linkObjectRelative(target: BuildTarget, file: ProjectFile): string {
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Object || ft === FileType.StaticLib) return file.relativeFilename;
    return this.objectPathRelative(target, file);
  }

  /** 扁平对象路径 —— 对齐 pfd.object_file_flat（GetObjName useFlatObjects 强制扁平：对象目录 + 纯文件名，忽略源目录层级） */
  private objectPathRelativeFlat(target: BuildTarget, file: ProjectFile): string {
    // 生成器文件的对象 = 第一个生成文件的对象（与 objectPathRelative 同规则）
    if ((file.generatedFiles?.length ?? 0) > 0) {
      const first = this.project.files.find((f) => f.relativeFilename === file.generatedFiles[0]);
      if (first) return this.objectPathRelativeFlat(target, first);
    }
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Header && this.compiler.switches.supportsPCH) {
      return this.pchObjectRelative(target, file);
    }
    const objDir = target.objectOutput || '.objs';
    const ext = ft === FileType.Resource ? 'res' : this.compiler.switches.objectExtension;
    if (path.isAbsolute(file.relativeFilename)) {
      // 跨卷文件扁平对象（对齐 projectfile.cpp:474-492 + flat=GetFullName：objOut + 卷名 + 文件名；
      // UNC 卷拆 server/share 两段，同 objectPathRelative 的保护性修正）
      const parsedAbs = path.parse(file.relativeFilename);
      const volLetter = (parsedAbs.root ?? '').replace(/[:\\/]/g, '');
      const nameAbs = this.project.extendedObjNames ? parsedAbs.base + '.' + ext : parsedAbs.name + '.' + ext;
      if (volLetter) {
        const volSegs = parsedAbs.root.startsWith('//')
          ? parsedAbs.root.split('/').filter((s) => s.length > 0)
          : [volLetter];
        return path.join(objDir, ...volSegs, nameAbs);
      }
      return path.join(parsedAbs.dir, nameAbs);
    }
    const name = this.project.extendedObjNames
      ? path.basename(file.relativeFilename) + '.' + ext
      : path.parse(file.relativeFilename).name + '.' + ext;
    return path.join(objDir, name);
  }

  /** 链接对象扁平路径（.o/.a 原路径，其余扁平命名；对齐 GetTargetLinkCommands 的 FlatLinkFiles） */
  private linkObjectRelativeFlat(target: BuildTarget, file: ProjectFile): string {
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Object || ft === FileType.StaticLib) return file.relativeFilename;
    return this.objectPathRelativeFlat(target, file);
  }

  /** 链接对象绝对路径（增量判断用） */
  private linkObjectAbs(target: BuildTarget, file: ProjectFile): string {
    const ft = fileTypeOf(file.relativeFilename);
    if (ft === FileType.Object || ft === FileType.StaticLib) {
      return path.isAbsolute(file.relativeFilename)
        ? file.relativeFilename
        : path.join(this.project.basePath, file.relativeFilename);
    }
    return this.objectPathFor(target, file);
  }

  /** 对象扩展名：头文件（PCH）用 .gch，其余用 .o（对齐 projectfile.cpp:245 SetExt(PCHExtension)） */
  private objectExtensionFor(file: ProjectFile): string {
    return fileTypeOf(file.relativeFilename) === FileType.Header
      ? this.compiler.switches.PCHExtension
      : this.compiler.switches.objectExtension;
  }

  /** 为所有待编译单元递归创建对象目录（对应 CreateDirRecursively） */
  private ensureObjectDirs(units: CompileUnit[]): void {
    const dirs = new Set<string>();
    for (const u of units) {
      const objDir = path.dirname(this.objectPathFor(u.target, u.file));
      dirs.add(objDir);
    }
    for (const dir of dirs) {
      // 对象目录失败：debug 日志 + 继续（对齐 GetCompileFileCommand 的 DebugLog，让编译器报真实错误）
      this.ensureDir(dir, 'debug');
    }
  }

  /** 递归创建目录，返回是否成功（失败按级别记录：error = 构建中止点，debug = 对齐 CB DebugLog 继续执行） */
  private ensureDir(dir: string, logLevel: 'debug' | 'error' = 'error'): boolean {
    if (!dir) return true;
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch (e) {
      const msg = `[Code::Blocks] 无法创建目录 ${dir}: ${(e as Error).message}`;
      if (logLevel === 'error') this.output.error(msg);
      else this.output.debug(msg);
      return false;
    }
  }

  private depsPathFor(target: BuildTarget, file: ProjectFile): string {
    // 对齐 pfDetails::Update：depsOut（默认 .deps，GetDepsOutput）+ <对象名>.depend
    const depsOut = target.depsOutput || '.deps';
    const rel = file.relativeToCommonTopLevelPath || file.relativeFilename;
    const name = path.parse(rel).name;
    if (path.isAbsolute(rel)) {
      // 跨卷：depsOut + 卷名 + 去卷目录（与对象路径规则一致，projectfile.cpp:474-492）
      const parsedAbs = path.parse(rel);
      const volLetter = (parsedAbs.root ?? '').replace(/[:\\/]/g, '');
      if (volLetter) {
        const withoutVol = parsedAbs.dir.slice(parsedAbs.root.length);
        return path.join(this.project.basePath, depsOut, volLetter, withoutVol, name + '.depend');
      }
    }
    // 与对象路径一致（含目录），避免不同目录同名文件（a/foo.c、b/foo.c）的 deps 互相覆盖
    return path.join(this.project.basePath, depsOut, path.dirname(rel), name + '.depend');
  }

  /**
   * 并行任务数：显式设置为准；0 = 自动。
   *
   * 自动值 = min(逻辑核数 × 2, 64)（R1，M0 实测，2026-10-08，用户选 64 上限）：
   * 编译单元墙钟远大于其 CPU 占用（gcc→cc1→as 进程链 + Windows 杀软扫描停顿），
   * 按核数并行只能填满线程、大量停顿被浪费；2× 超额订阅把停顿重叠——
   * 大型工程（487 文件/248 单元）全量构建：8 并发 ~70s → 16 并发 ~44s（-35%），
   * 24 并发回退（~52s，开始争抢）。上限 64 与设置范围上限一致；
   * 注意：每个编译进程链常驻几十至几百 MB（巨型 TU 的 cc1 可达 1–2GB），
   * 高核数机器如遇内存紧张/卡顿，请显式指定较小值。
   * （CB 对照：cbthreadpool.cpp:32-39 线程数 ≤0 → wxThread::GetCPUCount()；
   * 本项为保护性性能增强，显式设置值仍优先、可一键回退。）
   */
  private maxJobs(): number {
    const cfg = vscode.workspace.getConfiguration('codeblocks');
    const n = cfg.get<number>('parallelJobs', 0);
    if (n && n > 0) return n;
    const logical = Math.max(1, os.cpus().length || 2);
    return Math.min(logical * 2, 64);
  }

  private async runInParallel(units: CompileUnit[], maxJobs: number, options: BuildOptions, totalCount: number): Promise<(boolean | undefined)[]> {
    const results: (boolean | undefined)[] = new Array(units.length).fill(undefined);
    // 失败即停（对齐 CB OnJobEnd：compilergcc.cpp:4005-4017）——首个失败后不再派发新单元，
    // 已在跑的任务自然结束；undefined = 未派发（不计入失败统计）
    const stop = { stopped: false };
    // 按 weight 分组执行：同 weight 并行，跨 weight 串行（对齐 GetCompileCommands 的 COMPILER_WAIT 屏障）
    let groupStart = 0;
    while (groupStart < units.length && !stop.stopped) {
      let groupEnd = groupStart + 1;
      const w = units[groupStart].file.weight;
      while (groupEnd < units.length && units[groupEnd].file.weight === w) groupEnd++;

      // 组内 PCH 头文件先于其它文件编译（COMPILER_WAIT 屏障语义）
      const group = units.slice(groupStart, groupEnd);
      const pchIdx = group.map((u, i) => (u.isPch ? i : -1)).filter((i) => i >= 0);
      const normalIdx = group.map((u, i) => (!u.isPch ? i : -1)).filter((i) => i >= 0);
      const profGroupT0 = this.prof ? Date.now() : 0;
      await this.runGroupSubset(group, pchIdx, groupStart, maxJobs, options, results, totalCount, stop);
      if (!stop.stopped) {
        await this.runGroupSubset(group, normalIdx, groupStart, maxJobs, options, results, totalCount, stop);
      }
      // M0 探针：权重组墙钟（评估组屏障/尾延迟占用）
      if (this.prof) {
        this.prof.add(`${this.profPrefix}权重组(w=${w}) 墙钟`, Date.now() - profGroupT0);
        this.prof.count(`${this.profPrefix}权重组(w=${w}) 单元数`, groupEnd - groupStart);
      }

      groupStart = groupEnd;
    }
    return results;
  }

  /** 编译一组单元（按 maxJobs 并行），结果写回全局 results（baseGlobalIdx + 组内下标；undefined=未派发） */
  private async runGroupSubset(
    group: CompileUnit[], localIdx: number[], baseGlobalIdx: number,
    maxJobs: number, options: BuildOptions, results: (boolean | undefined)[], totalCount: number,
    stop: { stopped: boolean },
  ): Promise<void> {
    if (!localIdx.length) return;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(maxJobs, localIdx.length) }, async () => {
      while (cursor < localIdx.length) {
        // 取消/失败短路检查点：不再启动新的编译单元（已启动的由 cancel() 强杀或自然完成）
        // 对齐 CB OnJobEnd：失败时 m_CommandQueue.Clear()，in-flight 任务自然结束
        if (stop.stopped || options.cancel?.isCancelled()) break;
        const pos = cursor++;
        const li = localIdx[pos];
        const u = group[li];
        const startMs = Date.now();
        const ok = await this.runCommand(u.command, u.cwd, options, u.respBase);
        const elapsedMs = Date.now() - startMs;
        const elapsedSec = (elapsedMs / 1000).toFixed(1);
        // 详细输出：完整编译命令行（对齐 Code::Blocks clogFull 模式）
        if (this.verboseOutput()) {
          this.output.info(u.command);
        } else {
          this.output.debug(u.command);
        }
        // 单行完成式：无交错、含进度序号与耗时（序号用连字符避免 Output 面板误判为路径链接）
        const idx = baseGlobalIdx + li + 1;
        if (ok) {
          // logging=none 时抑制每文件完成行（对齐 CB clogNone 无 Compiling 行；错误行不受影响）
          if (!buildLogPrefs().plain && this.compiler.switches.logging !== 'none') {
            this.output.info(`✔️ [Compiled] ${idx}-${totalCount} ${u.file.relativeFilename} (${elapsedSec}s)`);
          }
        } else if (options.cancel?.isCancelled()) {
          // 取消导致的失败不是错误：不打印红色 Failed，不参与最慢 Top3 统计
          this.output.warn(`⚠️ [Interrupted] ${idx}-${totalCount} ${u.file.relativeFilename}`);
        } else {
          this.output.error(`✗ [Failed] ${idx}-${totalCount} ${u.file.relativeFilename} (${elapsedSec}s)`);
          stop.stopped = true; // 失败即停：不再派发新单元（对齐 CB 清队列）
        }
        if (ok) {
          this.compileTimings.push({ file: u.file.relativeFilename, ms: elapsedMs });
        }
        results[baseGlobalIdx + li] = ok;
      }
    });
    await Promise.all(workers);
  }

  private async runCommand(command: string, cwd: string, options: BuildOptions, respBase?: string): Promise<boolean> {
    // 多行命令（模板含 \n）逐条执行，对齐 Code::Blocks AddCommandsToArray
    const lines = command.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length <= 1) {
      return this.runSingleCommand(command, cwd, options, respBase);
    }
    let ok = true;
    for (const line of lines) {
      // 取消检查点：多行命令逐行之间
      if (options.cancel?.isCancelled()) {
        ok = false;
        break;
      }
      if (!(await this.runSingleCommand(line, cwd, options, respBase))) ok = false;
    }
    return ok;
  }

  private async runSingleCommand(command: string, cwd: string, options: BuildOptions, respBase?: string): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      // 取消检查点：spawn 前（已取消则不再派生新进程）
      if (options.cancel?.isCancelled()) {
        resolve(false);
        return;
      }
      const resp = applyResponseFile(command, respBase, cwd);
      if (resp.respFile) {
        this.output.debug(`[Code::Blocks] 命令行过长，改用响应文件: ${resp.respFile}`);
      }
      command = resp.command;
      // 第六轮 F8：记录实际执行命令（响应文件改写后，对齐 CB 在队列生成期改写后记录 cmd->command）
      this.lastCommands.push(command);
      // M0 探针：首个 spawn 延迟（目标处理起点 → 第一个子进程实际派生；编译或链接，不含 pre/post 脚本）/ spawn 次数
      if (this.prof) {
        if (!this.profFirstSpawnSeen) {
          this.profFirstSpawnSeen = true;
          this.prof.add(`${this.profPrefix}首编译/链接 spawn 延迟`, Date.now() - this.profTargetStartMs);
        }
        this.prof.count(`${this.profPrefix}spawn 次数`);
      }
      const proc = spawn(command, {
        cwd: upperDrive(cwd),
        shell: true,
        // PATH 前置编译器 bin 目录（对齐 CodeBlocks Init 的 PATH 重构），仅 win32 时已由 build() 计算
        env: this.buildEnv,
      });
      // 注册进取消源：cancel() 时强杀整棵进程树（Windows taskkill /T /F，覆盖 cmd.exe→gcc→cc1/as）
      options.cancel?.register(proc);
      const parser = this.parser;

      // 累积原始字节，命令结束时统一解码（UTF-8 严格优先，回退 GBK），
      // 避免流式分块在「UTF-8 / GBK 多字节字符跨 chunk 边界」时误判编码。
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      const processLines = (text: string) => {
        for (const line of text.split(/\r?\n/)) {
          if (!line) continue;
          const parsed = parser.parseLine(line);
          const severity = parsed?.type === CompilerLineType.Error
            ? 'error' as const
            : parsed?.type === CompilerLineType.Warning ? 'warning' as const : 'info' as const;
          options.onLine?.(line, severity);
          const diag = parser.toDiagnostic(line, cwd);
          if (diag) {
            options.onDiagnostic?.(diag, parser.resolveFileUri(line, cwd));
            this.emitStructuredDiagnostic(line, cwd, options);
          }
        }
      };

      proc.stdout?.on('data', (data: Buffer) => stdoutChunks.push(data));
      proc.stderr?.on('data', (data: Buffer) => stderrChunks.push(data));

      proc.on('close', (code) => {
        options.cancel?.unregister(proc);
        // M0 探针：宿主输出解析耗时 + 输出字节量
        const profParseT0 = this.prof ? Date.now() : 0;
        if (stdoutChunks.length) processLines(decodeText(Buffer.concat(stdoutChunks)));
        if (stderrChunks.length) processLines(decodeText(Buffer.concat(stderrChunks)));
        if (this.prof) {
          let bytes = 0;
          for (const c of stdoutChunks) bytes += c.length;
          for (const c of stderrChunks) bytes += c.length;
          this.prof.count(`${this.profPrefix}输出字节`, bytes);
          this.prof.add(`${this.profPrefix}宿主输出解析`, Date.now() - profParseT0);
        }
        const success = code !== null && code >= 0 && code <= this.compiler.switches.statusSuccess;
        resolve(success);
      });
      proc.on('error', (err) => {
        options.cancel?.unregister(proc);
        this.output.error(`[Code::Blocks] ${msg('无法执行', 'Failed to execute')}: ${err.message}`);
        resolve(false);
      });
    });
  }

  /** 解析一行输出，若为 error/warning 则通过 onStructuredDiagnostic 上报（文件解析为绝对路径） */
  private emitStructuredDiagnostic(line: string, cwd: string, options: BuildOptions): void {
    if (!options.onStructuredDiagnostic) return;
    const parsed = this.parser.parseLine(line);
    if (!parsed) return;
    if (parsed.type !== CompilerLineType.Error && parsed.type !== CompilerLineType.Warning) return;

    // 去掉 message 前缀（error:/warning:/note:/fatal error:），图标已表达严重级别，前缀冗余
    const message = stripMessagePrefix(parsed.message);
    // note 行（如 "note: candidate function"）是错误上下文说明，不作为可导航的独立错误
    if (/^note\b/i.test(message)) return;

    let absFile: string | undefined;
    if (parsed.file) {
      absFile = path.isAbsolute(parsed.file) ? parsed.file : path.join(cwd, parsed.file);
    }
    options.onStructuredDiagnostic({
      severity: parsed.type === CompilerLineType.Error ? 'error' : 'warning',
      message,
      file: absFile,
      line: parsed.line,
      column: parsed.column,
    });
  }

  private async runCommands(commands: string[], cwd: string): Promise<boolean> {
    let ok = true;
    for (const cmd of commands) {
      this.output.info(cmd);
      const r = await this.runCommand(cmd, cwd, {});
      if (!r) ok = false;
    }
    return ok;
  }
}

/** 去掉诊断消息开头的严重级别前缀（error:/warning:/note:/fatal error: 等），图标已表达级别 */
function stripMessagePrefix(message: string): string {
  return message
    .replace(/^error:\s*/i, '')
    .replace(/^warning:\s*/i, '')
    .replace(/^note:\s*/i, '')
    .replace(/^fatal error:\s*/i, '')
    .trim();
}
