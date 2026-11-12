// Build options 面板「保存」回归（移植 Code::Blocks CompilerOptionsDlg 后的新协议）：
//  - 面板只负责收集数据并经 `save` 报文交给宿主，宿主写回 .cbp（此前只改内存模型，重开工程即丢失）
//  - 手写的「其他编译器选项」（如 -pipe）必须原样保留，不得被勾选项覆盖
//  - 保存失败（写盘异常）要回发 error 让面板可见，而不是静默吞掉
//  - 连点保存按到达顺序串行落盘，最后一次生效且不丢前面已保存的选项
//  - 工程从磁盘重载后面板必须关闭（旧快照不得覆盖新工程）
//
// 说明：扩展模块级状态绑定首次 require('vscode') 的 mock，故**每个场景单起一个子进程**（--case <name>）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 最小 .cbp：项目级 <Compiler> 含自定义 -pipe，目标（默认 Debug）含 -g */
function writeCbp(file, targetTitle = 'Debug') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
    '<CodeBlocks_project_file>',
    '\t<FileVersion major="1" minor="6" />',
    '\t<Project>',
    '\t\t<Option title="app" />',
    '\t\t<Option compiler="gcc" />',
    '\t\t<Build>',
    `\t\t\t<Target title="${targetTitle}">`,
    '\t\t\t\t<Option type="1" />',
    '\t\t\t\t<Option compiler="gcc" />',
    '\t\t\t\t<Option output="bin/Debug/app" />',
    '\t\t\t\t<Compiler>',
    '\t\t\t\t\t<Add option="-g" />',
    '\t\t\t\t</Compiler>',
    '\t\t\t</Target>',
    '\t\t</Build>',
    '\t\t<Compiler>',
    '\t\t\t<Add option="-pipe" />',
    '\t\t</Compiler>',
    '\t\t<Unit filename="main.c" />',
    '\t</Project>',
    '</CodeBlocks_project_file>',
    '',
  ].join('\n'), 'utf-8');
}

/** 某个 <title> 目标内 <Compiler> 的选项列表（targetTitle 省略 = 项目级 <Compiler>，位于 <Build> 之后） */
function compilerOptionsIn(xml, targetTitle) {
  const start = targetTitle === undefined
    ? xml.search(/\n\t\t<Compiler>/)
    : xml.indexOf(`<Target title="${targetTitle}">`);
  if (start < 0) return [];
  const body = xml.slice(start).match(/<Compiler>([\s\S]*?)<\/Compiler>/);
  if (!body) return [];
  return [...body[1].matchAll(/<Add option="([^"]*)" \/>/g)].map((m) => m[1]);
}

/** 面板快照（BuildOptionsData）最小构造 */
function scope(title, compilerOptions = []) {
  return {
    title,
    compilerId: 'gcc',
    compilerOptions,
    resourceCompilerOptions: [],
    linkerOptions: [],
    linkLibs: [],
    linkerExecutable: 0,
    relations: { compiler: 0, linker: 0, include: 0, lib: 0, res: 0 },
    includeDirs: [],
    libDirs: [],
    resourceDirs: [],
    commandsBefore: [],
    commandsAfter: [],
    alwaysPost: false,
    envVars: [],
    makeCommands: {},
  };
}

function makeData() {
  return {
    projectTitle: 'app',
    makefileIsCustom: false,
    defineSwitch: '',
    project: scope('app', ['-pipe']),
    targets: [scope('Debug', ['-g'])],
    compilers: [{ id: 'gcc', name: 'GNU GCC Compiler' }],
    compilerCatalogs: {},
    compilerBaseCatalogs: {},
    compilerFlags: {},
  };
}

/** 从面板 HTML 里取回内联脚本的 BOOT.data（与真实面板保存时提交的快照一致） */
function bootData(html) {
  const m = html.match(/var BOOT = ([\s\S]*?);\r?\n\s*var DATA = BOOT\.data;/);
  if (!m) throw new Error('面板 HTML 里找不到 BOOT');
  return JSON.parse(m[1]).data;
}

/** 场景 1：面板自身的保存协议（无需激活扩展） */
async function runPanelCase(c) {
  const { installVscodeMock } = require('./_harness/vscodeMock');
  const mock = installVscodeMock({ config: {} });
  const { BuildOptionsPanel } = require('../dist/ui/buildOptionsPanel');

  const uri = mock.vscode.Uri.file(ROOT);
  const lastWebview = () => mock.webviews[mock.webviews.length - 1].webview;

  // ---- 保存成功：数据原样交给宿主，回发 saved ----
  const data = makeData();
  let received;
  BuildOptionsPanel.show('app', path.join(ROOT, 'app.cbp'), data, uri, async (d) => { received = d; });
  let wv = lastWebview();
  wv.__emit({ type: 'save', data });
  await sleep(20);
  c.check('P1 保存把快照交给宿主（-pipe 与 -g 均在）',
    !!received
    && JSON.stringify(received.project.compilerOptions) === JSON.stringify(['-pipe'])
    && JSON.stringify(received.targets[0].compilerOptions) === JSON.stringify(['-g']),
    received && { project: received.project.compilerOptions, target: received.targets[0].compilerOptions },
    { project: ['-pipe'], target: ['-g'] });
  c.check('P2 保存成功回发 saved', wv.posted.some((m) => m.type === 'saved'), wv.posted.map((m) => m.type), ['saved']);

  // ---- 保存失败 → 回发 error（含原因），且不误报成功 ----
  BuildOptionsPanel.show('app', path.join(ROOT, 'app.cbp'), makeData(), uri, async () => { throw new Error('disk full'); });
  wv = lastWebview();
  wv.__emit({ type: 'save', data: makeData() });
  await sleep(20);
  c.check('P3 保存失败回发 error（含原因）',
    wv.posted.some((m) => m.type === 'error' && m.message === 'disk full'),
    wv.posted, 'error: disk full');
  c.check('P4 保存失败不回发 saved', !wv.posted.some((m) => m.type === 'saved'), wv.posted.map((m) => m.type), '无 saved');

  // ---- 连点保存：串行、按序、不丢 ----
  const order = [];
  BuildOptionsPanel.show('app', path.join(ROOT, 'app.cbp'), makeData(), uri, async (d) => {
    order.push(d.targets[0].compilerOptions.join(','));
    await sleep(30);
  });
  wv = lastWebview();
  const first = makeData();
  first.targets[0].compilerOptions = ['-O1'];
  const second = makeData();
  second.targets[0].compilerOptions = ['-O3'];
  wv.__emit({ type: 'save', data: first });
  wv.__emit({ type: 'save', data: second });
  await sleep(200);
  c.check('P5 连点保存按到达顺序串行执行',
    JSON.stringify(order) === JSON.stringify(['-O1', '-O3']), order, ['-O1', '-O3']);
  c.check('P5b 两次保存都回发 saved',
    wv.posted.filter((m) => m.type === 'saved').length === 2,
    wv.posted.map((m) => m.type), ['saved', 'saved']);

  // ---- 保存并关闭：成功后释放面板 ----
  BuildOptionsPanel.show('app', path.join(ROOT, 'app.cbp'), makeData(), uri, async () => undefined);
  const closing = mock.webviews[mock.webviews.length - 1];
  closing.webview.__emit({ type: 'save', data: makeData(), close: true });
  await sleep(20);
  c.check('P6 保存并关闭后释放面板', closing.__disposed === true
    && closing.webview.posted.some((m) => m.type === 'saved'), closing.__disposed);

  // ---- 空报文不得触发宿主回调 ----
  let called = 0;
  BuildOptionsPanel.show('app', path.join(ROOT, 'app.cbp'), makeData(), uri, async () => { called++; });
  wv = lastWebview();
  wv.__emit({ type: 'save' });
  wv.__emit({ type: 'save', data: { project: {} } });
  await sleep(20);
  c.check('P7 缺少 project/targets 的保存报文被忽略', called === 0 && wv.posted.length === 0, { called, posted: wv.posted.length });

  mock.restore();
}

/** 场景 2：命令 → 面板 → 保存 → 真正写回 .cbp */
async function runHostCase(c) {
  const { activate } = require('./_harness/extensionActivation');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-boapply-'));
  const cbp = path.join(tmp, 'app', 'app.cbp');
  writeCbp(cbp);

  const app = await activate({ tmpDir: tmp, findFilesResult: [cbp] });
  await sleep(100);

  await app.invoke('codeblocks.compilerOptions');
  const panel = app.mock.webviews[app.mock.webviews.length - 1];
  c.check('H1 Build options 面板已打开', !!panel && panel.kind === 'codeblocks.buildOptions', panel && panel.kind);

  const data = bootData(panel.webview.html);
  c.check('H2 面板快照带上目标已有选项 -g', data.targets.length === 1 && data.targets[0].compilerOptions.includes('-g'),
    data.targets.map((t) => t.compilerOptions));
  c.check('H3 面板快照带上项目级自定义选项 -pipe', data.project.compilerOptions.includes('-pipe'), data.project.compilerOptions);

  data.targets[0].compilerOptions = ['-Wall', '-O2'];
  panel.webview.__emit({ type: 'save', data });
  await sleep(250);
  const written = fs.readFileSync(cbp, 'utf-8');
  const targetOpts = compilerOptionsIn(written, 'Debug');
  c.check('H4 保存后 .cbp 的目标编译选项已更新（不再只有 -g）',
    targetOpts.includes('-Wall') && targetOpts.includes('-O2') && !targetOpts.includes('-g'), targetOpts, ['-Wall', '-O2']);
  c.check('H5 项目级自定义选项 -pipe 未被清掉',
    compilerOptionsIn(written, undefined).includes('-pipe'), compilerOptionsIn(written, undefined), ['-pipe']);
  c.check('H6 保存成功回发 saved 且无 error',
    panel.webview.posted.some((m) => m.type === 'saved') && !panel.webview.posted.some((m) => m.type === 'error'),
    panel.webview.posted.map((m) => m.type), ['saved']);

  // 二次保存（宿主已重载工程）不丢上次结果
  data.targets[0].compilerOptions = ['-Wall', '-O2', '-Wextra'];
  panel.webview.__emit({ type: 'save', data });
  await sleep(250);
  const targetOpts2 = compilerOptionsIn(fs.readFileSync(cbp, 'utf-8'), 'Debug');
  c.check('H7 连续保存不丢上次选项',
    ['-Wall', '-O2', '-Wextra'].every((o) => targetOpts2.includes(o)), targetOpts2, ['-Wall', '-O2', '-Wextra']);

  // 连点「保存」（不等待完成）：按到达顺序串行落盘，两次都要生效
  const savedBefore = panel.webview.posted.filter((m) => m.type === 'saved').length;
  const jump1 = JSON.parse(JSON.stringify(data));
  jump1.targets[0].compilerOptions = ['-O1'];
  const jump2 = JSON.parse(JSON.stringify(data));
  jump2.targets[0].compilerOptions = ['-O3'];
  panel.webview.__emit({ type: 'save', data: jump1 });
  panel.webview.__emit({ type: 'save', data: jump2 });
  await sleep(500);
  const savedAfter = panel.webview.posted.filter((m) => m.type === 'saved').length;
  const targetOpts3 = compilerOptionsIn(fs.readFileSync(cbp, 'utf-8'), 'Debug');
  c.check('H8 连点保存串行生效（两次都完成，最终为最后一次）',
    savedAfter - savedBefore === 2 && targetOpts3.includes('-O3') && !targetOpts3.includes('-O1'),
    { savedAfter, savedBefore, targetOpts3 }, { saved: 2, targetOpts3: ['-O3'] });
  c.check('H9 自写盘不触发「已在磁盘上被修改」询问',
    !app.records.warningButtons.some((w) => /已在磁盘上被修改/.test(String(w.message))),
    app.records.warningButtons.map((w) => w.message), '无外部改动询问');

  await app.deactivate();
  fs.rmSync(tmp, { recursive: true, force: true });
}

/** 场景 3：面板打开后目标被外部改名/删除 → 重载必须关闭面板，不能让旧快照覆盖工程 */
async function runStaleTargetCase(c) {
  const { activate } = require('./_harness/extensionActivation');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-bostale-'));
  const cbp = path.join(tmp, 'app', 'app.cbp');
  writeCbp(cbp);

  const app = await activate({ tmpDir: tmp, findFilesResult: [cbp] });
  await sleep(100);
  await app.invoke('codeblocks.compilerOptions');
  const panel = app.mock.webviews[app.mock.webviews.length - 1];
  const data = bootData(panel.webview.html);
  c.check('X0 面板按 Debug 目标打开', data.targets.length === 1 && data.targets[0].title === 'Debug', data.targets.map((t) => t.title));

  // 外部改名目标 + 重载：面板持有的快照已过期
  writeCbp(cbp, 'DebugRenamed');
  await app.invoke('codeblocks.reloadProject');
  await sleep(150);
  const before = fs.readFileSync(cbp, 'utf-8');

  c.check('X1 重载后关闭 Build options 面板（避免旧快照写回）', panel.__disposed === true, panel.__disposed);

  data.targets[0].compilerOptions = ['-O2'];
  panel.webview.__emit({ type: 'save', data });
  await sleep(250);
  const after = fs.readFileSync(cbp, 'utf-8');
  // mock 的 onDidReceiveMessage 不随 Disposable 解绑，故旧快照仍会被投递一次：
  // 此处顺带验证宿主的严格目标校验——过期目标必须被拒绝，绝不能按索引写歪。
  c.check('X2 旧快照保存被拒绝（error 含 not found，不回发 saved）',
    panel.webview.posted.some((m) => m.type === 'error' && /not found|不存在/i.test(String(m.message)))
    && !panel.webview.posted.some((m) => m.type === 'saved'),
    panel.webview.posted, 'error: Target not found');
  c.check('X3 未把目标选项误写进工程级（无 -O2）',
    !compilerOptionsIn(after, undefined).includes('-O2'), compilerOptionsIn(after, undefined), ['-pipe']);
  c.check('X4 .cbp 保持外部版本不被改写', after === before, after === before ? 'equal' : 'changed');

  await app.deactivate();
  fs.rmSync(tmp, { recursive: true, force: true });
}

const CASES = { panel: runPanelCase, host: runHostCase, stale: runStaleTargetCase };

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
  console.log(`\ncompiler-options-apply: ${pass} pass, ${fail} fail${failed.length ? '  [' + failed.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
}
