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

/** 拖拽载荷（结构化：项目排序 / 文件入虚拟文件夹） */
interface TreeDragPayload {
  type: 'project' | 'files';
  /** type=project：被拖项目的 .cbp 路径 */
  filename?: string;
  /** type=files：被拖文件（项目 + 相对路径） */
  items?: { project: string; rel: string }[];
}

/** 拖拽控制器：项目节点排序（根级）+ 文件拖入虚拟文件夹/目录（P4） */
class ProjectDragAndDropController implements vscode.TreeDragAndDropController<TreeNode> {
  dropMimeTypes = ['application/vnd.code.tree.codeblocks'];
  dragMimeTypes = ['application/vnd.code.tree.codeblocks'];

  /** 重排回调：把 sourceFilename 移到 targetFilename 之前（target 为空则移到最后） */
  onReorder: ((sourceFilename: string, targetFilename: string | undefined) => void) | undefined;

  /** 文件入夹回调：把 files 归入 folder（'' = 工程根）；仅改模型（对齐 ProjectVirtualFolderDragged） */
  onAssignVirtualFolder:
    | ((files: { project: Project; file: ProjectFile }[], folder: string) => void)
    | undefined;

  handleDrag(source: TreeNode[], dataTransfer: vscode.DataTransfer): void {
    const projectNode = source.find((n) => n.kind === 'project');
    if (projectNode?.project) {
      const payload: TreeDragPayload = { type: 'project', filename: projectNode.project.filename };
      dataTransfer.set('application/vnd.code.tree.codeblocks', new vscode.DataTransferItem(JSON.stringify(payload)));
      return;
    }
    // P4：多选文件拖动（支持一次拖多个文件到同一虚拟文件夹）
    const fileNodes = source.filter((n) => n.kind === 'file' && n.file && n.project);
    if (fileNodes.length) {
      const payload: TreeDragPayload = {
        type: 'files',
        items: fileNodes.map((n) => ({ project: n.project!.filename, rel: n.file!.relativeFilename })),
      };
      dataTransfer.set('application/vnd.code.tree.codeblocks', new vscode.DataTransferItem(JSON.stringify(payload)));
    }
  }

  handleDrop(target: TreeNode | undefined, dataTransfer: vscode.DataTransfer): void {
    const raw = dataTransfer.get('application/vnd.code.tree.codeblocks')?.value;
    if (typeof raw !== 'string' || !raw) return;
    let payload: TreeDragPayload;
    try {
      payload = JSON.parse(raw) as TreeDragPayload;
    } catch {
      return;
    }

    if (payload.type === 'project') {
      // 只允许拖到项目节点上（或根，即放在末尾）
      if (target && target.kind !== 'project') return;
      this.onReorder?.(payload.filename!, target?.project?.filename);
      return;
    }

    if (payload.type === 'files') {
      // 目标必须是模型节点：工程（回根）/ 物理目录 / 虚拟文件夹；文件分组（视图）不接受
      if (!target?.project || !payload.items?.length) return;
      if (target.kind !== 'project' && target.kind !== 'folder' && target.kind !== 'virtualFolder') return;
      const folder = target.kind === 'project' ? '' : (target.dirKey ?? '');
      const files: { project: Project; file: ProjectFile }[] = [];
      for (const it of payload.items) {
        if (it.project !== target.project.filename) continue; // 跨工程拖拽不支持
        const file = target.project.files.find((f) => f.relativeFilename === it.rel);
        if (file) files.push({ project: target.project, file });
      }
      if (files.length) this.onAssignVirtualFolder?.(files, folder);
    }
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
  /**
   * 节点缓存：保证同一逻辑节点返回同一对象实例。
   * 背景：vscode.TreeView.reveal() 依赖 getParent 链 + getChildren 返回的同一实例来定位节点，
   * 若每次重建新对象，reveal 会因对象不等而找不到目标（P1 查找文件定位）。
   */
  private nodeCache = new Map<string, TreeNode>();
  /** 父节点映射：实现 getParent（WeakMap 不阻碍节点回收） */
  private parentMap = new WeakMap<TreeNode, TreeNode>();
  /** 文件存在性缓存（P8：异步检查；key = upperDrive(absolutePath).toLowerCase()） */
  private missingCache = new Map<string, boolean>();
  /** 待异步检查的文件路径 → 需要刷新的节点集合（同路径多节点合并） */
  private missingPending = new Map<string, Set<TreeNode>>();
  /** 是否已调度异步检查（去抖 50ms 合并） */
  private missingCheckScheduled = false;

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
    this.nodeCache.clear();
    this.parentMap = new WeakMap<TreeNode, TreeNode>();
    this.missingCache.clear(); // P8：模型重载后文件存在性重新异步检查
    this.missingPending.clear();
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
    this.dirIndexCache.clear();
    this.nodeCache.clear();
    this.parentMap = new WeakMap<TreeNode, TreeNode>();
    this.missingCache.clear(); // P8：节点重建后文件存在性重新异步检查
    this.missingPending.clear();
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 父节点（树视图 reveal / 展开链路需要） */
  getParent(element: TreeNode): TreeNode | undefined {
    return this.parentMap.get(element);
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
    // 文件节点：不显式设置 iconPath，交由 VS Code 依据 resourceUri 使用文件图标主题渲染
    return element;
  }

  getChildren(element?: TreeNode): TreeNode[] {
    if (!element) {
      // 根：所有项目节点（顺序即编译顺序）；节点走缓存保证实例稳定（reveal 需要）
      return this.projects.map((p) => this.projectNode(p));
    }

    if (element.kind === 'project') {
      // 项目节点下只构建顶层骨架（虚拟文件夹 / 分组 / 顶层目录与文件），子级展开时懒加载
      return this.buildFileNodes(element);
    }

    if (element.kind === 'folder' || element.kind === 'virtualFolder') {
      return this.getDirChildren(element);
    }

    if (element.kind === 'fileGroup') {
      return this.getGroupChildren(element);
    }

    return [];
  }

  /** 项目节点（缓存；参考 Code::Blocks project->GetTitle() 语义取项目名） */
  private projectNode(project: Project): TreeNode {
    const key = `p\u0000${upperDrive(project.filename)}`;
    let node = this.nodeCache.get(key);
    if (!node) {
      // 当 .cbp 的 <Option title> 不足以区分（如多个 app.cbp）时，
      // 用 .cbp 所在目录名（如 earphone / esop8）作为项目显示名。
      const dirName = path.basename(path.dirname(project.filename));
      node = new TreeNode(dirName || project.title, vscode.TreeItemCollapsibleState.Expanded, 'project', project);
      // 稳定 id：让 TreeView 在刷新时能正确识别/复用项目节点，配合 getTreeItem 更新图标
      node.id = project.filename;
      node.description = path.basename(project.filename);
      node.tooltip = project.filename;
      this.nodeCache.set(key, node);
    }
    return node;
  }

  /** 目录节点（缓存；区分物理目录 / 虚拟文件夹），dirKey 用于展开时懒加载子节点 */
  private dirNode(
    project: Project,
    kind: 'folder' | 'virtualFolder',
    dirKey: string,
    scopeKey: string,
  ): TreeNode {
    const key = `d\u0000${upperDrive(project.filename)}\u0000${scopeKey}\u0000${dirKey}`;
    let node = this.nodeCache.get(key);
    if (!node) {
      const name = dirKey.split('/').pop() ?? dirKey;
      node = new TreeNode(name, vscode.TreeItemCollapsibleState.Collapsed, kind, project);
      node.iconPath = kind === 'virtualFolder'
        ? (this.iconUri('vfolder.svg') ?? new vscode.ThemeIcon('folder-library'))
        : (this.iconUri('folder.svg') ?? new vscode.ThemeIcon('folder'));
      node.tooltip = kind === 'virtualFolder' ? `虚拟文件夹: ${dirKey}` : dirKey;
      node.contextValue = kind === 'virtualFolder' ? 'virtualFolder' : 'folder';
      node.dirKey = dirKey;
      node.scopeKey = scopeKey;
      this.nodeCache.set(key, node);
    }
    return node;
  }

  /** 文件类型分组节点（缓存） */
  private groupNode(project: Project, name: string): TreeNode {
    const key = `g\u0000${upperDrive(project.filename)}\u0000${name}`;
    let node = this.nodeCache.get(key);
    if (!node) {
      node = new TreeNode(name, vscode.TreeItemCollapsibleState.Collapsed, 'fileGroup', project);
      node.iconPath = this.iconUri('vfolder.svg') ?? new vscode.ThemeIcon('folder-library');
      node.tooltip = `文件分组: ${name}`;
      node.contextValue = 'fileGroup';
      node.scopeKey = `group:${name}`;
      this.nodeCache.set(key, node);
    }
    return node;
  }

  /**
   * 查找某文件在树中的节点（P1「查找文件」定位用）。
   * 按与 getChildren 相同的路径规则预先构建链条（带缓存），并登记父节点映射，
   * 使 TreeView.reveal(node, {expand:true}) 能逐级展开到该文件。
   */
  findFileNode(project: Project, file: ProjectFile): TreeNode {
    let parent = this.projectNode(project);
    const rel = file.relativeToCommonTopLevelPath || file.relativeFilename;

    if (file.virtualFolder) {
      parent = this.linkDirChain(project, parent, file.virtualFolder, 'virtualFolder', 'vf');
    } else if (this.categorize) {
      const name = matchGroupName(path.basename(file.relativeFilename));
      const g = this.groupNode(project, name);
      this.parentMap.set(g, parent);
      parent = this.linkDirChain(project, g, path.posix.dirname(cleanRelativePath(rel)), 'folder', `group:${name}`);
    } else {
      parent = this.linkDirChain(project, parent, path.posix.dirname(cleanRelativePath(rel)), 'folder', 'plain');
    }

    const node = this.fileNode(project, file);
    this.parentMap.set(node, parent);
    return node;
  }

  /** 逐级创建目录节点链并登记父映射（dirRel 为 '' 或 '.' 时返回原 parent） */
  private linkDirChain(
    project: Project,
    parent: TreeNode,
    dirRel: string,
    kind: 'folder' | 'virtualFolder',
    scopeKey: string,
  ): TreeNode {
    const segs = cleanRelativePath(dirRel).split('/').filter((s) => s && s !== '.');
    let dirKey = '';
    for (const seg of segs) {
      dirKey = dirKey ? `${dirKey}/${seg}` : seg;
      const child = this.dirNode(project, kind, dirKey, scopeKey);
      this.parentMap.set(child, parent);
      parent = child;
    }
    return parent;
  }

  /**
   * 某节点作用域下的全部文件（P1「查找文件」用；对应 ProjectManagerUI::ListNodes，
   * projectmanagerui.cpp:2530-2567 的递归收集，不依赖懒加载状态）。
   * 作用域：项目 = 全部文件；文件夹/虚拟文件夹 = 该目录及子目录；分组 = 该分组全部。
   */
  filesUnder(node: TreeNode): ProjectFile[] {
    const project = node.project;
    if (!project) return [];
    if (node.kind === 'project') return [...project.files];
    if (node.kind === 'file') return node.file ? [node.file] : [];
    if (node.kind === 'folder' || node.kind === 'virtualFolder') {
      const index = this.getDirIndex(project, node.scopeKey!);
      const dirKey = node.dirKey ?? '';
      const prefix = dirKey ? `${dirKey}/` : '';
      const out: ProjectFile[] = [...(index.filesByDir.get(dirKey) ?? [])];
      for (const [k, arr] of index.filesByDir) {
        if (k !== dirKey && k.startsWith(prefix)) out.push(...arr);
      }
      return out;
    }
    if (node.kind === 'fileGroup') {
      const index = this.getDirIndex(project, node.scopeKey!);
      const out: ProjectFile[] = [];
      for (const arr of index.filesByDir.values()) out.push(...arr);
      return out;
    }
    return [];
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
      element,
    );
    element.childrenLoaded = true;
    return element.children;
  }

  /** 懒加载分组节点（fileGroup）子节点：该分组内文件的目录树顶层 */
  private getGroupChildren(element: TreeNode): TreeNode[] {
    if (element.childrenLoaded) return element.children;
    const index = this.getDirIndex(element.project!, element.scopeKey!);
    element.children = this.childrenOfDir('', element.project!, 'folder', index, element.scopeKey!, element);
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
    parent: TreeNode,
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (const name of index.subdirsByDir.get('') ?? []) {
      const node = this.dirNode(project, kind, name, scopeKey);
      this.parentMap.set(node, parent);
      nodes.push(node);
    }
    for (const f of index.filesByDir.get('') ?? []) {
      nodes.push(this.childFileNode(project, f, parent));
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
    parent: TreeNode,
  ): TreeNode[] {
    const nodes: TreeNode[] = [];
    for (const name of index.subdirsByDir.get(dirKey) ?? []) {
      const fullKey = dirKey ? `${dirKey}/${name}` : name;
      const node = this.dirNode(project, kind, fullKey, scopeKey);
      this.parentMap.set(node, parent);
      nodes.push(node);
    }
    for (const f of index.filesByDir.get(dirKey) ?? []) {
      nodes.push(this.childFileNode(project, f, parent));
    }
    this.sortDirNodes(nodes);
    return nodes;
  }

  /** 构建文件节点并登记父映射（统一入口，保证 findFileNode 与树中实例一致） */
  private childFileNode(project: Project, f: ProjectFile, parent: TreeNode): TreeNode {
    const node = this.fileNode(project, f);
    this.parentMap.set(node, parent);
    return node;
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
  private buildFileNodes(projectElement: TreeNode): TreeNode[] {
    const project = projectElement.project!;
    const rootNodes: TreeNode[] = [];

    // 1. 虚拟文件夹顶层（优先级最高，对齐 pf->virtual_path）
    const vfIndex = this.getDirIndex(project, 'vf');
    this.mergeEmptyVirtualFolders(project, vfIndex);
    rootNodes.push(...this.dirNodesFromIndex(vfIndex, project, 'virtualFolder', 'vf', projectElement));

    // 2. 非虚拟文件夹文件：按类型分组（categorize）或纯目录
    const plainFiles = project.files.filter((f) => !f.virtualFolder);
    if (this.categorize) {
      // 只创建实际出现的分组节点（无文件的组不显示），分组内目录树展开时懒加载
      const groupNames = new Set(plainFiles.map((f) => matchGroupName(path.basename(f.relativeFilename))));
      const sorted = [...groupNames].sort((a, b) => groupOrder(a) - groupOrder(b) || a.localeCompare(b));
      for (const name of sorted) {
        const gn = this.groupNode(project, name);
        this.parentMap.set(gn, projectElement);
        rootNodes.push(gn);
      }
    } else {
      const plainIndex = this.getDirIndex(project, 'plain');
      rootNodes.push(...this.dirNodesFromIndex(plainIndex, project, 'folder', 'plain', projectElement));
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

  /** 文件节点（缓存；目标归属仍在构建时计算一次） */
  private fileNode(project: Project, f: ProjectFile): TreeNode {
    const key = `f\u0000${upperDrive(project.filename)}\u0000${f.relativeFilename}`;
    let node = this.nodeCache.get(key);
    if (node) return node;
    const uri = vscode.Uri.file(f.absolutePath);
    node = new TreeNode(
      path.basename(f.relativeFilename),
      vscode.TreeItemCollapsibleState.None,
      'file',
      project,
      uri,
      f,
    );
    // 文件图标：不显式设置 iconPath，交由 VS Code 依据 resourceUri
    // 使用当前文件图标主题（默认 Seti）渲染，与资源管理器保持一致。

    // P8：文件存在性改为异步检查（不再在节点创建时同步 fs.existsSync 阻塞 UI 线程）。
    // 初始按「存在」渲染；异步检查发现缺失后更新为「缺失」并局部刷新该节点（缓存防重复 stat）。
    const missingKey = upperDrive(f.absolutePath).toLowerCase();
    const cachedMissing = this.missingCache.get(missingKey);
    if (cachedMissing === undefined) {
      this.scheduleMissingCheck(missingKey, node);
    }
    this.applyFilePresentation(node, project, f, cachedMissing === true);
    this.nodeCache.set(key, node);
    return node;
  }

  /** 计算文件节点的 description/tooltip（同步创建与异步缺失检查共用；对齐 Code::Blocks 归属展示） */
  private applyFilePresentation(node: TreeNode, project: Project, f: ProjectFile, missing: boolean): void {
    const allTitles = project.buildTargets.map((t) => t.title);
    if (!allTitles.length) return;
    const belongs = f.buildTargets.filter((t) => allTitles.includes(t));
    if (missing) {
      node.description = '缺失'; // 对应 ProjectFile::fvsMissing
    } else if (belongs.length === 0) {
      node.description = '（未归属任何目标）';
    } else if (belongs.length < allTitles.length) {
      node.description = belongs.join(', ');
    } else {
      node.description = undefined; // 全目标归属：无描述（含异步复查后从「缺失」恢复的场景）
    }
    if (belongs.length) {
      node.tooltip = `目标: ${belongs.join(', ')}`;
    }
  }

  /** 调度文件存在性异步检查（50ms 去抖合并；同路径多节点只检查一次） */
  private scheduleMissingCheck(missingKey: string, node: TreeNode): void {
    let set = this.missingPending.get(missingKey);
    if (!set) {
      set = new Set();
      this.missingPending.set(missingKey, set);
    }
    set.add(node);
    if (this.missingCheckScheduled) return;
    this.missingCheckScheduled = true;
    setTimeout(() => { void this.runMissingChecks(); }, 50);
  }

  /** 执行文件存在性检查（分片 64 个/批，批间让出事件循环；仅缺失节点需要局部刷新） */
  private async runMissingChecks(): Promise<void> {
    this.missingCheckScheduled = false;
    const entries = [...this.missingPending.entries()];
    this.missingPending.clear();
    const CHUNK = 64;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const batch = entries.slice(i, i + CHUNK);
      await Promise.all(batch.map(async ([abs, nodes]) => {
        let missing = false;
        try {
          await fs.promises.access(abs);
        } catch {
          missing = true; // 不存在/无权限 → 视作缺失（与原 existsSync 行为一致）
        }
        this.missingCache.set(abs, missing);
        if (!missing) return;
        for (const n of nodes) {
          if (!n.project || !n.file) continue;
          this.applyFilePresentation(n, n.project, n.file, true);
          this._onDidChangeTreeData.fire(n); // 局部刷新该节点
        }
      }));
      if (i + CHUNK < entries.length) await new Promise((r) => setImmediate(r));
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
