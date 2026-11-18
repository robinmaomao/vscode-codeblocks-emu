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

const { MENU_STRUCTURE, CHILD_ICONS, HOVER_GROUPS, findMenuItem, walkMenuItems } = require('../dist/ui/menuStructure.js');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const dict = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/i18n/strings.zh-cn.json'), 'utf-8'));
const validCodicons = new Set(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/codicons.json'), 'utf-8')));

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
  'codeblocks.debug.registers.focus', // VS Code 为 Debug 容器中的 Registers 视图自动生成
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
  'workbench.action.openRecent',
  'workbench.action.clearRecentFiles',
  'workbench.action.quit',
  // Edit
  'undo', 'redo',
  'editor.action.clipboardCutAction',
  'editor.action.clipboardCopyAction',
  'editor.action.clipboardPasteAction',
  'editor.action.commentLine',
  'editor.action.blockComment',
  'editor.action.removeCommentLine',
  'editor.fold', 'editor.unfold', 'editor.foldAll', 'editor.unfoldAll', 'editor.toggleFold',
  'editor.action.transformToUppercase',
  'editor.action.transformToLowercase',
  'editor.action.copyLinesDownAction',
  'editor.action.moveLinesUpAction',
  'editor.action.moveLinesDownAction',
  'editor.action.deleteLines',
  'editor.action.transposeLetters',
  'editor.action.selectAll',
  'editor.action.addSelectionToNextFindMatch',
  'editor.action.moveSelectionToNextFindMatch',
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
  'editor.debug.action.runToCursor',
  'workbench.debug.viewlet.action.removeAllBreakpoints',
  'workbench.debug.action.focusBreakpointsView',
  'workbench.debug.action.focusCallStackView',
  'workbench.debug.action.focusVariablesView',
  'workbench.debug.action.focusWatchView',
  'debug.action.openDisassemblyView',
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
const globalLabels = new Set();
const visit = (items, menuLabel) => {
  const seen = new Set();
  for (const it of items) {
    if (it.separator) {
      if (it.label !== '' || it.command || it.children || it.dynamic) { structOk = false; structMsg = `分隔线非法: ${menuLabel}`; }
      continue;
    }
    if (!it.label) { structOk = false; structMsg = `空 label: ${menuLabel}`; continue; }
    if (seen.has(it.label)) { structOk = false; structMsg = `同级重复 label: ${menuLabel} / ${it.label}`; }
    seen.add(it.label);
    if (globalLabels.has(it.label)) { structOk = false; structMsg = `全局重复 label: ${menuLabel} / ${it.label}`; }
    globalLabels.add(it.label);
    const kinds = [!!it.command, !!it.children, it.dynamic !== undefined].filter(Boolean).length;
    if (kinds !== 1) { structOk = false; structMsg = `叶子/父项/动态区互斥冲突: ${menuLabel} / ${it.label}`; }
    if (it.command && it.args !== undefined && !Array.isArray(it.args)) { structOk = false; structMsg = `args 非数组: ${it.label}`; }
    if (it.children) visit(it.children, `${menuLabel} > ${it.label}`);
  }
};
for (const m of MENU_STRUCTURE) visit(m.children, m.label);
check('结构合法性（叶子/父项/动态区互斥、分隔线合法、label 全局唯一）', structOk, structMsg, '合法');
check('菜单项数量 > 70（覆盖 9 顶级菜单）', all.length > 70, all.length, '> 70');

// ---- 2b. 图标：100% 覆盖 + 1.85 codicon 白名单 + 无残留 key ----
const iconMissing = all.filter((it) => !CHILD_ICONS[it.label]).map((it) => it.label);
check(`每个菜单项都有图标（${all.length} 项）`, iconMissing.length === 0, iconMissing.slice(0, 10), '无缺失');
const iconInvalid = Object.entries(CHILD_ICONS)
  .filter(([, icon]) => !validCodicons.has(icon))
  .map(([label, icon]) => `${label} → ${icon}`);
check('图标均为 VS Code 1.85 合法 codicon', iconInvalid.length === 0, iconInvalid.slice(0, 10), '全部合法');
const usedLabels = new Set(all.map((it) => it.label));
const staleIcons = Object.keys(CHILD_ICONS).filter((label) => !usedLabels.has(label));
check('CHILD_ICONS 无残留 key（都对应真实菜单项）', staleIcons.length === 0, staleIcons.slice(0, 10), '无残留');

// ---- 2c. 标签：中文单语言、无重复译文 ----
const mixedLabels = all
  .filter((it) => /^[A-Za-z0-9 '&+./-]+\uFF08[^\uFF09]+\uFF09$/.test(dict[it.label] || ''))
  .map((it) => `${it.label} → ${dict[it.label]}`);
check('中文菜单标签无「English（中文）」混排', mixedLabels.length === 0, mixedLabels, '无混排');
const zhMap = new Map();
for (const it of all) {
  const zh = dict[it.label] || it.label;
  if (!zhMap.has(zh)) zhMap.set(zh, []);
  zhMap.get(zh).push(it.label);
}
const duplicateZh = [...zhMap.entries()].filter(([, labels]) => labels.length > 1).map(([zh, labels]) => `${zh} ← ${labels.join(' | ')}`);
check('中文菜单标签无重名（如 Copy / Duplicate 都叫“复制”）', duplicateZh.length === 0, duplicateZh, '无重名');

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

// 贡献了但没注册的命令只会在点击后报 “Command failed”；这里按源码字符串交叉校验运行接线
const srcText = (() => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) files.push(fs.readFileSync(p, 'utf-8'));
    }
  };
  walk(path.resolve(__dirname, '../src'));
  return files.join('\n');
})();
const menuCmdIds = [...new Set(all.filter((it) => it.command?.startsWith('codeblocks.')).map((it) => it.command))];
const notWired = menuCmdIds.filter((c) => !srcText.includes(`'${c}'`) && !srcText.includes(`"${c}"`));
check(`codeblocks.* 菜单命令均在源码中接线（${menuCmdIds.length} 个）`, notWired.length === 0, notWired, '全部接线');

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
  'codeblocks.findFile', 'codeblocks.addFilesRecursively',
  'codeblocks.newVirtualFolder',
  'codeblocks.debug.detach', 'codeblocks.debug.addSymbolFile',
  'codeblocks.debug.setNextStatement', 'codeblocks.debug.attachToProcess', 'codeblocks.debug.sendGdbCommand',
];
const missing = expectCommands.filter((c) => !all.some((it) => it.command === c));
check('第四十四轮关键命令均在菜单中', missing.length === 0, missing, '无缺失');

// ---- 7. 结构与 CB 位置（2026-11 状态栏菜单优化） ----
const menuOf = (label) => MENU_STRUCTURE.find((m) => m.label === label);
const labelsOf = (label) => menuOf(label).children.filter((c) => !c.separator).map((c) => c.label);
const idxOf = (arr, label) => arr.indexOf(label);

const fileLabels = labelsOf('File');
check('File：New 子菜单在首位（对齐 CB File → New）', fileLabels[0] === 'New', fileLabels.slice(0, 6));
check('File：动态区 Recent Files / Recent Projects / Workspace Build Order 齐备',
  ['Recent Files', 'Recent Projects', 'Workspace Build Order'].every((l) => fileLabels.includes(l)), fileLabels);
check('File：补 Save Project / Close Project / Project Properties…',
  ['Save Project', 'Close Project', 'Project Properties…'].every((l) => fileLabels.includes(l)), fileLabels);
check('File：不再有歧义的 New… 项', !fileLabels.includes('New…'), fileLabels);
check('File：Recent Projects / Workspace Build Order 为动态区标记',
  findMenuItem('Recent Projects')?.dynamic === 'recents' && findMenuItem('Workspace Build Order')?.dynamic === 'workspace',
  { recents: findMenuItem('Recent Projects')?.dynamic, workspace: findMenuItem('Workspace Build Order')?.dynamic });

const editLabels = labelsOf('Edit');
check('Edit：补 Uncomment / Select Skip / Fold·Unfold Current Block / Transpose',
  ['Uncomment', 'Select Skip to Next Occurrence', 'Fold Current Block', 'Unfold Current Block', 'Toggle Current Block', 'Transpose']
    .every((l) => !!findMenuItem(l)), editLabels.filter((l) => /Uncomment|Select Skip|Current Block|Transpose/.test(l)));
check('Edit：Find next/prev selected 与 changed line 已移出（CB 在 Search）',
  !editLabels.includes('Find Next Selected') && !editLabels.includes('Go to Next Change'), editLabels);

const viewLabels = labelsOf('View');
check('View：TODO List 从 Search 移入（CB TODO 插件位置）', viewLabels.includes('TODO List'), viewLabels);

const searchLabels = labelsOf('Search');
check('Search：Find Next/Previous 紧跟 Find in Files（CB 顺序）',
  idxOf(searchLabels, 'Find Next') === idxOf(searchLabels, 'Find in Files…') + 1
  && idxOf(searchLabels, 'Find Previous') === idxOf(searchLabels, 'Find Next') + 1, searchLabels.slice(0, 6));
check('Search：Project Search 子菜单收拢两个工程搜索命令',
  findMenuItem('Project Search')?.children?.map((c) => c.label).join('|')
  === 'Find Project Files…|Search in Project Files…', findMenuItem('Project Search')?.children?.map((c) => c.label));
check('Search：TODO List 不再重复出现', !searchLabels.includes('TODO List'), searchLabels);

const projectLabels = labelsOf('Project');
check('Project：Remove Files… 在 Project Tree 之前',
  idxOf(projectLabels, 'Remove Files…') > idxOf(projectLabels, 'Add Files Recursively…')
  && idxOf(projectLabels, 'Remove Files…') < idxOf(projectLabels, 'Project Tree'), projectLabels.slice(0, 6));
check('Project：CB 顺序 Set programs → Notes → Build options → Properties',
  idxOf(projectLabels, "Set Programs' Arguments…") < idxOf(projectLabels, 'Notes…')
  && idxOf(projectLabels, 'Notes…') < idxOf(projectLabels, 'Build Options…')
  && idxOf(projectLabels, 'Build Options…') < idxOf(projectLabels, 'Properties…'),
  projectLabels.slice(-8));

const buildLabels = labelsOf('Build');
check('Build：Export Makefile… 从 Tools 移入，位于 Export compile_commands 之前',
  idxOf(buildLabels, 'Export Makefile…') > 0
  && idxOf(buildLabels, 'Export Makefile…') < idxOf(buildLabels, 'Export compile_commands.json…'), buildLabels.slice(-4));

const debugLabels = labelsOf('Debug');
check('Debug：Debugging Windows 子菜单齐备（VS Code 原生视图入口）',
  findMenuItem('Debugging Windows')?.children?.map((c) => c.label).join('|')
  === 'Breakpoints|Call Stack|Variables|Watch|Registers|Disassembly', findMenuItem('Debugging Windows')?.children?.map((c) => c.label));
check('Debug：Information 位于 Attach 之前（CB 顺序）',
  idxOf(debugLabels, 'Information') < idxOf(debugLabels, 'Attach to Process…')
  && idxOf(debugLabels, 'Information') > idxOf(debugLabels, 'Add Symbol File…'), debugLabels.slice(-8));

const toolsLabels = labelsOf('Tools');
check('Tools：Configure Tools… 固定最后（自定义工具插在它之前）',
  toolsLabels[toolsLabels.length - 1] === 'Configure Tools…', toolsLabels);
check('Tools：Export Makefile… 已移出', !toolsLabels.includes('Export Makefile…'), toolsLabels);

// ---- 8. 可用性标注（needsProject / needsWorkspace / needsDebugSession） ----
const mustNeedProject = ['Code Statistics…', 'TODO List', 'Export compile_commands.json…', 'Save Project', 'Close Project', 'Project Properties…', 'Properties…', 'Remove Files…', 'Workspace Build Order'];
const missProjectFlag = mustNeedProject.filter((l) => findMenuItem(l)?.needsProject !== true);
check('needsProject：按命令实际守卫补齐', missProjectFlag.length === 0, missProjectFlag, '无缺失');
check('needsProject：Find File… 支持工作区级查找，不再误标', !findMenuItem('Find File…')?.needsProject, findMenuItem('Find File…')?.needsProject);
check('needsWorkspace：Workspace Dependencies… 标注', findMenuItem('Workspace Dependencies…')?.needsWorkspace === true, findMenuItem('Workspace Dependencies…')?.needsWorkspace);
const mustNeedDebug = ['Break Debugger', 'Stop Debugger', 'Run to Cursor', 'Step Over', 'Step Into', 'Step Out', 'Set Next Statement',
  'Add Symbol File…', 'Detach', 'Send GDB Command…', 'Current Stack Frame', 'Loaded Libraries', 'Targets and Files', 'FPU Status', 'Signal Handling'];
const missDebugFlag = mustNeedDebug.filter((l) => findMenuItem(l)?.needsDebugSession !== true);
check('needsDebugSession：需要活动调试会话的项均已标注', missDebugFlag.length === 0, missDebugFlag, '无缺失');
check('needsDebugSession：Toggle/Remove All Breakpoints 不需要会话，不标注',
  !findMenuItem('Toggle Breakpoint')?.needsDebugSession && !findMenuItem('Remove All Breakpoints')?.needsDebugSession,
  { toggle: findMenuItem('Toggle Breakpoint')?.needsDebugSession, remove: findMenuItem('Remove All Breakpoints')?.needsDebugSession });

// Settings 过滤串：必须是扩展作用域 + 对应设置组，不能只命中单个键或打开全部 VS Code 编辑器设置
const settingsFilter = (label) => {
  const args = findMenuItem(label)?.args;
  return Array.isArray(args) ? String(args[0]) : '';
};
check('Settings：Editor/Compiler/Debugger/Build 过滤串定位扩展设置组',
  settingsFilter('Editor…').includes('@ext:robinmaomao.codeblocks-vscode') && settingsFilter('Editor…').includes('codeblocks.editor')
  && settingsFilter('Compiler…').includes('@ext:robinmaomao.codeblocks-vscode') && settingsFilter('Compiler…').includes('compiler')
  && settingsFilter('Debugger…').includes('@ext:robinmaomao.codeblocks-vscode') && settingsFilter('Debugger…').includes('debug')
  && settingsFilter('Build & Log…').includes('@ext:robinmaomao.codeblocks-vscode') && settingsFilter('Build & Log…').includes('build'),
  ['Editor…', 'Compiler…', 'Debugger…', 'Build & Log…'].map((l) => settingsFilter(l)));

// 动态区命令（Recent Projects 二级列表 / Workspace 二级列表 / Tools 自定义工具）：不属于静态结构，但必须在 package.json 贡献
const dynamicCommands = ['codeblocks.openRecentProject', 'codeblocks.clearRecentProjects', 'codeblocks.runTool'];
const dynMissing = dynamicCommands.filter((c) => !contributed.has(c));
check('动态区命令（Recent/Clear）已贡献到 package.json', dynMissing.length === 0, dynMissing, '无缺失');

console.log(`菜单结构静态校验: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
