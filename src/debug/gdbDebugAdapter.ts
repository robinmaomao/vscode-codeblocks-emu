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
  logpointExpressions, mapStopReason, parseCatchpointNumbers, parseDisassemble, parseQuotedList,
  parseReadMemory, parseRegisterValues, parseStackFrameTuples, pointerMemoryReference, selectWindow,
  truthyMiValue,
} from './miParse';
import { debugStateChanged, debugTrace, setActiveAdapter } from './debugRegistry';

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
  // varobj 引用管理（子节点展开）
  private varSeq = 0;                                  // 生成 varobj 名
  private varRefCounter = 10000;                       // 生成 variablesReference
  private varNameToRef = new Map<string, number>();
  private varRefToName = new Map<number, string>();
  // 第四十九轮：数据断点 / 异常断点 / 附加 / 停驻状态 / 寄存器缓存
  private dataBreakpoints: { dataId: string; gdbNum?: string }[] = [];
  private catchpointNums: string[] = [];
  private attached = false;
  private stoppedState = false;
  private regNamesCache: string[] | null = null;
  // 第五十轮：会话结束标记 / 日志断点消息表
  private ended = false;
  private logpoints = new Map<string, string>();
  // 第五十轮修复 9：条件断点客户端求值表（本机 GDB 8.1 命中带条件断点会崩溃，不再下发 -break-condition）
  private bpConditions = new Map<string, string>();
  // 第五十轮修复 8：Step Out 的「调用者返回地址」临时断点编号（-exec-finish 在本机 GDB 8.1 上会崩溃）
  private stepOutBpNum: string | null = null;

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
      case 'gotoTargets': this.onGotoTargets(msg); break;
      case 'goto': this.onGoto(msg); break;
      case 'setExceptionBreakpoints': this.onSetExceptionBreakpoints(msg); break;
      case 'terminate': this.onTerminate(msg); break;
      case 'disconnect': this.onDisconnect(msg); break;
      default:
        this.sendResponse(msg, true, {});
    }
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
    setActiveAdapter(null);
  }

  // ---- 公共访问（寄存器视图 / 调试辅助命令用，第四十九轮） ----
  isActive(): boolean { return this.session !== null; }
  isStopped(): boolean { return this.stoppedState; }

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

  // ---- 响应/事件辅助 ----
  private sendResponse(req: DapRequest, success: boolean, body: any, message?: string): void {
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
      supportsSteppingGranularity: true,
      supportsHitConditionalBreakpoints: true,
      supportsLogPoints: true,
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
    this.openSession();
    try {
      await this.session!.start({
        gdbPath: this.gdbPath,
        program: this.program,
        cwd: this.cwd,
        env: (args.environment as Record<string, string>) ?? {},
      });
      // 程序与参数经 MI 注入（Windows 命令行空格安全，第五十轮修复）
      await this.session!.sendExact(`-file-exec-and-symbols ${this.session!.quote(this.program)}`);
      const progArgs = Array.isArray(args.args) ? (args.args as string[]) : [];
      if (progArgs.length) {
        await this.session!.sendExact(`-exec-arguments ${this.session!.quote(progArgs.join(' '))}`);
      }
      await this.applyDebugSettings();
      this.sendResponse(req, true, {});
      // 会话就绪后再告知客户端可以下发配置（断点等，第五十轮 D10）
      this.sendEvent('initialized', {});
    } catch (err) {
      this.dispose();
      this.sendResponse(req, false, {}, `GDB 启动失败: ${(err as Error).message}`);
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

    this.openSession();
    try {
      await this.session!.start({
        gdbPath: this.gdbPath,
        cwd: this.cwd,
        env: (args.environment as Record<string, string>) ?? {},
      });
      // 可选符号文件（附加前加载；失败不阻断，可用 Send user command 手动 add-symbol-file）
      if (this.program) {
        try { await this.session!.sendExact(`-file-exec-and-symbols ${this.session!.quote(this.program)}`); } catch { /* 符号可选 */ }
      }
      await this.session!.sendExact(`-target-attach ${pid}`);
      await this.applyDebugSettings();
      this.sendResponse(req, true, {});
      this.sendEvent('initialized', {});
    } catch (err) {
      this.dispose();
      this.sendResponse(req, false, {}, `附加进程失败: ${(err as Error).message}`);
    }
  }

  /** 建立会话与回调（launch/attach 共用） */
  private openSession(): void {
    this.session = new GdbMiSession(vscode.workspace.getConfiguration('codeblocks').get<number>('gdbTimeoutMs', 30000));
    this.session.onAsyncRecord = (rec) => this.handleAsync(rec);
    this.session.onConsole = (t) => this.sendOutput('console', t);
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
    setActiveAdapter(this);
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

    const sends: string[] = [
      // 异步模式（对齐其它 MI 前端）：让 Pause/-exec-interrupt 在支持的 GDB 上生效；老版 GDB 不支持则忽略
      '-gdb-set mi-async on',
      `-gdb-set print pretty ${pretty ? 'on' : 'off'}`,
    ];
    if (elements > 0) sends.push(`-gdb-set print elements ${Math.floor(elements)}`);
    if (flavor === 'intel' || flavor === 'att') sends.push(`-gdb-set disassembly-flavor ${flavor}`);
    if (charset) sends.push(`-gdb-set charset ${charset}`);
    for (const s of sends) {
      try { await this.session.sendExact(s); } catch { /* 单条失败不致命 */ }
    }
    for (const cmd of init) {
      if (!cmd || !cmd.trim()) continue;
      try { await this.session.sendExact(`-interpreter-exec console ${this.session.quote(cmd)}`); } catch { /* 忽略 */ }
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
      try {
        await this.session.send('-exec-run');
      } catch (err) {
        // 启动失败必须可见（如 GDB 与目标架构不匹配：not in executable format，第五十轮 D9）
        this.sendOutput('stderr', `无法启动程序: ${(err as Error).message}`);
      }
    }
    this.sendResponse(req, true, {});
  }

  private async onThreads(req: DapRequest): Promise<void> {
    if (!this.session) { this.sendResponse(req, true, { threads: [] }); return; }
    try {
      const r = await this.session.send('-thread-info');
      const threads = r.attrs['threads'] ?? '';
      this.threads = this.parseThreads(threads);
    } catch { /* ignore */ }
    this.sendResponse(req, true, {
      threads: this.threads.map((t) => ({ id: t.id, name: t.name })),
    });
  }

  private async onStackTrace(req: DapRequest): Promise<void> {
    const args = (req as any).arguments;
    if (!this.session) { this.sendResponse(req, true, { stackFrames: [] }); return; }
    try {
      const r = await this.session.send('-stack-list-frames');
      const frames = r.attrs['stack'] ?? '';
      this.stackFrames = this.parseStackFrames(frames);
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

    let vars: DapVariable[] = [];
    try {
      if (ref === 0) {
        // 顶层不可达（scopes 会提供引用），防御性返回空
        vars = [];
      } else if (ref === 2000 || ref >= LOCALS_REF_BASE) {
        // 本地变量（按帧）/ 全局变量：本地需先切帧（第五十轮 D8）
        await this.ensureFrame(ref);
        const printValues = ref >= LOCALS_REF_BASE ? '1' : '0';
        const r = await this.session.sendMi('-stack-list-variables', {}, [printValues]);
        vars = await this.parseVariables(r.attrs['variables'] ?? '', ref >= LOCALS_REF_BASE);
      } else {
        // 子节点：按 varobj 名列出 children
        const varName = this.varRefToName.get(ref);
        if (!varName) { this.sendResponse(req, true, { variables: [] }); return; }
        const r = await this.session.sendPositional('-var-list-children', [varName]);
        vars = await this.parseChildren(r.attrs['children'] ?? '');
      }
    } catch { /* ignore */ }

    this.sendResponse(req, true, { variables: vars });
  }

  private async onContinue(req: DapRequest): Promise<void> {
    if (this.session) { try { await this.session.send('-exec-continue'); } catch { /* */ } }
    this.sendResponse(req, true, {});
  }

  private async onStep(req: DapRequest, cmd: string, instrCmd?: string): Promise<void> {
    // 指令级步进（granularity=instruction，对齐 CB Debug 单指令步进）
    const granularity = (req as any).arguments?.granularity;
    const use = granularity === 'instruction' && instrCmd ? instrCmd : cmd;
    if (this.session) { try { await this.session.send(use); } catch { /* */ } }
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
      this.sendResponse(req, true, {});
    } catch (err) {
      this.sendResponse(req, false, {}, `Step Out 失败: ${(err as Error).message}`);
    }
  }

  private async onPause(req: DapRequest): Promise<void> {
    if (this.session) this.session.sendAsync('-exec-interrupt');
    this.sendResponse(req, true, {});
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
    const file = this.stackFrames[0]?.file;
    if (!file) { this.sendResponse(req, false, {}, '无法确定当前源文件'); return; }
    try {
      await this.session.sendExact(`-exec-until ${this.session.quote(`${file}:${line}`)}`);
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
    for (const n of this.catchpointNums) {
      try { await this.session.sendExact(`-break-delete ${n}`); } catch { /* */ }
    }
    this.catchpointNums = [];
    for (const f of filters) {
      if (f !== 'throw' && f !== 'catch') continue;
      try {
        const r = await this.session.sendExact(`-catch-${f}`);
        const n = this.extractField(r.attrs['bkpt'] ?? '', 'number');
        if (n) this.catchpointNums.push(n);
      } catch {
        // 老版 GDB 无 -catch-*：回退 CLI catch（编号由 -break-list 回收）
        try { await this.session.sendExact(`-interpreter-exec console ${this.session.quote(`catch ${f}`)}`); } catch { /* best-effort */ }
      }
    }
    if (!this.catchpointNums.length) {
      try {
        const r = await this.session.sendExact('-break-list');
        this.catchpointNums = parseCatchpointNumbers(r.attrs['BreakpointTable'] ?? '');
      } catch { /* 忽略 */ }
    }
    this.sendResponse(req, true, {});
  }

  private async onDisconnect(req: DapRequest): Promise<void> {
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

  /** 切换到 variablesReference 编码的帧（本地变量作用域，第五十轮 D8） */
  private async ensureFrame(ref: number): Promise<void> {
    if (!this.session || ref < LOCALS_REF_BASE) return;
    try { await this.session.sendExact(`-stack-select-frame ${ref - LOCALS_REF_BASE}`); } catch { /* 忽略 */ }
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
      // 停止原因按 DAP 枚举映射（第五十轮 D5）
      let reason = mapStopReason(rawReason, rec.attrs['signal-name']);
      // Step Out（修复 8）：命中“调用者返回地址”临时断点 → 报告为 step；停在其它原因则回收未命中的临时断点
      if (this.stepOutBpNum !== null) {
        if (rec.attrs['bkptno'] === this.stepOutBpNum) {
          reason = 'step';
        } else {
          try { await this.session?.sendExact(`-break-delete ${this.stepOutBpNum}`); } catch { /* 已自动删除等 */ }
        }
        this.stepOutBpNum = null;
      }
      this.sendEvent('stopped', { reason, threadId, allThreadsStopped: true, description: rawReason });
      debugStateChanged.fire();
      // 注：不再伪造 threads 响应（第五十轮修复 5：request_seq=0 的编造响应属协议违规；
      // VS Code 收到 stopped 后会自行请求 threads/stackTrace）
    } else if (rec.record === 'running') {
      this.stoppedState = false;
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
    }
  }

  // ---- MI 结果解析辅助 ----
  private extractField(bkptStr: string, field: string): string | undefined {
    const m = bkptStr.match(new RegExp(`${field}="([^"]*)"`));
    return m ? m[1] : undefined;
  }

  private parseThreads(s: string): { id: number; name: string }[] {
    // 格式: [{id="1",...},...]
    const out: { id: number; name: string }[] = [];
    const re = /id="(\d+)"[^}]*?(?:name="([^"]*)")?/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      out.push({ id: Number(m[1]), name: m[2] ?? `线程 ${m[1]}` });
    }
    return out;
  }

  private parseStackFrames(s: string): { id: number; name: string; file?: string; line?: number; addr?: string }[] {
    // 逐 tuple 解析（旧惰性可选分组正则会丢失 file/line，已实证；第五十轮 D3）
    return parseStackFrameTuples(s).map((t) => ({
      id: t.level,
      name: t.func ?? '?',
      file: t.fullname || t.file,
      line: t.line,
      addr: t.addr,
    }));
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
