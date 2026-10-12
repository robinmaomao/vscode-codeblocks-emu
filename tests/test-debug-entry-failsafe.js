// C-01 兜底（startTarget）：入口临时断点导致启动被中止时，必须撤断点重试一次
// 背景（CI 实测）：可重定位镜像（PE DYNAMICBASE）下入口地址断点插入失败会让 `-exec-run` 直接中止
// （GDB 17.1：Cannot access memory at address 0x1400013f0 → Command aborted.），
// 若不重试则**程序完全起不来**——stopOnEntry 失效可以接受，程序起不来不可以。
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

installVscodeMock();
const { GdbDebugAdapter } = require('../dist/debug/gdbDebugAdapter.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

/** 造一个假 session：按脚本序列决定 send/sendExact 的成败，并记录调用顺序 */
function fakeSession(plan) {
  const calls = [];
  let i = 0;
  const next = (kind, cmd) => {
    calls.push(`${kind}:${cmd}`);
    const step = plan[i++] ?? { ok: true };
    return step;
  };
  return {
    calls,
    send: async (cmd) => {
      const s = next('send', cmd);
      if (!s.ok) throw new Error(s.msg || 'Command aborted.');
      return { token: i, status: 'running', attrs: {}, raw: cmd };
    },
    sendExact: async (cmd) => {
      const s = next('sendExact', cmd);
      if (!s.ok) throw new Error(s.msg || 'Command aborted.');
      return { token: i, status: 'done', attrs: {}, raw: cmd };
    },
  };
}

async function makeAdapter() {
  const a = new GdbDebugAdapter('c01-failsafe');
  a.onDidSendMessage(() => { /* 丢弃事件 */ });
  a.session = { sendExact: async () => ({ attrs: {} }) }; // 让 dispose() 等路径可用
  a.stopOnEntry = true;
  a.entryBpNum = '1';
  a.entryStopLabel = '0x1400013f0';
  return a;
}

(async () => {
  // 1) 运行失败 + 存在入口断点 → 撤断点 + 重试一次 → 成功
  {
    const a = await makeAdapter();
    const out = [];
    a.sendOutput = (cat, text) => out.push(`${cat}:${text}`);
    a.session = fakeSession([
      { ok: false, msg: 'Cannot insert breakpoint 1. Cannot access memory at address 0x1400013f0' }, // -exec-run
      { ok: true },   // -break-delete 1
      { ok: true },   // -exec-run（重试）
    ]);
    const err = await a.startTarget();
    check('启动失败 + 有入口断点：返回 undefined（已重试成功）', err === undefined, err, undefined);
    check('启动失败 + 有入口断点：调用序列为 run → break-delete 1 → run',
      JSON.stringify(a.session.calls) === JSON.stringify(['send:-exec-run', 'sendExact:-break-delete 1', 'send:-exec-run']),
      a.session.calls, ['send:-exec-run', 'sendExact:-break-delete 1', 'send:-exec-run']);
    check('启动失败 + 有入口断点：清除 entryBpNum（不再跟踪已撤销的断点）', a.entryBpNum === null, a.entryBpNum, null);
    check('启动失败 + 有入口断点：targetRunning 置位', a.targetRunning === true, a.targetRunning, true);
    check('启动失败 + 有入口断点：输出一行中文说明（含 stopOnEntry 与原因）',
      out.some((l) => /stopOnEntry/.test(l) && /未能生效/.test(l) && /Cannot insert breakpoint/.test(l)), out, '中文说明 + 原因');
  }

  // 2) 无入口断点（用户没开 stopOnEntry）→ 不重试，错误原样上报
  {
    const a = await makeAdapter();
    a.sendOutput = () => { /* 忽略 */ };
    a.entryBpNum = null;
    a.session = fakeSession([{ ok: false, msg: 'not in executable format: file format not recognized' }]);
    const err = await a.startTarget();
    check('无入口断点：错误消息原样返回（不做多余重试）',
      err === 'not in executable format: file format not recognized' && a.session.calls.length === 1, { err, calls: a.session.calls },
      '原错误 + 仅 1 次 send');
  }

  // 3) 运行失败 + 有入口断点，但重试仍失败 → 返回第二次的错误（不掩盖真实原因）
  {
    const a = await makeAdapter();
    a.sendOutput = () => { /* 忽略 */ };
    a.session = fakeSession([{ ok: false, msg: 'Command aborted.' }, { ok: true }, { ok: false, msg: 'Command aborted.' }]);
    const err = await a.startTarget();
    check('重试仍失败：返回第二次的错误消息', err === 'Command aborted.' && a.session.calls.length === 3, { err, calls: a.session.calls },
      'Command aborted. + 3 次调用');
  }

  // 4) 静态接线：onConfigurationDone 走 startTarget（不再直接 send -exec-run），失败经 stderr 可见
  {
    const src = require('fs').readFileSync(path.resolve(__dirname, '../dist/debug/gdbDebugAdapter.js'), 'utf-8');
    check('静态接线：onConfigurationDone 调用 startTarget', /onConfigurationDone\(req\)[\s\S]{0,400}startTarget\(/.test(src), /onConfigurationDone\(req\)[\s\S]{0,400}startTarget\(/.test(src), true);
    check('静态接线：启动失败仍写 stderr 提示', /无法启动程序: \$\{err\}/.test(src), /无法启动程序: \$\{err\}/.test(src), true);
  }

  console.log(`\nC-01 启动兜底: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
