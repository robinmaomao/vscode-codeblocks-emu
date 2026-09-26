/**
 * 状态栏菜单结构 —— Code::Blocks 菜单栏移植（纯数据层，无 vscode 依赖）
 *
 * 顶级菜单对齐 Code::Blocks：File / Edit / View / Search / Project / Build / Debug / Tools / Settings
 * （CB 的 Plugins / Help 有意不移植，见 docs/对齐对照.md「菜单对齐」章节）。
 *
 * 本模块只放数据：由 statusBarMenu.ts 渲染为两级/三级 QuickPick；
 * 由 tests/test-menu-structure.js 做静态校验（命令存在性 / 快捷键一致性 / 结构合法性）。
 */

/** 单个菜单项（叶子命令或子菜单父项或分隔线） */
export interface MenuItemDef {
  /** 显示名称（分隔线为空字符串） */
  label: string;
  /** 分隔线 */
  separator?: true;
  /** 叶子命令（与 children 互斥） */
  command?: string;
  /** 命令参数（如 workbench.action.openSettings 的查询串） */
  args?: unknown[];
  /** 子菜单（有 children、无 command） */
  children?: MenuItemDef[];
  /** 快捷键展示（与 package.json keybindings 一致；多个用 ' / ' 分隔，回归测试校验） */
  shortcut?: string;
  /** 需要打开工程（无工程时在列表中标注提示） */
  needsProject?: boolean;
}

/** 顶级菜单 */
export interface MenuDef {
  label: string;
  /** codicon 名（渲染为 ThemeIcon） */
  icon: string;
  children: MenuItemDef[];
}

/** 叶子项图标（key = label；未收录则不显示图标） */
export const CHILD_ICONS: Record<string, string> = {
  'New Project…': 'file-add',
  'Open Project…': 'folder-opened',
  'Save File': 'save',
  'Save File As…': 'save-as',
  'Save All Files': 'save-all',
  'Close Editor': 'close',
  'Close All Files': 'close-all',
  'Quit': 'sign-out',
  'Undo': 'undo',
  'Redo': 'redo',
  'Toggle Comment': 'comment',
  'Fold All': 'fold',
  'Unfold All': 'unfold',
  'Toggle Fold': 'fold',
  'Duplicate': 'copy',
  'Project': 'project',
  'Analysis': 'graph',
  'Build Log': 'output',
  'Problems': 'error',
  'Terminal': 'terminal',
  'Full Screen': 'screen-full',
  'Reset View Layout': 'refresh',
  'Find…': 'search',
  'Find in Files…': 'search',
  'Replace…': 'replace',
  'Replace in Files…': 'replace',
  'TODO List': 'checklist',
  'Add Files…': 'add',
  'Move Project Up': 'arrow-up',
  'Move Project Down': 'arrow-down',
  'Build Options…': 'settings-gear',
  'Notes…': 'note',
  'Properties…': 'gear',
  'Build': 'package',
  'Compile Current File': 'run-above',
  'Run': 'play',
  'Build and Run': 'run',
  'Rebuild': 'sync',
  'Clean': 'trash',
  'Build Workspace': 'multiple-windows',
  'Rebuild Workspace': 'multiple-windows',
  'Clean Workspace': 'trash',
  'Abort': 'debug-stop',
  'Export compile_commands.json…': 'code',
  'Start / Continue': 'debug-start',
  'Break Debugger': 'debug-pause',
  'Stop Debugger': 'debug-stop',
  'Step Over': 'debug-step-over',
  'Step Into': 'debug-step-into',
  'Step Out': 'debug-step-out',
  'Detect Compilers…': 'search',
  'Code Statistics…': 'graph',
  'Format with AStyle': 'code',
  'Swap Header / Source': 'arrow-swap',
  'Insert Header Guard': 'shield',
  'Tidy Comments': 'wand',
  'Configure Tools…': 'settings-gear',
  'Show Compiler Commands…': 'terminal',
  'Export Makefile…': 'export',
  'Workspace Dependencies…': 'references',
  'Import Project…': 'cloud-download',
  'Default Config…': 'file-code',
  'Build & Log…': 'output',
  'clangd / IntelliSense…': 'lightbulb',
  'From Template…': 'library',
  'Save Project as Template…': 'save',
  'Debug Information': 'info',
  'Current Stack Frame': 'debug-stackframe',
  'Loaded Libraries': 'library',
  'Targets and Files': 'file',
  'FPU Status': 'symbol-numeric',
  'Signal Handling': 'bell',
};

/** 分隔线占位 */
const SEP: MenuItemDef = { label: '', separator: true };

/**
 * 菜单结构 —— 对齐 Code::Blocks 菜单栏
 * File/Edit/View/Search 参考 main_menu.xrc；Build 参考 compiler_menu.xrc；
 * Debug 参考 debugger_menu.xrc；Project 参考 projectmanagerui.cpp::CreateMenu。
 * 未移植项与差异见 docs/对齐对照.md「菜单对齐」。
 */
export const MENU_STRUCTURE: MenuDef[] = [
  {
    label: 'File',
    icon: 'file',
    children: [
      { label: 'New…', command: 'workbench.action.files.newUntitledFile' },
      { label: 'New Project…', command: 'codeblocks.newProject' },
      { label: 'From Template…', command: 'codeblocks.newProjectFromTemplate' },
      { label: 'Open Project…', command: 'codeblocks.openProject' },
      { label: 'Import Project…', command: 'codeblocks.importProject' },
      SEP,
      { label: 'Save File', command: 'workbench.action.files.save' },
      { label: 'Save File As…', command: 'workbench.action.files.saveAs' },
      { label: 'Save All Files', command: 'workbench.action.files.saveAll' },
      { label: 'Save Project as Template…', command: 'codeblocks.saveProjectAsTemplate', needsProject: true },
      SEP,
      { label: 'Close Editor', command: 'workbench.action.closeActiveEditor' },
      { label: 'Close All Files', command: 'workbench.action.closeAllEditors' },
      SEP,
      { label: 'Quit', command: 'workbench.action.quit' },
    ],
  },
  {
    label: 'Edit',
    icon: 'edit',
    children: [
      { label: 'Undo', command: 'undo' },
      { label: 'Redo', command: 'redo' },
      SEP,
      { label: 'Cut', command: 'editor.action.clipboardCutAction' },
      { label: 'Copy', command: 'editor.action.clipboardCopyAction' },
      { label: 'Paste', command: 'editor.action.clipboardPasteAction' },
      SEP,
      { label: 'Toggle Comment', command: 'editor.action.commentLine' },
      { label: 'Block Comment', command: 'editor.action.blockComment' },
      SEP,
      {
        label: 'Folding',
        children: [
          { label: 'Fold All', command: 'editor.foldAll' },
          { label: 'Unfold All', command: 'editor.unfoldAll' },
          { label: 'Toggle Fold', command: 'editor.toggleFold' },
        ],
      },
      {
        label: 'Case',
        children: [
          { label: 'Uppercase', command: 'editor.action.transformToUppercase' },
          { label: 'Lowercase', command: 'editor.action.transformToLowercase' },
        ],
      },
      {
        label: 'Line',
        children: [
          { label: 'Duplicate', command: 'editor.action.copyLinesDownAction' },
          { label: 'Move Up', command: 'editor.action.moveLinesUpAction' },
          { label: 'Move Down', command: 'editor.action.moveLinesDownAction' },
          { label: 'Delete', command: 'editor.action.deleteLines' },
        ],
      },
      SEP,
      { label: 'Select All', command: 'editor.action.selectAll' },
      { label: 'Select Next Occurrence', command: 'editor.action.addSelectionToNextFindMatch' },
      SEP,
      { label: 'Goto Matching Brace', command: 'editor.action.jumpToBracket' },
      SEP,
      {
        label: 'Bookmarks',
        children: [
          { label: 'Toggle Bookmark', command: 'codeblocks.bookmarks.toggle', shortcut: 'Alt+K' },
          { label: 'Previous Bookmark', command: 'codeblocks.bookmarks.prev', shortcut: 'Alt+H' },
          { label: 'Next Bookmark', command: 'codeblocks.bookmarks.next', shortcut: 'Alt+L' },
          SEP,
          { label: 'Clear All Bookmarks', command: 'codeblocks.bookmarks.clearAll' },
        ],
      },
      { label: 'Add Todo Item…', command: 'codeblocks.todo.add' },
      SEP,
      { label: 'Swap Header / Source', command: 'codeblocks.swapHeaderSource' },
      { label: 'Insert Header Guard', command: 'codeblocks.insertHeaderGuard' },
      { label: 'Tidy Comments', command: 'codeblocks.tidyComments' },
      SEP,
      { label: 'Encoding…', command: 'workbench.action.editor.changeEncoding' },
      { label: 'End of Line…', command: 'workbench.action.editor.changeEOL' },
      { label: 'Highlight Mode…', command: 'workbench.action.editor.changeLanguageMode' },
      { label: 'Parameter Hints', command: 'editor.action.triggerParameterHints' },
      SEP,
      { label: 'Find Next Selected', command: 'editor.action.nextSelectionMatchFindAction' },
      { label: 'Find Previous Selected', command: 'editor.action.previousSelectionMatchFindAction' },
      SEP,
      { label: 'Go to Previous Change', command: 'workbench.action.editor.previousChange' },
      { label: 'Go to Next Change', command: 'workbench.action.editor.nextChange' },
    ],
  },
  {
    label: 'View',
    icon: 'eye',
    children: [
      { label: 'Project', command: 'codeblocks.projectTree.focus', shortcut: 'Shift+F2' },
      { label: 'Symbols', command: 'codeblocks.symbols.focus' },
      { label: 'Analysis', command: 'codeblocks.analysis.focus' },
      { label: 'Build Log', command: 'codeblocks.buildLog.focus' },
      SEP,
      { label: 'Problems', command: 'workbench.actions.view.problems' },
      { label: 'Terminal', command: 'workbench.action.terminal.toggleTerminal' },
      SEP,
      { label: 'Full Screen', command: 'workbench.action.toggleFullScreen' },
      SEP,
      { label: 'Reset View Layout', command: 'codeblocks.resetViewLayout' },
    ],
  },
  {
    label: 'Search',
    icon: 'search',
    children: [
      { label: 'Find…', command: 'actions.find' },
      { label: 'Find in Files…', command: 'workbench.action.findInFiles' },
      { label: 'Find Next', command: 'editor.action.nextMatchFindAction' },
      { label: 'Find Previous', command: 'editor.action.previousMatchFindAction' },
      SEP,
      { label: 'Replace…', command: 'editor.action.startFindReplaceAction' },
      { label: 'Replace in Files…', command: 'workbench.action.replaceInFiles', shortcut: 'Ctrl+Shift+R' },
      SEP,
      { label: 'Goto Line…', command: 'workbench.action.gotoLine' },
      { label: 'Goto File…', command: 'workbench.action.quickOpen', shortcut: 'Alt+G' },
      SEP,
      { label: 'TODO List', command: 'codeblocks.todoList' },
      { label: 'Open Include File…', command: 'codeblocks.openIncludeFile' },
    ],
  },
  {
    label: 'Project',
    icon: 'package',
    children: [
      { label: 'Add Files…', command: 'codeblocks.addFile', needsProject: true },
      SEP,
      {
        label: 'Project tree',
        children: [
          { label: 'Move Project Up', command: 'codeblocks.moveProjectUp', shortcut: 'Ctrl+Shift+Up', needsProject: true },
          { label: 'Move Project Down', command: 'codeblocks.moveProjectDown', shortcut: 'Ctrl+Shift+Down', needsProject: true },
          SEP,
          { label: 'Activate Prior Project', command: 'codeblocks.activatePriorProject', shortcut: 'Alt+F5', needsProject: true },
          { label: 'Activate Next Project', command: 'codeblocks.activateNextProject', shortcut: 'Alt+F6', needsProject: true },
          SEP,
          { label: 'Categorize by File Types', command: 'codeblocks.toggleCategorize' },
        ],
      },
      SEP,
      { label: 'Build Options…', command: 'codeblocks.compilerOptions', needsProject: true },
      { label: 'Notes…', command: 'codeblocks.projectNotes', needsProject: true },
      { label: "Set Programs' Arguments…", command: 'codeblocks.setProgramArguments', needsProject: true },
      SEP,
      { label: 'Workspace Dependencies…', command: 'codeblocks.workspace.editDependencies', needsProject: true },
      { label: 'Create Project from Target…', command: 'codeblocks.exportTargetAsProject', needsProject: true },
      { label: 'Properties…', command: 'codeblocks.projectProperties', needsProject: true },
    ],
  },
  {
    label: 'Build',
    icon: 'tools',
    children: [
      { label: 'Build', command: 'codeblocks.build', shortcut: 'Ctrl+F9', needsProject: true },
      { label: 'Compile Current File', command: 'codeblocks.compileCurrentFile', shortcut: 'Ctrl+Shift+F9' },
      { label: 'Run', command: 'codeblocks.run', shortcut: 'Ctrl+F10', needsProject: true },
      { label: 'Build and Run', command: 'codeblocks.buildAndRun', shortcut: 'F9', needsProject: true },
      { label: 'Rebuild', command: 'codeblocks.rebuild', shortcut: 'Ctrl+F11', needsProject: true },
      { label: 'Clean', command: 'codeblocks.clean', needsProject: true },
      SEP,
      { label: 'Build Workspace', command: 'codeblocks.buildWorkspace', needsProject: true },
      { label: 'Rebuild Workspace', command: 'codeblocks.rebuildWorkspace', needsProject: true },
      { label: 'Clean Workspace', command: 'codeblocks.cleanWorkspace', needsProject: true },
      SEP,
      { label: 'Abort', command: 'codeblocks.build.stop' },
      SEP,
      {
        label: 'Errors',
        children: [
          { label: 'Previous Error', command: 'codeblocks.prevError', shortcut: 'Shift+F4 / Alt+F1' },
          { label: 'Next Error', command: 'codeblocks.nextError', shortcut: 'F4 / Alt+F2' },
          SEP,
          { label: 'Clear All Errors', command: 'codeblocks.clearErrors' },
        ],
      },
      { label: 'Select Target…', command: 'codeblocks.selectTarget', needsProject: true },
      SEP,
      { label: 'Export compile_commands.json…', command: 'codeblocks.generateCompileCommands' },
    ],
  },
  {
    label: 'Debug',
    icon: 'bug',
    children: [
      { label: 'Start / Continue', command: 'codeblocks.debug', shortcut: 'F8', needsProject: true },
      SEP,
      { label: 'Break Debugger', command: 'workbench.action.debug.pause' },
      { label: 'Stop Debugger', command: 'workbench.action.debug.stop' },
      SEP,
      { label: 'Step Over', command: 'workbench.action.debug.stepOver' },
      { label: 'Step Into', command: 'workbench.action.debug.stepInto' },
      { label: 'Step Out', command: 'workbench.action.debug.stepOut' },
      SEP,
      { label: 'Toggle Breakpoint', command: 'editor.debug.action.toggleBreakpoint' },
      SEP,
      {
        label: 'Debug Information',
        children: [
          { label: 'Current Stack Frame', command: 'codeblocks.debug.infoFrame' },
          { label: 'Loaded Libraries', command: 'codeblocks.debug.infoSharedLibrary' },
          { label: 'Targets and Files', command: 'codeblocks.debug.infoFiles' },
          { label: 'FPU Status', command: 'codeblocks.debug.infoFloat' },
          { label: 'Signal Handling', command: 'codeblocks.debug.infoSignals' },
        ],
      },
      SEP,
      { label: 'Run and Debug View', command: 'workbench.view.debug' },
    ],
  },
  {
    label: 'Tools',
    icon: 'wrench',
    children: [
      { label: 'Detect Compilers…', command: 'codeblocks.detectCompilers' },
      { label: 'Code Statistics…', command: 'codeblocks.codeStats' },
      { label: 'Format with AStyle', command: 'codeblocks.format' },
      SEP,
      { label: 'Show Compiler Commands…', command: 'codeblocks.showCompilerCommands' },
      { label: 'Export Makefile…', command: 'codeblocks.exportMakefile', needsProject: true },
      SEP,
      { label: 'Configure Tools…', command: 'codeblocks.configureTools' },
      // 用户自定义工具（codeblocks.tools）由 statusBarMenu.ts 按设置动态追加在本菜单末尾
    ],
  },
  {
    label: 'Settings',
    icon: 'gear',
    children: [
      { label: 'Environment…', command: 'workbench.action.openSettings', args: ['@ext:robinmaomao.codeblocks-vscode'] },
      { label: 'Editor…', command: 'workbench.action.openSettings', args: ['editor.'] },
      { label: 'Compiler…', command: 'workbench.action.openSettings', args: ['codeblocks.masterPath'] },
      { label: 'Build & Log…', command: 'workbench.action.openSettings', args: ['codeblocks.build'] },
      { label: 'Debugger…', command: 'workbench.action.openSettings', args: ['codeblocks.gdb'] },
      { label: 'clangd / IntelliSense…', command: 'workbench.action.openSettings', args: ['codeblocks.clangd'] },
      SEP,
      { label: 'Keybindings…', command: 'codeblocks.keybindings.panel' },
      { label: 'Global Variables…', command: 'codeblocks.showGlobalVariables' },
      { label: 'Default Config…', command: 'codeblocks.openDefaultConfig' },
      { label: 'Backtick Cache (Clear)', command: 'codeblocks.clearBacktickCache' },
    ],
  },
];

/** 悬停就地菜单分组（label 引用 MENU_STRUCTURE，单一数据源） */
export const HOVER_GROUPS: string[][] = [
  ['New Project…', 'Open Project…'],
  ['Build', 'Rebuild', 'Clean', 'Run', 'Start / Continue'],
  ['Build Workspace', 'Rebuild Workspace', 'Clean Workspace'],
  ['Properties…', 'Build Options…', 'Code Statistics…'],
];

/** 深度优先遍历全部菜单项（含子菜单，不含分隔线） */
export function walkMenuItems(): MenuItemDef[] {
  const out: MenuItemDef[] = [];
  const visit = (items: MenuItemDef[]): void => {
    for (const it of items) {
      if (it.separator) continue;
      out.push(it);
      if (it.children) visit(it.children);
    }
  };
  for (const m of MENU_STRUCTURE) visit(m.children);
  return out;
}

/** 按 label 查找菜单项（含子菜单；label 全局唯一由回归测试保证） */
export function findMenuItem(label: string): MenuItemDef | undefined {
  return walkMenuItems().find((it) => it.label === label);
}
