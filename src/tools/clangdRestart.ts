/**
 * clangd 语言服务器重启合并器（纯逻辑，无 vscode 依赖）。
 *
 * 背景：clangd 扩展的 `clangd.restart` 先停止旧 LanguageClient、再启动新客户端；
 * 旧客户端的命令（`clangd.applyFix` 等）要等停止流程结束才注销。若两次重启间隔太短，
 * 新客户端会在旧命令仍在册时初始化，clangd 扩展抛：
 *   command 'clangd.applyFix' already exists
 * 客户端创建失败，语言服务器退出（通知 “couldn't create connection to server”）。
 *
 * 打开工程 / 切换活动工程 / 重新生成编译数据库都会请求重启，且常在同一秒内连续触发。
 * 本模块用「合并窗口（debounce）+ 最小间隔（minInterval）」把它们合并成一次执行，
 * 给 clangd 扩展留出完成上一次停止的时间。
 */

/** 最后一次请求后等待多久执行（合并同一批触发） */
export const CLANGD_RESTART_DEBOUNCE_MS = 1500;
/** 两次实际执行之间的最小间隔 */
export const CLANGD_RESTART_MIN_INTERVAL_MS = 5000;

/** vscode-languageclient State 枚举取值 */
export const CLANGD_CLIENT_STATE_STOPPED = 1;
export const CLANGD_CLIENT_STATE_RUNNING = 2;
export const CLANGD_CLIENT_STATE_STARTING = 3;

/** 客户端进入 Running 后再等这么久：LanguageClient.initializeFeatures 注册命令有短暂窗口 */
export const CLANGD_RESTART_SETTLE_MS = 2000;
/** 等客户端从 Starting 进入 Running 的上限 */
export const CLANGD_RESTART_START_TIMEOUT_MS = 20000;
/** 轮询状态间隔 */
export const CLANGD_RESTART_POLL_MS = 250;

export interface ClangdRestartCoalescerOptions {
  /** 合并窗口，默认 {@link CLANGD_RESTART_DEBOUNCE_MS} */
  debounceMs?: number;
  /** 最小执行间隔，默认 {@link CLANGD_RESTART_MIN_INTERVAL_MS} */
  minIntervalMs?: number;
  /** 时钟（测试注入） */
  now?: () => number;
  /** 定时器（测试注入） */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** 取消定时器（测试注入） */
  clearTimer?: (handle: unknown) => void;
}

export interface ClangdRestartCoalescer {
  /** 请求重启；窗口内的重复请求合并为一次执行 */
  request(): void;
  /** 取消待执行请求（手动立即重启或扩展停用时调用） */
  cancel(): void;
  /** 是否有等待执行的请求 */
  readonly pending: boolean;
  /** 已实际执行次数（测试/诊断用） */
  readonly runs: number;
}

export function createClangdRestartCoalescer(
  run: () => unknown | Promise<unknown>,
  options: ClangdRestartCoalescerOptions = {},
): ClangdRestartCoalescer {
  const debounceMs = Math.max(0, options.debounceMs ?? CLANGD_RESTART_DEBOUNCE_MS);
  const minIntervalMs = Math.max(0, options.minIntervalMs ?? CLANGD_RESTART_MIN_INTERVAL_MS);
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown);
  const clearTimer = options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let handle: unknown;
  let pending = false;
  let runs = 0;
  let lastRunAt = 0;

  const fire = (): void => {
    handle = undefined;
    if (!pending) return;
    pending = false;
    runs++;
    lastRunAt = now();
    try {
      const result = run();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      /* 忽略：重启失败不影响扩展其它功能 */
    }
  };

  return {
    request(): void {
      pending = true;
      if (handle !== undefined) {
        clearTimer(handle);
        handle = undefined;
      }
      // 首次请求只等合并窗口；之后还要满足「距上次执行至少 minInterval」
      const sinceLast = runs === 0 ? Number.POSITIVE_INFINITY : now() - lastRunAt;
      const delay = Math.max(debounceMs, minIntervalMs - sinceLast);
      handle = setTimer(fire, Math.max(0, delay));
    },
    cancel(): void {
      pending = false;
      if (handle !== undefined) {
        clearTimer(handle);
        handle = undefined;
      }
    },
    get pending(): boolean {
      return pending;
    },
    get runs(): number {
      return runs;
    },
  };
}

export interface WaitForClangdRestartableOptions {
  /** 客户端进入 Running 后的稳定期，默认 {@link CLANGD_RESTART_SETTLE_MS} */
  settleMs?: number;
  /** 等 Starting → Running 的上限，默认 {@link CLANGD_RESTART_START_TIMEOUT_MS} */
  startTimeoutMs?: number;
  /** 轮询间隔，默认 {@link CLANGD_RESTART_POLL_MS} */
  pollMs?: number;
  /** 客户端已停止时是否仍视为可重启（手动重启允许，自动重启不允许） */
  allowStartWhenStopped?: boolean;
  /** 等待超时回调（用于输出通道留痕） */
  onStartTimeout?: () => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * 判断此刻是否适合执行 clangd 重启，必要时等待到安全时机。
 *
 * - 拿不到状态（旧版 clangd 扩展）：直接放行，由调用方走命令重启 + 重试
 * - Stopped：自动重启返回 false（打开源文件会自然启动并读到新配置）；手动重启按参数放行
 * - Starting：轮询到 Running，再等稳定期；超时返回 false（避免打断启动中的客户端）
 * - Running：等稳定期后确认仍在运行，避免刚进入 Running 就 dispose 导致命令重复注册
 */
export async function waitForClangdRestartable(
  getState: () => number | undefined,
  options: WaitForClangdRestartableOptions = {},
): Promise<boolean> {
  const settleMs = Math.max(0, options.settleMs ?? CLANGD_RESTART_SETTLE_MS);
  const startTimeoutMs = Math.max(0, options.startTimeoutMs ?? CLANGD_RESTART_START_TIMEOUT_MS);
  const pollMs = Math.max(1, options.pollMs ?? CLANGD_RESTART_POLL_MS);
  const now = options.now ?? (() => Date.now());
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  let state = getState();
  if (state === undefined) return true;
  if (state === CLANGD_CLIENT_STATE_STOPPED) return options.allowStartWhenStopped === true;

  if (state === CLANGD_CLIENT_STATE_STARTING) {
    const deadline = now() + startTimeoutMs;
    while (state !== CLANGD_CLIENT_STATE_RUNNING) {
      if (now() >= deadline || state === CLANGD_CLIENT_STATE_STOPPED) {
        options.onStartTimeout?.();
        return false;
      }
      await sleep(pollMs);
      state = getState();
    }
    if (settleMs > 0) await sleep(settleMs);
    return getState() === CLANGD_CLIENT_STATE_RUNNING;
  }

  if (state === CLANGD_CLIENT_STATE_RUNNING) {
    if (settleMs > 0) await sleep(settleMs);
    return getState() === CLANGD_CLIENT_STATE_RUNNING;
  }

  return true;
}
