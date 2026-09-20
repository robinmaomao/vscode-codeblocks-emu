/**
 * 项目树视图 —— 对应 Code::Blocks 的项目树（虚拟文件夹结构）
 *
 * 使用 TreeDataProvider 展示多个 cbProject 的文件树（含虚拟文件夹），
 * 根节点为各项目，支持通过拖拽调整项目顺序（即编译顺序）。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
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
    public readonly file?: ProjectFile,
  ) {
    super(label, collapsibleState);
    if (kind === 'file') {
      this.command = {
        command: 'vscode.open',
        title: '打开文件',
        arguments: [resourceUri],
      };
      // contextValue 编码 compile/link 状态，供右键菜单区分勾选状态
      // 组合：file | file-nocompile | file-nolink | file-nocompile-nolink
      const c = file?.compile !== false;
      const l = file?.link !== false;
      this.contextValue = 'file' + (c ? '' : '-nocompile') + (l ? '' : '-nolink');
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
  /** 当前活动项目（用于高亮标识） */
  private activeProject: Project | undefined;
  readonly dragAndDropController = new ProjectDragAndDropController();

  /** 活动/非活动项目图标（自定义 SVG，保证颜色可靠渲染） */
  private activeIconPath?: vscode.Uri;
  private inactiveIconPath?: vscode.Uri;

  /** 设置资源根目录（用于加载图标） */
  setResourcesDir(dir: string): void {
    this.activeIconPath = vscode.Uri.joinPath(vscode.Uri.file(dir), 'project-active.svg');
    this.inactiveIconPath = vscode.Uri.joinPath(vscode.Uri.file(dir), 'project-inactive.svg');
  }

  setProjects(projects: Project[]): void {
    this.projects = projects;
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 设置活动项目（树中高亮） */
  setActiveProject(project: Project | undefined): void {
    this.activeProject = project;
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
        // 活动项目高亮：实心绿点；非活动：空心灰点（自定义 SVG，颜色可靠）
        if (p.filename === this.activeProject?.filename) {
          node.iconPath = this.activeIconPath ?? new vscode.ThemeIcon('circle-filled');
        } else {
          node.iconPath = this.inactiveIconPath ?? new vscode.ThemeIcon('circle-outline');
        }
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

  /** 构建文件树节点（逐层嵌套目录树，参考 VSCode Explorer） */
  private buildFileNodes(project: Project): TreeNode[] {
    const dirNodes = new Map<string, TreeNode>(); // key: 目录完整相对路径（无 ../），value: 节点
    const rootDirs: TreeNode[] = [];
    const rootFiles: TreeNode[] = [];

    for (const f of project.files) {
      // 折叠 ../ 前缀，得到干净的相对路径（如 ../../platform/bsp/x.c → platform/bsp/x.c）
      const clean = cleanRelativePath(f.relativeFilename);
      const segs = clean.split('/');
      const fileNode = this.fileToNode(project, f);

      // 无目录段 → 根级文件
      if (segs.length === 1) {
        rootFiles.push(fileNode);
        continue;
      }

      // 逐层构建目录节点
      let parentNode: TreeNode | undefined;
      let parentKey = '';
      for (let i = 0; i < segs.length - 1; i++) {
        const key = parentKey ? `${parentKey}/${segs[i]}` : segs[i];
        let dirNode = dirNodes.get(key);
        if (!dirNode) {
          dirNode = new TreeNode(segs[i], vscode.TreeItemCollapsibleState.Collapsed, 'folder', project);
          dirNode.iconPath = new vscode.ThemeIcon('folder');
          dirNode.tooltip = key;
          dirNodes.set(key, dirNode);
          if (parentNode) {
            parentNode.children.push(dirNode);
          } else {
            rootDirs.push(dirNode);
          }
        }
        parentNode = dirNode;
        parentKey = key;
      }
      parentNode!.children.push(fileNode);
    }

    // 每层目录内：子目录在前、文件在后，各自按名称排序（对齐 Explorer）
    for (const d of dirNodes.values()) {
      d.children.sort((a, b) => {
        const aIsDir = a.kind === 'folder' ? 0 : 1;
        const bIsDir = b.kind === 'folder' ? 0 : 1;
        if (aIsDir !== bIsDir) return aIsDir - bIsDir;
        return a.label.localeCompare(b.label);
      });
    }
    rootDirs.sort((a, b) => a.label.localeCompare(b.label));
    rootFiles.sort((a, b) => a.label.localeCompare(b.label));
    return [...rootDirs, ...rootFiles];
  }

  private fileToNode(project: Project, f: ProjectFile): TreeNode {
    const uri = vscode.Uri.file(f.absolutePath);
    const node = new TreeNode(
      path.basename(f.relativeFilename),
      vscode.TreeItemCollapsibleState.None,
      'file',
      project,
      uri,
      undefined,
      f,
    );
    // 文件图标按扩展名区分（对应 cbProjectTreeImages）
    const ext = path.extname(f.relativeFilename).toLowerCase();
    node.iconPath = this.fileIcon(ext);
    // 文件状态：缺失文件标记（对应 ProjectFile::fvsMissing）
    if (!fs.existsSync(f.absolutePath)) {
      node.description = '缺失';
    }
    return node;
  }

  /** 按扩展名返回文件图标 */
  private fileIcon(ext: string): vscode.ThemeIcon {
    switch (ext) {
      case '.c': return new vscode.ThemeIcon('symbol-field');
      case '.h':
      case '.hpp':
      case '.hh': return new vscode.ThemeIcon('symbol-namespace');
      case '.cpp':
      case '.cc':
      case '.cxx': return new vscode.ThemeIcon('symbol-method');
      case '.rc': return new vscode.ThemeIcon('symbol-ruler');
      case '.s':
      case '.S': return new vscode.ThemeIcon('symbol-key');
      default: return new vscode.ThemeIcon('file');
    }
  }
}

/** 折叠相对路径开头的 ../ 前缀（../../platform/bsp → platform/bsp；message/a.c → message/a.c） */
function cleanRelativePath(rel: string): string {
  const norm = rel.replace(/\\/g, '/');
  // 去掉所有开头的 ../（或 ./）
  const stripped = norm.replace(/^(\.\.\/)+|^(\.\/)+/, '');
  return stripped;
}
