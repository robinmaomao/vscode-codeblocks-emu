/**
 * 无头调试服务（无 vscode 依赖）：CLI / MCP 用 `GdbMiSession` 驱动 GDB/MI。
 *
 * 范围：非交互子集（启动/停止/断点/栈/变量/求值/继续/单步）。
 * 断点命中后的 UI 式浏览（registers/内存/反汇编）由扩展内的 `codeblocks_debug` 提供。
 */
import * as fs from 'fs';
import * as path from 'path';
import { GdbMiSession, MiAsync } from '../debug/gdbMiSession';
import { parseStackFrameTuples, parseThreadTuples, splitMiTuples } from '../debug/miParse';
import { resolveRunPlan } from './runService';
import type { CompilerProvider } from './compilerService';
import type { CompilerSettingsLike } from '../compiler/compilerFactory';
import { fail } from './types';

export interface DebugServiceDeps {
  compiler: CompilerProvider;
  settings: CompilerSettingsLike;
}

export interface DebugRequest {
  action: 'start' | 'stop' | 'breakpoints' | 'state' | 'stack' | 'variables' | 'evaluate' | 'continue' | 'step';
  cbp?: string;
  target?: string;
  args?: string;
  stopOnEntry?: boolean;
  file?: string;
  lines?: number[];
  frameId?: number;
  expression?: string;
  kind?: 'next' | 'stepIn' | 'stepOut';
  timeoutMs?: number;
}

function miQuote(s: string): string {
  return `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * 从 `-break-insert` 的 `bkpt={number="1",...}` 里取断点号（解析失败 = undefined，退化为不跟踪）。
 * 单独导出便于回归测试（MI 嵌套元组是字符串，不能当对象用）。
 */
export function parseBreakpointNumber(attrs: Record<string, string> | undefined): number | undefined {
  const raw = attrs?.bkpt;
  if (!raw) return undefined;
  const m = /\bnumber="?(\d+)"?/.exec(raw);
  return m ? Number(m[1]) : undefined;
}

/** 解析 GDB 路径：settings.debug.gdbPath → 编译器 masterPath → PATH */
export function resolveGdbPath(deps: DebugServiceDeps, masterPath: string | undefined): string {
  const explicit = deps.settings.get<string>('debug.gdbPath', '');
  if (explicit && fs.existsSync(explicit)) return explicit;
  const exe = process.platform === 'win32' ? 'gdb.exe' : 'gdb';
  if (masterPath) {
    const candidate = path.join(masterPath, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'gdb';
}

/** 解析 `-stack-list-variables --all-values` 的 variables 属性 */
export function parseVariableTuples(raw: string): Array<{ name: string; value: string }> {
  const out: Array<{ name: string; value: string }> = [];
  for (const tuple of splitMiTuples(raw.replace(/^\[|\]$/g, ''))) {
    const name = /\bname="((?:\\.|[^"\\])*)"/.exec(tuple);
    const value = /\bvalue="((?:\\.|[^"\\])*)"/.exec(tuple);
    if (name) out.push({ name: name[1].replace(/\\"/g, '"'), value: value ? value[1].replace(/\\"/g, '"') : '' });
  }
  return out;
}

export class HeadlessDebugger {
  private mi: GdbMiSession | null = null;
  private threadId: number | undefined;
  private stopped = false;
  private lastStopReason = '';
  private stopWaiters: Array<() => void> = [];
  /** 每个源文件已注册的 gdb 断点号（用于「替换该文件的断点」语义，与宿主侧一致） */
  private breakpoints = new Map<string, number[]>();

  constructor(private readonly deps: DebugServiceDeps) {}

  private requireSession(): GdbMiSession {
    if (!this.mi) fail('not-running', 'No debug session is running');
    return this.mi!;
  }

  /** 清空会话状态（stop / dispose / start 失败时复用） */
  private resetState(): void {
    this.stopped = false;
    this.lastStopReason = '';
    this.threadId = undefined;
    this.breakpoints.clear();
    // 让仍在等待「停下」的调用立即返回（否则它们只能等 30s 超时）
    const waiters = this.stopWaiters;
    this.stopWaiters = [];
    for (const w of waiters) w();
  }

  private async insertBreakpoint(mi: GdbMiSession, file: string, line: number): Promise<number | undefined> {
    const res = await mi.sendPositional('-break-insert', [`${file}:${line}`]);
    return parseBreakpointNumber(res.attrs);
  }

  private waitForStop(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.stopped) { resolve(); return; }
      const timer = setTimeout(() => {
        this.stopWaiters = this.stopWaiters.filter((w) => w !== onStop);
        reject(new Error(`Timed out waiting for GDB to stop (${timeoutMs} ms)`));
      }, timeoutMs);
      const onStop = (): void => { clearTimeout(timer); resolve(); };
      this.stopWaiters.push(onStop);
    });
  }

  /**
   * 恢复运行/单步并等待程序停下。
   *
   * 必须在发命令**之前**清掉 `stopped`（断点处调用 continue 时 `waitForStop` 会立即返回旧状态），
   * 命令发送失败时必须先把等待器的 rejection 吞掉，否则 30s 后会出现
   * unhandled rejection（Node 未来版本会直接终止进程）。
   */
  private async resumeAndWait(mi: GdbMiSession, command: string, positional: string[], timeoutMs: number): Promise<void> {
    const wasStopped = this.stopped;
    this.stopped = false;
    const stop = this.waitForStop(timeoutMs);
    try {
      await mi.sendPositional(command, positional);
    } catch (err) {
      // 命令没发出去 = 程序仍在原停止点：恢复「已停止」，别让 state() 说谎
      this.stopped = wasStopped;
      await stop.catch(() => undefined);
      throw err;
    }
    await stop.catch(() => undefined);
  }

  private handleAsync(rec: MiAsync): void {
    if (rec.kind !== 'exec') return;
    if (rec.record === 'stopped') {
      this.stopped = true;
      this.lastStopReason = rec.attrs.reason ?? rec.attrs.signal ?? '';
      const thread = rec.attrs['thread-id'];
      if (thread && Number.isFinite(Number(thread))) this.threadId = Number(thread);
      const waiters = [...this.stopWaiters];
      this.stopWaiters = [];
      for (const w of waiters) w();
    } else if (rec.record === 'running') {
      this.stopped = false;
    }
  }

  async start(req: DebugRequest): Promise<unknown> {
    if (this.mi) fail('invalid-input', 'A debug session is already running');
    const cbp = req.cbp;
    if (!cbp) fail('invalid-input', 'A .cbp path is required to start debugging');
    const plan = resolveRunPlan({ cbp: cbp!, target: req.target, args: req.args }, { compiler: this.deps.compiler });
    const masterPath = this.deps.compiler.getCompiler(plan.target.compilerId || plan.project.compilerId)?.masterPath;
    const gdbPath = resolveGdbPath(this.deps, masterPath);
    const timeoutMs = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 30000;

    const mi = new GdbMiSession(timeoutMs);
    mi.onAsyncRecord = (rec) => this.handleAsync(rec);
    try {
      await mi.start({ gdbPath, cwd: plan.cwd, env: plan.env, nx: true });
    } catch (err) {
      // gdb 进程可能已 spawn（如就绪探测超时）：失败路径必须回收，否则长驻进程会残留 gdb
      try { mi.dispose(); } catch { /* 进程可能已退出 */ }
      // ENOENT 是最常见的配置错误：给出可执行的提示，而不是裸 "spawn gdb ENOENT"
      if (err instanceof Error && /ENOENT/.test(err.message)) {
        fail('compiler-missing', `GDB was not found: ${gdbPath}`, {
          hint: 'Set codeblocks.debug.gdbPath, put gdb next to the compiler (masterPath), or add it to PATH.',
        });
      }
      throw err;
    }
    this.mi = mi;
    try {
      await mi.sendPositional('-file-exec-and-symbols', [plan.executable]);
      if (plan.args) await mi.sendPositional('-exec-arguments', [plan.args]);
      if (req.file && req.lines?.length) {
        const numbers: number[] = [];
        for (const line of req.lines.filter((l) => Number.isInteger(l) && l > 0)) {
          const num = await this.insertBreakpoint(mi, req.file, line);
          if (num !== undefined) numbers.push(num);
        }
        this.breakpoints.set(path.resolve(req.file), numbers);
      }
      if (req.stopOnEntry) {
        await mi.sendPositional('-break-insert', ['main']);
      }
      const stop = this.waitForStop(timeoutMs);
      try {
        await mi.sendPositional('-exec-run', []);
      } catch (err) {
        await stop.catch(() => undefined);
        throw err;
      }
      await stop.catch(() => undefined);
    } catch (err) {
      // 启动中途失败：必须回收 gdb 会话，否则后续 start 永远报「已在运行」
      try { mi.dispose(); } catch { /* 进程可能已退出 */ }
      this.mi = null;
      this.resetState();
      throw err;
    }
    const threads = await mi.sendExact('-thread-info').then((r) => parseThreadTuples(r.attrs.threads ?? '')).catch(() => []);
    if (this.threadId === undefined && threads.length) this.threadId = threads[0].id;
    return {
      ok: true,
      gdb: gdbPath,
      program: plan.executable,
      cwd: plan.cwd,
      stopped: this.stopped,
      reason: this.lastStopReason,
      threadId: this.threadId,
    };
  }

  async stop(): Promise<unknown> {
    if (!this.mi) {
      this.resetState();
      return { ok: true, alreadyStopped: true };
    }
    try { await this.mi.sendPositional('-exec-interrupt', []); } catch { /* 可能已停止 */ }
    this.mi.dispose();
    this.mi = null;
    this.resetState();
    return { ok: true };
  }

  /** 替换该文件的断点（与宿主侧 vscode.debug.setBreakpoints 语义一致） */
  async setBreakpoints(req: DebugRequest): Promise<unknown> {
    const mi = this.requireSession();
    const file = req.file;
    if (!file) fail('invalid-input', 'An absolute source file path is required');
    const key = path.resolve(file);
    for (const num of this.breakpoints.get(key) ?? []) {
      // 断点可能已被删除：删除失败不阻断后续设置
      try { await mi.sendPositional('-break-delete', [String(num)]); } catch { /* 忽略 */ }
    }
    const lines = (req.lines ?? []).filter((l) => Number.isInteger(l) && l > 0);
    const numbers: number[] = [];
    for (const line of lines) {
      const num = await this.insertBreakpoint(mi, file, line);
      if (num !== undefined) numbers.push(num);
    }
    this.breakpoints.set(key, numbers);
    const list = await mi.sendExact('-break-list').catch(() => undefined);
    return { ok: true, file, lines, breakpoints: list?.attrs['BreakpointTable'] ? 'registered' : 'unknown' };
  }

  state(): unknown {
    return {
      active: !!this.mi,
      stopped: this.stopped,
      reason: this.lastStopReason,
      threadId: this.threadId,
    };
  }

  async stack(): Promise<unknown> {
    const mi = this.requireSession();
    const threadId = this.threadId ?? 1;
    const res = await mi.sendExact(`-stack-list-frames 0 30`);
    return {
      threadId,
      frames: parseStackFrameTuples(res.attrs.stack ?? '').map((f) => ({
        level: f.level, addr: f.addr, func: f.func, file: f.file, fullname: f.fullname, line: f.line,
      })),
    };
  }

  async variables(req?: { frameId?: number }): Promise<unknown> {
    const mi = this.requireSession();
    if (req?.frameId !== undefined) {
      // 与 LM Tools 的 variables({frameId}) 对齐：先选帧再取变量
      await mi.sendPositional('-stack-select-frame', [String(req.frameId)]);
    }
    const res = await mi.sendExact('-stack-list-variables --all-values');
    return { frameId: req?.frameId, variables: parseVariableTuples(res.attrs.variables ?? '') };
  }

  async evaluate(req: DebugRequest): Promise<unknown> {
    const mi = this.requireSession();
    const expression = req.expression;
    if (!expression) fail('invalid-input', 'An expression is required');
    if (req.frameId !== undefined) {
      await mi.sendPositional('-stack-select-frame', [String(req.frameId)]);
    }
    const res = await mi.sendPositional('-data-evaluate-expression', [expression!]);
    return { expression, value: res.attrs.value ?? '' };
  }

  async continue(req?: { timeoutMs?: number }): Promise<unknown> {
    const mi = this.requireSession();
    // 先清掉「已停止」：否则在断点处调用 continue 时 waitForStop 会立即返回旧状态
    const timeoutMs = req?.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 30000;
    await this.resumeAndWait(mi, '-exec-continue', [], timeoutMs);
    return { ok: true, stopped: this.stopped, reason: this.lastStopReason, threadId: this.threadId };
  }

  async step(req: DebugRequest): Promise<unknown> {
    const mi = this.requireSession();
    const cmd = req.kind === 'stepIn' ? 'exec-step' : req.kind === 'stepOut' ? 'exec-finish' : 'exec-next';
    const timeoutMs = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 30000;
    await this.resumeAndWait(mi, cmd, [], timeoutMs);
    return { ok: true, command: cmd, stopped: this.stopped, reason: this.lastStopReason, threadId: this.threadId };
  }

  dispose(): void {
    try { this.mi?.dispose(); } catch { /* 进程可能已退出 */ }
    this.mi = null;
    this.resetState();
  }
}

/** 创建无头调试器（CLI/MCP 每个进程一个） */
export function createHeadlessDebugger(deps: DebugServiceDeps): HeadlessDebugger {
  return new HeadlessDebugger(deps);
}
