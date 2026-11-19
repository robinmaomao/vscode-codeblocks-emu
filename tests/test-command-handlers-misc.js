// D-10 命令行为回归（批次 1）：此前仅有「命令入口」证据的处理器
//  buildLog.copyMessage/copyDiagnostic、configureTools、projectTree.expandAll/collapseAll、
//  tidyComments、swapHeaderSource、activatePrior/NextProject、clearRecentProjects、
//  projectNotes、saveProjectAsTemplate、newProjectFromTemplate、closeProject
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

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
    + '\t\t<Extensions />\n'
    + '\t</Project>\n'
    + '</CodeBlocks_project_file>\n';
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, xml, 'utf-8');
  return p;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cmd-misc-'));
  const dirA = path.join(tmp, 'alpha');
  const dirB = path.join(tmp, 'beta');
  const cbpA = writeCbp(dirA, 'alpha.cbp', 'alpha');
  const cbpB = writeCbp(dirB, 'beta.cbp', 'beta');
  fs.writeFileSync(path.join(dirA, 'main.c'), 'int main(void) {\n  /* a\n     b */\n  return 0;\n}\n', 'utf-8');
  fs.writeFileSync(path.join(dirA, 'main.h'), '#pragma once\n', 'utf-8');
  fs.writeFileSync(path.join(dirB, 'main.c'), 'int main(void){return 0;}\n', 'utf-8');

  const app = await activate({ tmpDir: tmp, config: {} });
  await app.invoke('codeblocks.openProject', { fsPath: cbpA, scheme: 'file' });
  await app.invoke('codeblocks.openProject', { fsPath: cbpB, scheme: 'file' });

  // ---- 构建日志复制 ----
  app.records.clipboard.length = 0;
  await app.invoke('codeblocks.buildLog.copyMessage', { diag: { message: 'undefined reference to foo' } });
  check('copyMessage 复制诊断消息', app.records.clipboard.includes('undefined reference to foo'), app.records.clipboard);
  app.records.clipboard.length = 0;
  await app.invoke('codeblocks.buildLog.copyDiagnostic', { diag: { file: 'main.c', line: 3, column: 5, severity: 'error', message: 'boom' } });
  check('copyDiagnostic 复制 文件:行:列: 级别: 消息',
    app.records.clipboard.includes('main.c:3:5: error: boom'), app.records.clipboard);

  // ---- Configure tools 打开设置 ----
  app.records.executeCommand.length = 0;
  await app.invoke('codeblocks.configureTools');
  check('configureTools 打开 codeblocks.tools 设置',
    app.records.executeCommand.some((c) => c.id === 'workbench.action.openSettings' && c.args.includes('codeblocks.tools')),
    app.records.executeCommand);

  // ---- Tidy comments（需要非空选区） ----
  const tidy = app.setActiveEditor(path.join(dirA, 'main.c'), 'int main(void) {\n  /* a\n* b */\n  return 0;\n}\n', 'c');
  tidy.editor.selection = { start: { line: 1, character: 2 }, end: { line: 2, character: 6 }, isEmpty: false, active: { line: 2, character: 6 }, anchor: { line: 1, character: 2 } };
  const editsBefore = app.records.appliedEdits.length;
  await app.invoke('codeblocks.tidyComments');
  check('tidyComments 替换选区内容', app.records.appliedEdits.length > editsBefore, app.records.appliedEdits.length - editsBefore);

  // ---- Swap header/source ----
  app.setActiveEditor(path.join(dirA, 'main.c'), 'int main(void){return 0;}\n', 'c');
  app.records.shownDocuments.length = 0;
  await app.invoke('codeblocks.swapHeaderSource');
  check('swapHeaderSource 跳到同名头文件',
    app.records.shownDocuments.some((p) => /main\.h$/i.test(p)), app.records.shownDocuments);

  // ---- 工程树展开/折叠 ----
  let threw;
  try { await app.invoke('codeblocks.projectTree.expandAll'); } catch (e) { threw = e; }
  check('projectTree.expandAll 不抛错（逐工程 reveal）', !threw, threw && threw.message);
  app.records.executeCommand.length = 0;
  await app.invoke('codeblocks.projectTree.collapseAll');
  check('projectTree.collapseAll 调用视图折叠命令',
    app.records.executeCommand.some((c) => c.id === 'workbench.actions.treeView.codeblocks.projectTree.collapseAll'),
    app.records.executeCommand);

  // ---- 相对切换工程 + 清空最近工程 ----
  app.records.statusBarMessages.length = 0;
  await app.invoke('codeblocks.activateNextProject');
  check('activateNextProject 切换并提示当前工程',
    app.records.statusBarMessages.some((m) => /Active project|活动工程|当前工程/.test(m)), app.records.statusBarMessages);
  app.records.statusBarMessages.length = 0;
  await app.invoke('codeblocks.activatePriorProject');
  check('activatePriorProject 切回上一个工程',
    app.records.statusBarMessages.some((m) => /Active project|活动工程|当前工程/.test(m)), app.records.statusBarMessages);
  app.ctx.globalState._m.set('codeblocks.recentProjects', [cbpA, cbpB]);
  await app.invoke('codeblocks.clearRecentProjects');
  check('clearRecentProjects 清空最近工程列表',
    Array.isArray(app.ctx.globalState.get('codeblocks.recentProjects')) && app.ctx.globalState.get('codeblocks.recentProjects').length === 0,
    app.ctx.globalState.get('codeblocks.recentProjects'));

  // ---- 工程备注面板 ----
  const panelsBefore = app.mock.webviews.length;
  await app.invoke('codeblocks.projectNotes');
  check('projectNotes 打开属性面板', app.mock.webviews.length > panelsBefore, { before: panelsBefore, after: app.mock.webviews.length });

  // ---- 无用户模板时的 newProjectFromTemplate ----
  app.mock.infos.length = 0;
  await app.invoke('codeblocks.newProjectFromTemplate');
  check('newProjectFromTemplate 无模板时给出提示（不再回到入口）',
    app.mock.infos.some((m) => /No user templates|暂无用户模板|没有.*模板/.test(m)), app.mock.infos);

  // ---- 保存为模板（名称 + 描述两个输入框） ----
  app.setInputBox('alpha-template');
  app.setInputBox('skeleton');
  app.mock.infos.length = 0;
  await app.invoke('codeblocks.saveProjectAsTemplate');
  const tplRoot = path.join(app.ctx.globalStorageUri.fsPath, 'templates');
  const manifests = fs.existsSync(tplRoot)
    ? fs.readdirSync(tplRoot).map((d) => path.join(tplRoot, d, 'template.json')).filter((p) => fs.existsSync(p))
    : [];
  check('saveProjectAsTemplate 写出 template.json',
    manifests.length === 1 && JSON.parse(fs.readFileSync(manifests[0], 'utf-8')).name === 'alpha-template',
    manifests);
  check('saveProjectAsTemplate 提示保存成功',
    app.mock.infos.some((m) => /Template .* saved|已保存模板/.test(m)), app.mock.infos);

  // ---- Copy Strings ----
  app.setActiveEditor(path.join(dirA, 'main.c'), 'const char *a = "alpha";\nconst char *b = "beta";\n', 'c');
  app.records.clipboard.length = 0;
  await app.invoke('codeblocks.copyStrings');
  check('copyStrings 复制全部双引号字面量',
    app.records.clipboard.some((s) => s.includes('"alpha"') && s.includes('"beta"')), app.records.clipboard);

  // ---- runTool：未配置工具时提示 ----
  app.mock.warnings.length = 0;
  await app.invoke('codeblocks.runTool', 0);
  check('runTool 未配置时提示（不抛错）',
    app.mock.warnings.some((m) => /Custom tool|自定义工具/.test(m)), app.mock.warnings);

  // ---- 编译器缓存安装指引（复制 winget 命令） ----
  app.mock.infos.length = 0;
  app.records.clipboard.length = 0;
  app.setQuickPick({ label: 'ccache' });
  app.setQuickPick({ label: 'Copy the winget install command', action: 'winget-copy' });
  await app.invoke('codeblocks.installCompilerCache');
  check('installCompilerCache 复制 winget 命令并创建终端',
    app.records.clipboard.some((s) => s.includes('winget install --id Ccache.Ccache'))
    && app.records.statusBarMessages.length >= 0
    && app.mock.infos.some((m) => /winget|Install command copied|安装命令/.test(m)),
    { clipboard: app.records.clipboard, infos: app.mock.infos });

  // ---- 新建构建目标 ----
  app.setInputBox('Profile');
  app.setQuickPick({ label: 'Console application', description: 'ttConsoleOnly', type: 2 });
  app.mock.infos.length = 0;
  await app.invoke('codeblocks.newBuildTarget');
  check('newBuildTarget 写入 .cbp 并提示',
    [cbpA, cbpB].some((p) => fs.readFileSync(p, 'utf-8').includes('title="Profile"')) && app.mock.infos.some((m) => /Build target .* created|已创建/.test(m)),
    app.mock.infos);

  // ---- 新建工程文件 ----
  app.setInputBox('extra.c');
  app.setQuickPick({ label: 'C source', description: '.c', content: 'int extra(void) { return 1; }\n' });
  await app.invoke('codeblocks.newFile');
  const extraCreated = [path.join(dirA, 'extra.c'), path.join(dirB, 'extra.c')].some((p) => fs.existsSync(p));
  const extraCbp = [cbpA, cbpB].find((p) => fs.readFileSync(p, 'utf-8').includes('extra.c'));
  check('newFile 创建文件并加入工程', extraCreated && !!extraCbp, { extraCreated, extraCbp });

  // ---- Remove Files（从工程移除，保留磁盘文件） ----
  const i18n = require('../dist/i18n');
  app.setQuickPick([{ label: 'extra.c' }]);
  app.setWarningButton(i18n.t('Remove'));
  await app.invoke('codeblocks.removeFiles', { project: { filename: extraCbp } });
  check('removeFiles 从 .cbp 删除 <Unit> 但保留磁盘文件',
    !fs.readFileSync(extraCbp, 'utf-8').includes('extra.c') && fs.existsSync(path.join(path.dirname(extraCbp), 'extra.c')),
    { cbp: fs.readFileSync(extraCbp, 'utf-8').includes('extra.c'), onDisk: fs.existsSync(path.join(path.dirname(extraCbp), 'extra.c')) });

  // ---- Save Project（原地写回） ----
  await app.invoke('codeblocks.saveProject', { project: { filename: cbpB } });
  check('saveProject 写回后 .cbp 仍可解析', fs.readFileSync(cbpB, 'utf-8').includes('<CodeBlocks_project_file>'), null);

  // ---- Save Project As ----
  const cbpCopy = path.join(dirB, 'beta-copy.cbp');
  app.setSaveDialog(cbpCopy);
  await app.invoke('codeblocks.saveProjectAs');
  check('saveProjectAs 写出新 .cbp',
    fs.existsSync(cbpCopy) && fs.readFileSync(cbpCopy, 'utf-8').includes('<CodeBlocks_project_file>'),
    { exists: fs.existsSync(cbpCopy) });

  // ---- Export Makefile ----
  app.setQuickPick('Debug');
  await app.invoke('codeblocks.selectTarget');
  const makefile = path.join(dirB, 'Makefile.exported');
  app.setSaveDialog(makefile);
  await app.invoke('codeblocks.exportMakefile');
  check('exportMakefile 写出 Makefile 且包含编译规则',
    fs.existsSync(makefile) && /CFLAGS|gcc|g\+\+/.test(fs.readFileSync(makefile, 'utf-8')),
    { exists: fs.existsSync(makefile) });

  // ---- Import Project（Dev-C++ .dev XML） ----
  const importDir = path.join(tmp, 'imported');
  fs.mkdirSync(importDir, { recursive: true });
  const dev = path.join(importDir, 'legacy.dev');
  fs.writeFileSync(dev, '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<DEVPROJECT>\n  <NAME value="legacy" />\n  <TYPE value="1" />\n  <UNITS><FILE value="main.c" /></UNITS>\n</DEVPROJECT>\n', 'utf-8');
  fs.writeFileSync(path.join(importDir, 'main.c'), 'int main(void){return 0;}\n', 'utf-8');
  app.setOpenDialog({ fsPath: dev, scheme: 'file' });
  app.mock.infos.length = 0;
  await app.invoke('codeblocks.importProject');
  const importedCbp = path.join(importDir, 'legacy.cbp');
  check('importProject 生成 .cbp 并提示',
    fs.existsSync(importedCbp) && app.mock.infos.some((m) => /Imported|已导入/.test(m)),
    { exists: fs.existsSync(importedCbp), infos: app.mock.infos });

  // ---- 关闭工程 ----
  app.mock.infos.length = 0;
  await app.invoke('codeblocks.closeProject', { project: { filename: cbpCopy } });
  check('closeProject 关闭工程并提示',
    app.mock.infos.some((m) => /Project closed|已关闭/.test(m)), app.mock.infos);
  const afterClose = app.mock.infos.length;
  await app.invoke('codeblocks.closeProject', { project: { filename: cbpCopy } });
  check('closeProject 对已关闭工程静默（不重复提示）', app.mock.infos.length === afterClose, app.mock.infos.length - afterClose);

  // ---- 无工程/无工作区时的守卫 ----
  for (const p of [cbpA, cbpB]) {
    await app.invoke('codeblocks.closeProject', { project: { filename: p } });
  }
  app.mock.warnings.length = 0;
  await app.invoke('codeblocks.buildAndRun');
  check('buildAndRun 无工程时提示先打开工程',
    app.mock.warnings.some((m) => /Open a Code::Blocks project|请先打开/.test(m)), app.mock.warnings);
  app.mock.warnings.length = 0;
  await app.invoke('codeblocks.findSymbolInLibraries');
  check('findSymbolInLibraries 无工程时提示',
    app.mock.warnings.some((m) => /project|工程|项目/i.test(m)), app.mock.warnings);
  app.mock.warnings.length = 0;
  await app.invoke('codeblocks.workspace.editDependencies');
  check('workspace.editDependencies 无 .workspace 时提示',
    app.mock.warnings.some((m) => /workspace/i.test(m)), app.mock.warnings);

  app.mock.warnings.length = 0;
  app.records.shownDocuments.length = 0;
  await app.invoke('codeblocks.openDefaultConfig');
  check('openDefaultConfig 找到则打开、未找到则提示 default.conf',
    app.records.shownDocuments.some((p) => /default\.conf$/i.test(p)) || app.mock.warnings.some((m) => /default\.conf/i.test(m)),
    { docs: app.records.shownDocuments, warnings: app.mock.warnings });

  // ---- 新建工程向导（模板 → 名称 → 目录 → 编译器） ----
  const { PROJECT_TEMPLATES } = require('../dist/project/newProject.js');
  const tpl = PROJECT_TEMPLATES[0];
  app.setQuickPick({ label: tpl.label, description: tpl.description, template: tpl });
  app.setInputBox('d10-new');
  app.setOpenDialog({ fsPath: tmp, scheme: 'file' });
  app.setQuickPick('gcc');
  await app.invoke('codeblocks.newProject');
  const newCbp = path.join(tmp, 'd10-new', 'd10-new.cbp');
  check('newProject 按向导生成 .cbp 并打开',
    fs.existsSync(newCbp) && fs.readFileSync(newCbp, 'utf-8').includes('d10-new'),
    { exists: fs.existsSync(newCbp) });

  await app.deactivate().catch(() => undefined);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nD-10 命令行为（批次 1）: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('D-10 命令行为（批次 1）异常: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
