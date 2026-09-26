// 静态校验：状态栏 Menu 结构（src/ui/menuStructure.ts）
// 覆盖：命令存在性（codeblocks.* 对 package.json 交叉校验）、内置命令白名单、
//       同级 label 唯一、子菜单/分隔线结构合法性、快捷键展示与 keybindings 一致性、
//       悬停分组 label 可解析、顶级菜单顺序对齐 Code::Blocks。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const { MENU_STRUCTURE, HOVER_GROUPS, findMenuItem, walkMenuItems } = require('../dist/ui/menuStructure.js');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));

// ---- 允许集 ----
// 1) package.json contributes.commands
const contributed = new Set((pkg.contributes.commands || []).map((c) => c.command));
// 2) 运行时注册 / VS Code 视图自动生成的 codeblocks.* 命令
const runtimeRegistered = new Set([
  'codeblocks.projectTree.focus', // extension.ts 显式注册（视图焦点命令）
  'codeblocks.buildLog.focus',    // extension.ts 显式注册（聚焦底部 Panel 容器）
  'codeblocks.symbols.focus',     // VS Code 为贡献视图自动生成的焦点命令
  'codeblocks.analysis.focus',
  'codeblocks.setActiveProject',  // 动态区（Workspace 二级列表）使用；extension.ts 注册
]);
// 3) VS Code 内置命令白名单（结构里用到哪些内置命令，这里必须一一列出；两个方向都校验）
const builtinWhitelist = new Set([
  // File
  'workbench.action.files.newUntitledFile',
  'workbench.action.files.save',
  'workbench.action.files.saveAs',
  'workbench.action.files.saveAll',
  'workbench.action.closeActiveEditor',
  'workbench.action.closeAllEditors',
  'workbench.action.quit',
  // Edit
  'undo', 'redo',
  'editor.action.clipboardCutAction',
  'editor.action.clipboardCopyAction',
  'editor.action.clipboardPasteAction',
  'editor.action.commentLine',
  'editor.action.blockComment',
  'editor.foldAll', 'editor.unfoldAll', 'editor.toggleFold',
  'editor.action.transformToUppercase',
  'editor.action.transformToLowercase',
  'editor.action.copyLinesDownAction',
  'editor.action.moveLinesUpAction',
  'editor.action.moveLinesDownAction',
  'editor.action.deleteLines',
  'editor.action.selectAll',
  'editor.action.addSelectionToNextFindMatch',
  'editor.action.jumpToBracket',
  'workbench.action.editor.changeEncoding',
  'workbench.action.editor.changeEOL',
  'workbench.action.editor.changeLanguageMode',
  'editor.action.triggerParameterHints',
  'editor.action.nextSelectionMatchFindAction',
  'editor.action.previousSelectionMatchFindAction',
  'workbench.action.editor.previousChange',
  'workbench.action.editor.nextChange',
  // View
  'workbench.actions.view.problems',
  'workbench.action.terminal.toggleTerminal',
  'workbench.action.toggleFullScreen',
  // Search
  'actions.find',
  'workbench.action.findInFiles',
  'editor.action.nextMatchFindAction',
  'editor.action.previousMatchFindAction',
  'editor.action.startFindReplaceAction',
  'workbench.action.replaceInFiles',
  'workbench.action.gotoLine',
  'workbench.action.quickOpen',
  // Debug
  'workbench.action.debug.pause',
  'workbench.action.debug.stop',
  'workbench.action.debug.stepOver',
  'workbench.action.debug.stepInto',
  'workbench.action.debug.stepOut',
  'editor.debug.action.toggleBreakpoint',
  'workbench.view.debug',
  // Settings
  'workbench.action.openSettings',
]);

// ---- 1. 顶级菜单顺序（对齐 Code::Blocks） ----
const topLabels = MENU_STRUCTURE.map((m) => m.label);
check('顶级菜单顺序 = CB（File/Edit/View/Search/Project/Build/Debug/Tools/Settings）',
  JSON.stringify(topLabels) === JSON.stringify(['File', 'Edit', 'View', 'Search', 'Project', 'Build', 'Debug', 'Tools', 'Settings']),
  topLabels, 'CB 顺序');

// ---- 2. 结构合法性 ----
const all = walkMenuItems();
let structOk = true;
let structMsg = '';
const visit = (items, menuLabel) => {
  const seen = new Set();
  for (const it of items) {
    if (it.separator) {
      if (it.label !== '' || it.command || it.children) { structOk = false; structMsg = `分隔线非法: ${menuLabel}`; }
      continue;
    }
    if (!it.label) { structOk = false; structMsg = `空 label: ${menuLabel}`; continue; }
    if (seen.has(it.label)) { structOk = false; structMsg = `同级重复 label: ${menuLabel} / ${it.label}`; }
    seen.add(it.label);
    const isLeaf = !!it.command;
    const isSub = !!it.children;
    if (isLeaf === isSub) { structOk = false; structMsg = `叶子/父项互斥冲突: ${menuLabel} / ${it.label}`; }
    if (isLeaf && it.args !== undefined && !Array.isArray(it.args)) { structOk = false; structMsg = `args 非数组: ${it.label}`; }
    if (isSub) visit(it.children, `${menuLabel} > ${it.label}`);
  }
};
for (const m of MENU_STRUCTURE) visit(m.children, m.label);
check('结构合法性（叶子/父项互斥、分隔线合法、同级 label 唯一）', structOk, structMsg, '合法');
check('菜单项数量 > 70（覆盖 9 顶级菜单）', all.length > 70, all.length, '> 70');

// ---- 3. 命令存在性 ----
const builtinUsed = new Set();
let cmdOk = true;
let cmdMsg = '';
for (const it of all) {
  if (!it.command) continue;
  if (it.command.startsWith('codeblocks.')) {
    if (!contributed.has(it.command) && !runtimeRegistered.has(it.command)) {
      cmdOk = false; cmdMsg = `${it.label} → ${it.command} 未定义`;
    }
  } else {
    builtinUsed.add(it.command);
    if (!builtinWhitelist.has(it.command)) { cmdOk = false; cmdMsg = `${it.label} → ${it.command} 不在内置白名单`; }
  }
}
check('全部 command 存在（codeblocks.* 对 package.json 交叉校验）', cmdOk, cmdMsg, '全部存在');
const staleBuiltins = [...builtinWhitelist].filter((c) => !builtinUsed.has(c));
check('内置命令白名单无冗余（反向校验）', staleBuiltins.length === 0, staleBuiltins, '无冗余');

// ---- 4. 快捷键展示与 keybindings 一致 ----
const bindings = pkg.contributes.keybindings || [];
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
let scOk = true;
let scMsg = '';
let scCount = 0;
for (const it of all) {
  if (!it.shortcut) continue;
  // 支持一键多标注（'Ctrl+Shift+Up' 或 'F4 / Alt+F2'）
  for (const one of String(it.shortcut).split('/').map((s) => s.trim()).filter(Boolean)) {
    scCount++;
    const hit = bindings.some((b) => b.command === it.command && norm(b.key) === norm(one));
    if (!hit) { scOk = false; scMsg = `${it.label} (${it.command}) 声明 ${one} 但无对应 keybinding`; }
  }
}
check(`shortcut 均与 keybindings 一致（${scCount} 项）`, scOk, scMsg, '一致');

// ---- 5. 悬停分组可解析 ----
let hoverOk = true;
let hoverMsg = '';
let hoverCount = 0;
for (const group of HOVER_GROUPS) {
  for (const label of group) {
    const item = findMenuItem(label);
    if (!item?.command) { hoverOk = false; hoverMsg = `悬停分组 label 无法解析: ${label}`; }
    else hoverCount++;
  }
}
check(`悬停分组 label 均可解析到命令（${hoverCount} 项）`, hoverOk, hoverMsg, '全部可解析');

// ---- 6. 关键项抽查（对齐批次完整性） ----
const expectCommands = [
  'codeblocks.compileCurrentFile', 'codeblocks.clearErrors', 'codeblocks.activatePriorProject',
  'codeblocks.activateNextProject', 'codeblocks.toggleCategorize',
  'codeblocks.projectNotes', 'codeblocks.setProgramArguments', 'codeblocks.showGlobalVariables',
  'codeblocks.clearBacktickCache', 'codeblocks.buildWorkspace', 'codeblocks.cleanWorkspace',
  'codeblocks.rebuildWorkspace', 'codeblocks.build.stop', 'codeblocks.generateCompileCommands',
  'codeblocks.swapHeaderSource', 'codeblocks.insertHeaderGuard', 'codeblocks.tidyComments',
  'codeblocks.configureTools', 'codeblocks.showCompilerCommands', 'codeblocks.exportMakefile',
  'codeblocks.workspace.editDependencies', 'codeblocks.importProject',
  'codeblocks.openDefaultConfig',
  'codeblocks.newProjectFromTemplate', 'codeblocks.saveProjectAsTemplate',
  'codeblocks.debug.infoFrame', 'codeblocks.debug.infoSharedLibrary', 'codeblocks.debug.infoFiles',
  'codeblocks.debug.infoFloat', 'codeblocks.debug.infoSignals',
];
const missing = expectCommands.filter((c) => !all.some((it) => it.command === c));
check('第四十四轮关键命令均在菜单中', missing.length === 0, missing, '无缺失');

// 动态区命令（Recent Projects 二级列表 / Workspace 二级列表 / Tools 自定义工具）：不属于静态结构，但必须在 package.json 贡献
const dynamicCommands = ['codeblocks.openRecentProject', 'codeblocks.clearRecentProjects', 'codeblocks.runTool'];
const dynMissing = dynamicCommands.filter((c) => !contributed.has(c));
check('动态区命令（Recent/Clear）已贡献到 package.json', dynMissing.length === 0, dynMissing, '无缺失');

console.log(`菜单结构静态校验: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
