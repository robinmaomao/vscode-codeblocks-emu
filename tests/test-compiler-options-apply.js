// 编译选项面板「应用」回归（对应 Project properties 同类配置页面缺陷）：
//  - 勾选后必须真正写回 .cbp（此前只改内存模型，重开工程即丢失）
//  - options_<id>.xml 之外的「自定义选项」（如手写的 -pipe）不得被本面板静默清除
//  - 应用失败（写盘异常）要回发 error 让面板可见，而不是静默吞掉
//  - 应用成功后宿主返回重新解析的工程/目标，面板必须重绑（否则第二次应用基于陈旧对象）
//
// 说明：扩展模块级状态绑定首次 require('vscode') 的 mock，故**每个场景单起一个子进程**（--case <name>）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'tests', 'visual', 'fixtures', 'rich.cbp');
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

/** 场景 1：面板自身的应用逻辑（无需激活扩展） */
async function runPanelCase(c) {
  const { installVscodeMock } = require('./_harness/vscodeMock');
  const mock = installVscodeMock({ config: {} });
  const { ProjectParser } = require('../dist/model/parser');
  const { CompilerOptionsLoader } = require('../dist/compiler/optionsLoader');
  const { CompilerOptionsPanel } = require('../dist/ui/compilerOptionsPanel');

  const parse = () => new ProjectParser().parse(FIXTURE);
  const compiler = new CompilerOptionsLoader(path.join(ROOT, 'resources', 'compilers')).load('gcc');
  const uri = mock.vscode.Uri.file(ROOT);
  const lastWebview = () => mock.webviews[mock.webviews.length - 1].webview;

  // ---- A. 项目级：保留 XML 之外的自定义选项 ----
  const project = parse();
  let received;
  CompilerOptionsPanel.show(compiler, project, undefined, uri, async (opts) => { received = opts; return undefined; });
  let wv = lastWebview();
  wv.__emit({ type: 'apply', options: ['-g', '-Wall'] });
  await sleep(20);
  c.check('P1 自定义选项 -pipe 保留并追加勾选项',
    JSON.stringify(received) === JSON.stringify(['-pipe', '-g', '-Wall']), received, ['-pipe', '-g', '-Wall']);
  c.check('P2 应用成功回发 applied', wv.posted.some((m) => m.type === 'applied'), wv.posted.map((m) => m.type), ['applied']);

  // ---- B. 目标级：只写目标自己的选项 ----
  const targetProject = parse();
  const debug = targetProject.buildTargets[0];
  received = undefined;
  CompilerOptionsPanel.show(compiler, targetProject, debug, uri, async (opts) => { received = opts; return undefined; });
  wv = lastWebview();
  wv.__emit({ type: 'apply', options: ['-O2'] });
  await sleep(20);
  c.check('P3 目标级应用只含勾选项（原 -g/-Wextra 被替换）',
    JSON.stringify(received) === JSON.stringify(['-O2']), received, ['-O2']);
  c.check('P4 目标级影响的是目标而非工程选项',
    JSON.stringify(debug.compilerOptions) === JSON.stringify(['-O2'])
    && !targetProject.compilerOptions.includes('-O2'),
    { target: debug.compilerOptions, project: targetProject.compilerOptions });

  // ---- C. 宿主返回新对象后重绑（连续应用不会基于陈旧工程） ----
  const freshProject = parse();
  freshProject.compilerOptions = ['-DFRESH'];
  const seen = [];
  CompilerOptionsPanel.show(compiler, parse(), undefined, uri, async (opts) => {
    seen.push(opts);
    return { project: freshProject };
  });
  wv = lastWebview();
  wv.__emit({ type: 'apply', options: ['-Wall'] });
  await sleep(20);
  wv.__emit({ type: 'apply', options: ['-O2'] });
  await sleep(20);
  c.check('P5 首次应用基于打开面板时的工程',
    JSON.stringify(seen[0]) === JSON.stringify(['-pipe', '-Wall']), seen[0], ['-pipe', '-Wall']);
  c.check('P5b 应用后重绑到宿主返回的工程（第二次基于 -DFRESH）',
    JSON.stringify(seen[1]) === JSON.stringify(['-DFRESH', '-O2']), seen[1], ['-DFRESH', '-O2']);

  // ---- D. 写盘失败 → 回发 error，且不误报成功 ----
  const failProject = parse();
  CompilerOptionsPanel.show(compiler, failProject, undefined, uri, async () => { throw new Error('disk full'); });
  wv = lastWebview();
  wv.__emit({ type: 'apply', options: ['-g'] });
  await sleep(20);
  c.check('P6 应用失败回发 error（含原因）',
    wv.posted.some((m) => m.type === 'error' && m.message === 'disk full'),
    wv.posted, 'error: disk full');
  c.check('P7 应用失败不回发 applied', !wv.posted.some((m) => m.type === 'applied'), wv.posted.map((m) => m.type), '无 applied');
  c.check('P7b 应用失败不改动内存模型（避免后续序列化写入未落盘的选项）',
    JSON.stringify(failProject.compilerOptions) === JSON.stringify(['-pipe']), failProject.compilerOptions, ['-pipe']);

  // ---- E. 未提供宿主回调（只读/测试构造）时仍更新内存模型 ----
  const soloProject = parse();
  CompilerOptionsPanel.show(compiler, soloProject, undefined, uri);
  wv = lastWebview();
  wv.__emit({ type: 'apply', options: ['-g'] });
  await sleep(20);
  c.check('P8 无宿主回调时更新内存模型且不抛错',
    JSON.stringify(soloProject.compilerOptions) === JSON.stringify(['-pipe', '-g'])
    && wv.posted.some((m) => m.type === 'applied'),
    soloProject.compilerOptions, ['-pipe', '-g']);

  mock.restore();
}

/** 场景 2：命令 → 面板 → 应用 → 真正写回 .cbp */
async function runHostCase(c) {
  const { activate } = require('./_harness/extensionActivation');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-coapply-'));
  const cbp = path.join(tmp, 'app', 'app.cbp');
  writeCbp(cbp);

  const app = await activate({ tmpDir: tmp, findFilesResult: [cbp] });
  await sleep(100);

  await app.invoke('codeblocks.compilerOptions');
  const panel = app.mock.webviews[app.mock.webviews.length - 1];
  c.check('H1 编译选项面板已打开', !!panel && panel.kind === 'codeblocks.compilerOptions', panel && panel.kind);
  const html = panel.webview.html;
  c.check('H2 面板列出目标已有选项（-g 勾选）', /value="-g"[^>]*checked/.test(html), 'html', 'checked -g');

  panel.webview.__emit({ type: 'apply', options: ['-Wall', '-O2'] });
  await sleep(200);
  const written = fs.readFileSync(cbp, 'utf-8');
  const targetOpts = compilerOptionsIn(written, 'Debug');
  c.check('H3 应用后 .cbp 的目标编译选项已更新（不再只有 -g）',
    targetOpts.includes('-Wall') && targetOpts.includes('-O2') && !targetOpts.includes('-g'), targetOpts, ['-Wall', '-O2']);
  c.check('H4 项目级自定义选项 -pipe 未被清掉',
    compilerOptionsIn(written, undefined).includes('-pipe'), compilerOptionsIn(written, undefined), ['-pipe']);
  c.check('H5 应用成功回发 applied 且无 error',
    panel.webview.posted.some((m) => m.type === 'applied') && !panel.webview.posted.some((m) => m.type === 'error'),
    panel.webview.posted.map((m) => m.type), ['applied']);

  // 二次应用（宿主已重载工程）不再丢失上次结果
  panel.webview.__emit({ type: 'apply', options: ['-Wall', '-O2', '-Wextra'] });
  await sleep(250);
  const written2 = fs.readFileSync(cbp, 'utf-8');
  const targetOpts2 = compilerOptionsIn(written2, 'Debug');
  c.check('H6 连续应用不丢上次选项',
    ['-Wall', '-O2', '-Wextra'].every((o) => targetOpts2.includes(o)), targetOpts2, ['-Wall', '-O2', '-Wextra']);

  // 连点「应用」（不等待完成）：按到达顺序串行落盘，两次都要生效
  const appliedBefore = panel.webview.posted.filter((m) => m.type === 'applied').length;
  panel.webview.__emit({ type: 'apply', options: ['-O1'] });
  panel.webview.__emit({ type: 'apply', options: ['-O3'] });
  await sleep(400);
  const appliedAfter = panel.webview.posted.filter((m) => m.type === 'applied').length;
  const targetOpts3 = compilerOptionsIn(fs.readFileSync(cbp, 'utf-8'), 'Debug');
  c.check('H6b 连点应用串行生效（两次都完成，最终为最后一次）',
    appliedAfter - appliedBefore === 2 && targetOpts3.includes('-O3') && !targetOpts3.includes('-O1'),
    { appliedAfter, appliedBefore, targetOpts3 }, { applied: 2, targetOpts3: ['-O3'] });
  c.check('H7 工程未被外部改动判为脏（自写盘已刷新基准）',
    !app.records.warningButtons.some((w) => /已在磁盘上被修改/.test(String(w.message))),
    app.records.warningButtons.map((w) => w.message), '无外部改动询问');

  await app.deactivate();
  fs.rmSync(tmp, { recursive: true, force: true });
}

/** 场景 3：面板打开后目标被外部改名/删除 → 应用必须报错，不得静默改写工程级选项 */
async function runStaleTargetCase(c) {
  const { activate } = require('./_harness/extensionActivation');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-costale-'));
  const cbp = path.join(tmp, 'app', 'app.cbp');
  writeCbp(cbp);

  const app = await activate({ tmpDir: tmp, findFilesResult: [cbp] });
  await sleep(100);
  await app.invoke('codeblocks.compilerOptions');
  const panel = app.mock.webviews[app.mock.webviews.length - 1];
  c.check('X0 面板按 Debug 目标打开', /value="-g"[^>]*checked/.test(panel.webview.html), null);

  // 外部改名目标 + 重载：面板持有的目标已不存在
  writeCbp(cbp, 'DebugRenamed');
  await app.invoke('codeblocks.reloadProject');
  await sleep(100);
  const before = fs.readFileSync(cbp, 'utf-8');

  panel.webview.__emit({ type: 'apply', options: ['-O2'] });
  await sleep(300);
  const after = fs.readFileSync(cbp, 'utf-8');
  const err = panel.webview.posted.find((m) => m.type === 'error');
  c.check('X1 目标已不存在时回发 error（含原因）',
    !!err && /not found|不存在/.test(String(err.message)), err && err.message);
  c.check('X2 失败时不回发 applied',
    !panel.webview.posted.some((m) => m.type === 'applied'), panel.webview.posted.map((m) => m.type));
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
