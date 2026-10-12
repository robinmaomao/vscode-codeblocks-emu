// 文件类命令处理器回归（可激活 mock 直调真实 handler；节点参数用真实 .cbp 解析结果构造）
//  覆盖：removeFile、toggleCompile、toggleLink、cleanFile、editFileBuildCommand、
//        openContainingFolder、fileProperties、renameFile、
//        keybindings.configure / keybindings.export / keybindings.import
// 前置：tests/_harness/extensionActivation.js（补桩 + 假 context + 对话框脚本化）
// 说明：
//  - 节点参数形状 = resolveFileNode 读取的 { project, file }；这里用生产解析器 ProjectParser
//    解析同一 .cbp 得到与工程树节点等价的对象（工程本身已通过 openProject 命令真实打开）。
//  - cleanFile 会真实删除对象文件（不调用外部编译器）；其余命令不触发编译。
//  - 局部补桩见「configuration.update」注释（mock 的 update 是 no-op，这里补上写入 configStore 的语义）。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { activate } = require('./_harness/extensionActivation');
const { ProjectParser } = require('../dist/model/parser.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

/** keybindings.export/import 的 handler 注册为「即发即忘」（() => void fn()），
 *  局部等一拍把异步链跑完，保证断言看到最终状态（不修改 harness）。 */
async function flush() {
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
}

/** 最小可解析工程：两个目标 + main.c / util.c（对应工程树中的文件节点） */
function writeFixture(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n'
    + '\t<FileVersion major="1" minor="6" />\n'
    + '\t<Project>\n'
    + '\t\t<Option title="demo" />\n'
    + '\t\t<Option compiler="gcc" />\n'
    + '\t\t<Build>\n'
    + '\t\t\t<Target title="Debug">\n'
    + '\t\t\t\t<Option type="1" />\n'
    + '\t\t\t\t<Option compiler="gcc" />\n'
    + '\t\t\t\t<Option output="bin/Debug/demo" />\n'
    + '\t\t\t\t<Option object_output="obj/Debug/" />\n'
    + '\t\t\t</Target>\n'
    + '\t\t\t<Target title="Release">\n'
    + '\t\t\t\t<Option type="1" />\n'
    + '\t\t\t\t<Option compiler="gcc" />\n'
    + '\t\t\t\t<Option output="bin/Release/demo" />\n'
    + '\t\t\t\t<Option object_output="obj/Release/" />\n'
    + '\t\t\t</Target>\n'
    + '\t\t</Build>\n'
    + '\t\t<Unit filename="main.c" />\n'
    + '\t\t<Unit filename="util.c" />\n'
    + '\t\t<Extensions />\n'
    + '\t</Project>\n'
    + '</CodeBlocks_project_file>\n';
  const cbp = path.join(dir, 'demo.cbp');
  fs.writeFileSync(cbp, xml, 'utf-8');
  fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void) { return 0; }\n', 'utf-8');
  fs.writeFileSync(path.join(dir, 'util.c'), 'int util(void) { return 1; }\n', 'utf-8');
  return cbp;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cmd-file-'));
  const projDir = path.join(tmp, 'proj');
  const cbp = writeFixture(projDir);

  const app = await activate({ tmpDir: tmp });
  const { records, mock } = app;
  const Uri = app.vscode.Uri;
  const channel = () => mock.channels.find((c) => c.name === 'Code::Blocks');
  const out = () => (channel() ? channel().lines.join('\n') : '');
  const rawCbp = () => fs.readFileSync(cbp, 'utf-8');
  const reparsed = () => new ProjectParser().parse(cbp);
  /** 与工程树文件节点等价的最小节点形状（resolveFileNode 只读 node.project / node.file） */
  const fileNode = (rel) => {
    const project = reparsed();
    const file = project.files.find((f) => f.relativeFilename === rel);
    return { project, file };
  };

  // ---------- 前置：用 openProject 命令真实打开夹具工程 ----------
  app.setOpenDialog(Uri.file(cbp));
  await app.invoke('codeblocks.openProject');
  check('前置：openProject 打开夹具工程（文件表可解析）',
    reparsed().files.map((f) => f.relativeFilename).join(',') === 'main.c,util.c' && /已打开项目: demo/.test(out()),
    reparsed().files.map((f) => f.relativeFilename), ['main.c', 'util.c']);

  // ---------- toggleCompile：写入 compile="0" → 再启用时删除该选项（缺省即启用，D-09） ----------
  await app.invoke('codeblocks.toggleCompile', fileNode('main.c'));
  let xml = rawCbp();
  check('toggleCompile：Unit 写入 <Option compile="0" /> 且重解析后 compile=false',
    /<Unit filename="main\.c">[\s\S]*<Option compile="0" \/>/.test(xml)
    && reparsed().files.find((f) => f.relativeFilename === 'main.c').compile === false,
    { hasOption: /<Option compile="0" \/>/.test(xml), compile: reparsed().files.find((f) => f.relativeFilename === 'main.c').compile }, false);
  await app.invoke('codeblocks.toggleCompile', fileNode('main.c'));
  check('toggleCompile：再启用时删除该选项（缺省即启用，compile=true）',
    !/<Option compile=/.test(rawCbp())
    && reparsed().files.find((f) => f.relativeFilename === 'main.c').compile === true,
    { hasOption: /<Option compile=/.test(rawCbp()), compile: reparsed().files.find((f) => f.relativeFilename === 'main.c').compile }, true);
  check('toggleCompile：无其它子选项时收回自闭合写法（与 writer 序列化一致）',
    /<Unit filename="main\.c" \/>/.test(rawCbp()), rawCbp().split('\n').filter((l) => /Unit filename="main\.c"/.test(l)), '<Unit filename="main.c" />');

  // ---------- toggleLink：写入 link="0" → 再启用时删除该选项（D-09） ----------
  await app.invoke('codeblocks.toggleLink', fileNode('main.c'));
  check('toggleLink：Unit 写入 <Option link="0" /> 且重解析后 link=false',
    /<Option link="0" \/>/.test(rawCbp())
    && reparsed().files.find((f) => f.relativeFilename === 'main.c').link === false,
    { hasOption: /<Option link="0" \/>/.test(rawCbp()), link: reparsed().files.find((f) => f.relativeFilename === 'main.c').link }, false);
  await app.invoke('codeblocks.toggleLink', fileNode('main.c'));
  check('toggleLink：再启用时删除该选项（缺省即启用，link=true）',
    !/<Option link=/.test(rawCbp())
    && reparsed().files.find((f) => f.relativeFilename === 'main.c').link === true,
    { hasOption: /<Option link=/.test(rawCbp()), link: reparsed().files.find((f) => f.relativeFilename === 'main.c').link }, true);

  // ---------- editFileBuildCommand：输入命令 → 写回 .cbp；输入空 → 清除 ----------
  app.setInputBox('del "$file"');
  await app.invoke('codeblocks.editFileBuildCommand', fileNode('main.c'));
  let cmd = (reparsed().files.find((f) => f.relativeFilename === 'main.c').customBuildCommands || {}).gcc;
  check('editFileBuildCommand：命令写回 .cbp（compiler=gcc / use=true）',
    !!cmd && cmd.command === 'del "$file"' && cmd.use === true && /buildCommand=/.test(rawCbp()),
    cmd, { command: 'del "$file"', use: true });
  app.setInputBox('');
  await app.invoke('codeblocks.editFileBuildCommand', fileNode('main.c'));
  cmd = (reparsed().files.find((f) => f.relativeFilename === 'main.c').customBuildCommands || {}).gcc;
  check('editFileBuildCommand：留空后命令被清除（.cbp 不再含 buildCommand）',
    cmd === undefined && !/buildCommand=/.test(rawCbp()), { cmd, hasAttr: /buildCommand=/.test(rawCbp()) }, '已清除');

  // ---------- cleanFile：真实删除对象文件（obj/Debug/main.o） ----------
  const objFile = path.join(projDir, 'obj', 'Debug', 'main.o');
  fs.mkdirSync(path.dirname(objFile), { recursive: true });
  fs.writeFileSync(objFile, 'fake-object', 'utf-8');
  if (channel()) channel().clear();
  await app.invoke('codeblocks.cleanFile', fileNode('main.c'));
  check('cleanFile：对象文件被真实删除且输出留痕',
    !fs.existsSync(objFile) && /Deleted: obj[\\/]Debug[\\/]main\.o/.test(out()),
    { exists: fs.existsSync(objFile), out: out().split('\n').slice(0, 2) }, 'Deleted: obj/Debug/main.o');
  await app.invoke('codeblocks.cleanFile', fileNode('main.c'));
  check('cleanFile：无对象文件时给出用户可见反馈（D-08）',
    !/Deleted:/.test(out()) && /无对象文件可清理/.test(out()) && !fs.existsSync(objFile),
    out().split('\n').filter((l) => /无对象文件|Deleted:/.test(l)).slice(0, 2), '含「无对象文件可清理」');

  // ---------- openContainingFolder：资源管理器中定位文件 ----------
  await app.invoke('codeblocks.openContainingFolder', fileNode('main.c'));
  const reveal = records.executeCommand.filter((c) => c.id === 'revealFileInOS');
  check('openContainingFolder：调用 revealFileInOS 且指向文件绝对路径',
    reveal.length === 1 && reveal[0].args[0] && path.normalize(reveal[0].args[0].fsPath) === path.normalize(path.join(projDir, 'main.c')),
    reveal.map((c) => c.args[0] && c.args[0].fsPath), path.join(projDir, 'main.c'));

  // ---------- fileProperties：打开工程属性面板并定位到该文件 ----------
  await app.invoke('codeblocks.fileProperties', fileNode('main.c'));
  check('fileProperties：打开属性 Webview 面板并定位文件（HTML 含 main.c）',
    mock.webviews.length >= 1 && /main\.c/.test(mock.webviews[mock.webviews.length - 1].webview.html),
    mock.webviews.length, '≥1 个面板');

  // ---------- renameFile：磁盘改名 + .cbp 引用更新 ----------
  app.setInputBox('helper.c');
  await app.invoke('codeblocks.renameFile', fileNode('util.c'));
  const renamed = path.join(projDir, 'helper.c');
  check('renameFile：磁盘文件改名（util.c → helper.c）',
    fs.existsSync(renamed) && !fs.existsSync(path.join(projDir, 'util.c')),
    { helper: fs.existsSync(renamed), util: fs.existsSync(path.join(projDir, 'util.c')) }, 'helper.c 存在');
  check('renameFile：.cbp 引用更新（新 Unit 出现、旧 Unit 消失）',
    /<Unit filename="helper\.c"/.test(rawCbp()) && !/filename="util\.c"/.test(rawCbp()),
    reparsed().files.map((f) => f.relativeFilename), ['main.c', 'helper.c']);
  check('renameFile：输出通道与编辑器打开留痕',
    /已重命名文件: util\.c → helper\.c/.test(out())
    && records.shownDocuments.some((p) => path.normalize(p) === path.normalize(renamed)),
    { out: out().split('\n').slice(-1), shown: records.shownDocuments.slice(-1) }, '重命名 + 打开新文件');

  // ---------- removeFile：确认取消保留 / 确认后 Unit 移除 ----------
  app.setWarningButton(undefined);
  const beforeCancel = rawCbp();
  await app.invoke('codeblocks.removeFile', fileNode('main.c'));
  const hasUnitAfterCancel = rawCbp() === beforeCancel && /<Unit filename="main\.c"/.test(rawCbp());
  const hasRemoveDialog = records.warningButtons.some((w) => /中移除文件 "main\.c"/.test(w.message) && w.buttons.includes('Remove'));
  check('removeFile：确认框取消时 Unit 保留',
    hasUnitAfterCancel && hasRemoveDialog,
    { hasUnitAfterCancel, hasRemoveDialog, lastWarning: records.warningButtons.slice(-1) }, 'Unit 保留 + Remove 确认');
  app.setWarningButton('Remove');
  await app.invoke('codeblocks.removeFile', fileNode('main.c'));
  check('removeFile：Unit 从 .cbp 移除（其余文件保留）',
    !/filename="main\.c"/.test(rawCbp()) && reparsed().files.map((f) => f.relativeFilename).join(',') === 'helper.c',
    reparsed().files.map((f) => f.relativeFilename), ['helper.c']);
  check('removeFile：输出通道留痕', /已从项目移除文件: main\.c/.test(out()), out().split('\n').slice(-1), '已从项目移除文件: main.c');
  check('removeFile：磁盘文件保留（仅移除工程引用）',
    fs.existsSync(path.join(projDir, 'main.c')), fs.existsSync(path.join(projDir, 'main.c')), true);

  // ---------- keybindings.configure / export / import ----------
  const kbPath = path.join(app.userDir, 'keybindings.json');
  const readKb = () => { try { return JSON.parse(fs.readFileSync(kbPath, 'utf-8')); } catch { return undefined; } };
  // 局部打桩：mock 的 configuration.update 是 no-op，而真实 VS Code 会写入设置；
  // 这里只补「写入 configStore」的语义（get 仍走原实现），使 configure/import 的设置写入可被断言。
  const origGetConfiguration = app.vscode.workspace.getConfiguration;
  app.vscode.workspace.getConfiguration = (section) => {
    const cfg = origGetConfiguration(section);
    cfg.update = (key, value) => {
      mock.configStore[section ? `${section}.${key}` : key] = value;
      return Promise.resolve();
    };
    return cfg;
  };

  app.setQuickPick({ id: 'build', label: '$(keyboard) Build（构建活动工程）' });
  app.setInputBox('alt+shift+k');
  await app.invoke('codeblocks.keybindings.configure');
  const overrides = mock.configStore['codeblocks.keybindings.overrides'] || {};
  check('keybindings.configure：所选托管项写入设置 overrides',
    overrides.build === 'alt+shift+k', overrides, { build: 'alt+shift+k' });
  check('keybindings.configure：QuickPick 列出托管键位项（含 Build）',
    records.quickPickPrompts.some((q) => q.items && q.items.some((l) => /Build（构建活动工程）/.test(l))),
    records.quickPickPrompts.map((q) => q.items).slice(-1), '含 Build 项');
  check('keybindings.configure：立即写入用户 keybindings.json（键位/命令/when）',
    Array.isArray(readKb()) && readKb().some((e) => e.key === 'alt+shift+k' && e.command === 'codeblocks.build' && e.when === 'editorTextFocus'),
    readKb(), 'alt+shift+k → codeblocks.build');
  check('keybindings.configure：状态栏反馈已更新键位',
    records.statusBarMessages.some((m) => /已更新 build → alt\+shift\+k/.test(m)), records.statusBarMessages.slice(-2), '已更新 build → alt+shift+k');

  app.setConfig('codeblocks.keybindings.overrides', { build: 'alt+shift+k', clean: '' });
  const schemeFile = path.join(tmp, 'scheme.json');
  app.setSaveDialog(schemeFile);
  await app.invoke('codeblocks.keybindings.export');
  await flush();
  check('keybindings.export：写出方案文件', fs.existsSync(schemeFile), fs.existsSync(schemeFile), true);
  const scheme = fs.existsSync(schemeFile) ? JSON.parse(fs.readFileSync(schemeFile, 'utf-8')) : undefined;
  check('keybindings.export：载荷含 version/overrides（含解绑空值）',
    !!scheme && scheme.version === 1 && scheme.overrides && scheme.overrides.build === 'alt+shift+k' && scheme.overrides.clean === '',
    scheme, '{version:1, overrides:{build, clean:""}}');
  app.setConfig('codeblocks.keybindings.overrides', {});
  const schemeFile2 = path.join(tmp, 'scheme-empty.json');
  await app.invoke('codeblocks.keybindings.export');
  await flush();
  check('keybindings.export：无自定义键位时仅提示、不落盘',
    mock.warnings.some((m) => /没有自定义快捷键可导出/.test(m)) && !fs.existsSync(schemeFile2),
    mock.warnings.slice(-1), '提示且未写盘');

  const importFile = path.join(tmp, 'import.json');
  fs.writeFileSync(importFile, JSON.stringify({ version: 1, overrides: { run: 'ctrl+alt+r' } }), 'utf-8');
  app.setOpenDialog(Uri.file(importFile));
  app.setQuickPick({ label: '$(replace) 覆盖', m: 'replace' });
  await app.invoke('codeblocks.keybindings.import');
  await flush();
  const imported = mock.configStore['codeblocks.keybindings.overrides'] || {};
  check('keybindings.import：覆盖模式替换全部自定义（旧 build 项被清除）',
    imported.run === 'ctrl+alt+r' && !('build' in imported), imported, { run: 'ctrl+alt+r' });
  check('keybindings.import：导入项同步写入 keybindings.json',
    Array.isArray(readKb()) && readKb().some((e) => e.key === 'ctrl+alt+r' && e.command === 'codeblocks.run'),
    readKb(), 'ctrl+alt+r → codeblocks.run');
  check('keybindings.import：提示已导入项数', mock.infos.some((m) => /已导入 1 项并应用/.test(m)), mock.infos.slice(-1), '已导入 1 项并应用');

  const importFile2 = path.join(tmp, 'import2.json');
  fs.writeFileSync(importFile2, JSON.stringify({ overrides: { debug: 'f6' } }), 'utf-8');
  app.setOpenDialog(Uri.file(importFile2));
  app.setQuickPick(undefined); // 未选择「合并 / 覆盖」→ 取消
  await app.invoke('codeblocks.keybindings.import');
  await flush();
  check('keybindings.import：未选择合并/覆盖时不动设置',
    JSON.stringify(mock.configStore['codeblocks.keybindings.overrides']) === JSON.stringify(imported),
    mock.configStore['codeblocks.keybindings.overrides'], imported);

  await app.deactivate().catch(() => undefined);
  console.log(`\n文件类命令处理器回归: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('文件类命令处理器回归异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
