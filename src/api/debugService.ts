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

  constructor(private readonly deps: DebugServiceDeps) {}

  private requireSession(): GdbMiSession {
    if (!this.mi) fail('not-running', 'No debug session is running');
    return this.mi!;
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
    await mi.start({ gdbPath, cwd: plan.cwd, env: plan.env, nx: true });
    this.mi = mi;
    await mi.sendPositional('-file-exec-and-symbols', [plan.executable]);
    if (plan.args) await mi.sendPositional('-exec-arguments', [plan.args]);
    if (req.file && req.lines?.length) {
      for (const line of req.lines.filter((l) => Number.isInteger(l) && l > 0)) {
        await mi.sendPositional('-break-insert', [`${req.file}:${line}`]);
      }
    }
    if (req.stopOnEntry) {
      await mi.sendPositional('-break-insert', ['main']);
    }
    const stop = this.waitForStop(timeoutMs);
    await mi.sendPositional('-exec-run', []);
    await stop.catch(() => undefined);
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
    if (!this.mi) return { ok: true, alreadyStopped: true };
    try { await this.mi.sendPositional('-exec-interrupt', []); } catch { /* 可能已停止 */ }
    this.mi.dispose();
    this.mi = null;
    this.stopped = false;
    return { ok: true };
  }

  async setBreakpoints(req: DebugRequest): Promise<unknown> {
    const mi = this.requireSession();
    const file = req.file;
    if (!file) fail('invalid-input', 'An absolute source file path is required');
    const lines = (req.lines ?? []).filter((l) => Number.isInteger(l) && l > 0);
    for (const line of lines) {
      await mi.sendPositional('-break-insert', [`${file}:${line}`]);
    }
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

  async variables(): Promise<unknown> {
    const mi = this.requireSession();
    const res = await mi.sendExact('-stack-list-variables --all-values');
    return { variables: parseVariableTuples(res.attrs.variables ?? '') };
  }

  async evaluate(req: DebugRequest): Promise<unknown> {
    const mi = this.requireSession();
    const expression = req.expression;
    if (!expression) fail('invalid-input', 'An expression is required');
    const res = await mi.sendPositional('-data-evaluate-expression', [expression!]);
    return { expression, value: res.attrs.value ?? '' };
  }

  async continue(): Promise<unknown> {
    const mi = this.requireSession();
    const stop = this.waitForStop(30000);
    await mi.sendPositional('-exec-continue', []);
    await stop.catch(() => undefined);
    return { ok: true, stopped: this.stopped, reason: this.lastStopReason, threadId: this.threadId };
  }

  async step(req: DebugRequest): Promise<unknown> {
    const mi = this.requireSession();
    const cmd = req.kind === 'stepIn' ? 'exec-step' : req.kind === 'stepOut' ? 'exec-finish' : 'exec-next';
    const stop = this.waitForStop(30000);
    await mi.sendPositional(cmd, []);
    await stop.catch(() => undefined);
    return { ok: true, command: cmd, stopped: this.stopped, reason: this.lastStopReason, threadId: this.threadId };
  }

  dispose(): void {
    try { this.mi?.dispose(); } catch { /* 进程可能已退出 */ }
    this.mi = null;
  }
}

/** 创建无头调试器（CLI/MCP 每个进程一个） */
export function createHeadlessDebugger(deps: DebugServiceDeps): HeadlessDebugger {
  return new HeadlessDebugger(deps);
}
