/**
 * 扩展入口 —— 注册命令、管理项目/构建生命周期
 *
 * 对应 Code::Blocks 的 pluginmanager / compilergcc 插件入口角色。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { ProjectParser, WorkspaceParser } from './model/parser';
import { Project, BuildTarget, ProjectFile, TargetType, OptionsRelation, OptionsRelationType, LinkerExecutableOption } from './model/types';
import { serializeProject } from './model/projectWriter';
import { createProjectFromTemplate, PROJECT_TEMPLATES } from './project/newProject';
import { Compiler } from './compiler/compiler';
import { CompilerOptionsLoader } from './compiler/optionsLoader';
import { CodeBlocksConfig } from './compiler/codeblocksConfig';
import { detectAllCompilers, DetectedCompiler } from './compiler/detector';
import { CompilerOptionsPanel } from './ui/compilerOptionsPanel';
import { ProjectPropertiesPanel, TargetEditData, FileEditData, BuildOptionsEditData, SearchDirsEditData, ProjectSettingsEditData, BuildScriptsEditData, NotesEditData, VirtualTargetEditData } from './ui/projectPropertiesPanel';
import { ProjectTreeProvider } from './ui/projectTreeProvider';
import { MenuTreeProvider } from './ui/menuTreeProvider';
import { BuildLogTreeProvider, BuildLogProject, BuildLogDiagnostic } from './ui/buildLogTreeProvider';
import { SymbolTreeProvider } from './ui/symbolTreeProvider';
import { BuildEngine } from './build/buildEngine';
import { OutputParser } from './build/outputParser';
import { collectClangdEntries, writeClangdDatabase, CompileCommandEntry } from './build/compileCommands';
import { detectClangd, queryCompilerSystemIncludes, queryCompilerTarget, updateClangdUserConfig, clangdUserConfigPath } from './tools/clangd';
import { SymbolIndex, registerFallbackIntelliSense } from './tools/codeCompletion';
import { GdbDebugAdapter } from './debug/gdbDebugAdapter';
import { scanTodos } from './tools/todoScanner';
import { countFiles, isSourceFile } from './tools/codeStats';
import { formatActiveDocument } from './tools/astyle';

/** 已打开的项目列表（顺序即编译顺序） */
let openProjects: Project[] = [];
/** 工作区项目依赖（工程绝对路径 → 依赖的绝对路径列表，来自 .workspace 的 <Depends>） */
let workspaceDeps: Record<string, string[]> = {};
/** 当前活动项目（状态栏 Target/Compiler 针对的对象） */
let activeProject: Project | undefined;
let outputChannel: vscode.LogOutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;
let compilerLoader: CompilerOptionsLoader | undefined;
let codeBlocksConfig: CodeBlocksConfig | undefined;
let projectTreeProvider: ProjectTreeProvider | undefined;
let projectTreeView: vscode.TreeView<any> | undefined;
let buildLogTreeProvider: BuildLogTreeProvider | undefined;
let symbolTreeProvider: SymbolTreeProvider | undefined;
let extContext: vscode.ExtensionContext | undefined;
/** 当前一次构建累积的项目摘要（供 Build Log 视图） */
const currentBuildProjects: BuildLogProject[] = [];
/** 本次构建已收集的错误总数（用于 maxReportedErrors 截断判断） */
let currentBuildErrorCount = 0;
/** 本次构建是否因达到 maxReportedErrors 上限而被截断 */
let maxErrorsReached = false;

/** 底部状态栏构建目标项 */
let targetStatusBar: vscode.StatusBarItem | undefined;
/** 各工程的构建目标标题（filename -> targetTitle，对齐 CodeBlocks cbProject::m_ActiveTarget 按工程存储） */
let selectedTargets = new Map<string, string>();
/** 各工程构建目标记忆的 workspaceState key */
const SELECTED_TARGETS_KEY = 'codeblocks.selectedTargets';
/** 底部状态栏：增量编译 */
let buildStatusBar: vscode.StatusBarItem | undefined;
/** 底部状态栏：全量编译 */
let rebuildStatusBar: vscode.StatusBarItem | undefined;
/** 底部状态栏：编译器选择 */
let compilerStatusBar: vscode.StatusBarItem | undefined;
/** 底部状态栏：检测到未打开的 Code::Blocks 项目入口 */
let cbpStatusBar: vscode.StatusBarItem | undefined;
/** 检测到但未打开的 .cbp 文件（供状态栏入口重新打开） */
let pendingCbpFiles: string[] = [];

/** 兜底 IntelliSense 符号索引（clangd 不可用时启用） */
const fallbackIndex = new SymbolIndex();
/** 兜底是否生效（检测到 clangd 后置为 false） */
let fallbackEnabled = true;
/** clangd 是否接管诊断（检测到 clangd 后置为 true：构建引擎不再写 Problems 面板） */
let clangdDiagnosticsEnabled = false;
/** clangd 配置生成的去抖定时器 */
let clangdGenTimer: NodeJS.Timeout | undefined;
/** clangd 配置生成进行中标志（防止并发写同一文件） */
let clangdGenRunning = false;
/** 活动工程切换后，若编译数据库实际变化则重启 clangd（刷新已打开文件） */
let restartClangdAfterGeneration = false;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  extContext = context;
  loadSelectedTargets();
  outputChannel = vscode.window.createOutputChannel('Code::Blocks', { log: true });
  diagnosticCollection = vscode.languages.createDiagnosticCollection('codeblocks');

  // 安装/激活时自动写入 .ld/.xm 的 token 颜色规则（幂等，仅命中 source.ld/source.xm）
  void applyTokenColorCustomizations();

  // 初始化编译器选项加载器（resources/compilers 目录）
  const resourcesDir = path.join(context.extensionPath, 'resources', 'compilers');
  compilerLoader = new CompilerOptionsLoader(resourcesDir);

  // 读取 CodeBlocks 用户自定义编译器配置（如 riscv32-v2）
  codeBlocksConfig = new CodeBlocksConfig();
  codeBlocksConfig.load();

  // 注册 DAP 调试器（内联实现，直接驱动 GDB）
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('codeblocks', {
      createDebugAdapterDescriptor: () => new vscode.DebugAdapterInlineImplementation(new GdbDebugAdapter()),
    }),
  );

  // 注册项目树视图（支持多项目 + 拖拽排序）
  projectTreeProvider = new ProjectTreeProvider();
  projectTreeProvider.setResourcesDir(path.join(context.extensionPath, 'resources'));
  projectTreeProvider.setCategorize(vscode.workspace.getConfiguration('codeblocks').get<boolean>('projectTree.categorize', true));
  projectTreeView = vscode.window.createTreeView('codeblocks.projectTree', {
    treeDataProvider: projectTreeProvider,
    showCollapseAll: true,
    dragAndDropController: projectTreeProvider.dragAndDropController,
  });
  projectTreeProvider.dragAndDropController.onReorder = (src, target) => {
    reorderProjects(src, target);
  };
  context.subscriptions.push(projectTreeView);

  // 配置变更：工程树文件分组开关
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeblocks.projectTree.categorize')) {
        projectTreeProvider?.setCategorize(
          vscode.workspace.getConfiguration('codeblocks').get<boolean>('projectTree.categorize', true),
        );
      }
    }),
  );

  // 点击工程树任意节点（项目/文件夹/文件）时，切换活动工程为该节点所属工程；
  // 共享文件点哪个工程子树就切哪个（每个节点自带所属 project）
  projectTreeView.onDidChangeSelection((e) => {
    const node = e.selection[0];
    if (node?.project) {
      setActiveProject(node.project, { persist: true });
    }
  });

  // 注册构建日志树视图（结构化构建摘要）
  buildLogTreeProvider = new BuildLogTreeProvider();
  buildLogTreeProvider.setResourcesDir(path.join(context.extensionPath, 'resources'));
  const buildLogTreeView = vscode.window.createTreeView('codeblocks.buildLog', {
    treeDataProvider: buildLogTreeProvider,
  });
  context.subscriptions.push(buildLogTreeView);

  // 注册符号浏览视图（对应 Code::Blocks Symbols 面板）
  symbolTreeProvider = new SymbolTreeProvider();
  symbolTreeProvider.setIndex(fallbackIndex);
  const symbolsTreeView = vscode.window.createTreeView('codeblocks.symbols', {
    treeDataProvider: symbolTreeProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(symbolsTreeView);

  // 注册菜单树视图（File/Edit/View/Build 等，模拟 Code::Blocks 菜单栏）
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('codeblocks.menu', new MenuTreeProvider()),
  );

  // 兜底 IntelliSense（补全 / 悬停 / 跳转定义）：仅在 clangd 不可用时生效
  context.subscriptions.push(...registerFallbackIntelliSense(fallbackIndex, () => fallbackEnabled));

  // 聚焦 Build Log 视图（菜单项 / 构建完成后引导）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildLog.focus', () => {
      vscode.commands.executeCommand('workbench.view.extension.codeblocks');
    }),
  );

  // 聚焦 Project 视图（菜单 View → Project）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.projectTree.focus', () => {
      projectTreeView?.reveal(undefined, { focus: true });
    }),
  );

  // 生成 compile_commands.json（供 clangd IntelliSense）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.generateCompileCommands', async () => {
      await generateClangdForWorkspace(true);
    }),
  );

  // 下一个错误（F4）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.nextError', () => {
      if (!buildLogTreeProvider?.hasErrors()) {
        vscode.window.showInformationMessage('没有可导航的编译错误');
        return;
      }
      buildLogTreeProvider.gotoNextError();
    }),
  );

  // 上一个错误（Shift+F4）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.prevError', () => {
      if (!buildLogTreeProvider?.hasErrors()) {
        vscode.window.showInformationMessage('没有可导航的编译错误');
        return;
      }
      buildLogTreeProvider.gotoPreviousError();
    }),
  );

  // 底部状态栏：构建目标切换项
  targetStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  targetStatusBar.command = 'codeblocks.selectTarget';
  targetStatusBar.tooltip = '点击切换构建目标';
  context.subscriptions.push(targetStatusBar);
  updateTargetStatusBar();

  // 底部状态栏：增量编译
  buildStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  buildStatusBar.text = '$(package) Build';
  buildStatusBar.command = 'codeblocks.build';
  buildStatusBar.tooltip = '增量编译（Ctrl+F9）';
  context.subscriptions.push(buildStatusBar);

  // 底部状态栏：全量编译
  rebuildStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  rebuildStatusBar.text = '$(sync) Rebuild';
  rebuildStatusBar.command = 'codeblocks.rebuild';
  rebuildStatusBar.tooltip = '全量编译（Ctrl+F11）';
  context.subscriptions.push(rebuildStatusBar);

  // 底部状态栏：编译器选择
  compilerStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 70);
  compilerStatusBar.command = 'codeblocks.detectCompilers';
  compilerStatusBar.tooltip = '点击选择编译器';
  context.subscriptions.push(compilerStatusBar);
  updateCompilerStatusBar();

  // 设置活动项目（点击项目树中的项目节点时触发）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.setActiveProject', (filename?: string) => {
      if (!filename) return;
      const p = openProjects.find((x) => x.filename === filename);
      if (p) {
        setActiveProject(p, { persist: true });
      }
    }),
  );

  // 选择构建目标（项目节点右键 / 状态栏）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.selectProjectTarget', async (node?: any) => {
      const filename = resolveProjectFilename(node);
      const project = filename
        ? openProjects.find((p) => p.filename === filename)
        : requireProject();
      if (!project) return;
      await promptSelectTargetForProject(project);
    }),
  );

  // 活动工程跟随当前编辑器：编辑某工程的文件时自动切换活动工程
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => syncActiveProjectToEditor()),
  );
  syncActiveProjectToEditor();

  // 向上移动项目
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.moveProjectUp', (node?: any) => {
      const filename = resolveProjectFilename(node);
      if (!filename) return;
      moveProject(filename, -1);
    }),
  );

  // 向下移动项目
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.moveProjectDown', (node?: any) => {
      const filename = resolveProjectFilename(node);
      if (!filename) return;
      moveProject(filename, 1);
    }),
  );

  // 移除项目
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.removeProject', async (node?: any) => {
      const filename = resolveProjectFilename(node);
      if (!filename) return;
      const project = openProjects.find((p) => p.filename === filename);
      if (!project) return;
      const confirm = await vscode.window.showWarningMessage(
        `确定从侧边栏移除项目 "${path.basename(path.dirname(filename))}"？（不会删除磁盘文件）`,
        { modal: true },
        'Remove',
      );
      if (confirm !== 'Remove') return;
      removeProject(filename);
    }),
  );

  // 增量编译单个项目（右键）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildProject', async (node?: any) => {
      const filename = resolveProjectFilename(node);
      if (!filename) return;
      await buildSingleProject(filename, false);
    }),
  );

  // 全量编译单个项目（右键）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.rebuildProject', async (node?: any) => {
      const filename = resolveProjectFilename(node);
      if (!filename) return;
      await buildSingleProject(filename, true);
    }),
  );

  // 添加文件到项目（右键）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.addFile', async (node?: any) => {
      const filename = resolveProjectFilename(node);
      if (!filename) return;
      await addFilesToProject(filename);
    }),
  );

  // 从项目移除文件（保留磁盘文件，写回 .cbp）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.removeFile', async (node?: any) => {
      const { project, file } = resolveFileNode(node);
      if (!project || !file) return;
      await removeFileFromProject(project, file);
    }),
  );

  // 打开文件所在目录（资源管理器）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.openContainingFolder', (node?: any) => {
      const { project, file } = resolveFileNode(node);
      if (!project || !file) return;
      const abs = file.absolutePath;
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(abs));
    }),
  );

  // 切换 compile 开关（写回 .cbp <Option compile="0/1">）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.toggleCompile', async (node?: any) => {
      const { project, file } = resolveFileNode(node);
      if (!project || !file) return;
      await toggleFileOption(project, file, 'compile', file.compile === false ? true : false);
    }),
  );

  // 切换 link 开关（写回 .cbp <Option link="0/1">）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.toggleLink', async (node?: any) => {
      const { project, file } = resolveFileNode(node);
      if (!project || !file) return;
      await toggleFileOption(project, file, 'link', file.link === false ? true : false);
    }),
  );

  // 编辑文件自定义构建命令（右键快捷入口，写回 .cbp <Option buildCommand>）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.editFileBuildCommand', async (node?: any) => {
      const { project, file } = resolveFileNode(node);
      if (!project || !file) return;
      await editFileBuildCommand(project, file);
    }),
  );

  // 打开项目
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.openProject', async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectMany: true,
        filters: {
          'Code::Blocks 项目': ['cbp'],
          'Code::Blocks 工作区': ['workspace'],
        },
      });
      if (!uris || uris.length === 0) return;
      for (const uri of uris) {
        await openProject(uri.fsPath);
      }
    }),
  );

  // 新建工程（对标 Code::Blocks New Project 向导）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.newProject', async () => {
      await createNewProject();
    }),
  );

  // 构建
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.build', async () => {
      await build(false);
    }),
  );

  // 重新构建
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.rebuild', async () => {
      await build(true);
    }),
  );

  // 构建并运行（F9）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildAndRun', async () => {
      const ok = await build(false);
      if (ok) await run();
    }),
  );

  // 清理
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.clean', async () => {
      await clean();
    }),
  );

  // 运行
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.run', async () => {
      await run();
    }),
  );

  // 调试
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.debug', async () => {
      await debug();
    }),
  );

  // 选择目标
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.selectTarget', async () => {
      await promptSelectTarget();
    }),
  );

  // 探测编译器
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.detectCompilers', async () => {
      await detectCompilers();
    }),
  );

  // 编译选项面板
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.compilerOptions', async () => {
      const project = requireProject();
      if (!project) return;
      const targetTitle = await selectTarget();
      const target = targetTitle ? project.buildTargets.find((t) => t.title === targetTitle) : undefined;
      CompilerOptionsPanel.show(getCompiler(), project, target, context.extensionUri);
    }),
  );

  // 工程属性面板（构建目标管理）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.projectProperties', async (node?: any) => {
      const filename = resolveProjectFilename(node);
      const project = filename
        ? openProjects.find((p) => p.filename === filename)
        : requireProject();
      if (!project) return;
      ProjectPropertiesPanel.show(project, context.extensionUri, async (targets, files, options, searchDirs, projectSettings, buildScripts, notes, virtualTargets) => {
        await saveProjectProperties(project, targets, files, options, searchDirs, projectSettings, buildScripts, notes, virtualTargets);
      });
    }),
  );

  // 代码统计
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.codeStats', async () => {
      await showCodeStats();
    }),
  );

  // TODO 列表
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.todoList', async () => {
      await showTodoList();
    }),
  );

  // AStyle 格式化
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.format', async () => {
      await formatActiveDocument();
    }),
  );

  // 状态栏入口：检测到未打开的 .cbp 时显示，点击重新选择打开
  cbpStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 110);
  cbpStatusBar.command = 'codeblocks.openDetectedProject';
  cbpStatusBar.tooltip = '检测到未打开的 Code::Blocks 项目，点击选择打开';
  cbpStatusBar.hide();
  context.subscriptions.push(cbpStatusBar);
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.openDetectedProject', async () => {
      await pickAndOpenCbp(pendingCbpFiles);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.projectManager', async () => {
      await showProjectManager();
    }),
  );

  // 恢复上次会话打开的项目（.workspace 或项目列表）
  await restorePersistedProjects();

  // 自动检测并打开工作区中的 .cbp
  await autoDetectAndOpenProject();

  // 监听工作区文件夹变化，重新检测
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      autoDetectAndOpenProject();
    }),
  );

  // 监听 .cbp 文件的新增/删除（延迟去抖）
  let cbpWatcherTimer: NodeJS.Timeout | undefined;
  const cbpWatcher = vscode.workspace.createFileSystemWatcher('**/*.cbp');
  const scheduleRescan = () => {
    if (cbpWatcherTimer) clearTimeout(cbpWatcherTimer);
    cbpWatcherTimer = setTimeout(() => autoDetectAndOpenProject(), 800);
  };
  cbpWatcher.onDidCreate(scheduleRescan);
  cbpWatcher.onDidDelete(scheduleRescan);
  context.subscriptions.push(cbpWatcher);

  // 初始状态：无工程时仅显示 Code::Blocks 入口，有工程时显示 Target/Build/Rebuild/Compiler
  refreshStatusBars();

  return;
}

/** 自动检测项目：扫描目录下所有 .cbp/.workspace，由用户多选打开 */
async function autoDetectAndOpenProject(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    // 无工作区：若已记录了上次项目则尝试恢复（workspaceState 存储）
    const active = extContext?.workspaceState.get<string>('codeblocks.activeProject', '');
    if (active && fs.existsSync(active) && openProjects.length === 0) {
      await openProject(active);
    }
    return;
  }

  const projectFiles = await findProjectFiles();

  if (projectFiles.length === 0) {
    return;
  }

  // 已打开的项目不重复列在可选列表里（但标记）
  const alreadyOpen = new Set(openProjects.map((p) => p.filename));
  const notOpen = projectFiles.filter((f) => !alreadyOpen.has(f));

  // 更新待打开列表与状态栏入口
  pendingCbpFiles = notOpen;
  updateCbpStatusBar();

  if (notOpen.length === 0) return;

  // 已有项目打开（如 reload 后已恢复上次会话）：不自动打开/弹窗，仅更新状态栏入口
  if (openProjects.length > 0) return;

  // 单文件直接打开；多文件让用户多选
  if (notOpen.length === 1) {
    await openProject(notOpen[0]);
    pendingCbpFiles = [];
    updateCbpStatusBar();
    return;
  }

  await pickAndOpenCbp(notOpen);

  // 打开完成后按持久化顺序排列
  applyPersistedOrder();
}

/** 弹出多选让用户打开检测到的 .cbp（供自动检测与状态栏入口复用） */
async function pickAndOpenCbp(files: string[]): Promise<void> {
  const alreadyOpen = new Set(openProjects.map((p) => p.filename));
  const notOpen = files.filter((f) => !alreadyOpen.has(f));
  if (notOpen.length === 0) {
    pendingCbpFiles = [];
    updateCbpStatusBar();
    return;
  }
  const picked = await vscode.window.showQuickPick(
    notOpen.map((f) => ({
      label: `${path.basename(path.dirname(f))}/${path.basename(f)}`,
      description: f,
      picked: true,
    })),
    {
      title: `检测到 ${notOpen.length} 个 Code::Blocks 项目`,
      placeHolder: '回车打开全部，空格勾选/取消，Esc 跳过',
      canPickMany: true,
    },
  );
  if (picked && picked.length) {
    for (const p of picked) {
      await openProject(p.description!);
    }
  }
  // 重新计算待打开列表（未选中的仍保留在状态栏入口）
  const stillOpen = new Set(openProjects.map((p) => p.filename));
  pendingCbpFiles = notOpen.filter((f) => !stillOpen.has(f));
  updateCbpStatusBar();
}

/** 更新底部状态栏的 Code::Blocks 入口（常驻）：无工程→打开入口，待打开→提示，已打开→项目管理菜单 */
function updateCbpStatusBar(): void {
  if (!cbpStatusBar) return;
  if (openProjects.length > 0) {
    cbpStatusBar.text = `$(project) Code::Blocks: ${openProjects.length} 项目`;
    cbpStatusBar.tooltip = '点击管理项目（打开 / 新建 / 检测工作区项目）';
    cbpStatusBar.command = 'codeblocks.projectManager';
    cbpStatusBar.show();
  } else if (pendingCbpFiles.length > 0) {
    cbpStatusBar.text = `$(project) Code::Blocks 项目 (${pendingCbpFiles.length})`;
    cbpStatusBar.tooltip = '检测到未打开的 Code::Blocks 项目，点击选择打开';
    cbpStatusBar.command = 'codeblocks.openDetectedProject';
    cbpStatusBar.show();
  } else {
    cbpStatusBar.text = '$(project) Code::Blocks';
    cbpStatusBar.tooltip = '点击打开 Code::Blocks 项目';
    cbpStatusBar.command = 'codeblocks.openProject';
    cbpStatusBar.show();
  }
}

/** 项目管理菜单项（扩展 QuickPickItem，携带 action / filename） */
interface ProjectManagerItem extends vscode.QuickPickItem {
  action?: 'open' | 'new' | 'scan';
  filename?: string;
}

/** 构建项目管理菜单项：打开 / 新建 / 检测工作区项目 + 已打开项目（活动标记 + 移除按钮） */
function buildManagerItems(): ProjectManagerItem[] {
  const items: ProjectManagerItem[] = [
    { label: '$(folder-opened) 打开项目...', description: '打开 .cbp / .workspace', action: 'open' },
    { label: '$(new-file) 新建工程...', description: '从模板创建 Code::Blocks 工程', action: 'new' },
    { label: '$(search) 检测工作区项目...', description: '扫描并打开工作区中的 .cbp / .workspace', action: 'scan' },
  ];
  if (openProjects.length > 0) {
    items.push({ label: '已打开项目', kind: vscode.QuickPickItemKind.Separator });
    for (const p of openProjects) {
      const isActive = p.filename === activeProject?.filename;
      items.push({
        label: `${isActive ? '$(circle-filled)' : '$(circle-outline)'} ${p.title || path.basename(p.filename, '.cbp')}`,
        description: `${path.basename(path.dirname(p.filename))}${isActive ? ' · 活动' : ''}`,
        detail: p.filename,
        filename: p.filename,
        buttons: [{ iconPath: new vscode.ThemeIcon('close'), tooltip: '从侧边栏移除项目' }],
      });
    }
  }
  return items;
}

/** 项目管理菜单：打开 / 新建 / 检测工作区项目，下方内联已打开项目（选中即切换活动工程，按钮移除，菜单保持打开） */
async function showProjectManager(): Promise<void> {
  const qp = vscode.window.createQuickPick<ProjectManagerItem>();
  qp.title = 'Code::Blocks';
  qp.placeholder = '选择操作，或点击已打开项目切换活动工程';
  qp.matchOnDescription = true;
  qp.items = buildManagerItems();

  // 实时切换：选中已打开项目立即设为活动工程（菜单保持打开）
  qp.onDidChangeSelection((sel) => {
    const item = sel[0];
    if (item?.filename) {
      const proj = openProjects.find((p) => p.filename === item.filename);
      if (proj) setActiveProject(proj, { persist: true });
    }
  });

  // 回车：执行动作或关闭
  qp.onDidAccept(async () => {
    const item = qp.selectedItems[0];
    if (!item) {
      qp.hide();
      return;
    }
    if (item.action === 'open') {
      qp.hide();
      await vscode.commands.executeCommand('codeblocks.openProject');
    } else if (item.action === 'new') {
      qp.hide();
      await vscode.commands.executeCommand('codeblocks.newProject');
    } else if (item.action === 'scan') {
      qp.hide();
      await scanAndOpenWorkspaceProjects();
    } else if (item.filename) {
      const proj = openProjects.find((p) => p.filename === item.filename);
      if (proj) setActiveProject(proj, { persist: true });
      qp.hide();
    }
  });

  // 移除按钮：点击移除项目并刷新列表
  qp.onDidTriggerItemButton((e) => {
    if (e.item.filename) {
      removeProject(e.item.filename);
      qp.items = buildManagerItems();
    }
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}

/** 工作区项目选择项（扩展 QuickPickItem，携带 filename） */
interface WorkspaceProjectPickItem extends vscode.QuickPickItem {
  filename: string;
}

/** 扫描工作区所有 .cbp/.workspace，多选打开（已打开则设为活动工程） */
async function scanAndOpenWorkspaceProjects(): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    vscode.window.showWarningMessage('请先打开一个工作区文件夹');
    return;
  }
  const files = await findProjectFiles();
  if (files.length === 0) {
    vscode.window.showInformationMessage('工作区未检测到 .cbp / .workspace 项目');
    return;
  }
  const openSet = new Set(openProjects.map((p) => p.filename));
  const items: WorkspaceProjectPickItem[] = files.map((f) => {
    const isOpen = openSet.has(f);
    return {
      label: `${isOpen ? '$(circle-filled)' : '$(circle-outline)'} ${path.basename(path.dirname(f))}/${path.basename(f)}`,
      description: isOpen ? '已打开' : '',
      detail: f,
      picked: !isOpen,
      filename: f,
    };
  });
  const picked = await vscode.window.showQuickPick(items, {
    title: `检测到 ${files.length} 个 Code::Blocks 项目`,
    placeHolder: '回车打开，空格勾选/取消，Esc 跳过',
    canPickMany: true,
  });
  if (!picked || picked.length === 0) return;
  for (const p of picked) {
    const f = p.filename;
    if (openSet.has(f)) {
      // 已打开：设为活动工程（不重复打开）
      const proj = openProjects.find((x) => x.filename === f);
      if (proj) setActiveProject(proj, { persist: true });
    } else {
      await openProject(f);
    }
  }
  updateCbpStatusBar();
}

/** 扫描工作区所有项目文件（.cbp + .workspace，并行 + 去重；findFiles 全局搜索多根工作区） */
async function findProjectFiles(): Promise<string[]> {
  const [cbps, wss] = await Promise.all([
    vscode.workspace.findFiles('**/*.cbp', '**/node_modules/**', 500),
    vscode.workspace.findFiles('**/*.workspace', '**/node_modules/**', 500),
  ]);
  return [...new Set([...cbps, ...wss].map((u) => u.fsPath))];
}

/** 编译器探测结果缓存（按 masterPath 失效） */
let cachedCompilersMasterPath: string | undefined;
let cachedCompilers: DetectedCompiler[] = [];

/** 获取探测到的编译器（缓存；masterPath 变化时重新探测） */
function getDetectedCompilers(masterPath: string): DetectedCompiler[] {
  if (cachedCompilersMasterPath !== masterPath) {
    cachedCompilersMasterPath = masterPath;
    try {
      cachedCompilers = detectAllCompilers(masterPath);
    } catch {
      cachedCompilers = [];
    }
  }
  return cachedCompilers;
}

/** 选择编译器（内置模板 + 探测到的实际编译器），返回编译器 ID */
async function pickCompiler(): Promise<string | undefined> {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const defaultId = cfg.get<string>('compilerId', 'gcc');
  const masterPath = cfg.get<string>('masterPath', '');

  const detected = getDetectedCompilers(masterPath);

  const seen = new Set<string>();
  const items: { label: string; description?: string }[] = [];
  const push = (id: string, description?: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    items.push({ label: id, description });
  };

  // 内置模板优先（gcc / clang；MSVC 仅 Windows 平台）
  push('gcc', defaultId === 'gcc' ? '默认' : undefined);
  push('clang', defaultId === 'clang' ? '默认' : undefined);
  if (process.platform === 'win32') {
    push('msvc17');
  }
  // 探测到的（去重；MSVC id 统一映射到 msvc17，与 options_msvc17.xml 对齐）
  for (const d of detected) {
    const id = d.id === 'msvc' ? 'msvc17' : d.id;
    push(id, id === defaultId ? '默认' : (d.version ? `v${d.version}` : undefined));
  }

  const picked = await vscode.window.showQuickPick(items, { placeHolder: '选择编译器' });
  return picked?.label ?? defaultId;
}

/** 新建工程向导（模板选择 → 名称 → 目录 → 编译器 → 生成 .cbp + 骨架文件 → 打开） */
async function createNewProject(): Promise<void> {
  // 1. 选择模板
  const tplPick = await vscode.window.showQuickPick(
    PROJECT_TEMPLATES.map((t) => ({ label: t.label, description: t.description, template: t })),
    { placeHolder: '选择工程模板', matchOnDescription: true },
  );
  if (!tplPick) return;
  const tpl = (tplPick as any).template;

  // 2. 输入工程名
  const name = await vscode.window.showInputBox({
    prompt: '输入工程名称',
    placeHolder: 'my-project',
    validateInput: (v) => {
      if (!v.trim()) return '工程名不能为空';
      if (/[<>:"/\\|?*\x00-\x1f]/.test(v)) return '工程名含非法字符';
      return undefined;
    },
  });
  if (!name?.trim()) return;

  // 3. 选择父目录（默认工作区根）
  const defaultUri = vscode.workspace.workspaceFolders?.[0]?.uri;
  const dirUris = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    defaultUri,
    openLabel: '选择父目录',
    title: '选择工程存放目录',
  });
  const basePath = dirUris?.[0]?.fsPath ?? defaultUri?.fsPath;
  if (!basePath) {
    vscode.window.showWarningMessage('请先打开一个工作区文件夹，或选择一个目录');
    return;
  }

  // 4. 选择编译器
  const compilerId = await pickCompiler();
  if (!compilerId) return;

  // 5. 生成模型并落盘
  const { project, projectDir } = createProjectFromTemplate(name.trim(), basePath, tpl, compilerId);
  try {
    fs.mkdirSync(projectDir, { recursive: true });
    // 骨架源文件
    for (const f of tpl.skeleton) {
      fs.writeFileSync(path.join(projectDir, f.name), f.content, 'utf-8');
    }
    // .cbp
    const xml = serializeProject(project);
    fs.writeFileSync(project.filename, xml, 'utf-8');
    outputChannel.info(`[Code::Blocks] 已创建工程: ${project.title}（${tpl.label}）`);
  } catch (err) {
    vscode.window.showErrorMessage(`创建工程失败: ${(err as Error).message}`);
    return;
  }

  // 5. 打开
  await openProject(project.filename);
}

async function openProject(filename: string): Promise<void> {
  try {
    if (filename.endsWith('.workspace')) {
      const ws = new WorkspaceParser().parse(filename);
      // 依赖解析为绝对路径（相对 .workspace 目录），供构建时拓扑排序
      const depsAbs: Record<string, string[]> = {};
      for (const [proj, deps] of Object.entries(ws.dependencies)) {
        depsAbs[path.join(ws.basePath, proj)] = deps.map((d) => path.join(ws.basePath, d));
      }
      workspaceDeps = depsAbs;
      // 打开全部项目（对齐 CodeBlocks workspaceloader 第一遍循环）
      for (const rel of ws.projectPaths) {
        await openProject(path.join(ws.basePath, rel));
      }
      // 设置激活项目（active="1"），缺省保持第一个打开的项目
      if (ws.activeProject) {
        const activeAbs = path.join(ws.basePath, ws.activeProject);
        const activeProj = openProjects.find((p) => p.filename === activeAbs);
        if (activeProj) setActiveProject(activeProj, { persist: true });
      }
      // 记住 .workspace 路径，reload 后恢复（重新打开全部项目 + 依赖）
      await extContext?.workspaceState.update('codeblocks.openedWorkspace', filename);
      return;
    }

    // 已打开则跳过解析/入列表，但仍重新生成 clangd 配置文件（每次打开都刷新）
    if (openProjects.some((p) => p.filename === filename)) {
      void generateClangdForWorkspace();
      return;
    }

    const project = new ProjectParser().parse(filename);
    openProjects.push(project);
    if (!activeProject) {
      // 优先恢复上次持久化的活动工程；否则默认第一个打开的工程
      const persisted = extContext?.workspaceState.get<string>('codeblocks.activeProject', '');
      activeProject = (persisted && openProjects.find((p) => p.filename === persisted)) || project;
    }
    outputChannel.info(`[Code::Blocks] 已打开项目: ${project.title}`);
    outputChannel.info(`  目标: ${project.buildTargets.map((t) => t.title).join(', ')}`);

    // 刷新项目树（活动项目高亮随 activeProject 同步）
    projectTreeProvider?.setProjects(openProjects);
    projectTreeProvider?.setActiveProject(activeProject);

    // 重建兜底符号索引（clangd 不可用时提供项目内补全）
    rebuildFallbackIndex();

    // 每个工程各自默认选中第一个目标（对齐 CodeBlocks m_ActiveTarget = GetFirstValidBuildTargetName()）
    const titles = project.buildTargets.map((t) => t.title);
    if (titles.length && !getSelectedTarget(project)) {
      setSelectedTarget(project, titles[0]);
    }
    refreshStatusBars();

    // 持久化打开的项目顺序
    await persistProjectOrder();

    // 仅当新打开工程即活动工程时记录活动路径（避免用非活动工程覆盖上次选择）
    if (activeProject?.filename === filename) {
      await extContext?.workspaceState.update('codeblocks.activeProject', filename);
    }

    vscode.window.showInformationMessage(`已打开 Code::Blocks 项目: ${project.title}`);

    // 生成 compile_commands.json（clangd 补全，写到工作区外缓存），失败不阻塞
    void generateClangdForWorkspace();
  } catch (err) {
    vscode.window.showErrorMessage(`打开项目失败: ${(err as Error).message}`);
  }
}

/** 构建前自动保存（对齐 Code::Blocks 的 Save all files before build） */
async function saveAllBeforeBuild(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  if (cfg.get<boolean>('saveBeforeBuild', true)) {
    await vscode.workspace.saveAll(false);
  }
}

function requireProject(): Project | undefined {
  if (!activeProject) {
    vscode.window.showWarningMessage('请先打开一个 Code::Blocks 项目 (.cbp)');
    return undefined;
  }
  return activeProject;
}

/** 从 workspaceState 载入各工程构建目标记忆 */
function loadSelectedTargets(): void {
  const saved = extContext?.workspaceState.get<Record<string, string>>(SELECTED_TARGETS_KEY);
  selectedTargets = saved ? new Map(Object.entries(saved)) : new Map();
}

/** 持久化各工程构建目标记忆 */
function persistSelectedTargets(): void {
  void extContext?.workspaceState.update(SELECTED_TARGETS_KEY, Object.fromEntries(selectedTargets));
}

/** 获取工程的构建目标（无记忆返回 undefined） */
function getSelectedTarget(project: Project): string | undefined {
  return selectedTargets.get(project.filename);
}

/** 设置工程的构建目标（无变化则不写，避免无谓持久化） */
function setSelectedTarget(project: Project, title: string): void {
  if (selectedTargets.get(project.filename) === title) return;
  selectedTargets.set(project.filename, title);
  persistSelectedTargets();
}

/** 归一化路径（正斜杠 + 小写，Windows 大小写不敏感比较） */
function normPath(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase();
}

/** 统一设置活动工程：更新全局状态、树高亮、状态栏，并按需持久化 */
function setActiveProject(project: Project | undefined, opts: { persist?: boolean } = {}): void {
  if (activeProject?.filename === project?.filename) return;
  activeProject = project;
  projectTreeProvider?.setActiveProject(project);
  refreshStatusBars();
  if (opts.persist && project) {
    void extContext?.workspaceState.update('codeblocks.activeProject', project.filename);
  }
  // 仅当存在共享文件时才需重建（共享文件按活动工程去重）；无共享文件则 DB 内容与活动工程无关
  if (hasSharedFiles()) {
    // 标记：若 DB 实际变化，则重启 clangd 强制刷新已打开文件
    restartClangdAfterGeneration = true;
    void generateClangdForWorkspace();
  }
}

/** 是否有打开的 C/C++ 源文件（用于判断是否值得重启 clangd 刷新诊断） */
function hasOpenSourceFile(): boolean {
  return vscode.window.visibleTextEditors.some((e) =>
    /\.(c|cpp|cc|cxx|h|hpp|hh|hxx)$/i.test(e.document.uri.fsPath),
  );
}

/** 重启 clangd（最佳努力；clangd 扩展未安装时静默忽略） */
async function restartClangd(): Promise<void> {
  try {
    await vscode.commands.executeCommand('clangd.restart');
  } catch {
    // 忽略：clangd 扩展不存在或命令不可用
  }
}

/** 是否存在被多个工程共享的文件（同一源文件出现在多个 .cbp 中） */
function hasSharedFiles(): boolean {
  const seen = new Set<string>();
  for (const p of openProjects) {
    const local = new Set<string>();
    const addAll = (files: ProjectFile[]) => {
      for (const f of files) {
        local.add(path.normalize(f.absolutePath).toLowerCase());
      }
    };
    addAll(p.files);
    for (const t of p.buildTargets) addAll(t.files);
    for (const key of local) {
      if (seen.has(key)) return true;
      seen.add(key);
    }
  }
  return false;
}

/** 将活动工程同步到当前活动编辑器所属工程（文件被多个/零个工程拥有时保持现状） */
function syncActiveProjectToEditor(): void {
  const fsPath = vscode.window.activeTextEditor?.document?.uri?.fsPath;
  if (!fsPath) return;
  const norm = normPath(fsPath);
  // 精确匹配优先：文件被唯一工程收录时才切换
  let owner: Project | undefined;
  const exactOwners = openProjects.filter((p) =>
    p.files?.some((f) => normPath(f.absolutePath || f.relativeFilename) === norm),
  );
  if (exactOwners.length === 1) {
    owner = exactOwners[0];
  } else {
    // 回退：按工程树（commonTopLevelPath）唯一包含判断
    const treeOwners = openProjects.filter((p) => {
      const root = normPath(p.commonTopLevelPath || p.basePath).replace(/\/+$/, '');
      return !!root && (norm === root || norm.startsWith(root + '/'));
    });
    if (treeOwners.length === 1) owner = treeOwners[0];
  }
  if (owner && owner.filename !== activeProject?.filename) {
    setActiveProject(owner, { persist: true });
  }
}

/** 计算多个目录的公共祖先目录（Windows 大小写不敏感比较，返回带尾分隔符） */
function commonAncestor(dirs: string[]): string {
  if (!dirs.length) return '';
  const norm = dirs.map((d) => path.resolve(d).split(path.sep));
  const first = norm[0];
  let prefix: string[] = [];
  for (let i = 0; i < first.length; i++) {
    const seg = first[i].toLowerCase();
    if (norm.every((p) => (p[i] ?? '').toLowerCase() === seg)) {
      prefix.push(first[i]);
    } else {
      break;
    }
  }
  let dir = prefix.join(path.sep);
  if (!dir.endsWith(path.sep)) dir += path.sep;
  return dir;
}

/** 路径短哈希（用于缓存目录命名） */
function hashPath(p: string): string {
  return crypto.createHash('md5').update(p.replace(/\\/g, '/').toLowerCase()).digest('hex').slice(0, 12);
}

/** 从烘焙后的编译命令中提取 -I 目录并解析为绝对路径（供头文件回退 flag 使用） */
function extractAbsoluteIncludeDirs(entries: CompileCommandEntry[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of entries) {
    // 兼容 -Ipath / -I "path" / -I"path" 三种写法（含空格路径）
    const re = /-I\s*"([^"]+)"|-I\s*([^\s"]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(e.command)) !== null) {
      const raw = m[1] ?? m[2];
      if (!raw) continue;
      const abs = path.resolve(e.directory, raw);
      const norm = path.normalize(abs);
      if (!seen.has(norm)) {
        seen.add(norm);
        out.push(abs);
      }
    }
  }
  return out;
}

/** 从项目 + 目标编译选项中提取影响 multilib / 目标架构的 flag（供 GCC include 查询选择正确系统头目录） */
function extractMultilibFlags(project: Project, target?: BuildTarget): string[] {
  const opts = [...(project.compilerOptions ?? []), ...(target?.compilerOptions ?? [])];
  const re = /^-(march|mcpu|mfpu|mfloat-abi|mabi|mtune)=/;
  const out: string[] = [];
  for (const o of opts) {
    const t = o.trim();
    if (re.test(t)) out.push(t);
  }
  return out;
}

/**
 * 为整个工作区生成 clangd 所需的 compile_commands.json（写到工作区外的缓存目录），
 * 并更新用户级 clangd 配置（config.yaml，If.PathMatch 按工程树作用域指向缓存目录）。
 * 不生成/修改工作区内的 .clangd 或 compile_commands.json，不影响用户自有文件。
 * 带去抖 + 单飞：打开多个项目会连续触发，合并为一次，避免并发写同一文件。
 */
async function generateClangdForWorkspace(interactive = false): Promise<void> {
  if (clangdGenTimer) clearTimeout(clangdGenTimer);
  clangdGenTimer = setTimeout(() => {
    clangdGenTimer = undefined;
    void runClangdGeneration(interactive);
  }, 150);
}

async function runClangdGeneration(interactive: boolean): Promise<void> {
  if (clangdGenRunning) return; // 上一次还在跑，丢弃本次（后续触发会重新调度）
  clangdGenRunning = true;
  try {
    await generateClangdForWorkspaceInternal(interactive);
  } finally {
    clangdGenRunning = false;
  }
}

async function generateClangdForWorkspaceInternal(interactive: boolean): Promise<void> {
  // 捕获本次是否由「活动工程切换」触发（用于 DB 变化后决定是否重启 clangd）
  const restartRequested = restartClangdAfterGeneration;
  restartClangdAfterGeneration = false;
  try {
    if (!extContext) return;
    const cfg = vscode.workspace.getConfiguration('codeblocks');
    const clangdEnabled = cfg.get<boolean>('clangd.enabled', true);
    if (!clangdEnabled) {
      fallbackEnabled = true; // clangd 集成禁用，启用兜底补全
      clangdDiagnosticsEnabled = false;
      outputChannel.warn('[Code::Blocks] clangd 集成已禁用（codeblocks.clangd.enabled = false）');
      return;
    }

    const clangd = detectClangd();
    fallbackEnabled = !clangd; // 检测到 clangd 则禁用兜底补全，避免重复提示
    clangdDiagnosticsEnabled = !!clangd; // 检测到 clangd 则构建引擎停止向 Problems 面板报错

    if (!openProjects.length) return;

    // 收集所有打开项目的编译单元（每项目用其编译器 + 该系统 include 路径）。
    // 活动工程排最前：共享文件（同文件出现在多个工程）时保留活动工程的编译命令（对齐 CodeBlocks 活动工程决定 flag）。
    const orderedProjects = [
      ...openProjects.filter((p) => p.filename === activeProject?.filename),
      ...openProjects.filter((p) => p.filename !== activeProject?.filename),
    ];
    const entries: CompileCommandEntry[] = [];
    const seenFiles = new Set<string>();
    const scopePaths: string[] = [];
    const includeCache = new Map<string, string[]>();
    const systemIncludesAll = new Set<string>();
    let targetTriple: string | undefined;
    for (const p of orderedProjects) {
      try {
        const targetCompilerId = p.buildTargets[0]?.compilerId ?? p.compilerId;
        const compiler = getCompiler(targetCompilerId);
        const cacheKey = compiler.programs.C || compiler.name;
        let systemIncludes = includeCache.get(cacheKey);
        if (!systemIncludes && clangd) {
          // 带上目标架构 flag（-march 等），让 GCC 选择正确的 multilib 系统头目录
          const multilibFlags = extractMultilibFlags(p, p.buildTargets[0]);
          systemIncludes = queryCompilerSystemIncludes(compiler.programs.C, compiler.programs.CPP, multilibFlags);
          includeCache.set(cacheKey, systemIncludes);
          if (!targetTriple) targetTriple = queryCompilerTarget(compiler.programs.C);
        }
        if (systemIncludes) {
          for (const d of systemIncludes) systemIncludesAll.add(path.normalize(d));
        }
        // 同一文件只保留一条（活动工程优先，因其排在最前）
        for (const e of collectClangdEntries(p, compiler, outputChannel, systemIncludes ?? [])) {
          const key = path.normalize(e.file).toLowerCase();
          if (seenFiles.has(key)) continue;
          seenFiles.add(key);
          entries.push(e);
        }
        scopePaths.push(p.commonTopLevelPath || p.basePath);
      } catch (err) {
        // 单个项目失败不影响其它项目
        outputChannel.error(`[Code::Blocks] 生成编译命令失败（项目 ${p.title}）: ${(err as Error).message}`);
      }
    }

    if (!entries.length) return;

    // 缓存目录：<globalStorage>/clangd/<公共祖先哈希>
    const scope = commonAncestor(scopePaths) || (activeProject?.basePath ?? '');
    const cacheDir = path.join(extContext.globalStorageUri.fsPath, 'clangd', hashPath(scope));
    const { outPath, count, skipped } = writeClangdDatabase(entries, cacheDir);
    outputChannel.info(`[Code::Blocks] ${skipped
      ? 'compile_commands.json 未变化，跳过写入'
      : `已重新生成 compile_commands.json（${count} 条编译命令）→ ${outPath}`}`);

    // 活动工程切换且 DB 实际变化：重启 clangd，让已打开文件按新编译命令重新分析
    if (restartRequested && !skipped && cfg.get<boolean>('clangd.restartOnActiveProjectSwitch', true) && hasOpenSourceFile()) {
      outputChannel.info('[Code::Blocks] 活动工程已切换，重启 clangd 以刷新已打开文件');
      void restartClangd();
    }

    if (clangd) {
      // 头文件回退 flag：编译数据库里只有 .c 条目，头文件需靠 Add 提供 -I/-isystem/--target
      const includeDirs = extractAbsoluteIncludeDirs(entries);
      const headerFlags: string[] = [];
      if (targetTriple) headerFlags.push(`--target=${targetTriple}`);
      // -I 与路径拆成两个独立元素（与 -isystem 一致），避免含空格路径依赖 clangd 的拆分行为
      for (const d of includeDirs) {
        headerFlags.push('-I', d.replace(/\\/g, '/'));
      }
      // 基础头文件预包含：头文件单独分析时缺类型/宏上下文（unknown type name u8/u16 等）。
      // 用 global.h（typedef.h + macro.h + sfr.h + clib.h），而非 include.h：
      // include.h 会包含几乎所有头文件，对「被 include.h 包含的头文件」造成递归包含
      // （clangd 报 main file cannot be included recursively），进而产生大量级联错误。
      const forcedIncludes = cfg.get<string[]>('clangd.forcedIncludes', ['global.h']);
      for (const h of forcedIncludes) {
        if (includeDirs.some((d) => fs.existsSync(path.join(d, h)))) {
          headerFlags.push('-include', h);
        }
      }
      for (const d of systemIncludesAll) {
        headerFlags.push('-isystem', d.replace(/\\/g, '/'));
      }
      // 头文件单独分析时压制全部诊断（SDK 头文件不自包含，误报多）；.c 文件诊断不受影响
      const suppressHeader = cfg.get<boolean>('clangd.suppressHeaderDiagnostics', true);
      if (suppressHeader) {
        // 放开错误上限：递归级联虽被 Suppress:* 隐藏，但会计数触发「too many errors」汇总，放开后消除
        headerFlags.push('-ferror-limit=0');
      }

      // 更新用户级 clangd 配置（工作区外，If.PathMatch 作用域到本工程树）
      const suppressedWarnings = cfg.get<string[]>('clangd.suppressedWarnings', ['-Wunused-function']);
      updateClangdUserConfig([{
        dir: scope,
        databaseDir: cacheDir,
        headerFlags,
        suppressedWarnings,
        suppressHeaderDiagnostics: suppressHeader,
      }]);
      outputChannel.info(`[Code::Blocks] 已更新 clangd 用户配置 → ${clangdUserConfigPath()}`);
      outputChannel.info(`[Code::Blocks] 检测到 clangd: ${clangd}`);
      if (interactive) {
        vscode.window.showInformationMessage(`已生成 compile_commands.json（${count} 条）并检测到 clangd，补全 / 跳转已就绪`);
      }
    } else {
      outputChannel.warn('[Code::Blocks] 未检测到 clangd，补全 / 跳转暂不可用。安装方式见下方提示。');
      if (interactive) {
        const pick = await vscode.window.showWarningMessage(
          '未检测到 clangd。请安装 VS Code 扩展 "clangd" 并执行其 "Download language server" 命令，或安装 LLVM 工具链。',
          '打开扩展市场',
          '了解安装方法',
        );
        if (pick === '打开扩展市场') {
          vscode.commands.executeCommand('workbench.extensions.search', 'llvm-vs-code-extensions.vscode-clangd');
        } else if (pick === '了解安装方法') {
          vscode.env.openExternal(vscode.Uri.parse('https://clangd.llvm.org/installation.html'));
        }
      }
    }
  } catch (err) {
    vscode.window.showErrorMessage(`生成 compile_commands.json 失败: ${(err as Error).message}`);
  }
}

/** 重建兜底符号索引（收集所有已打开项目及其目标的源文件） */
function rebuildFallbackIndex(): void {
  const files = new Set<string>();
  for (const p of openProjects) {
    for (const f of p.files) files.add(f.absolutePath);
    for (const t of p.buildTargets) {
      for (const f of t.files) files.add(f.absolutePath);
    }
  }
  fallbackIndex.rebuild([...files]);
  symbolTreeProvider?.refresh();
}

/** 持久化项目打开顺序到 workspaceState */
async function persistProjectOrder(): Promise<void> {
  if (!extContext) return;
  await extContext.workspaceState.update(
    'codeblocks.projectOrder',
    openProjects.map((p) => p.filename),
  );
}

/** 从 workspaceState 恢复项目顺序 */
function restoreProjectOrder(): string[] {
  return extContext?.workspaceState.get<string[]>('codeblocks.projectOrder') ?? [];
}

/** 恢复上次会话打开的项目：优先 .workspace（重新打开全部项目+依赖），否则按持久化顺序恢复各项目 */
async function restorePersistedProjects(): Promise<void> {
  if (openProjects.length > 0) return;
  const wsPath = extContext?.workspaceState.get<string>('codeblocks.openedWorkspace', '');
  if (wsPath && fs.existsSync(wsPath)) {
    await openProject(wsPath);
    return;
  }
  const order = restoreProjectOrder();
  const fallback = extContext?.workspaceState.get<string>('codeblocks.activeProject', '') ?? '';
  const list = order.length ? order : [fallback].filter(Boolean);
  for (const fn of list) {
    if (fn && fs.existsSync(fn) && !openProjects.some((p) => p.filename === fn)) {
      await openProject(fn);
    }
  }
}

/** 拖拽重排：把 src 移到 target 之前（target 为空则移到最后） */
function reorderProjects(srcFilename: string, targetFilename: string | undefined): void {
  const srcIdx = openProjects.findIndex((p) => p.filename === srcFilename);
  if (srcIdx === -1) return;

  const [moved] = openProjects.splice(srcIdx, 1);
  if (!targetFilename) {
    openProjects.push(moved);
  } else {
    const targetIdx = openProjects.findIndex((p) => p.filename === targetFilename);
    if (targetIdx === -1) {
      openProjects.push(moved);
    } else {
      openProjects.splice(targetIdx, 0, moved);
    }
  }
  projectTreeProvider?.setProjects(openProjects);
  persistProjectOrder();
}

/** 按持久化顺序重排已打开的项目（恢复上次会话的编译顺序） */
function applyPersistedOrder(): void {
  const order = restoreProjectOrder();
  if (!order.length) return;
  const byFilename = new Map(openProjects.map((p) => [p.filename, p]));
  const reordered: Project[] = [];
  for (const fn of order) {
    const p = byFilename.get(fn);
    if (p) {
      reordered.push(p);
      byFilename.delete(fn);
    }
  }
  // 剩余（未在持久化顺序中的新项目）追加到末尾
  for (const p of byFilename.values()) reordered.push(p);
  openProjects = reordered;
  projectTreeProvider?.setProjects(openProjects);
}

/** 从右键菜单传入的节点参数中解析项目 filename */
function resolveProjectFilename(node: any): string | undefined {
  if (!node) return undefined;
  // 右键菜单传入的可能是 TreeNode，也可能是 { project: { filename } }
  const filename = node?.project?.filename;
  return typeof filename === 'string' ? filename : undefined;
}

/** 创建默认空构建目标（对齐 ProjectBuildTarget 构造默认值） */
function createEmptyTarget(): BuildTarget {
  return {
    title: '',
    targetType: TargetType.ConsoleOnly,
    compilerId: 'gcc',
    outputFilename: '',
    objectOutput: '',
    optionRelations: {
      [OptionsRelationType.CompilerOptions]: OptionsRelation.AppendToParentOptions,
      [OptionsRelationType.LinkerOptions]: OptionsRelation.AppendToParentOptions,
      [OptionsRelationType.IncludeDirs]: OptionsRelation.AppendToParentOptions,
      [OptionsRelationType.LibDirs]: OptionsRelation.AppendToParentOptions,
      [OptionsRelationType.ResDirs]: OptionsRelation.AppendToParentOptions,
    },
    compilerOptions: [],
    linkerOptions: [],
    resourceCompilerOptions: [],
    includeDirs: [],
    libDirs: [],
    resourceIncludeDirs: [],
    linkLibs: [],
    files: [],
    linkerExecutable: LinkerExecutableOption.AutoDetect,
    createDefFile: false,
    createStaticLib: false,
    impLib: '',
    defFile: '',
    useConsoleRunner: true,
    includeInTargetAll: true,
    commandsBeforeBuild: [],
    commandsAfterBuild: [],
    commandsBeforeClean: [],
    commandsAfterClean: [],
    buildScripts: [],
    envVars: [],
    alwaysRunPostBuildSteps: false,
  };
}

/**
 * 保存工程属性面板的编辑结果（构建目标 + 文件归属/编译选项）：
 * 应用增删改 → 同步文件目标归属 → 序列化写回 .cbp → 重新解析刷新树。
 */
async function saveProjectProperties(
  project: Project,
  edits: TargetEditData[],
  fileEdits: FileEditData[],
  options: BuildOptionsEditData,
  searchDirs: SearchDirsEditData,
  projectSettings: ProjectSettingsEditData,
  buildScripts: BuildScriptsEditData,
  notes: NotesEditData,
  virtualTargets: VirtualTargetEditData[],
): Promise<void> {
  // 项目设置（标题/默认编译器/虚拟文件夹）—— 先应用，files 的自定义命令按新默认编译器写入
  project.title = projectSettings.title.trim() || project.title;
  project.compilerId = projectSettings.compilerId.trim() || project.compilerId;
  project.virtualFolders = projectSettings.virtualFolders;
  project.notes = notes.notes;
  project.showNotesOnLoad = notes.showNotesOnLoad;
  project.buildScripts = buildScripts.project.scripts;
  project.commandsBeforeBuild = buildScripts.project.before;
  project.commandsAfterBuild = buildScripts.project.after;

  const oldByOriginal = new Map(project.buildTargets.map((t) => [t.title, t]));
  const renameMap = new Map<string, string>(); // 旧标题 → 新标题
  const newTargets: BuildTarget[] = [];
  const newTitles = new Set<string>();

  for (const e of edits) {
    const title = e.title.trim();
    if (!title) throw new Error('目标标题不能为空');
    if (newTitles.has(title)) throw new Error(`目标标题重复: "${title}"`);

    let t: BuildTarget;
    if (e.originalTitle && oldByOriginal.has(e.originalTitle)) {
      t = oldByOriginal.get(e.originalTitle)!;
      if (t.title !== title) {
        renameMap.set(t.title, title);
        t.title = title;
      }
    } else {
      t = createEmptyTarget();
      t.title = title;
    }
    t.targetType = e.targetType as TargetType;
    t.outputFilename = e.outputFilename;
    t.objectOutput = e.objectOutput || '';
    t.compilerId = e.compilerId.trim() || project.compilerId;
    newTargets.push(t);
    newTitles.add(title);
  }

  // 同步文件目标归属：
  //  - 隐式归属所有目标的文件（未写 target）：保持归属所有新目标
  //  - 显式写了 target 的文件：重命名替换标题，被删除的目标从归属中移除
  for (const f of project.files) {
    if (!f.explicitTargets) {
      f.buildTargets = [...newTitles];
      continue;
    }
    const mapped = new Set<string>();
    for (const bt of f.buildTargets) {
      const mappedTitle = renameMap.get(bt) ?? bt;
      if (newTitles.has(mappedTitle)) mapped.add(mappedTitle);
    }
    f.buildTargets = [...mapped];
  }

  project.buildTargets = newTargets;

  // 应用文件编辑（编译变量 / 编译 / 链接 / 自定义命令 / 目标归属）
  const fileByRel = new Map(project.files.map((f) => [f.relativeFilename, f]));
  for (const fe of fileEdits) {
    const f = fileByRel.get(fe.relativeFilename);
    if (!f) continue;

    // 编译变量：'' 或 'CPP' 视为默认（不写 compilerVar）
    const cv = fe.compilerVar.trim();
    f.compilerVar = cv === 'CC' || cv === 'WINDRES' ? cv : '';
    f.compile = fe.compile;
    f.link = fe.link;
    f.weight = fe.weight;
    f.virtualFolder = fe.virtualFolder;

    // 自定义构建命令：只更新项目默认编译器的映射，保留其它编译器
    const cmp = project.compilerId;
    const cmd = fe.buildCommand.trim();
    if (cmd) {
      f.customBuildCommands[cmp] = { command: cmd, use: true };
    } else {
      delete f.customBuildCommands[cmp];
    }

    // 目标归属：勾选全部 → 隐式归属所有目标；否则显式
    const checked = fe.buildTargets.filter((t) => newTitles.has(t));
    if (checked.length === newTitles.size && newTitles.size > 0) {
      f.explicitTargets = false;
      f.buildTargets = [...newTitles];
    } else {
      f.explicitTargets = true;
      f.buildTargets = checked;
    }
  }

  // 应用编译/链接选项（项目级 + 各目标，options.targets 与 newTargets 顺序对齐）
  project.compilerOptions = options.project.compilerOptions;
  project.linkerOptions = options.project.linkerOptions;
  project.linkLibs = options.project.linkLibs;
  for (let i = 0; i < newTargets.length && i < options.targets.length; i++) {
    newTargets[i].compilerOptions = options.targets[i].compilerOptions;
    newTargets[i].linkerOptions = options.targets[i].linkerOptions;
    newTargets[i].linkLibs = options.targets[i].linkLibs;
    newTargets[i].optionRelations[OptionsRelationType.CompilerOptions] = options.targets[i].relations.compiler;
    newTargets[i].optionRelations[OptionsRelationType.LinkerOptions] = options.targets[i].relations.linker;
    newTargets[i].optionRelations[OptionsRelationType.IncludeDirs] = options.targets[i].relations.include;
    newTargets[i].optionRelations[OptionsRelationType.LibDirs] = options.targets[i].relations.lib;
    newTargets[i].optionRelations[OptionsRelationType.ResDirs] = options.targets[i].relations.res;
  }

  // 应用搜索目录（项目级 + 各目标，与 newTargets 顺序对齐）
  project.includeDirs = searchDirs.project.includeDirs;
  project.libDirs = searchDirs.project.libDirs;
  project.resourceIncludeDirs = searchDirs.project.resourceDirs;
  for (let i = 0; i < newTargets.length && i < searchDirs.targets.length; i++) {
    newTargets[i].includeDirs = searchDirs.targets[i].includeDirs;
    newTargets[i].libDirs = searchDirs.targets[i].libDirs;
    newTargets[i].resourceIncludeDirs = searchDirs.targets[i].resourceDirs;
  }

  // 应用构建脚本 + pre/post build 命令（目标级，与 newTargets 顺序对齐；项目级已在函数开头应用）
  for (let i = 0; i < newTargets.length && i < buildScripts.targets.length; i++) {
    newTargets[i].buildScripts = buildScripts.targets[i].scripts;
    newTargets[i].commandsBeforeBuild = buildScripts.targets[i].before;
    newTargets[i].commandsAfterBuild = buildScripts.targets[i].after;
  }

  // 应用虚拟目标（直接重建：alias + 过滤为仍然存在的新目标标题）
  project.virtualTargets = virtualTargets
    .map((v) => ({ title: v.alias.trim(), targets: v.targets.filter((t) => newTitles.has(t)) }))
    .filter((v) => v.title);

  // 同步选中目标记忆（重命名/删除时保持一致）
  const oldSelected = getSelectedTarget(project);
  if (oldSelected) {
    const mappedSelected = renameMap.get(oldSelected) ?? oldSelected;
    if (newTitles.has(mappedSelected)) {
      setSelectedTarget(project, mappedSelected);
    } else if (newTargets.length) {
      selectedTargets.delete(project.filename);
      persistSelectedTargets();
      setSelectedTarget(project, newTargets[0].title);
    }
  }

  // 序列化写回 .cbp
  const xml = serializeProject(project);
  fs.writeFileSync(project.filename, xml, 'utf-8');
  outputChannel.info(`[Code::Blocks] 已保存工程属性: ${project.title}（${newTargets.length} 个目标）`);

  // 重新解析项目刷新树
  const idx = openProjects.findIndex((p) => p.filename === project.filename);
  if (idx !== -1) openProjects.splice(idx, 1);
  const wasActive = activeProject?.filename === project.filename;
  await openProject(project.filename);
  if (wasActive) {
    activeProject = openProjects.find((p) => p.filename === project.filename);
    projectTreeProvider?.setActiveProject(activeProject);
    updateTargetStatusBar();
    updateCompilerStatusBar();
  }
}


/** 从右键菜单传入的文件节点解析出 project + file */
function resolveFileNode(node: any): { project?: Project; file?: ProjectFile } {
  if (!node) return {};
  const project: Project | undefined = node?.project;
  const file: ProjectFile | undefined = node?.file;
  return { project, file };
}

/** 上移/下移项目（delta: -1 上移，1 下移） */
function moveProject(filename: string, delta: number): void {
  const idx = openProjects.findIndex((p) => p.filename === filename);
  if (idx === -1) return;
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= openProjects.length) return;
  const [moved] = openProjects.splice(idx, 1);
  openProjects.splice(targetIdx, 0, moved);
  projectTreeProvider?.setProjects(openProjects);
  persistProjectOrder();
}

/** 移除项目（仅从侧边栏移除，不删除磁盘文件） */
function removeProject(filename: string): void {
  const idx = openProjects.findIndex((p) => p.filename === filename);
  if (idx === -1) return;
  const [removed] = openProjects.splice(idx, 1);
  if (activeProject?.filename === filename) {
    setActiveProject(openProjects[0], { persist: true });
  }
  projectTreeProvider?.setProjects(openProjects);
  refreshStatusBars();
  persistProjectOrder();
  rebuildFallbackIndex();
  outputChannel.info(`[Code::Blocks] 已移除项目: ${removed.title}`);
}

/** 从项目移除文件（保留磁盘文件，写回 .cbp 删除对应 <Unit> 节点） */
async function removeFileFromProject(project: Project, file: ProjectFile): Promise<void> {
  const confirm = await vscode.window.showWarningMessage(
    `从项目 "${path.basename(path.dirname(project.filename))}" 中移除文件 "${path.basename(file.relativeFilename)}"？（磁盘文件保留）`,
    { modal: true },
    'Remove',
  );
  if (confirm !== 'Remove') return;

  try {
    removeUnitFromCbp(project.filename, file.relativeFilename);
    outputChannel.info(`[Code::Blocks] 已从项目移除文件: ${file.relativeFilename}`);
    // 重新解析项目刷新树
    const idx = openProjects.findIndex((p) => p.filename === project.filename);
    if (idx !== -1) openProjects.splice(idx, 1);
    const wasActive = activeProject?.filename === project.filename;
    await openProject(project.filename);
    if (wasActive) {
      activeProject = openProjects.find((p) => p.filename === project.filename);
      projectTreeProvider?.setActiveProject(activeProject);
      updateTargetStatusBar();
      updateCompilerStatusBar();
    }
  } catch (err) {
    vscode.window.showErrorMessage(`移除文件失败: ${(err as Error).message}`);
  }
}

/** 切换文件 compile/link 选项（写回 .cbp） */
async function toggleFileOption(project: Project, file: ProjectFile, opt: 'compile' | 'link', enable: boolean): Promise<void> {
  try {
    setUnitOptionInCbp(project.filename, file.relativeFilename, opt, enable);
    const name = opt === 'compile' ? '编译' : '链接';
    outputChannel.info(`[Code::Blocks] 文件 ${file.relativeFilename} ${name} = ${enable}`);
    // 重新解析项目刷新树
    const idx = openProjects.findIndex((p) => p.filename === project.filename);
    if (idx !== -1) openProjects.splice(idx, 1);
    const wasActive = activeProject?.filename === project.filename;
    await openProject(project.filename);
    if (wasActive) {
      activeProject = openProjects.find((p) => p.filename === project.filename);
      projectTreeProvider?.setActiveProject(activeProject);
      updateTargetStatusBar();
      updateCompilerStatusBar();
    }
  } catch (err) {
    vscode.window.showErrorMessage(`切换${opt === 'compile' ? '编译' : '链接'}选项失败: ${(err as Error).message}`);
  }
}

/** 编辑文件自定义构建命令（右键快捷入口；留空则删除，写回 .cbp <Option buildCommand>） */
async function editFileBuildCommand(project: Project, file: ProjectFile): Promise<void> {
  const cmp = project.compilerId;
  const current = file.customBuildCommands[cmp];
  const value = await vscode.window.showInputBox({
    title: `自定义构建命令: ${file.relativeFilename}`,
    prompt: `默认编译器 "${cmp}"；留空则删除该文件的自定义构建命令`,
    value: current?.command ?? '',
    placeHolder: '例如: make -f custom.mk',
    ignoreFocusOut: true,
  });
  if (value === undefined) return; // 用户取消

  // 对齐工程属性面板：trim 后为空则删除，否则启用该编译器的自定义命令
  const cmd = value.trim();
  if (cmd) {
    file.customBuildCommands[cmp] = { command: cmd, use: true };
  } else {
    delete file.customBuildCommands[cmp];
  }

  try {
    const xml = serializeProject(project);
    fs.writeFileSync(project.filename, xml, 'utf-8');
    outputChannel.info(`[Code::Blocks] 已更新自定义构建命令: ${file.relativeFilename}`);
    // 重新解析项目刷新树
    const idx = openProjects.findIndex((p) => p.filename === project.filename);
    if (idx !== -1) openProjects.splice(idx, 1);
    const wasActive = activeProject?.filename === project.filename;
    await openProject(project.filename);
    if (wasActive) {
      activeProject = openProjects.find((p) => p.filename === project.filename);
      projectTreeProvider?.setActiveProject(activeProject);
      updateTargetStatusBar();
      updateCompilerStatusBar();
    }
  } catch (err) {
    vscode.window.showErrorMessage(`更新自定义构建命令失败: ${(err as Error).message}`);
  }
}

/** 从 .cbp 删除指定文件的 <Unit> 节点（按 filename 精确匹配） */
function removeUnitFromCbp(cbpPath: string, relativeFilename: string): void {
  const raw = fs.readFileSync(cbpPath, 'utf-8');
  const escaped = relativeFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 匹配自闭合 <Unit filename="..." /> 或成对 <Unit filename="...">...</Unit>
  const selfClose = new RegExp(`<Unit filename="${escaped}"\\s*/>`, 'g');
  const paired = new RegExp(`<Unit filename="${escaped}"\\s*>[\\s\\S]*?</Unit>`, 'g');
  let out = raw.replace(selfClose, '').replace(paired, '');
  if (out === raw) throw new Error(`未在 .cbp 中找到文件 "${relativeFilename}"`);
  fs.writeFileSync(cbpPath, out, 'utf-8');
}

/** 设置 .cbp 中指定文件的 <Option compile/link> 值（无则新增） */
function setUnitOptionInCbp(cbpPath: string, relativeFilename: string, opt: 'compile' | 'link', enable: boolean): void {
  const raw = fs.readFileSync(cbpPath, 'utf-8');
  const escaped = relativeFilename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const val = enable ? '1' : '0';

  // 定位该 <Unit> 节点（自闭合或成对）
  const selfCloseRe = new RegExp(`<Unit filename="${escaped}"\\s*/>`, 'g');
  const pairedRe = new RegExp(`<Unit filename="${escaped}"\\s*>([\\s\\S]*?)</Unit>`, 'g');

  let m = pairedRe.exec(raw);
  if (m) {
    // 成对节点：更新或新增 <Option compile/link>
    const inner = m[1];
    const optRe = new RegExp(`<Option ${opt}="[01]"\\s*/>`, 'g');
    let newInner: string;
    if (optRe.test(inner)) {
      newInner = inner.replace(new RegExp(`<Option ${opt}="[01]"\\s*/>`, 'g'), `<Option ${opt}="${val}" />`);
    } else {
      newInner = `\n\t\t\t<Option ${opt}="${val}" />${inner}`;
    }
    const newUnit = `<Unit filename="${relativeFilename}">${newInner}</Unit>`;
    const out = raw.replace(pairedRe, newUnit);
    if (out === raw) throw new Error(`未在 .cbp 中找到文件 "${relativeFilename}"`);
    fs.writeFileSync(cbpPath, out, 'utf-8');
    return;
  }

  // 自闭合节点：展开为成对节点
  selfCloseRe.lastIndex = 0;
  if (selfCloseRe.test(raw)) {
    const newUnit = `<Unit filename="${relativeFilename}">\n\t\t\t<Option ${opt}="${val}" />\n\t\t</Unit>`;
    const out = raw.replace(selfCloseRe, newUnit);
    fs.writeFileSync(cbpPath, out, 'utf-8');
    return;
  }

  throw new Error(`未在 .cbp 中找到文件 "${relativeFilename}"`);
}

/** 添加文件到项目（参考 Code::Blocks cbProject::AddFile） */
async function addFilesToProject(filename: string): Promise<void> {
  const project = openProjects.find((p) => p.filename === filename);
  if (!project) {
    vscode.window.showWarningMessage('项目未找到');
    return;
  }

  const uris = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectMany: true,
    canSelectFolders: false,
    openLabel: '添加文件',
    filters: {
      '源文件': ['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'rc', 's', 'S'],
      '所有文件': ['*'],
    },
  });
  if (!uris || uris.length === 0) return;

  const basePath = project.basePath;
  const existing = new Set(project.files.map((f) => f.relativeFilename));
  const addedUnits: string[] = [];
  const addedCount = { value: 0 };

  for (const uri of uris) {
    const abs = uri.fsPath;
    // 计算相对项目根的 Unix 路径（对应 Code::Blocks 的 relativeFilename，可能含 ../）
    const rel = path.relative(basePath, abs).replace(/\\/g, '/');
    if (!rel) continue;
    if (existing.has(rel)) {
      continue; // 已存在，跳过
    }
    existing.add(rel);

    // 按扩展名决定 compilerVar（对应 Code::Blocks 的 C_EXT/RESOURCE_EXT/CPP）
    const ext = path.extname(abs).toLowerCase();
    const unit = buildUnitXml(rel, ext);
    addedUnits.push(unit);
    addedCount.value++;
  }

  if (addedUnits.length === 0) {
    vscode.window.showInformationMessage('没有新文件需要添加（可能已存在）');
    return;
  }

  // 写回 .cbp：在 </Project> 之前插入 <Unit> 节点
  try {
    writeUnitsToCbp(project.filename, addedUnits);
    outputChannel.info(`[Code::Blocks] 已向 ${path.basename(project.filename)} 添加 ${addedCount.value} 个文件`);
    // 重新解析项目以刷新树（移除旧的再重新打开）
    const idx = openProjects.findIndex((p) => p.filename === project.filename);
    if (idx !== -1) openProjects.splice(idx, 1);
    const wasActive = activeProject?.filename === project.filename;
    await openProject(project.filename);
    if (wasActive) {
      activeProject = openProjects.find((p) => p.filename === project.filename);
      projectTreeProvider?.setActiveProject(activeProject);
      updateTargetStatusBar();
      updateCompilerStatusBar();
    }
  } catch (err) {
    vscode.window.showErrorMessage(`添加文件失败: ${(err as Error).message}`);
  }
}

/** 根据扩展名生成 <Unit> 节点文本（对应 cbProject::AddFile 的 compilerVar 判定）
 *  Code::Blocks 规则（cbproject.cpp AddFile / projectloader.cpp SaveUnit）：
 *    - 仅 ".c" → compilerVar="CC"
 *    - 仅 Windows 平台 ".rc" → compilerVar="WINDRES"
 *    - 其余（.cpp/.cc/.cxx/.h/.hpp/.s/.S 等）→ 默认 CPP，保存时省略 compilerVar 属性
 */
function buildUnitXml(rel: string, ext: string): string {
  let compilerVar = 'CPP';
  if (ext === '.c') compilerVar = 'CC';
  else if (ext === '.rc' && process.platform === 'win32') compilerVar = 'WINDRES';

  if (compilerVar === 'CPP') {
    // 默认 CPP 不写 compilerVar（Code::Blocks 对默认情况省略，自闭合）
    return `\t\t<Unit filename="${rel}" />`;
  }
  return `\t\t<Unit filename="${rel}">\n\t\t\t<Option compilerVar="${compilerVar}" />\n\t\t</Unit>`;
}

/** 在 </Project> 之前插入 <Unit> 节点（保留原文件格式） */
function writeUnitsToCbp(cbpPath: string, units: string[]): void {
  let raw = fs.readFileSync(cbpPath, 'utf-8');
  // 找到 </Project> 前的缩进；简单做法：在 </Project> 前插入
  const marker = '</Project>';
  const idx = raw.lastIndexOf(marker);
  if (idx === -1) throw new Error('找不到 </Project> 节点');
  const insert = units.join('\n') + '\n';
  raw = raw.slice(0, idx) + insert + raw.slice(idx);
  fs.writeFileSync(cbpPath, raw, 'utf-8');
}

function getCompiler(compilerId?: string): Compiler {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const id = compilerId ?? cfg.get<string>('compilerId', 'gcc');
  const masterPath = cfg.get<string>('masterPath', '');
  if (compilerLoader) {
    const compiler = compilerLoader.load(id);
    compiler.masterPath = masterPath;

    // 优先：CodeBlocks 用户自定义编译器（如 riscv32-v2）——从 default.conf 解析程序路径
    const userPrograms = codeBlocksConfig?.resolvePrograms(id);
    if (userPrograms) {
      compiler.programs = {
        ...compiler.programs,
        C: userPrograms.C,
        CPP: userPrograms.CPP,
        LD: userPrograms.LD,
        LIB: userPrograms.LIB,
        WINDRES: compiler.programs.WINDRES || '',
        MAKE: compiler.programs.MAKE || '',
        DBGconfig: compiler.programs.DBGconfig || 'gdb_debugger:Default',
      };
      compiler.masterPath = userPrograms.masterPath;
      return compiler;
    }

    // 次优：探测到的完整程序路径（交叉编译器如 RISC-V）
    const programs = cfg.get<Record<string, string>>('compilerPrograms', {});
    if (programs && programs.C) {
      compiler.programs = { ...compiler.programs, ...programs } as any;
    }
    return compiler;
  }
  // 回退：内置 GCC
  const { createGccCompiler } = require('./compiler/compiler');
  return createGccCompiler(process.platform, masterPath);
}

async function detectCompilers(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const masterPath = cfg.get<string>('masterPath', '');
  const detected = detectAllCompilers(masterPath);

  if (detected.length === 0) {
    vscode.window.showWarningMessage('未探测到可用的编译器（GCC/Clang/MSVC/RISC-V）');
    return;
  }

  const picked = await vscode.window.showQuickPick(
    detected.map((d) => ({
      label: d.name,
      description: d.version ?? d.masterPath,
      detail: d.cCompilerPath,
      compiler: d,
    })),
    { placeHolder: '选择要使用的编译器' },
  );

  if (picked) {
    await cfg.update('compilerId', picked.compiler.id, vscode.ConfigurationTarget.Global);
    if (picked.compiler.masterPath) {
      await cfg.update('masterPath', picked.compiler.masterPath, vscode.ConfigurationTarget.Global);
    }
    // 交叉编译器：持久化完整程序路径；标准编译器：清空以回退到 PATH 查找
    if (picked.compiler.programs) {
      await cfg.update('compilerPrograms', picked.compiler.programs, vscode.ConfigurationTarget.Global);
    } else {
      await cfg.update('compilerPrograms', {}, vscode.ConfigurationTarget.Global);
    }
    vscode.window.showInformationMessage(`已选择编译器: ${picked.compiler.name}`);
    updateCompilerStatusBar();
  }
}

async function showCodeStats(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  const files = project.files
    .map((f) => f.absolutePath)
    .filter((p) => isSourceFile(p));

  if (files.length === 0) {
    vscode.window.showWarningMessage('项目没有可统计的源文件');
    return;
  }

  const { perFile, aggregate } = countFiles(files);

  outputChannel.clear();
  outputChannel.info('=== 代码统计 ===');
  outputChannel.info(`文件数: ${aggregate.files}`);
  outputChannel.info(`总行数: ${aggregate.total}`);
  outputChannel.info(`代码行: ${aggregate.code}`);
  outputChannel.info(`注释行: ${aggregate.comment}`);
  outputChannel.info(`空行:   ${aggregate.blank}`);
  outputChannel.info('');
  outputChannel.info('--- 各文件明细 ---');
  for (const s of perFile) {
    outputChannel.info(
      `${s.filename}\t总${s.total} 码${s.code} 注${s.comment} 空${s.blank}`,
    );
  }
  outputChannel.show(true);
}

async function showTodoList(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  const files = project.files.map((f) => f.absolutePath);
  const todos = scanTodos(files);

  if (todos.length === 0) {
    vscode.window.showInformationMessage('项目中没有 TODO/FIXME/NOTE 标记');
    return;
  }

  outputChannel.clear();
  outputChannel.info(`=== TODO 列表 (${todos.length} 项) ===`);
  for (const t of todos) {
    const loc = `${path.basename(t.filename)}:${t.line}`;
    const user = t.user ? ` [${t.user}]` : '';
    outputChannel.info(`${t.type}${user} ${loc}: ${t.text}`);
  }
  outputChannel.show(true);
}

/** 更新底部状态栏的构建目标显示 */
function updateTargetStatusBar(): void {
  if (!targetStatusBar) return;
  if (activeProject) {
    const t = getSelectedTarget(activeProject);
    targetStatusBar.text = t ? `$(symbol-method) Target: ${t}` : '$(symbol-method) Target: —';
    targetStatusBar.show();
  } else {
    targetStatusBar.hide();
  }
}

/** 获取当前编译器友好显示名（优先用户自定义编译器名，回退 ID） */
function currentCompilerName(): string {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const id = cfg.get<string>('compilerId', 'gcc');
  const masterPath = cfg.get<string>('masterPath', '');

  // 优先：按 ID 查找（default.conf 的 user_sets，如 riscv32 / riscv32_v2）
  let userCfg = codeBlocksConfig?.find(id);
  // 探测到的 RISC-V 统一 id="riscv" 找不到时，按 masterPath 区分 V1/V2
  if (!userCfg && masterPath) {
    userCfg = codeBlocksConfig?.findByMasterPath(masterPath);
  }

  if (userCfg) {
    // 用户自定义编译器：优先 NAME；若 NAME 缺少「-Vx」版本后缀，
    // 从 masterPath 末尾目录名（如 RV32-V1 / RV32-V2）提取，以区分同系列不同版本
    const name = userCfg.name || userCfg.id;
    const refPath = userCfg.masterPath || masterPath;
    if (refPath && !/-v\d/i.test(name)) {
      const ver = path.basename(refPath).trim();
      const m = ver.match(/-v(\d+)/i);
      if (m) {
        return `${name}-V${m[1]}`;
      }
    }
    return name;
  }

  // 兜底：从 masterPath 提取版本（如 ...\RV32-V2 → RV32-V2）
  if (masterPath) {
    const ver = path.basename(masterPath).trim();
    if (/rv32|riscv/i.test(ver) || /v\d/i.test(ver)) {
      return ver;
    }
  }
  return id;
}

/** 更新底部状态栏的编译器显示 */
function updateCompilerStatusBar(): void {
  if (!compilerStatusBar) return;
  if (openProjects.length > 0) {
    compilerStatusBar.text = `$(tools) Compiler: ${currentCompilerName()}`;
    compilerStatusBar.show();
  } else {
    compilerStatusBar.hide();
  }
}

/** 统一刷新底部状态栏所有按钮的可见性与文本（无工程时仅显示 Code::Blocks 入口） */
function refreshStatusBars(): void {
  updateTargetStatusBar();
  updateCompilerStatusBar();
  if (buildStatusBar) {
    if (openProjects.length > 0) buildStatusBar.show();
    else buildStatusBar.hide();
  }
  if (rebuildStatusBar) {
    if (openProjects.length > 0) rebuildStatusBar.show();
    else rebuildStatusBar.hide();
  }
  updateCbpStatusBar();
}

/** 返回当前活动工程选中的构建目标标题；未选中时默认第一个（构建/运行/调试的兜底入口） */
async function selectTarget(): Promise<string | undefined> {
  const project = requireProject();
  if (!project) return undefined;
  const titles = project.buildTargets.map((t) => t.title);
  if (titles.length === 0) {
    vscode.window.showWarningMessage('项目没有构建目标');
    return undefined;
  }
  // 该工程已记忆且目标仍存在则直接返回，不弹窗
  const remembered = getSelectedTarget(project);
  if (remembered && titles.includes(remembered)) {
    return remembered;
  }
  // 未记忆：默认选中第一个目标，不弹窗
  setSelectedTarget(project, titles[0]);
  updateTargetStatusBar();
  return titles[0];
}

/** 强制弹出选择框切换指定工程的构建目标 */
async function promptSelectTargetForProject(project: Project): Promise<void> {
  const titles = project.buildTargets.map((t) => t.title);
  if (titles.length === 0) {
    vscode.window.showWarningMessage('项目没有构建目标');
    return;
  }
  const current = getSelectedTarget(project);
  const picked = await vscode.window.showQuickPick(
    titles.map((t) => ({ label: t, description: t === current ? '当前' : undefined })),
    { placeHolder: `选择构建目标: ${project.title}` },
  );
  if (picked) {
    setSelectedTarget(project, picked.label);
    updateTargetStatusBar();
    vscode.window.showInformationMessage(`已切换到构建目标: ${picked.label}`);
  }
}

/** 强制弹出选择框切换构建目标（点击状态栏项 / 菜单「选择目标」时调用） */
async function promptSelectTarget(): Promise<void> {
  const project = requireProject();
  if (!project) return;
  await promptSelectTargetForProject(project);
}

/** 按 .workspace 依赖拓扑排序构建顺序（依赖先；无依赖保持原顺序；环则跳过避免死循环） */
function topologicalBuildOrder(projects: Project[]): Project[] {
  if (!Object.keys(workspaceDeps).length) return [...projects];
  const byName = new Map(projects.map((p) => [p.filename, p]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: Project[] = [];
  const visit = (p: Project): void => {
    const key = p.filename;
    if (visited.has(key) || visiting.has(key)) return;
    visiting.add(key);
    for (const depAbs of workspaceDeps[key] ?? []) {
      const dep = byName.get(depAbs);
      if (dep) visit(dep);
    }
    visiting.delete(key);
    visited.add(key);
    result.push(p);
  };
  for (const p of projects) visit(p);
  return result;
}

async function build(rebuild: boolean): Promise<boolean> {
  if (openProjects.length === 0) {
    vscode.window.showWarningMessage('请先打开一个 Code::Blocks 项目 (.cbp)');
    return false;
  }

  // 构建前自动保存工作区未保存文件
  await saveAllBeforeBuild();

  diagnosticCollection.clear();
  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.info(`[Code::Blocks] 开始构建 ${rebuild ? '(重新构建)' : ''}...（共 ${openProjects.length} 个项目）`);

  const buildStartMs = Date.now();
  currentBuildProjects.length = 0;
  currentBuildErrorCount = 0;
  maxErrorsReached = false;

  const total = openProjects.length;
  let done = 0;
  let allOk = true;

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Code::Blocks ${rebuild ? '重新构建' : '构建'}中...`, cancellable: false },
    async (progress) => {
      // 工作区构建：每个工程构建它自己的活动目标（对齐 CodeBlocks Build Workspace 语义）
      // 依赖排序：依赖工程先构建（.workspace 的 <Depends>，DFS 拓扑排序）
      for (const project of topologicalBuildOrder(openProjects)) {
        const targetTitle = getSelectedTarget(project) ?? project.buildTargets[0]?.title;
        if (!targetTitle) {
          outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 没有构建目标，跳过`);
          done++;
          progress.report({ increment: 100 / total });
          continue;
        }
        progress.report({ message: `${done + 1}/${total} ${project.title}` });
        const ok = await buildOneProject(project, targetTitle, rebuild);
        done++;
        progress.report({ increment: 100 / total });
        if (!ok) {
          allOk = false;
          break;
        }
      }

      const { errorCount, warningCount } = buildResultStats();
      if (allOk) {
        outputChannel.info('[Code::Blocks] 构建成功');
        vscode.window.showInformationMessage(`✅ 构建成功 · ${errorCount} 错误 · ${warningCount} 警告`);
      } else {
        outputChannel.error('[Code::Blocks] 构建失败');
        vscode.window.showErrorMessage(`❌ 构建失败 · ${errorCount} 错误 · ${warningCount} 警告`);
      }
      finishBuildSummary(allOk, buildStartMs);
    },
  );

  return allOk;
}

/** 构建单个项目（右键菜单的 Build/Rebuild 使用） */
async function buildSingleProject(filename: string, rebuild: boolean): Promise<void> {
  const project = openProjects.find((p) => p.filename === filename);
  if (!project) {
    vscode.window.showWarningMessage('项目未找到');
    return;
  }
  // 单工程编译时，活动工程也切换为该工程（状态栏 / 后续构建 / clangd 随之更新）
  setActiveProject(project, { persist: true });
  await saveAllBeforeBuild();

  const targetTitle = getSelectedTarget(project) ?? project.buildTargets[0]?.title;
  if (!targetTitle) {
    vscode.window.showWarningMessage('项目没有构建目标');
    return;
  }

  diagnosticCollection.clear();
  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.info(`[Code::Blocks] 开始构建 ${rebuild ? '(重新构建)' : ''}...（单项目）`);

  const buildStartMs = Date.now();
  currentBuildProjects.length = 0;
  currentBuildErrorCount = 0;
  maxErrorsReached = false;

  const ok = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Code::Blocks ${rebuild ? '重新构建' : '构建'}中...`, cancellable: false },
    async (progress) => {
      progress.report({ message: project.title });
      return buildOneProject(project, targetTitle, rebuild);
    },
  );

  const { errorCount, warningCount } = buildResultStats();
  if (ok) {
    outputChannel.info('[Code::Blocks] 构建成功');
    vscode.window.showInformationMessage(`✅ 构建成功 · ${errorCount} 错误 · ${warningCount} 警告`);
  } else {
    outputChannel.error('[Code::Blocks] 构建失败');
    vscode.window.showErrorMessage(`❌ 构建失败 · ${errorCount} 错误 · ${warningCount} 警告`);
  }
  finishBuildSummary(ok, buildStartMs);
}

/** 构建单个项目的一个目标（被 build / buildSingleProject 复用） */
async function buildOneProject(project: Project, targetTitle: string, rebuild: boolean): Promise<boolean> {
  const target = project.buildTargets.find((t) => t.title === targetTitle);
  if (!target) {
    outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 无目标 "${targetTitle}"，跳过`);
    return true;
  }

  const compiler = getCompiler(target.compilerId || project.compilerId);
  outputChannel.info('');
  outputChannel.info(`=== 构建项目: ${project.title} / 目标: ${targetTitle} ===`);
  outputChannel.info(`  使用编译器: ${compiler.programs.C}`);

  // 本次项目构建的摘要数据（供 Build Log 视图）
  const diagnostics: BuildLogDiagnostic[] = [];
  const startMs = Date.now();

  const engine = new BuildEngine(project, compiler, outputChannel);
  const ok = await engine.build(targetTitle, {
    rebuild,
    onLine: (line, severity) => {
      if (severity === 'error') outputChannel.error(line);
      else if (severity === 'warning') outputChannel.warn(line);
      else outputChannel.info(line);
    },
    onDiagnostic: (diag, fileUri) => {
      // clangd 接管诊断时，Problems 面板由 clangd 产出，构建引擎不再写入（避免重复）
      if (clangdDiagnosticsEnabled) return;
      // 按具体文件 URI 分组挂到 Problems 面板；无文件则回退到项目根
      const uri = fileUri ?? vscode.Uri.file(project.basePath);
      const diags = diagnosticCollection.get(uri) ?? [];
      diagnosticCollection.set(uri, [...diags, diag]);
    },
    onStructuredDiagnostic: (d) => {
      // Build Log 使用 clangd 诊断时，不再收集构建引擎的结构化诊断
      if (clangdDiagnosticsEnabled && buildLogUsesClangdDiagnostics()) return;
      // maxReportedErrors 截断：达到上限后停止收集（CodeBlocks max_reported_errors）
      const maxErrors = vscode.workspace.getConfiguration('codeblocks').get<number>('maxReportedErrors', 50);
      if (d.severity === 'error') {
        if (maxErrors > 0 && currentBuildErrorCount >= maxErrors) {
          maxErrorsReached = true;
          return;
        }
        currentBuildErrorCount++;
      }
      diagnostics.push(d);
    },
  });

  const durationMs = Date.now() - startMs;
  const stats = engine.lastStats ?? { success: ok, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: ok, linkSkipped: true, outputFilename: undefined };
  const projectName = path.basename(path.dirname(project.filename));

  // === 构建完成汇总块（OUTPUT 文本，Emoji 风格）===
  const doneSym = ok ? '✅' : '❌';
  const errCount = diagnostics.filter((d) => d.severity === 'error').length;
  const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;
  outputChannel.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  outputChannel.info(`${doneSym} 构建完成: ${project.title} (${targetTitle})`);
  outputChannel.info(`🔨 编译 ${stats.compiledCount} · ⏭️ 跳过 ${stats.skippedCount} · ❌ 失败 ${stats.failedCount}`);
  if (!stats.linkSkipped) {
    outputChannel.info(`${stats.linkSuccess ? '🔗' : '❌'} 链接${stats.linkSuccess ? '成功' : '失败'}${stats.outputFilename ? ` → ${stats.outputFilename}` : ''}`);
  }
  outputChannel.info(`🐞 错误 ${errCount} · ⚠️ 警告 ${warnCount}`);
  outputChannel.info(`⏱️ 用时 ${(durationMs / 1000).toFixed(1)}s`);
  outputChannel.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 项目源文件绝对路径（供「Build Log 使用 clangd 诊断」模式收集诊断）
  const projectFiles = new Set<string>();
  for (const f of project.files) projectFiles.add(f.absolutePath);
  for (const t of project.buildTargets) {
    for (const f of t.files) projectFiles.add(f.absolutePath);
  }

  currentBuildProjects.push({
    projectName,
    targetName: targetTitle,
    compilerPath: compiler.programs.C || compiler.name,
    success: ok,
    compiledCount: stats.compiledCount,
    skippedCount: stats.skippedCount,
    failedCount: stats.failedCount,
    linkSuccess: stats.linkSuccess,
    linkSkipped: stats.linkSkipped,
    outputFilename: stats.outputFilename,
    diagnostics,
    files: [...projectFiles],
    durationMs,
    startTime: startMs,
  });

  if (!ok) {
    outputChannel.error(`[Code::Blocks] 项目 "${project.title}" 编译失败`);
  }
  return ok;
}

/** Build Log 是否使用 clangd 诊断（否则用构建引擎完整诊断） */
function buildLogUsesClangdDiagnostics(): boolean {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  return cfg.get<string>('clangd.buildLogDiagnostics', 'build') === 'clangd';
}

/** 从 VS Code 收集 clangd 发布的诊断（只对打开过/正在分析的文件有效） */
function collectClangdDiagnostics(files: string[]): BuildLogDiagnostic[] {
  const out: BuildLogDiagnostic[] = [];
  for (const f of files) {
    const diags = vscode.languages.getDiagnostics(vscode.Uri.file(f));
    for (const d of diags) {
      const sev = d.severity === vscode.DiagnosticSeverity.Error
        ? 'error'
        : d.severity === vscode.DiagnosticSeverity.Warning ? 'warning' : undefined;
      if (!sev) continue;
      out.push({
        severity: sev,
        message: d.message,
        file: f,
        line: d.range.start.line + 1,
        column: d.range.start.character + 1,
      });
    }
  }
  return out;
}

/** 统计本次构建的错误 / 警告数（供通知与 Build Log 树视图共用） */
function buildResultStats(): { errorCount: number; warningCount: number } {
  const errorCount = currentBuildProjects.reduce((n, p) => n + p.diagnostics.filter((d) => d.severity === 'error').length, 0);
  const warningCount = currentBuildProjects.reduce((n, p) => n + p.diagnostics.filter((d) => d.severity === 'warning').length, 0);
  return { errorCount, warningCount };
}

/** 构建结束：汇总所有项目摘要，写入 Build Log 树视图 */
function finishBuildSummary(allOk: boolean, buildStartMs: number): void {
  if (!buildLogTreeProvider) return;

  // clangd 接管诊断且配置为 clangd 来源时，用 clangd 的诊断填充 Build Log
  if (clangdDiagnosticsEnabled && buildLogUsesClangdDiagnostics()) {
    for (const p of currentBuildProjects) {
      p.diagnostics = collectClangdDiagnostics(p.files ?? []);
    }
  }

  const { errorCount, warningCount } = buildResultStats();
  buildLogTreeProvider.setSummary({
    success: allOk,
    durationMs: Date.now() - buildStartMs,
    startTime: buildStartMs,
    projects: [...currentBuildProjects],
    errorCount,
    warningCount,
    truncated: maxErrorsReached,
  });
  // 达到上限时提示（CodeBlocks "More errors follow but not being shown"）
  if (maxErrorsReached) {
    outputChannel.warn('[Code::Blocks] 错误数达到上限，后续错误不再显示（可在设置 codeblocks.maxReportedErrors 调整）');
  }
  // 引导用户查看结构化摘要（不强制弹出）
  vscode.commands.executeCommand('codeblocks.buildLog.focus');
}

async function clean(): Promise<void> {
  const project = requireProject();
  if (!project) return;
  // 清理前自动保存
  await saveAllBeforeBuild();
  for (const target of project.buildTargets) {
    // 删除对象输出目录
    const objDir = target.objectOutput ? path.join(project.basePath, target.objectOutput) : '';
    if (objDir && fs.existsSync(objDir)) {
      fs.rmSync(objDir, { recursive: true, force: true });
    }
    // 删除输出文件（含 Windows 无扩展名输出时自动追加的 .exe）
    if (target.outputFilename) {
      const out = path.join(project.basePath, target.outputFilename);
      for (const p of [out, out + '.exe']) {
        if (fs.existsSync(p)) {
          fs.rmSync(p, { force: true });
        }
      }
    }
  }
  outputChannel.info('[Code::Blocks] 清理完成');
}

async function run(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  // 运行前自动保存
  await saveAllBeforeBuild();

  const selectedTitle = await selectTarget();
  const target = project.buildTargets.find((t) => t.title === selectedTitle);
  if (!target) return;

  const exePath = path.join(project.basePath, target.outputFilename);
  if (!fs.existsSync(exePath)) {
    vscode.window.showErrorMessage('可执行文件不存在，请先构建');
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `Run: ${target.title}`,
    cwd: project.basePath,
  });
  terminal.show();
  terminal.sendText(`"${exePath}"`);
}

async function debug(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  // 调试前自动保存
  await saveAllBeforeBuild();

  const selectedTitle = await selectTarget();
  const target = project.buildTargets.find((t) => t.title === selectedTitle);
  if (!target) return;

  const exePath = path.join(project.basePath, target.outputFilename);
  if (!fs.existsSync(exePath)) {
    vscode.window.showErrorMessage('可执行文件不存在，请先构建');
    return;
  }

  // 定位 GDB
  const gdbPath = await locateGdb();
  if (!gdbPath) {
    vscode.window.showErrorMessage('未找到 GDB 调试器，请确认已安装 MinGW/gdb');
    return;
  }

  const started = await vscode.debug.startDebugging(undefined, {
    type: 'codeblocks',
    name: `Debug: ${target.title}`,
    request: 'launch',
    program: exePath,
    cwd: project.basePath,
    gdbPath,
  });

  if (!started) {
    vscode.window.showErrorMessage('调试启动失败');
  }
}

/** 定位 GDB 可执行文件 */
async function locateGdb(): Promise<string | undefined> {
  const win = process.platform === 'win32';
  const gdbName = win ? 'gdb.exe' : 'gdb';
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const masterPath = cfg.get<string>('masterPath', '');
  if (masterPath) {
    const gdb = path.join(masterPath, 'bin', gdbName);
    if (fs.existsSync(gdb)) return gdb;
  }
  // PATH 中查找
  const pathVar = process.env.PATH ?? '';
  const sep = win ? ';' : ':';
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    const full = path.join(dir, gdbName);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}

/** .ld / .xm 语法高亮的 token 颜色规则（对齐 hightlight-demo 的 Dark+ 配色；scope 后缀唯一，仅命中这两类文件） */
const LD_XM_TOKEN_RULES: { scope: string; settings: { foreground?: string; fontStyle?: string } }[] = [
  // === ld 链接脚本 ===
  { scope: 'keyword.control.directive.ld', settings: { foreground: '#C586C0' } },
  { scope: 'string.quoted.double.ld', settings: { foreground: '#CE9178' } },
  { scope: 'keyword.control.ld', settings: { foreground: '#C586C0' } },
  { scope: 'support.function.ld', settings: { foreground: '#DCDCAA' } },
  { scope: 'storage.modifier.ld', settings: { foreground: '#C586C0' } },
  { scope: 'storage.modifier.region-attr.ld', settings: { foreground: '#4EC9B0' } },
  { scope: 'support.type.ld', settings: { foreground: '#9CDCFE' } },
  { scope: 'constant.language.macro.ld', settings: { foreground: '#9CDCFE' } },
  { scope: 'variable.other.ld', settings: { foreground: '#4FC1FF' } },
  { scope: 'entity.name.function.ld', settings: { foreground: '#DCDCAA' } },
  { scope: 'entity.name.section.ld', settings: { foreground: '#B5CEA8' } },
  { scope: 'constant.numeric.hex.ld', settings: { foreground: '#B5CEA8' } },
  { scope: 'constant.numeric.decimal.ld', settings: { foreground: '#B5CEA8' } },
  { scope: 'keyword.operator.ld', settings: { foreground: '#D4D4D4' } },
  { scope: 'keyword.operator.assignment.ld', settings: { foreground: '#FF79C6' } },
  { scope: 'punctuation.separator.comma.ld', settings: { foreground: '#FF8C00' } },
  { scope: 'punctuation.terminator.statement.ld', settings: { foreground: '#FF5555' } },
  { scope: 'punctuation.separator.colon.ld', settings: { foreground: '#D4D4D4' } },
  // === xm 配置脚本 ===
  { scope: 'keyword.control.directive.xm', settings: { foreground: '#C586C0' } },
  { scope: 'keyword.control.xm', settings: { foreground: '#C586C0' } },
  { scope: 'storage.type.xm', settings: { foreground: '#4FC1FF' } },
  { scope: 'variable.other.constant.xm', settings: { foreground: '#9CDCFE' } },
  { scope: 'constant.other.mac-address.xm', settings: { foreground: '#DCDCAA' } },
  { scope: 'constant.numeric.hex.xm', settings: { foreground: '#B5CEA8' } },
  { scope: 'constant.numeric.decimal.xm', settings: { foreground: '#B5CEA8' } },
  { scope: 'keyword.operator.xm', settings: { foreground: '#D4D4D4' } },
  { scope: 'punctuation.separator.comma.xm', settings: { foreground: '#FF8C00' } },
  { scope: 'punctuation.terminator.statement.xm', settings: { foreground: '#FF5555' } },
  { scope: 'punctuation.definition.string.begin.xm', settings: { foreground: '#CE9178' } },
  { scope: 'punctuation.definition.string.end.xm', settings: { foreground: '#CE9178' } },
  { scope: 'string.quoted.double.xm', settings: { foreground: '#D4D4D4' } },
];

/** 安装/激活时自动把 .ld/.xm 的 token 颜色规则合并写入用户 settings.json（幂等，不覆盖用户其他规则） */
async function applyTokenColorCustomizations(): Promise<void> {
  const KEY = 'editor.tokenColorCustomizations';
  const cfg = vscode.workspace.getConfiguration();
  const inspect = cfg.inspect<{ textMateRules?: unknown[] }>(KEY);
  const current = (inspect?.globalValue ?? {}) as { textMateRules?: unknown[] };
  const currentRules: unknown[] = Array.isArray(current?.textMateRules) ? current.textMateRules : [];
  // 判定一条规则是否属于 ld/xm（scope 含 .ld/.xm 后缀或 source.ld/source.xm 前缀）
  const isLdXmRule = (r: unknown): boolean => {
    const s = (r as { scope?: string })?.scope ?? '';
    return /\.ld\b|\.xm\b|source\.ld|source\.xm/.test(s);
  };
  const kept = currentRules.filter((r) => !isLdXmRule(r));
  const merged = [...kept, ...LD_XM_TOKEN_RULES];
  if (JSON.stringify(merged) !== JSON.stringify(currentRules)) {
    await cfg.update(KEY, { ...current, textMateRules: merged }, vscode.ConfigurationTarget.Global);
  }
  // 清除旧版本写入的 [xm]/[ld] 括号配对关闭（已改用标准 bracket scope，无需关闭）
  for (const lang of ['xm', 'ld']) {
    const langCfg = vscode.workspace.getConfiguration(`[${lang}]`);
    if (langCfg.inspect<unknown>('editor.bracketPairColorization')?.globalValue !== undefined) {
      await langCfg.update('editor.bracketPairColorization', undefined, vscode.ConfigurationTarget.Global);
    }
  }
}

export function deactivate(): void {
  if (outputChannel) outputChannel.dispose();
  if (diagnosticCollection) diagnosticCollection.dispose();
}
