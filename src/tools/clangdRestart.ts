/**
 * clangd 重启工具（纯逻辑，无 vscode 依赖）：
 *  一、重启合并器（createClangdRestartCoalescer）——把同批触发合并成一次，并保证两次执行的最小间隔；
 *  二、客户端状态门（waitForClangdRestartable）——只在 LanguageClient 稳定后执行，避免命令重复注册；
 *  三、重启判定真值表（decideClangdRestart）——这次生成到底该不该重启；
 *  四、重试策略（nextClangdRestartRetry）——客户端迟迟未就绪时的有限重试。
 *
 * 一、重启合并器
 *
 * 背景：clangd 扩展的 `clangd.restart` 先停止旧 LanguageClient、再启动新客户端；
 * 旧客户端的命令（`clangd.applyFix` 等）要等停止流程结束才注销。若两次重启间隔太短，
 * 新客户端会在旧命令仍在册时初始化，clangd 扩展抛：
 *   command 'clangd.applyFix' already exists
 * 客户端创建失败，语言服务器退出（通知 “couldn't create connection to server”）。
 *
 * 打开工程 / 切换活动工程 / 重新生成编译数据库都会请求重启，且常在同一秒内连续触发。
 * 本模块用「合并窗口（debounce）+ 最小间隔（minInterval）+ 单飞（一次未完不并发下一次）」把它们合并成一次执行，
 * 给 clangd 扩展留出完成上一次停止的时间。
 */

/** 最后一次请求后等待多久执行（合并同一批触发） */
export const CLANGD_RESTART_DEBOUNCE_MS = 1500;
/** 两次实际执行之间的最小间隔 */
export const CLANGD_RESTART_MIN_INTERVAL_MS = 5000;
/** 客户端迟迟未就绪时的重试上限（避免必要重启被静默丢弃，也不无限重排） */
export const CLANGD_RESTART_MAX_RETRIES = 2;
/** 每次重试的基础间隔（第 N 次等待 N × 该值） */
export const CLANGD_RESTART_RETRY_DELAY_MS = 2000;

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
  /** 请求重启；窗口内的重复请求合并为一次执行，执行期间的请求排到本次结束后补跑一次 */
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
  /** 单飞：run 进行中（同步或异步）时为 true，避免两次 restart 并发重叠 */
  let running = false;
  /** run 期间到达的请求：结束后补跑一次，而不是并发排期 */
  let trailing = false;

  const clearPendingTimer = (): void => {
    if (handle !== undefined) {
      clearTimer(handle);
      handle = undefined;
    }
  };

  const arm = (): void => {
    if (running) return; // 进行中不排期；结束后由 settleRun 补跑
    clearPendingTimer();
    // 首次请求只等合并窗口；之后还要满足「距上次执行至少 minInterval」
    const sinceLast = runs === 0 ? Number.POSITIVE_INFINITY : now() - lastRunAt;
    const delay = Math.max(debounceMs, minIntervalMs - sinceLast);
    handle = setTimer(fire, Math.max(0, delay));
  };

  const settleRun = (): void => {
    running = false;
    // 尾随请求：本次结束后补跑一次（仍然遵守最小间隔，不并发）
    if (trailing) {
      trailing = false;
      if (pending) arm();
    }
  };

  const fire = (): void => {
    handle = undefined;
    if (!pending) return;
    if (running) {
      trailing = true;
      return;
    }
    pending = false;
    running = true;
    runs++;
    lastRunAt = now();
    try {
      const result = run();
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).then(settleRun, settleRun);
      } else {
        settleRun();
      }
    } catch {
      /* 忽略：重启失败不影响扩展其它功能 */
      settleRun();
    }
  };

  return {
    request(): void {
      pending = true;
      if (running) {
        // 单飞：不并发排期，登记为尾随请求
        trailing = true;
        clearPendingTimer();
        return;
      }
      arm();
    },
    cancel(): void {
      pending = false;
      trailing = false;
      clearPendingTimer();
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
 * 二、客户端状态门
 *
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

/**
 * 三、重试策略
 *
 * 客户端长时间未就绪（仍在 Starting / 稳定期内又停止）时，一次必要的重启不应被静默丢弃：
 * 有限次重排，超过上限后放弃并留痕。
 */
export interface ClangdRestartRetry {
  /** 是否再试一次 */
  retry: boolean;
  /** 本次是第几次重试（1 起） */
  attempt: number;
  /** 距下次尝试的延迟（毫秒） */
  delayMs: number;
}

export function nextClangdRestartRetry(attempts: number): ClangdRestartRetry {
  const used = Number.isFinite(attempts) ? Math.max(0, Math.trunc(attempts)) : 0;
  if (used >= CLANGD_RESTART_MAX_RETRIES) return { retry: false, attempt: used, delayMs: 0 };
  return { retry: true, attempt: used + 1, delayMs: CLANGD_RESTART_RETRY_DELAY_MS * (used + 1) };
}

/**
 * 四、重启判定
 *
 * clangd 重启判定（纯函数，无 vscode 依赖，便于单测覆盖真值表）。
 *
 * 生成 compile_commands.json / clangd 用户配置之后是否重启 clangd：
 *  - 'open'（打开工程）/ 'compiler'（编译器设置变化）：必须重启，不受 codeblocks.clangd.restartOnActiveProjectSwitch 限制；
 *  - 'project'（切换活动工程）：尊重该开关（重启会触发重新索引）。
 *
 * 关键约束（修复 “couldn't create connection to server” / `command 'clangd.applyFix' already exists` 弹窗）：
 * 1. 数据库未变且配置也没变 → 无事可做，不重启；
 * 2. 数据库未变、只有配置变化 → clangd 会监听 config.yaml 并即时生效，一般不重启（避免无谓的重新索引）；
 * 3. 数据库未变、只有配置变化、且本次生成发生在**启动恢复**（窗口重载后恢复上次会话工程）期间 → 跳过重启：
 *    窗口刚重载、clangd 客户端与服务端仍在初始化窗口内，此时 dispose/重建最容易撞上命令注册竞态；
 *    配置改动由 clangd 即时生效，跳过时输出一行说明日志（执行层另有客户端状态门，见 waitForClangdRestartable）。
 */

export type ClangdRestartReason = 'project' | 'compiler' | 'open';

export interface ClangdRestartState {
  /** 本次生成的重启原因；undefined = 该次生成不涉及重启（例如仅设置变更触发） */
  reason: ClangdRestartReason | undefined;
  /** 编译数据库未变化（生成结果与磁盘一致，跳过写入） */
  databaseUnchanged: boolean;
  /** 本次实际写入了新的 clangd 用户配置（config.yaml 内容有变化） */
  configWritten: boolean;
  /** 本次生成由启动恢复（窗口重载后恢复上次会话工程）触发 */
  fromSessionRestore: boolean;
  /** 用户是否允许「切换活动工程时重启 clangd」 */
  restartAllowed: boolean;
  /** 存在需要刷新分析的消费者：clangd 扩展已激活，或已打开 C/C++ 文件 */
  hasConsumer: boolean;
}

/** 'restart' = 重启；'skip-config-only' = 启动恢复期间仅配置变化，跳过（需留痕说明）；'skip' = 无需重启 */
export type ClangdRestartAction = 'restart' | 'skip-config-only' | 'skip';

export function decideClangdRestart(state: ClangdRestartState): ClangdRestartAction {
  const { reason, databaseUnchanged, configWritten, fromSessionRestore, restartAllowed, hasConsumer } = state;
  if (!reason || !hasConsumer) return 'skip';
  if (reason === 'project' && !restartAllowed) return 'skip';
  if (databaseUnchanged && !configWritten) return 'skip';
  if (fromSessionRestore && reason === 'open' && databaseUnchanged && configWritten) return 'skip-config-only';
  return 'restart';
}
