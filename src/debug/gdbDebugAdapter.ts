/**
 * DAP 调试适配器（内联实现）—— 对应 debuggergdb/gdb_driver.cpp 的驱动角色
 *
 * 实现 Debug Adapter Protocol，内部直接驱动 GDB MI（GdbMiSession）。
 * 不使用 launch.json 预配置，也不依赖 cppdbg/CodeLLDB。
 */
import * as vscode from 'vscode';
import { GdbMiSession, MiResult, MiAsync } from './gdbMiSession';
import {
  AsmInsn, base64ToHex, breakpointLocation, hexToBase64, isExitReason, isPendingBreakpoint,
  logpointExpressions, mapStopReason, parseCatchpoints, parseDisassemble, parseInstructionReference,
  parseQuotedList, parseReadMemory, parseRegisterValues, parseStackFrameTuples, parseThreadTuples,
  pointerMemoryReference, selectWindow, truthyMiValue,
} from './miParse';
import { debugStateChanged, debugTrace, registerAdapter, unregisterAdapter } from './debugRegistry';
import { RemoteDebuggingOptions } from '../model/projectDebuggerExtensions';
import { buildRemoteDebugCommands, buildSourceDirCommands, splitCommandLineArgs } from './remoteDebugging';

/** 截断超长跟踪文本 */
function truncate(s: string, n = 300): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/** 断点缓存 */
interface BpInfo {
  line: number;
  gdbNum?: string; // GDB 分配的断点编号
  verified: boolean;
  condition?: string; // 条件断点表达式
}

/** DAP 消息（自定义最小类型，替代 @vscode/debugadapter 的 DebugProtocol） */
interface DapRequest {
  type: 'request';
  seq: number;
  command: string;
  arguments?: any;
}

interface DapMessage {
  type: string;
  seq: number;
}

/** DAP 变量 */
interface DapVariable {
  name: string;
  value: string;
  type?: string;
  variablesReference: number;
  /** 指针变量的目标地址（第四十九轮：Memory 视图「查看二进制数据」用） */
  memoryReference?: string;
}

/** GDB MI varobj 子节点（-var-list-children 返回的 child 元组） */
interface ChildVar {
  name: string;      // varobj 名，如 "var_1.a"
  exp: string;       // 表达式，如 "a"
  numchild: number;
  type: string;
  value: string;
}

/** 本地变量作用域的 variablesReference 基址（+frameId，第五十轮 D8） */
const LOCALS_REF_BASE = 100000;

/**
 * P3：DAP 帧 id 编码基数（frameId = threadId * FRAME_ID_BASE + level）。
 * 多线程下不同线程的帧 level 会重复，帧 id 必须全局唯一才能让 scopes/variables
 * 在「指定线程的指定帧」下取值（-thread-select + -stack-select-frame 双步定位）。
 */
const FRAME_ID_BASE = 1000000;

/**
 * C-01：stopOnEntry 的用户入口符号候选（按序尝试）。
 * Windows GUI 程序（`-mwindows`）的 `main` 是 MinGW CRT 桩符号（无源码行、永不命中），
 * 其真实入口是 `WinMain`；W 版 Unicode 入口为 `wWinMain`。
 */
const ENTRY_SYMBOL_CANDIDATES = ['main', 'WinMain', 'wWinMain'] as const;

/** D-03：全局作用域内联取值的变量数上限（超出者只显示名称/类型，避免逐条 -var-create 卡顿） */
const GLOBALS_INLINE_VALUE_MAX = 60;

/** D-03：解析 `info variables` 的 console 输出，丢弃工具链/运行库符号，最多返回 cap 项 */
function parseInfoVariablesOutput(text: string, cap: number): { name: string; type: string }[] {
  const out: { name: string; type: string }[] = [];
  let skipFile = false;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const file = line.match(/^File (.+):$/);
    if (file) { skipFile = isToolchainSource(file[1]); continue; }
    if (skipFile) continue;
    // 变量行形如 "int g_counter;"（GDB 8.1 无行号前缀；部分版本为 "12:\tint x;"）
    const m = line.match(/^(?:\d+:\s+)?(.+?)\s+([A-Za-z_][A-Za-z0-9_]*)\s*;$/);
    if (!m) continue;
    const name = m[2];
    if (name.startsWith('__')) continue;
    out.push({ name, type: m[1].trim() });
    if (out.length >= cap) break;
  }
  return out;
}

/** 工具链/运行库源文件（其全局符号不属于被测程序） */
function isToolchainSource(file: string): boolean {
  const norm = file.replace(/\\/g, '/');
  if (/(^|\/)(gcc|gcc-[0-9.]+|libexec|sysroot|mingw[^/]*|w64-mingw32|libstdc\+\+-v3|clang[^/]*|llvm[^/]*)(\/|$)/i.test(norm)) return true;
  return /(^|\/)(crtstuff|crtbegin|crtend|libgcc|libgcc2|libmingwex|libmoldname|msvcrt|emutls|pseudo-reloc)[^/]*$/i.test(norm);
}

export class GdbDebugAdapter implements vscode.DebugAdapter {
  private session: GdbMiSession | null = null;
  private emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  private seq = 0;
  private breakpoints = new Map<string, BpInfo[]>(); // source path -> breakpoints
  private functionBreakpoints = new Map<string, BpInfo[]>(); // function name -> breakpoints
  private threads: { id: number; name: string }[] = [];
  private stackFrames: { id: number; name: string; file?: string; line?: number; addr?: string }[] = [];
  private gdbPath = 'gdb';
  private program = '';
  private cwd = '';
  // R3/R4：调试器源目录与远程目标（来自工程 Extensions/debugger，经扩展展开后随 launch 传入）
  private searchDirs: string[] = [];
  private remote: RemoteDebuggingOptions | undefined;
  private isRemoteDebugging = false;
  // varobj 引用管理（子节点展开）
  private varSeq = 0;                                  // 生成 varobj 名
  private varRefCounter = 10000;                       // 生成 variablesReference
  private varNameToRef = new Map<string, number>();
  private varRefToName = new Map<number, string>();
  // D-03：程序全局变量枚举缓存 + 内部命令 console 输出捕获
  private globalVarsCache: { name: string; type: string }[] | null = null;
  private consoleCapture: string[] | null = null;
  // 第四十九轮：数据断点 / 异常断点 / 附加 / 停驻状态 / 寄存器缓存
  private dataBreakpoints: { dataId: string; gdbNum?: string }[] = [];
  private catchpointNums: string[] = [];
  // D-04：catchpoint 编号 → 过滤器（throw/catch），用于异常停止描述
  private catchpointFilters = new Map<string, string>();
  private attached = false;
  private stoppedState = false;
  /**
   * P3 运行中防护：目标正在运行（-exec-run/-exec-continue/-exec-step 等已成功下发且未收到 *stopped）。
   * 本机 MinGW GDB 8.1 在运行时不响应**任何**同步 MI 命令（实测 -thread-info / -break-insert /
   * -data-evaluate-expression 全部无回执至 30s 超时）⇒ 此类请求必须快速返回而非悬挂等待。
   */
  private targetRunning = false;
  /** C-01：launch 的 stopOnEntry（DAP 标准参数）——运行前插入入口临时断点以实现首停 */
  private stopOnEntry = false;
  /** C-01：入口临时断点编号（符号或入口地址；命中后映射为 DAP reason=entry） */
  private entryBpNum: string | null = null;
  /** C-01：入口断点的落点说明（符号名或入口地址），用于 `*stopped` 描述 */
  private entryStopLabel = '';
  /** 当前 GDB 选中线程（-thread-select 维护；供多线程帧/变量与 stackTrace(threadId) 使用） */
  private currentThreadId = 0;
  private regNamesCache: string[] | null = null;
  // 第五轮批次二 D1/D2：分离状态 + 已加载库缓存（=library-loaded；Add symbol file 地址预填数据源）
  private detached = false;
  private loadedLibs: { name: string; from?: string }[] = [];
  // 第五十轮：会话结束标记 / 日志断点消息表
  private ended = false;
  /** D-05：适配器已销毁（销毁后屏蔽一切 DAP 消息） */
  private disposed = false;
  private logpoints = new Map<string, string>();
  // 第五十轮修复 9：条件断点客户端求值表（本机 GDB 8.1 命中带条件断点会崩溃，不再下发 -break-condition）
  private bpConditions = new Map<string, string>();
  // 第五十轮修复 8：Step Out 的「调用者返回地址」临时断点编号（-exec-finish 在本机 GDB 8.1 上会崩溃）
  private stepOutBpNum: string | null = null;
  // 第五十一轮 E1：指令断点（反汇编视图；`-break-insert *ADDR`）
  private instructionBreakpoints: { gdbNum?: string; verified: boolean }[] = [];
  // 第五十一轮 E3：VS Code 调试会话 id（多会话路由；直构/测试场景可省略）
  private sessionId?: string;

  constructor(sessionId?: string) {
    this.sessionId = sessionId;
  }

  onDidSendMessage = this.emitter.event;

  handleMessage(message: vscode.DebugProtocolMessage): void {
    const msg = message as DapRequest;
    if (msg.type === 'request') debugTrace(`[DAP <<] ${msg.command} ${truncate(JSON.stringify(msg.arguments ?? {}))}`);
    switch (msg.command) {
      case 'initialize': this.onInitialize(msg); break;
      case 'launch': this.onLaunch(msg); break;
      case 'attach': this.onAttach(msg); break;
      case 'setBreakpoints': this.onSetBreakpoints(msg); break;
      case 'setFunctionBreakpoints': this.onSetFunctionBreakpoints(msg); break;
      case 'setVariable': this.onSetVariable(msg); break;
      case 'configurationDone': this.onConfigurationDone(msg); break;
      case 'threads': this.onThreads(msg); break;
      case 'stackTrace': this.onStackTrace(msg); break;
      case 'scopes': this.onScopes(msg); break;
      case 'variables': this.onVariables(msg); break;
      case 'continue': this.onContinue(msg); break;
      case 'next': this.onStep(msg, '-exec-next', '-exec-next-instruction'); break;
      case 'stepIn': this.onStep(msg, '-exec-step', '-exec-step-instruction'); break;
      case 'stepOut': this.onStepOut(msg); break;
      case 'pause': this.onPause(msg); break;
      case 'evaluate': this.onEvaluate(msg); break;
      case 'disassemble': this.onDisassemble(msg); break;
      case 'readMemory': this.onReadMemory(msg); break;
      case 'writeMemory': this.onWriteMemory(msg); break;
      case 'dataBreakpointInfo': this.onDataBreakpointInfo(msg); break;
      case 'setDataBreakpoints': this.onSetDataBreakpoints(msg); break;
      case 'setInstructionBreakpoints': this.onSetInstructionBreakpoints(msg); break;
      case 'gotoTargets': this.onGotoTargets(msg); break;
      case 'goto': this.onGoto(msg); break;
      case 'setExceptionBreakpoints': this.onSetExceptionBreakpoints(msg); break;
      case 'modules': this.onModules(msg); break;
      case 'loadedSources': this.onLoadedSources(msg); break;
      case 'terminate': this.onTerminate(msg); break;
      case 'disconnect': this.onDisconnect(msg); break;
      default:
        this.sendResponse(msg, true, {});
    }
  }

  dispose(): void {
    this.disposed = true;
    // D-05：先摘除 GDB 回调，避免会话结束后的输出/退出事件继续推送 DAP 消息
    if (this.session) {
      this.session.onAsyncRecord = null;
      this.session.onConsole = null;
      this.session.onLog = null;
      this.session.onTargetOutput = null;
      this.session.onExit = null;
      this.session.dispose();
    }
    this.session = null;
    this.emitter.dispose();
    // 第五十一轮 E3：注销本会话（多会话时不影响其它会话的注册）
    unregisterAdapter(this.sessionId, this);
  }

  // ---- 公共访问（寄存器视图 / 调试辅助命令用，第四十九轮） ----
  isActive(): boolean { return this.session !== null; }
  isStopped(): boolean { return this.stoppedState; }
  /** 是否附加到外部进程（对齐 CB IsAttachedToProcess；D1 Detach 的 UI 依据） */
  isAttached(): boolean { return this.attached; }
  /** 是否已从被调试进程分离（D1） */
  isDetached(): boolean { return this.detached; }
  /** 已加载库列表（=library-loaded 缓存；D2 Add symbol file 地址预填） */
  loadedLibraries(): { name: string; from?: string }[] { return [...this.loadedLibs]; }

  /** 读取全部寄存器（名 + 十六进制值；对齐 CB cpuregistersdlg） */
  async registerValues(): Promise<{ name: string; value: string }[]> {
    if (!this.session) return [];
    if (!this.regNamesCache) {
      try {
        const rn = await this.session.sendExact('-data-list-register-names');
        this.regNamesCache = parseQuotedList(rn.attrs['register-names'] ?? '');
      } catch { this.regNamesCache = []; }
    }
    const r = await this.session.sendExact('-data-list-register-values x');
    const vals = parseRegisterValues(r.attrs['register-values'] ?? '');
    return vals.map((v) => ({ name: this.regNamesCache![v.number] ?? String(v.number), value: v.value }));
  }

  /** Send user command：MI（- 开头）原样执行；否则按 GDB CLI 执行（对齐 CB Debug → Send user command） */
  async sendUserCommand(text: string): Promise<string> {
    if (!this.session) throw new Error('调试会话未启动');
    const t = text.trim();
    if (!t) return '';
    const line = t.startsWith('-') ? t : `-interpreter-exec console ${this.session.quote(t)}`;
    const r = await this.session.sendExact(line);
    this.sendOutput('console', r.raw);
    return r.raw;
  }

  /** Set next statement（GDB jump file:line） */
  async setNextStatement(file: string, line: number): Promise<void> {
    if (!this.session) throw new Error('调试会话未启动');
    const r = await this.session.sendExact(`-interpreter-exec console ${this.session.quote(`jump ${file}:${line}`)}`);
    this.sendOutput('console', r.raw);
  }

  /**
   * Detach：从被调试进程分离（第五轮批次二 D1）。
   * 对齐 CB：Debug → Detach → Drive()->Detach()（debuggergdb.cpp:2486-2491）
   * → GdbCmd_Detach（gdb_commands.h:354-375，CLI `detach`）。
   * MI 等价命令 `-target-detach`；已实测（GDB 8.1）：attach 与 launch 两种会话均可用，
   * 分离后被调试进程**继续运行**，会话结束（attach 为 CB 语义，launch 为保护性扩展）。
   */
  async detach(): Promise<void> {
    if (!this.session) throw new Error('调试会话未启动');
    if (this.detached) return;
    const r = await this.session.sendExact('-target-detach');
    this.sendOutput('console', r.raw);
    this.detached = true;
    this.stoppedState = false;
    this.targetRunning = false;
    if (!this.ended) {
      this.ended = true;
      this.sendEvent('terminated', {});
    }
    this.dispose();
    debugStateChanged.fire();
  }

  /**
   * Add symbol file：运行时加载附加符号（第五轮批次二 D2）。
   * CB 菜单项存在但实现被注释（debuggergdb.cpp:1794 `// TODO: should reimplement`，:1807 入队命令被注释），
   * 且原命令类未带地址参数（gdb_commands.h:268-291）；已实测 GDB 8.1 无地址必失败：
   * `The address where <file> has been loaded is missing`。
   * 本实现为**可用版**（保护性差异）：地址必填 + 输出写 Debug Console。
   */
  async addSymbolFile(file: string, address?: string): Promise<string> {
    if (!this.session) throw new Error('调试会话未启动');
    const f = file.trim();
    const a = (address ?? '').trim();
    if (!f) throw new Error('未指定符号文件');
    if (!a) throw new Error('需要 .text 加载地址（GDB 对 add-symbol-file 要求地址参数；可从「已加载库」列表取）');
    if (!/^0x[0-9a-f]+$/i.test(a) && !/^\d+$/.test(a)) throw new Error(`地址格式无效: ${a}`);
    const r = await this.session.sendExact(
      `-interpreter-exec console ${this.session.quote(`add-symbol-file ${this.session.quote(f)} ${a}`)}`,
    );
    this.sendOutput('console', r.raw);
    return r.raw;
  }

  // ---- 响应/事件辅助 ----
  private sendResponse(req: DapRequest, success: boolean, body: any, message?: string): void {
    // D-05：会话销毁后不再推送任何 DAP 消息（VS Code 已释放该会话）
    if (this.disposed) return;
    debugTrace(`[DAP >>] resp ${req.command} ok=${success}${message ? ' msg=' + message : ''}`);
    this.emitter.fire({
      type: 'response',
      seq: ++this.seq,
      command: req.command,
      request_seq: req.seq,
      success,
      message,
      body,
    } as vscode.DebugProtocolMessage);
  }

  private sendEvent(event: string, body: any): void {
    if (this.disposed) return; // D-05
    debugTrace(`[DAP >>] event ${event} ${truncate(JSON.stringify(body ?? {}))}`);
    this.emitter.fire({
      type: 'event',
      seq: ++this.seq,
      event,
      body,
    } as vscode.DebugProtocolMessage);
  }

  private sendOutput(category: string, output: string): void {
    this.sendEvent('output', { category, output: output + '\n' });
  }

  // ---- P3 运行中请求防护（GDB 8.1 运行时不响应同步 MI） ----

  /** 运行中降级结果的统一中文说明（响应 message，便于用户与测试识别） */
  private static readonly RUNNING_HINT =
    '程序正在运行：GDB 不响应同步 MI 请求（本机 GDB 8.1 限制），已返回缓存/占位结果而非等待超时';

  /**
   * 请求在目标运行期间无法经 MI 完成时立即回失败响应（避免 DAP 请求悬挂 30s）。
   * @returns true = 已响应（调用方应当 return）；false = 目标已停止，按原流程处理
   */
  private rejectWhileRunning(req: DapRequest, what: string): boolean {
    if (!this.session || !this.targetRunning) return false;
    this.sendResponse(req, false, {},
      `${what}不可用：程序正在运行，GDB 不响应同步 MI 请求（本机 GDB 8.1 限制）；请先命中断点或暂停后再试`);
    return true;
  }

  /** 切到指定线程（多线程帧/变量语义；已是当前线程则不产生 MI 往返） */
  private async selectThread(threadId: number): Promise<void> {
    if (!this.session || !threadId || threadId === this.currentThreadId) return;
    await this.session.sendExact(`-thread-select ${threadId}`);
    this.currentThreadId = threadId;
  }

  // ---- DAP 处理器 ----
  private async onInitialize(req: DapRequest): Promise<void> {
    this.sendResponse(req, true, {
      supportsConfigurationDoneRequest: true,
      supportsEvaluateForHovers: true,
      supportsSetVariable: true,
      supportsConditionalBreakpoints: true,
      supportsFunctionBreakpoints: true,
      supportsTerminateRequest: true,
      // 第四十九轮：VS Code 原生窗口/能力（反汇编/内存/数据断点/指令步进/命中与日志/异常过滤）
      supportsDisassembleRequest: true,
      supportsReadMemoryRequest: true,
      supportsWriteMemoryRequest: true,
      supportsDataBreakpoints: true,
      supportsInstructionBreakpoints: true, // 第五十一轮 E1：反汇编视图指令断点
      supportsSteppingGranularity: true,
      supportsHitConditionalBreakpoints: true,
      supportsLogPoints: true,
      // 模块 / 已加载源文件视图（DAP：客户端仅在能力为 true 时才发对应请求）
      supportsModulesRequest: true,
      supportsLoadedSourcesRequest: true,
      exceptionBreakpointFilters: [
        { filter: 'throw', label: 'C++ 抛出异常（throw）', default: false },
        { filter: 'catch', label: 'C++ 捕获异常（catch）', default: false },
      ],
    });
  }

  private async onLaunch(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    this.gdbPath = args.gdbPath ?? 'gdb';
    this.program = args.program ?? '';
    this.cwd = args.cwd ?? '';

    if (!this.program) {
      this.sendResponse(req, false, {}, '未指定调试程序');
      return;
    }

    this.attached = false;
    this.detached = false;
    this.loadedLibs = [];
    this.targetRunning = false;
    // C-01：stopOnEntry（VS Code launch.json 标准参数，运行前在 main 插临时断点实现首停）
    this.stopOnEntry = args.stopOnEntry === true;
    this.entryBpNum = null;
    this.currentThreadId = 0;
    this.searchDirs = Array.isArray(args.searchDirs) ? (args.searchDirs as unknown[]).filter((d): d is string => typeof d === 'string' && !!d) : [];
    this.remote = (args.remoteDebugging as RemoteDebuggingOptions) ?? undefined;
    this.isRemoteDebugging = false;
    this.openSession();
    try {
      await this.session!.start({
        gdbPath: this.gdbPath,
        program: this.program,
        cwd: this.cwd,
        env: (args.environment as Record<string, string>) ?? {},
        // R5：GDB 命令行附加参数（对齐 CB debugger settings user arguments）
        args: splitCommandLineArgs(String(vscode.workspace.getConfiguration('codeblocks').get<string>('debug.userArguments', '') ?? '')),
        // 第六轮 F5：-nx 不执行用户启动脚本（对齐 CB disable_init 默认 true；gdb_driver.cpp:104/127 launch+attach 均传）
        nx: vscode.workspace.getConfiguration('codeblocks').get<boolean>('debug.disableInit', true),
      });
      // 程序与参数经 MI 注入（Windows 命令行空格安全，第五十轮修复）
      await this.session!.sendExact(`-file-exec-and-symbols ${this.session!.quote(this.program)}`);
      const progArgs = Array.isArray(args.args) ? (args.args as string[]) : [];
      if (progArgs.length) {
        await this.session!.sendExact(`-exec-arguments ${this.session!.quote(progArgs.join(' '))}`);
      }
      await this.applyDebugSettings();
      // R3/R4：源目录搜索 + 远程目标准备（对齐 Prepare：init → 源目录 → set args → 远程连接）
      await this.applySourceDirs();
      await this.applyRemotePrepare();
      this.sendResponse(req, true, {});
      // 会话就绪后再告知客户端可以下发配置（断点等，第五十轮 D10）
      this.sendEvent('initialized', {});
    } catch (err) {
      // D-05：先回失败响应再销毁（销毁后适配器不再推送消息）
      this.sendResponse(req, false, {}, `GDB 启动失败: ${(err as Error).message}`);
      this.dispose();
    }
  }

  /** 附加到运行中进程（对齐 CB Attach to process；-target-attach） */
  private async onAttach(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    const pid = args.pid ?? args.processId;
    if (!pid) {
      this.sendResponse(req, false, {}, '未指定进程号');
      return;
    }
    this.gdbPath = args.gdbPath ?? 'gdb';
    this.program = args.program ?? '';
    this.cwd = args.cwd ?? '';
    this.attached = true;
    this.detached = false;
    this.loadedLibs = [];
    this.targetRunning = false;
    // C-01：DAP 的 stopOnEntry 仅定义于 launch 请求——附加目标已在运行，无「入口」首停语义
    this.stopOnEntry = false;
    this.entryBpNum = null;
    if (args.stopOnEntry === true) {
      this.sendOutput('console', '提示：附加会话不支持 stopOnEntry（目标进程已在运行，无入口首停语义）');
    }
    this.currentThreadId = 0;
    this.searchDirs = Array.isArray(args.searchDirs) ? (args.searchDirs as unknown[]).filter((d): d is string => typeof d === 'string' && !!d) : [];

    this.openSession();
    try {
      await this.session!.start({
        gdbPath: this.gdbPath,
        cwd: this.cwd,
        env: (args.environment as Record<string, string>) ?? {},
        // R5：GDB 命令行附加参数（对齐 CB debugger settings user arguments）
        args: splitCommandLineArgs(String(vscode.workspace.getConfiguration('codeblocks').get<string>('debug.userArguments', '') ?? '')),
        // 第六轮 F5：-nx 不执行用户启动脚本（对齐 CB disable_init 默认 true；gdb_driver.cpp:104/127 launch+attach 均传）
        nx: vscode.workspace.getConfiguration('codeblocks').get<boolean>('debug.disableInit', true),
      });
      // 可选符号文件（附加前加载；失败不阻断，可用 Send user command 手动 add-symbol-file）
      if (this.program) {
        try { await this.session!.sendExact(`-file-exec-and-symbols ${this.session!.quote(this.program)}`); } catch { /* 符号可选 */ }
      }
      // R3：源目录搜索在连接目标前注入（对齐 CB Prepare 顺序）
      await this.applySourceDirs();
      await this.session!.sendExact(`-target-attach ${pid}`);
      await this.applyDebugSettings();
      this.sendResponse(req, true, {});
      this.sendEvent('initialized', {});
    } catch (err) {
      // D-05：先回失败响应再销毁（销毁后适配器不再推送消息）
      this.sendResponse(req, false, {}, `附加进程失败: ${(err as Error).message}`);
      this.dispose();
    }
  }

  /** 建立会话与回调（launch/attach 共用） */
  private openSession(): void {
    this.session = new GdbMiSession(vscode.workspace.getConfiguration('codeblocks').get<number>('gdbTimeoutMs', 30000));
    this.session.onAsyncRecord = (rec) => this.handleAsync(rec);
    this.globalVarsCache = null; // D-03：新会话重新枚举全局变量
    this.session.onConsole = (t) => {
      // D-03：捕获窗口内的 console 输出供适配器内部解析（如 info variables），不转发给客户端
      if (this.consoleCapture) { this.consoleCapture.push(t); return; }
      this.sendOutput('console', t);
    };
    this.session.onLog = (t) => this.sendOutput('console', t);
    this.session.onTargetOutput = (t) => this.sendOutput('stdout', t);
    this.session.onExit = (code) => {
      if (!this.ended) {
        this.ended = true;
        // 第五十轮修复 6：GDB 异常退出时给出可读诊断（如读取寄存器导致 0xC0000005 崩溃）
        if (code !== null && code !== 0) {
          const crash = code === 3221225477 ? '，0xC0000005 访问违规' : '';
          this.sendOutput('stderr', `GDB 进程异常退出（退出码 ${code}${crash}）。若刚启用过 codeblocks.debug.registers，请关闭后重试`);
        }
        this.sendEvent('exited', { exitCode: code ?? 0 });
      }
      this.sendEvent('terminated', {});
    };
    // 第五十一轮 E3：注册本会话（多会话时聚焦会话优先、最近会话兜底）
    registerAdapter(this.sessionId, this);
  }

  /** 调试器设置注入（对齐 CB debuggersettingsdlg 子集） */
  private async applyDebugSettings(): Promise<void> {
    if (!this.session) return;
    const cfg = vscode.workspace.getConfiguration('codeblocks');
    const pretty = cfg.get<boolean>('debug.printPretty', false);
    const elements = cfg.get<number>('debug.printElements', 0);
    const flavor = cfg.get<string>('debug.disassemblyFlavor', 'default');
    const charset = cfg.get<string>('debug.charset', '');
    const init = cfg.get<string[]>('debug.initCommands', []) ?? [];
    const instructionSet = String(cfg.get<string>('debug.instructionSet', '') ?? '').trim();

    const sends: string[] = [
      // R5：对齐 gdb_driver.cpp:145-174 Prepare 的固定初始化命令（老 GDB 不支持的项单项失败并被忽略）
      '-gdb-set confirm off',
      '-gdb-set width 0',
      '-gdb-set height 0',
      '-gdb-set breakpoint pending on',
      '-gdb-set print asm-demangle on',
      '-gdb-set unwindonsignal on',
      '-gdb-set filename-display absolute',
      '-gdb-set style enabled off',
      // 异步模式（对齐其它 MI 前端）：让 Pause/-exec-interrupt 在支持的 GDB 上生效；老版 GDB 不支持则忽略
      '-gdb-set mi-async on',
      `-gdb-set print pretty ${pretty ? 'on' : 'off'}`,
    ];
    if (elements > 0) sends.push(`-gdb-set print elements ${Math.floor(elements)}`);
    if (flavor === 'intel' || flavor === 'att') sends.push(`-gdb-set disassembly-flavor ${flavor}`);
    else if (flavor === 'custom' && instructionSet) sends.push(`-gdb-set disassembly-flavor ${instructionSet}`);
    if (charset) sends.push(`-gdb-set charset ${charset}`);
    for (const s of sends) {
      try { await this.session.sendExact(s); } catch { /* 单条失败不致命 */ }
    }
    for (const cmd of init) {
      if (!cmd || !cmd.trim()) continue;
      try { await this.session.sendExact(`-interpreter-exec console ${this.session.quote(cmd)}`); } catch { /* 忽略 */ }
    }
  }

  /**
   * R3：源目录搜索（对齐 debuggergdb AddSourceDir → GDB `directory` 命令；单个失败不致命）。
   */
  private async applySourceDirs(): Promise<void> {
    if (!this.session || !this.searchDirs.length) return;
    for (const cmd of buildSourceDirCommands(this.searchDirs)) {
      try {
        await this.session.sendExact(`-interpreter-exec console ${this.session.quote(cmd)}`);
      } catch { /* 单个目录失败不致命 */ }
    }
  }

  /**
   * R4：远程目标准备（对齐 gdb_driver.cpp:141-260 Prepare 固定顺序）：
   * additional_cmds_before → shell before → set remotebaud（串口）→ target [extended-]remote
   * → additional_cmds → shell after；连接后由 configurationDone 以 continue 启动。
   */
  private async applyRemotePrepare(): Promise<void> {
    if (!this.session || !this.remote) return;
    const steps = buildRemoteDebugCommands(this.remote);
    if (!steps.length) return;
    this.isRemoteDebugging = true;
    for (const step of steps) {
      const cli = step.kind === 'shell' ? `shell ${step.command}` : step.command;
      try {
        await this.session.sendExact(`-interpreter-exec console ${this.session.quote(cli)}`);
      } catch (err) {
        // 连接失败等必须可见（对齐 CB GdbCmd_RemoteTarget ParseOutput 的提示路径）
        this.sendOutput('stderr', `远程调试命令失败（${cli}）: ${(err as Error).message}`);
      }
    }
  }

  private async onSetBreakpoints(req: DapRequest): Promise<void> {
    const args = (req as any).arguments;
    const sourcePath: string = args.source?.path ?? '';
    const requested: { line: number; condition?: string; hitCondition?: string; logMessage?: string }[] = args.breakpoints ?? [];
    if (!this.session || !sourcePath) {
      this.sendResponse(req, true, { breakpoints: requested.map((b) => ({ verified: false, line: b.line })) });
      return;
    }
    // P3 运行中防护：运行时不响应 -break-insert（同步 MI 无回执）→ 立即返回「未解析」占位，
    // 不改动断点表（保留旧断点编号以便后续删除），用户暂停后重设即可生效
    if (this.targetRunning) {
      this.sendResponse(req, true, {
        breakpoints: requested.map((b) => ({
          verified: false,
          line: b.line,
          message: '程序正在运行：断点未下发给 GDB（运行时不响应同步 MI 请求），请在暂停后重新设置',
        })),
      }, GdbDebugAdapter.RUNNING_HINT);
      return;
    }

    // 清除该文件的旧断点（按编号逐个删除；同步清理条件/日志表）
    const old = this.breakpoints.get(sourcePath) ?? [];
    for (const bp of old) {
      if (bp.gdbNum) {
        try { await this.session.sendMi('-break-delete', {}, [bp.gdbNum]); } catch { /* ignore */ }
        this.bpConditions.delete(bp.gdbNum);
        this.logpoints.delete(bp.gdbNum);
      }
    }

    const result: BpInfo[] = [];
    for (const br of requested) {
      const line = br.line;
      const condition = br.condition;
      const bp: BpInfo = { line, verified: false, condition };
      try {
        // 第五十轮修复 3：位置串 `文件:行号`（旧 `-f 路径 -l 行号` 为非法 MI，断点从未插入）
        const location = breakpointLocation(sourcePath, line);
        let r: MiResult;
        try {
          r = await this.session.sendExact(`-break-insert ${this.session.quote(location)}`);
        } catch {
          // 源码不在已加载调试信息中 → 退化为 pending 断点（共享库/延迟加载场景）
          r = await this.session.sendExact(`-break-insert -f ${this.session.quote(location)}`);
        }
        // MI 结果：^done,bkpt={number="1",...}
        bp.gdbNum = r.attrs['bkpt'] ? this.extractField(r.attrs['bkpt'], 'number') : undefined;
        bp.verified = r.attrs['bkpt'] ? !isPendingBreakpoint(r.attrs['bkpt']) : false;
        // 第五十轮修复 9：条件断点**不**下发 `-break-condition`（本机 GDB 8.1 命中带条件断点
        // 必崩溃，已实证：条件内容无关、无条件正常、-data-evaluate-expression 手工求值正常）；
        // 改为命中时客户端求值：不成立则自动继续（同日志断点机制）
        if (bp.gdbNum && condition) this.bpConditions.set(bp.gdbNum, condition);
        // 命中次数（Hit Count）：DAP 语义「第 N 次命中时停」→ GDB ignore count = N-1
        const hit = br.hitCondition ? parseInt(String(br.hitCondition).replace(/[^\d]/g, ''), 10) : NaN;
        if (bp.gdbNum && Number.isFinite(hit) && hit > 1) {
          try { await this.session.sendExact(`-break-after ${bp.gdbNum} ${hit - 1}`); } catch { /* 不致命 */ }
        }
        // 日志断点：记录消息，命中时打印并自动继续（第五十轮 D4）
        if (bp.gdbNum && br.logMessage) this.logpoints.set(bp.gdbNum, String(br.logMessage));
      } catch {
        bp.verified = false;
      }
      result.push(bp);
    }
    this.breakpoints.set(sourcePath, result);
    this.sendResponse(req, true, {
      breakpoints: result.map((b) => ({
        verified: b.verified,
        line: b.line,
        message: b.verified ? undefined : '断点未解析（源码不在已加载的调试信息中）',
      })),
    });
  }

  /** 设置函数断点（-break-insert 函数名，可选条件） */
  private async onSetFunctionBreakpoints(req: DapRequest): Promise<void> {
    const args = (req as any).arguments;
    const requested: { name: string; condition?: string }[] = args.breakpoints ?? [];
    if (!this.session) {
      this.sendResponse(req, true, { breakpoints: requested.map(() => ({ verified: false })) });
      return;
    }
    // P3 运行中防护：同 onSetBreakpoints（-break-insert 运行中无回执）
    if (this.targetRunning) {
      this.sendResponse(req, true, {
        breakpoints: requested.map(() => ({
          verified: false,
          message: '程序正在运行：函数断点未下发给 GDB（运行时不响应同步 MI 请求），请在暂停后重新设置',
        })),
      });
      return;
    }

    // 清除旧函数断点（同步清理条件表）
    for (const list of this.functionBreakpoints.values()) {
      for (const bp of list) {
        if (bp.gdbNum) {
          try { await this.session.sendMi('-break-delete', {}, [bp.gdbNum]); } catch { /* ignore */ }
          this.bpConditions.delete(bp.gdbNum);
        }
      }
    }
    this.functionBreakpoints.clear();

    const result: { verified: boolean }[] = [];
    for (const br of requested) {
      const name = br.name;
      let verified = false;
      if (name) {
        try {
          const r = await this.session.sendMi('-break-insert', {}, [name]);
          const gdbNum = r.attrs['bkpt'] ? this.extractField(r.attrs['bkpt'], 'number') : undefined;
          verified = true;
          // 条件断点：客户端求值（同文件断点，第五十轮修复 9——不下发 -break-condition）
          if (gdbNum && br.condition) this.bpConditions.set(gdbNum, br.condition);
          if (gdbNum) {
            let list = this.functionBreakpoints.get(name);
            if (!list) { list = []; this.functionBreakpoints.set(name, list); }
            list.push({ line: 0, gdbNum, verified: true, condition: br.condition });
          }
        } catch {
          verified = false;
        }
      }
      result.push({ verified });
    }
    this.sendResponse(req, true, { breakpoints: result });
  }

  /** 修改变量值：-var-create 临时 varobj + -var-assign + -var-delete */
  private async onSetVariable(req: DapRequest): Promise<void> {
    const args = (req as any).arguments;
    const ref: number = args.variablesReference ?? 0;
    const name: string = args.name ?? '';
    const value: string = args.value ?? '';
    if (this.rejectWhileRunning(req, '变量修改')) return;
    if (!this.session || !name) {
      this.sendResponse(req, false, {}, '未提供变量名');
      return;
    }

    try {
      await this.ensureFrame(ref);
      if (ref === 2000 || ref >= LOCALS_REF_BASE) {
        // 顶层变量：临时 varobj 赋值
        const tmp = `var_${++this.varSeq}`;
        try {
          await this.session.sendMi('-var-create', {}, [tmp, '@', name]);
          await this.session.sendMi('-var-assign', {}, [tmp, value]);
          this.sendResponse(req, true, { value });
        } finally {
          try { await this.session.sendMi('-var-delete', {}, [tmp]); } catch { /* ignore */ }
        }
      } else {
        // 子节点成员（含深层 a.b.c）：直接按 parent.member 链赋值；中间节点未物化时逐层 -var-list-children 定位
        const parentVar = this.varRefToName.get(ref);
        if (!parentVar) {
          this.sendResponse(req, false, {}, '找不到变量引用');
          return;
        }
        const segs = name.split('.').filter(Boolean);
        let target = `${parentVar}.${segs.join('.')}`;
        try {
          await this.session.sendMi('-var-assign', {}, [target, value]);
        } catch {
          // 中间子节点未物化：逐层物化后按 GDB child 命名约定（parent.member）定位
          target = parentVar;
          for (const seg of segs) {
            const listRes = await this.session.sendPositional('-var-list-children', [target]);
            const children = this.splitMiTuples(listRes.attrs['children'] ?? '');
            let found: ChildVar | null = null;
            for (const childStr of children) {
              const child = this.parseChildVar(childStr);
              if (child && (child.exp === seg || child.exp.endsWith('.' + seg) || child.name.endsWith('.' + seg))) {
                found = child;
                break;
              }
            }
            if (!found) {
              this.sendResponse(req, false, {}, `找不到成员: ${seg}`);
              return;
            }
            target = found.name;
          }
          await this.session.sendMi('-var-assign', {}, [target, value]);
        }
        this.sendResponse(req, true, { value });
      }
    } catch (err) {
      this.sendResponse(req, false, {}, `修改变量失败: ${(err as Error).message}`);
    }
  }

  private async onConfigurationDone(req: DapRequest): Promise<void> {
    // 断点已设置：新起会话启动程序；附加会话目标已在运行（附加后处于停止态，等用户继续）
    if (this.session && !this.attached) {
      await this.prepareStopOnEntry();
      try {
        // R4：远程目标已运行——用 continue 而非 run（对齐 gdb_driver.cpp:279-292 远程 Start 语义）
        await this.session.send(this.isRemoteDebugging ? '-exec-continue' : '-exec-run');
        this.targetRunning = true; // P3：目标开始运行（此后同步 MI 请求走「快速返回」防护）
      } catch (err) {
        // 启动失败必须可见（如 GDB 与目标架构不匹配：not in executable format，第五十轮 D9）
        this.sendOutput('stderr', `无法启动程序: ${(err as Error).message}`);
      }
    }
    this.sendResponse(req, true, {});
  }

  /**
   * C-01：stopOnEntry 实现 —— 运行前插入口一次性临时断点，其命中在 `*stopped` 处理中映射为 DAP `reason: "entry"`。
   *
   * 入口选取顺序（每一步都有实测依据，见下）：
   *  1. **用户入口符号候选** `main` → `WinMain` → `wWinMain`：只接受**带 `file`/`line`** 的解析结果。
   *     必要性（本轮补齐）：`-mwindows` GUI 程序的 `main` 是 MinGW CRT 提供的桩符号
   *     （`nm` 见 `T main`；`-break-insert -t main` 返回 `at="<main+9>"` 且**无 func/file/line**
   *     ⇒ `info address main` = "in a file compiled without debugging"），该断点**永不命中**
   *     （GUI 启动路径 `WinMainCRTStartup` 直接调 `WinMain`），旧实现却因「有编号、非 pending」而
   *     当成可用入口 ⇒ 静默失效。此类结果一律删除并试下一个候选。
   *  2. **程序入口地址兜底** `-break-insert -t *<Entry point>`（入口地址取自 `info files` 的
   *     `Entry point: 0x…`）：覆盖「无用户入口符号」（如 `strip -s` 后无符号表 ⇒ 三个候选全部报
   *     "No symbol table is loaded"）与「入口不是 main/WinMain」的情况。此停点**无源码行**（DAP 语义
   *     就是「入口」），命中同样映射为 `reason=entry`。
   *  3. 以上都不可用 → 撤断点 + 一行中文说明，程序照常运行（不卡死、不伪造首停）。
   *
   * 方案取舍（本机 MinGW GDB 8.1 实测）：
   *  - 不能用「先 run 再中断到入口」：`-exec-interrupt` 在 Windows 原生 GDB 上既不下发 `*stopped`
   *    又会让 GDB 失去回执（缺陷 D-07），`-gdb-set mi-async on` 无效；
   *  - 对照方案 `-interpreter-exec console "start"` 虽同样停在 `main` 首行，但返回 `^running`、
   *    断点编号只能从 `=breakpoint-created` / CLI 文本间接获得，且无法与失败回退统一 ⇒ 弃用；
   *  - 临时断点编号来自本命令的 token 匹配响应，无竞态；`disp="del"` 表示命中后 GDB 自动删除。
   */
  private async prepareStopOnEntry(): Promise<void> {
    // targetRunning 守卫：重复 configurationDone 时不再插断点（运行中插入会触发 D-07 同款无回执）
    if (!this.stopOnEntry || !this.session || this.targetRunning) return;
    if (this.isRemoteDebugging) {
      this.sendOutput('console', '提示：远程调试目标在连接时已在运行，stopOnEntry 不适用，程序将直接继续');
      return;
    }

    // 1) 用户入口符号候选（只接受带源码位置的解析结果）
    for (const name of ENTRY_SYMBOL_CANDIDATES) {
      let bkpt: string;
      try {
        const r = await this.session.sendExact(`-break-insert -t ${name}`);
        bkpt = r.attrs['bkpt'] ?? '';
      } catch {
        continue; // 无该符号（如 "No symbol table is loaded."）→ 试下一个
      }
      const gdbNum = this.extractField(bkpt, 'number');
      if (!gdbNum || isPendingBreakpoint(bkpt) || !this.hasSourceLocation(bkpt)) {
        if (gdbNum) { try { await this.session.sendExact(`-break-delete ${gdbNum}`); } catch { /* 已失效等 */ } }
        continue;
      }
      this.entryBpNum = gdbNum;
      this.entryStopLabel = name;
      return;
    }

    // 2) 程序入口地址兜底（DAP 的「入口」语义；无源码行）
    let detail = '未取到程序入口地址（GDB 的 info files 无 Entry point 行）';
    const entryAddr = await this.programEntryAddress();
    if (entryAddr) {
      detail = `程序入口地址 ${entryAddr} 的断点未生效`;
      try {
        const r = await this.session.sendExact(`-break-insert -t *${entryAddr}`);
        const bkpt = r.attrs['bkpt'] ?? '';
        const gdbNum = this.extractField(bkpt, 'number');
        if (gdbNum && !isPendingBreakpoint(bkpt)) {
          this.entryBpNum = gdbNum;
          this.entryStopLabel = entryAddr;
          this.sendOutput('console', `提示：未找到用户入口符号（main/WinMain/wWinMain），stopOnEntry 改为停在程序入口 ${entryAddr}（该位置无源码信息）`);
          return;
        }
        if (gdbNum) { try { await this.session.sendExact(`-break-delete ${gdbNum}`); } catch { /* 已失效等 */ } }
      } catch (err) {
        detail = `程序入口地址 ${entryAddr} 的断点设置失败：${(err as Error).message}`;
      }
    }

    // 3) 失败回退：明确说明（带具体原因，便于用户判断是符号缺失还是地址断点不被支持），程序照常运行
    this.sendOutput('console', `提示：stopOnEntry 无法生效（${detail}），程序将直接运行`);
  }

  /** bkpt 元组是否带源码位置（`file`/`line`）——CRT 桩符号（如 GUI 程序的 main）没有，判为不可用作入口断点 */
  private hasSourceLocation(bkptStr: string): boolean {
    return !!this.extractField(bkptStr, 'file') || !!this.extractField(bkptStr, 'line');
  }

  /**
   * 程序入口地址（`info files` 的 `Entry point: 0x…`；PE/ELF 均可，取不到返回 undefined）。
   * `info files` 是 CLI 命令，结果只走 `~"…"` 流记录 ⇒ 用 `consoleCapture` 拦截（同 D-03 的 info variables）。
   */
  private async programEntryAddress(): Promise<string | undefined> {
    const prev = this.consoleCapture;
    const buf: string[] = [];
    this.consoleCapture = buf;
    try {
      await this.session!.sendExact('-interpreter-exec console "info files"');
      const m = buf.join('').match(/Entry point:\s*(0x[0-9a-fA-F]+)/);
      return m ? m[1] : undefined;
    } catch {
      return undefined;
    } finally {
      this.consoleCapture = prev;
    }
  }

  private async onThreads(req: DapRequest): Promise<void> {
    if (!this.session) { this.sendResponse(req, true, { threads: [] }); return; }
    // P3 运行中防护：运行时不响应 -thread-info（同步 MI 无回执）→ 立即返回缓存线程列表
    if (this.targetRunning) {
      this.sendResponse(req, true, {
        threads: this.threads.map((t) => ({ id: t.id, name: t.name })),
      }, GdbDebugAdapter.RUNNING_HINT);
      return;
    }
    try {
      const r = await this.session.send('-thread-info');
      const cur = Number(r.attrs['current-thread-id'] ?? 0);
      if (cur) this.currentThreadId = cur; // 与 GDB 实际选中线程对齐（-thread-select 前置条件）
      const threads = r.attrs['threads'] ?? '';
      // 第五十一轮 E2：逐 tuple 解析（旧惰性可选组正则的 name 永不捕获，与 D3 同款缺陷）
      this.threads = parseThreadTuples(threads).map((t) => ({ id: t.id, name: t.name ?? `线程 ${t.id}` }));
    } catch { /* ignore */ }
    this.sendResponse(req, true, {
      threads: this.threads.map((t) => ({ id: t.id, name: t.name })),
    });
  }

  private async onStackTrace(req: DapRequest): Promise<void> {
    const args = (req as any).arguments;
    const threadId = Number(args?.threadId ?? 0) || 0;
    if (!this.session) { this.sendResponse(req, true, { stackFrames: [] }); return; }
    if (this.rejectWhileRunning(req, '调用栈读取')) return;
    try {
      // 多线程：GDB 的 -stack-list-frames 作用于选中线程 → 请求的线程不同则先切换
      await this.selectThread(threadId);
      const r = await this.session.send('-stack-list-frames');
      const frames = r.attrs['stack'] ?? '';
      this.stackFrames = this.parseStackFrames(frames, threadId || this.currentThreadId);
    } catch { /* ignore */ }
    this.sendResponse(req, true, {
      stackFrames: this.stackFrames.map((f) => ({
        id: f.id,
        name: f.name,
        source: f.file ? { name: f.file.split(/[\\/]/).pop(), path: f.file } : undefined,
        line: f.line ?? 0,
        column: 0,
        // 反汇编视图定位用（VS Code「打开反汇编视图」依赖帧的 instructionPointerReference）
        instructionPointerReference: f.addr,
      })),
    });
  }

  private async onScopes(req: DapRequest): Promise<void> {
    // 本地变量按帧分配引用（第五十轮 D8）：LOCALS_REF_BASE + frameId
    const frameId = Number((req as any).arguments?.frameId ?? 0) || 0;
    this.sendResponse(req, true, {
      scopes: [
        { name: frameId > 0 ? `本地变量 (帧 ${frameId})` : '本地变量', variablesReference: LOCALS_REF_BASE + frameId, expensive: false },
        { name: '全局', variablesReference: 2000, expensive: false },
      ],
    });
  }

  private async onVariables(req: DapRequest): Promise<void> {
    const args = (req as any).arguments;
    const ref = args.variablesReference ?? 0;
    if (!this.session) { this.sendResponse(req, true, { variables: [] }); return; }
    if (this.rejectWhileRunning(req, '变量读取')) return;

    let vars: DapVariable[] = [];
    try {
      if (ref === 0) {
        // 顶层不可达（scopes 会提供引用），防御性返回空
        vars = [];
      } else if (ref === 2000) {
        // 全局变量：-stack-list-variables 仅作用当前帧，需另行枚举（D-03）
        vars = await this.parseGlobalVariables();
      } else if (ref >= LOCALS_REF_BASE) {
        // 本地变量（按帧）：先切帧（第五十轮 D8）
        await this.ensureFrame(ref);
        const r = await this.session.sendMi('-stack-list-variables', {}, ['1']);
        vars = await this.parseVariables(r.attrs['variables'] ?? '', true);
      } else {
        // 子节点：按 varobj 名列出 children（必须带 print-values=1，否则子成员 value 恒为空，D-02）
        const varName = this.varRefToName.get(ref);
        if (!varName) { this.sendResponse(req, true, { variables: [] }); return; }
        const r = await this.session.sendPositional('-var-list-children', ['1', varName]);
        vars = await this.parseChildren(r.attrs['children'] ?? '');
      }
    } catch { /* ignore */ }

    this.sendResponse(req, true, { variables: vars });
  }

  private async onContinue(req: DapRequest): Promise<void> {
    if (this.session) { try { await this.session.send('-exec-continue'); this.targetRunning = true; } catch { /* */ } }
    this.sendResponse(req, true, {});
  }

  private async onStep(req: DapRequest, cmd: string, instrCmd?: string): Promise<void> {
    // 指令级步进（granularity=instruction，对齐 CB Debug 单指令步进）
    const granularity = (req as any).arguments?.granularity;
    const use = granularity === 'instruction' && instrCmd ? instrCmd : cmd;
    if (this.session) { try { await this.session.send(use); this.targetRunning = true; } catch { /* */ } }
    this.sendResponse(req, true, {});
  }

  /**
   * Step Out（修复 8）：不再用 `-exec-finish` —— 该命令在本机 MinGW GDB 8.1 上会让 GDB
   * 进程崩溃（0xC0000005，已实证：发 `-exec-finish` 后仅回 `^running` 即无输出，进程退出码
   * 3221225477；在最外层帧则报 "finish not meaningful in the outermost frame"）。
   * 改为「调用者返回地址（frame 1 的 addr = callee 的返回点）一次性断点 + 继续」：
   * 语义等价（停在当前函数返回之后），且不触发该 GDB 缺陷（已实证 GDB 存活并停在调用处）。
   */
  private async onStepOut(req: DapRequest): Promise<void> {
    if (!this.session) { this.sendResponse(req, true, {}); return; }
    if (this.rejectWhileRunning(req, '步出')) return;
    try {
      const r = await this.session.sendExact('-stack-list-frames');
      const frames = parseStackFrameTuples(r.attrs['stack'] ?? '');
      const caller = frames.find((f) => f.level === 1);
      if (!caller || !caller.addr) {
        // 最外层帧：GDB 自身也不支持 finish，给用户可读提示而不结束会话
        this.sendOutput('console', '已处于最外层函数，无法 Step Out（如要结束程序请按“继续”运行到退出）');
        this.sendResponse(req, true, {});
        return;
      }
      const ins = await this.session.sendExact(`-break-insert -t *${caller.addr}`);
      this.stepOutBpNum = ins.attrs['bkpt'] ? this.extractField(ins.attrs['bkpt'], 'number') ?? null : null;
      await this.session.send('-exec-continue');
      this.targetRunning = true;
      this.sendResponse(req, true, {});
    } catch (err) {
      this.sendResponse(req, false, {}, `Step Out 失败: ${(err as Error).message}`);
    }
  }

  private async onPause(req: DapRequest): Promise<void> {
    if (!this.session) { this.sendResponse(req, true, {}); return; }
    // D-07 能力探测：Windows 原生 GDB 无法中断运行中的被调试进程——实测 `-exec-interrupt` 既不产生
    // *stopped，还会让 GDB 永久失去响应（进程存活但后续 MI 命令全部无回执）⇒ 该平台不下发，
    // 直接回「不支持」并保持会话可用；远程目标与其它平台（中断有效）维持原行为。
    if (process.platform === 'win32' && !this.isRemoteDebugging) {
      this.sendResponse(req, false, {},
        '当前调试目标不支持暂停：Windows 原生 GDB 无法中断运行中的进程（请使用断点或「停止」结束会话）');
      return;
    }
    this.session.sendAsync('-exec-interrupt');
    this.sendResponse(req, true, {});
  }

  /** DAP modules：已加载模块（=library-loaded 缓存）+ 调试目标本体 */
  private async onModules(req: DapRequest): Promise<void> {
    const modules: { id: string; name: string; path: string; baseAddress?: string }[] = [];
    if (this.program) modules.push({ id: 'main', name: this.program, path: this.program });
    this.loadedLibs.forEach((l, i) => {
      const m: { id: string; name: string; path: string; baseAddress?: string } = { id: `lib${i}`, name: l.name, path: l.name };
      if (l.from && /^0x[0-9a-f]+$/i.test(l.from)) m.baseAddress = l.from; // ranges.from = .text 加载地址
      modules.push(m);
    });
    this.sendResponse(req, true, { modules });
  }

  /** DAP loadedSources：被调试进程已加载的源文件（-file-list-exec-source-files） */
  private async onLoadedSources(req: DapRequest): Promise<void> {
    const sources: { name: string; path: string; sourceReference: number }[] = [];
    if (this.session && !this.targetRunning) {
      try {
        const r = await this.session.sendExact('-file-list-exec-source-files');
        for (const tu of this.splitMiTuples(r.attrs['files'] ?? '')) {
          const full = this.extractField(tu, 'fullname') || this.extractField(tu, 'file') || '';
          if (!full) continue;
          sources.push({ name: this.extractField(tu, 'file') || full, path: full, sourceReference: 0 });
        }
      } catch { /* 忽略：GDB 不支持该 MI 命令时返回空列表 */ }
    }
    this.sendResponse(req, true, { sources });
  }

  private async onEvaluate(req: DapRequest): Promise<void> {
    const args = (req as any).arguments;
    const expr: string = args.expression ?? '';
    if (!this.session) { this.sendResponse(req, true, { result: '', variablesReference: 0 }); return; }
    try {
      // Send user command（对齐 CB Debug → Send user command）：以 - 开头按 MI 原样执行
      if (expr.trim().startsWith('-')) {
        const r = await this.session.sendExact(expr.trim());
        this.sendOutput('console', r.raw);
        this.sendResponse(req, true, { result: r.raw, variablesReference: 0 });
        return;
      }
      // P3 运行中防护：非 MI 透传的表达式求值运行时无回执 → 立即失败并说明
      //（`-` 前缀的显式用户命令保持原样执行，见上）
      if (this.rejectWhileRunning(req, '表达式求值')) return;
      // 帧作用域：按 frameId 切换到「指定线程的指定帧」再求值（多线程/多帧下求值上下文与客户端一致；
      // DAP 的 frameId 与本地作用域 variablesReference 同为「帧引用」，此处补基址后统一经 ensureFrame）
      if (args.frameId) await this.ensureFrame(LOCALS_REF_BASE + Number(args.frameId));
      const r = await this.session.sendMi('-data-evaluate-expression', {}, [expr]);
      const value = r.attrs['value'] ?? '';
      this.sendResponse(req, true, { result: value, variablesReference: 0 });
    } catch (err) {
      // 求值失败应当可见（Debug Console / Watch，第五十轮 D11）
      this.sendResponse(req, false, {}, `求值失败: ${(err as Error).message}`);
    }
  }

  // ---- 第四十九轮：反汇编 / 内存 / 数据断点 / 跳转 / 异常断点 ----

  /** 地址求值：0x 字面量直接解析，否则按表达式 -data-evaluate-expression */
  private async evalAddress(expr: string): Promise<number | null> {
    const t = (expr ?? '').trim();
    if (!t) return null;
    if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
    if (/^\d+$/.test(t)) return parseInt(t, 10);
    if (!this.session) return null;
    try {
      const r = await this.session.sendExact(`-data-evaluate-expression ${this.session.quote(t)}`);
      const m = (r.attrs['value'] ?? '').match(/0x[0-9a-fA-F]+/);
      return m ? parseInt(m[0], 16) : null;
    } catch {
      return null;
    }
  }

  private static hex(n: number): string {
    return '0x' + Math.max(0, Math.floor(n)).toString(16);
  }

  /** 取一个字节区间的反汇编（mode 1 源码混合，失败回退 mode 0） */
  private async fetchDisassembly(lo: number, hi: number): Promise<AsmInsn[]> {
    if (!this.session) return [];
    const range = `-s ${GdbDebugAdapter.hex(lo)} -e ${GdbDebugAdapter.hex(hi)}`;
    try {
      const r = await this.session.sendExact(`-data-disassemble ${range} -- 1`);
      const insns = parseDisassemble(r.attrs['asm_insns'] ?? '');
      if (insns.length) return insns;
    } catch { /* 回退 mode 0 */ }
    try {
      const r = await this.session.sendExact(`-data-disassemble ${range} -- 0`);
      return parseDisassemble(r.attrs['asm_insns'] ?? '');
    } catch {
      return [];
    }
  }

  /** Disassembly 请求（VS Code 原生反汇编视图） */
  private async onDisassemble(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    if (!this.session) { this.sendResponse(req, true, { instructions: [] }); return; }
    if (this.rejectWhileRunning(req, '反汇编')) return;
    const want = Math.max(1, Number(args.instructionCount ?? 100));
    const byteOffset = Number(args.offset ?? 0) || 0;
    const instrOffset = Number(args.instructionOffset ?? 0) || 0;
    try {
      const base = await this.evalAddress(String(args.memoryReference ?? '') || '$pc');
      if (base === null) { this.sendResponse(req, true, { instructions: [] }); return; }
      const target = base + byteOffset;
      let lo = Math.max(0, target - (instrOffset < 0 ? 8 * (Math.abs(instrOffset) + 4) : 0));
      let hi = target + 16 + (want + Math.max(instrOffset, 0)) * 8;
      let insns: AsmInsn[] = [];
      let win = { ok: false, need: 'forward' as 'none' | 'back' | 'forward', list: [] as AsmInsn[], startIndex: 0 };
      for (let attempt = 0; attempt < 4 && !win.ok; attempt++) {
        insns = await this.fetchDisassembly(lo, hi);
        win = selectWindow(insns, target, instrOffset, want);
        if (win.ok || !insns.length) break;
        if (win.need === 'forward') {
          hi = insns[insns.length - 1].addressValue + 16 + 8 * want;
        } else {
          lo = Math.max(0, lo - 8 * (Math.abs(win.startIndex) + 4));
        }
      }
      const list = win.ok ? win.list : insns.filter((i) => i.addressValue >= target).slice(Math.max(0, instrOffset), Math.max(0, instrOffset) + want);
      this.sendResponse(req, true, {
        instructions: list.map((i) => ({
          address: i.address,
          instruction: i.instruction,
          symbol: i.symbol,
          location: i.file ? { name: i.file.split(/[\\/]/).pop(), path: i.file } : undefined,
          line: i.line,
        })),
      });
    } catch {
      this.sendResponse(req, true, { instructions: [] });
    }
  }

  /** Memory 视图读取（-data-read-memory-bytes） */
  private async onReadMemory(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    if (!this.session) { this.sendResponse(req, false, {}, '调试会话未启动'); return; }
    if (this.rejectWhileRunning(req, '内存读取')) return;
    const base = await this.evalAddress(String(args.memoryReference ?? ''));
    if (base === null) { this.sendResponse(req, false, {}, '无效的内存引用'); return; }
    const addr = base + (Number(args.offset ?? 0) || 0);
    const count = Math.max(0, Math.floor(Number(args.count ?? 0)));
    try {
      const r = await this.session.sendExact(`-data-read-memory-bytes ${GdbDebugAdapter.hex(addr)} ${count}`);
      const hexStr = parseReadMemory(r.attrs['memory'] ?? '');
      this.sendResponse(req, true, { address: GdbDebugAdapter.hex(addr), data: hexToBase64(hexStr), unencodedData: hexStr });
    } catch (err) {
      this.sendResponse(req, false, {}, `读取内存失败: ${(err as Error).message}`);
    }
  }

  /** Memory 视图写入（-data-write-memory-bytes） */
  private async onWriteMemory(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    if (!this.session) { this.sendResponse(req, false, {}, '调试会话未启动'); return; }
    if (this.rejectWhileRunning(req, '内存写入')) return;
    const base = await this.evalAddress(String(args.memoryReference ?? ''));
    if (base === null) { this.sendResponse(req, false, {}, '无效的内存引用'); return; }
    const addr = base + (Number(args.offset ?? 0) || 0);
    const hexData = base64ToHex(String(args.data ?? ''));
    if (!hexData) { this.sendResponse(req, true, { bytesWritten: 0 }); return; }
    try {
      await this.session.sendExact(`-data-write-memory-bytes ${GdbDebugAdapter.hex(addr)} ${hexData}`);
      this.sendResponse(req, true, { bytesWritten: Math.floor(hexData.length / 2) });
    } catch (err) {
      this.sendResponse(req, false, {}, `写入内存失败: ${(err as Error).message}`);
    }
  }

  /** 数据断点信息（变量右键「数据断点」） */
  private async onDataBreakpointInfo(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    const name = String(args.name ?? '');
    if (!this.session || !name) { this.sendResponse(req, true, { dataId: undefined }); return; }
    // P3 运行中防护：二级变量树（-var-info-path-expression）运行中无回执 → 直接回「不可用」
    if (this.targetRunning) { this.sendResponse(req, true, { dataId: undefined }, GdbDebugAdapter.RUNNING_HINT); return; }
    let expr = name;
    const ref = Number(args.variablesReference ?? 0);
    if (ref >= 10000) {
      const parentVar = this.varRefToName.get(ref);
      if (parentVar) {
        try {
          const r = await this.session.sendExact(`-var-info-path-expression ${this.session.quote(`${parentVar}.${name}`)}`);
          expr = r.attrs['path_expr'] ?? name;
        } catch { /* 回退到显示名 */ }
      }
    }
    this.sendResponse(req, true, {
      dataId: `cbdbg:${encodeURIComponent(expr)}`,
      description: `${expr} 的数据断点（读/写）`,
      accessTypes: ['write', 'readWrite', 'read'],
      canPersist: false,
    });
  }

  /** 设置数据断点（watch / rwatch / awatch） */
  private async onSetDataBreakpoints(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    const requested: { dataId?: string; accessType?: string }[] = args.breakpoints ?? [];
    if (!this.session) {
      this.sendResponse(req, true, { breakpoints: requested.map(() => ({ verified: false })) });
      return;
    }
    if (this.rejectWhileRunning(req, '数据断点设置')) return;
    for (const bp of this.dataBreakpoints) {
      if (bp.gdbNum) { try { await this.session.sendExact(`-break-delete ${bp.gdbNum}`); } catch { /* */ } }
    }
    this.dataBreakpoints = [];
    let seq = 0;
    const result: { verified: boolean; id?: number }[] = [];
    for (const br of requested) {
      const dataId = String(br.dataId ?? '');
      let expr = '';
      if (dataId.startsWith('cbdbg:')) {
        try { expr = decodeURIComponent(dataId.slice('cbdbg:'.length)); } catch { expr = ''; }
      }
      if (!expr) { result.push({ verified: false }); continue; }
      const access = br.accessType ?? 'write';
      const flag = access === 'read' ? ' -r' : access === 'readWrite' ? ' -a' : '';
      try {
        const r = await this.session.sendExact(`-break-watch${flag} ${this.session.quote(expr)}`);
        const gdbNum = this.extractField(r.attrs['wpt'] ?? '', 'number');
        this.dataBreakpoints.push({ dataId, gdbNum });
        result.push({ verified: true, id: ++seq });
      } catch {
        result.push({ verified: false });
      }
    }
    this.sendResponse(req, true, { breakpoints: result });
  }

  /**
   * 指令断点（第五十一轮 E1）：反汇编视图 gutter 对任意指令下断。
   * 地址形式 `-break-insert *ADDR` 已在 GDB 8.1 / 7.6.1 双实测可用（Step Out 临时断点同路径）；
   * 条件/命中次数/日志断点复用文件断点机制（条件为客户端求值）。
   */
  private async onSetInstructionBreakpoints(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    const requested: { instructionReference?: string; offset?: number; condition?: string; hitCondition?: string; logMessage?: string }[] = args.breakpoints ?? [];
    if (!this.session) { this.sendResponse(req, true, { breakpoints: requested.map(() => ({ verified: false })) }); return; }
    if (this.rejectWhileRunning(req, '指令断点设置')) return;

    // 清旧（同步清理条件/日志表）
    for (const bp of this.instructionBreakpoints) {
      if (bp.gdbNum) {
        try { await this.session.sendExact(`-break-delete ${bp.gdbNum}`); } catch { /* ignore */ }
        this.bpConditions.delete(bp.gdbNum);
        this.logpoints.delete(bp.gdbNum);
      }
    }
    this.instructionBreakpoints = [];

    const result: { verified: boolean; id?: number; message?: string }[] = [];
    for (const br of requested) {
      const addr = parseInstructionReference(String(br.instructionReference ?? ''), br.offset);
      if (addr === null) { result.push({ verified: false, message: '无效的指令地址' }); continue; }
      try {
        const r = await this.session.sendExact(`-break-insert *${GdbDebugAdapter.hex(addr)}`);
        const gdbNum = r.attrs['bkpt'] ? this.extractField(r.attrs['bkpt'], 'number') : undefined;
        const verified = !!r.attrs['bkpt'] && !isPendingBreakpoint(r.attrs['bkpt']);
        if (gdbNum && br.condition) this.bpConditions.set(gdbNum, br.condition);
        if (gdbNum && br.logMessage) this.logpoints.set(gdbNum, String(br.logMessage));
        const hit = br.hitCondition ? parseInt(String(br.hitCondition).replace(/[^\d]/g, ''), 10) : NaN;
        if (gdbNum && Number.isFinite(hit) && hit > 1) {
          try { await this.session.sendExact(`-break-after ${gdbNum} ${hit - 1}`); } catch { /* 不致命 */ }
        }
        this.instructionBreakpoints.push({ gdbNum, verified });
        result.push({ verified, id: this.instructionBreakpoints.length, message: verified ? undefined : '指令地址未解析' });
      } catch (err) {
        result.push({ verified: false, message: (err as Error).message });
      }
    }
    this.sendResponse(req, true, { breakpoints: result });
  }

  /** Run to cursor（DAP gotoTargets） */
  private async onGotoTargets(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    const line = Number(args.line ?? 0);
    this.sendResponse(req, true, {
      targets: line ? [{ id: line, label: `行 ${line}`, line, column: 1 }] : [],
    });
  }

  /** Run to cursor（DAP goto；-exec-until file:line） */
  private async onGoto(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    const line = Number(args.targetId ?? 0);
    if (!this.session || !line) { this.sendResponse(req, false, {}, '无效的跳转目标'); return; }
    if (this.rejectWhileRunning(req, '运行到光标')) return;
    const file = this.stackFrames[0]?.file;
    if (!file) { this.sendResponse(req, false, {}, '无法确定当前源文件'); return; }
    try {
      await this.session.sendExact(`-exec-until ${this.session.quote(`${file}:${line}`)}`);
      this.targetRunning = true;
      this.sendResponse(req, true, {});
    } catch (err) {
      this.sendResponse(req, false, {}, `运行到光标失败: ${(err as Error).message}`);
    }
  }

  /** 异常断点过滤器（throw / catch → GDB catchpoint） */
  private async onSetExceptionBreakpoints(req: DapRequest): Promise<void> {
    const args = (req as any).arguments ?? {};
    const filters: string[] = args.filters ?? [];
    if (!this.session) { this.sendResponse(req, true, {}); return; }
    if (this.rejectWhileRunning(req, '异常断点设置')) return;
    for (const n of this.catchpointNums) {
      try { await this.session.sendExact(`-break-delete ${n}`); } catch { /* */ }
    }
    this.catchpointNums = [];
    this.catchpointFilters.clear();
    for (const f of filters) {
      if (f !== 'throw' && f !== 'catch') continue;
      try {
        const r = await this.session.sendExact(`-catch-${f}`);
        const n = this.extractField(r.attrs['bkpt'] ?? '', 'number');
        if (n) { this.catchpointNums.push(n); this.catchpointFilters.set(n, f); }
      } catch {
        // 老版 GDB 无 -catch-*：回退 CLI catch（编号由 -break-list 回收）
        try { await this.session.sendExact(`-interpreter-exec console ${this.session.quote(`catch ${f}`)}`); } catch { /* best-effort */ }
      }
    }
    if (!this.catchpointNums.length) {
      try {
        // 老版 GDB（8.1）无 -catch-* MI 命令：CLI `catch throw` 的条目在 -break-list 里是
        // type="breakpoint" + catch-type="throw"，须按 catch-type 识别（D-04）
        const r = await this.session.sendExact('-break-list');
        for (const c of parseCatchpoints(r.attrs['BreakpointTable'] ?? '')) {
          this.catchpointNums.push(c.number);
          if (c.catchType) this.catchpointFilters.set(c.number, c.catchType);
        }
      } catch { /* 忽略 */ }
    }
    this.sendResponse(req, true, {});
  }

  private async onDisconnect(req: DapRequest): Promise<void> {
    // 第五轮批次二 D1：附加会话先显式分离（实测即使不分离被附加进程也存活，显式化更稳；
    // 对齐 CB「附加模式停止前先 Detach」语义）
    if (this.attached && this.session && !this.detached) {
      if (this.targetRunning) {
        // P3：运行中 -target-detach 无回执（同步 MI 阻塞，旧行为：等待 30s 超时）→ 直接结束会话；
        // GDB 被回收时被附加进程自行存活（实测），与显式 Detach 的「分离不杀进程」语义一致
        this.detached = true;
      } else {
        try { await this.session.sendExact('-target-detach'); this.detached = true; } catch { /* best-effort */ }
      }
      this.stoppedState = false; // Detach 后不再有停止态（与 adapter.detach() 一致）
      this.targetRunning = false;
    }
    this.sendResponse(req, true, {});
    this.dispose();
  }

  /** 停止调试（红方块）：回响应 + 结束事件 + 回收 GDB（第五十轮 D1） */
  private async onTerminate(req: DapRequest): Promise<void> {
    this.sendResponse(req, true, {});
    if (!this.ended) {
      this.ended = true;
      this.sendEvent('terminated', {});
    }
    this.dispose();
  }

  /** 切换到 variablesReference 编码的帧（本地变量作用域，第五十轮 D8；P3：先切线程再切帧） */
  private async ensureFrame(ref: number): Promise<void> {
    if (!this.session || ref < LOCALS_REF_BASE) return;
    const fid = ref - LOCALS_REF_BASE;
    const threadId = Math.floor(fid / FRAME_ID_BASE);
    const level = fid % FRAME_ID_BASE;
    try {
      await this.selectThread(threadId);
      await this.session.sendExact(`-stack-select-frame ${level}`);
    } catch { /* 忽略 */ }
  }

  /** 日志断点输出：{expr} 逐个求值后写 Debug Console（DAP 语义：不停止，第五十轮 D4） */
  private async emitLogpoint(template: string): Promise<void> {
    if (!this.session) return;
    let text = template;
    for (const expr of logpointExpressions(template)) {
      let val = '<求值失败>';
      try {
        const r = await this.session.sendExact(`-data-evaluate-expression ${this.session.quote(expr)}`);
        val = r.attrs['value'] ?? '';
      } catch { /* 保留占位 */ }
      text = text.split(`{${expr}}`).join(val);
    }
    this.sendOutput('console', text);
  }

  // ---- GDB MI 异步记录处理 ----
  private async handleAsync(rec: MiAsync): Promise<void> {
    if (rec.record === 'stopped') {
      const rawReason = rec.attrs['reason'] ?? 'breakpoint-hit';
      const threadId = Number(rec.attrs['thread-id'] ?? 1);
      // 程序退出（exited / exited-normally / exited-signalled）→ 结束会话（第五十轮 D2）
      if (isExitReason(rawReason)) {
        this.stoppedState = false;
        this.targetRunning = false;
        this.currentThreadId = 0;
        this.stepOutBpNum = null;
        if (!this.ended) {
          this.ended = true;
          this.sendEvent('exited', { exitCode: Number(rec.attrs['exit-code'] ?? 0) || 0 });
          this.sendEvent('terminated', {});
        }
        debugStateChanged.fire();
        return;
      }
      // 更新线程列表
      if (!this.threads.some((t) => t.id === threadId)) {
        this.threads.push({ id: threadId, name: `线程 ${threadId}` });
      }
      // 条件断点客户端求值（第五十轮修复 9）：不成立 → 自动继续，不发 stopped
      const bkptno = rec.attrs['bkptno'];
      if (bkptno) {
        const condition = this.bpConditions.get(bkptno);
        if (condition !== undefined) {
          let hit = true;
          try {
            const er = await this.session!.sendExact(`-data-evaluate-expression ${this.session!.quote(condition)}`);
            hit = truthyMiValue(er.attrs['value'] ?? '');
          } catch { /* 求值失败按命中处理，避免静默跳过 */ }
          if (!hit) {
            if (this.session) this.session.sendAsync('-exec-continue');
            return;
          }
        }
      }
      // 日志断点命中：打印消息 + 自动继续，不发 stopped（第五十轮 D4）
      const logMessage = bkptno ? this.logpoints.get(bkptno) : undefined;
      if (logMessage !== undefined) {
        await this.emitLogpoint(logMessage);
        if (this.session) this.session.sendAsync('-exec-continue');
        return;
      }
      this.stoppedState = true;
      this.targetRunning = false;
      this.currentThreadId = threadId; // GDB 停止后选中的线程 = 停止线程（-stack-select-frame 作用于它）
      // 停止原因按 DAP 枚举映射（第五十轮 D5）
      let reason = mapStopReason(rawReason, rec.attrs['signal-name']);
      let description = rawReason;
      // D-04：异常 catchpoint 命中在 MI 中同样上报 breakpoint-hit，需按 catchpoint 编号识别，
      // 否则 VS Code 只按普通断点呈现（reason=breakpoint），无法显示“已暂停在异常处”。
      const stopBpNum = rec.attrs['bkptno'];
      // C-01：入口临时断点命中 → DAP reason=entry（描述为入口语义，不携带「断点命中」误导）
      if (stopBpNum && this.entryBpNum !== null && stopBpNum === this.entryBpNum) {
        reason = 'entry';
        description = this.entryStopLabel
          ? `已暂停在程序入口（${this.entryStopLabel}，stopOnEntry）`
          : '已暂停在程序入口（stopOnEntry）';
        this.entryBpNum = null; // 临时断点已被 GDB 自动删除（disp=del），无需再跟踪
      } else if (stopBpNum && this.catchpointNums.includes(stopBpNum)) {
        const filter = this.catchpointFilters.get(stopBpNum);
        const kind = filter === 'catch' ? '捕获' : '抛出';
        reason = 'exception';
        description = `已暂停在异常处（${kind}异常，GDB catchpoint ${stopBpNum}）`;
      }
      // Step Out（修复 8）：命中“调用者返回地址”临时断点 → 报告为 step；停在其它原因则回收未命中的临时断点
      if (this.stepOutBpNum !== null) {
        if (rec.attrs['bkptno'] === this.stepOutBpNum) {
          reason = 'step';
        } else {
          try { await this.session?.sendExact(`-break-delete ${this.stepOutBpNum}`); } catch { /* 已自动删除等 */ }
        }
        this.stepOutBpNum = null;
      }
      this.sendEvent('stopped', { reason, threadId, allThreadsStopped: true, description });
      debugStateChanged.fire();
      // 注：不再伪造 threads 响应（第五十轮修复 5：request_seq=0 的编造响应属协议违规；
      // VS Code 收到 stopped 后会自行请求 threads/stackTrace）
    } else if (rec.record === 'running') {
      this.stoppedState = false;
      this.targetRunning = true;
      debugStateChanged.fire();
    } else if (rec.record === 'thread-created') {
      const id = Number(rec.attrs['id'] ?? 0);
      if (id && !this.threads.some((t) => t.id === id)) {
        this.threads.push({ id, name: `线程 ${id}` });
        this.sendEvent('thread', { reason: 'started', threadId: id });
      }
    } else if (rec.record === 'thread-exited') {
      const id = Number(rec.attrs['id'] ?? 0);
      this.threads = this.threads.filter((t) => t.id !== id);
      this.sendEvent('thread', { reason: 'exited', threadId: id });
    } else if (rec.record === 'library-loaded') {
      // D2：缓存已加载库（ranges 首段 = .text 加载范围，作 add-symbol-file 地址预填）
      const name = rec.attrs['host-name'] || rec.attrs['id'] || '';
      const from = (rec.attrs['ranges'] ?? '').match(/from="([^"]+)"/)?.[1];
      if (name && !this.loadedLibs.some((l) => l.name === name)) {
        this.loadedLibs.push({ name, from });
      }
    } else if (rec.record === 'library-unloaded') {
      const name = rec.attrs['host-name'] || rec.attrs['id'] || '';
      if (name) this.loadedLibs = this.loadedLibs.filter((l) => l.name !== name);
    }
  }

  // ---- MI 结果解析辅助 ----
  private extractField(bkptStr: string, field: string): string | undefined {
    const m = bkptStr.match(new RegExp(`${field}="([^"]*)"`));
    return m ? m[1] : undefined;
  }

  private parseStackFrames(s: string, threadId = 0): { id: number; name: string; file?: string; line?: number; addr?: string }[] {
    // 逐 tuple 解析（旧惰性可选分组正则会丢失 file/line，已实证；第五十轮 D3）
    // P3：帧 id 编码「线程 + 帧层级」（多线程下 level 会重复，须全局唯一才能定位到帧）
    return parseStackFrameTuples(s).map((t) => ({
      id: threadId * FRAME_ID_BASE + t.level,
      name: t.func ?? '?',
      file: t.fullname || t.file,
      line: t.line,
      addr: t.addr,
    }));
  }

  /**
   * D-03：枚举程序全局变量。MI 无「按作用域列变量」命令（-stack-list-variables 只作用于当前帧），
   * 故用 `info variables`（console 命令）取符号名与类型，输出经 consoleCapture 截获后解析。
   */
  private async collectGlobalVars(): Promise<{ name: string; type: string }[]> {
    if (this.globalVarsCache) return this.globalVarsCache;
    const out: { name: string; type: string }[] = [];
    if (this.session) {
      try {
        this.consoleCapture = [];
        await this.session.sendExact('-interpreter-exec console "info variables"');
        out.push(...parseInfoVariablesOutput(this.consoleCapture.join(''), 200));
      } catch { /* 枚举失败按无全局变量处理 */ } finally {
        this.consoleCapture = null;
      }
    }
    this.globalVarsCache = out;
    return out;
  }

  /** D-03：全局作用域变量列表（前 N 个建 varobj 取值，其余仅名称/类型） */
  private async parseGlobalVariables(): Promise<DapVariable[]> {
    const all = await this.collectGlobalVars();
    const out: DapVariable[] = [];
    for (const g of all.slice(0, GLOBALS_INLINE_VALUE_MAX)) {
      out.push(await this.buildVariable(g.name, g.name, '', true));
    }
    for (const g of all.slice(GLOBALS_INLINE_VALUE_MAX)) {
      out.push({ name: g.name, value: '', type: g.type, variablesReference: 0 });
    }
    return out;
  }

  private async parseVariables(s: string, withValues: boolean): Promise<DapVariable[]> {
    // 格式: [{name="x",value="1"},...] （value 可能缺失）
    const out: DapVariable[] = [];
    const re = /\{name="((?:\\.|[^"])*)",(?:value="((?:\\.|[^"])*)")?/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const name = m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const value = m[2] !== undefined ? m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : '';
      out.push(await this.buildVariable(name, name, value, withValues));
    }
    return out;
  }

  /** 将 varobj 子节点元组列表转换为 DAP 变量 */
  private async parseChildren(s: string): Promise<DapVariable[]> {
    const out: DapVariable[] = [];
    const children = this.splitMiTuples(s);
    for (const childStr of children) {
      const child = this.parseChildVar(childStr);
      if (!child) continue;
      out.push({
        name: child.exp,
        value: child.value,
        type: child.type,
        variablesReference: child.numchild > 0 ? this.refForVarName(child.name) : 0,
        memoryReference: pointerMemoryReference(child.type, child.value),
      });
    }
    return out;
  }

  /** 解析单个 child 元组 {name="var_1.a",exp="a",numchild="1",type="...",value="..."} */
  private parseChildVar(s: string): ChildVar | null {
    const attrs: Record<string, string> = {};
    const re = /([A-Za-z_][A-Za-z0-9_]*)=(?:"((?:\\.|[^"])*)"|([^,}\s]*))/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      attrs[m[1]] = m[2] !== undefined ? m[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\') : m[3];
    }
    if (!attrs['name']) return null;
    return {
      name: attrs['name'],
      exp: attrs['exp'] ?? attrs['name'],
      numchild: Number(attrs['numchild'] ?? 0),
      type: attrs['type'] ?? '',
      value: attrs['value'] ?? '',
    };
  }

  /** 为顶层变量建立 varobj（可选取值），返回 DAP 变量；复合类型分配子节点引用 */
  private async buildVariable(name: string, expr: string, value: string, withValues: boolean): Promise<DapVariable> {
    if (!this.session) return { name, value, variablesReference: 0 };
    try {
      const v = await this.createVarObj(name, expr, withValues);
      return {
        name: name,
        value: v.value !== '' ? v.value : value,
        type: v.type,
        variablesReference: v.numchild > 0 ? this.refForVarName(v.name) : 0,
        memoryReference: pointerMemoryReference(v.type, v.value),
      };
    } catch {
      return { name, value, variablesReference: 0 };
    }
  }

  /** -var-create，返回 varobj 信息 */
  private async createVarObj(name: string, expr: string, withValues: boolean): Promise<{ name: string; value: string; type: string; numchild: number }> {
    const varName = `var_${++this.varSeq}`;
    const r = await this.session!.sendPositional('-var-create', [varName, '@', expr]);
    const numchild = Number(r.attrs['numchild'] ?? 0);
    let value = r.attrs['value'] ?? '';
    if (withValues && value === '' && numchild === 0) {
      // -var-create 默认可能不给值，主动求值
      try {
        const ev = await this.session!.sendPositional('-var-evaluate-expression', [varName]);
        value = ev.attrs['value'] ?? '';
      } catch { /* ignore */ }
    }
    return { name: varName, value, type: r.attrs['type'] ?? '', numchild };
  }

  /** 将 varobj 名映射到（或复用）一个 variablesReference */
  private refForVarName(varName: string): number {
    let ref = this.varNameToRef.get(varName);
    if (ref === undefined) {
      ref = ++this.varRefCounter;
      this.varNameToRef.set(varName, ref);
      this.varRefToName.set(ref, varName);
    }
    return ref;
  }

  /** 拆分 MI 元组列表字符串 "child={...},child={...}" 为各元组片段 */
  private splitMiTuples(s: string): string[] {
    const out: string[] = [];
    const n = s.length;
    let i = 0;
    while (i < n) {
      if (s[i] === ',' || s[i] === ' ' || s[i] === '\t') { i++; continue; }
      // 跳过 "child=" 前缀
      while (i < n && s[i] !== '{') i++;
      if (i >= n) break;
      let depth = 0;
      const start = i;
      while (i < n) {
        if (s[i] === '{') depth++;
        else if (s[i] === '}') { depth--; if (depth === 0) { i++; break; } }
        i++;
      }
      out.push(s.slice(start, i));
    }
    return out;
  }
}
