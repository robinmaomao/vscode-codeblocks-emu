/**
 * Symbols 符号浏览视图 —— 对应 Code::Blocks 的 Symbols 面板（codecompletion/classbrowser）。
 *
 * 基于 SymbolIndex（轻量词法索引）按类别分组展示当前项目的符号：
 * 函数 / 宏 / 类型 / 变量，点击节点跳转到定义位置。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { SymbolIndex, SymbolEntry } from '../tools/codeCompletion';

/** 符号分组类别 */
type SymbolGroupKind = 'function' | 'macro' | 'type' | 'variable' | 'other';

interface GroupDef {
  kind: SymbolGroupKind;
  label: string;
  icon: string; // codicon
}

const GROUPS: GroupDef[] = [
  { kind: 'function', label: '函数', icon: 'symbol-function' },
  { kind: 'macro', label: '宏', icon: 'symbol-constant' },
  { kind: 'type', label: '类型', icon: 'symbol-struct' },
  { kind: 'variable', label: '变量', icon: 'symbol-variable' },
  { kind: 'other', label: '其它', icon: 'symbol-misc' },
];

function groupOf(e: SymbolEntry): SymbolGroupKind {
  switch (e.kind) {
    case vscode.CompletionItemKind.Function:
    case vscode.CompletionItemKind.Method:
      return 'function';
    case vscode.CompletionItemKind.Constant:
      return 'macro';
    case vscode.CompletionItemKind.Struct:
    case vscode.CompletionItemKind.Class:
    case vscode.CompletionItemKind.Enum:
    case vscode.CompletionItemKind.TypeParameter:
      return 'type';
    case vscode.CompletionItemKind.Variable:
    case vscode.CompletionItemKind.Field:
      return 'variable';
    default:
      return 'other';
  }
}

class SymbolNode extends vscode.TreeItem {
  declare children: SymbolNode[];

  constructor(
    public readonly isGroup: boolean,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    icon: string,
  ) {
    super(label, collapsible);
    this.iconPath = new vscode.ThemeIcon(icon);
    this.children = [];
  }
}

export class SymbolTreeProvider implements vscode.TreeDataProvider<SymbolNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SymbolNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private index: SymbolIndex | undefined;

  /** 设置符号索引数据源 */
  setIndex(index: SymbolIndex | undefined): void {
    this.index = index;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 索引内容变化后刷新（如项目增删/重建） */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SymbolNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SymbolNode): SymbolNode[] {
    if (!this.index) return [];
    if (!element) return this.buildGroups();
    return element.children;
  }

  private buildGroups(): SymbolNode[] {
    const entries = this.index!.allEntries();
    // 按类别分组（保持 GROUPS 声明顺序）
    const buckets = new Map<SymbolGroupKind, SymbolEntry[]>();
    for (const g of GROUPS) buckets.set(g.kind, []);
    for (const e of entries) {
      buckets.get(groupOf(e))!.push(e);
    }

    const nodes: SymbolNode[] = [];
    for (const g of GROUPS) {
      const list = buckets.get(g.kind)!;
      if (list.length === 0) continue;
      // 组内按名称排序
      list.sort((a, b) => a.name.localeCompare(b.name));
      const group = new SymbolNode(
        true,
        `${g.label} (${list.length})`,
        vscode.TreeItemCollapsibleState.Collapsed,
        g.icon,
      );
      group.children = list.map((e) => this.buildLeaf(e));
      nodes.push(group);
    }
    return nodes;
  }

  private buildLeaf(e: SymbolEntry): SymbolNode {
    const basename = path.basename(e.file);
    const node = new SymbolNode(
      false,
      e.name,
      vscode.TreeItemCollapsibleState.None,
      this.leafIcon(e),
    );
    node.description = `${basename}:${e.line}`;
    node.tooltip = e.detail ? `${e.detail}\n${e.file}:${e.line}` : `${e.file}:${e.line}`;
    node.command = {
      command: 'vscode.open',
      title: '打开符号定义',
      arguments: [
        vscode.Uri.file(e.file),
        { selection: new vscode.Range(e.line - 1, 0, e.line - 1, 0), preview: true },
      ],
    };
    return node;
  }

  private leafIcon(e: SymbolEntry): string {
    switch (e.kind) {
      case vscode.CompletionItemKind.Function:
      case vscode.CompletionItemKind.Method:
        return 'symbol-function';
      case vscode.CompletionItemKind.Constant:
        return 'symbol-constant';
      case vscode.CompletionItemKind.Enum:
        return 'symbol-enum';
      case vscode.CompletionItemKind.Class:
        return 'symbol-class';
      case vscode.CompletionItemKind.Struct:
        return 'symbol-struct';
      case vscode.CompletionItemKind.Variable:
      case vscode.CompletionItemKind.Field:
        return 'symbol-variable';
      default:
        return 'symbol-misc';
    }
  }
}
