// 外部修改检测回归（对齐 Code::Blocks ProjectManagerUI::CheckForExternallyModifiedProjects）：
//  - .cbp 的 change 事件（及窗口焦点检查）→ 弹窗询问是否重新加载
//  - 选「重新加载」→ 重新解析并刷新模型（新增目标立即可见）
//  - 选「忽略」→ 不重载、且不再重复弹（等价 cbProject::Touch）
//  - 扩展自己写盘（setProgramArguments）不触发弹窗
//  - 外部写到一半/XML 损坏 → 报错并保留旧模型
//  - codeblocks.detect.checkExternalChanges=off → 不检测；手动命令仍可用
//
// 说明：扩展模块级状态绑定首次 require('vscode') 的 mock，故**每个配置场景单起一个子进程**（--case <name>）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const outText = (app) => (app.mock.channels || []).map((c) => (c.lines || []).join('\n')).join('\n');

/** 写一个最小可解析的 .cbp；targets 决定 <Build> 中的目标列表，virtualTargets 生成 <VirtualTargets> */
function writeCbp(file, title, targets, virtualTargets = []) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const build = targets.length
    ? '\t\t<Build>\n'
      + targets.map((t) => '\t\t\t<Target title="' + t + '">\n\t\t\t\t<Option type="1" />\n\t\t\t\t<Option compiler="gcc" />\n\t\t\t</Target>\n').join('')
      + '\t\t</Build>\n'
    : '\t\t<Build />\n';
  const vtargets = virtualTargets.length
    ? '\t\t<VirtualTargets>\n'
      + virtualTargets.map((v) => `\t\t\t<Add alias="${v.alias}" targets="${v.targets}" />\n`).join('')
      + '\t\t</VirtualTargets>\n'
    : '';
  fs.writeFileSync(file,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n\t<FileVersion major="1" minor="6" />\n\t<Project>\n'
    + `\t\t<Option title="${title}" />\n\t\t<Option compiler="gcc" />\n`
    + build
    + vtargets
    + '\t\t<Unit filename="main.c" />\n\t</Project>\n</CodeBlocks_project_file>\n', 'utf-8');
}

/** 当前选中目标（通过"选择目标"对话框里的 Current 标记观察） */
async function currentTarget(app) {
  await app.invoke('codeblocks.selectProjectTarget');
  const last = app.records.quickPickPrompts[app.records.quickPickPrompts.length - 1];
  const cur = last && last.raw.find((i) => i && i.description);
  return cur ? cur.label : undefined;
}

/** 读取当前工程目标列表（通过"选择目标"对话框的条目观察模型） */
async function targetTitles(app) {
  await app.invoke('codeblocks.selectProjectTarget');
  const last = app.records.quickPickPrompts[app.records.quickPickPrompts.length - 1];
  return last ? last.items : [];
}

/** 场景 1：默认 prompt —— 外部改动弹窗 / 忽略 / 重新加载 / 自写盘不弹 / 损坏保留旧模型 */
async function runPromptCase(c) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-extchg-'));
  const cbp = path.join(tmp, 'app', 'app.cbp');
  writeCbp(cbp, 'app', ['Debug']);

  const app = await activate({ tmpDir: tmp, findFilesResult: [cbp] });
  await sleep(80);
  c.check('A1 启动自动打开工程', /已打开项目/.test(outText(app)), outText(app).slice(-120), '含「已打开项目」');
  c.check('A2 初始目标只有 Debug', JSON.stringify(await targetTitles(app)) === JSON.stringify(['Debug']), await targetTitles(app), ['Debug']);

  // ---------- D. 扩展自己写盘不触发弹窗（单目标：只弹输入框） ----------
  const beforeSelf = app.records.warningButtons.length;
  app.setInputBox('--selftest');
  await app.invoke('codeblocks.setProgramArguments');
  await sleep(50);
  c.check('D1 扩展写盘后 .cbp 已更新', /--selftest/.test(fs.readFileSync(cbp, 'utf-8')), 'written', '含 --selftest');
  app.mock.emitFileEvent('change', cbp);
  await sleep(400);
  c.check('D2 扩展自己写盘不触发「已在磁盘上被修改」', app.records.warningButtons.length === beforeSelf, app.records.warningButtons.length, beforeSelf);

  // ---------- B. 外部改动 → 弹窗；选「忽略」 ----------
  writeCbp(cbp, 'app', ['Debug', 'Release']);
  app.setWarningButton('忽略');
  app.mock.emitFileEvent('change', cbp);
  await sleep(400);
  const warn1 = app.records.warningButtons.find((w) => /已在磁盘上被修改/.test(String(w.message)));
  c.check('B1 change 事件触发「已在磁盘上被修改」询问', !!warn1, app.records.warningButtons.map((w) => w.message), '含询问');
  c.check('B2 询问按钮为 重新加载 / 忽略',
    !!warn1 && warn1.buttons.includes('重新加载') && warn1.buttons.includes('忽略'), warn1 && warn1.buttons, ['重新加载', '忽略']);
  c.check('B3 选「忽略」不重载（输出无重载日志）', !/已从磁盘重新加载工程/.test(outText(app)), outText(app).slice(-200), '无重载日志');
  c.check('B4 选「忽略」后模型仍是旧目标', JSON.stringify(await targetTitles(app)) === JSON.stringify(['Debug']), await targetTitles(app), ['Debug']);

  // 未再改动文件 → 再次 change 事件不应重复弹窗（签名已更新）
  const warnCount = app.records.warningButtons.length;
  app.mock.emitFileEvent('change', cbp);
  await sleep(400);
  c.check('B5 文件未再变化时不重复弹窗', app.records.warningButtons.length === warnCount, app.records.warningButtons.length, warnCount);

  // ---------- C. 再次外部改动 → 选「重新加载」 ----------
  writeCbp(cbp, 'app', ['Debug', 'Release', 'Profile']);
  app.setWarningButton('重新加载');
  app.mock.emitFileEvent('change', cbp);
  await sleep(400);
  c.check('C1 选「重新加载」后输出重载日志', /已从磁盘重新加载工程/.test(outText(app)), outText(app).slice(-200), '含已从磁盘重新加载工程');
  const titles = await targetTitles(app);
  c.check('C2 重载后模型包含外部新增的目标', JSON.stringify(titles) === JSON.stringify(['Debug', 'Release', 'Profile']), titles, ['Debug', 'Release', 'Profile']);

  // ---------- I. 虚拟目标作为"已选目标"时，重载后应保留 ----------
  writeCbp(cbp, 'app', ['Debug', 'Release', 'Profile'], [{ alias: 'Everything', targets: 'Debug;Release;Profile' }]);
  await app.invoke('codeblocks.reloadProject');
  app.setQuickPick({ label: 'Everything' });
  await app.invoke('codeblocks.selectProjectTarget');
  const cur1 = await currentTarget(app);
  c.check('I1 已切换到虚拟目标 Everything', cur1 === 'Everything', cur1, 'Everything');
  writeCbp(cbp, 'app', ['Debug', 'Release', 'Profile', 'Extra'], [{ alias: 'Everything', targets: 'Debug;Release;Profile' }]);
  app.setWarningButton('重新加载');
  app.mock.emitFileEvent('change', cbp);
  await sleep(400);
  const cur2 = await currentTarget(app);
  c.check('I2 重载后仍保留虚拟目标选择', cur2 === 'Everything', cur2, 'Everything');

  // ---------- E. 外部写到一半（XML 损坏）→ 报错且保留旧模型 ----------
  fs.writeFileSync(cbp, '<CodeBlocks_project_file><Project><Option title="broken"', 'utf-8');
  app.setWarningButton('重新加载');
  app.mock.emitFileEvent('change', cbp);
  await sleep(400);
  c.check('E1 解析失败弹出错误提示', app.mock.warnings.some((m) => /从磁盘重新加载工程失败/.test(String(m))), app.mock.warnings, '含重载失败');
  const titlesAfterFail = await targetTitles(app);
  c.check('E2 解析失败保留旧模型', JSON.stringify(titlesAfterFail) === JSON.stringify(['Debug', 'Release', 'Profile', 'Extra', 'Everything']), titlesAfterFail, ['Debug', 'Release', 'Profile', 'Extra', 'Everything']);
  // 失败后基准已更新：文件未再变化时不应每次获得焦点都重复报错
  const warnAfterFail = app.records.warningButtons.length;
  app.mock.emitWindowState(true);
  await sleep(200);
  c.check('E3 解析失败后不反复弹窗（文件未再变化）', app.records.warningButtons.length === warnAfterFail, app.records.warningButtons.length, warnAfterFail);

  // ---------- F. 手动命令仍可用（恢复合法内容后） ----------
  writeCbp(cbp, 'app', ['OnlyManual']);
  await app.invoke('codeblocks.reloadProject');
  const titlesManual = await targetTitles(app);
  c.check('F1 手动「从磁盘重新加载工程」命令生效', JSON.stringify(titlesManual) === JSON.stringify(['OnlyManual']), titlesManual, ['OnlyManual']);

  await app.deactivate().catch(() => undefined);
}

/** 场景 2：窗口焦点检查（对齐 CB 应用激活时检查）+ 原子保存（create 事件） */
async function runFocusCase(c) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-extchg-focus-'));
  const cbp = path.join(tmp, 'app', 'app.cbp');
  writeCbp(cbp, 'app', ['Debug']);
  const app = await activate({ tmpDir: tmp, findFilesResult: [cbp] });
  await sleep(80);
  c.check('H1 工程已打开', /已打开项目/.test(outText(app)), outText(app).slice(-120), '含已打开项目');

  // 只发窗口焦点（模拟工程在工作区外/监视器漏报的场景）
  writeCbp(cbp, 'app', ['Debug', 'FocusOnly']);
  const beforeFocus = app.records.warningButtons.length;
  app.setWarningButton('重新加载');
  app.mock.emitWindowState(true);
  await sleep(200);
  const focusWarn = app.records.warningButtons[app.records.warningButtons.length - 1];
  c.check('H2 窗口重新获得焦点时检出外部修改并询问',
    app.records.warningButtons.length === beforeFocus + 1 && /已在磁盘上被修改/.test(String(focusWarn && focusWarn.message)),
    app.records.warningButtons.map((w) => w.message), '新增 1 条询问');
  const titles = await targetTitles(app);
  c.check('H3 焦点路径重载后模型更新', JSON.stringify(titles) === JSON.stringify(['Debug', 'FocusOnly']), titles, ['Debug', 'FocusOnly']);

  // 原子保存（tmp+rename）只发 create：已打开工程应按"外部修改"处理
  writeCbp(cbp, 'app', ['Debug', 'FocusOnly', 'Atomic']);
  const beforeCreate = app.records.warningButtons.length;
  app.setWarningButton('忽略');
  app.mock.emitFileEvent('create', cbp);
  await sleep(400);
  const createWarn = app.records.warningButtons[app.records.warningButtons.length - 1];
  c.check('H4 原子保存的 create 事件也按外部修改询问',
    app.records.warningButtons.length === beforeCreate + 1 && /已在磁盘上被修改/.test(String(createWarn && createWarn.message)),
    app.records.warningButtons.map((w) => w.message), '新增 1 条询问');
  c.check('H5 原子保存不被登记为"待打开"（状态栏无待打开入口）',
    !(app.mock.statusBarItems || []).some((i) => /Code::Blocks 项目 \(1\)/.test(String(i.text || ''))),
    (app.mock.statusBarItems || []).map((i) => i.text), '无待打开');

  // 原子保存的 delete 分支：文件仍在 → 按外部修改处理，且不得误报"工程文件已被删除"
  writeCbp(cbp, 'app', ['Debug', 'FocusOnly', 'Atomic', 'DeleteRace']);
  const beforeDelete = app.records.warningButtons.length;
  app.setWarningButton('忽略');
  app.mock.emitFileEvent('delete', cbp);
  await sleep(400);
  const deleteWarn = app.records.warningButtons[app.records.warningButtons.length - 1];
  c.check('H6 原子保存的 delete（文件仍在）按外部修改询问',
    app.records.warningButtons.length === beforeDelete + 1 && /已在磁盘上被修改/.test(String(deleteWarn && deleteWarn.message)),
    app.records.warningButtons.map((w) => w.message), '新增 1 条询问');
  c.check('H7 不误报「工程文件已被删除」', !/工程文件已被删除/.test(outText(app)), outText(app).slice(-200), '无删除日志');

  await app.deactivate().catch(() => undefined);
}

/** 场景 3：checkExternalChanges=off —— 不自动检测，手动命令仍可用 */
async function runOffCase(c) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-extchg-off-'));
  const cbp = path.join(tmp, 'app', 'app.cbp');
  writeCbp(cbp, 'app', ['Debug']);
  const app = await activate({
    tmpDir: tmp,
    findFilesResult: [cbp],
    config: { 'codeblocks.detect.checkExternalChanges': 'off' },
  });
  await sleep(80);
  c.check('G1 工程已打开', /已打开项目/.test(outText(app)), outText(app).slice(-120), '含已打开项目');

  writeCbp(cbp, 'app', ['Debug', 'Release']);
  app.mock.emitFileEvent('change', cbp);
  await sleep(400);
  c.check('G2 off：change 事件不弹窗', app.records.warningButtons.length === 0, app.records.warningButtons.map((w) => w.message), []);

  await app.invoke('codeblocks.reloadProject');
  const titles = await targetTitles(app);
  c.check('G3 off：手动命令仍可重载', JSON.stringify(titles) === JSON.stringify(['Debug', 'Release']), titles, ['Debug', 'Release']);
  await app.deactivate().catch(() => undefined);
}

/** 场景 4：ProjectChangeTracker 纯逻辑（签名基准 / 忽略 / 不可读时保留基准） */
async function runTrackerCase(c) {
  const { ProjectChangeTracker } = require('../dist/project/projectChangeTracker.js');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-extchg-trk-'));
  const f = path.join(tmp, 't.cbp');
  fs.writeFileSync(f, 'A', 'utf-8');
  const t = new ProjectChangeTracker();

  c.check('J1 未跟踪的文件不算变化', t.hasChanged(f) === false, t.hasChanged(f), false);
  t.remember(f);
  c.check('J2 remember 后视为无变化', t.hasChanged(f) === false, t.hasChanged(f), false);
  fs.writeFileSync(f, 'BB', 'utf-8');
  c.check('J3 外部改写后检出变化', t.hasChanged(f) === true, t.hasChanged(f), true);
  t.remember(f);
  c.check('J4 重新 remember 后恢复无变化', t.hasChanged(f) === false, t.hasChanged(f), false);
  t.forget(f);
  c.check('J5 forget 后不再跟踪', t.isTracked(f) === false && t.hasChanged(f) === false, { tracked: t.isTracked(f), changed: t.hasChanged(f) }, { tracked: false, changed: false });

  // 文件不可读（模拟被独占锁）时 remember 必须保留旧基准，否则该文件从此不再被检测
  t.remember(f);
  fs.rmSync(f, { force: true });
  t.remember(f);
  c.check('J6 不可读时 remember 保留旧基准', t.isTracked(f) === true, t.isTracked(f), true);
  fs.writeFileSync(f, 'CCC', 'utf-8');
  c.check('J7 恢复可读且内容变化 → 仍能检出', t.hasChanged(f) === true, t.hasChanged(f), true);

  // 盘符大小写归一（仅 Windows 有意义）
  if (process.platform === 'win32') {
    t.remember(f);
    c.check('J8 盘符大小写不影响基准命中', t.hasChanged(f.toUpperCase()) === false, t.hasChanged(f.toUpperCase()), false);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
}

const CASES = { prompt: runPromptCase, focus: runFocusCase, off: runOffCase, tracker: runTrackerCase };

// ---------- 子进程：执行单个场景 ----------
if (process.argv[2] === '--case') {
  const name = process.argv[3];
  let pass = 0, fail = 0;
  const c = {
    check(label, cond, got, want) {
      if (cond) { pass++; console.log('OK   ' + label); }
      else { fail++; console.log(`FAIL ${label}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
    },
  };
  (async () => {
    try {
      await CASES[name](c);
    } catch (e) {
      fail++;
      console.log('FAIL ' + name + ' 运行异常: ' + (e && e.stack ? e.stack : e));
    }
    console.log(`[case=${name}] ${pass} pass, ${fail} fail`);
    process.exit(fail ? 1 : 0);
  })();
} else {
  // ---------- 父进程：逐场景起子进程并汇总 ----------
  let pass = 0, fail = 0;
  const failed = [];
  for (const name of Object.keys(CASES)) {
    const r = spawnSync(process.execPath, [__filename, '--case', name], { encoding: 'utf8', timeout: 120000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    process.stdout.write(out);
    const m = out.match(/\[case=[^\]]+\]\s*(\d+)\s*pass,\s*(\d+)\s*fail/);
    if (!m) { fail++; failed.push(`${name}:无摘要`); continue; }
    pass += Number(m[1]);
    fail += Number(m[2]);
    if (Number(m[2]) > 0) failed.push(name);
  }
  console.log(`\nexternal-changes: ${pass} pass, ${fail} fail${failed.length ? '  [' + failed.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
}
