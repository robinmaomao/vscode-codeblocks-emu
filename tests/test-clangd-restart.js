// clangd 重启合并器：合并窗口 / 最小间隔 / 取消 / 异常安全。
// 回归：连续两次 clangd.restart 会触发 clangd 扩展 "command 'clangd.applyFix' already exists"，
// 导致语言服务器客户端创建失败（通知 couldn't create connection to server）。
const path = require('path');
const {
  createClangdRestartCoalescer,
  waitForClangdRestartable,
  CLANGD_CLIENT_STATE_RUNNING,
  CLANGD_CLIENT_STATE_STARTING,
  CLANGD_CLIENT_STATE_STOPPED,
  CLANGD_RESTART_DEBOUNCE_MS,
  CLANGD_RESTART_MIN_INTERVAL_MS,
} = require('../dist/tools/clangdRestart.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

/** 可推进的假时钟 + 定时器队列 */
function fakeTimers() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: now + Math.max(0, ms), fn });
      return id;
    },
    clearTimer: (id) => { timers.delete(id); },
    /** 推进到指定时刻，按到期顺序执行回调 */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let nextId = null;
        let nextAt = Infinity;
        for (const [id, t] of timers) {
          if (t.at <= target && t.at < nextAt) { nextAt = t.at; nextId = id; }
        }
        if (nextId === null) break;
        const t = timers.get(nextId);
        timers.delete(nextId);
        now = t.at;
        t.fn();
      }
      now = target;
    },
    pending: () => timers.size,
  };
}

function make(run) {
  const clock = fakeTimers();
  const coalescer = createClangdRestartCoalescer(run, {
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { clock, coalescer };
}

// 1) 默认常量
check('默认合并窗口 > 0', CLANGD_RESTART_DEBOUNCE_MS > 0, CLANGD_RESTART_DEBOUNCE_MS);
check('默认最小间隔 >= 合并窗口', CLANGD_RESTART_MIN_INTERVAL_MS >= CLANGD_RESTART_DEBOUNCE_MS,
  { debounce: CLANGD_RESTART_DEBOUNCE_MS, min: CLANGD_RESTART_MIN_INTERVAL_MS });

// 2) 首次请求按合并窗口延迟执行
{
  let runs = 0;
  const { clock, coalescer } = make(() => { runs++; });
  coalescer.request();
  check('首次请求：进入 pending', coalescer.pending === true && runs === 0, { pending: coalescer.pending, runs });
  clock.advance(CLANGD_RESTART_DEBOUNCE_MS - 1);
  check('首次请求：窗口内不执行', runs === 0, runs);
  clock.advance(1);
  check('首次请求：窗口结束执行一次', runs === 1 && coalescer.runs === 1 && coalescer.pending === false,
    { runs, stat: coalescer.runs, pending: coalescer.pending });
}

// 3) 同一批连续请求合并为一次（核心回归）
{
  let runs = 0;
  const { clock, coalescer } = make(() => { runs++; });
  coalescer.request();
  clock.advance(400);
  coalescer.request();
  clock.advance(400);
  coalescer.request();
  clock.advance(CLANGD_RESTART_DEBOUNCE_MS);
  check('连续请求：只执行一次', runs === 1, runs);
}

// 4) 执行后短时间内再次请求：满足最小间隔
{
  let runs = 0;
  const { clock, coalescer } = make(() => { runs++; });
  coalescer.request();
  clock.advance(CLANGD_RESTART_DEBOUNCE_MS);
  const firstAt = clock.now();
  coalescer.request();
  clock.advance(CLANGD_RESTART_DEBOUNCE_MS);
  check('最小间隔：未到间隔不执行', runs === 1, { runs, elapsed: clock.now() - firstAt });
  clock.advance(CLANGD_RESTART_MIN_INTERVAL_MS - (clock.now() - firstAt));
  check('最小间隔：到点执行第二次', runs === 2, { runs, elapsed: clock.now() - firstAt });
}

// 5) 间隔已足够时只需合并窗口
{
  let runs = 0;
  const { clock, coalescer } = make(() => { runs++; });
  coalescer.request();
  clock.advance(CLANGD_RESTART_DEBOUNCE_MS);
  clock.advance(CLANGD_RESTART_MIN_INTERVAL_MS);
  coalescer.request();
  clock.advance(CLANGD_RESTART_DEBOUNCE_MS);
  check('间隔足够：仅等合并窗口', runs === 2, runs);
}

// 6) cancel 取消待执行请求
{
  let runs = 0;
  const { clock, coalescer } = make(() => { runs++; });
  coalescer.request();
  coalescer.cancel();
  clock.advance(CLANGD_RESTART_MIN_INTERVAL_MS * 2);
  check('cancel：不再执行', runs === 0 && coalescer.pending === false, { runs, pending: coalescer.pending, timers: clock.pending() });
}

// 7) 异常的 run 不影响后续请求
{
  let calls = 0;
  const { clock, coalescer } = make(() => { calls++; throw new Error('boom'); });
  coalescer.request();
  clock.advance(CLANGD_RESTART_DEBOUNCE_MS);
  coalescer.request();
  clock.advance(CLANGD_RESTART_MIN_INTERVAL_MS);
  check('run 抛错：吞掉异常并继续调度', calls === 2, calls);
}

// 8) 异步 run 的 rejection 不产生未处理拒绝
(async () => {
  const { clock, coalescer } = make(() => Promise.reject(new Error('async boom')));
  const unhandled = [];
  const onUnhandled = (err) => unhandled.push(err);
  process.on('unhandledRejection', onUnhandled);
  coalescer.request();
  clock.advance(CLANGD_RESTART_DEBOUNCE_MS);
  await new Promise((resolve) => setImmediate(resolve));
  process.off('unhandledRejection', onUnhandled);
  check('异步 run 失败：无未处理拒绝', unhandled.length === 0, unhandled.map((e) => e && e.message));

  // 9) 自定义参数
  {
    let runs = 0;
    const clock = fakeTimers();
    const coalescer = createClangdRestartCoalescer(() => { runs++; }, {
      debounceMs: 100, minIntervalMs: 200, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer,
    });
    coalescer.request();
    clock.advance(100);
    check('自定义参数：按 debounceMs 执行', runs === 1, runs);
    coalescer.request();
    clock.advance(100);
    check('自定义参数：按 minIntervalMs 延迟', runs === 1, runs);
    clock.advance(100);
    check('自定义参数：间隔到点执行', runs === 2, runs);
  }

  // ---- waitForClangdRestartable：客户端状态门（applyFix 重复注册的直接根因） ----
  /** 按序列返回状态的探针（最后一个值保持） */
  function stateSeq(...values) {
    let i = 0;
    return () => values[Math.min(i++, values.length - 1)];
  }
  const noSleep = async () => {};

  check('状态：拿不到状态（旧版扩展）→ 直接放行',
    await waitForClangdRestartable(() => undefined, { sleep: noSleep }), null);
  check('状态：Stopped → 自动重启跳过',
    (await waitForClangdRestartable(() => CLANGD_CLIENT_STATE_STOPPED, { sleep: noSleep })) === false, null);
  check('状态：Stopped + 手动 → 放行',
    await waitForClangdRestartable(() => CLANGD_CLIENT_STATE_STOPPED, { sleep: noSleep, allowStartWhenStopped: true }), null);
  check('状态：Running → 稳定期后放行',
    await waitForClangdRestartable(() => CLANGD_CLIENT_STATE_RUNNING, { sleep: noSleep, settleMs: 10 }), null);

  {
    let polls = 0;
    let slept = 0;
    // 调用序：入口探测(1) → 轮询(2) → 轮询(3, Running) → 稳定期后复核(4)
    const ok = await waitForClangdRestartable(
      () => { polls++; return polls < 3 ? CLANGD_CLIENT_STATE_STARTING : CLANGD_CLIENT_STATE_RUNNING; },
      { settleMs: 5, pollMs: 1, sleep: async (ms) => { slept += ms; } },
    );
    check('状态：Starting → 等到 Running 再放行（含稳定期）', ok === true && polls === 4 && slept === 7, { ok, polls, slept });
  }

  {
    let timeoutCalls = 0;
    let state = CLANGD_CLIENT_STATE_STARTING;
    let clock = 0;
    const ok = await waitForClangdRestartable(() => state, {
      startTimeoutMs: 100,
      pollMs: 20,
      settleMs: 0,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      onStartTimeout: () => { timeoutCalls++; },
    });
    check('状态：Starting 超时 → 跳过并回调留痕', ok === false && timeoutCalls === 1, { ok, timeoutCalls, clock });
  }

  {
    let calls = 0;
    let state = CLANGD_CLIENT_STATE_RUNNING;
    const ok = await waitForClangdRestartable(() => { calls++; return state; }, {
      settleMs: 10,
      sleep: async () => { state = CLANGD_CLIENT_STATE_STOPPED; },
    });
    check('状态：稳定期内客户端停止 → 不再追加重启', ok === false && calls >= 2, { ok, calls });
  }

  console.log(`\nclangd 重启合并: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  console.log(`\nclangd 重启合并: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
