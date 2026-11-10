import * as vscode from 'vscode';

/**
 * 修复 clangd 扩展 inactiveRegions 装饰在语言客户端「原地重启」后失效的问题。
 *
 * 根因（vscode-clangd 0.6.0）：
 *  - `LanguageClient.restart()` 复用同一个 LanguageClient 与 Feature 实例；
 *    停止时 languageclient 调用 Feature 的 `clear()`，它只 `dispose()` 装饰类型却**不清空字段**；
 *  - 重启后 `initialize()` 重新订阅 `onDidChangeVisibleTextEditors`，但重建条件是
 *    `if (!this.decorationType)`——字段仍是（已 dispose 的）对象，永远不重建；
 *  - 于是服务端送来的区域被 `applyHighlights` 用已释放的装饰类型丢弃（全新 Feature 更是
 *    在 `decorationType` 为空时直接跳过）→ 宏关闭的代码不再变暗。
 *
 * 本模块只做最小修补（不改 clangd 的解析/渲染逻辑）：
 *  - 状态进入 Stopped/Starting：释放并清空装饰类型、清空旧区域，避免把上一轮结果画上去；
 *  - 状态进入 Running：若装饰类型缺失（被清空或从未创建）则重建，并重新应用已收到的区域。
 *
 * 通过 clangd 扩展 v1 API 暴露的 LanguageClient 访问其私有 Feature 列表，全部按运行时形状探测；
 * 找不到时静默降级，不影响 clangd 本身。
 */

/** vscode-languageclient State：1 = Stopped / 2 = Running / 3 = Starting */
const CLANGD_STATE_STOPPED = 1;
const CLANGD_STATE_RUNNING = 2;
const CLANGD_STATE_STARTING = 3;

export interface ClangdStateChangeEvent {
  newState: number;
}

export interface ClangdClientLike {
  state?: number;
  onDidChangeState?: (listener: (event: ClangdStateChangeEvent) => void) => vscode.Disposable;
  /** vscode-languageclient 的私有 Feature 列表；用于定位 InactiveRegionsFeature */
  _features?: unknown;
}

interface InactiveRegionsFeatureLike {
  decorationType?: vscode.TextEditorDecorationType;
  files?: Map<string, vscode.Range[]>;
  updateDecorationType?: () => Promise<void>;
  applyHighlights?: (filePath: string) => void;
}

/** 在 LanguageClient 的 Feature 列表里按运行时形状定位 InactiveRegionsFeature */
export function findInactiveRegionsFeature(client: unknown): InactiveRegionsFeatureLike | undefined {
  let features: unknown;
  try {
    features = (client as { _features?: unknown } | undefined)?._features;
  } catch {
    return undefined;
  }
  if (!Array.isArray(features)) return undefined;
  for (const candidate of features) {
    if (!candidate || typeof candidate !== 'object') continue;
    const feature = candidate as Record<string, unknown>;
    if (
      feature.files instanceof Map
      && typeof feature.updateDecorationType === 'function'
      && typeof feature.applyHighlights === 'function'
    ) {
      return candidate as InactiveRegionsFeatureLike;
    }
  }
  return undefined;
}

/** 释放并清空装饰类型 + 清空区域缓存（客户端停止/启动过渡时调用） */
export function resetInactiveRegionsFeature(client: unknown): boolean {
  const feature = findInactiveRegionsFeature(client);
  if (!feature) return false;
  try {
    feature.decorationType?.dispose();
  } catch {
    /* 已释放的装饰类型再次 dispose 可能抛错：忽略 */
  }
  feature.decorationType = undefined;
  feature.files?.clear();
  return true;
}

/** 装饰类型缺失时重建，并把 Feature 已缓存的区域重新应用到可见编辑器 */
export async function ensureInactiveRegionsDecorations(
  client: unknown,
  visibleEditors: readonly vscode.TextEditor[] = vscode.window.visibleTextEditors,
): Promise<boolean> {
  const feature = findInactiveRegionsFeature(client);
  if (!feature) return false;
  if (!feature.decorationType) {
    if (typeof feature.updateDecorationType !== 'function') return false;
    try {
      await feature.updateDecorationType();
    } catch {
      return false;
    }
  }
  if (!feature.decorationType) return false;
  for (const editor of visibleEditors) {
    try {
      feature.applyHighlights?.(editor.document.fileName);
    } catch {
      /* 单个编辑器应用失败不影响其它编辑器 */
    }
  }
  return true;
}

export interface ClangdInactiveRegionsWatcherOptions {
  /** 返回 clangd 扩展当前暴露的 LanguageClient（未激活时返回 undefined） */
  getClient: () => unknown;
  /** 修复结果回调：由调用方负责本地化日志（便于 log.english 设置生效） */
  log?: (event: 'initialized' | 'missing') => void;
  /** 轮询间隔（毫秒）：用于发现 clangd 扩展 restart 命令创建的新客户端。默认 2000 */
  intervalMs?: number;
}

/**
 * 监听 clangd 客户端生命周期并修复 inactiveRegions 装饰。
 *
 * 本扩展自己重启时走 `LanguageClient.restart()`（同一客户端，状态事件已覆盖）；
 * 用户手动执行 clangd 的 Restart 命令会换成新客户端，因此需要低频轮询发现。
 */
export class ClangdInactiveRegionsWatcher implements vscode.Disposable {
  private readonly getClient: () => unknown;
  private readonly log?: (event: 'initialized' | 'missing') => void;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | undefined;
  private client: unknown;
  private stateListener: vscode.Disposable | undefined;
  /** 当前客户端本轮是否已尝试过 ensure（避免每轮轮询重复重建装饰） */
  private ensured = false;
  private ensureAttempts = 0;
  private ensureQueue: Promise<void> = Promise.resolve();
  private loggedSuccess = false;
  private loggedMissing = false;
  private disposed = false;

  constructor(options: ClangdInactiveRegionsWatcherOptions) {
    this.getClient = options.getClient;
    this.log = options.log;
    this.intervalMs = Math.max(250, options.intervalMs ?? 2000);
    this.timer = setInterval(() => this.poll(false), this.intervalMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
    this.poll(false);
  }

  /** 外部触发（例如本扩展刚重启完 clangd）：立即检查并修复 */
  refresh(): void {
    this.poll(true);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    this.detach();
  }

  private poll(force: boolean): void {
    if (this.disposed) return;
    const client = this.getClient();
    if (!client) {
      if (this.client) this.detach();
      return;
    }
    if (client !== this.client) {
      this.attach(client);
      return;
    }
    if (this.stateOf(client) === CLANGD_STATE_RUNNING && (force || !this.ensured)) {
      if (force) this.ensured = false;
      this.requestEnsure(client);
    }
  }

  private attach(client: unknown): void {
    this.detach();
    this.client = client;
    this.ensured = false;
    this.ensureAttempts = 0;
    const stateClient = client as ClangdClientLike;
    if (typeof stateClient.onDidChangeState === 'function') {
      this.stateListener = stateClient.onDidChangeState((event) => {
        this.handleState(client, event?.newState);
      });
    }
    this.handleState(client, stateClient.state);
  }

  private detach(): void {
    this.stateListener?.dispose();
    this.stateListener = undefined;
    if (this.client) {
      // 客户端被替换/扩展停用：清掉旧客户端可能残留的装饰
      resetInactiveRegionsFeature(this.client);
    }
    this.client = undefined;
    this.ensured = false;
    this.ensureAttempts = 0;
  }

  private stateOf(client: unknown): number | undefined {
    const state = (client as ClangdClientLike | undefined)?.state;
    return typeof state === 'number' ? state : undefined;
  }

  private handleState(client: unknown, state: number | undefined): void {
    if (this.disposed || this.client !== client) return;
    const current = typeof state === 'number' ? state : this.stateOf(client);
    if (current === undefined) return;
    if (current === CLANGD_STATE_RUNNING) {
      this.requestEnsure(client);
    } else if (current === CLANGD_STATE_STOPPED || current === CLANGD_STATE_STARTING) {
      resetInactiveRegionsFeature(client);
      this.ensured = false;
      this.ensureAttempts = 0;
    }
  }

  private requestEnsure(client: unknown): void {
    if (this.ensured || this.disposed) return;
    this.ensured = true;
    this.ensureQueue = this.ensureQueue
      .then(async () => {
        if (this.disposed || this.client !== client || this.stateOf(client) !== CLANGD_STATE_RUNNING) return;
        const ok = await ensureInactiveRegionsDecorations(client);
        if (this.disposed) return;
        if (ok) {
          this.ensureAttempts = 0;
          if (!this.loggedSuccess) {
            this.loggedSuccess = true;
            this.log?.('initialized');
          }
          return;
        }
        this.ensureAttempts += 1;
        if (this.ensureAttempts >= 3) {
          if (!this.loggedMissing) {
            this.loggedMissing = true;
            this.log?.('missing');
          }
        } else {
          // Feature 可能尚未注册完成：允许下一轮状态/刷新再试
          this.ensured = false;
        }
      })
      .catch(() => {
        this.ensured = false;
      });
  }
}
