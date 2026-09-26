/**
 * 状态栏菜单 —— Code::Blocks 菜单栏移植
 *
 * 在 VS Code 状态栏最左侧放置 `$(menu) Menu` 项；点击后两级 QuickPick：
 * 第一级选择菜单（Workspace / Recent Projects / File / Edit / View / …），
 * 第二级选择具体命令，选中后执行对应命令。
 * 菜单结构对齐 Code::Blocks 菜单栏（见 docs/对齐对照.md）。
 */
import * as vscode from 'vscode';
import * as path from 'path';

/** 菜单项定义 */
export interface MenuItemDef {
  /** 显示名称 */
  label: string;
  /** 执行的命令（叶子项必填，父菜单可省略） */
  command?: string;
  /** 命令参数 */
  args?: unknown[];
  /** 子菜单 */
  children?: MenuItemDef[];
}

/** 动态区数据（最近工程 + 工作区构建顺序，E1/E2） */
export interface MenuDynamicData {
  recents: { label: string; file: string }[];
  order: { label: string; file: string }[];
}

/** 顶级菜单图标 */
const MENU_ICONS: Record<string, string> = {
  'File': 'file',
  'Edit': 'edit',
  'View': 'eye',
  'Search': 'search',
  'Project': 'package',
  'Build': 'tools',
  'Debug': 'bug',
  'Tools': 'wrench',
  'Settings': 'gear',
};

/** 子项图标（叶子命令） */
const CHILD_ICONS: Record<string, string> = {
  'New Project…': 'file-add',
  'Open Project…': 'folder-opened',
  'Save File': 'save',
  'Build': 'package',
  'Rebuild': 'sync',
  'Clean': 'trash',
  'Build and Run': 'run',
  'Run': 'play',
  'Start / Continue': 'debug-start',
  'Detect Compilers…': 'search',
  'Code Statistics…': 'graph',
  'Format with AStyle': 'code',
  'Compiler Options…': 'settings-gear',
  'Find in Files…': 'search',
  'TODO List': 'checklist',
};

/** 菜单结构 —— 对齐 Code::Blocks 菜单栏 */
const MENU_STRUCTURE: MenuItemDef[] = [
  {
    label: 'File',
    children: [
      { label: 'New…', command: 'workbench.action.files.newUntitledFile' },
      { label: 'New Project…', command: 'codeblocks.newProject' },
      { label: 'Open Project…', command: 'codeblocks.openProject' },
      { label: 'Save File', command: 'workbench.action.files.save' },
      { label: 'Save All Files', command: 'workbench.action.files.saveAll' },
      { label: 'Close Editor', command: 'workbench.action.closeActiveEditor' },
    ],
  },
  {
    label: 'Edit',
    children: [
      { label: 'Undo', command: 'undo' },
      { label: 'Redo', command: 'redo' },
      { label: 'Cut', command: 'editor.action.clipboardCutAction' },
      { label: 'Copy', command: 'editor.action.clipboardCopyAction' },
      { label: 'Paste', command: 'editor.action.clipboardPasteAction' },
      { label: 'Select All', command: 'editor.action.selectAll' },
      { label: 'Find…', command: 'actions.find' },
      { label: 'Replace…', command: 'editor.action.startFindReplaceAction' },
    ],
  },
  {
    label: 'View',
    children: [
      { label: 'Project', command: 'codeblocks.projectTree.focus' },
      { label: 'Build Log', command: 'codeblocks.buildLog.focus' },
    ],
  },
  {
    label: 'Search',
    children: [
      { label: 'Find in Files…', command: 'workbench.action.findInFiles' },
      { label: 'TODO List', command: 'codeblocks.todoList' },
    ],
  },
  {
    label: 'Project',
    children: [
      { label: 'Open Project…', command: 'codeblocks.openProject' },
      { label: 'Properties…', command: 'codeblocks.projectProperties' },
      { label: 'Select Build Target…', command: 'codeblocks.selectTarget' },
      { label: 'Build Options…', command: 'codeblocks.compilerOptions' },
    ],
  },
  {
    label: 'Build',
    children: [
      { label: 'Build', command: 'codeblocks.build' },
      { label: 'Rebuild', command: 'codeblocks.rebuild' },
      { label: 'Clean', command: 'codeblocks.clean' },
      { label: 'Build and Run', command: 'codeblocks.buildAndRun' },
      { label: 'Run', command: 'codeblocks.run' },
    ],
  },
  {
    label: 'Debug',
    children: [
      { label: 'Start / Continue', command: 'codeblocks.debug' },
    ],
  },
  {
    label: 'Tools',
    children: [
      { label: 'Detect Compilers…', command: 'codeblocks.detectCompilers' },
      { label: 'Code Statistics…', command: 'codeblocks.codeStats' },
      { label: 'Format with AStyle', command: 'codeblocks.format' },
    ],
  },
  {
    label: 'Settings',
    children: [
      { label: 'Compiler Options…', command: 'codeblocks.compilerOptions' },
    ],
  },
];

/** 第一级列表项 */
interface MenuPick extends vscode.QuickPickItem {
  kindTag: 'menu' | 'recent' | 'workspace';
  menu?: MenuItemDef;
}

/** 悬停就地菜单：tooltip 中的可点击命令链接（一级平铺常用命令；点击状态栏项仍打开完整两级菜单） */
function buildHoverMenu(): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  const link = (icon: string, label: string, command: string): string => `[${icon} ${label}](command:${command})`;
  const group = (...links: string[]): string => links.join('　');
  md.value = [
    '**Code::Blocks 菜单**',
    group(
      link('$(new-file)', '新建工程', 'codeblocks.newProject'),
      link('$(folder-opened)', '打开工程', 'codeblocks.openProject'),
    ),
    group(
      link('$(package)', 'Build', 'codeblocks.build'),
      link('$(sync)', 'Rebuild', 'codeblocks.rebuild'),
      link('$(trash)', 'Clean', 'codeblocks.clean'),
      link('$(play)', 'Run', 'codeblocks.run'),
      link('$(debug-alt)', 'Debug', 'codeblocks.debug'),
    ),
    group(
      link('$(tools)', 'Build Workspace', 'codeblocks.buildWorkspace'),
      link('$(tools)', 'Rebuild Workspace', 'codeblocks.rebuildWorkspace'),
    ),
    group(
      link('$(gear)', '工程属性', 'codeblocks.projectProperties'),
      link('$(settings-gear)', '编译器选项', 'codeblocks.compilerOptions'),
      link('$(graph)', '代码统计', 'codeblocks.codeStats'),
    ),
    '点击状态栏项打开完整菜单（两级列表）',
  ].join('\n\n');
  return md;
}

/**
 * 注册状态栏菜单：最左状态栏项 + 两级 QuickPick。
 * @param getDynamic 按需拉取动态区数据（最近工程 / 工作区构建顺序）
 */
export function registerStatusBarMenu(
  context: vscode.ExtensionContext,
  getDynamic: () => MenuDynamicData,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  item.text = '$(menu) Menu';
  item.tooltip = buildHoverMenu();
  item.command = 'codeblocks.menu.show';
  item.show();

  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.menu.show', async () => {
      const dyn = getDynamic();

      // 第一级：选择菜单 / 动态入口
      const firstLevel: MenuPick[] = [];
      if (dyn.order.length) {
        firstLevel.push({
          label: 'Workspace',
          kindTag: 'workspace',
          description: '构建顺序',
          iconPath: new vscode.ThemeIcon('layers'),
        });
      }
      if (dyn.recents.length) {
        firstLevel.push({
          label: 'Recent Projects',
          kindTag: 'recent',
          description: `${dyn.recents.length} 个`,
          iconPath: new vscode.ThemeIcon('history'),
        });
      }
      for (const m of MENU_STRUCTURE) {
        const icon = MENU_ICONS[m.label];
        firstLevel.push({
          label: m.label,
          kindTag: 'menu',
          menu: m,
          iconPath: icon ? new vscode.ThemeIcon(icon) : undefined,
        });
      }

      const picked = await vscode.window.showQuickPick(firstLevel, {
        placeHolder: 'Code::Blocks 菜单 — 选择菜单',
      });
      if (!picked) return;

      // 第二级：动态区
      if (picked.kindTag === 'recent') {
        const sel = await vscode.window.showQuickPick(
          dyn.recents.map((r) => ({ label: r.label, description: path.dirname(r.file), file: r.file })),
          { placeHolder: 'Recent Projects — 打开工程' },
        );
        if (sel) await vscode.commands.executeCommand('codeblocks.openRecentProject', sel.file);
        return;
      }
      if (picked.kindTag === 'workspace') {
        const sel = await vscode.window.showQuickPick(
          dyn.order.map((o) => ({ label: o.label, description: '设为活动项目', file: o.file })),
          { placeHolder: 'Workspace — 设为活动项目' },
        );
        if (sel) await vscode.commands.executeCommand('codeblocks.setActiveProject', sel.file);
        return;
      }

      // 第二级：普通菜单命令
      const menu = picked.menu;
      if (!menu) return;
      const items = (menu.children ?? [])
        .filter((c) => c.command)
        .map((c) => {
          const icon = CHILD_ICONS[c.label];
          return {
            label: c.label,
            iconPath: icon ? new vscode.ThemeIcon(icon) : undefined,
            def: c,
          };
        });
      const sel = await vscode.window.showQuickPick(items, {
        placeHolder: `${menu.label} — 选择命令`,
      });
      if (!sel?.def?.command) return;
      try {
        await vscode.commands.executeCommand(sel.def.command, ...(sel.def.args ?? []));
      } catch {
        vscode.window.showWarningMessage(`命令不可用: ${sel.def.command}`);
      }
    }),
  );

  return item;
}
