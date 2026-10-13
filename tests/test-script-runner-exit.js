// post-build 脚本结束判定回归（P1 根因修复 + 输出实时化/心跳/超时）：
//   · 命令本体（cmd.exe）退出后不再等后台孙进程 —— 对齐 CodeBlocks wxExecute 同步等待语义
//   · 管道排空宽限 codeblocks.build.scriptExitGraceMs（默认 1500，0 = 立即结束）
//   · 输出实时流式写入（不再等命令结束才回放）+ 长命令心跳行（区分脚本慢 / 扩展慢）
//   · 可选超时 codeblocks.build.scriptCommandTimeoutMs（默认 0 = 不超时，对齐 CB 无限等待）
//   · ScriptResult.trailingBackground / timedOut 标记 + runScriptCommands 的说明行
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

const { runScriptCommand, runScriptCommands, scriptExitGraceMs, scriptCommandTimeoutMs, SCRIPT_EXIT_GRACE_DEFAULT_MS, SCRIPT_EXIT_GRACE_MAX_MS, SCRIPT_TIMEOUT_MAX_MS, SCRIPT_HEARTBEAT_MS, SCRIPT_EXIT_QUIET_MS } = require('../dist/build/scriptRunner.js');
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
  //    FIX-3：宽限是**上限**，管道安静 SCRIPT_EXIT_QUIET_MS 即收尾 ⇒ 默认 1500ms 宽限下实测 ~250ms
  t0 = Date.now();
  const bg = await runScriptCommand(BG_CMD, process.cwd(), {});
  const bgMs = Date.now() - t0;
  check('后台孙进程：有界结束（<3s，修复前 ~5.1s）', bgMs < 3000, bgMs, '<3000ms');
  check('后台孙进程：标记 trailingBackground', bg.trailingBackground === true, bg.trailingBackground, true);
  check(`后台孙进程：管道安静 ${SCRIPT_EXIT_QUIET_MS}ms 即提前收尾（<1s，宽限上限 1.5s）`, bgMs < 1000, bgMs, '<1000ms');
  check('后台孙进程：安静期已生效（>= 安静阈值，未立即返回）', bgMs >= SCRIPT_EXIT_QUIET_MS, bgMs, `>=${SCRIPT_EXIT_QUIET_MS}ms`);

  // 3. scriptExitGraceMs = 0：命令本体结束即继续（严格等同 CodeBlocks；不观察后台进程）
  cfgOverrides = { 'build.scriptExitGraceMs': 0 };
  check('宽限读取：0 生效', scriptExitGraceMs() === 0, scriptExitGraceMs(), 0);
  t0 = Date.now();
  const bg0 = await runScriptCommand(BG_CMD, process.cwd(), {});
  const bg0Ms = Date.now() - t0;
  check('宽限 0：立即结束（<1s）', bg0Ms < 1000, bg0Ms, '<1000ms');
  check('宽限 0：不做后台进程观察（无标记）', !bg0.trailingBackground, bg0.trailingBackground, undefined);
  cfgOverrides = {};

  // 3b. 有持续输出时安静期不会提前触发：宽限仍是**上限**（到点收尾并标记后台进程）
  //     后台 node 每 100ms 写一行（间隔 < 安静阈值 250ms）⇒ 安静判定永不成立，只能等宽限到点。
  const tickFile = require('path').join(require('os').tmpdir(), `cb-tick-${process.pid}-${Date.now()}.js`);
  require('fs').writeFileSync(tickFile, [
    'let n = 0;',
    'const t = setInterval(() => { process.stdout.write("TICK_" + (++n) + "\\n"); if (n >= 18) clearInterval(t); }, 100);',
    '',
  ].join('\n'));
  cfgOverrides = { 'build.scriptExitGraceMs': 400 };
  t0 = Date.now();
  const tickRes = await runScriptCommand(`echo PB_TICK_START & start "" /b node "${tickFile}"`, process.cwd(), {});
  const tickMs = Date.now() - t0;
  check('持续输出：宽限上限到点收尾（>=400ms，未提前）', tickMs >= 400, tickMs, '>=400ms');
  check('持续输出：不等后台进程结束（<1.4s，后台 ~1.8s）', tickMs < 1400, tickMs, '<1400ms');
  check('持续输出：标记 trailingBackground', tickRes.trailingBackground === true, tickRes.trailingBackground, true);
  check('持续输出：本体输出在最前（顺序保持）', /^PB_TICK_START[ \t]*\r?\n/.test(tickRes.output), tickRes.output.trim().split('\n').slice(0, 3).join('|'), 'PB_TICK_START 首行');
  check('持续输出：收尾前到达的后台行已进入 output', /TICK_[12]/.test(tickRes.output), tickRes.output.trim().split('\n').slice(0, 5).join('|'), 'TICK_1..');
  cfgOverrides = {};
  try { require('fs').rmSync(tickFile, { force: true }); } catch { /* ignore */ }

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

  // 9. 输出实时流式（不再等命令结束才回放）
  //    命令先 echo 再睡眠：该行必须在 Promise resolve 之前回调
  const streamLines = [];
  t0 = Date.now();
  const streamP = runScriptCommand('echo PB_EARLY & ping -n 4 127.0.0.1 >nul', process.cwd(), {}, undefined, undefined, (l) => streamLines.push({ l, ms: Date.now() - t0 }));
  const streamRes = await streamP;
  const streamMs = Date.now() - t0;
  const early = streamLines.find((x) => /PB_EARLY/.test(x.l));
  check('流式：首行在命令结束前已回调（端到端证明不缓冲）', !!early && early.ms < streamMs - 1000, { early: early?.ms, total: streamMs }, 'early < total-1000');
  check('流式：回调行为已解码纯文本（无换行）', !!early && !/\r|\n/.test(early.l), early?.l, 'PB_EARLY');
  check('流式：命令本体仍等待结束（>=2s）', streamMs >= 2000, streamMs, '>=2000ms');
  check('流式：返回的 output 与流式内容一致', /PB_EARLY/.test(streamRes.output), streamRes.output, 'PB_EARLY');

  // 10. 心跳行（长命令运行期间周期性提示；plainCbLog 静默）
  const hbLogs = [];
  const hbStart = Date.now();
  const hbOk = await runScriptCommands([`ping -n ${Math.ceil((SCRIPT_HEARTBEAT_MS + 1500) / 1000)} 127.0.0.1 >nul`], process.cwd(), {}, (l) => hbLogs.push({ l, ms: Date.now() - hbStart }));
  const hbLines = hbLogs.filter((x) => /仍在运行 \(\d+s\)…/.test(x.l));
  check('心跳：长命令期间出现「仍在运行」行', hbOk === true && hbLines.length >= 1, hbLines.map((x) => x.l), '>=1');
  check('心跳：首条含可操作提示（网络盘/停止构建）', hbLines.some((x) => /网络盘\/服务等待/.test(x.l) && /停止构建/.test(x.l)), hbLines[0]?.l, '含提示');
  check('心跳：出现在命令结束之前', !!hbLines[0] && hbLines[0].ms < (hbLogs[hbLogs.length - 1]?.ms ?? Infinity), hbLines[0]?.ms, 'early');
  cfgOverrides = { 'build.plainCbLog': true };
  resetBuildLogPrefsCache();
  const hbPlain = [];
  await runScriptCommands([`ping -n ${Math.ceil((SCRIPT_HEARTBEAT_MS + 1500) / 1000)} 127.0.0.1 >nul`], process.cwd(), {}, (l) => hbPlain.push(l));
  check('心跳：plainCbLog 模式静默', !hbPlain.some((l) => /仍在运行/.test(l)), hbPlain, 'no heartbeat');
  cfgOverrides = {};
  resetBuildLogPrefsCache();

  // 11. 可选超时（codeblocks.build.scriptCommandTimeoutMs，默认 0 = 不超时）
  check('超时读取：默认 0（不超时，对齐 CB）', scriptCommandTimeoutMs() === 0, scriptCommandTimeoutMs(), 0);
  cfgOverrides = { 'build.scriptCommandTimeoutMs': 2000 };
  check('超时读取：2000 生效', scriptCommandTimeoutMs() === 2000, scriptCommandTimeoutMs(), 2000);
  const toStart = Date.now();
  const toRes = await runScriptCommand('ping -n 8 127.0.0.1 >nul', process.cwd(), {});
  const toMs = Date.now() - toStart;
  check('超时：命令被终止并标记 timedOut', toRes.success === false && toRes.timedOut === true, { ok: toRes.success, timedOut: toRes.timedOut }, { ok: false, timedOut: true });
  check('超时：在超时点附近收敛（<6s，命令本体 7s+）', toMs < 6000, toMs, '<6000ms');
  // 超时杀进程树后，同会话后续命令仍可正常执行（无残留阻塞）
  const afterTo = await runScriptCommand('echo PB_AFTER_TIMEOUT', process.cwd(), {});
  check('超时后：后续命令仍可执行', afterTo.success === true && /PB_AFTER_TIMEOUT/.test(afterTo.output), afterTo.output, 'PB_AFTER_TIMEOUT');
  // 超时日志行（runScriptCommands 层）
  cfgOverrides = { 'build.scriptCommandTimeoutMs': 1500 };
  const toLogs = [];
  const toOk = await runScriptCommands(['ping -n 8 127.0.0.1 >nul'], process.cwd(), {}, (l) => toLogs.push(l));
  check('超时：runScriptCommands 返回失败', toOk === false, toOk, false);
  check('超时：日志给出明确超时行', toLogs.some((l) => /\[script 1-1\] 超时（[\d.]+s > 1\.5s），已终止该命令/.test(l)), toLogs, '超时行');
  cfgOverrides = { 'build.scriptCommandTimeoutMs': -100 };
  check('超时读取：负值钳制为 0', scriptCommandTimeoutMs() === 0, scriptCommandTimeoutMs(), 0);
  cfgOverrides = { 'build.scriptCommandTimeoutMs': Number.NaN };
  check('超时读取：NaN 回退 0', scriptCommandTimeoutMs() === 0, scriptCommandTimeoutMs(), 0);
  cfgOverrides = { 'build.scriptCommandTimeoutMs': 9_999_999 };
  check('超时读取：超大值钳制上限', scriptCommandTimeoutMs() === SCRIPT_TIMEOUT_MAX_MS, scriptCommandTimeoutMs(), SCRIPT_TIMEOUT_MAX_MS);
  cfgOverrides = {};

  // 12. 超时杀树后的「孤儿收割」硬化（仅 Windows）
  //     杀树（taskkill /T /F）是瞬时快照式的：快照之后才产生的子孙、或者根已退出时的空操作，
  //     都会让脚本继续解释后续行并启动 start /b 后台进程（实测：杀树后 1~10s 仍出现新进程）。
  //     硬化做法：运行期采集进程树 PID → 杀树 → 按「父 PID ∈ 已终止集合」多轮收割孤儿。
  const { snapshotDescendantPids, reapOrphans, killProcessTree } = require('../dist/build/cancelToken.js');
  const { spawn, execFile } = require('child_process');
  const os = require('os');
  const fs = require('fs');
  const nodePath = require('path');
  const psOut = (script) => new Promise((resolve) => {
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true, timeout: 20000 }, (err, stdout) => resolve(err ? '' : String(stdout || '').trim()));
  });
  const psNumbers = async (script) => (await psOut(script)).split(/\r?\n/)
    .map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  /** 按「命令行含唯一标记」找进程（标记按前后两半分写，避免 PowerShell 命中自身命令行） */
  const findMarked = (marker) => psOut([
    '$ErrorActionPreference = "SilentlyContinue"',
    `$m = "${marker.slice(0, 9)}" + "${marker.slice(9)}"`,
    'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like ("*" + $m + "*")) } | ForEach-Object { "{0}|{1}" -f $_.ProcessId, $_.ParentProcessId }',
  ].join('\n')).then((out) => out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    .map((row) => row.split('|')[0]).filter((s) => Number(s) > 0 && Number(s) !== process.pid));
  if (process.platform !== 'win32') {
    console.log('SKIP 孤儿收割（仅 Windows）');
  } else {
    // 12a. 进程树采集：root → 子孙 的 PID 集合（中间层退出后仍可按 PPID 值追溯的依据）
    const tree = spawn('cmd.exe', ['/c', 'ping -n 20 127.0.0.1 >nul'], { windowsHide: true, stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 500));
    const treePids = await snapshotDescendantPids(tree.pid);
    check('快照：采集到子孙进程（cmd → ping）', treePids.length >= 1, treePids, '>=1');
    check('快照：不含 root 自身', !treePids.includes(tree.pid), treePids, 'no root');
    check('快照：非法 PID 返回空集', (await snapshotDescendantPids(-1)).length === 0, 'n/a', '[]');
    killProcessTree(tree);
    await new Promise((r) => setTimeout(r, 1500));
    const stillAlive = await psNumbers(`$ErrorActionPreference = "SilentlyContinue"; Get-Process -Id ${treePids.join(',')} | ForEach-Object { $_.Id }`);
    check('杀树：快照内进程全部终止', stillAlive.length === 0, stillAlive, '[]');

    // 12b. 孤儿收割：模拟「逃逸」形态 —— 中间 cmd 先退出，后台 node 的 PPID 指向已消失的 PID
    const marker = `CBESC_${process.pid}_${Date.now()}`;
    const sleeper = nodePath.join(os.tmpdir(), `cb-escape-${process.pid}-${Date.now()}.js`);
    fs.writeFileSync(sleeper, 'setTimeout(function () {}, 15000);\n');
    // 中间 cmd 执行 start /b node … 后立即退出：node 的 PPID 指向已消失的中间 cmd（逃逸形态）
    const launch = (m) => new Promise((resolve) => {
      const mid = spawn('cmd.exe', ['/c', 'start', '', '/b', 'node', sleeper, m], { windowsHide: true, stdio: 'ignore' });
      mid.on('exit', () => resolve(mid.pid));
      setTimeout(() => resolve(mid.pid), 4000);
    });
    const staleMarker = `${marker}_old`;
    const midPid = await launch(staleMarker);
    await new Promise((r) => setTimeout(r, 900));
    const before = await findMarked(staleMarker);
    check('收割前置：后台 node 已启动（其父 cmd 已退出）', before.length >= 1, before, '>=1');
    // 收割集合 = 已终止的中间 cmd PID + 探测到的父 PID（模拟 snapshotDescendantPids 的产出）
    const beforePpids = await psNumbers([
      '$ErrorActionPreference = "SilentlyContinue"',
      `$m = "${staleMarker.slice(0, 9)}" + "${staleMarker.slice(9)}"`,
      'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and ($_.CommandLine -like ("*" + $m + "*")) } | ForEach-Object { $_.ParentProcessId }',
    ].join('\n'));
    reapOrphans([midPid, ...beforePpids], 3, 500);
    let gone = [];
    for (let i = 0; i < 16; i++) {
      await new Promise((r) => setTimeout(r, 500));
      gone = await findMarked(staleMarker);
      if (!gone.length) break;
    }
    check('收割：孤儿后台进程被回收（父 PID 已消失）', gone.length === 0, gone, '[]');
    for (const pid of gone) { try { require('child_process').execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch { /* ignore */ } }
    check('收割：空集合调用安全（no-op）', (() => { try { reapOrphans([]); return true; } catch { return false; } })(), 'n/a', true);
    check('收割：自身 PID 不会被纳入（防 PID 复用误杀）', (() => { try { reapOrphans([process.pid]); return true; } catch { return false; } })(), 'n/a', true);
    try { fs.rmSync(sleeper, { force: true }); } catch { /* ignore */ }
  }

  await Promise.resolve();
  console.log(`post-build 脚本结束判定: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
