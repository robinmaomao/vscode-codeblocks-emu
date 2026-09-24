/**
 * DAP 调试适配器（内联实现）—— 对应 debuggergdb/gdb_driver.cpp 的驱动角色
 *
 * 实现 Debug Adapter Protocol，内部直接驱动 GDB MI（GdbMiSession）。
 * 不使用 launch.json 预配置，也不依赖 cppdbg/CodeLLDB。
 */
import * as vscode from 'vscode';
import { GdbMiSession, MiResult, MiAsync } from './gdbMiSession';

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
}

/** GDB MI varobj 子节点（-var-list-children 返回的 child 元组） */
interface ChildVar {
  name: string;      // varobj 名，如 "var_1.a"
  exp: string;       // 表达式，如 "a"
  numchild: number;
  type: string;
  value: string;
}

export class GdbDebugAdapter implements vscode.DebugAdapter {
  private session: GdbMiSession | null = null;
  private emitter = new vscode.EventEmitter<vscode.DebugProtocolMessage>();
  private seq = 0;
  private breakpoints = new Map<string, BpInfo[]>(); // source path -> breakpoints
  private functionBreakpoints = new Map<string, BpInfo[]>(); // function name -> breakpoints
  private threads: { id: number; name: string }[] = [];
  private stackFrames: { id: number; name: string; file?: string; line?: number }[] = [];
  private gdbPath = 'gdb';
  private program = '';
  private cwd = '';
  // varobj 引用管理（子节点展开）
  private varSeq = 0;                                  // 生成 varobj 名
  private varRefCounter = 10000;                       // 生成 variablesReference
  private varNameToRef = new Map<string, number>();
  private varRefToName = new Map<number, string>();

  onDidSendMessage = this.emitter.event;

  handleMessage(message: vscode.DebugProtocolMessage): void {
    const msg = message as DapRequest;
    switch (msg.command) {
      case 'initialize': this.onInitialize(msg); break;
      case 'launch': this.onLaunch(msg); break;
      case 'setBreakpoints': this.onSetBreakpoints(msg); break;
      case 'setFunctionBreakpoints': this.onSetFunctionBreakpoints(msg); break;
      case 'setVariable': this.onSetVariable(msg); break;
      case 'configurationDone': this.onConfigurationDone(msg); break;
      case 'threads': this.onThreads(msg); break;
      case 'stackTrace': this.onStackTrace(msg); break;
      case 'scopes': this.onScopes(msg); break;
      case 'variables': this.onVariables(msg); break;
      case 'continue': this.onContinue(msg); break;
      case 'next': this.onStep(msg, '-exec-next'); break;
      case 'stepIn': this.onStep(msg, '-exec-step'); break;
      case 'stepOut': this.onStep(msg, '-exec-finish'); break;
      case 'pause': this.onPause(msg); break;
      case 'evaluate': this.onEvaluate(msg); break;
      case 'disconnect': this.onDisconnect(msg); break;
      default:
        this.sendResponse(msg, true, {});
    }
  }

  dispose(): void {
    this.session?.dispose();
    this.session = null;
  }

  // ---- 响应/事件辅助 ----
  private sendResponse(req: DapRequest, success: boolean, body: any, message?: string): void {
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
    });
    this.sendEvent('initialized', {});
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

    this.session = new GdbMiSession(vscode.workspace.getConfiguration('codeblocks').get<number>('gdbTimeoutMs', 30000));
    this.session.onAsyncRecord = (rec) => this.handleAsync(rec);
    this.session.onConsole = (t) => this.sendOutput('console', t);
    this.session.onLog = (t) => this.sendOutput('console', t);
    this.session.onTargetOutput = (t) => this.sendOutput('stdout', t);
    this.session.onExit = (code) => {
      this.sendEvent('terminated', {});
      this.sendEvent('exited', { exitCode: code ?? 0 });
    };

    try {
      await this.session.start({
        gdbPath: this.gdbPath,
        program: this.program,
        cwd: this.cwd,
        args: Array.isArray(args.args) ? (args.args as string[]) : [],
        env: (args.environment as Record<string, string>) ?? {},
      });
      this.sendResponse(req, true, {});
    } catch (err) {
      this.sendResponse(req, false, {}, `GDB 启动失败: ${(err as Error).message}`);
    }
  }

  private async onSetBreakpoints(req: DapRequest): Promise<void> {
    const args = (req as any).arguments;
    const sourcePath: string = args.source?.path ?? '';
    const requested: { line: number; condition?: string }[] = args.breakpoints ?? [];
    if (!this.session || !sourcePath) {
      this.sendResponse(req, true, { breakpoints: requested.map((b) => ({ verified: false, line: b.line })) });
      return;
    }

    // 清除该文件的旧断点（按编号逐个删除）
    const old = this.breakpoints.get(sourcePath) ?? [];
    for (const bp of old) {
      if (bp.gdbNum) { try { await this.session.sendMi('-break-delete', {}, [bp.gdbNum]); } catch { /* ignore */ } }
    }

    const result: BpInfo[] = [];
    for (const br of requested) {
      const line = br.line;
      const condition = br.condition;
      const bp: BpInfo = { line, verified: false, condition };
      try {
        const opts: Record<string, string> = { f: sourcePath, l: String(line) };
        if (condition) opts['c'] = condition;
        const r = await this.session.sendMi('-break-insert', opts);
        // MI 结果：^done,bkpt={number="1",...}
        bp.gdbNum = r.attrs['bkpt'] ? this.extractField(r.attrs['bkpt'], 'number') : undefined;
        bp.verified = true;
      } catch {
        bp.verified = false;
      }
      result.push(bp);
    }
    this.breakpoints.set(sourcePath, result);
    this.sendResponse(req, true, {
      breakpoints: result.map((b) => ({ verified: b.verified, line: b.line })),
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

    // 清除旧函数断点
    for (const list of this.functionBreakpoints.values()) {
      for (const bp of list) {
        if (bp.gdbNum) { try { await this.session.sendMi('-break-delete', {}, [bp.gdbNum]); } catch { /* ignore */ } }
      }
    }
    this.functionBreakpoints.clear();

    const result: { verified: boolean }[] = [];
    for (const br of requested) {
      const name = br.name;
      let verified = false;
      if (name) {
        try {
          const opts: Record<string, string> = {};
          if (br.condition) opts['c'] = br.condition;
          const r = await this.session.sendMi('-break-insert', opts, [name]);
          const gdbNum = r.attrs['bkpt'] ? this.extractField(r.attrs['bkpt'], 'number') : undefined;
          verified = true;
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
      if (ref === 1000 || ref === 2000) {
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
        // 子节点成员：父 varobj 名 + 成员名（GDB child varobj 命名约定 parent.member）
        const parentVar = this.varRefToName.get(ref);
        if (!parentVar) {
          this.sendResponse(req, false, {}, '找不到变量引用');
          return;
        }
        await this.session.sendMi('-var-assign', {}, [`${parentVar}.${name}`, value]);
        this.sendResponse(req, true, { value });
      }
    } catch (err) {
      this.sendResponse(req, false, {}, `修改变量失败: ${(err as Error).message}`);
    }
  }

  private async onConfigurationDone(req: DapRequest): Promise<void> {
    // 断点已设置，启动程序
    if (this.session) {
      try {
        await this.session.send('-exec-run');
      } catch { /* 可能立即停止 */ }
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
      })),
    });
  }

  private async onScopes(req: DapRequest): Promise<void> {
    this.sendResponse(req, true, {
      scopes: [
        { name: '本地变量', variablesReference: 1000, expensive: false },
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
      } else if (ref === 1000 || ref === 2000) {
        // 本地变量 / 全局变量
        const printValues = ref === 1000 ? '1' : '0';
        const r = await this.session.sendMi('-stack-list-variables', {}, [printValues]);
        vars = await this.parseVariables(r.attrs['variables'] ?? '', ref === 1000);
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

  private async onStep(req: DapRequest, cmd: string): Promise<void> {
    if (this.session) { try { await this.session.send(cmd); } catch { /* */ } }
    this.sendResponse(req, true, {});
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
      const r = await this.session.sendMi('-data-evaluate-expression', {}, [expr]);
      const value = r.attrs['value'] ?? '';
      this.sendResponse(req, true, { result: value, variablesReference: 0 });
    } catch {
      this.sendResponse(req, true, { result: '', variablesReference: 0 });
    }
  }

  private async onDisconnect(req: DapRequest): Promise<void> {
    this.sendResponse(req, true, {});
    this.dispose();
  }

  // ---- GDB MI 异步记录处理 ----
  private handleAsync(rec: MiAsync): void {
    if (rec.record === 'stopped') {
      const reason = rec.attrs['reason'] ?? 'breakpoint-hit';
      const threadId = Number(rec.attrs['thread-id'] ?? 1);
      const frame = rec.attrs['frame'];
      // 更新线程列表
      if (!this.threads.some((t) => t.id === threadId)) {
        this.threads.push({ id: threadId, name: `线程 ${threadId}` });
      }
      this.sendEvent('stopped', { reason, threadId, allThreadsStopped: true });
      // 触发线程与栈帧更新
      this.onThreads({ command: 'threads', seq: 0, type: 'request' } as any);
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

  private parseStackFrames(s: string): { id: number; name: string; file?: string; line?: number }[] {
    // 格式: [frame={level="0",func="main",file="x.c",line="10"},...]
    const out: { id: number; name: string; file?: string; line?: number }[] = [];
    const re = /level="(\d+)"[^}]*?func="([^"]*)"[^}]*?(?:file="([^"]*)")?[^}]*?(?:line="(\d+)")?/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      out.push({
        id: Number(m[1]),
        name: m[2] ?? '?',
        file: m[3] ?? undefined,
        line: m[4] ? Number(m[4]) : undefined,
      });
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
