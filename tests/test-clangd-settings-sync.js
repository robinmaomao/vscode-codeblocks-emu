// clangd 设置同步回归（修复「设置里配了 -Wempty-body 却没写进 clangd 配置」）：
//  - 根因 1：改 codeblocks.clangd.* 后**没有触发**重新生成 —— 只有打开工程/切换活动工程/手动命令才重写
//    config.yaml ⇒ 用户改完设置看文件仍是旧内容（1) 2) 断言设置变更后自动重新生成）
//  - 根因 2：设置被手改成字符串时 `for (const w of value)` 会**按字符**迭代，写入单字符压制项
//    ⇒ `-Wempty-body` 永不出现（3) 4) 字符串拆分/非数组回退 + 输出通道提示；5) 去重/trim）
//  - 生成中的重新生成请求不丢（单飞 + 待重跑；7) 连续变更最终值必达）
//  - 无已打开工程时不生成（8) 只跳过不写；9) 重新打开工程后按新设置生成）
//  - G1：编译器设置（compilerId / masterPath / compilerPrograms）变化 → 状态栏刷新 + 按新编译器重生成编译
//    数据库 + 重启 clangd（10)；编译器变化不提供关闭项，即使关了切换工程重启开关也必须重启）
//  - G3/G4：build.persistLog 变更 → 提示「需重载窗口」并可一键重载（11)；clangd.enabled 由开改关 →
//    提示既有片段仍在生效并可打开配置，无既存片段/值未变化时静默（12)
// 前置：tests/_harness/extensionActivation.js（可激活 mock + emitConfigChange 派发设置变更事件）
// 安全：LOCALAPPDATA / XDG_CONFIG_HOME 指到临时目录，绝不触碰真实用户的 clangd 配置
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-clangd-sync-'));
process.env.LOCALAPPDATA = path.join(tmpRoot, 'LocalAppData');
process.env.XDG_CONFIG_HOME = path.join(tmpRoot, 'config');

const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else {
    fail++;
    console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`);
  }
}

/** 轮询等待条件成立（生成含真实编译器查询，机器慢时留足余量） */
async function waitFor(cond, timeoutMs = 10000, stepMs = 50) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = cond(); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** 写一个最小可解析的 .cbp + 源文件（编译器取默认 gcc） */
function writeCbp(dir, fileName, title) {
  fs.mkdirSync(dir, { recursive: true });
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n'
    + '\t<FileVersion major="1" minor="6" />\n'
    + '\t<Project>\n'
    + `\t\t<Option title="${title}" />\n`
    + '\t\t<Option compiler="gcc" />\n'
    + '\t\t<Build>\n'
    + '\t\t\t<Target title="Debug">\n'
    + '\t\t\t\t<Option type="1" />\n'
    + '\t\t\t\t<Option compiler="gcc" />\n'
    + `\t\t\t\t<Option output="bin/Debug/${title}" />\n`
    + '\t\t\t\t<Option object_output="obj/Debug/" />\n'
    + '\t\t\t</Target>\n'
    + '\t\t</Build>\n'
    + '\t\t<Unit filename="main.c" />\n'
    + '\t</Project>\n'
    + '</CodeBlocks_project_file>\n';
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, xml, 'utf-8');
  fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void) { return 0; }\n', 'utf-8');
  return p;
}

/**
 * 主片段 `Diagnostics.Suppress` 的列表项（限定在 `  Suppress:` 块内：
 * 头文件子片段的 `CompileFlags.Add` 回退 flag 也是 4 空格缩进，不能一起算进来）。
 */
function readItems(text) {
  const m = text.match(/^ {2}Suppress:[ \t]*\r?\n((?: {4}- .*\r?\n?)+)/m);
  if (!m) return [];
  return m[1].split(/\r?\n/).filter(Boolean).map((l) => l.replace(/^ {4}- /, ''));
}
const sameItems = (got, want) => JSON.stringify(got) === JSON.stringify(want);

(async () => {
  // 假 clangd 可执行文件：detectClangd 只做 existsSync 判定（避免依赖本机是否装了 clangd）
  const fakeClangd = path.join(tmpRoot, 'clangd-fake.exe');
  fs.writeFileSync(fakeClangd, 'x', 'utf-8');

  const app = await activate({
    tmpDir: tmpRoot,
    config: {
      'clangd.path': fakeClangd,
      'codeblocks.clangd.enabled': true,
      'codeblocks.clangd.suppressedWarnings': ['-Wunused-function'],
    },
  });
  const { mock } = app;
  // 必须等 mock 装好后再 require（dist/tools/clangd.js 顶层 import 'vscode'）
  const { clangdUserConfigPath } = require('../dist/tools/clangd.js');
  const cfgPath = clangdUserConfigPath();
  const channel = mock.channels.filter((c) => c.name === 'Code::Blocks').pop();
  const readCfg = () => (fs.existsSync(cfgPath) ? fs.readFileSync(cfgPath, 'utf-8') : '');
  const items = () => readItems(readCfg());
  const logHas = (re, from = 0) => !!channel && channel.lines.slice(from).some((l) => re.test(l));
  const TYPE_WARN = /设置 codeblocks\.clangd\.(suppressedWarnings|forcedIncludes|excludeDirs) /;
  check('clangd 配置路径落在临时目录（不触碰真实用户配置）', cfgPath.startsWith(tmpRoot), cfgPath);

  // ---------- 1) 打开工程 → 基线片段（含当前设置值） ----------
  const cbp = writeCbp(path.join(tmpRoot, 'proj'), 'sync.cbp', 'sync');
  await app.invoke('codeblocks.openProject', cbp);
  check('基线：打开工程后 config.yaml 落地且含设置值',
    await waitFor(() => sameItems(items(), ['-Wunused-function'])), items());

  // ---------- 2) 改设置 + 设置变更事件 → 自动重新生成（无需重开工程/手动命令） ----------
  app.setConfig('codeblocks.clangd.suppressedWarnings', ['-Wunused-function', 'redefinition_different_typedef', '-Wempty-body']);
  mock.emitConfigChange('codeblocks.clangd.suppressedWarnings');
  check('设置变更后自动重新生成：新压制项写入 config.yaml（-Wempty-body）',
    await waitFor(() => sameItems(items(), ['-Wunused-function', 'redefinition_different_typedef', '-Wempty-body'])), items());
  check('设置变更：输出通道留痕（可排查「改了没生效」）',
    logHas(/codeblocks\.clangd 设置已变更/), channel && channel.lines.slice(-6));
  check('合法数组值：不产生取值类型告警', !logHas(TYPE_WARN), channel && channel.lines.filter((l) => TYPE_WARN.test(l)));

  // ---------- 2b) 只影响展示的键（buildLogDiagnostics）不触发整库重建 ----------
  const beforeDisplayOnly = channel ? channel.lines.length : 0;
  app.setConfig('codeblocks.clangd.buildLogDiagnostics', 'clangd');
  mock.emitConfigChange('codeblocks.clangd.buildLogDiagnostics');
  await new Promise((r) => setTimeout(r, 400));
  check('展示类设置（buildLogDiagnostics）不触发 clangd 配置重建',
    !logHas(/codeblocks\.clangd 设置已变更/, beforeDisplayOnly),
    channel && channel.lines.slice(beforeDisplayOnly));

  // ---------- 2c) clangd 扩展安装/卸载 → 重新探测并重建（扩展内下载不写 clangd.path） ----------
  const beforeExtChange = channel ? channel.lines.length : 0;
  mock.setInstalledExtension('llvm-vs-code-extensions.vscode-clangd', { id: 'llvm-vs-code-extensions.vscode-clangd', isActive: true });
  mock.emitExtensionsChange();
  check('clangd 扩展安装/启用 → 重新探测并重建',
    await waitFor(() => logHas(/clangd 扩展已安装\/已启用/, beforeExtChange)),
    channel && channel.lines.slice(beforeExtChange));
  mock.setInstalledExtension('llvm-vs-code-extensions.vscode-clangd', null);
  mock.emitExtensionsChange();
  check('clangd 扩展卸载/禁用 → 重新探测',
    await waitFor(() => logHas(/clangd 扩展已卸载\/已禁用/, beforeExtChange)),
    channel && channel.lines.slice(beforeExtChange));

  // ---------- 3) 值写成字符串（手改 settings.json 常见）→ 按分隔符拆分写入 ----------
  app.setConfig('codeblocks.clangd.suppressedWarnings', ' -Wunused-function , -Wempty-body ');
  mock.emitConfigChange('codeblocks.clangd.suppressedWarnings');
  check('字符串值：按逗号/分号/空白拆分后写入（-Wempty-body 不丢）',
    await waitFor(() => sameItems(items(), ['-Wunused-function', '-Wempty-body'])), items());
  check('字符串值：输出通道提示取值类型问题',
    await waitFor(() => logHas(/codeblocks\.clangd\.suppressedWarnings .*字符串/)), channel && channel.lines.slice(-4));
  check('字符串值：不产生单字符压制项（无按字符迭代痕迹）',
    !/^ {4}- .$/m.test(readCfg()), readCfg().match(/^ {4}- .$/gm));

  // ---------- 4) 值写成非数组（数字）→ 回退设置默认值 + 提示 ----------
  app.setConfig('codeblocks.clangd.suppressedWarnings', 42);
  mock.emitConfigChange('codeblocks.clangd.suppressedWarnings');
  check('非数组值：回退默认压制项',
    await waitFor(() => sameItems(items(), ['-Wunused-function', 'redefinition_different_typedef'])), items());
  check('非数组值：输出通道提示回退默认',
    await waitFor(() => logHas(/codeblocks\.clangd\.suppressedWarnings .*回退默认值/)), channel && channel.lines.slice(-4));

  // ---------- 5) 去重 / trim / 去空（保持原顺序） ----------
  app.setConfig('codeblocks.clangd.suppressedWarnings', [' -Wempty-body ', '  ', '-Wempty-body', ' -Wunused-function ']);
  mock.emitConfigChange('codeblocks.clangd.suppressedWarnings');
  check('去重/trim：同一项只写一次、空白项被丢弃（顺序保持）',
    await waitFor(() => sameItems(items(), ['-Wempty-body', '-Wunused-function'])), items());

  // ---------- 6) 改回完整数组值：三项全部写入（且不再有类型告警） ----------
  const warnBefore = channel ? channel.lines.filter((l) => TYPE_WARN.test(l)).length : 0;
  app.setConfig('codeblocks.clangd.suppressedWarnings', ['-Wunused-function', 'redefinition_different_typedef', '-Wempty-body']);
  mock.emitConfigChange('codeblocks.clangd.suppressedWarnings');
  check('改回数组值：三项全部写入',
    await waitFor(() => sameItems(items(), ['-Wunused-function', 'redefinition_different_typedef', '-Wempty-body'])), items());
  check('改回数组值：不新增取值类型告警',
    (channel ? channel.lines.filter((l) => TYPE_WARN.test(l)).length : 0) === warnBefore, null);

  // ---------- 7) 连续变更：去抖合并 + 生成中到达的请求不丢（最终状态 = 最后一个值） ----------
  for (let i = 0; i < 8; i++) {
    app.setConfig('codeblocks.clangd.suppressedWarnings', ['-Wunused-function', `-Wtest-only-${i}`]);
    mock.emitConfigChange('codeblocks.clangd.suppressedWarnings');
    await new Promise((r) => setTimeout(r, 60));
  }
  check('连续变更：最终写入最后一个值',
    await waitFor(() => sameItems(items(), ['-Wunused-function', '-Wtest-only-7'])), items());
  check('连续变更：无历史值残留',
    !/- -Wtest-only-[0-6]\b/.test(readCfg()), readCfg().match(/- -Wtest-only-\d/g));

  // ---------- 8) 无已打开工程：设置变更只跳过、不写配置（无作用域可写） ----------
  const linesBefore = channel ? channel.lines.length : 0;
  const cfgBefore = readCfg();
  app.setWarningButton('Remove');
  await app.invoke('codeblocks.removeProject');
  app.setConfig('codeblocks.clangd.suppressedWarnings', ['-Wunused-function', '-Wempty-body', '-Wshould-not-be-written']);
  mock.emitConfigChange('codeblocks.clangd.suppressedWarnings');
  await new Promise((r) => setTimeout(r, 1500));
  check('无工程：不写入配置（作用域未知）', readCfg() === cfgBefore, null);
  check('无工程：不产生「设置已变更」生成日志', !logHas(/codeblocks\.clangd 设置已变更/, linesBefore), null);

  // ---------- 9) 重新打开工程：按当前设置生成（无工程期间的改动不失联） ----------
  await app.invoke('codeblocks.openProject', cbp);
  check('重开工程：按当前设置写入新值',
    await waitFor(() => items().includes('-Wshould-not-be-written')), items());

  // ---------- 10) G1：编译器设置变化 → 状态栏刷新 + 按新编译器重生成 DB + 重启 clangd ----------
  /** 编译数据库路径（globalStorage/clangd/<作用域哈希>/compile_commands.json；单工程 ⇒ 唯一） */
  const dbPath = () => {
    const root = path.join(app.ctx.globalStorageUri.fsPath, 'clangd');
    if (!fs.existsSync(root)) return '';
    for (const d of fs.readdirSync(root)) {
      const p = path.join(root, d, 'compile_commands.json');
      if (fs.existsSync(p)) return p;
    }
    return '';
  };
  const readDb = () => (dbPath() ? fs.readFileSync(dbPath(), 'utf-8') : '');
  // 已打开源文件（重启只为刷新已打开文件 ⇒ hasOpenSourceFile 依赖 visibleTextEditors）
  app.setActiveEditor(path.join(tmpRoot, 'proj', 'main.c'), 'int main(void) { return 0; }\n', 'c');
  // 反证：把「切换活动工程」的重启开关关掉，编译器设置变化仍必须重启（不重启等于设置没生效）
  app.setConfig('codeblocks.clangd.restartOnActiveProjectSwitch', false);
  const compilerBar = mock.statusBarItems.filter((i) => /Compiler:/.test(i.text || '')).pop();
  let statusRefreshes = 0;
  if (compilerBar) {
    const origShow = compilerBar.show.bind(compilerBar);
    compilerBar.show = () => { statusRefreshes++; origShow(); };
  }
  const linesBefore10 = channel ? channel.lines.length : 0;
  const fakeCC = path.join(tmpRoot, 'fake-g1-toolchain', 'bin', 'gcc.exe');
  app.setConfig('codeblocks.compilerPrograms', { gcc: { C: fakeCC, CPP: fakeCC } });
  mock.emitConfigChange('codeblocks.compilerPrograms');
  check('G1 编译器设置变更：输出通道留痕（可排查「改了没生效」）',
    await waitFor(() => logHas(/编译器设置已变更，按新编译器重新生成 clangd 编译数据库/, linesBefore10)),
    channel && channel.lines.slice(linesBefore10));
  check('G1 状态栏 Compiler: 同步刷新（原先只在工程事件/探测命令里更新）',
    await waitFor(() => statusRefreshes > 0 && !!compilerBar && /^\$\(tools\) Compiler: /.test(compilerBar.text)),
    compilerBar && compilerBar.text);
  check('G1 编译数据库按新编译器程序路径重生成',
    await waitFor(() => readDb().includes('fake-g1-toolchain')), dbPath() || '(未找到 compile_commands.json)');
  check('G1 DB 实际变化后重启 clangd（不受 restartOnActiveProjectSwitch=false 限制）',
    await waitFor(() => app.records.executeCommand.some((c) => c.id === 'clangd.restart')),
    app.records.executeCommand.map((c) => c.id));
  check('G1 输出通道留痕「重启 clangd」原因',
    logHas(/编译器设置已变更，重启 clangd 以刷新已打开文件/, linesBefore10), null);

  // ---------- 11) G3：build.persistLog 变更 → 弹窗提醒需重载窗口（一键重载） ----------
  const warnBase3 = app.records.warningButtons.length;
  app.setConfig('codeblocks.build.persistLog', true);
  app.setWarningButton('重载窗口');
  app.records.executeCommand.length = 0;
  mock.emitConfigChange('codeblocks.build.persistLog');
  check('G3 persistLog 变更：提醒需重载窗口',
    await waitFor(() => app.records.warningButtons.length > warnBase3
      && /codeblocks\.build\.persistLog .*需重载窗口后生效/.test(app.records.warningButtons[app.records.warningButtons.length - 1].message)),
    app.records.warningButtons.slice(warnBase3));
  check('G3 弹窗按钮为「重载窗口 / 稍后」',
    sameItems(app.records.warningButtons[app.records.warningButtons.length - 1].buttons, ['重载窗口', '稍后']),
    app.records.warningButtons[app.records.warningButtons.length - 1].buttons);
  check('G3 选「重载窗口」→ 执行 workbench.action.reloadWindow',
    await waitFor(() => app.records.executeCommand.some((c) => c.id === 'workbench.action.reloadWindow')),
    app.records.executeCommand.map((c) => c.id));

  // ---------- 12) G4：clangd.enabled 由开改关 → 提醒既有片段仍在生效（可打开配置） ----------
  const warnBase4 = app.records.warningButtons.length;
  app.records.shownDocuments.length = 0;
  app.setConfig('codeblocks.clangd.enabled', false);
  app.setWarningButton('打开 clangd 配置');
  mock.emitConfigChange('codeblocks.clangd.enabled');
  check('G4 关闭 clangd 集成：提醒既有扩展片段仍会被读取',
    await waitFor(() => app.records.warningButtons.length > warnBase4
      && /仍有 \d+ 个扩展片段会被继续读取/.test(app.records.warningButtons[app.records.warningButtons.length - 1].message)),
    app.records.warningButtons.slice(warnBase4));
  check('G4 弹窗按钮为「打开 clangd 配置 / 稍后」',
    sameItems(app.records.warningButtons[app.records.warningButtons.length - 1].buttons, ['打开 clangd 配置', '稍后']),
    app.records.warningButtons[app.records.warningButtons.length - 1].buttons);
  check('G4 选「打开 clangd 配置」→ 打开用户级 config.yaml',
    await waitFor(() => app.records.shownDocuments.includes(cfgPath)), app.records.shownDocuments);
  // 值未变化（其它来源的事件再次派发）→ 不重复弹窗
  const warnBase4b = app.records.warningButtons.length;
  mock.emitConfigChange('codeblocks.clangd.enabled');
  await new Promise((r) => setTimeout(r, 300));
  check('G4 值未变化时不重复弹窗', app.records.warningButtons.length === warnBase4b, null);
  // 从未写过片段（无工程可生成 + 配置目录为空）→ 静默，不打扰用户
  app.setWarningButton('Remove');
  await app.invoke('codeblocks.removeProject');
  const savedEnv = { LOCALAPPDATA: process.env.LOCALAPPDATA, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.LOCALAPPDATA = path.join(tmpRoot, 'empty-appdata');
  process.env.XDG_CONFIG_HOME = path.join(tmpRoot, 'empty-config');
  app.setConfig('codeblocks.clangd.enabled', true);
  mock.emitConfigChange('codeblocks.clangd.enabled'); // 无工程 ⇒ 不生成（「关 → 开」也无提醒）
  const warnBase4c = app.records.warningButtons.length;
  app.setConfig('codeblocks.clangd.enabled', false);
  mock.emitConfigChange('codeblocks.clangd.enabled'); // 「开 → 关」但无片段 ⇒ 静默
  await new Promise((r) => setTimeout(r, 400));
  check('G4 无既存片段时静默（从未写过配置 ⇒ 无遗留可提醒）',
    app.records.warningButtons.length === warnBase4c, app.records.warningButtons.slice(warnBase4c));
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }

  await app.deactivate();
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* 文件句柄占用时忽略 */ }
  console.log(`\nclangd 设置同步: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('clangd 设置同步：异常退出\n' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
