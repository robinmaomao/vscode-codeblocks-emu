// post-build 脚本结束判定回归（P1 根因修复）：
//   · 命令本体（cmd.exe）退出后不再等后台孙进程 —— 对齐 CodeBlocks wxExecute 同步等待语义
//   · 管道排空宽限 codeblocks.build.scriptExitGraceMs（默认 1500，0 = 立即结束）
//   · ScriptResult.trailingBackground 标记 + runScriptCommands 的后台进程说明行 / 慢命令耗时行
// 复现基线（修复前）：`start "" /b ping -n 6 …` 命令本体 47ms 结束，引擎却等 5113ms（5s 白等）。
const Module = require('module');
const origLoad = Module._load;

/** 设置覆盖（模拟 vscode.workspace.getConfiguration('codeblocks')） */
let cfgOverrides = {};
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({ get: (k, d) => (Object.prototype.hasOwnProperty.call(cfgOverrides, k) ? cfgOverrides[k] : d) }),
      },
      window: { showWarningMessage: () => {}, showInformationMessage: () => {} },
      env: {},
    };
  }
  return origLoad(request, parent, isMain);
};

const { runScriptCommand, runScriptCommands, scriptExitGraceMs, SCRIPT_EXIT_GRACE_DEFAULT_MS, SCRIPT_EXIT_GRACE_MAX_MS } = require('../dist/build/scriptRunner.js');
const { resetBuildLogPrefsCache } = require('../dist/build/logLang.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}

/** 后台孙进程探针命令（继承 stdout/stderr 管道；ping 自终止，不留残留进程） */
const BG_CMD = 'start "" /b ping -n 6 127.0.0.1 >nul';

(async () => {
  // 1. 前台命令：正常结束，输出完整，无后台标记
  let t0 = Date.now();
  const fg = await runScriptCommand('echo PB_FOREGROUND', process.cwd(), {});
  const fgMs = Date.now() - t0;
  check('前台命令成功', fg.success === true, fg.success, true);
  check('前台命令输出被捕获', /PB_FOREGROUND/.test(fg.output), fg.output, 'PB_FOREGROUND');
  check('前台命令无后台标记', !fg.trailingBackground, fg.trailingBackground, undefined);
  check('前台命令未触发宽限等待（<1.5s）', fgMs < SCRIPT_EXIT_GRACE_DEFAULT_MS, fgMs, '<1500ms');

  // 2. 后台孙进程：命令本体（cmd.exe）秒退，不得被孙进程拖住（修复前 5.1s）
  t0 = Date.now();
  const bg = await runScriptCommand(BG_CMD, process.cwd(), {});
  const bgMs = Date.now() - t0;
  check('后台孙进程：有界结束（<3s，修复前 ~5.1s）', bgMs < 3000, bgMs, '<3000ms');
  check('后台孙进程：标记 trailingBackground', bg.trailingBackground === true, bg.trailingBackground, true);
  check('后台孙进程：默认宽限生效（>=1.2s 以排空管道）', bgMs >= 1200, bgMs, '>=1200ms');

  // 3. scriptExitGraceMs = 0：命令本体结束即继续（严格等同 CodeBlocks；不观察后台进程）
  cfgOverrides = { 'build.scriptExitGraceMs': 0 };
  check('宽限读取：0 生效', scriptExitGraceMs() === 0, scriptExitGraceMs(), 0);
  t0 = Date.now();
  const bg0 = await runScriptCommand(BG_CMD, process.cwd(), {});
  const bg0Ms = Date.now() - t0;
  check('宽限 0：立即结束（<1s）', bg0Ms < 1000, bg0Ms, '<1000ms');
  check('宽限 0：不做后台进程观察（无标记）', !bg0.trailingBackground, bg0.trailingBackground, undefined);

  // 4. 非法值钳制：负值/NaN → 0，超大 → 上限
  cfgOverrides = { 'build.scriptExitGraceMs': -5 };
  check('宽限读取：负值钳制为 0', scriptExitGraceMs() === 0, scriptExitGraceMs(), 0);
  cfgOverrides = { 'build.scriptExitGraceMs': Number.NaN };
  check('宽限读取：NaN 回退 0', scriptExitGraceMs() === 0, scriptExitGraceMs(), 0);
  cfgOverrides = { 'build.scriptExitGraceMs': 999999 };
  check('宽限读取：超大值钳制上限', scriptExitGraceMs() === SCRIPT_EXIT_GRACE_MAX_MS, scriptExitGraceMs(), SCRIPT_EXIT_GRACE_MAX_MS);
  cfgOverrides = {};
  check('宽限读取：默认值', scriptExitGraceMs() === SCRIPT_EXIT_GRACE_DEFAULT_MS, scriptExitGraceMs(), SCRIPT_EXIT_GRACE_DEFAULT_MS);

  // 5. 前台慢命令：仍需等命令本体结束（宽限不缩短真实命令的运行时间）
  t0 = Date.now();
  const slow = await runScriptCommand('ping -n 2 127.0.0.1', process.cwd(), {});
  const slowMs = Date.now() - t0;
  check('前台慢命令：等命令本体（>=1s）', slowMs >= 1000, slowMs, '>=1000ms');
  check('前台慢命令：输出被捕获', slow.output.trim().length > 0, slow.output.length, '>0');
  check('前台慢命令：无后台标记', !slow.trailingBackground, slow.trailingBackground, undefined);
  cfgOverrides = {};

  // 6. runScriptCommands：编号顺序 + 后台进程说明行（增强模式）
  resetBuildLogPrefsCache();
  const logs = [];
  const okRun = await runScriptCommands(['echo PB_A', BG_CMD], process.cwd(), {}, (l) => logs.push(l));
  check('多条命令全部成功', okRun === true, okRun, true);
  const joined = logs.join('\n');
  check('命令编号顺序正确', joined.indexOf('[script 1-2] echo PB_A') < joined.indexOf('[script 2-2]'), joined.slice(0, 120), '[script 1-2] → [script 2-2]');
  check('第一条命令输出缩进保留', /\n {2}PB_A/.test(joined), joined, '  PB_A');
  check('后台进程说明行（增强模式）', /\[script 2-2\] 后台进程仍在运行/.test(joined), joined, '后台进程仍在运行');

  // 7. plainCbLog：纯 CB 日志（无编号、无说明行）
  cfgOverrides = { 'build.plainCbLog': true };
  resetBuildLogPrefsCache();
  const plainLogs = [];
  await runScriptCommands(['echo PB_B', BG_CMD], process.cwd(), {}, (l) => plainLogs.push(l));
  const plainJoined = plainLogs.join('\n');
  check('plain 模式：无脚本编号', !/\[script \d+-\d+\]/.test(plainJoined), plainJoined, 'no [script n-m]');
  check('plain 模式：无后台进程说明行', !/后台进程仍在运行/.test(plainJoined), plainJoined, 'no notice');
  cfgOverrides = {};
  resetBuildLogPrefsCache();

  // 8. 取消句柄语义不变：命令间检查点不再执行后续命令
  const cancel = { isCancelled: () => true, register: () => {}, unregister: () => {} };
  const cancelLogs = [];
  const cancelOk = await runScriptCommands(['echo PB_NEVER'], process.cwd(), {}, (l) => cancelLogs.push(l), undefined, cancel);
  check('取消后不再执行命令', cancelOk === false && cancelLogs.length === 0, { ok: cancelOk, lines: cancelLogs.length }, { ok: false, lines: 0 });
  const preCancelled = await runScriptCommand('echo PB_NEVER', process.cwd(), {}, undefined, cancel);
  check('spawn 前取消：立即返回失败', preCancelled.success === false && preCancelled.output === '', preCancelled, { success: false, output: '' });

  await Promise.resolve();
  console.log(`post-build 脚本结束判定: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
