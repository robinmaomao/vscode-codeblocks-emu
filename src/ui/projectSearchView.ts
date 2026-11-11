/**
 * 工程搜索 Sidebar WebviewView Provider。
 *
 * 职责：
 *  - 文件模式：读 openProjects 内存模型，prepared entries 缓存 + 签名自校验
 *  - 内容模式：worker_threads 隔离扫描；超时/取消/无进度终止；失败回退宿主内字面量扫描
 *  - 历史：workspaceState 按工作区隔离；保留历史开关写设置
 *  - 打开结果 / 工程树定位 / 状态持久化
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as i18n from '../i18n';
import { Project, ProjectFile } from '../model/types';
import {
  buildSearchEntries,
  buildSubtreeEntries,
  FILE_MAX_QUERY_LENGTH,
  FILE_SEARCH_LIMIT,
  FileSearchHit,
  projectDisplayTitle,
  ProjectSearchMode,
  ProjectSearchScope,
  rankSearchEntries,
  SearchEntry,
  searchEntriesSignature,
  TEXT_MAX_QUERY_LENGTH,
  TEXT_MAX_FILE_BYTES,
  TEXT_FILE_MATCH_LIMIT,
  TEXT_TOTAL_MATCH_LIMIT,
} from '../search/projectSearch';
import {
  addHistoryEntry,
  clearHistory,
  findHistoryEntry,
  historyForMode,
  parseHistory,
  SearchHistoryEntry,
  SearchHistoryLastResult,
  SearchHistoryState,
  updateLastResult,
} from '../search/searchHistory';
import { searchFileSet, TextFileResult, TextSearchFile } from '../search/textSearchTasks';
import { buildProjectSearchViewHtml } from './projectSearchViewHtml';

export const SEARCH_VIEW_ID = 'codeblocks.search';
export const SEARCH_HISTORY_KEY = 'codeblocks.search.history';
export const SEARCH_VIEW_STATE_KEY = 'codeblocks.search.viewState';
export const SEARCH_KEEP_HISTORY_SETTING = 'search.keepHistory';
export const SEARCH_SCOPE_SETTING = 'search.scope';

const DEFAULT_TOTAL_TIMEOUT_MS = 20_000;
const DEFAULT_NO_PROGRESS_TIMEOUT_MS = 5_000;
const WORKER_IDLE_MS = 5 * 60_000;

export interface ProjectSearchHost {
  getProjects(): Project[];
  getActiveProject(): Project | undefined;
  filesUnder(node: any): ProjectFile[];
  revealFile(project: Project, file: ProjectFile): Promise<void> | void;
  /** 打开并选中（line/column 0-based；length > 0 时选中匹配文本） */
  openLocation(file: string, line: number, column: number, length?: number): Promise<boolean>;
  /** 测试可注入 fake worker */
  createTextSearchWorker?: () => any;
  /** 测试可注入短超时 */
  searchTimeouts?: { totalMs?: number; noProgressMs?: number };
  output?: { appendLine(value: string): void };
}

interface PersistedViewState {
  mode: ProjectSearchMode;
  queries: Record<ProjectSearchMode, string>;
  scope: ProjectSearchScope;
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
}

interface SubtreeState {
  projectFilename: string;
  label: string;
  relativePaths: string[];
}

interface FileResultDto {
  id: string;
  projectTitle: string;
  projectFilename: string;
  relativePath: string;
  absolutePath: string;
  basename: string;
  isActive: boolean;
  ranges: { start: number; length: number }[];
}

interface TextMatchDto {
  id: string;
  line: number;
  column: number;
  length: number;
  preview: string;
  previewStart: number;
  previewLength: number;
}

interface TextFileDto {
  id: string;
  projectTitle: string;
  projectFilename: string;
  relativePath: string;
  absolutePath: string;
  isActive: boolean;
  matches: TextMatchDto[];
}

interface FileResultState {
  query: string;
  results: FileResultDto[];
  byId: Map<string, SearchEntry>;
  truncated: boolean;
  elapsedMs: number;
}

interface TextResultState {
  query: string;
  files: TextFileDto[];
  byId: Map<string, { file: TextSearchFile; match?: TextMatchDto }>;
  truncated: boolean;
  elapsedMs: number;
  matchCount: number;
}

interface ActiveWorkerSearch {
  id: number;
  resolve: (value: any) => void;
  reject: (err: Error) => void;
  onProgress?: (progress: { scanned: number; total: number; matches: number }) => void;
  totalTimer?: ReturnType<typeof setTimeout>;
  idleTimer?: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

function asMode(value: unknown): ProjectSearchMode | undefined {
  return value === 'files' || value === 'text' ? value : undefined;
}

function asScope(value: unknown): ProjectSearchScope | undefined {
  return value === 'openProjects' || value === 'activeProject' ? value : undefined;
}

function defaultViewState(): PersistedViewState {
  return { mode: 'files', queries: { files: '', text: '' }, scope: 'openProjects', caseSensitive: false, regex: false, wholeWord: false };
}

function sanitizeViewState(value: unknown): PersistedViewState {
  const base = defaultViewState();
  if (!value || typeof value !== 'object') return base;
  const raw = value as Record<string, unknown>;
  const mode = asMode(raw.mode);
  if (mode) base.mode = mode;
  const scope = asScope(raw.scope);
  if (scope) base.scope = scope;
  base.caseSensitive = raw.caseSensitive === true;
  base.regex = raw.regex === true;
  base.wholeWord = raw.wholeWord === true;
  if (raw.queries && typeof raw.queries === 'object') {
    const q = raw.queries as Record<string, unknown>;
    if (typeof q.files === 'string') base.queries.files = q.files.slice(0, FILE_MAX_QUERY_LENGTH + 1);
    if (typeof q.text === 'string') base.queries.text = q.text.slice(0, TEXT_MAX_QUERY_LENGTH + 1);
  }
  return base;
}

function sanitizeSubtree(value: unknown): SubtreeState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.projectFilename !== 'string' || !raw.projectFilename) return undefined;
  if (typeof raw.label !== 'string' || !raw.label) return undefined;
  if (!Array.isArray(raw.relativePaths)) return undefined;
  const relativePaths = raw.relativePaths.filter((x): x is string => typeof x === 'string' && !!x);
  if (!relativePaths.length) return undefined;
  return { projectFilename: raw.projectFilename, label: raw.label, relativePaths };
}

function samePath(a: string, b: string): boolean {
  return String(a).replace(/\\/g, '/').toLowerCase() === String(b).replace(/\\/g, '/').toLowerCase();
}

/** 内容搜索 worker 客户端（单飞：新搜索取消旧搜索） */
class TextSearchWorkerClient {
  private worker: any;
  private active: ActiveWorkerSearch | undefined;
  private seq = 0;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly totalTimeoutMs: number;
  private readonly noProgressTimeoutMs: number;

  constructor(
    private readonly factory: (() => any) | undefined,
    private readonly output?: { appendLine(value: string): void },
    timeouts?: { totalMs?: number; noProgressMs?: number },
  ) {
    this.totalTimeoutMs = timeouts?.totalMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.noProgressTimeoutMs = timeouts?.noProgressMs ?? DEFAULT_NO_PROGRESS_TIMEOUT_MS;
  }

  get available(): boolean {
    return typeof this.factory === 'function';
  }

  private ensureWorker(): any {
    if (this.worker) return this.worker;
    if (!this.factory) throw new Error('text search worker unavailable');
    const worker = this.factory();
    worker.on('message', (msg: any) => this.onMessage(msg));
    worker.on('error', (err: Error) => this.fail(err));
    worker.on('exit', (code: number) => {
      if (this.worker === worker) this.worker = undefined;
      if (this.active) this.fail(new Error(`text search worker exited (${code})`));
    });
    this.worker = worker;
    return worker;
  }

  private clearTimers(active: ActiveWorkerSearch): void {
    if (active.totalTimer) clearTimeout(active.totalTimer);
    if (active.idleTimer) clearTimeout(active.idleTimer);
    active.totalTimer = undefined;
    active.idleTimer = undefined;
  }

  private touchIdle(active: ActiveWorkerSearch): void {
    if (active.idleTimer) clearTimeout(active.idleTimer);
    active.idleTimer = setTimeout(() => {
      if (this.active?.id !== active.id) return;
      this.active = undefined;
      this.clearTimers(active);
      active.reject(new Error(i18n.t('Search timed out (no progress for {0} seconds)', Math.round(this.noProgressTimeoutMs / 1000))));
      this.terminate();
    }, this.noProgressTimeoutMs);
  }

  private fail(err: Error): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    this.clearTimers(active);
    active.reject(err);
    this.terminate();
  }

  private onMessage(msg: any): void {
    const active = this.active;
    if (!active || !msg || typeof msg !== 'object' || Number(msg.id) !== active.id) return;
    if (msg.type === 'progress') {
      this.touchIdle(active);
      active.onProgress?.({
        scanned: Number(msg.scanned) || 0,
        total: Number(msg.total) || 0,
        matches: Number(msg.matches) || 0,
      });
      return;
    }
    this.active = undefined;
    this.clearTimers(active);
    if (msg.type === 'result') {
      active.resolve(msg.result);
    } else if (msg.type === 'error') {
      active.reject(new Error(String(msg.message || i18n.t('Search failed'))));
    } else {
      active.reject(new Error(i18n.t('Search failed')));
    }
    this.scheduleIdle();
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.terminate(), WORKER_IDLE_MS);
  }

  search(
    files: TextSearchFile[],
    options: {
      query: string;
      caseSensitive: boolean;
      regex: boolean;
      wholeWord?: boolean;
      maxFileBytes?: number;
      maxFileMatches?: number;
      maxTotalMatches?: number;
      concurrency?: number;
    },
    onProgress?: (progress: { scanned: number; total: number; matches: number }) => void,
  ): { promise: Promise<any>; cancel: () => void } {
    const worker = this.ensureWorker();
    if (this.active) {
      const old = this.active;
      this.active = undefined;
      this.clearTimers(old);
      old.reject(new Error(i18n.t('Cancelled')));
    }
    const id = ++this.seq;
    const promise = new Promise<any>((resolve, reject) => {
      const active: ActiveWorkerSearch = { id, resolve, reject, onProgress, cancelled: false };
      this.active = active;
      active.totalTimer = setTimeout(() => {
        if (this.active?.id !== id) return;
        this.active = undefined;
        this.clearTimers(active);
        active.reject(new Error(i18n.t('Search timed out after {0} seconds', Math.round(this.totalTimeoutMs / 1000))));
        this.terminate();
      }, this.totalTimeoutMs);
      this.touchIdle(active);
      try {
        worker.postMessage({
          type: 'search',
          id,
          files,
          query: options.query,
          caseSensitive: options.caseSensitive,
          regex: options.regex,
          wholeWord: options.wholeWord === true,
          limits: {
            maxFileBytes: options.maxFileBytes,
            maxFileMatches: options.maxFileMatches,
            maxTotalMatches: options.maxTotalMatches,
            concurrency: options.concurrency,
          },
        });
      } catch (err) {
        this.active = undefined;
        this.clearTimers(active);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
    return {
      promise,
      cancel: () => {
        const active = this.active;
        if (!active || active.id !== id) return;
        active.cancelled = true;
        try {
          worker.postMessage({ type: 'cancel', id });
        } catch {
          /* 忽略 */
        }
      },
    };
  }

  cancel(): void {
    const active = this.active;
    if (!active) return;
    active.cancelled = true;
    try {
      this.worker?.postMessage({ type: 'cancel', id: active.id });
    } catch {
      /* 忽略 */
    }
  }

  terminate(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    const worker = this.worker;
    this.worker = undefined;
    if (worker) {
      try {
        void worker.terminate();
      } catch {
        /* 忽略 */
      }
    }
    const active = this.active;
    if (active) {
      this.active = undefined;
      this.clearTimers(active);
      active.reject(new Error(i18n.t('Cancelled')));
    }
  }

  dispose(): void {
    this.terminate();
  }
}

export class ProjectSearchViewProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private webviewReady = false;
  private disposed = false;
  private readonly viewState: PersistedViewState;
  private history: SearchHistoryState;
  private subtree: SubtreeState | undefined;
  private entriesCache: { signature: string; entries: SearchEntry[] } | undefined;
  private fileResults: FileResultState | undefined;
  private textResults: TextResultState | undefined;
  private fileSeq = 0;
  private textSeq = 0;
  private fileTimer: ReturnType<typeof setTimeout> | undefined;
  private contextTimer: ReturnType<typeof setTimeout> | undefined;
  private dirtyWhenHidden = false;
  private cancelCurrent: (() => void) | undefined;
  private readonly worker: TextSearchWorkerClient;
  private pendingReveal: { mode: ProjectSearchMode; query?: string } | undefined;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly host: ProjectSearchHost,
  ) {
    this.viewState = sanitizeViewState(context.workspaceState.get(SEARCH_VIEW_STATE_KEY));
    if (!context.workspaceState.get(SEARCH_VIEW_STATE_KEY)) {
      const configuredScope = vscode.workspace.getConfiguration('codeblocks').get<string>('search.scope', 'openProjects');
      this.viewState.scope = configuredScope === 'activeProject' ? 'activeProject' : 'openProjects';
    }
    this.history = parseHistory(context.workspaceState.get(SEARCH_HISTORY_KEY));
    this.subtree = sanitizeSubtree(context.workspaceState.get('codeblocks.search.subtree'));
    const workerPath = path.join(context.extensionPath, 'bundle', 'search-worker.js');
    const factory = host.createTextSearchWorker
      ?? (fs.existsSync(workerPath)
        ? () => {
          // 延迟 require：packaging/无 Node worker 的测试环境不加载
          const { Worker } = require('node:worker_threads') as typeof import('node:worker_threads');
          return new Worker(workerPath, { resourceLimits: { maxOldGenerationSizeMb: 256 } });
        }
        : undefined);
    this.worker = new TextSearchWorkerClient(factory, host.output, host.searchTimeouts);
    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => this.onConfigurationChanged(e)),
    );
  }

  // ———— WebviewViewProvider ————

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    this.webviewReady = false;
    webviewView.webview.options = { enableScripts: true };
    this.disposables.push(
      webviewView.webview.onDidReceiveMessage((msg) => {
        void this.onMessage(msg).catch((err) => {
          this.post({ type: 'error', message: i18n.t('Search failed: {0}', (err as Error)?.message ?? String(err)) });
        });
      }),
      webviewView.onDidChangeVisibility(() => {
        if (!webviewView.visible) {
          this.cancelSearch();
          return;
        }
        this.dirtyWhenHidden = false;
        this.reloadHistory();
        this.postState();
        this.postHistory(this.historyFilterMode());
      }),
      webviewView.onDidDispose(() => {
        this.cancelSearch();
        this.view = undefined;
        this.webviewReady = false;
      }),
    );
    webviewView.webview.html = this.buildViewHtml();
  }

  /** Seti 字体（VS Code Explorer 同款）经 webview URI 加载；不可用时回退字母图标 */
  private buildViewHtml(): string {
    const webview = this.view?.webview;
    if (!webview) return buildProjectSearchViewHtml();
    const fontUri = webview
      .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'icons', 'seti.woff'))
      .toString();
    return buildProjectSearchViewHtml({ fontUri, cspSource: webview.cspSource });
  }

  /** 打开/聚焦搜索视图，并切到指定模式 */
  async reveal(mode: ProjectSearchMode, query?: string): Promise<void> {
    this.viewState.mode = mode;
    if (query !== undefined) this.viewState.queries[mode] = query.slice(0, this.maxQueryLength(mode));
    this.persistViewState();
    if (this.view) {
      // 视图已解析：直接选中并聚焦（show 内部会打开所在容器）
      try {
        this.view.show(false);
      } catch {
        /* 忽略 */
      }
    } else {
      // 尚未解析：先打开 Code::Blocks 容器，让 VS Code 解析出搜索视图
      try {
        await vscode.commands.executeCommand('workbench.view.extension.codeblocks');
      } catch {
        /* 忽略 */
      }
      // 解析是异步的：短暂等待，避免每次命令都走 pending 分支
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      const resolved = this.view as vscode.WebviewView | undefined;
      try {
        resolved?.show(false);
      } catch {
        /* 忽略 */
      }
    }
    if (!this.view) {
      this.pendingReveal = { mode, query };
      return;
    }
    this.post({ type: 'activated', mode, query: this.viewState.queries[mode] });
    if (!this.webviewReady) return;
    if (mode === 'text' && query?.trim()) this.scheduleTextSearch(query);
    else if (mode === 'files') void this.runFileSearch(this.viewState.queries.files, 0);
  }

  /** 工程树节点右键：只搜该子树；子树搜索不写历史 */
  setSubtreeScope(project: Project, node: any): void {
    const files = this.host.filesUnder(node) ?? [];
    const relativePaths = files.map((f) => f.relativeFilename).filter(Boolean);
    if (!relativePaths.length) {
      void vscode.window.showInformationMessage(i18n.t('No files in this scope'));
      return;
    }
    const label = this.subtreeLabel(project, node);
    this.subtree = { projectFilename: project.filename, label, relativePaths };
    this.entriesCache = undefined;
    this.persistSubtree();
    this.post({ type: 'scopeOverride', subtree: this.publicSubtree() });
    this.postState();
    this.scheduleResearch();
  }

  clearSubtreeScope(): void {
    this.subtree = undefined;
    this.entriesCache = undefined;
    this.persistSubtree();
    this.post({ type: 'scopeOverride', subtree: undefined });
    this.postState();
    this.scheduleResearch();
  }

  /** 工程集合 / 活动工程 / 文件列表变化：可见时防抖重搜；隐藏时只标记 dirty */
  notifyContextChanged(): void {
    if (this.disposed) return;
    this.entriesCache = undefined;
    if (this.subtree && !this.host.getProjects().some((p) => samePath(p.filename, this.subtree!.projectFilename))) {
      this.subtree = undefined;
      this.persistSubtree();
      this.post({ type: 'scopeOverride', subtree: undefined });
    }
    if (!this.view) return;
    if (!this.view.visible) {
      this.dirtyWhenHidden = true;
      return;
    }
    // 只刷新状态，不自动重搜：搜索结果的排序（active project first）必须在一次搜索后固定，
    // 不能在切换活动工程时被重新排序；需要刷新结果时由用户点“刷新”或重新搜索。
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.contextTimer = setTimeout(() => {
      this.contextTimer = undefined;
      this.postState();
    }, 400);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.fileTimer) clearTimeout(this.fileTimer);
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.cancelSearch();
    this.worker.dispose();
    for (const d of this.disposables.splice(0)) {
      try { d.dispose(); } catch { /* 忽略 */ }
    }
    this.view = undefined;
  }

  // ———— 消息处理 ————

  private async onMessage(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== 'object') return;
    const msg = raw as Record<string, unknown>;
    const type = typeof msg.type === 'string' ? msg.type : '';
    switch (type) {
      case 'ready':
        this.webviewReady = true;
        this.dirtyWhenHidden = false;
        this.reloadHistory();
        this.postState();
        this.postHistory(this.historyFilterMode());
        if (this.pendingReveal) {
          const pending = this.pendingReveal;
          this.pendingReveal = undefined;
          this.post({ type: 'activated', mode: pending.mode, query: this.viewState.queries[pending.mode] });
        }
        // 视图（重新）解析：先回放两种模式已缓存的搜索结果（视图隐藏时 webview 上下文会被销毁），
        // 缓存缺失时才回退到重跑，避免切换 Explorer 后另一模式的记录丢失。
        const restored = this.postCachedResults();
        if (this.viewState.mode === 'files' && !restored.files && this.host.getProjects().length) {
          void this.runFileSearch(this.viewState.queries.files, 0);
        } else if (this.viewState.mode === 'text' && !restored.text && this.viewState.queries.text.trim()) {
          void this.runTextSearch(this.viewState.queries.text);
        }
        break;
      case 'stateChanged':
        this.applyStateMessage(msg);
        break;
      case 'searchFiles':
        await this.runFileSearch(String(msg.query ?? ''), Number(msg.requestId) || 0);
        break;
      case 'searchText':
        await this.runTextSearch(String(msg.query ?? ''));
        break;
      case 'commitHistory': {
        const mode = asMode(msg.mode) ?? this.viewState.mode;
        const query = typeof msg.query === 'string' ? msg.query : this.viewState.queries[mode];
        this.recordHistory(mode, query);
        break;
      }
      case 'cancel':
        this.cancelSearch();
        break;
      case 'openFile':
        await this.openFileResult(String(msg.id ?? ''));
        break;
      case 'openMatch':
        await this.openMatchResult(String(msg.id ?? ''));
        break;
      case 'revealFile':
        await this.revealResult(String(msg.id ?? ''));
        break;
      case 'setScope': {
        const scope = asScope(msg.scope);
        if (scope) {
          this.viewState.scope = scope;
          this.persistViewState();
          this.postState();
          this.scheduleResearch();
        }
        break;
      }
      case 'clearSubtreeScope':
        this.clearSubtreeScope();
        break;
      case 'refresh':
        this.entriesCache = undefined;
        this.cancelSearch();
        this.textSeq++;
        this.worker.terminate();
        this.postState();
        break;
      case 'getHistory':
        this.postHistory(msg.mode === 'all' ? 'all' : this.viewState.mode);
        break;
      case 'runHistory':
        await this.runHistory(String(msg.id ?? ''), msg.action === 'rerun' ? 'rerun' : 'jump');
        break;
      case 'clearHistory':
        this.history = clearHistory();
        await this.persistHistory();
        this.postHistory(this.historyFilterMode());
        break;
      case 'requestClearHistory':
        await this.requestClearHistory();
        break;
      case 'setKeepHistory':
        await this.setKeepHistory(msg.value === true);
        break;
      case 'runCommand':
        await this.runCommand(String(msg.command ?? ''));
        break;
      default:
        break;
    }
  }

  private applyStateMessage(msg: Record<string, unknown>): void {
    const mode = asMode(msg.mode);
    if (mode) this.viewState.mode = mode;
    if (msg.queries && typeof msg.queries === 'object') {
      const q = msg.queries as Record<string, unknown>;
      if (typeof q.files === 'string') this.viewState.queries.files = q.files.slice(0, FILE_MAX_QUERY_LENGTH);
      if (typeof q.text === 'string') this.viewState.queries.text = q.text.slice(0, TEXT_MAX_QUERY_LENGTH);
    }
    this.viewState.caseSensitive = msg.caseSensitive === true;
    this.viewState.regex = msg.regex === true;
    this.viewState.wholeWord = msg.wholeWord === true;
    this.persistViewState();
  }

  private onConfigurationChanged(e: vscode.ConfigurationChangeEvent): void {
    if (e.affectsConfiguration('codeblocks.ui.language') && this.view) {
      const state = this.viewState;
      this.view.webview.html = this.buildViewHtml();
      this.webviewReady = false;
      this.postState();
      this.post({ type: 'activated', mode: state.mode, query: state.queries[state.mode] });
    }
    if (e.affectsConfiguration('codeblocks.search.keepHistory')) {
      this.postState();
      if (this.keepHistory() && this.viewState.mode === 'text') this.postHistory(this.historyFilterMode());
    }
  }

  // ———— 文件模式 ————

  private maxQueryLength(mode: ProjectSearchMode): number {
    return mode === 'files' ? FILE_MAX_QUERY_LENGTH : TEXT_MAX_QUERY_LENGTH;
  }

  private activeFilename(): string | undefined {
    return this.host.getActiveProject()?.filename;
  }

  private entries(): SearchEntry[] {
    if (this.subtree) {
      const projects = this.host.getProjects();
      const project = projects.find((p) => samePath(p.filename, this.subtree!.projectFilename));
      if (!project) return [];
      const wanted = new Set(this.subtree.relativePaths.map((p) => p.replace(/\\/g, '/').toLowerCase()));
      const files = project.files.filter((f) => wanted.has(String(f.relativeFilename).replace(/\\/g, '/').toLowerCase()));
      return buildSubtreeEntries(
        project, files,
        samePath(project.filename, this.activeFilename() ?? ''),
        projectDisplayTitle(projects, project),
      );
    }
    const projects = this.host.getProjects();
    const active = this.activeFilename();
    const signature = searchEntriesSignature(projects, active, this.viewState.scope);
    if (this.entriesCache?.signature === signature) return this.entriesCache.entries;
    const entries = buildSearchEntries(projects, active, this.viewState.scope);
    this.entriesCache = { signature, entries };
    return entries;
  }

  private async runFileSearch(queryRaw: string, requestId: number): Promise<void> {
    if (this.disposed) return;
    const query = String(queryRaw ?? '').slice(0, FILE_MAX_QUERY_LENGTH);
    this.viewState.mode = 'files';
    this.viewState.queries.files = query;
    this.persistViewState();
    const seq = Number(requestId) || ++this.fileSeq;
    this.fileSeq = seq;
    const started = Date.now();
    const entries = this.entries();
    const all = rankSearchEntries(entries, query, FILE_SEARCH_LIMIT + 1);
    const truncated = all.length > FILE_SEARCH_LIMIT;
    const hits = truncated ? all.slice(0, FILE_SEARCH_LIMIT) : all;
    const byId = new Map<string, SearchEntry>();
    const results: FileResultDto[] = hits.map((hit, index) => {
      const id = `file-${index}`;
      byId.set(id, hit.entry);
      return {
        id,
        projectTitle: hit.entry.projectTitle,
        projectFilename: hit.entry.projectFilename,
        relativePath: hit.entry.relativePath,
        absolutePath: hit.entry.absolutePath,
        basename: hit.entry.basename,
        isActive: hit.entry.isActive,
        ranges: hit.ranges,
      };
    });
    this.fileResults = { query, results, byId, truncated, elapsedMs: Date.now() - started };
    this.post({
      type: 'fileResults',
      requestId: seq,
      query,
      results,
      total: results.length,
      truncated,
      elapsedMs: Date.now() - started,
    });
  }

  // ———— 内容模式 ————

  private textFiles(): TextSearchFile[] {
    const dirty = this.dirtyTexts();
    const seen = new Set<string>();
    const out: TextSearchFile[] = [];
    for (const entry of this.entries()) {
      const key = entry.absolutePath.replace(/\\/g, '/').toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        absolutePath: entry.absolutePath,
        projectFilename: entry.projectFilename,
        projectTitle: entry.projectTitle,
        relativeFilename: entry.relativePath,
        dirtyText: dirty.get(key),
      });
    }
    return out;
  }

  private dirtyTexts(): Map<string, string> {
    const map = new Map<string, string>();
    try {
      for (const doc of vscode.workspace.textDocuments ?? []) {
        if (!doc.isDirty || !doc.uri || doc.uri.scheme !== 'file') continue;
        map.set(doc.uri.fsPath.replace(/\\/g, '/').toLowerCase(), doc.getText());
      }
    } catch {
      /* 测试桩没有 textDocuments */
    }
    return map;
  }

  private scheduleTextSearch(query: string): void {
    if (this.fileTimer) clearTimeout(this.fileTimer);
    this.fileTimer = setTimeout(() => void this.runTextSearch(query), 0);
  }

  private async runTextSearch(queryRaw: string): Promise<void> {
    if (this.disposed) return;
    const query = String(queryRaw ?? '').slice(0, TEXT_MAX_QUERY_LENGTH);
    if (!query.trim()) {
      this.post({ type: 'error', message: i18n.t('Enter a search query first') });
      return;
    }
    this.viewState.mode = 'text';
    this.viewState.queries.text = query;
    this.persistViewState();
    this.recordHistory('text', query);
    const seq = ++this.textSeq;
    const started = Date.now();
    const files = this.textFiles();
    if (!files.length) {
      this.textResults = { query, files: [], byId: new Map(), truncated: false, elapsedMs: 0, matchCount: 0 };
      this.post({ type: 'textResults', requestId: seq, query, files: [], matchCount: 0, fileCount: 0, truncated: false, elapsedMs: 0 });
      return;
    }
    this.cancelSearch();
    this.post({ type: 'searchStarted', mode: 'text', requestId: seq });
    let cancelled = false;
    let timedOut = false;
    let result: any;
    if (this.worker.available) {
      let task: { promise: Promise<any>; cancel: () => void } | undefined;
      try {
        task = this.worker.search(
          files,
          {
            query,
            caseSensitive: this.viewState.caseSensitive,
            regex: this.viewState.regex,
            wholeWord: this.viewState.wholeWord,
            maxFileBytes: TEXT_MAX_FILE_BYTES,
            maxFileMatches: TEXT_FILE_MATCH_LIMIT,
            maxTotalMatches: TEXT_TOTAL_MATCH_LIMIT,
            concurrency: Math.max(2, Math.min(8, (require('node:os').cpus()?.length || 4) - 1)),
          },
          (p) => this.post({ type: 'textProgress', requestId: seq, ...p }),
        );
      } catch (err) {
        this.host.output?.appendLine(`[Code::Blocks] Project search worker unavailable, falling back: ${(err as Error).message}`);
        result = await this.fallbackTextSearch(files, query, seq);
      }
      if (task) {
        this.cancelCurrent = () => {
          cancelled = true;
          task!.cancel();
        };
        try {
          result = await task.promise;
        } catch (err) {
          if (this.disposed || seq !== this.textSeq) return;
          cancelled = cancelled || this.cancelCurrent === undefined;
          timedOut = /timed out/i.test(String((err as Error)?.message ?? ''));
          if (!cancelled && !timedOut) {
            if (this.viewState.regex) {
              this.cancelCurrent = undefined;
              this.post({ type: 'error', message: i18n.t('Regular-expression search is unavailable because the search worker failed; use a literal query or the built-in search') });
              this.post({ type: 'searchDone', requestId: seq });
              return;
            }
            this.host.output?.appendLine(`[Code::Blocks] Project search worker failed, falling back: ${(err as Error).message}`);
            result = await this.fallbackTextSearch(files, query, seq);
          } else if (!cancelled) {
            this.cancelCurrent = undefined;
            this.post({ type: 'error', message: i18n.t('Search timed out — narrow the scope or use the built-in search') });
            this.post({ type: 'searchDone', requestId: seq });
            return;
          } else {
            result = { files: [], truncated: false, aborted: true, total: files.length, scanned: 0, matchCount: 0, skipped: {}, durationMs: 0 };
          }
        }
      }
    } else {
      if (this.viewState.regex) {
        this.post({ type: 'error', message: i18n.t('Regular-expression search is unavailable because the search worker is not built; run "npm run bundle:search" or use a literal query') });
        this.post({ type: 'searchDone', requestId: seq });
        return;
      }
      result = await this.fallbackTextSearch(files, query, seq);
    }
    if (seq === this.textSeq) this.cancelCurrent = undefined;
    if (this.disposed || seq !== this.textSeq) return;
    if (result?.queryError) {
      this.post({ type: 'error', message: i18n.t('Invalid regular expression: {0}', result.queryError) });
      this.post({ type: 'searchDone', requestId: seq });
      return;
    }

    const byId = new Map<string, { file: TextSearchFile; match?: TextMatchDto }>();
    const dtoFiles: TextFileDto[] = [];
    let fileIndex = 0;
    for (const item of (result?.files ?? []) as TextFileResult[]) {
      if (!item.matches?.length) continue;
      const fileId = `tf-${fileIndex++}`;
      const matches: TextMatchDto[] = item.matches.map((m, matchIndex) => {
        const id = `${fileId}-m-${matchIndex}`;
        const dto: TextMatchDto = {
          id,
          line: m.line,
          column: m.column,
          length: m.length,
          preview: m.preview,
          previewStart: m.previewStart,
          previewLength: m.previewLength,
        };
        byId.set(id, { file: item.file, match: dto });
        return dto;
      });
      byId.set(fileId, { file: item.file });
      dtoFiles.push({
        id: fileId,
        projectTitle: item.file.projectTitle,
        projectFilename: item.file.projectFilename,
        relativePath: item.file.relativeFilename,
        absolutePath: item.file.absolutePath,
        isActive: samePath(item.file.projectFilename, this.activeFilename() ?? ''),
        matches,
      });
    }

    const matchCount = Number(result?.matchCount) || dtoFiles.reduce((sum, f) => sum + f.matches.length, 0);
    const elapsedMs = Date.now() - started;
    const aborted = result?.aborted === true || cancelled;
    this.textResults = {
      query,
      files: dtoFiles,
      byId,
      truncated: result?.truncated === true,
      elapsedMs,
      matchCount,
    };
    this.post({
      type: 'textResults',
      requestId: seq,
      query,
      files: dtoFiles,
      matchCount,
      fileCount: dtoFiles.length,
      truncated: result?.truncated === true,
      elapsedMs,
      cancelled: aborted,
      timedOut,
    });
  }

  private async fallbackTextSearch(files: TextSearchFile[], query: string, seq: number): Promise<any> {
    const controller = new AbortController();
    this.cancelCurrent = () => controller.abort();
    try {
      return await searchFileSet(files, {
        query,
        caseSensitive: this.viewState.caseSensitive,
        regex: this.viewState.regex,
        wholeWord: this.viewState.wholeWord,
        maxFileBytes: TEXT_MAX_FILE_BYTES,
        maxFileMatches: TEXT_FILE_MATCH_LIMIT,
        maxTotalMatches: TEXT_TOTAL_MATCH_LIMIT,
        concurrency: 4,
        signal: controller.signal,
        onProgress: (p) => this.post({ type: 'textProgress', requestId: seq, ...p }),
      });
    } finally {
      if (seq === this.textSeq) this.cancelCurrent = undefined;
    }
  }

  private cancelSearch(): void {
    const cancel = this.cancelCurrent;
    this.cancelCurrent = undefined;
    if (cancel) cancel();
    this.worker.cancel();
  }

  private scheduleResearch(): void {
    if (!this.view || !this.view.visible || !this.webviewReady) {
      this.dirtyWhenHidden = true;
      return;
    }
    this.postState();
    const query = this.viewState.queries[this.viewState.mode];
    if (this.viewState.mode === 'files') {
      if (this.fileTimer) clearTimeout(this.fileTimer);
      this.fileTimer = setTimeout(() => void this.runFileSearch(query, 0), 60);
    } else if (query.trim()) {
      this.scheduleTextSearch(query);
    }
  }

  // ———— 打开 / 定位 ————

  private async openFileResult(id: string): Promise<void> {
    const state = this.fileResults;
    const entry = state?.byId.get(id);
    if (!state || !entry) return;
    const ok = await this.openEntry(entry, 0, 0, 0);
    if (ok) this.updateHistoryForOpen('files', state.query, entry, undefined);
    else this.post({ type: 'error', message: i18n.t('File no longer exists or is not part of an open project') });
  }

  private async openMatchResult(id: string): Promise<void> {
    const state = this.textResults;
    const item = state?.byId.get(id);
    if (!state || !item?.match) return;
    const entry: SearchEntry = {
      projectTitle: item.file.projectTitle,
      projectFilename: item.file.projectFilename,
      projectBasePath: '',
      relativePath: item.file.relativeFilename,
      absolutePath: item.file.absolutePath,
      basename: path.posix.basename(item.file.relativeFilename),
      normalizedPath: '',
      normalizedBasename: '',
      isActive: false,
    };
    const ok = await this.openEntry(entry, item.match.line, item.match.column, item.match.length);
    if (ok) this.updateHistoryForOpen('text', state.query, entry, item.match);
    else this.post({ type: 'error', message: i18n.t('File no longer exists or is not part of an open project') });
  }

  private async revealResult(id: string): Promise<void> {
    const entry = this.fileResults?.byId.get(id)
      ?? (() => {
        const item = this.textResults?.byId.get(id);
        if (!item) return undefined;
        return {
          projectTitle: item.file.projectTitle,
          projectFilename: item.file.projectFilename,
          projectBasePath: '',
          relativePath: item.file.relativeFilename,
          absolutePath: item.file.absolutePath,
          basename: path.posix.basename(item.file.relativeFilename),
          normalizedPath: '',
          normalizedBasename: '',
          isActive: false,
        } as SearchEntry;
      })();
    if (!entry) return;
    const project = this.host.getProjects().find((p) => samePath(p.filename, entry.projectFilename));
    const file = project?.files.find((f) => samePath(f.relativeFilename, entry.relativePath) || samePath(f.absolutePath, entry.absolutePath));
    if (!project || !file) {
      this.post({ type: 'error', message: i18n.t('File no longer exists or is not part of an open project') });
      return;
    }
    await this.host.revealFile(project, file);
  }

  private async openEntry(entry: SearchEntry, line: number, column: number, length: number): Promise<boolean> {
    const ok = await this.host.openLocation(entry.absolutePath, line, column, length);
    return ok;
  }

  private updateHistoryForOpen(
    mode: ProjectSearchMode,
    query: string,
    entry: SearchEntry,
    match: TextMatchDto | undefined,
  ): void {
    if (!this.keepHistory() || this.subtree || !query.trim()) return;
    if (!this.history.entries.some((e) => e.mode === mode && e.query === query.trim())) {
      this.history = addHistoryEntry(this.history, {
        mode,
        query,
        scope: this.viewState.scope,
        caseSensitive: this.viewState.caseSensitive,
        regex: this.viewState.regex,
        wholeWord: this.viewState.wholeWord,
      });
    }
    const last: SearchHistoryLastResult = {
      projectFilename: entry.projectFilename,
      relativeFilename: entry.relativePath,
    };
    if (mode === 'text' && match) {
      last.line = match.line;
      last.column = match.column;
      last.length = match.length;
    }
    this.history = updateLastResult(this.history, mode, query, last);
    void this.persistHistory();
    this.postHistory(this.historyFilterMode());
  }

  // ———— 历史 ————

  private keepHistory(): boolean {
    return vscode.workspace.getConfiguration('codeblocks').get<boolean>('search.keepHistory', true) !== false;
  }

  private historyFilterMode(): ProjectSearchMode | 'all' {
    return this.viewState.mode;
  }

  private recordHistory(mode: ProjectSearchMode, query: string): void {
    if (!this.keepHistory() || this.subtree || !query.trim()) return;
    this.history = addHistoryEntry(this.history, {
      mode,
      query,
      scope: this.viewState.scope,
      caseSensitive: this.viewState.caseSensitive,
      regex: this.viewState.regex,
      wholeWord: this.viewState.wholeWord,
    });
    void this.persistHistory();
    this.postHistory(this.historyFilterMode());
  }

  /** 清空确认走 VS Code 原生模态框，避免 Webview 内确认条被滚动区遮挡 */
  private async requestClearHistory(): Promise<void> {
    const clearLabel = i18n.t('Clear');
    const answer = await vscode.window.showWarningMessage(
      i18n.t('Clear search history?'),
      { modal: true },
      clearLabel,
    );
    if (answer !== clearLabel) return;
    this.history = clearHistory();
    await this.persistHistory();
    this.postHistory(this.historyFilterMode());
    this.postState();
  }

  private reloadHistory(): void {
    this.history = parseHistory(this.context.workspaceState.get(SEARCH_HISTORY_KEY));
    this.subtree = sanitizeSubtree(this.context.workspaceState.get('codeblocks.search.subtree'));
  }

  private async persistHistory(): Promise<void> {
    try {
      await this.context.workspaceState.update(SEARCH_HISTORY_KEY, this.history);
    } catch (err) {
      this.host.output?.appendLine(`[Code::Blocks] Failed to save search history: ${(err as Error).message}`);
    }
  }

  private postHistory(mode: ProjectSearchMode | 'all'): void {
    const entries = historyForMode(this.history, mode, mode === 'all' ? 40 : 20);
    this.post({ type: 'history', entries, mode });
  }

  private async setKeepHistory(value: boolean): Promise<void> {
    try {
      const cfg = vscode.workspace.getConfiguration('codeblocks');
      const inspect = cfg.inspect<boolean>('search.keepHistory');
      if (inspect && inspect.workspaceValue !== undefined && inspect.workspaceValue !== value) {
        this.post({ type: 'error', message: i18n.t('This workspace overrides the history setting; change it in the workspace settings') });
      }
      await cfg.update(
        SEARCH_KEEP_HISTORY_SETTING,
        value,
        vscode.ConfigurationTarget.Global,
      );
    } catch (err) {
      this.post({ type: 'error', message: i18n.t('Failed to update the setting: {0}', (err as Error).message) });
    }
    this.postState();
  }

  private async runHistory(id: string, action: 'jump' | 'rerun'): Promise<void> {
    const entry = this.history.entries.find((e) => e.id === id);
    if (!entry) return;
    this.viewState.mode = entry.mode;
    this.viewState.scope = entry.scope;
    this.viewState.caseSensitive = entry.caseSensitive;
    this.viewState.regex = entry.regex;
    this.viewState.wholeWord = entry.wholeWord === true;
    this.viewState.queries[entry.mode] = entry.query;
    this.persistViewState();
    this.subtree = undefined;
    this.persistSubtree();
    this.post({ type: 'scopeOverride', subtree: undefined });
    this.postState();

    if (action === 'jump' && entry.lastResult) {
      const opened = await this.jumpToLastResult(entry.lastResult);
      if (opened) {
        this.post({ type: 'activated', mode: entry.mode, query: entry.query });
        return;
      }
      this.post({ type: 'error', message: i18n.t('The last result is no longer valid — searching again') });
    }
    this.post({ type: 'activated', mode: entry.mode, query: entry.query });
    if (entry.mode === 'files') await this.runFileSearch(entry.query, 0);
    else await this.runTextSearch(entry.query);
  }

  private async jumpToLastResult(last: SearchHistoryLastResult): Promise<boolean> {
    const project = this.host.getProjects().find((p) => samePath(p.filename, last.projectFilename));
    if (!project) return false;
    const file = project.files.find((f) => samePath(f.relativeFilename, last.relativeFilename));
    if (!file) return false;
    const line = typeof last.line === 'number' ? last.line : 0;
    const column = typeof last.column === 'number' ? last.column : 0;
    const length = typeof last.length === 'number' ? last.length : 0;
    if (last.line !== undefined) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file.absolutePath));
        if (typeof doc.lineCount === 'number' && line >= doc.lineCount) return false;
      } catch {
        return false;
      }
    }
    return this.host.openLocation(file.absolutePath, line, column, length);
  }

  // ———— 命令 / 状态 ————

  private async runCommand(command: string): Promise<void> {
    const allowed = new Set(['codeblocks.openProject', 'codeblocks.newProject']);
    if (!allowed.has(command)) return;
    await vscode.commands.executeCommand(command);
  }

  private persistViewState(): void {
    void this.context.workspaceState.update(SEARCH_VIEW_STATE_KEY, this.viewState);
  }

  private persistSubtree(): void {
    void this.context.workspaceState.update('codeblocks.search.subtree', this.subtree);
  }

  private publicSubtree(): { projectFilename: string; label: string } | undefined {
    return this.subtree ? { projectFilename: this.subtree.projectFilename, label: this.subtree.label } : undefined;
  }

  /**
   * 回放两种模式已缓存的搜索结果。
   *
   * 侧边栏 webview 在视图隐藏（如切到 Explorer）时会被销毁，重新显示后内存里的结果全部丢失；
   * 这里直接把上次的 DTO 重新下发，既不重跑扫描，也能保留「非当前模式」的搜索结果。
   */
  private postCachedResults(): { files: boolean; text: boolean } {
    const out = { files: false, text: false };
    // 仅在缓存查询与当前查询一致时回放（避免恢复「已清空/已改写查询」的旧结果）
    if (this.fileResults && this.fileResults.query === this.viewState.queries.files) {
      const f = this.fileResults;
      this.post({
        type: 'fileResults',
        requestId: this.fileSeq,
        query: f.query,
        results: f.results,
        total: f.results.length,
        truncated: f.truncated,
        elapsedMs: f.elapsedMs,
      });
      out.files = true;
    }
    if (this.textResults && this.textResults.query === this.viewState.queries.text && this.textResults.query.trim()) {
      const t = this.textResults;
      this.post({
        type: 'textResults',
        requestId: this.textSeq,
        query: t.query,
        files: t.files,
        matchCount: t.matchCount,
        fileCount: t.files.length,
        truncated: t.truncated,
        elapsedMs: t.elapsedMs,
        cancelled: false,
        timedOut: false,
      });
      out.text = true;
    }
    return out;
  }

  private postState(): void {
    const projects = this.host.getProjects();
    const active = this.host.getActiveProject();
    const fileCount = projects.reduce((sum, p) => sum + (p.files?.length ?? 0), 0);
    this.post({
      type: 'state',
      mode: this.viewState.mode,
      queries: this.viewState.queries,
      scope: this.viewState.scope,
      caseSensitive: this.viewState.caseSensitive,
      regex: this.viewState.regex,
      wholeWord: this.viewState.wholeWord,
      keepHistory: this.keepHistory(),
      hasProjects: projects.length > 0,
      projectCount: projects.length,
      fileCount,
      activeProject: active?.title ?? '',
      subtree: this.publicSubtree(),
    });
  }

  private post(message: unknown): void {
    if (!this.view || !this.webviewReady) return;
    try {
      void this.view.webview.postMessage(message);
    } catch {
      /* 视图已销毁 */
    }
  }

  private subtreeLabel(project: Project, node: any): string {
    const title = project.title || path.basename(project.filename);
    if (!node || node.kind === 'project') return title;
    if (node.kind === 'fileGroup') return `${title} / ${node.label ?? ''}`;
    if (node.dirKey) return `${title} / ${node.dirKey}`;
    if (node.label) return `${title} / ${node.label}`;
    return title;
  }
}

export interface ProjectSearchRegistration {
  provider: ProjectSearchViewProvider;
  dispose(): void;
}

/**
 * 注册搜索视图与两个命令；返回 provider 供 extension 通知上下文变化。
 */
export function registerProjectSearch(
  context: vscode.ExtensionContext,
  host: ProjectSearchHost,
): ProjectSearchRegistration {
  const provider = new ProjectSearchViewProvider(context, host);
  const viewRegistration = vscode.window.registerWebviewViewProvider(SEARCH_VIEW_ID, provider, {
    webviewOptions: { retainContextWhenHidden: false },
  });
  const commandDisposables = [
    vscode.commands.registerCommand('codeblocks.searchProjectFiles', async (node?: any) => {
      if (node?.project && (node.kind === 'project' || node.kind === 'folder' || node.kind === 'virtualFolder' || node.kind === 'fileGroup')) {
        provider.setSubtreeScope(node.project, node);
      }
      await provider.reveal('files');
    }),
    vscode.commands.registerCommand('codeblocks.searchInProjectFiles', async (node?: any) => {
      if (node?.project && (node.kind === 'project' || node.kind === 'folder' || node.kind === 'virtualFolder' || node.kind === 'fileGroup')) {
        provider.setSubtreeScope(node.project, node);
      }
      const editor = vscode.window.activeTextEditor;
      let query = '';
      if (editor && !editor.selection.isEmpty) {
        const selected = editor.document.getText(editor.selection);
        if (selected && !/[\r\n]/.test(selected) && selected.length <= TEXT_MAX_QUERY_LENGTH) query = selected;
      }
      await provider.reveal('text', query);
    }),
  ];
  context.subscriptions.push(viewRegistration, ...commandDisposables);
  return {
    provider,
    dispose: () => {
      for (const d of commandDisposables) d.dispose();
      viewRegistration.dispose();
      provider.dispose();
    },
  };
}
