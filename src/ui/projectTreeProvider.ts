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
import { upperDrive } from '../tools/pathCase';
import { LruCache } from '../tools/lru';

/** 目录索引：dirKey（''=根）→ 直接文件 / 直接子目录名集合 */
interface DirIndex {
  filesByDir: Map<string, ProjectFile[]>;
  subdirsByDir: Map<string, Set<string>>;
}

/** 树节点 */
class TreeNode extends vscode.TreeItem {
  /** 目录/分组节点的直接子节点（懒加载：childrenLoaded=false 时为空，展开时按需构建） */
  children: TreeNode[] = [];
  /** 子节点是否已按需构建 */
  childrenLoaded = false;
  /** 目录节点：在树中的相对 key（如 'src/common'） */
  dirKey?: string;
  /** 懒加载作用域 key（vf / plain / group:Sources），用于定位 DirIndex */
  scopeKey?: string;

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly kind: 'project' | 'folder' | 'file' | 'virtualFolder' | 'fileGroup',
    public readonly project?: Project,
    public readonly resourceUri?: vscode.Uri,
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
  /** 目录索引缓存：project.filename + 作用域 key → 目录索引（跨节点懒加载共享；LRU 上限防无界增长） */
  private dirIndexCache = new LruCache<string, DirIndex>(256);

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
    this.dirIndexCache.clear();
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
      // 项目节点下只构建顶层骨架（虚拟文件夹 / 分组 / 顶层目录与文件），子级展开时懒加载
      return this.buildFileNodes(element.project!);
    }

    if (element.kind === 'folder' || element.kind === 'virtualFolder') {
      return this.getDirChildren(element);
    }

    if (element.kind === 'fileGroup') {
      return this.getGroupChildren(element);
    }

    return [];
  }

  /** 创建目录节点（区分物理目录 / 虚拟文件夹）；dirKey 用于展开时懒加载子节点 */
  private makeLazyDirNode(
    name: string,
    dirKey: string,
    project: Project,
    kind: 'folder' | 'virtualFolder',
    scopeKey: string,
  ): TreeNode {
    const node = new TreeNode(name, vscode.TreeItemCollapsibleState.Collapsed, kind, project);
    node.iconPath = kind === 'virtualFolder'
      ? (this.iconUri('vfolder.svg') ?? new vscode.ThemeIcon('folder-library'))
      : (this.iconUri('folder.svg') ?? new vscode.ThemeIcon('folder'));
    node.tooltip = kind === 'virtualFolder' ? `虚拟文件夹: ${dirKey}` : dirKey;
    node.dirKey = dirKey;
    node.scopeKey = scopeKey;
    return node;
  }

  /** 懒加载目录节点（folder / virtualFolder）子节点：首次展开时按 DirIndex 构建并缓存 */
  private getDirChildren(element: TreeNode): TreeNode[] {
    if (element.childrenLoaded) return element.children;
    const index = this.getDirIndex(element.project!, element.scopeKey!);
    element.children = this.childrenOfDir(
      element.dirKey ?? '',
      element.project!,
      element.kind as 'folder' | 'virtualFolder',
      index,
      element.scopeKey!,
    );
    element.childrenLoaded = true;
    return element.children;
  }

  /** 懒加载分组节点（fileGroup）子节点：该分组内文件的目录树顶层 */
  private getGroupChildren(element: TreeNode): TreeNode[] {
    if (element.childrenLoaded) return element.children;
    const index = this.getDirIndex(element.project!, element.scopeKey!);
    element.children = this.childrenOfDir('', element.project!, 'folder', index, element.scopeKey!);
    element.childrenLoaded = true;
    return element.children;
  }

  /** 取（或构建并缓存）某项目某作用域的目录索引 */
  private getDirIndex(project: Project, scopeKey: string): DirIndex {
    // 盘符归一化（e:\ → E:\），让同一工程以不同大小写盘符访问时命中同一索引
    const cacheKey = `${upperDrive(project.filename)}\u0000${scopeKey}`;
    let idx = this.dirIndexCache.get(cacheKey);
    if (!idx) {
      idx = this.buildDirIndex(this.scopeEntries(project, scopeKey));
      this.dirIndexCache.set(cacheKey, idx);
    }
    return idx;
  }

  /** 某作用域下的（文件, 相对路径）条目列表 */
  private scopeEntries(project: Project, scopeKey: string): { file: ProjectFile; rel: string }[] {
    if (scopeKey === 'vf') {
      return project.files
        .filter((f) => f.virtualFolder)
        .map((f) => ({ file: f, rel: path.posix.join(f.virtualFolder, path.basename(f.relativeFilename)) }));
    }
    if (scopeKey.startsWith('group:')) {
      const name = scopeKey.slice('group:'.length);
      return project.files
        .filter((f) => !f.virtualFolder && matchGroupName(path.basename(f.relativeFilename)) === name)
        .map((f) => ({ file: f, rel: f.relativeToCommonTopLevelPath || f.relativeFilename }));
    }
    // plain：categorize=false 时的全部非虚拟文件夹文件
    return project.files
      .filter((f) => !f.virtualFolder)
      .map((f) => ({ file: f, rel: f.relativeToCommonTopLevelPath || f.relativeFilename }));
  }

  /** 将（文件, 相对路径）条目构建为目录索引：dirKey（''=根）→ 直接文件 / 直接子目录名 */
  private buildDirIndex(entries: { file: ProjectFile; rel: string }[]): DirIndex {
    const filesByDir = new Map<string, ProjectFile[]>();
    const subdirsByDir = new Map<string, Set<string>>();
    for (const { file, rel } of entries) {
      const segs = cleanRelativePath(rel).split('/').filter(Boolean);
      if (segs.length <= 1) {
        this.pushDirFile(filesByDir, '', file);
        continue;
      }
      const dirKey = segs.slice(0, -1).join('/');
      this.pushDirFile(filesByDir, dirKey, file);
      // 记录每一层「父目录 → 直接子目录名」，支撑逐层懒展开
      let parent = '';
      for (let i = 0; i < segs.length - 1; i++) {
        let set = subdirsByDir.get(parent);
        if (!set) {
          set = new Set<string>();
          subdirsByDir.set(parent, set);
        }
        set.add(segs[i]);
        parent = parent ? `${parent}/${segs[i]}` : segs[i];
      }
    }
    return { filesByDir, subdirsByDir };
  }

  private pushDirFile(filesByDir: Map<string, ProjectFile[]>, dirKey: string, file: ProjectFile): void {
    let arr = filesByDir.get(dirKey);
    if (!arr) {
      arr = [];
      filesByDir.set(dirKey, arr);
    }
    arr.push(file);
  }

  /** 空虚拟文件夹也要显示：把 project.virtualFolders 的目录链补进索引（无文件时展开为空） */
  private mergeEmptyVirtualFolders(project: Project, index: DirIndex): void {
    for (const vf of project.virtualFolders) {
      const segs = cleanRelativePath(vf).split('/').filter(Boolean);
      let parent = '';
      for (const seg of segs) {
        let set = index.subdirsByDir.get(parent);
        if (!set) {
          set = new Set<string>();
          index.subdirsByDir.set(parent, set);
        }
        set.add(seg);
        parent = parent ? `${parent}/${seg}` : seg;
      }
    }
  }

  /** 目录索引的顶层节点（顶层目录 + 根文件），目录节点仍懒加载 */
  private dirNodesFromIndex(
    index: DirIndex,
    project: Project,
    kind: 'folder' | 'virtualFolder',
    scopeKey: string,
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (const name of index.subdirsByDir.get('') ?? []) {
      nodes.push(this.makeLazyDirNode(name, name, project, kind, scopeKey));
    }
    for (const f of index.filesByDir.get('') ?? []) {
      nodes.push(this.fileToNode(project, f));
    }
    this.sortDirNodes(nodes);
    return nodes;
  }

  /** 目录 key 下的直接子节点（直接子目录 + 文件），目录节点仍懒加载 */
  private childrenOfDir(
    dirKey: string,
    project: Project,
    kind: 'folder' | 'virtualFolder',
    index: DirIndex,
    scopeKey: string,
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (const name of index.subdirsByDir.get(dirKey) ?? []) {
      const fullKey = dirKey ? `${dirKey}/${name}` : name;
      nodes.push(this.makeLazyDirNode(name, fullKey, project, kind, scopeKey));
    }
    for (const f of index.filesByDir.get(dirKey) ?? []) {
      nodes.push(this.fileToNode(project, f));
    }
    this.sortDirNodes(nodes);
    return nodes;
  }

  /** 目录节点排序：目录/分组在前、文件在后，同类按 label（对齐原 buildDirTree） */
  private sortDirNodes(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      const aIsDir = (a.kind === 'folder' || a.kind === 'virtualFolder' || a.kind === 'fileGroup') ? 0 : 1;
      const bIsDir = (b.kind === 'folder' || b.kind === 'virtualFolder' || b.kind === 'fileGroup') ? 0 : 1;
      if (aIsDir !== bIsDir) return aIsDir - bIsDir;
      return a.label.localeCompare(b.label);
    });
  }

  /** 构建项目节点下的顶层骨架：虚拟文件夹 / 分组 / 顶层目录与文件（子级展开时懒加载） */
  private buildFileNodes(project: Project): TreeNode[] {
    const rootNodes: TreeNode[] = [];

    // 1. 虚拟文件夹顶层（优先级最高，对齐 pf->virtual_path）
    const vfIndex = this.getDirIndex(project, 'vf');
    this.mergeEmptyVirtualFolders(project, vfIndex);
    rootNodes.push(...this.dirNodesFromIndex(vfIndex, project, 'virtualFolder', 'vf'));

    // 2. 非虚拟文件夹文件：按类型分组（categorize）或纯目录
    const plainFiles = project.files.filter((f) => !f.virtualFolder);
    if (this.categorize) {
      // 只创建实际出现的分组节点（无文件的组不显示），分组内目录树展开时懒加载
      const groupNames = new Set(plainFiles.map((f) => matchGroupName(path.basename(f.relativeFilename))));
      const sorted = [...groupNames].sort((a, b) => groupOrder(a) - groupOrder(b) || a.localeCompare(b));
      for (const name of sorted) {
        const gn = new TreeNode(name, vscode.TreeItemCollapsibleState.Collapsed, 'fileGroup', project);
        gn.iconPath = this.iconUri('vfolder.svg') ?? new vscode.ThemeIcon('folder-library');
        gn.tooltip = `文件分组: ${name}`;
        gn.scopeKey = `group:${name}`;
        rootNodes.push(gn);
      }
    } else {
      const plainIndex = this.getDirIndex(project, 'plain');
      rootNodes.push(...this.dirNodesFromIndex(plainIndex, project, 'folder', 'plain'));
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
