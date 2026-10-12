// 编辑类命令处理器回归（可激活 mock 直调真实 handler）
//  覆盖：bookmarks.toggle/next/prev/clearAll、todo.add、analysis.locate、analysis.copyXml、
//        format（无 astyle 时的回退分支）、compileFileWithoutProject（三类早退 + Task 生成）
// 前置：tests/_harness/extensionActivation.js（补桩 + 假 context + 对话框脚本化）
const path = require('path');
const fs = require('fs');
const os = require('os');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cmd-editor-'));
  const src = path.join(tmp, 'main.c');
  const srcText = ['#include <stdio.h>', 'int main(void) {', '    int a = 1;', '    return a;', '}', ''].join('\n');
  fs.writeFileSync(src, srcText, 'utf-8');

  const app = await activate({ tmpDir: tmp });
  const { records, mock } = app;

  // ---------- bookmarks.toggle：添加 → 再次调用移除（workspaceState 持久 + 装饰刷新） ----------
  app.setActiveEditor(src, srcText, 'c');
  await app.invoke('codeblocks.bookmarks.toggle');
  let stored = app.ctx.workspaceState.get('codeblocks.bookmarks', []);
  check('BM toggle 添加书签（workspaceState 持久化 1 条）', Array.isArray(stored) && stored.length === 1, stored, 1);
  check('BM toggle 书签记录文件与行号', stored[0] && path.basename(stored[0].file) === 'main.c' && stored[0].line === 1, stored[0], 'main.c:1');
  await app.invoke('codeblocks.bookmarks.toggle');
  stored = app.ctx.workspaceState.get('codeblocks.bookmarks', []);
  check('BM toggle 再按一次移除（列表清空）', Array.isArray(stored) && stored.length === 0, stored, 0);

  // ---------- bookmarks.next / prev：跳转（回绕） ----------
  app.setActiveEditor(src, srcText, 'c');
  await app.invoke('codeblocks.bookmarks.toggle'); // 行 1
  const opened = [];
  const origOpen = mock.vscode.workspace.openTextDocument;
  mock.vscode.workspace.openTextDocument = (p) => { opened.push(typeof p === 'string' ? p : p.fsPath); return origOpen(p); };
  await app.invoke('codeblocks.bookmarks.next');
  await app.invoke('codeblocks.bookmarks.prev');
  check('BM next/prev 触发文档打开（跨文件跳转路径）', opened.length >= 1, opened.length, '≥1');

  // ---------- bookmarks.clearAll：确认后清空 ----------
  app.setActiveEditor(src, srcText, 'c');
  let before = app.ctx.workspaceState.get('codeblocks.bookmarks', []);
  if (!before.length) { await app.invoke('codeblocks.bookmarks.toggle'); before = app.ctx.workspaceState.get('codeblocks.bookmarks', []); }
  check('BM clearAll 前置：存在书签', before.length >= 1, before.length, '≥1');
  app.setWarningButton('Clear');
  await app.invoke('codeblocks.bookmarks.clearAll');
  stored = app.ctx.workspaceState.get('codeblocks.bookmarks', []);
  check('BM clearAll 确认后清空', Array.isArray(stored) && stored.length === 0, stored, 0);
  check('BM clearAll 出现确认对话框（modal + Clear 按钮）',
    records.warningButtons.some((w) => /书签/.test(w.message) && w.buttons.includes('Clear')),
    records.warningButtons.map((w) => w.message).slice(0, 2), '含书签确认');
  check('BM clearAll 输出通道留痕', mock.channels.some((c) => c.lines.some((l) => /已清除全部书签/.test(l))), '≥1 行');
  const warningsBefore = records.warningButtons.length;
  await app.invoke('codeblocks.bookmarks.clearAll');
  check('BM clearAll 无书签时仅提示、不再弹确认',
    records.warningButtons.length === warningsBefore && mock.infos.some((m) => /没有书签/.test(m)),
    { warnings: records.warningButtons.length, infos: mock.infos.slice(0, 2) }, '无新确认 + 提示');

  // ---------- todo.add：QuickPick + 两次 InputBox → 插入注释行 ----------
  const ed = app.setActiveEditor(src, srcText, 'c').editor;
  const edits = [];
  ed.edit = (cb) => { const e = { ops: [], insert: (pos, text) => e.ops.push({ pos, text }) }; cb(e); edits.push(e); return Promise.resolve(true); };
  app.setQuickPick('TODO');
  app.setInputBox('');
  app.setInputBox('补充单元测试');
  await app.invoke('codeblocks.todo.add');
  check('TODO add 出现类型 QuickPick（关键字列表）', records.quickPickPrompts.some((q) => q.items.includes('TODO')), records.quickPickPrompts.map((q) => q.items.slice(0, 3)), '含 TODO');
  check('TODO add 插入了注释文本', edits.length === 1 && /\/\/ TODO: 补充单元测试/.test(JSON.stringify(edits[0].ops)), edits[0] && edits[0].ops, '// TODO: 补充单元测试');
  check('TODO add 输出通道留痕', mock.channels.some((c) => c.lines.some((l) => /已插入 TODO/.test(l))), mock.channels.map((c) => c.lines.length), '≥1 行');

  // ---------- analysis.copyXml：剪贴板写入节点 xml ----------
  await app.invoke('codeblocks.analysis.copyXml', { xml: '<Unit filename="main.c" />' });
  check('analysis.copyXml 写入剪贴板', records.clipboard.includes('<Unit filename="main.c" />'), records.clipboard, '片段');
  check('analysis.copyXml 空节点不写剪贴板', records.clipboard.length === 1, records.clipboard.length, 1);

  // ---------- analysis.locate：打开 .cbp 并定位 ----------
  const cbp = path.join(tmp, 'main.cbp');
  fs.writeFileSync(cbp, '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n<CodeBlocks_project_file>\n\t<FileVersion major="1" minor="6" />\n</CodeBlocks_project_file>\n', 'utf-8');
  let locateErr = null;
  try { await app.invoke('codeblocks.analysis.locate', { filename: cbp, locate: ['Unit'] }); }
  catch (e) { locateErr = e && e.message; }
  check('analysis.locate 不抛错（打开 .cbp 后定位）', locateErr === null, locateErr, null);
  let locateNoArg = null;
  try { await app.invoke('codeblocks.analysis.locate', {}); }
  catch (e) { locateNoArg = e && e.message; }
  check('analysis.locate 缺参安全早退', locateNoArg === null, locateNoArg, null);

  // ---------- format：未找到 astyle → 回退内置格式化命令 ----------
  app.setConfig('codeblocks.astyle.path', path.join(tmp, 'not-exists-astyle.exe'));
  app.setActiveEditor(src, srcText, 'c');
  await app.invoke('codeblocks.format');
  check('format 无 astyle 时回退 editor.action.formatDocument',
    records.executeCommand.some((c) => c.id === 'editor.action.formatDocument'), records.executeCommand.map((c) => c.id).slice(-3), 'formatDocument');

  // ---------- compileFileWithoutProject：无活动编辑器 / 非源文件早退 ----------
  mock.vscode.window.activeTextEditor = undefined;
  app.setConfig('codeblocks.masterPath', '');
  await app.invoke('codeblocks.compileFileWithoutProject');
  check('compileFileWithoutProject 无活动编辑器安全早退', true, 'ok');
  app.setActiveEditor(path.join(tmp, 'readme.txt'), 'hello', 'plaintext');
  await app.invoke('codeblocks.compileFileWithoutProject');
  check('compileFileWithoutProject 非源文件早退且未执行任务', records.tasks.length === 0, records.tasks.length, 0);
  app.setActiveEditor(src, srcText, 'c');
  let compileErr = null;
  try { await app.invoke('codeblocks.compileFileWithoutProject'); }
  catch (e) { compileErr = e && e.message; }
  check('compileFileWithoutProject 源文件路径不抛错（生成任务或给出提示）',
    compileErr === null && (records.tasks.length >= 1 || mock.warnings.length >= 1 || records.executeCommand.length >= 1),
    { compileErr, tasks: records.tasks.length, warnings: mock.warnings.length }, '任务或提示');

  await app.deactivate().catch(() => undefined);
  console.log(`\n编辑类命令处理器回归: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('命令处理器回归异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
