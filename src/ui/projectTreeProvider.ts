/**
 * 项目树视图 —— 对应 Code::Blocks 的项目树（虚拟文件夹结构）
 *
 * 使用 TreeDataProvider 展示多个 cbProject 的文件树（含虚拟文件夹），
 * 根节点为各项目，支持通过拖拽调整项目顺序（即编译顺序）。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { Project, ProjectFile } from '../model/types';

/** 树节点 */
class TreeNode extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: 'project' | 'target' | 'folder' | 'file',
    public readonly project?: Project,
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
    } else if (kind === 'project') {
      this.contextValue = 'project';
      this.command = {
        command: 'codeblocks.setActiveProject',
        title: '设为活动项目',
        arguments: [project?.filename],
      };
    }
  }
}

/** 拖拽控制器：仅支持项目节点（根级）排序 */
class ProjectDragAndDropController implements vscode.TreeDragAndDropController<TreeNode> {
  dropMimeTypes = ['application/vnd.code.tree.codeblocks'];
  dragMimeTypes = ['application/vnd.code.tree.codeblocks'];

  /** 重排回调：把 sourceFilename 移到 targetFilename 之前（target 为空则移到最后） */
  onReorder: ((sourceFilename: string, targetFilename: string | undefined) => void) | undefined;

  handleDrag(source: TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const projectNode = source.find((n) => n.kind === 'project');
    if (projectNode?.project) {
      dataTransfer.set('application/vnd.code.tree.codeblocks', new vscode.DataTransferItem(projectNode.project.filename));
    }
  }

  handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): void {
    const filename = dataTransfer.get('application/vnd.code.tree.codeblocks')?.value;
    if (typeof filename !== 'string' || !filename) return;
    // 只允许拖到项目节点上（或根，即放在末尾）
    if (target && target.kind !== 'project') return;
    this.onReorder?.(filename, target?.project?.filename);
  }
}

export class ProjectTreeProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: Project[] = [];
  readonly dragAndDropController = new ProjectDragAndDropController();

  setProjects(projects: Project[]): void {
    this.projects = projects;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // 根：所有项目节点（顺序即编译顺序）
      // 参考 Code::Blocks 的 project->GetTitle() 语义取「项目名」，
      // 但当 .cbp 的 <Option title> 不足以区分（如多个 app.cbp）时，
      // 用 .cbp 所在目录名（如 earphone / esop8）作为项目显示名。
      return this.projects.map((p) => {
        const dirName = path.basename(path.dirname(p.filename));
        const node = new TreeNode(
          dirName || p.title,
          vscode.TreeItemCollapsibleState.Expanded,
          'project',
          p,
        );
        node.description = path.basename(p.filename);
        node.tooltip = p.filename;
        return node;
      });
    }

    if (element.kind === 'project') {
      const project = element.project!;
      const nodes: TreeNode[] = [];
      for (const target of project.buildTargets) {
        nodes.push(
          new TreeNode(
            `▶ ${target.title}`,
            vscode.TreeItemCollapsibleState.Collapsed,
            'target',
            project,
          ),
        );
      }
      nodes.push(...this.buildFileNodes(project));
      return nodes;
    }

    if (element.kind === 'target') {
      const targetName = element.label.replace(/^▶ /, '');
      const project = element.project!;
      const target = project.buildTargets.find((t) => t.title === targetName);
      if (!target) return [];
      return target.files.map((f) => this.fileToNode(project, f));
    }

    if (element.kind === 'folder') {
      return element.children;
    }

    return [];
  }

  /** 构建文件树节点（含虚拟文件夹分组） */
  private buildFileNodes(project: Project): TreeNode[] {
    const files = project.files;
    const rootFiles: TreeNode[] = [];
    const dirMap = new Map<string, TreeNode>();

    for (const f of files) {
      const dir = path.dirname(f.relativeFilename);
      if (dir === '.') {
        rootFiles.push(this.fileToNode(project, f));
      } else {
        if (!dirMap.has(dir)) {
          const dirNode = new TreeNode(dir, vscode.TreeItemCollapsibleState.Collapsed, 'folder', project);
          dirMap.set(dir, dirNode);
        }
        dirMap.get(dir)!.children.push(this.fileToNode(project, f));
      }
    }

    return [...rootFiles, ...Array.from(dirMap.values())];
  }

  private fileToNode(project: Project, f: ProjectFile): TreeNode {
    const uri = vscode.Uri.file(f.absolutePath);
    return new TreeNode(
      path.basename(f.relativeFilename),
      vscode.TreeItemCollapsibleState.None,
      'file',
      project,
      uri,
    );
  }
}
