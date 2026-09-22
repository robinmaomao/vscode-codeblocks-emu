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
    public readonly kind: 'project' | 'folder' | 'file',
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
  /** 资源根目录（用于加载彩色树节点图标） */
  private resourcesDir?: vscode.Uri;
  /** 彩色图标缓存：key = icons/ 下文件名，value = URI */
  private iconCache = new Map<string, vscode.Uri>();

  /** 设置资源根目录（用于加载图标） */
  setResourcesDir(dir: string): void {
    this.resourcesDir = vscode.Uri.file(dir);
    this.activeIconPath = vscode.Uri.joinPath(this.resourcesDir, 'project-active.svg');
    this.inactiveIconPath = vscode.Uri.joinPath(this.resourcesDir, 'project-inactive.svg');
  }

  /** 取彩色图标 URI（缓存，未命中则回退 ThemeIcon 交给调用方处理） */
  private iconUri(name: string): vscode.Uri | undefined {
    if (!this.resourcesDir) return undefined;
    let uri = this.iconCache.get(name);
    if (!uri) {
      uri = vscode.Uri.joinPath(this.resourcesDir, 'icons', name);
      this.iconCache.set(name, uri);
    }
    return uri;
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
    // 项目节点图标在此实时计算：getTreeItem 每次渲染都会调用，拿到的是最新 activeProject，
    // 避免只在 getChildren 里算一次、切换活动工程时被 TreeView 节点复用缓存吞掉（绿点不更新）。
    if (element.kind === 'project') {
      const isActive = element.project?.filename === this.activeProject?.filename;
      element.iconPath = isActive
        ? (this.activeIconPath ?? new vscode.ThemeIcon('circle-filled'))
        : (this.inactiveIconPath ?? new vscode.ThemeIcon('circle-outline'));
    }
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
        // 稳定 id：让 TreeView 在刷新时能正确识别/复用项目节点，配合 getTreeItem 更新图标
        node.id = p.filename;
        node.description = path.basename(p.filename);
        node.tooltip = p.filename;
        return node;
      });
    }

    if (element.kind === 'project') {
      // 参考 Code::Blocks BuildProjectTree()：项目节点下直接挂文件目录树，
      // 不含构建目标（Debug/Release）节点。
      return this.buildFileNodes(element.project!);
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
      // 使用相对「公共顶层目录」的路径（对应 Code::Blocks 的 relativeToCommonTopLevelPath），
      // 按实际工程目录层级展开；为空时回退 relativeFilename（与 buildEngine.ts 一致）。
      const clean = cleanRelativePath(f.relativeToCommonTopLevelPath || f.relativeFilename);
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
          dirNode.iconPath = this.iconUri('folder.svg') ?? new vscode.ThemeIcon('folder');
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
    // 文件图标：不显式设置 iconPath，交由 VS Code 依据 resourceUri
    // 使用当前文件图标主题（默认 Seti）渲染，与资源管理器保持一致。
    // 文件状态：缺失文件标记（对应 ProjectFile::fvsMissing）
    if (!fs.existsSync(f.absolutePath)) {
      node.description = '缺失';
    }
    return node;
  }
}

/** 折叠相对路径开头的 ../ 前缀（../../platform/bsp → platform/bsp；message/a.c → message/a.c） */
function cleanRelativePath(rel: string): string {
  const norm = rel.replace(/\\/g, '/');
  // 去掉所有开头的 ../（或 ./）
  const stripped = norm.replace(/^(\.\.\/)+|^(\.\/)+/, '');
  return stripped;
}
