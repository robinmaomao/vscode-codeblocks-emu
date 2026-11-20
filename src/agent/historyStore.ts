/**
 * Agent 变更历史：工作区级快照、审计日志、latest-per-file 撤销。
 *
 * 设计约束：
 * - 不依赖 vscode，便于纯 Node 单元测试；
 * - 历史写入失败不能影响工具执行，错误通过 onError 上报；
 * - 所有索引/审计写入串行化，避免并发工具调用互相覆盖。
 */
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import {
  AgentCallAudit,
  AgentChangeEntry,
  AgentHistoryCapture,
  AgentHistoryCaptureRequest,
  AgentHistoryChangeInfo,
  AgentHistoryError,
  AgentHistoryHooks,
  AgentHistoryOutcome,
  AgentWriteTarget,
} from '../api/agentHistory';

export interface AgentHistoryStoreOptions {
  /** 工作区扩展存储下的 agent-history 目录 */
  rootDir: string;
  /** 用于把绝对路径转成 UI 友好的相对路径；可传多个工作区根 */
  workspaceRoots?: string[];
  maxEntries?: number;
  retentionDays?: number;
  auditMaxBytes?: number;
  now?: () => Date;
  onError?: (message: string, error: unknown) => void;
}

export interface AgentHistoryStats {
  entries: number;
  auditBytes: number;
  rootDir: string;
}

export interface AgentUndoResult {
  entry: AgentChangeEntry;
  restoredBytes: number;
}

export interface AgentUndoOptions {
  /** 允许覆盖撤销期间的外部修改 / 重建缺失文件 */
  force?: boolean;
}

interface PendingSnapshot {
  target: AgentWriteTarget;
  before: Buffer;
  beforeHash: string;
  beforeBytes: number;
  mode?: number;
}

interface PendingCapture {
  startedAt: number;
  request: AgentHistoryCaptureRequest;
  snapshots: PendingSnapshot[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PENDING_TTL_MS = 5 * 60 * 1000;
/** 这些错误在 handler 写盘前返回；即使文件在此期间被外部修改，也不应算作 Agent 变更。 */
const PRE_WRITE_ERROR_CODES = new Set([
  'external-modified',
  'invalid-input',
  'project-not-found',
  'workspace-not-found',
  'read-only',
  'disabled',
  'unsupported',
  'build-busy',
]);

function hashBuffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function normalizePath(file: string): string {
  return path.resolve(file);
}

function isEntry(value: unknown): value is AgentChangeEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<AgentChangeEntry>;
  return typeof entry.id === 'string'
    && typeof entry.at === 'string'
    && typeof entry.tool === 'string'
    && typeof entry.file === 'string'
    && typeof entry.beforeHash === 'string'
    && typeof entry.afterHash === 'string'
    && typeof entry.beforeBytes === 'number'
    && typeof entry.afterBytes === 'number'
    && typeof entry.snapshot === 'string'
    && (entry.status === 'applied' || entry.status === 'undone' || entry.status === 'corrupt');
}

export class AgentHistoryStore implements AgentHistoryHooks {
  private readonly rootDir: string;
  private readonly snapshotsDir: string;
  private readonly indexPath: string;
  private readonly auditPath: string;
  private readonly workspaceRoots: string[];
  private maxEntries: number;
  private readonly retentionDays: number;
  private readonly auditMaxBytes: number;
  private readonly now: () => Date;
  private readonly onError?: (message: string, error: unknown) => void;
  private readonly pending = new Map<string, PendingCapture>();
  private chain: Promise<void> = Promise.resolve();
  private enabledState = true;

  constructor(opts: AgentHistoryStoreOptions) {
    this.rootDir = opts.rootDir;
    this.snapshotsDir = path.join(this.rootDir, 'snapshots');
    this.indexPath = path.join(this.rootDir, 'index.json');
    this.auditPath = path.join(this.rootDir, 'audit.jsonl');
    this.workspaceRoots = (opts.workspaceRoots ?? []).map((p) => path.resolve(p));
    this.maxEntries = Math.max(1, Math.floor(opts.maxEntries ?? 50));
    this.retentionDays = Math.max(1, opts.retentionDays ?? 14);
    this.auditMaxBytes = Math.max(4096, opts.auditMaxBytes ?? 2 * 1024 * 1024);
    this.now = opts.now ?? (() => new Date());
    this.onError = opts.onError;
    this.ensureLayout();
  }

  get enabled(): boolean {
    return this.enabledState;
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  setEnabled(value: boolean): void {
    this.enabledState = value;
  }

  setLimits(maxEntries: number): void {
    const value = Math.floor(Number(maxEntries));
    this.maxEntries = Math.max(1, Math.min(200, Number.isFinite(value) ? value : 50));
  }

  get root(): string {
    return this.rootDir;
  }

  get auditFile(): string {
    return this.auditPath;
  }

  private ensureLayout(): void {
    fs.mkdirSync(this.snapshotsDir, { recursive: true, mode: 0o700 });
  }

  private report(message: string, error: unknown): void {
    try {
      this.onError?.(message, error);
    } catch {
      // 诊断回调自身失败不能影响主流程。
    }
  }

  private enqueue<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.then(() => undefined, () => undefined);
    return next;
  }

  private relativeFor(file: string): string | undefined {
    const abs = normalizePath(file);
    for (const root of this.workspaceRoots) {
      const rel = path.relative(root, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return rel.replace(/\\/g, '/');
      }
    }
    return undefined;
  }

  private sameFile(a: string, b: string): boolean {
    const left = normalizePath(a);
    const right = normalizePath(b);
    return process.platform === 'win32'
      ? left.toLowerCase() === right.toLowerCase()
      : left === right;
  }

  private readIndex(): AgentChangeEntry[] {
    let text: string;
    try {
      text = fs.readFileSync(this.indexPath, 'utf8');
    } catch {
      return [];
    }
    try {
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('index root is not an array');
      return parsed
        .filter(isEntry)
        .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    } catch (err) {
      // 损坏索引隔离后从空历史继续：宁可丢历史，也不能阻断工具调用。
      try {
        const quarantine = `${this.indexPath}.corrupt-${Date.now()}`;
        fs.renameSync(this.indexPath, quarantine);
      } catch {
        // 隔离失败时保留原文件，下一次读取会再次尝试。
      }
      this.report('agent history index is corrupt; starting with an empty history', err);
      return [];
    }
  }

  private writeIndex(entries: AgentChangeEntry[]): void {
    const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    this.writeBufferAtomic(this.indexPath, Buffer.from(JSON.stringify(sorted, null, 2), 'utf8'), 0o600);
  }

  private writeBufferAtomic(file: string, data: Buffer, mode?: number): void {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = path.join(
      path.dirname(file),
      `.${path.basename(file)}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`,
    );
    try {
      fs.writeFileSync(tmp, data, mode === undefined ? undefined : { mode });
      if (mode !== undefined && process.platform !== 'win32') fs.chmodSync(tmp, mode);
      fs.renameSync(tmp, file);
    } catch (err) {
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch { /* 清理失败不掩盖原始错误 */ }
      throw err;
    }
  }

  private pruneEntries(entries: AgentChangeEntry[]): { keep: AgentChangeEntry[]; removed: AgentChangeEntry[] } {
    const cutoff = this.now().getTime() - this.retentionDays * DAY_MS;
    const sorted = [...entries].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    const keep: AgentChangeEntry[] = [];
    const removed: AgentChangeEntry[] = [];
    for (const entry of sorted) {
      const at = Date.parse(entry.at);
      if (keep.length >= this.maxEntries || !Number.isFinite(at) || at < cutoff) {
        removed.push(entry);
        continue;
      }
      keep.push(entry);
    }
    return { keep, removed };
  }

  private removeSnapshots(entries: AgentChangeEntry[]): void {
    for (const entry of entries) {
      try {
        const snapshotRel = entry.snapshot.replace(/\\/g, '/');
        if (!path.isAbsolute(entry.snapshot) && !snapshotRel.includes('..') && snapshotRel.startsWith('snapshots/')) {
          fs.rmSync(path.join(this.rootDir, entry.snapshot), { force: true });
        }
      } catch (err) {
        this.report(`failed to remove expired history snapshot: ${entry.snapshot}`, err);
      }
    }
  }

  async capture(request: AgentHistoryCaptureRequest): Promise<AgentHistoryCapture | undefined> {
    if (!this.enabledState) return undefined;

    // 清理没有走到 finish 的挂起捕获，避免异常路径长期占用内存。
    const now = Date.now();
    for (const [id, pending] of this.pending) {
      if (now - pending.startedAt > PENDING_TTL_MS) this.pending.delete(id);
    }

    const id = crypto.randomBytes(12).toString('hex');
    const snapshots: PendingSnapshot[] = [];
    for (const target of request.targets) {
      try {
        const stat = fs.statSync(target.file);
        if (!stat.isFile()) continue;
        const before = fs.readFileSync(target.file);
        snapshots.push({
          target,
          before,
          beforeHash: hashBuffer(before),
          beforeBytes: before.length,
          mode: stat.mode & 0o777,
        });
      } catch (err) {
        this.report(`failed to snapshot write target: ${target.file}`, err);
      }
    }
    this.pending.set(id, { startedAt: now, request, snapshots });
    return { id };
  }

  async finish(capture: AgentHistoryCapture | undefined, outcome: AgentHistoryOutcome): Promise<AgentHistoryChangeInfo[]> {
    if (!capture) return [];
    const pending = this.pending.get(capture.id);
    if (!pending) return [];
    this.pending.delete(capture.id);

    const changes: AgentHistoryChangeInfo[] = [];
    for (const snapshot of pending.snapshots) {
      let after: Buffer | undefined;
      try {
        after = fs.readFileSync(snapshot.target.file);
      } catch {
        after = undefined;
      }
      const afterHash = after ? hashBuffer(after) : '';
      if (afterHash === snapshot.beforeHash) continue;
      if (!outcome.ok && outcome.code && PRE_WRITE_ERROR_CODES.has(outcome.code)) continue;

      const info: AgentHistoryChangeInfo = {
        file: snapshot.target.file,
        relativeFile: this.relativeFor(snapshot.target.file),
        beforeBytes: snapshot.beforeBytes,
        afterBytes: after?.length ?? 0,
      };
      changes.push(info);
      try {
        await this.enqueue(() => this.recordChange(pending, snapshot, after, afterHash, outcome));
      } catch (err) {
        this.report(`failed to persist agent history for ${snapshot.target.file}`, err);
      }
    }
    return changes;
  }

  private recordChange(
    pending: PendingCapture,
    snapshot: PendingSnapshot,
    after: Buffer | undefined,
    afterHash: string,
    outcome: AgentHistoryOutcome,
  ): void {
    const id = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
    const snapshotRel = `snapshots/${id}.before`;
    this.writeBufferAtomic(path.join(this.rootDir, snapshotRel), snapshot.before, 0o600);

    const entry: AgentChangeEntry = {
      id,
      at: this.now().toISOString(),
      tool: pending.request.tool,
      action: typeof pending.request.input.action === 'string' ? pending.request.input.action : undefined,
      file: normalizePath(snapshot.target.file),
      relativeFile: this.relativeFor(snapshot.target.file),
      beforeHash: snapshot.beforeHash,
      afterHash,
      beforeBytes: snapshot.beforeBytes,
      afterBytes: after?.length ?? 0,
      snapshot: snapshotRel,
      status: 'applied',
      mode: snapshot.mode,
      errorCode: outcome.ok ? undefined : outcome.code,
    };

    const entries = this.readIndex();
    entries.unshift(entry);
    const { keep, removed } = this.pruneEntries(entries);
    this.writeIndex(keep);
    this.removeSnapshots(removed);
  }

  list(): AgentChangeEntry[] {
    return this.readIndex();
  }

  async prune(): Promise<void> {
    await this.enqueue(() => {
      const entries = this.readIndex();
      const { keep, removed } = this.pruneEntries(entries);
      if (keep.length !== entries.length) this.writeIndex(keep);
      this.removeSnapshots(removed);
    });
  }

  stats(): AgentHistoryStats {
    const entries = this.list();
    let auditBytes = 0;
    try { auditBytes = fs.statSync(this.auditPath).size; } catch { /* no audit yet */ }
    return { entries: entries.length, auditBytes, rootDir: this.rootDir };
  }

  async recordCall(call: AgentCallAudit): Promise<void> {
    if (!this.enabledState) return;
    try {
      await this.enqueue(() => this.appendAudit(call));
    } catch (err) {
      this.report(`failed to append agent audit log`, err);
    }
  }

  private appendAudit(call: AgentCallAudit): void {
    this.ensureLayout();
    try {
      if (fs.statSync(this.auditPath).size > this.auditMaxBytes) {
        const rotated = `${this.auditPath}.1`;
        try { fs.rmSync(rotated, { force: true }); } catch { /* ignore */ }
        fs.renameSync(this.auditPath, rotated);
      }
    } catch {
      // 文件不存在或无法 stat：直接追加即可。
    }

    const input = call.input ?? {};
    const args: Record<string, unknown> = {};
    for (const key of ['action', 'section', 'target', 'format', 'dryRun', 'kind', 'force', 'allowScripts']) {
      const value = input[key];
      if (value === undefined || value === null) continue;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') args[key] = value;
    }
    if (Array.isArray(input.ops)) args.ops = input.ops.length;
    if (Array.isArray(input.files)) args.files = input.files.length;
    if (Array.isArray(input.dependencies)) args.dependencies = input.dependencies.length;

    const record = {
      at: call.at,
      id: call.id,
      tool: call.tool,
      ok: call.ok,
      code: call.code,
      durationMs: call.durationMs,
      args,
      changedFiles: call.changedFiles,
    };
    fs.appendFileSync(this.auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async undo(id: string, opts: AgentUndoOptions = {}): Promise<AgentUndoResult> {
    return this.enqueue(() => this.undoNow(id, opts));
  }

  private undoNow(id: string, opts: AgentUndoOptions): AgentUndoResult {
    const entries = this.readIndex();
    const entry = entries.find((e) => e.id === id);
    if (!entry) throw new AgentHistoryError('not-found', `Agent change not found: ${id}`);
    if (entry.status === 'undone') throw new AgentHistoryError('already-undone', `Agent change already undone: ${id}`);
    if (entry.status === 'corrupt') throw new AgentHistoryError('corrupt', `Agent change snapshot is corrupt: ${id}`);

    const latest = entries.find((e) => this.sameFile(e.file, entry.file) && e.status !== 'undone');
    if (latest && latest.id !== entry.id) {
      throw new AgentHistoryError('superseded', `A newer Agent change exists for ${entry.file}`, {
        latestId: latest.id,
        latestAt: latest.at,
      });
    }

    const ext = path.extname(entry.file).toLowerCase();
    if (!path.isAbsolute(entry.file) || (ext !== '.cbp' && ext !== '.workspace')) {
      throw new AgentHistoryError('corrupt', `Unsupported history target: ${entry.file}`);
    }
    if (path.isAbsolute(entry.snapshot) || entry.snapshot.includes('..')) {
      throw new AgentHistoryError('corrupt', `Invalid snapshot path: ${entry.snapshot}`);
    }

    const snapshotPath = path.join(this.rootDir, entry.snapshot);
    const snapshotRoot = path.resolve(this.snapshotsDir) + path.sep;
    if (!path.resolve(snapshotPath).startsWith(snapshotRoot)) {
      throw new AgentHistoryError('corrupt', `Invalid snapshot path: ${entry.snapshot}`);
    }

    let before: Buffer;
    try {
      before = fs.readFileSync(snapshotPath);
    } catch (err) {
      entry.status = 'corrupt';
      try { this.writeIndex(entries); } catch { /* ignore */ }
      throw new AgentHistoryError('corrupt', `Snapshot missing: ${entry.snapshot}`, err);
    }
    if (hashBuffer(before) !== entry.beforeHash) {
      entry.status = 'corrupt';
      try { this.writeIndex(entries); } catch { /* ignore */ }
      throw new AgentHistoryError('corrupt', `Snapshot hash mismatch: ${entry.snapshot}`);
    }

    let current: Buffer | undefined;
    try {
      current = fs.readFileSync(entry.file);
    } catch {
      current = undefined;
    }
    if (!current) {
      if (!opts.force) {
        throw new AgentHistoryError('missing', `File no longer exists: ${entry.file}`, { file: entry.file });
      }
    } else if (hashBuffer(current) !== entry.afterHash && !opts.force) {
      throw new AgentHistoryError('conflict', `File was modified after the Agent change: ${entry.file}`, {
        file: entry.file,
        expected: entry.afterHash,
        actual: hashBuffer(current),
      });
    }

    try {
      this.writeBufferAtomic(entry.file, before, entry.mode);
    } catch (err) {
      throw new AgentHistoryError('io-error', `Failed to restore ${entry.file}: ${(err as Error).message}`, err);
    }

    entry.status = 'undone';
    entry.undoneAt = this.now().toISOString();
    try {
      this.writeIndex(entries);
    } catch (err) {
      this.report(`failed to mark history entry undone: ${entry.id}`, err);
    }
    return { entry, restoredBytes: before.length };
  }

  async clear(): Promise<void> {
    await this.enqueue(() => {
      fs.rmSync(this.rootDir, { recursive: true, force: true });
      this.pending.clear();
      this.ensureLayout();
    });
  }
}
