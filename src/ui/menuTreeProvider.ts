/**
 * 菜单树视图 —— 模拟 Code::Blocks 菜单栏（File/Edit/View/...）
 *
 * 使用 TreeDataProvider 展示菜单层级，叶子节点点击后执行对应命令。
 * File/Edit 等编辑类菜单映射 VS Code 内建命令；Build/Debug/Tools 映射扩展命令。
 */
import * as vscode from 'vscode';

/** 菜单项定义 */
interface MenuItemDef {
  /** 显示名称 */
  label: string;
  /** 执行的命令（叶子项必填，父菜单可省略） */
  command?: string;
  /** 命令参数 */
  args?: unknown[];
  /** 子菜单 */
  children?: MenuItemDef[];
}

class MenuNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly children: MenuNode[] = [],
  ) {
    super(label, collapsibleState);
  }
}

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

export class MenuTreeProvider implements vscode.TreeDataProvider<MenuNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MenuNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private rootNodes: MenuNode[];

  constructor() {
    this.rootNodes = MENU_STRUCTURE.map((m) => this.buildNode(m));
  }

  private buildNode(def: MenuItemDef): MenuNode {
    const children = (def.children ?? []).map((c) => this.buildNode(c));
    const collapsible = children.length
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;

    const node = new MenuNode(def.label, collapsible, children);
    if (def.command) {
      node.command = {
        command: def.command,
        title: def.label,
        arguments: def.args,
      };
    }
    return node;
  }

  getTreeItem(element: MenuNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MenuNode): MenuNode[] {
    return element ? element.children : this.rootNodes;
  }
}
