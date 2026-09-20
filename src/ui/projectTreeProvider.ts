/**
 * 项目树视图 —— 对应 Code::Blocks 的项目树（虚拟文件夹结构）
 *
 * 使用 TreeDataProvider 展示 cbProject 的文件树（含虚拟文件夹）。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { Project, BuildTarget, ProjectFile } from '../model/types';

/** 树节点 */
class TreeNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: 'project' | 'target' | 'folder' | 'file',
    public readonly resourceUri?: vscode.Uri,
    public readonly children: TreeNode[] = [],
  ) {
    super(label, collapsibleState);
    if (kind === 'file') {
      this.command = {
        command: 'vscode.open',
        title: '打开文件',
        arguments: [resourceUri],
      };
      this.contextValue = 'file';
    }
  }
}

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private project: Project | undefined;

  setProject(project: Project | undefined): void {
    this.project = project;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!this.project) return [];

    if (!element) {
      // 根：项目节点
      return [
        new TreeNode(
          this.project.title,
          vscode.TreeItemCollapsibleState.Expanded,
          'project',
        ),
      ];
    }

    if (element.kind === 'project') {
      // 项目下：构建目标 + 虚拟文件夹 + 根文件
      const nodes: TreeNode[] = [];

      // 构建目标节点
      for (const target of this.project.buildTargets) {
        nodes.push(
          new TreeNode(
            `▶ ${target.title}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            'target',
          ),
        );
      }

      // 文件（按虚拟文件夹分组）
      nodes.push(...this.buildFileNodes());
      return nodes;
    }

    if (element.kind === 'target') {
      // 目标下的文件
      const targetName = element.label.replace(/^▶ /, '');
      const target = this.project.buildTargets.find((t) => t.title === targetName);
      if (!target) return [];
      return target.files.map((f) => this.fileToNode(f));
    }

    if (element.kind === 'folder') {
      return element.children;
    }

    return [];
  }

  /** 构建文件树节点（含虚拟文件夹分组） */
  private buildFileNodes(): TreeNode[] {
    const files = this.project!.files;
    // 简单分组：按目录层级
    const rootFiles: TreeNode[] = [];
    const dirMap = new Map<string, TreeNode>();

    for (const f of files) {
      const dir = path.dirname(f.relativeFilename);
      if (dir === '.') {
        rootFiles.push(this.fileToNode(f));
      } else {
        if (!dirMap.has(dir)) {
          const dirNode = new TreeNode(dir, vscode.TreeItemCollapsibleState.Collapsed, 'folder');
          dirMap.set(dir, dirNode);
        }
        dirMap.get(dir)!.children.push(this.fileToNode(f));
      }
    }

    // 目录节点也加入根
    return [...rootFiles, ...Array.from(dirMap.values())];
  }

  private fileToNode(f: ProjectFile): TreeNode {
    const uri = vscode.Uri.file(f.absolutePath);
    return new TreeNode(
      path.basename(f.relativeFilename),
      vscode.TreeItemCollapsibleState.None,
      'file',
      uri,
    );
  }
}
