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
    public readonly kind: 'project' | 'folder' | 'file' | 'virtualFolder' | 'fileGroup',
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
  /** 是否按文件类型分组（categorize，对齐 Code::Blocks 默认 true） */
  private categorize = true;
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

  /** 设置是否按文件类型分组 */
  setCategorize(categorize: boolean): void {
    if (this.categorize === categorize) return;
    this.categorize = categorize;
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
      // 项目节点下直接挂文件树（虚拟文件夹 / 物理目录），对齐 Code::Blocks BuildProjectTree()
      return this.buildFileNodes(element.project!);
    }

    if (element.kind === 'folder' || element.kind === 'virtualFolder' || element.kind === 'fileGroup') {
      return element.children;
    }

    return [];
  }

  /** 创建目录节点（区分物理目录 / 虚拟文件夹） */
  private makeDirNode(name: string, key: string, project: Project, kind: 'folder' | 'virtualFolder'): TreeNode {
    const node = new TreeNode(name, vscode.TreeItemCollapsibleState.Collapsed, kind, project);
    node.iconPath = kind === 'virtualFolder'
      ? (this.iconUri('vfolder.svg') ?? new vscode.ThemeIcon('folder-library'))
      : (this.iconUri('folder.svg') ?? new vscode.ThemeIcon('folder'));
    node.tooltip = kind === 'virtualFolder' ? `虚拟文件夹: ${key}` : key;
    return node;
  }

  /** 逐层确保目录节点存在（返回最深层节点；kind 决定图标/类型） */
  private ensureDirNodes(
    pathStr: string,
    project: Project,
    dirNodes: Map<string, TreeNode>,
    rootDirs: TreeNode[],
    kind: 'folder' | 'virtualFolder',
  ): TreeNode | undefined {
    const segs = cleanRelativePath(pathStr).split('/').filter(Boolean);
    let parentNode: TreeNode | undefined;
    let parentKey = '';
    let result: TreeNode | undefined;
    for (const seg of segs) {
      const key = parentKey ? `${parentKey}/${seg}` : seg;
      let dirNode = dirNodes.get(key);
      if (!dirNode) {
        dirNode = this.makeDirNode(seg, key, project, kind);
        dirNodes.set(key, dirNode);
        if (parentNode) {
          parentNode.children.push(dirNode);
        } else {
          rootDirs.push(dirNode);
        }
      }
      parentNode = dirNode;
      parentKey = key;
      result = dirNode;
    }
    return result;
  }

  /** 构建目录树（给定文件列表 → 目录节点 + 根文件），组内/纯目录视图共用 */
  private buildDirTree(files: ProjectFile[], project: Project): TreeNode[] {
    const dirNodes = new Map<string, TreeNode>();
    const rootDirs: TreeNode[] = [];
    const rootFiles: TreeNode[] = [];
    for (const f of files) {
      const rel = f.relativeToCommonTopLevelPath || f.relativeFilename;
      const segs = cleanRelativePath(rel).split('/').filter(Boolean);
      const fileNode = this.fileToNode(project, f);
      if (segs.length <= 1) {
        rootFiles.push(fileNode);
        continue;
      }
      const parentNode = this.ensureDirNodes(segs.slice(0, -1).join('/'), project, dirNodes, rootDirs, 'folder');
      if (parentNode) {
        parentNode.children.push(fileNode);
      } else {
        rootFiles.push(fileNode);
      }
    }
    for (const d of dirNodes.values()) {
      d.children.sort((a, b) => {
        const aIsDir = (a.kind === 'folder' || a.kind === 'virtualFolder' || a.kind === 'fileGroup') ? 0 : 1;
        const bIsDir = (b.kind === 'folder' || b.kind === 'virtualFolder' || b.kind === 'fileGroup') ? 0 : 1;
        if (aIsDir !== bIsDir) return aIsDir - bIsDir;
        return a.label.localeCompare(b.label);
      });
    }
    rootDirs.sort((a, b) => a.label.localeCompare(b.label));
    rootFiles.sort((a, b) => a.label.localeCompare(b.label));
    return [...rootDirs, ...rootFiles];
  }

  /** 构建文件树节点：虚拟文件夹 > 文件类型分组 > 组内/物理目录（对齐 Code::Blocks BuildProjectTree） */
  private buildFileNodes(project: Project): TreeNode[] {
    const rootNodes: TreeNode[] = [];

    // 1. 虚拟文件夹（优先级最高，对齐 pf->virtual_path）
    const vfDirNodes = new Map<string, TreeNode>();
    for (const vf of project.virtualFolders) {
      this.ensureDirNodes(vf, project, vfDirNodes, rootNodes, 'virtualFolder');
    }
    for (const f of project.files) {
      if (!f.virtualFolder) continue;
      const rel = path.posix.join(f.virtualFolder, path.basename(f.relativeFilename));
      const segs = cleanRelativePath(rel).split('/').filter(Boolean);
      const fileNode = this.fileToNode(project, f);
      if (segs.length <= 1) {
        rootNodes.push(fileNode);
        continue;
      }
      const parentNode = this.ensureDirNodes(segs.slice(0, -1).join('/'), project, vfDirNodes, rootNodes, 'virtualFolder');
      if (parentNode) {
        parentNode.children.push(fileNode);
      } else {
        rootNodes.push(fileNode);
      }
    }

    // 2. 非虚拟文件夹文件：按类型分组（categorize）或纯目录
    const plainFiles = project.files.filter((f) => !f.virtualFolder);
    if (this.categorize) {
      const groupNodes = new Map<string, TreeNode>();
      for (const f of plainFiles) {
        const name = matchGroupName(path.basename(f.relativeFilename));
        if (!groupNodes.has(name)) {
          const gn = new TreeNode(name, vscode.TreeItemCollapsibleState.Collapsed, 'fileGroup', project);
          gn.iconPath = this.iconUri('vfolder.svg') ?? new vscode.ThemeIcon('folder-library');
          gn.tooltip = `文件分组: ${name}`;
          groupNodes.set(name, gn);
          rootNodes.push(gn);
        }
      }
      for (const [name, gn] of groupNodes) {
        const files = plainFiles.filter((f) => matchGroupName(path.basename(f.relativeFilename)) === name);
        gn.children.push(...this.buildDirTree(files, project));
      }
    } else {
      rootNodes.push(...this.buildDirTree(plainFiles, project));
    }

    // 根层排序：目录/分组在前，文件在后；分组节点按 Code::Blocks 定义顺序（Sources→Headers→…→Others）
    rootNodes.sort((a, b) => {
      const aIsDir = (a.kind === 'folder' || a.kind === 'virtualFolder' || a.kind === 'fileGroup') ? 0 : 1;
      const bIsDir = (b.kind === 'folder' || b.kind === 'virtualFolder' || b.kind === 'fileGroup') ? 0 : 1;
      if (aIsDir !== bIsDir) return aIsDir - bIsDir;
      if (a.kind === 'fileGroup' && b.kind === 'fileGroup') {
        return groupOrder(a.label) - groupOrder(b.label);
      }
      return a.label.localeCompare(b.label);
    });
    return rootNodes;
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

    // 文件归属目标展示（对齐 Code::Blocks：文件只出现一次，归属通过描述/提示体现）
    const allTitles = project.buildTargets.map((t) => t.title);
    if (allTitles.length) {
      const belongs = f.buildTargets.filter((t) => allTitles.includes(t));
      if (!fs.existsSync(f.absolutePath)) {
        node.description = '缺失'; // 对应 ProjectFile::fvsMissing
      } else if (belongs.length === 0) {
        node.description = '（未归属任何目标）';
      } else if (belongs.length < allTitles.length) {
        node.description = belongs.join(', ');
      }
      if (belongs.length) {
        node.tooltip = `目标: ${belongs.join(', ')}`;
      }
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

/** 文件类型分组定义 —— 移植 filegroupsandmasks.cpp 的 SetDefault() */
interface FileGroupDef {
  name: string;
  masks: string[];
}

const DEFAULT_FILE_GROUPS: FileGroupDef[] = [
  { name: 'Sources', masks: ['*.c', '*.cpp', '*.cc', '*.cxx'] },
  { name: 'D Sources', masks: ['*.d'] },
  { name: 'Fortran Sources', masks: ['*.f', '*.f77', '*.for', '*.fpp', '*.f90', '*.f95', '*.f03', '*.f08'] },
  { name: 'Java Sources', masks: ['*.java'] },
  { name: 'Headers', masks: ['*.h', '*.hpp', '*.hh', '*.hxx'] },
  { name: 'ASM Sources', masks: ['*.asm', '*.s', '*.ss', '*.s62'] },
  { name: 'Resources', masks: ['*.res', '*.xrc', '*.rc', '*.wxs'] },
  { name: 'Scripts', masks: ['*.script'] },
];

/** glob（如 *.c）转正则 */
function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

/** 预编译的默认文件组 */
const COMPILED_GROUPS = DEFAULT_FILE_GROUPS.map((g) => ({
  name: g.name,
  regexes: g.masks.map(globToRegex),
}));

/** 根据文件名（basename，含扩展名）匹配分组名；未匹配返回 Others */
function matchGroupName(filename: string): string {
  for (const g of COMPILED_GROUPS) {
    for (const re of g.regexes) {
      if (re.test(filename)) return g.name;
    }
  }
  return 'Others';
}

/** 分组排序权重：按 DEFAULT_FILE_GROUPS 定义顺序（对齐 SetDefault），未知组（Others 等）排最后 */
function groupOrder(name: string): number {
  const idx = DEFAULT_FILE_GROUPS.findIndex((g) => g.name === name);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}
