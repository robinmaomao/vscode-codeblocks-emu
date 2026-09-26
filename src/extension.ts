/**
 * 扩展入口 —— 注册命令、管理项目/构建生命周期
 *
 * 对应 Code::Blocks 的 pluginmanager / compilergcc 插件入口角色。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn } from 'child_process';
import { execFile } from 'child_process';
import { isExecutableTargetType, resolveExecutablePath } from './build/outputPath';
import { ProjectParser, WorkspaceParser } from './model/parser';
import { Project, BuildTarget, ProjectFile, TargetType, CommandType, Workspace, OptionsRelation, OptionsRelationType, LinkerExecutableOption, supportsCurrentPlatform, PLATFORM_ALL } from './model/types';
import { serializeProject } from './model/projectWriter';
import { createProjectFromTemplate, PROJECT_TEMPLATES } from './project/newProject';
import { Compiler } from './compiler/compiler';
import { CompilerOptionsLoader } from './compiler/optionsLoader';
import { CodeBlocksConfig } from './compiler/codeblocksConfig';
import { detectAllCompilers, detectAllCompilersAsync, DetectedCompiler } from './compiler/detector';
import { CompilerOptionsPanel } from './ui/compilerOptionsPanel';
import { ProjectPropertiesPanel, TargetEditData, FileEditData, BuildOptionsEditData, SearchDirsEditData, ProjectSettingsEditData, BuildScriptsEditData, NotesEditData, VirtualTargetEditData, DebuggerSettingsEditData } from './ui/projectPropertiesPanel';
import { ProjectTreeProvider } from './ui/projectTreeProvider';
import { registerStatusBarMenu, MenuDynamicData } from './ui/statusBarMenu';
import { BuildLogTreeProvider, BuildLogProject, BuildLogDiagnostic } from './ui/buildLogTreeProvider';
import { AnalysisTreeProvider, AnalysisData, AnalysisProjectInfo, LastBuildMeta } from './ui/analysisTreeProvider';
import { SymbolTreeProvider } from './ui/symbolTreeProvider';
import { BuildEngine } from './build/buildEngine';
import { BuildCancelSource, BuildCancelHandle } from './build/cancelToken';
import { expandMacros } from './build/scriptRunner';
import { applyGeneratedFiles } from './build/generatedFiles';
import { cbBuiltinVars, replaceCbMacros, globalVariables, envVarMap } from './compiler/cbMacros';
import { buildLogPrefs, msg, quietSuccess } from './build/logLang';
import { decodeText } from './tools/encoding';
import { clearBackticksCache } from './compiler/commandGenerator';
import { OutputParser } from './build/outputParser';
import { collectClangdEntries, writeClangdDatabase, CompileCommandEntry } from './build/compileCommands';
import { detectClangd, queryCompilerSystemIncludes, queryCompilerTarget, updateClangdUserConfig, clangdUserConfigPath } from './tools/clangd';
import { SymbolIndex, registerFallbackIntelliSense } from './tools/codeCompletion';
import { GdbDebugAdapter } from './debug/gdbDebugAdapter';
import { debugStateChanged, getActiveAdapter, setDebugTraceEnabled, setDebugTraceSink } from './debug/debugRegistry';
import { parsePsList, parseTasklist, ProcessInfo } from './debug/miParse';
import { resolveGdbPath } from './debug/gdbLocate';
import { RegistersTreeProvider } from './ui/registersTreeProvider';
import { scanTodos } from './tools/todoScanner';
import { countFiles, isSourceFile } from './tools/codeStats';
import { formatActiveDocument } from './tools/astyle';
import { applyHeaderGuard } from './tools/headerGuard';
import { tidyCommentBlock } from './tools/tidyComments';
import { parseToolsSetting, buildToolInvocation, ToolContext } from './tools/toolRunner';
import { applyCustomVariables } from './model/customVariables';
import { parseProjectDebuggerConfig, mergeRemoteOptions, applyProjectDebuggerConfig, RemoteDebuggingOptions } from './model/projectDebuggerExtensions';
import { setProjectDependencies, wouldCreateCycle } from './model/workspaceWriter';
import { generateMakefile } from './build/makefileExporter';
import { buildProjectFromImport, importDevProject, importDspProject, importVcxproj } from './project/projectImporter';
import { buildTargetExportProject } from './project/exportTarget';
import { collectConflicts, normalizeKey, parseJsonc, KeybindingDef, ConflictItem } from './tools/keybindingConflicts';
import {
  MANAGED_COMMANDS, MANAGED_KEYBINDINGS, buildExportPayload, buildKeybindingRows, computeDesiredEntries,
  diffManaged, parseImportPayload, parseOverrides, readManagedEntries, updateKeybindingsText, validateChord,
} from './tools/keybindingConfig';
import { KeybindingPanel, KeybindingPanelState } from './ui/keybindingPanel';

/** 已打开的项目列表（顺序即编译顺序） */
let openProjects: Project[] = [];
/** 工作区项目依赖（工程绝对路径 → 依赖的绝对路径列表，来自 .workspace 的 <Depends>） */
let workspaceDeps: Record<string, string[]> = {};
/** 当前打开的 .workspace 文件（C1 依赖编辑用；仅打开 .cbp 时为 undefined） */
let openedWorkspaceFile: string | undefined;
/** 当前活动项目（状态栏 Target/Compiler 针对的对象） */
let activeProject: Project | undefined;
let outputChannel: vscode.LogOutputChannel;
let diagnosticCollection: vscode.DiagnosticCollection;
let compilerLoader: CompilerOptionsLoader | undefined;
let compilerResourcesDir = '';
let codeBlocksConfig: CodeBlocksConfig | undefined;
let projectTreeProvider: ProjectTreeProvider | undefined;
let projectTreeView: vscode.TreeView<any> | undefined;
let buildLogTreeProvider: BuildLogTreeProvider | undefined;
let symbolTreeProvider: SymbolTreeProvider | undefined;
let analysisTreeProvider: AnalysisTreeProvider | undefined;
/** 最近一次构建摘要（供工程分析视图） */
let lastBuildMeta: LastBuildMeta | undefined;
let extContext: vscode.ExtensionContext | undefined;
/** 当前一次构建累积的项目摘要（供 Build Log 视图） */
const currentBuildProjects: BuildLogProject[] = [];
/** 本次构建已收集的错误总数（用于 maxReportedErrors 截断判断） */
let currentBuildErrorCount = 0;
/** 本次构建是否因达到 maxReportedErrors 上限而被截断 */
let maxErrorsReached = false;
/** 当前构建的取消源（「停止构建」命令与通知取消按钮共用） */
let currentBuildCancel: BuildCancelSource | undefined;
/** 构建进行中互斥标志（防止双开构建进程打架） */
let buildInProgress = false;

/** 底部状态栏构建目标项 */
let targetStatusBar: vscode.StatusBarItem | undefined;
/** 各工程的构建目标标题（filename -> targetTitle，对齐 CodeBlocks cbProject::m_ActiveTarget 按工程存储） */
let selectedTargets = new Map<string, string>();
/** 各工程构建目标记忆的 workspaceState key */
const SELECTED_TARGETS_KEY = 'codeblocks.selectedTargets';
/** 底部状态栏：构建（Build/Rebuild/Build Workspace/Rebuild Workspace 整合为单项） */
let buildStatusBar: vscode.StatusBarItem | undefined;
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
  // DAP 跟踪（codeblocks.debug.trace）：写入本输出通道
  setDebugTraceSink((line) => outputChannel.appendLine(line));
  const applyDebugTrace = () => setDebugTraceEnabled(
    vscode.workspace.getConfiguration('codeblocks').get<boolean>('debug.trace', false),
  );
  applyDebugTrace();
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('codeblocks.debug.trace')) applyDebugTrace();
  }));
  diagnosticCollection = vscode.languages.createDiagnosticCollection('codeblocks');

  // 安装/激活时自动写入 .ld/.xm 的 token 颜色规则（幂等，仅命中 source.ld/source.xm）
  void applyTokenColorCustomizations();

  // 初始化编译器选项加载器（resources/compilers 目录）
  const resourcesDir = path.join(context.extensionPath, 'resources', 'compilers');
  compilerLoader = new CompilerOptionsLoader(resourcesDir);
  compilerResourcesDir = resourcesDir;

  // 读取 CodeBlocks 用户自定义编译器配置（如 riscv32-v2）
  codeBlocksConfig = new CodeBlocksConfig();
  codeBlocksConfig.load();

  // 注册 DAP 调试器（内联实现，直接驱动 GDB）
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory('codeblocks', {
      // 第五十一轮 E3：把 VS Code 会话 id 传给适配器（多会话时寄存器视图/调试命令跟随聚焦会话）
      createDebugAdapterDescriptor: (session) => new vscode.DebugAdapterInlineImplementation(new GdbDebugAdapter(session.id)),
    }),
  );
  // 第五十一轮 E3：聚焦会话切换 → 刷新注册表状态（寄存器视图即时跟随）
  context.subscriptions.push(vscode.debug.onDidChangeActiveDebugSession(() => debugStateChanged.fire()));

  // 第四十九轮：寄存器视图（调试容器）+ 调试辅助命令
  const registersProvider = new RegistersTreeProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('codeblocks.debug.registers', registersProvider));
  context.subscriptions.push(debugStateChanged.event(() => registersProvider.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('codeblocks.debug.refreshRegisters', () => registersProvider.refresh()));
  context.subscriptions.push(vscode.commands.registerCommand('codeblocks.debug.sendGdbCommand', async () => {
    const adapter = getActiveAdapter();
    if (!adapter || !adapter.isActive()) { vscode.window.showWarningMessage('没有活动的 Code::Blocks 调试会话'); return; }
    const text = await vscode.window.showInputBox({
      prompt: 'GDB 命令：MI 以 - 开头（如 -exec-until main）；其它按 CLI 执行（如 add-symbol-file app.elf）',
      placeHolder: 'add-symbol-file build/app.elf',
    });
    if (!text || !text.trim()) return;
    try {
      const out = await adapter.sendUserCommand(text);
      vscode.window.setStatusBarMessage(`GDB: ${out || 'OK'}`, 4000);
    } catch (err) {
      vscode.window.showErrorMessage(`GDB 命令失败: ${(err as Error).message}`);
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('codeblocks.debug.setNextStatement', async () => {
    const adapter = getActiveAdapter();
    if (!adapter || !adapter.isActive()) { vscode.window.showWarningMessage('没有活动的 Code::Blocks 调试会话'); return; }
    const ed = vscode.window.activeTextEditor;
    if (!ed) { vscode.window.showWarningMessage('请在目标源码中放置光标'); return; }
    const line = ed.selection.active.line + 1;
    try {
      await adapter.setNextStatement(ed.document.uri.fsPath, line);
      vscode.window.setStatusBarMessage(`已跳转到第 ${line} 行`, 4000);
    } catch (err) {
      vscode.window.showErrorMessage(`设置下一条语句失败: ${(err as Error).message}`);
    }
  }));
  context.subscriptions.push(vscode.commands.registerCommand('codeblocks.debug.attachToProcess', async () => {
    const procs = await listProcesses();
    if (!procs.length) { vscode.window.showWarningMessage('未获取到进程列表'); return; }
    const pick = await vscode.window.showQuickPick(
      procs.map((p): vscode.QuickPickItem & { pid: number } => ({ label: p.name, description: `PID ${p.pid}`, pid: p.pid })),
      { placeHolder: '选择要附加的进程', matchOnDescription: true },
    );
    if (!pick) return;
    const attachSearchDirs = activeProject
      ? debugSearchDirs(activeProject, cbBuiltinVars(activeProject.basePath, '', '', '', activeProject.title, activeProject.filename, ''))
      : [];
    await vscode.debug.startDebugging(undefined, {
      type: 'codeblocks',
      request: 'attach',
      name: `附加: ${pick.label} (${pick.pid})`,
      pid: pick.pid,
      searchDirs: attachSearchDirs,
    });
  }));

  /** 列举本机进程（附加调试用；Windows tasklist / POSIX ps） */
  function listProcesses(): Promise<ProcessInfo[]> {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        execFile('tasklist', ['/FO', 'CSV', '/NH'], { maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
          resolve(err ? [] : parseTasklist(stdout).sort((a, b) => a.name.localeCompare(b.name)));
        });
      } else {
        execFile('ps', ['-eo', 'pid,comm'], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
          resolve(err ? [] : parsePsList(stdout).sort((a, b) => a.name.localeCompare(b.name)));
        });
      }
    });
  }

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

  // Project 标题栏按钮（设置 codeblocks.ui.projectToolbar；未选中的自动进入 ⋯ 溢出菜单）
  applyProjectToolbarContext();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codeblocks.ui.projectToolbar')) {
        applyProjectToolbarContext();
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

  // 注册工程分析视图（概览 / 文件类型分布 / TODO 统计 / 构建目标 / 最近构建）
  analysisTreeProvider = new AnalysisTreeProvider(context.extensionUri, () => computeAnalysisData());
  const analysisTreeView = vscode.window.createTreeView('codeblocks.analysis', {
    treeDataProvider: analysisTreeProvider,
  });
  context.subscriptions.push(analysisTreeView);
  // 视图重新可见时刷新一次（懒计算，避免常驻开销）
  context.subscriptions.push(
    analysisTreeView.onDidChangeVisibility((e) => {
      if (e.visible) analysisTreeProvider?.refresh();
    }),
  );
  // 手动刷新（视图标题栏 $(refresh)）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.analysis.refresh', () => {
      analysisTreeProvider?.refresh();
    }),
  );
  // 工程分析：点击属性 → 在 .cbp 中定位对应配置
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.analysis.locate', async (arg?: { filename?: string; locate?: string[] }) => {
      if (!arg?.filename || !Array.isArray(arg.locate)) return;
      await locateInCbp(arg.filename, arg.locate);
    }),
  );
  // 工程分析：右键 → 复制对应 .cbp 片段
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.analysis.copyXml', async (node?: any) => {
      const xml: string | undefined = node?.xml;
      if (!xml) return;
      await vscode.env.clipboard.writeText(xml);
      vscode.window.showInformationMessage('已复制 .cbp 片段');
    }),
  );

  // 状态栏菜单（Code::Blocks 菜单栏移植到状态栏最左侧；两级 QuickPick）
  context.subscriptions.push(registerStatusBarMenu(context, getMenuDynamicData));

  // 视图布局：升级/首次安装后一次性应用默认排布（Build Log → 底部 Panel；侧栏 Menu→Project→Symbols）。
  // 应用后由 VS Code 原生持久化用户调整（拖动/分割/大小），本扩展不再干预。
  const UI_LAYOUT_VERSION_KEY = 'codeblocks.uiLayoutVersion';
  const UI_LAYOUT_VERSION = '3';
  const applyDefaultViewLayout = async (restoreEditorFocus: boolean): Promise<boolean> => {
    try {
      const cmds = await vscode.commands.getCommands(true);
      if (!cmds.includes('vscode.moveViews')) {
        outputChannel.appendLine('[视图布局] vscode.moveViews 不可用（需要 VS Code ≥ 1.85），未应用默认布局');
        return false;
      }
      const sidebarId = 'workbench.view.extension.codeblocks';
      const panelId = 'workbench.view.extension.codeblocks-buildPanel';
      // 顺序即最终排列：每次 move 追加到目标容器末尾
      await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['codeblocks.buildLog'], destinationId: panelId });
      await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['codeblocks.projectTree'], destinationId: sidebarId });
      await vscode.commands.executeCommand('vscode.moveViews', { viewIds: ['codeblocks.symbols'], destinationId: sidebarId });
      if (restoreEditorFocus) {
        // 激活路径：把键盘焦点还给编辑器，避免开机弹出侧栏
        setTimeout(() => {
          void vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        }, 300);
      }
      outputChannel.appendLine('[视图布局] 已应用默认布局（Build Log → 底部 Panel；侧栏 Project→Symbols）');
      return true;
    } catch (e) {
      outputChannel.appendLine(`[视图布局] 应用失败（本次会话将重试）: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };

  // 升级后一次性应用默认布局；失败不写标记并重试（最多 3 次），成功后不再覆盖用户手动调整
  let layoutApplyAttempts = 0;
  const tryApplyDefaultLayout = (): void => {
    void (async () => {
      if (context.globalState.get<string>(UI_LAYOUT_VERSION_KEY) === UI_LAYOUT_VERSION) {
        return;
      }
      layoutApplyAttempts++;
      if (await applyDefaultViewLayout(true)) {
        await context.globalState.update(UI_LAYOUT_VERSION_KEY, UI_LAYOUT_VERSION);
      } else if (layoutApplyAttempts < 3) {
        setTimeout(tryApplyDefaultLayout, 5000);
      }
    })();
  };
  setTimeout(tryApplyDefaultLayout, 1500);

  // 手动重置视图布局（恢复默认：Build Log 底部 Panel，侧栏 Menu→Project→Symbols）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.resetViewLayout', async () => {
      const ok = await applyDefaultViewLayout(false);
      await context.globalState.update(UI_LAYOUT_VERSION_KEY, UI_LAYOUT_VERSION);
      vscode.window.showInformationMessage(
        ok
          ? '视图布局已重置：Build Log 位于底部面板，侧栏顺序为 Menu → Project → Symbols'
          : '视图布局重置失败，请查看 Code::Blocks 输出通道',
      );
    }),
  );

  // 兜底 IntelliSense（补全 / 悬停 / 跳转定义）：仅在 clangd 不可用时生效
  context.subscriptions.push(...registerFallbackIntelliSense(fallbackIndex, () => fallbackEnabled));

  // 聚焦 Build Log 视图（菜单项 / 构建完成后引导）——位于底部 Panel 容器
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildLog.focus', () => {
      vscode.commands.executeCommand('workbench.view.extension.codeblocks-buildPanel');
    }),
  );

  // 聚焦 Project 视图（菜单 View → Project）——先打开侧栏容器再聚焦，避免容器未打开时聚焦无效
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.projectTree.focus', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.codeblocks');
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

  // Build Log「只看错误」过滤（C2）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildLog.toggleErrorsOnly', () => {
      const next = !(buildLogTreeProvider?.getErrorsOnly() ?? false);
      buildLogTreeProvider?.setErrorsOnly(next);
      vscode.commands.executeCommand('setContext', 'codeblocks.buildLog.errorsOnly', next);
    }),
  );

  // 复制诊断（C3）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildLog.copyMessage', (node?: any) => {
      const diag = node?.diag;
      if (diag?.message) vscode.env.clipboard.writeText(diag.message);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildLog.copyDiagnostic', (node?: any) => {
      const diag = node?.diag;
      if (diag) {
        vscode.env.clipboard.writeText(
          `${diag.file ?? ''}${diag.line ? `:${diag.line}` : ''}${diag.column ? `:${diag.column}` : ''}: ${diag.severity}: ${diag.message}`,
        );
      }
    }),
  );

  // 底部状态栏：构建目标切换项
  targetStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  targetStatusBar.command = 'codeblocks.selectTarget';
  targetStatusBar.tooltip = '点击切换构建目标';
  context.subscriptions.push(targetStatusBar);
  updateTargetStatusBar();

  // 底部状态栏：构建（Build/Rebuild/Build Workspace/Rebuild Workspace 整合为单项）
  // 空闲：点击弹构建菜单 + 悬停就地链接；构建中：spinner + 秒数，点击（或悬停链接）停止
  buildStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  buildStatusBar.text = '$(package) Build';
  buildStatusBar.command = 'codeblocks.build.menu';
  buildStatusBar.tooltip = buildStatusHoverTooltip();
  context.subscriptions.push(buildStatusBar);

  // 构建中旋转动画 + 实时秒数（buildInProgress 时 Build 项变 spinner + 点击变停止构建）
  let buildingSince = 0;
  const spinTimer = setInterval(() => {
      if (!buildStatusBar) return;
      if (buildInProgress) {
        if (!buildingSince) buildingSince = Date.now();
        const secs = Math.floor((Date.now() - buildingSince) / 1000);
        buildStatusBar.text = `$(sync~spin) Building… (${secs}s)`;
        buildStatusBar.tooltip = buildStopHoverTooltip(secs);
        buildStatusBar.command = 'codeblocks.build.stop';
      } else {
        buildingSince = 0;
        buildStatusBar.text = '$(package) Build';
        buildStatusBar.tooltip = buildStatusHoverTooltip();
        buildStatusBar.command = 'codeblocks.build.menu';
      }
    }, 250);
  context.subscriptions.push({ dispose: () => clearInterval(spinTimer) });

  // 底部状态栏：编译器选择
  compilerStatusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 70);
  compilerStatusBar.command = 'codeblocks.detectCompilers';
  compilerStatusBar.tooltip = '点击选择编译器';
  context.subscriptions.push(compilerStatusBar);
  updateCompilerStatusBar();

  // 后台预热编译器探测缓存（延迟启动，避免影响窗口加载；令「选择编译器」弹窗即时展示）
  setTimeout(() => {
    void (async () => {
      try {
        const masterPath = vscode.workspace.getConfiguration('codeblocks').get<string>('masterPath', '');
        saveDetectCache(masterPath, await detectAllCompilersAsync(masterPath));
      } catch { /* 非关键 */ }
    })();
  }, 4000);

  // 打开最近工程（E1）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.openRecentProject', async (filename?: string) => {
      if (!filename) return;
      if (openProjects.some((p) => p.filename === filename)) {
        const p = openProjects.find((x) => x.filename === filename);
        if (p) setActiveProject(p, { persist: true });
        return;
      }
      await openProject(filename);
    }),
  );

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

  // 向上移动项目（Menu/命令面板调用时回退到活动工程）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.moveProjectUp', (node?: any) => {
      const filename = resolveProjectFilename(node) ?? activeProject?.filename;
      if (!filename) return;
      moveProject(filename, -1);
    }),
  );

  // 向下移动项目（Menu/命令面板调用时回退到活动工程）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.moveProjectDown', (node?: any) => {
      const filename = resolveProjectFilename(node) ?? activeProject?.filename;
      if (!filename) return;
      moveProject(filename, 1);
    }),
  );

  // 移除项目
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.removeProject', async (node?: any) => {
      const filename = resolveProjectFilename(node) ?? activeProject?.filename;
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

  // 清理单个项目（项目节点行内按钮 / 右键）：语义同 clean()，作用于点击的工程
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.cleanProject', async (node?: any) => {
      const filename = resolveProjectFilename(node);
      if (!filename) return;
      const project = openProjects.find((p) => p.filename === filename);
      if (!project) return;
      // 对齐 OnClean：清理前确认
      if (!(await confirmClean(`清理 "${project.title}" 的选中目标`))) return;
      // 对齐 DoBuild：清理前须先停止调试会话
      if (!(await stopDebuggerIfRunning())) return;
      await saveAllBeforeBuild();
      outputChannel.show(true);
      const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
      if (!targetTitle) {
        vscode.window.showWarningMessage('项目没有构建目标');
        return;
      }
      await cleanTargets(project, targetTitle);
      outputChannel.info('[Code::Blocks] 清理完成');
    }),
  );

  // 添加文件到项目（右键；Menu/命令面板调用时回退到活动工程）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.addFile', async (node?: any) => {
      const filename = resolveProjectFilename(node) ?? activeProject?.filename;
      if (!filename) {
        requireProject();
        return;
      }
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

  // 单文件编译（对齐 Code::Blocks 的 Build file：只编译右键文件，不链接）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.compileFile', async (node?: any) => {
      const { project, file } = resolveFileNode(node);
      if (!project || !file) return;
      await buildSingleFile(project, file);
    }),
  );

  // 单文件清理（对齐 Code::Blocks 的 Clean file：删除对象文件与依赖文件）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.cleanFile', async (node?: any) => {
      const { project, file } = resolveFileNode(node);
      if (!project || !file) return;
      await cleanSingleFile(project, file);
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

  // 构建工作区（全部工程）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildWorkspace', async () => {
      await buildWorkspace(false);
    }),
  );

  // 重新构建
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.rebuild', async () => {
      await build(true);
    }),
  );

  // 停止构建（编译随时停止）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.build.stop', () => {
      if (!currentBuildCancel || currentBuildCancel.isCancelled()) {
        vscode.window.showInformationMessage('当前没有进行中的构建');
        return;
      }
      currentBuildCancel.cancel();
    }),
  );

  // 构建菜单（状态栏 Build 项点击）：构建中 = 停止构建；空闲 = 四项 QuickPick
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.build.menu', async () => {
      if (buildInProgress) {
        await vscode.commands.executeCommand('codeblocks.build.stop');
        return;
      }
      const picked = await vscode.window.showQuickPick(
        [
          { label: '$(package) Build', detail: '活动项目增量编译（Ctrl+F9）', target: 'codeblocks.build' },
          { label: '$(sync) Rebuild', detail: '活动项目全量编译（Ctrl+F11）', target: 'codeblocks.rebuild' },
          { label: '$(multiple-windows) Build Workspace', detail: '全部工程增量编译', target: 'codeblocks.buildWorkspace' },
          { label: '$(multiple-windows) Rebuild Workspace', detail: '全部工程 Clean + Build（会弹确认）', target: 'codeblocks.rebuildWorkspace' },
        ],
        { placeHolder: '构建菜单 — 选择操作' },
      );
      if (picked) await vscode.commands.executeCommand(picked.target);
    }),
  );

  // 构建并运行（F9）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.buildAndRun', async () => {
      const ok = await build(false);
      if (ok) await run();
    }),
  );

  // 无项目单文件编译（对齐 CompileFileWithoutProject 语义，VS Code 任务系统执行）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.compileFileWithoutProject', async () => {
      await compileFileWithoutProject();
    }),
  );

  // 清理
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.clean', async () => {
      await clean();
    }),
  );

  // 清理工作区（全部工程选中目标）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.cleanWorkspace', async () => {
      await cleanWorkspace();
    }),
  );

  // 重新构建工作区（全部工程：clean 遍 + build 遍，对齐 OnRebuildAll → RebuildWorkspace）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.rebuildWorkspace', async () => {
      await rebuildWorkspace();
    }),
  );

  // 运行
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.run', async () => {
      await run();
    }),
  );

  // 调试（F8 = Start / Continue，对齐 CB debugger_menu 的单项语义：调试中按 F8 = 继续运行）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.debug', async () => {
      if (vscode.debug.activeDebugSession) {
        await vscode.commands.executeCommand('workbench.action.debug.continue');
        return;
      }
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

  // 工程属性面板（构建目标管理；备注 tab 由 codeblocks.projectNotes 直达）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.projectProperties', async (node?: any) => {
      const filename = resolveProjectFilename(node);
      const project = filename
        ? openProjects.find((p) => p.filename === filename)
        : requireProject();
      if (!project) return;
      showProjectPropertiesPanel(project, context.extensionUri);
    }),
  );

  // —— 第四十四轮 Menu 对齐新增命令 ——

  // 编译当前编辑器文件（对齐 Build → Compile current file，Ctrl+Shift+F9）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.compileCurrentFile', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.uri.scheme !== 'file') {
        vscode.window.showWarningMessage('没有打开的源文件');
        return;
      }
      // 无工程：走单文件编译（对齐 CompileFileWithoutProject）
      if (openProjects.length === 0) {
        await vscode.commands.executeCommand('codeblocks.compileFileWithoutProject');
        return;
      }
      const targetPath = normPath(editor.document.uri.fsPath);
      const ordered = activeProject
        ? [activeProject, ...openProjects.filter((p) => p.filename !== activeProject?.filename)]
        : [...openProjects];
      for (const project of ordered) {
        const file = project.files.find((f) => normPath(f.absolutePath) === targetPath);
        if (file) {
          if (activeProject?.filename !== project.filename) setActiveProject(project, { persist: true });
          await buildSingleFile(project, file);
          return;
        }
      }
      // 对齐 GetBuildTargetForFile：文件未归属任何目标 → 提示中止
      vscode.window.showWarningMessage('当前文件不属于任何已打开的工程（可先添加到工程后再编译）');
    }),
  );

  // 清除全部编译错误（对齐 Build → Errors → Clear all errors）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.clearErrors', () => {
      buildLogTreeProvider?.setSummary(undefined);
      vscode.window.setStatusBarMessage('已清除 Build Log 中的编译错误', 3000);
    }),
  );

  // 激活上一个/下一个工程（对齐 Project tree → Activate prior/next project，Alt-F5/Alt-F6）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.activatePriorProject', () => activateRelativeProject(-1)),
    vscode.commands.registerCommand('codeblocks.activateNextProject', () => activateRelativeProject(1)),
  );

  // 工程树按文件类型分组开关（对齐 Project tree → Categorize by file types）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.toggleCategorize', async () => {
      const cfg = vscode.workspace.getConfiguration('codeblocks');
      const next = !cfg.get<boolean>('projectTree.categorize', true);
      await cfg.update('projectTree.categorize', next, vscode.ConfigurationTarget.Workspace);
      vscode.window.setStatusBarMessage(`工程树分组显示: ${next ? '开启' : '关闭'}`, 3000);
    }),
  );

  // 清空最近工程列表（Recent Projects 二级入口）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.clearRecentProjects', async () => {
      await extContext?.globalState.update('codeblocks.recentProjects', []);
      vscode.window.setStatusBarMessage('已清空最近工程列表', 3000);
    }),
  );

  // 工程备注（对齐 Project → Notes…：打开属性面板备注 tab）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.projectNotes', async () => {
      const project = requireProject();
      if (!project) return;
      showProjectPropertiesPanel(project, context.extensionUri, 'notes');
    }),
  );

  // 设置目标执行参数（对齐 Project → Set programs' arguments…）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.setProgramArguments', async () => {
      const project = requireProject();
      if (!project) return;
      if (!project.buildTargets.length) {
        vscode.window.showWarningMessage('项目没有构建目标');
        return;
      }
      const remembered = getSelectedTarget(project);
      let target = project.buildTargets.find((t) => t.title === remembered) ?? project.buildTargets[0];
      if (project.buildTargets.length > 1) {
        const picked = await vscode.window.showQuickPick(
          project.buildTargets.map((t) => ({ label: t.title, description: t.title === remembered ? '当前' : undefined, t })),
          { placeHolder: `选择目标（${project.title}）` },
        );
        if (!picked) return;
        target = picked.t;
      }
      const value = await vscode.window.showInputBox({
        prompt: `执行参数（${target.title}）— 运行/调试时传递给程序`,
        value: target.executionParameters ?? '',
        placeHolder: '例如 --verbose input.txt',
      });
      if (value === undefined) return;
      target.executionParameters = value;
      await persistProjectAndReload(project);
      vscode.window.setStatusBarMessage(`已保存执行参数: ${target.title}`, 3000);
    }),
  );

  // 全局编译器变量（只读查看，选中复制；对齐 Settings → Global variables…）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.showGlobalVariables', async () => {
      const sets = globalVariables();
      const items: vscode.QuickPickItem[] = [];
      for (const [setName, vars] of Object.entries(sets)) {
        for (const [varName, members] of Object.entries(vars)) {
          items.push({
            label: varName,
            description: setName,
            detail: Object.entries(members).map(([m, v]) => `${m}=${v}`).join(', '),
          });
        }
      }
      if (!items.length) {
        vscode.window.showInformationMessage('未解析到全局编译器变量（default.conf /gcv 为空）');
        return;
      }
      const picked = await vscode.window.showQuickPick(items, { placeHolder: '全局编译器变量（只读）— 选择复制到剪贴板' });
      if (picked) {
        await vscode.env.clipboard.writeText(`${picked.label} = ${picked.detail ?? ''}`);
        vscode.window.setStatusBarMessage('已复制全局变量', 3000);
      }
    }),
  );

  // 清空反引号缓存（对齐 Settings → Backtick Cache…）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.clearBacktickCache', () => {
      clearBackticksCache();
      vscode.window.setStatusBarMessage('已清空反引号缓存（下次构建重新执行反引号命令）', 3000);
    }),
  );

  // 快捷键冲突检测（VS Code 默认表 / 用户 keybindings.json / 其他已安装扩展）+ 托管覆盖状态（D7）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.keybindings.check', async () => {
      const findings = collectKeybindingConflicts();
      const managed = describeManagedOverrides();
      outputChannel.show(true);
      if (!findings.length && !managed.length) {
        outputChannel.info('[Code::Blocks] 快捷键冲突检测：未发现冲突（无托管覆盖）');
        vscode.window.showInformationMessage('未检测到快捷键冲突 ✓');
        return;
      }
      const report = [formatConflictReport(findings), ...managed.map((m) => m.line)].join('\n');
      outputChannel.info(report);
      interface ConflictPick extends vscode.QuickPickItem { action?: 'openEditor' | 'openJson' | 'copy' }
      const picks: ConflictPick[] = [
        { label: '$(keyboard) 打开键盘快捷方式编辑器…', action: 'openEditor' },
        { label: '$(json) 打开用户 keybindings.json', action: 'openJson' },
        { label: '$(clippy) 复制冲突报告', action: 'copy' },
      ];
      if (findings.length) {
        picks.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        for (const f of findings) picks.push({
          label: `${f.level === 'high' ? '$(warning)' : f.level === 'medium' ? '$(info)' : '$(circle-small-filled)'} ${f.key} → ${f.command}`,
          description: f.gated ? 'CB 保真模式' : undefined,
          detail: `冲突：${f.findings.map((x) => `${x.source} → ${x.command}`).join('；')}${f.note ? `（${f.note}）` : ''}`,
        });
      }
      if (managed.length) {
        picks.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        for (const m of managed) picks.push({
          label: `${m.ok ? '$(check)' : '$(warning)'} [托管] ${m.label}`,
          description: m.ok ? '已生效' : '未写入/不一致',
          detail: `${m.line.trim()}${m.detail ? `（${m.detail}）` : ''}`,
        });
      }
      const picked = await vscode.window.showQuickPick(picks, {
        placeHolder: `快捷键：冲突 ${findings.length} 项 · 托管覆盖 ${managed.length} 项 — 查看详情或选择操作`,
        title: 'Code::Blocks: Keybinding Conflicts',
      });
      if (!picked?.action) return;
      if (picked.action === 'openEditor') {
        await vscode.commands.executeCommand('workbench.action.openGlobalKeybindings');
      } else if (picked.action === 'openJson') {
        const p = userKeybindingsPath();
        if (p && fs.existsSync(p)) await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
        else vscode.window.showInformationMessage('用户 keybindings.json 尚不存在（可从键盘快捷方式编辑器右上角创建）');
      } else if (picked.action === 'copy') {
        await vscode.env.clipboard.writeText(report);
        vscode.window.setStatusBarMessage('冲突报告已复制到剪贴板', 3000);
      }
    }),
  );

  // 快捷键托管：应用 / 向导 / 重置（方案 A：设置 overrides → 用户 keybindings.json）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.keybindings.apply', () => applyKeybindings()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.keybindings.configure', async () => {
      interface Pick extends vscode.QuickPickItem { id?: string; action?: 'reset' }
      const overrides = keybindingsOverrideMap();
      const items: Pick[] = MANAGED_KEYBINDINGS.map((m) => {
        const custom = overrides.get(m.id);
        const current = custom === undefined
          ? (m.defaults.length ? `${m.defaults.join(' / ')}（默认）` : '（未绑定）')
          : (custom === '' ? '（已解绑）' : custom);
        return {
          label: `$(keyboard) ${m.label}`,
          description: `当前: ${current}`,
          detail: `${m.id} · ${m.command}${m.when ? ` · when: ${m.when}` : ''}`,
          id: m.id,
        };
      });
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
      items.push({ label: '$(trash) 重置全部为默认（清除所有覆盖）', action: 'reset' });
      const picked = await vscode.window.showQuickPick(items, {
        placeHolder: '选择要修改的快捷键（Esc 取消）',
        title: 'Code::Blocks: Configure Keybindings',
      });
      if (!picked) return;
      if (picked.action === 'reset') {
        await vscode.commands.executeCommand('codeblocks.keybindings.reset');
        return;
      }
      const managed = MANAGED_KEYBINDINGS.find((m) => m.id === picked.id);
      if (!managed) return;
      const current = overrides.get(managed.id) ?? (managed.defaults[0] ?? '');
      const input = await vscode.window.showInputBox({
        prompt: `${managed.label} — 输入新键位（空 = 解绑；输入 default = 恢复默认；如 ctrl+alt+b、f7、ctrl+k ctrl+c）`,
        value: current,
        validateInput: (v: string) => {
          const t = v.trim();
          if (t === '' || t.toLowerCase() === 'default') return undefined;
          const res = validateChord(t);
          return res.ok ? undefined : (res.error ?? '非法键位');
        },
      });
      if (input === undefined) return;
      const t = input.trim().toLowerCase();
      const cfg = vscode.workspace.getConfiguration('codeblocks');
      const map = { ...(cfg.get<Record<string, string>>('keybindings.overrides', {}) ?? {}) };
      if (t === 'default') {
        delete map[managed.id];
      } else {
        map[managed.id] = t; // '' = 解绑
      }
      await cfg.update('keybindings.overrides', map, vscode.ConfigurationTarget.Global);
      applyKeybindings(); // 立即应用（自动监听可能随后再触发一次，二次为 no-change）
      vscode.window.setStatusBarMessage(`已更新 ${managed.id} → ${t === 'default' ? '默认' : (t === '' ? '解绑' : t)}`, 3000);
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.keybindings.reset', async () => {
      const r = await performKeybindingsReset();
      vscode.window.showInformationMessage(r.message ?? '快捷键已恢复默认');
      KeybindingPanel.refreshIfOpen();
    }),
  );

  // 快捷键可视化设置面板（Menu → Settings → Keybindings…）与方案导入/导出（D5）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.keybindings.panel', () => openKeybindingPanel()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.keybindings.export', () => void exportKeybindingScheme()),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.keybindings.import', () => void importKeybindingScheme()),
  );

  // 设置变更 → 自动应用（去抖 800ms）
  {
    let applyTimer: ReturnType<typeof setTimeout> | undefined;
    context.subscriptions.push({ dispose: () => { if (applyTimer) clearTimeout(applyTimer); } });
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('codeblocks.keybindings.overrides')) return;
        if (applyTimer) clearTimeout(applyTimer);
        applyTimer = setTimeout(() => { applyKeybindings({ silent: true }); KeybindingPanel.refreshIfOpen(); }, 800);
      }),
    );
  }

  // CB 保真模式开启提醒（一次性，可直达冲突清单）
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('codeblocks.keybindings.cbStyle')) return;
      const on = vscode.workspace.getConfiguration('codeblocks').get<boolean>('keybindings.cbStyle', false);
      if (!on) return;
      void vscode.window.showInformationMessage(
        '已启用 Code::Blocks 保真键位：F5 切换断点 / F2 打开 Build Log / Ctrl+R 替换 等将覆盖 VS Code 默认键位。可随时关闭设置 codeblocks.keybindings.cbStyle 恢复。',
        '查看冲突清单',
      ).then((pick) => {
        if (pick) void vscode.commands.executeCommand('codeblocks.keybindings.check');
      });
    }),
  );

  // 启动时静默检测用户级键位冲突（不弹窗：输出通道 + 一次性状态栏提示）
  checkUserKeybindingConflictsQuietly(context);

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

  // 头文件保护（D1：headerguard 对齐）+ 新建空头文件自动插入（codeblocks.editor.autoHeaderGuard）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.insertHeaderGuard', async () => {
      await insertHeaderGuardInActiveEditor();
    }),
    vscode.workspace.onDidCreateFiles(async (e) => {
      await autoInsertHeaderGuards(e.files);
    }),
  );

  // Tidy 注释（D3：tidycmt 对齐）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.tidyComments', async () => {
      await tidyCommentsInActiveEditor();
    }),
  );

  // 头文件/源文件互换（D4）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.swapHeaderSource', async () => {
      await swapHeaderSource();
    }),
  );

  // 用户自定义工具（E1：Configure tools 对齐；条目录自 codeblocks.tools，Tools 菜单动态注入）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.runTool', async (index?: unknown) => {
      await runConfiguredTool(typeof index === 'number' ? index : 0);
    }),
    vscode.commands.registerCommand('codeblocks.configureTools', async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'codeblocks.tools');
    }),
  );

  // 编译器命令查看（B3）/ Makefile 导出（B4）/ 工作区依赖编辑（C1）
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.showCompilerCommands', async () => {
      await showCompilerCommandsDocument();
    }),
    vscode.commands.registerCommand('codeblocks.exportMakefile', async () => {
      await exportProjectMakefile();
    }),
    vscode.commands.registerCommand('codeblocks.workspace.editDependencies', async () => {
      await editWorkspaceDependencies();
    }),
    vscode.commands.registerCommand('codeblocks.importProject', async () => {
      await importExternalProject();
    }),
    vscode.commands.registerCommand('codeblocks.exportTargetAsProject', async (targetTitleArg?: unknown) => {
      await exportTargetAsProject(targetTitleArg);
    }),
    vscode.commands.registerCommand('codeblocks.openDefaultConfig', async () => {
      await openDefaultConf();
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
      openedWorkspaceFile = filename;
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
    // 建立 生成器 → 生成文件 关系（对齐 cbProject::AddFile 的 GenFilesHackMap，来自编译器 XML gen 属性）
    applyGeneratedFiles(project, getCompiler);
    openProjects.push(project);
    // 最近工程记录（E1；状态栏菜单按需拉取动态区）
    recordRecentProject(filename);
    analysisTreeProvider?.refresh();
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

    // 每个工程各自默认选中第一个目标（对齐 CodeBlocks m_ActiveTarget = GetFirstValidBuildTargetName()，跳过不支持平台的目标）
    const titles = project.buildTargets.filter((t) => supportsCurrentPlatform(t.platforms)).map((t) => t.title);
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

/** 在打开工程列表中循环切换活动工程（delta: -1 上一个 / 1 下一个，对齐 Activate prior/next project） */
function activateRelativeProject(delta: number): void {
  if (!openProjects.length) {
    requireProject();
    return;
  }
  const idx = activeProject ? openProjects.findIndex((p) => p.filename === activeProject!.filename) : -1;
  const nextIdx = idx === -1 ? 0 : (idx + delta + openProjects.length) % openProjects.length;
  const next = openProjects[nextIdx];
  setActiveProject(next, { persist: true });
  vscode.window.setStatusBarMessage(`活动工程: ${next.title}`, 2000);
}

/** 打开工程属性面板（initialTab 可直达指定 tab，如 notes） */
function showProjectPropertiesPanel(project: Project, extensionUri: vscode.Uri, initialTab?: string): void {
  ProjectPropertiesPanel.show(project, extensionUri, async (targets, files, options, searchDirs, projectSettings, buildScripts, notes, virtualTargets, debuggerSettings) => {
    await saveProjectProperties(project, targets, files, options, searchDirs, projectSettings, buildScripts, notes, virtualTargets, debuggerSettings);
  }, initialTab);
}

/** 序列化写回 .cbp 并重新解析刷新（供工程属性保存 / 执行参数修改共用） */
async function persistProjectAndReload(project: Project): Promise<void> {
  const xml = serializeProject(project);
  fs.writeFileSync(project.filename, xml, 'utf-8');
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

/**
 * R9：从目标导出独立工程（对齐 CB ProjectOptions → Create project from target）：
 * 确认 → 选保存位置（默认 <工程名>_<目标名>.cbp）→ 生成单目标工程 → 写盘 → 可立即打开。
 */
async function exportTargetAsProject(targetTitleArg?: unknown): Promise<void> {
  const project = requireProject();
  if (!project) return;
  let targetTitle = String(targetTitleArg ?? '').trim();
  if (!targetTitle || !project.buildTargets.some((t) => t.title === targetTitle)) {
    const pick = await vscode.window.showQuickPick(
      project.buildTargets.map((t) => ({ label: t.title, description: `输出: ${t.outputFilename}` })),
      { placeHolder: '选择要导出的构建目标' },
    );
    if (!pick) return;
    targetTitle = pick.label;
  }
  const confirm = await vscode.window.showWarningMessage(
    `把目标 "${targetTitle}" 导出为独立工程？（仅包含属于该目标的文件）`,
    { modal: true },
    'Export',
  );
  if (confirm !== 'Export') return;
  await saveAllBeforeBuild();
  const safe = targetTitle.replace(/[^\w.-]+/g, '_');
  const base = path.basename(project.filename, path.extname(project.filename));
  const suggested = path.join(path.dirname(project.filename), `${base}_${safe}.cbp`);
  const save = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(suggested),
    filters: { 'Code::Blocks project': ['cbp'] },
  });
  if (!save) return;
  const exported = buildTargetExportProject(project, targetTitle);
  fs.writeFileSync(save.fsPath, serializeProject(exported), 'utf-8');
  outputChannel.info(`[Code::Blocks] 已从目标导出工程: ${save.fsPath}（目标 ${targetTitle}，${exported.files.length} 个文件）`);
  const pick = await vscode.window.showInformationMessage(`已导出工程（${exported.files.length} 个文件）`, '打开', '稍后');
  if (pick === '打开') {
    await openProject(save.fsPath);
  }
}

// ———— 快捷键冲突检测（第四十五轮） ————

/** 扩展自身贡献的键位（从随包 package.json 读取，保证与实际生效一致） */
function ownKeybindings(): KeybindingDef[] {
  try {
    const pkgPath = path.join(extContext?.extensionPath ?? '', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const list: any[] = pkg?.contributes?.keybindings ?? [];
    return list.map((b) => ({
      key: String(b.key ?? ''),
      command: String(b.command ?? ''),
      when: b.when ? String(b.when) : undefined,
      source: '扩展',
    }));
  } catch {
    return [];
  }
}

/** 用户 keybindings.json 路径（<userData>/User/keybindings.json） */
function userKeybindingsPath(): string | undefined {
  const gs = extContext?.globalStorageUri?.fsPath;
  if (!gs) return undefined;
  // <userData>/User/globalStorage/<publisher>.<name> → 上两级即 <userData>/User
  return path.join(path.dirname(path.dirname(gs)), 'keybindings.json');
}

/** 读取用户 keybindings.json（JSONC 容错；不存在/损坏返回空） */
function readUserKeybindings(): KeybindingDef[] {
  try {
    const p = userKeybindingsPath();
    if (!p || !fs.existsSync(p)) return [];
    const arr = parseJsonc(fs.readFileSync(p, 'utf-8'));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((b: any) => b && typeof b.key === 'string')
      .map((b: any) => ({
        key: String(b.key),
        command: String(b.command ?? ''),
        when: b.when ? String(b.when) : undefined,
        source: '用户 keybindings.json',
      }));
  } catch {
    return [];
  }
}

/** 其他已安装扩展贡献的键位（~/.vscode/extensions/<扩展目录>/package.json） */
function readOtherExtensionKeybindings(): KeybindingDef[] {
  const out: KeybindingDef[] = [];
  try {
    const home = process.env.USERPROFILE || process.env.HOME || '';
    if (!home) return out;
    for (const root of [path.join(home, '.vscode', 'extensions'), path.join(home, '.vscode-insiders', 'extensions')]) {
      if (!fs.existsSync(root)) continue;
      for (const dir of fs.readdirSync(root)) {
        const manifest = path.join(root, dir, 'package.json');
        if (!fs.existsSync(manifest)) continue;
        try {
          const pkg = JSON.parse(fs.readFileSync(manifest, 'utf-8'));
          if (pkg?.name === 'codeblocks-vscode') continue; // 跳过自身
          const list: any[] = pkg?.contributes?.keybindings ?? [];
          for (const b of list) {
            if (!b || typeof b.key !== 'string') continue;
            out.push({
              key: String(b.key),
              command: String(b.command ?? ''),
              when: b.when ? String(b.when) : undefined,
              source: `扩展:${pkg?.name ?? dir}`,
            });
          }
        } catch { /* 单个扩展清单损坏则跳过 */ }
      }
    }
  } catch { /* 目录不可读则忽略 */ }
  return out;
}

/** 完整冲突检测（含 VS Code 内置默认表） */
function collectKeybindingConflicts(): ConflictItem[] {
  return collectConflicts(ownKeybindings(), readUserKeybindings(), readOtherExtensionKeybindings());
}

/** 文本报告（输出通道 / 剪贴板共用） */
function formatConflictReport(findings: ConflictItem[]): string {
  const lines = [`[Code::Blocks] 快捷键冲突检测：${findings.length} 项`];
  for (const f of findings) {
    const level = f.level === 'high' ? '高' : f.level === 'medium' ? '中' : '低';
    lines.push(`  [${level}] ${f.key} → ${f.command}${f.gated ? '（CB 保真模式）' : ''}`);
    for (const x of f.findings) lines.push(`      冲突：${x.source} → ${x.command}${x.when ? ` (when: ${x.when})` : ''}`);
    if (f.note) lines.push(`      说明：${f.note}`);
  }
  return lines.join('\n');
}

/** 启动静默检测：仅用户级真实撞车；输出通道 + 一次性状态栏提示（不弹窗） */
function checkUserKeybindingConflictsQuietly(context: vscode.ExtensionContext): void {
  try {
    const findings = collectConflicts(ownKeybindings(), readUserKeybindings(), [], { includeDefaults: false })
      .filter((f) => f.level !== 'info');
    if (!findings.length) return;
    const seen = new Set(context.globalState.get<string[]>('codeblocks.keybindingWarnings', []) ?? []);
    const fresh = findings.filter((f) => !seen.has(`${normalizeKey(f.key)}|${f.command}`));
    if (!fresh.length) return;
    for (const f of fresh) {
      outputChannel.warn(`[Code::Blocks] 快捷键冲突：${f.key} 同时绑定到 ${f.command} 与 ${f.findings.map((x) => x.command).join(' / ')}（运行 Code::Blocks: Check Keybinding Conflicts 查看详情）`);
    }
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 40);
    item.text = `$(warning) Code::Blocks: ${fresh.length} 个快捷键冲突`;
    item.tooltip = '检测到与用户键位（或其它来源）的冲突，点击查看清单';
    item.command = 'codeblocks.keybindings.check';
    item.show();
    setTimeout(() => item.dispose(), 30000);
    void context.globalState.update('codeblocks.keybindingWarnings', [...seen, ...fresh.map((f) => `${normalizeKey(f.key)}|${f.command}`)]);
  } catch { /* 非关键：检测失败不影响激活 */ }
}

// ———— 快捷键托管配置（第四十六轮，方案 A） ————

/** 设置中的 overrides（已解析，忽略非法/未知项） */
function keybindingsOverrideMap(): Map<string, string> {
  return parseOverrides(vscode.workspace.getConfiguration('codeblocks').get('keybindings.overrides')).overrides;
}

/** 应用结果（面板/命令共用反馈） */
interface KeybindingApplyResult {
  ok: boolean;
  changed: boolean;
  added: number;
  removed: number;
  path?: string;
  message?: string;
}

/** 将 overrides 物化写入用户 keybindings.json（仅托管条目；首次备份 + 回读校验，失败回滚） */
function applyKeybindings(opts: { silent?: boolean } = {}): KeybindingApplyResult {
  try {
    const parsed = parseOverrides(vscode.workspace.getConfiguration('codeblocks').get('keybindings.overrides'));
    const desired = computeDesiredEntries(parsed.overrides, MANAGED_KEYBINDINGS);
    const target = userKeybindingsPath();
    if (!target) {
      outputChannel.warn('[Code::Blocks] 无法定位用户 keybindings.json 路径');
      return { ok: false, changed: false, added: 0, removed: 0, message: '无法定位用户 keybindings.json 路径' };
    }
    const exists = fs.existsSync(target);
    const text = exists ? fs.readFileSync(target, 'utf-8') : '';
    const backup = `${target}.codeblocks-backup`;
    const result = updateKeybindingsText(text, desired, MANAGED_COMMANDS);
    for (const inv of parsed.invalid) {
      outputChannel.warn(`[Code::Blocks] 键位设置无效：${inv.id} = ${inv.value}（${inv.error}）`);
    }
    for (const u of parsed.unknown) {
      outputChannel.warn(`[Code::Blocks] 键位设置含未知键名：${u}（键名列表见设置说明）`);
    }
    if (!result.changed) {
      if (!opts.silent) vscode.window.setStatusBarMessage('快捷键已与设置一致，无需写入', 3000);
      return { ok: true, changed: false, added: 0, removed: 0, path: target, message: '已与设置一致，无需写入' };
    }
    if (exists && text.trim() && !fs.existsSync(backup)) fs.copyFileSync(target, backup);
    fs.writeFileSync(target, result.text, 'utf-8');
    // 回读校验：损坏则回滚
    try {
      parseJsonc(fs.readFileSync(target, 'utf-8'));
    } catch (err) {
      if (fs.existsSync(backup)) fs.copyFileSync(backup, target);
      throw new Error(`写入后校验失败，已回滚：${(err as Error).message}`);
    }
    outputChannel.info(`[Code::Blocks] 快捷键已写入用户 keybindings.json：+${result.added} / -${result.removed} 条目（${target}）`);
    if (!opts.silent) vscode.window.setStatusBarMessage(`快捷键已应用（+${result.added} / -${result.removed}）`, 3000);
    return { ok: true, changed: true, added: result.added, removed: result.removed, path: target, message: `已写入 +${result.added} / -${result.removed} 条目` };
  } catch (err) {
    outputChannel.error(`[Code::Blocks] 应用快捷键失败：${(err as Error).message}`);
    if (!opts.silent) vscode.window.showErrorMessage(`应用快捷键失败：${(err as Error).message}`);
    return { ok: false, changed: false, added: 0, removed: 0, message: (err as Error).message };
  }
}

/** 托管覆盖状态（D7：设置 vs 用户 keybindings.json 实际条目） */
interface ManagedStatus {
  label: string;
  ok: boolean;
  line: string;
  detail: string;
}

function describeManagedOverrides(): ManagedStatus[] {
  try {
    const parsed = parseOverrides(vscode.workspace.getConfiguration('codeblocks').get('keybindings.overrides'));
    const out: ManagedStatus[] = [];
    for (const inv of parsed.invalid) {
      out.push({ label: inv.id, ok: false, line: `  [无效] ${inv.id} = ${inv.value}（${inv.error}）`, detail: '修改为合法键位或清空该键名' });
    }
    for (const u of parsed.unknown) {
      out.push({ label: u, ok: false, line: `  [未知键名] ${u}`, detail: '不在托管表内（见设置说明的键名列表）' });
    }
    if (!parsed.overrides.size) return out;
    const target = userKeybindingsPath();
    const text = target && fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
    const fileEntries = readManagedEntries(text, MANAGED_COMMANDS);
    const desired = computeDesiredEntries(parsed.overrides, MANAGED_KEYBINDINGS);
    const { missing, extra } = diffManaged(desired, fileEntries);
    for (const m of MANAGED_KEYBINDINGS) {
      if (!parsed.overrides.has(m.id)) continue;
      const value = parsed.overrides.get(m.id) ?? '';
      const ok = !missing.some((x) => x.command === m.command) && !extra.some((x) => x.command === m.command);
      out.push({
        label: m.label,
        ok,
        line: `  [托管] ${m.id} → ${value === '' ? '解绑' : value}：${ok ? '已生效' : '未写入/不一致（运行 Apply Keybindings）'}`,
        detail: `${m.command}${m.when ? ` · when: ${m.when}` : ''}`,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// ———— 快捷键可视化设置与方案导入/导出（第四十七轮，方案 A + D5） ————

/** 设置/清除单项覆盖并立即应用（面板与向导共用） */
async function setKeybindingOverride(id: string, key: string | undefined): Promise<KeybindingApplyResult> {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const map = { ...(cfg.get<Record<string, string>>('keybindings.overrides', {}) ?? {}) };
  if (key === undefined) delete map[id];
  else map[id] = key;
  await cfg.update('keybindings.overrides', map, vscode.ConfigurationTarget.Global);
  return applyKeybindings({ silent: true });
}

/** 恢复默认：清理文件中托管条目 + 清空覆盖设置（命令与面板共用；confirm=true 时先模态确认） */
async function performKeybindingsReset(opts: { confirm?: boolean } = {}): Promise<KeybindingApplyResult> {
  if (opts.confirm) {
    const pick = await vscode.window.showWarningMessage(
      '确定重置全部自定义快捷键？（清除文件中的托管条目与设置中的覆盖，恢复默认键位）',
      { modal: true },
      '重置',
    );
    if (pick !== '重置') return { ok: false, changed: false, added: 0, removed: 0, message: '已取消' };
  }
  let removed = 0;
  try {
    const target = userKeybindingsPath();
    if (target && fs.existsSync(target)) {
      const text = fs.readFileSync(target, 'utf-8');
      const result = updateKeybindingsText(text, [], MANAGED_COMMANDS);
      if (result.changed) fs.writeFileSync(target, result.text, 'utf-8');
      removed = result.removed;
      outputChannel.info(`[Code::Blocks] 已清除用户 keybindings.json 中的托管条目（-${removed}）`);
    }
  } catch (err) {
    outputChannel.warn(`[Code::Blocks] 清理 keybindings.json 失败：${(err as Error).message}`);
  }
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  try { await cfg.update('keybindings.overrides', {}, vscode.ConfigurationTarget.Global); } catch { /* 忽略 */ }
  try { await cfg.update('keybindings.overrides', undefined, vscode.ConfigurationTarget.Workspace); } catch { /* 忽略 */ }
  return { ok: true, changed: removed > 0, added: 0, removed, message: `已恢复默认（清除 ${removed} 个托管条目）` };
}

/** 面板数据（行模型 + 路径 + cbStyle + 设置告警） */
function keybindingsPanelState(): KeybindingPanelState {
  const parsed = parseOverrides(vscode.workspace.getConfiguration('codeblocks').get('keybindings.overrides'));
  const target = userKeybindingsPath();
  let fileEntries: ReturnType<typeof readManagedEntries> = [];
  try {
    const text = target && fs.existsSync(target) ? fs.readFileSync(target, 'utf-8') : '';
    fileEntries = readManagedEntries(text, MANAGED_COMMANDS);
  } catch { /* 忽略读取失败 */ }
  const notices: string[] = [];
  for (const inv of parsed.invalid) notices.push(`设置中键位无效：${inv.id} = ${inv.value}（${inv.error}）`);
  for (const u of parsed.unknown) notices.push(`设置中含未知键名：${u}（将被忽略）`);
  return {
    rows: buildKeybindingRows(parsed.overrides, fileEntries, MANAGED_KEYBINDINGS),
    path: target ?? '',
    cbStyle: vscode.workspace.getConfiguration('codeblocks').get<boolean>('keybindings.cbStyle', false),
    notices,
  };
}

/** 打开可视化快捷键设置面板（命令与菜单共用） */
function openKeybindingPanel(): void {
  const uri = extContext?.extensionUri;
  if (!uri) return;
  KeybindingPanel.show(uri, {
    getState: () => keybindingsPanelState(),
    validate: validateChord,
    setOverride: (id, key) => setKeybindingOverride(id, key),
    clearOverride: (id) => setKeybindingOverride(id, undefined),
    resetAll: () => performKeybindingsReset({ confirm: true }),
    apply: async () => applyKeybindings(),
    check: () => void vscode.commands.executeCommand('codeblocks.keybindings.check'),
    openFile: () => {
      const p = userKeybindingsPath();
      if (p && fs.existsSync(p)) void vscode.commands.executeCommand('vscode.open', vscode.Uri.file(p));
      else vscode.window.showInformationMessage('用户 keybindings.json 尚不存在（修改任意一项后会自动创建）');
    },
    exportScheme: () => void vscode.commands.executeCommand('codeblocks.keybindings.export'),
    importScheme: () => void vscode.commands.executeCommand('codeblocks.keybindings.import'),
  });
}

/** 导出键位方案（D5） */
async function exportKeybindingScheme(): Promise<void> {
  const overrides = keybindingsOverrideMap();
  if (!overrides.size) {
    vscode.window.showWarningMessage('当前没有自定义快捷键可导出（先在面板/设置中修改任意键位）');
    return;
  }
  const uri = await vscode.window.showSaveDialog({
    filters: { 'JSON': ['json'] },
    saveLabel: '导出键位方案',
    title: `导出 ${overrides.size} 项自定义键位`,
  });
  if (!uri) return;
  try {
    fs.writeFileSync(uri.fsPath, buildExportPayload(overrides), 'utf-8');
    vscode.window.showInformationMessage(`已导出 ${overrides.size} 项键位方案: ${uri.fsPath}`);
  } catch (err) {
    vscode.window.showErrorMessage(`导出失败：${(err as Error).message}`);
  }
}

/** 导入键位方案（D5；合并或覆盖，非法/未知项忽略） */
async function importKeybindingScheme(): Promise<void> {
  const uris = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'JSON': ['json'] },
    openLabel: '导入键位方案',
  });
  if (!uris?.length) return;
  let parsed: ReturnType<typeof parseImportPayload>;
  try {
    parsed = parseImportPayload(fs.readFileSync(uris[0].fsPath, 'utf-8'));
  } catch (err) {
    vscode.window.showErrorMessage(`读取失败：${(err as Error).message}`);
    return;
  }
  if (parsed.error) { vscode.window.showErrorMessage(parsed.error); return; }
  if (!parsed.overrides.size) { vscode.window.showWarningMessage('方案中没有可用的键位项'); return; }
  const ignored = parsed.invalid.length + parsed.unknown.length;
  const mode = await vscode.window.showQuickPick(
    [
      { label: '$(merge) 合并', description: '保留现有自定义，导入项覆盖同名命令', m: 'merge' },
      { label: '$(replace) 覆盖', description: '替换全部现有自定义', m: 'replace' },
    ],
    { placeHolder: `导入 ${parsed.overrides.size} 项${ignored ? `（忽略 ${ignored} 项非法/未知）` : ''}` },
  );
  if (!mode) return;
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const cur = cfg.get<Record<string, string>>('keybindings.overrides', {}) ?? {};
  const next = mode.m === 'merge'
    ? { ...cur, ...Object.fromEntries(parsed.overrides) }
    : Object.fromEntries(parsed.overrides);
  await cfg.update('keybindings.overrides', next, vscode.ConfigurationTarget.Global);
  const r = applyKeybindings();
  if (!r.ok) return;
  vscode.window.showInformationMessage(`已导入 ${parsed.overrides.size} 项并应用${ignored ? `（忽略 ${ignored} 项）` : ''}`);
  KeybindingPanel.refreshIfOpen();
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
    depsOutput: '',
    executionParameters: '',
    workingDir: '',
    hostApplication: '',
    runHostApplicationInTerminal: true,
    makeCommands: {},
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
    prefixAuto: true,
    extensionAuto: true,
    useConsoleRunner: true,
    includeInTargetAll: true,
    platforms: 0xff,
    commandsBeforeBuild: [],
    commandsAfterBuild: [],
    commandsBeforeClean: [],
    commandsAfterClean: [],
    buildScripts: [],
    envVars: [],
    alwaysRunPostBuildSteps: false,
    externalDeps: [],
    additionalOutput: [],
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
  debuggerSettings: DebuggerSettingsEditData,
): Promise<void> {
  // 项目设置（标题/默认编译器/虚拟文件夹）—— 先应用，files 的自定义命令按新默认编译器写入
  project.title = projectSettings.title.trim() || project.title;
  project.compilerId = projectSettings.compilerId.trim() || project.compilerId;
  project.virtualFolders = projectSettings.virtualFolders;
  // 工程高级设置（R7：platforms / pch_mode / extended_obj_names / makefile 模式）
  project.platforms = Number.isFinite(projectSettings.platforms) ? projectSettings.platforms : project.platforms;
  project.pchMode = projectSettings.pchMode;
  project.extendedObjNames = projectSettings.extendedObjNames === true;
  project.makefileIsCustom = projectSettings.makefileIsCustom === true;
  project.makefile = projectSettings.makefile.trim();
  project.executionDir = projectSettings.executionDir.trim();
  // 环境变量（R1：<Build><Environment>，项目级）——构建/运行宏 $(NAME) + Run/Debug 进程环境
  project.envVars = (projectSettings.envVars ?? [])
    .filter((v) => v.name)
    .map((v) => ({ name: v.name, value: v.value }));
  // 项目自定义变量（C3）：写回模型 + Extensions 原始节点（序列化时按节点重建；空 = 移除节点）
  const cvResult = applyCustomVariables(project.extensions, projectSettings.customVariables ?? []);
  project.extensions = cvResult.extensions;
  project.customVariables = cvResult.variables;
  if (cvResult.skipped.length) {
    outputChannel.warn(`[Code::Blocks] 自定义变量名不合法已跳过（不能含空格等）：${cvResult.skipped.join(', ')}`);
  }
  // 调试器配置（R3/R4：Extensions/debugger —— search_path + remote_debugging；保留其它扩展节点）
  project.extensions = applyProjectDebuggerConfig(project.extensions, debuggerSettings);
  project.notes = notes.notes;
  project.showNotesOnLoad = notes.showNotesOnLoad;
  project.buildScripts = buildScripts.project.scripts;
  project.commandsBeforeBuild = buildScripts.project.before;
  project.commandsAfterBuild = buildScripts.project.after;
  project.alwaysRunPostBuildSteps = buildScripts.project.always === true;

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
    t.executionParameters = e.executionParameters ?? '';
    // 外部依赖 / 附加输出（C2：<Option external_deps> / <Option additional_output>）
    t.externalDeps = [...(e.externalDeps ?? [])];
    t.additionalOutput = [...(e.additionalOutput ?? [])];
    // 目标环境变量（R1：<Environment>，同名时覆盖项目变量）
    t.envVars = (e.envVars ?? []).filter((v) => v.name).map((v) => ({ name: v.name, value: v.value }));
    // 高级字段（R6：working_dir / deps_output / platforms / 宿主程序 / 库命名策略）
    t.workingDir = e.workingDir ?? '';
    t.depsOutput = e.depsOutput ?? '';
    t.platforms = Number.isFinite(e.platforms) ? e.platforms : t.platforms;
    t.hostApplication = e.hostApplication ?? '';
    t.runHostApplicationInTerminal = e.runHostApplicationInTerminal !== false;
    t.useConsoleRunner = e.useConsoleRunner !== false;
    t.impLib = e.impLib ?? '';
    t.defFile = e.defFile ?? '';
    t.createDefFile = e.createDefFile === true;
    t.createStaticLib = e.createStaticLib === true;
    t.prefixAuto = e.prefixAuto !== false;
    t.extensionAuto = e.extensionAuto !== false;
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
    newTargets[i].alwaysRunPostBuildSteps = buildScripts.targets[i].always === true;
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

  // 序列化写回 .cbp + 重新解析刷新（与执行参数修改共用）
  outputChannel.info(`[Code::Blocks] 已保存工程属性: ${project.title}（${newTargets.length} 个目标）`);
  await persistProjectAndReload(project);
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
  analysisTreeProvider?.refresh();
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
  // 编译器全局搜索目录 + 链接库（default.conf /compiler_sets/<id>，对齐 Compiler::LoadSettings）
  const applyGlobalDirs = (compiler: Compiler): Compiler => {
    const uc = codeBlocksConfig?.find(id);
    if (uc?.name) compiler.name = uc.name; // 显示名对齐 CB（如 default.conf NAME=RISCV32-V3）
    const sd = codeBlocksConfig?.searchDirs(id);
    if (sd) {
      compiler.includeDirs = sd.includeDirs;
      compiler.libDirs = sd.libDirs;
      compiler.resIncludeDirs = sd.resIncludeDirs;
      compiler.linkLibs = sd.linkLibs;
      compiler.extraPaths = sd.extraPaths;
      compiler.includePrjCwd = codeBlocksConfig?.includePrjCwd() ?? false;
      compiler.includeFileCwd = codeBlocksConfig?.includeFileCwd() ?? false;
      compiler.compilerOptions = sd.compilerOptions;
      compiler.linkerOptions = sd.linkerOptions;
      compiler.resourceCompilerOptions = sd.resourceCompilerOptions;
    }
    // 用户自定义错误正则按索引覆盖/追加（对齐 Compiler::LoadSettings:699-737）
    codeBlocksConfig?.applyUserRegexes(id, compiler.regexes);
    return compiler;
  };
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
      return applyGlobalDirs(compiler);
    }

    // 次优：探测到的完整程序路径（交叉编译器如 RISC-V）
    const programs = cfg.get<Record<string, string>>('compilerPrograms', {});
    if (programs && programs.C) {
      compiler.programs = { ...compiler.programs, ...programs } as any;
    }
    return applyGlobalDirs(compiler);
  }
  // 回退：内置 GCC
  const { createGccCompiler } = require('./compiler/compiler');
  return applyGlobalDirs(createGccCompiler(process.platform, masterPath));
}

/**
 * 构建用目标编译器解析器 —— 对齐 CompilerFactory::GetCompiler(target->GetCompilerID())：
 * 编译器 ID 未注册（无 options_<id>.xml、非用户自定义编译器、非当前配置编译器）时返回 undefined，
 * 由 BuildEngine 报「invalid compiler」并跳过该目标（对齐 PreprocessJob CompilerValid + PrintInvalidCompiler）。
 * UI 路径（状态栏/面板）仍用 getCompiler（未注册时回退 GCC 模板）。
 */
function resolveTargetCompiler(compilerId: string): Compiler | undefined {
  if (!compilerId) return undefined;
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  // 对齐 CompilerFactory::GetCompiler（compilerfactory.cpp:42-58）：大小写不敏感 + 去 '-' 旧 ID 格式二次匹配
  const candidates: string[] = [];
  for (const c of [compilerId, compilerId.toLowerCase(), compilerId.replace(/-/g, '')]) {
    if (c && !candidates.includes(c)) candidates.push(c);
  }
  for (const c of candidates) {
    if (c === cfg.get<string>('compilerId', 'gcc')) return getCompiler(c);
    if (codeBlocksConfig?.find(c)) return getCompiler(c);
    if (compilerResourcesDir) {
      const lower = c.toLowerCase();
      for (const name of [`options_${c}.xml`, `options_${lower}.xml`]) {
        if (fs.existsSync(path.join(compilerResourcesDir, name))) return getCompiler(c);
      }
    }
  }
  return undefined;
}

/** 编译器探测结果跨会话缓存（globalState；TTL 24h 或 masterPath 变化失效） */
const DETECT_CACHE_KEY = 'codeblocks.detectedCompilersCache';
const DETECT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface DetectCacheEntry {
  masterPath: string;
  at: number;
  list: DetectedCompiler[];
}

function loadDetectCache(): DetectCacheEntry | undefined {
  try {
    const raw = extContext?.globalState.get<DetectCacheEntry>(DETECT_CACHE_KEY);
    if (!raw || !Array.isArray(raw.list)) return undefined;
    if (Date.now() - (raw.at ?? 0) > DETECT_CACHE_TTL_MS) return undefined;
    return raw;
  } catch {
    return undefined;
  }
}

function saveDetectCache(masterPath: string, list: DetectedCompiler[]): void {
  try {
    void extContext?.globalState.update(DETECT_CACHE_KEY, { masterPath, at: Date.now(), list });
  } catch { /* 非关键 */ }
}

async function detectCompilers(): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const masterPath = cfg.get<string>('masterPath', '');

  interface CompilerPick extends vscode.QuickPickItem { compiler?: DetectedCompiler; }
  const toItems = (list: DetectedCompiler[]): CompilerPick[] =>
    list.map((d) => ({
      label: d.name,
      description: d.version ?? d.masterPath,
      detail: d.cCompilerPath,
      compiler: d,
    }));

  // 跨会话缓存预填（masterPath 一致且未过期）
  const cached = loadDetectCache();
  const initial = cached && cached.masterPath === masterPath ? cached.list : [];

  // 立即弹窗（缓存预填 + busy 进度条），后台异步并行探测，完成后刷新列表
  const qp = vscode.window.createQuickPick<CompilerPick>();
  qp.placeholder = initial.length ? '选择要使用的编译器（正在后台重新探测…）' : '正在探测编译器…';
  qp.busy = true;
  qp.items = toItems(initial);

  let chosen: CompilerPick | undefined;
  const done = new Promise<void>((resolve) => {
    qp.onDidAccept(() => {
      chosen = qp.selectedItems[0];
      qp.hide();
    });
    qp.onDidHide(() => resolve());
  });
  qp.show();

  // 让出主线程，先渲染弹窗，再开始探测
  await new Promise((r) => setImmediate(r));
  let detected: DetectedCompiler[] | undefined;
  try {
    detected = await detectAllCompilersAsync(masterPath);
  } catch {
    detected = undefined;
  }

  if (detected) {
    saveDetectCache(masterPath, detected);
    if (!chosen) {
      qp.busy = false;
      qp.placeholder = '选择要使用的编译器';
      qp.items = toItems(detected);
      if (detected.length === 0) {
        qp.hide();
        vscode.window.showWarningMessage('未探测到可用的编译器（GCC/Clang/MSVC/RISC-V）');
      }
    }
  } else if (!chosen) {
    qp.busy = false;
    qp.placeholder = initial.length ? '选择要使用的编译器（探测失败，显示缓存结果）' : '编译器探测失败';
    if (initial.length === 0) {
      qp.hide();
      vscode.window.showWarningMessage('编译器探测失败（详情见 Code::Blocks 输出）');
    }
  }

  await done;
  qp.dispose();

  const picked = chosen?.compiler;
  if (picked) {
    await cfg.update('compilerId', picked.id, vscode.ConfigurationTarget.Global);
    if (picked.masterPath) {
      await cfg.update('masterPath', picked.masterPath, vscode.ConfigurationTarget.Global);
    }
    // 交叉编译器：持久化完整程序路径；标准编译器：清空以回退到 PATH 查找
    if (picked.programs) {
      await cfg.update('compilerPrograms', picked.programs, vscode.ConfigurationTarget.Global);
    } else {
      await cfg.update('compilerPrograms', {}, vscode.ConfigurationTarget.Global);
    }
    vscode.window.showInformationMessage(`已选择编译器: ${picked.name}`);
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

/** Build 项悬停就地菜单（空闲态：四项构建命令链接） */
function buildStatusHoverTooltip(): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  const l = (icon: string, label: string, command: string): string => `[${icon} ${label}](command:${command})`;
  md.value = [
    '**构建菜单**',
    [l('$(package)', 'Build', 'codeblocks.build'), l('$(sync)', 'Rebuild', 'codeblocks.rebuild')].join('　'),
    [l('$(multiple-windows)', 'Build Workspace', 'codeblocks.buildWorkspace'), l('$(multiple-windows)', 'Rebuild Workspace', 'codeblocks.rebuildWorkspace')].join('　'),
    '点击打开构建菜单（构建中点击 = 停止构建）',
  ].join('\n\n');
  return md;
}

/** Build 项悬停菜单（构建中：停止构建链接 + 实时秒数） */
function buildStopHoverTooltip(seconds: number): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.value = `**构建进行中（${seconds}s）**\n\n[$(debug-stop) 停止构建](command:codeblocks.build.stop)`;
  return md;
}

/** Project 标题栏可配置按钮清单（与 package.json view/title 的 codeblocks.tb.* 上下文键对应） */
const PROJECT_TOOLBAR_ITEMS = [
  'newProject', 'openProject', 'build', 'rebuild', 'clean', 'run', 'debug',
  'buildWorkspace', 'rebuildWorkspace', 'cleanWorkspace',
  'compilerOptions', 'projectProperties', 'codeStats',
];
/** 默认常驻按钮（与设置默认值一致） */
const PROJECT_TOOLBAR_DEFAULT = ['buildWorkspace', 'rebuildWorkspace', 'cleanWorkspace'];

/** 依据设置刷新 Project 标题栏按钮上下文键（选中=标题栏显示；未选中=⋯ 溢出菜单） */
function applyProjectToolbarContext(): void {
  const cfg = vscode.workspace.getConfiguration('codeblocks').get<string[]>('ui.projectToolbar', PROJECT_TOOLBAR_DEFAULT) ?? PROJECT_TOOLBAR_DEFAULT;
  const enabled = new Set(cfg.map((s) => String(s).replace(/^codeblocks\./, '')));
  for (const name of PROJECT_TOOLBAR_ITEMS) {
    void vscode.commands.executeCommand('setContext', `codeblocks.tb.${name}`, enabled.has(name));
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
  updateCbpStatusBar();
}

/** 返回当前活动工程选中的构建目标标题；未选中时默认第一个（构建/运行/调试的兜底入口） */
async function selectTarget(): Promise<string | undefined> {
  const project = requireProject();
  if (!project) return undefined;
  // 目标列表排除不支持当前平台的目标（对齐 UpdateProjectTargets）
  const titles = [
    ...project.buildTargets.filter((t) => supportsCurrentPlatform(t.platforms)).map((t) => t.title),
    ...project.virtualTargets.map((v) => v.title),
  ];
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
  const titles = [
    ...project.buildTargets.filter((t) => supportsCurrentPlatform(t.platforms)).map((t) => t.title),
    ...project.virtualTargets.map((v) => v.title),
  ];
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

/** Rebuild 确认对话框 —— 对齐 Code::Blocks 的 "Rebuild project?" 确认（删除对象文件 + 全量编译） */
async function confirmRebuild(): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    '重新构建将删除所有对象文件并全量重新编译，确定继续？',
    { modal: true },
    '重新构建',
  );
  return choice === '重新构建';
}

/**
 * 构建前停止调试会话 —— 对齐 StopRunningDebugger（compilergcc.cpp:879-905）：
 * 调试器运行中 → 模态询问；确认则停止并继续，否则记录 Aborting (re-)build. 并中止构建。
 */
async function stopDebuggerIfRunning(): Promise<boolean> {
  const session = vscode.debug.activeDebugSession;
  if (!session) return true;
  const choice = await vscode.window.showWarningMessage(
    'The debugger must be stopped to do a (re-)build.\nDo you want to stop the debugger now?',
    { modal: true },
    '停止调试并构建',
  );
  if (choice !== '停止调试并构建') {
    outputChannel.info('[Code::Blocks] Aborting (re-)build.');
    return false;
  }
  outputChannel.info('[Code::Blocks] Stopping debugger...');
  await vscode.debug.stopDebugging(session);
  return true;
}

/**
 * 构建结果汇报：
 * - 默认（增强模式）：中文 + Emoji 通知
 * - codeblocks.log.english：英文文案
 * - codeblocks.build.plainCbLog：CB 风格 `=== Build finished: N error(s), N warning(s) (x minute(s), y second(s)) ===`，无 Emoji 通知
 */
function reportBuildResult(success: boolean, cancelled: boolean, buildStartMs: number, errorCount: number, warningCount: number): void {
  if (cancelled) {
    const en = 'Build cancelled (user interrupted)';
    outputChannel.warn(buildLogPrefs().plain ? en : msg('[Code::Blocks] ⚠ 构建已取消（用户中断）', en));
    vscode.window.showWarningMessage(buildLogPrefs().plain ? en : msg('⚠ 构建已取消', en));
    return;
  }
  if (buildLogPrefs().plain) {
    const secs = Math.round((Date.now() - buildStartMs) / 1000);
    const line = `=== Build ${success ? 'finished' : 'failed'}: ${errorCount} error(s), ${warningCount} warning(s) (${Math.floor(secs / 60)} minute(s), ${secs % 60} second(s)) ===`;
    if (success) outputChannel.info(line);
    else outputChannel.error(line);
    return;
  }
  if (success) {
    outputChannel.info(msg('[Code::Blocks] 构建成功', '[Code::Blocks] Build finished'));
    // quietSuccess 模式：不弹 toast，仅日志 + 状态栏徽标
    if (!quietSuccess()) {
      vscode.window.showInformationMessage(msg(`✅ 构建成功 · ${errorCount} 错误 · ${warningCount} 警告`, `Build finished: ${errorCount} error(s), ${warningCount} warning(s)`));
    }
  } else {
    outputChannel.error(msg('[Code::Blocks] 构建失败', '[Code::Blocks] Build failed'));
    vscode.window.showErrorMessage(msg(`❌ 构建失败 · ${errorCount} 错误 · ${warningCount} 警告`, `Build failed: ${errorCount} error(s), ${warningCount} warning(s)`));
  }
}

/** 主 Build —— 对齐 CB OnBuild：仅活动项目；多工程且无活动项目时询问（AskForActiveProject:1080） */
async function build(rebuild: boolean): Promise<boolean> {
  // 构建互斥：进行中时忽略新的构建命令（防止双开构建进程打架）
  if (buildInProgress) {
    vscode.window.showWarningMessage('已有构建正在进行，请等待完成或先停止');
    return false;
  }
  if (openProjects.length === 0) {
    vscode.window.showWarningMessage('请先打开一个 Code::Blocks 项目 (.cbp)');
    return false;
  }

  let project = activeProject && openProjects.includes(activeProject)
    ? activeProject
    : openProjects.length === 1 ? openProjects[0] : undefined;
  if (!project) {
    // 对齐 AskForActiveProject：多工程且无活动项目 → 询问选择
    const title = await vscode.window.showQuickPick(openProjects.map((p) => p.title), {
      placeHolder: '选择要构建的工程（设为活动项目）',
    });
    project = openProjects.find((p) => p.title === title);
    if (!project) return false;
    setActiveProject(project, { persist: true });
  }
  return await buildSingleProject(project.filename, rebuild);
}

/** Build Workspace —— 对齐 CB OnBuildWorkspace：全部工程选中目标，依赖拓扑排序 */
async function buildWorkspace(rebuild: boolean, clearLog = true): Promise<boolean> {
  // 构建互斥：进行中时忽略新的构建命令（防止双开构建进程打架）
  if (buildInProgress) {
    vscode.window.showWarningMessage('已有构建正在进行，请等待完成或先停止');
    return false;
  }
  if (openProjects.length === 0) {
    vscode.window.showWarningMessage('请先打开一个 Code::Blocks 项目 (.cbp)');
    return false;
  }

  // 对齐 DoBuild:2897：构建/重建/清理前须先停止调试会话
  if (!(await stopDebuggerIfRunning())) {
    return false;
  }

  // Rebuild 前由用户确认（对齐 Code::Blocks 的 Rebuild 确认对话框）
  if (rebuild && !(await confirmRebuild())) {
    return false;
  }

  // 构建前自动保存工作区未保存文件
  await saveAllBeforeBuild();

  if (clearLog) {
    diagnosticCollection.clear();
    outputChannel.clear();
  }
  outputChannel.show(true);
  outputChannel.info(`[Code::Blocks] ${msg(`开始构建 ${rebuild ? '(重新构建)' : ''}...（共 ${openProjects.length} 个项目）`, `Starting build${rebuild ? ' (rebuild)' : ''}... (${openProjects.length} project(s))`)}`);

  const buildStartMs = Date.now();
  currentBuildProjects.length = 0;
  currentBuildErrorCount = 0;
  maxErrorsReached = false;

  const total = openProjects.length;
  let done = 0;
  let allOk = true;
  let cancelled = false;
  buildInProgress = true;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Code::Blocks ${rebuild ? '重新构建' : '构建'}中...`, cancellable: true },
      async (progress, token) => {
        // 取消源：通知 ❌ 按钮与「停止构建」命令共用；取消后引擎强杀所有活动子进程
        const cancelSource = new BuildCancelSource();
        currentBuildCancel = cancelSource;
        token.onCancellationRequested(() => cancelSource.cancel());
        try {
          // 工作区构建：每个工程构建它自己的活动目标（对齐 CodeBlocks Build Workspace 语义）
          // 依赖排序：依赖工程先构建（.workspace 的 <Depends>，DFS 拓扑排序）
          for (const project of topologicalBuildOrder(openProjects)) {
            // 项目级平台过滤（对齐 compilergcc.cpp:2724：项目不支持当前平台 → 整个跳过）
            if (!supportsCurrentPlatform(project.platforms)) {
              outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 不支持当前平台，跳过`);
              done++;
              progress.report({ increment: 100 / total });
              continue;
            }
            // 默认目标跳过不支持平台的目标（对齐 GetFirstValidBuildTargetName）
            const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
            if (!targetTitle) {
              outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 没有构建目标，跳过`);
              done++;
              progress.report({ increment: 100 / total });
              continue;
            }
            progress.report({ message: `${done + 1}/${total} ${project.title}` });
            const ok = await buildOneProject(project, targetTitle, rebuild, cancelSource);
            done++;
            progress.report({ increment: 100 / total });
            if (cancelSource.isCancelled()) {
              cancelled = true;
              allOk = false;
              break;
            }
            if (!ok) {
              allOk = false;
              break;
            }
          }
        } finally {
          currentBuildCancel = undefined;
        }
      },
    );
  } catch (e) {
    // 用户取消时 withProgress 会以 CancellationError 拒绝（任务已由各检查点快速收尾）
    if (e instanceof vscode.CancellationError) {
      cancelled = true;
      allOk = false;
    } else {
      throw e;
    }
  } finally {
    buildInProgress = false;
    currentBuildCancel = undefined;
  }

  const { errorCount, warningCount } = buildResultStats();
  reportBuildResult(allOk && !cancelled, cancelled, buildStartMs, errorCount, warningCount);
  finishBuildSummary(allOk && !cancelled, buildStartMs);

  return allOk && !cancelled;
}

/** 构建单个项目（右键菜单的 Build/Rebuild 与主 Build 命令使用，对齐 CB 单活动项目 Build） */
async function buildSingleProject(filename: string, rebuild: boolean): Promise<boolean> {
  // 构建互斥：进行中时忽略新的构建命令
  if (buildInProgress) {
    vscode.window.showWarningMessage('已有构建正在进行，请等待完成或先停止');
    return false;
  }

  // 对齐 DoBuild:2897：构建前须先停止调试会话
  if (!(await stopDebuggerIfRunning())) {
    return false;
  }

  // Rebuild 前由用户确认（对齐 Code::Blocks 的 Rebuild 确认对话框）
  if (rebuild && !(await confirmRebuild())) {
    return false;
  }

  const project = openProjects.find((p) => p.filename === filename);
  if (!project) {
    vscode.window.showWarningMessage('项目未找到');
    return false;
  }
  // 单工程编译时，活动工程也切换为该工程（状态栏 / 后续构建 / clangd 随之更新）
  setActiveProject(project, { persist: true });
  await saveAllBeforeBuild();

  // 项目级平台过滤（对齐 compilergcc.cpp:2724）
  if (!supportsCurrentPlatform(project.platforms)) {
    outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 不支持当前平台，跳过`);
    vscode.window.showWarningMessage(`项目 "${project.title}" 不支持当前平台`);
    return false;
  }

  const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
  if (!targetTitle) {
    vscode.window.showWarningMessage('项目没有构建目标');
    return false;
  }

  diagnosticCollection.clear();
  outputChannel.clear();
  outputChannel.show(true);
  outputChannel.info(`[Code::Blocks] ${msg(`开始构建 ${rebuild ? '(重新构建)' : ''}...（单项目）`, `Starting build${rebuild ? ' (rebuild)' : ''}... (single project)`)}`);

  const buildStartMs = Date.now();
  currentBuildProjects.length = 0;
  currentBuildErrorCount = 0;
  maxErrorsReached = false;

  let ok = false;
  let cancelled = false;
  buildInProgress = true;
  try {
    ok = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Code::Blocks ${rebuild ? '重新构建' : '构建'}中...`, cancellable: true },
      async (progress, token) => {
        const cancelSource = new BuildCancelSource();
        currentBuildCancel = cancelSource;
        token.onCancellationRequested(() => cancelSource.cancel());
        try {
          progress.report({ message: project.title });
          return await buildOneProject(project, targetTitle, rebuild, cancelSource);
        } finally {
          currentBuildCancel = undefined;
        }
      },
    );
  } catch (e) {
    if (e instanceof vscode.CancellationError) {
      cancelled = true;
      ok = false;
    } else {
      throw e;
    }
  } finally {
    buildInProgress = false;
    currentBuildCancel = undefined;
  }

  const { errorCount, warningCount } = buildResultStats();
  reportBuildResult(ok && !cancelled, cancelled, buildStartMs, errorCount, warningCount);
  finishBuildSummary(ok && !cancelled, buildStartMs);
  return ok && !cancelled;
}

/** 单文件编译（对齐 Code::Blocks Build file：CompileFile，只编译不链接） */
async function buildSingleFile(project: Project, file: ProjectFile): Promise<void> {
  // 构建互斥：进行中时忽略新的编译命令
  if (buildInProgress) {
    vscode.window.showWarningMessage('已有构建正在进行，请等待完成或先停止');
    return;
  }
  if (project.filename !== activeProject?.filename) {
    setActiveProject(project, { persist: true });
  }
  await saveAllBeforeBuild();

  // 项目级平台过滤（对齐 compilergcc.cpp:2724）
  if (!supportsCurrentPlatform(project.platforms)) {
    outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 不支持当前平台，跳过`);
    return;
  }
  const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
  if (!targetTitle) {
    vscode.window.showWarningMessage('项目没有构建目标');
    return;
  }
  const target = project.buildTargets.find((t) => t.title === targetTitle);
  if (!target) return;
  const compiler = getCompiler(target.compilerId || project.compilerId);

  outputChannel.show(true);
  const engine = new BuildEngine(project, compiler, outputChannel, (id) => resolveTargetCompiler(id));
  const cancelSource = new BuildCancelSource();
  currentBuildCancel = cancelSource;
  buildInProgress = true;
  let ok = false;
  let cancelled = false;
  try {
    ok = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Code::Blocks 编译文件 ${file.relativeFilename}...`, cancellable: true },
      async (_progress, token) => {
        token.onCancellationRequested(() => cancelSource.cancel());
        return engine.compileFile(targetTitle, file.relativeFilename, {
          rebuild: false,
          cancel: cancelSource,
          onLine: (line, severity) => {
            if (severity === 'error') outputChannel.error(line);
            else if (severity === 'warning') outputChannel.warn(line);
            else outputChannel.info(line);
          },
          onDiagnostic: (diag, fileUri) => {
            // clangd 接管诊断时，Problems 面板由 clangd 产出（对齐整目标构建）
            if (clangdDiagnosticsEnabled) return;
            const uri = fileUri ?? vscode.Uri.file(project.basePath);
            const diags = diagnosticCollection.get(uri) ?? [];
            diagnosticCollection.set(uri, [...diags, diag]);
          },
        });
      },
    );
  } catch (e) {
    if (e instanceof vscode.CancellationError) {
      cancelled = true;
      ok = false;
    } else {
      throw e;
    }
  } finally {
    buildInProgress = false;
    currentBuildCancel = undefined;
  }

  if (cancelled) {
    outputChannel.warn(buildLogPrefs().plain ? 'Compile cancelled (user interrupted)' : '[Code::Blocks] ⚠ 单文件编译已取消（用户中断）');
  } else if (ok) {
    outputChannel.info(msg(`[Code::Blocks] ✅ 单文件编译成功: ${file.relativeFilename}`, `[Code::Blocks] Compile finished: ${file.relativeFilename}`));
  } else {
    outputChannel.error(msg(`[Code::Blocks] ❌ 单文件编译失败: ${file.relativeFilename}`, `[Code::Blocks] Compile failed: ${file.relativeFilename}`));
  }
}

/** 单文件清理（对齐 Code::Blocks Clean file：删除对象文件，needDependencies 时连带依赖文件） */
async function cleanSingleFile(project: Project, file: ProjectFile): Promise<void> {
  if (buildInProgress) {
    vscode.window.showWarningMessage('已有构建正在进行，请等待完成或先停止');
    return;
  }
  const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
  if (!targetTitle) {
    vscode.window.showWarningMessage('项目没有构建目标');
    return;
  }
  const target = project.buildTargets.find((t) => t.title === targetTitle);
  if (!target) return;
  const compiler = getCompiler(target.compilerId || project.compilerId);
  outputChannel.show(true);
  new BuildEngine(project, compiler, outputChannel, (id) => resolveTargetCompiler(id)).cleanFile(targetTitle, file.relativeFilename);
}

/** 构建单个项目的一个目标（被 build / buildSingleProject 复用）；支持虚拟目标展开 */
async function buildOneProject(project: Project, targetTitle: string, rebuild: boolean, cancel?: BuildCancelHandle): Promise<boolean> {
  // 虚拟目标：展开为其包含的物理目标，在同一个 engine.build 调用里逐个构建
  // （项目级 pre/post 只执行一次，对齐 CodeBlocks 状态机 bsProjectPreBuild/bsProjectPostBuild）
  const vt = project.virtualTargets.find((v) => v.title === targetTitle);
  const targetTitles: string[] = vt ? vt.targets : [targetTitle];

  const target = vt
    ? project.buildTargets.find((t) => vt.targets.includes(t.title))
    : project.buildTargets.find((t) => t.title === targetTitle);
  if (!target || !supportsCurrentPlatform(target.platforms)) {
    outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 无目标 "${targetTitle}"（或不支持当前平台），跳过`);
    return true;
  }

  // makefile 项目模式（对齐 UseMake：Build/Rebuild 走 make 命令而非内部引擎，GetMakeCommandFor:2178-2197）
  if (project.makefileIsCustom) {
    if (rebuild) {
      const cleanCmd = getMakeCommand(project, target, 'clean');
      if (cleanCmd && !(await runMakeBuild(project, cleanCmd, targetTitle))) return false;
    }
    const buildCmd = getMakeCommand(project, target, 'build');
    if (!buildCmd) {
      outputChannel.error(`[Code::Blocks] makefile 项目 "${project.title}" 未配置 <MakeCommands><Build command=...>`);
      return false;
    }
    return await runMakeBuild(project, buildCmd, targetTitle);
  }

  const compiler = getCompiler(target.compilerId || project.compilerId);
  // 构建 Banner 由引擎在项目 pre-build 之后、每个目标构建前打印（对齐 bsTargetPreBuild 的 PrintBanner）

  // 本次项目构建的摘要数据（供 Build Log 视图）
  const diagnostics: BuildLogDiagnostic[] = [];
  const startMs = Date.now();

  const engine = new BuildEngine(project, compiler, outputChannel, (id) => resolveTargetCompiler(id));
  const ok = await engine.build(targetTitles, {
    rebuild,
    cancel,
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
  const stats = engine.lastStats ?? { success: ok, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: ok, linkSkipped: true, hadCommands: false, outputFilename: undefined };
  // 取消判定：引擎统计标记或取消源已置位（用户中途停止）
  const cancelled = !!stats.cancelled || !!cancel?.isCancelled();
  const projectName = path.basename(path.dirname(project.filename));

  // === 构建完成汇总块（OUTPUT 文本，Emoji 风格；plainCbLog 模式跳过，对齐 CB 纯日志）===
  if (!buildLogPrefs().plain) {
    const doneSym = cancelled ? '⚠' : ok ? '✅' : '❌';
    const errCount = diagnostics.filter((d) => d.severity === 'error').length;
    const warnCount = diagnostics.filter((d) => d.severity === 'warning').length;
    outputChannel.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    outputChannel.info(`${doneSym} ${cancelled ? '构建已取消' : '构建完成'}: ${project.title} (${targetTitle})`);
    outputChannel.info(`🔨 编译 ${stats.compiledCount} · ⏭️ 跳过 ${stats.skippedCount} · ❌ 失败 ${stats.failedCount}`);
    if (!stats.linkSkipped) {
      outputChannel.info(`${stats.linkSuccess ? '🔗' : '❌'} 链接${stats.linkSuccess ? '成功' : '失败'}${stats.outputFilename ? ` → ${stats.outputFilename}` : ''}`);
    }
    outputChannel.info(`🐞 错误 ${errCount} · ⚠️ 警告 ${warnCount}`);
    outputChannel.info(`⏱️ 用时 ${(durationMs / 1000).toFixed(1)}s`);
    // 最慢 Top 3（定位慢文件）
    const top = [...engine.lastCompileTimings].sort((a, b) => b.ms - a.ms).slice(0, 3);
    if (top.length) {
      outputChannel.info(`🐢 最慢: ${top.map((t) => `${t.file} (${(t.ms / 1000).toFixed(1)}s)`).join(' · ')}`);
    }
    outputChannel.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  }

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

  if (!ok && !cancelled) {
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

/** 头文件保护风格（设置 editor.headerGuardStyle；缺省 ifndef） */
function headerGuardStyle(): 'ifndef' | 'pragma-once' {
  return vscode.workspace.getConfiguration('codeblocks').get<string>('editor.headerGuardStyle', 'ifndef') === 'pragma-once'
    ? 'pragma-once'
    : 'ifndef';
}

/** 「最近工程」列表上限（设置 ui.recentProjectsLimit，0 = 不记录；越界钳制 0–50） */
function recentProjectsLimit(): number {
  const raw = vscode.workspace.getConfiguration('codeblocks').get<number>('ui.recentProjectsLimit', 8);
  return Number.isFinite(raw) ? Math.max(0, Math.min(50, raw)) : 8;
}

/** 记录最近打开工程（globalState，上限可配（ui.recentProjectsLimit），E1） */
function recordRecentProject(filename: string): void {
  try {
    const limit = recentProjectsLimit();
    if (limit === 0) return;
    const list = extContext?.globalState.get<string[]>('codeblocks.recentProjects', []) ?? [];
    const next = [filename, ...list.filter((f) => f !== filename)].slice(0, limit);
    void extContext?.globalState.update('codeblocks.recentProjects', next);
  } catch { /* 非关键 */ }
}

/** 菜单动态区数据（最近工程 + 工作区拓扑构建顺序，E1/E2）——供状态栏菜单按需拉取 */
function getMenuDynamicData(): MenuDynamicData {
  try {
    const recents = (extContext?.globalState.get<string[]>('codeblocks.recentProjects', []) ?? [])
      .filter((f) => fs.existsSync(f))
      .slice(0, recentProjectsLimit());
    return {
      recents: recents.map((f) => ({ label: path.basename(f), file: f })),
      order: topologicalBuildOrder(openProjects).map((p, i) => ({
        label: `${i + 1}. ${path.basename(path.dirname(p.filename)) || p.title}`,
        file: p.filename,
      })),
      hasProjects: openProjects.length > 0,
      tools: parseToolsSetting(vscode.workspace.getConfiguration('codeblocks').get('tools')).map((t, i) => ({ label: t.name, index: i })),
    };
  } catch {
    return { recents: [], order: [], hasProjects: openProjects.length > 0, tools: [] };
  }
}

/** 活动编辑器文件路径（仅 file scheme；无可用编辑器返回 undefined） */
function activeEditorFsPath(): string | undefined {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') return undefined;
  return editor.document.uri.fsPath;
}

/**
 * 插入头文件保护宏（D1，对齐 headerguard 插件）：
 * 顶部 `#ifndef/#define`、底部 `#endif`；已有保护（#pragma once / #ifndef）不处理。
 */
async function insertHeaderGuardInActiveEditor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    vscode.window.showInformationMessage('请先打开一个文件');
    return;
  }
  const doc = editor.document;
  const text = doc.getText();
  const updated = applyHeaderGuard(doc.uri.fsPath, text, headerGuardStyle());
  if (updated === null) {
    vscode.window.showInformationMessage('已存在头文件保护（#pragma once / #ifndef）');
    return;
  }
  const edit = new vscode.WorkspaceEdit();
  edit.replace(doc.uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), updated);
  await vscode.workspace.applyEdit(edit);
}

/**
 * 新建文件自动插入头文件保护（设置 codeblocks.editor.autoHeaderGuard，默认关）：
 * 仅对新建的空头文件（.h/.hh/.hpp/.hxx）生效，已有保护/非空文件跳过。
 */
async function autoInsertHeaderGuards(files: readonly vscode.Uri[]): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  if (!cfg.get<boolean>('editor.autoHeaderGuard', false)) return;
  for (const uri of files) {
    if (uri.scheme !== 'file' || !/\.(h|hh|hpp|hxx)$/i.test(uri.fsPath)) continue;
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const text = doc.getText();
      if (text.trim()) continue; // 仅空文件
      const updated = applyHeaderGuard(uri.fsPath, text, headerGuardStyle());
      if (updated === null) continue;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(doc.positionAt(0), doc.positionAt(text.length)), updated);
      await vscode.workspace.applyEdit(edit);
    } catch { /* 非关键：单个文件失败不影响其他文件 */ }
  }
}

/** Tidy 注释块（D3，对齐 tidycmt 插件）：整理当前选中的块注释（对齐 / 空格规范 / 超宽换行） */
async function tidyCommentsInActiveEditor(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== 'file') {
    vscode.window.showInformationMessage('请先打开一个文件');
    return;
  }
  const sel = editor.selection;
  if (sel.isEmpty) {
    vscode.window.showInformationMessage('请先选中要整理的块注释（多行），再执行 Tidy Comments');
    return;
  }
  const selected = editor.document.getText(sel);
  const rawWidth = vscode.workspace.getConfiguration('codeblocks').get<number>('editor.tidyCommentWidth', 80);
  const width = Number.isFinite(rawWidth) ? Math.max(20, Math.min(200, rawWidth)) : 80;
  const updated = tidyCommentBlock(selected, width);
  if (updated === selected) {
    vscode.window.setStatusBarMessage('注释已是整洁格式，无更改', 2500);
    return;
  }
  await editor.edit((b) => b.replace(sel, updated));
}

/**
 * 头文件/源文件互换（D4，对齐 Code::Blocks 的 Swap header/source）：
 * 同目录同名主干（大小写不敏感）优先，其次活动工程文件列表。
 */
async function swapHeaderSource(): Promise<void> {
  const cur = activeEditorFsPath();
  if (!cur) {
    vscode.window.showInformationMessage('请先打开一个 C/C++ 源文件或头文件');
    return;
  }
  const extMap: Record<string, string[]> = {
    '.c': ['.h'],
    '.h': ['.c', '.cpp', '.cc', '.cxx'],
    '.cpp': ['.h', '.hpp'],
    '.cc': ['.h', '.hpp'],
    '.cxx': ['.h', '.hpp'],
    '.hpp': ['.cpp', '.cc', '.cxx'],
    '.hxx': ['.cpp', '.cc', '.cxx'],
    '.inl': ['.cpp', '.c'],
  };
  const ext = path.extname(cur).toLowerCase();
  const targets = extMap[ext];
  if (!targets) {
    vscode.window.showInformationMessage(`不支持的文件类型：${ext || '(无扩展名)'}`);
    return;
  }
  const dir = path.dirname(cur);
  const stem = path.basename(cur, path.extname(cur)).toLowerCase();
  const targetSet = new Set(targets.map((t) => t.toLowerCase()));

  // 1) 同目录同名主干（含大小写不敏感扫描）
  let found: string | undefined;
  try {
    const entries = await fs.promises.readdir(dir);
    for (const e of entries) {
      const eExt = path.extname(e).toLowerCase();
      if (!targetSet.has(eExt)) continue;
      if (path.basename(e, path.extname(e)).toLowerCase() === stem) { found = path.join(dir, e); break; }
    }
  } catch { /* 目录读取失败：回退工程文件列表 */ }

  // 2) 活动工程文件列表
  if (!found && activeProject) {
    for (const f of activeProject.files) {
      const abs = f.absolutePath || path.join(activeProject.basePath || path.dirname(activeProject.filename), f.relativeFilename);
      const eExt = path.extname(abs).toLowerCase();
      if (!targetSet.has(eExt)) continue;
      if (path.basename(abs, path.extname(abs)).toLowerCase() === stem) { found = abs; break; }
    }
  }
  if (!found) {
    vscode.window.showInformationMessage(`未找到与「${path.basename(cur)}」同名的 ${targets.join(' / ')} 文件`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(found));
  await vscode.window.showTextDocument(doc, { preview: false });
}

/** 自定义工具输出通道（按需创建） */
let toolsOutputChannel: vscode.LogOutputChannel | undefined;
function getToolsOutputChannel(): vscode.LogOutputChannel {
  if (!toolsOutputChannel) {
    toolsOutputChannel = vscode.window.createOutputChannel('Code::Blocks Tools', { log: true });
    extContext?.subscriptions.push(toolsOutputChannel);
  }
  return toolsOutputChannel;
}

/** 终端模式参数引号（含空白/元字符时加双引号，内部双引号翻倍） */
function quoteToolArg(arg: string): string {
  return /[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg;
}

/**
 * 运行用户自定义工具（E1，对齐 Code::Blocks Tools → Configure tools…）：
 * 输出模式 output（专用输出通道）/ terminal（集成终端）/ silent（无输出）。
 */
async function runConfiguredTool(index: number): Promise<void> {
  const tools = parseToolsSetting(vscode.workspace.getConfiguration('codeblocks').get('tools'));
  const tool = tools[index];
  if (!tool) {
    vscode.window.showWarningMessage('未找到自定义工具（设置 → codeblocks.tools）');
    return;
  }
  const file = activeEditorFsPath();
  const project = activeProject;
  const projDir = project ? (project.basePath || path.dirname(project.filename)) : undefined;
  const target = project
    ? project.buildTargets.find((t) => t.title === getSelectedTarget(project))
      ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))
    : undefined;
  const ctx: ToolContext = {
    file,
    fileDir: file ? path.dirname(file) : undefined,
    projectDir: projDir,
    projectName: project?.title,
    workspaceFolder: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    vars: project && target
      ? { ...envVarMap(project.envVars, target.envVars), ...cbBuiltinVars(project.basePath, target.outputFilename, target.title, target.objectOutput, project.title, project.filename, getCompiler(target.compilerId)?.masterPath ?? '') }
      : undefined,
    customVars: project?.customVariables,
  };
  const inv = buildToolInvocation(tool, ctx);
  const cwd = inv.cwd || projDir || (file ? path.dirname(file) : undefined) || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const env = { ...process.env, ...(tool.env ?? {}) };

  if (tool.output === 'terminal') {
    const term = vscode.window.createTerminal({ name: `CB Tool: ${tool.name}`, cwd, env: tool.env });
    term.sendText([inv.command, ...inv.args.map(quoteToolArg)].join(' '));
    term.show(true);
    return;
  }
  if (tool.output === 'silent') {
    try {
      spawn(inv.command, inv.args, { cwd, env, stdio: 'ignore' })
        .on('error', () => { /* 静默模式：忽略启动错误 */ });
    } catch { /* 忽略 */ }
    return;
  }
  // output：专用输出通道（选中即运行，输出带工具名与退出码）
  const channel = getToolsOutputChannel();
  channel.show(true);
  channel.appendLine(`\n[${tool.name}] > ${[inv.command, ...inv.args].join(' ')}${cwd ? `   (cwd: ${cwd})` : ''}`);
  try {
    const child = spawn(inv.command, inv.args, { cwd, env });
    child.stdout?.on('data', (d: Buffer) => channel.append(d.toString()));
    child.stderr?.on('data', (d: Buffer) => channel.append(d.toString()));
    child.on('error', (err) => channel.appendLine(`[${tool.name}] 启动失败：${err.message}`));
    child.on('close', (code) => channel.appendLine(`[${tool.name}] 退出码 ${code ?? '?'}`));
  } catch (err) {
    channel.appendLine(`[${tool.name}] 启动失败：${String(err)}`);
  }
}

/** 编译器命令查看（B3）：编译器命令模板 + 活动工程展开预览（虚拟文档） */
async function showCompilerCommandsDocument(): Promise<void> {
  const project = activeProject;
  const compilerId = project?.compilerId || vscode.workspace.getConfiguration('codeblocks').get<string>('compilerId', 'gcc');
  const compiler = getCompiler(compilerId);
  if (!compiler) {
    vscode.window.showWarningMessage(`未找到编译器定义: ${compilerId}`);
    return;
  }
  const L: string[] = [];
  L.push(`# 编译器命令模板 — ${compiler.name || compiler.id}`);
  L.push('');
  L.push(`- ID: \`${compiler.id}\``);
  L.push(`- 根目录: ${compiler.masterPath || '(未设置，从 PATH 探测)'}`);
  const progLines = Object.entries(compiler.programs ?? {})
    .filter(([, v]) => !!v)
    .map(([k, v]) => `  - ${k}: \`${v}\``);
  if (progLines.length) {
    L.push('- 程序:');
    L.push(...progLines);
  }
  L.push('');
  compiler.commands.forEach((tpls, idx) => {
    if (!tpls || !tpls.length) return;
    for (const tpl of tpls) {
      L.push(`## ${CommandType[idx] ?? 'CommandType ' + idx}`);
      L.push('```');
      L.push(tpl.command);
      L.push('```');
      const meta: string[] = [];
      if (tpl.extensions?.length) meta.push('适用扩展名: ' + tpl.extensions.join(', '));
      if (tpl.generatedFiles?.length) meta.push('生成文件: ' + tpl.generatedFiles.join(', '));
      if (meta.length) L.push(meta.join(' ｜ '));
      L.push('');
    }
  });
  if (project) {
    const title = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
    try {
      const engine = new BuildEngine(project, compiler, outputChannel);
      const data = engine.collectMakefileData(title);
      const dt = data.find((t) => t.targetTitle === title) ?? data[0];
      if (dt) {
        L.push(`## 展开预览（${project.title} / ${dt.targetTitle}）`);
        L.push('');
        L.push('```');
        for (const c of dt.compile) L.push(c.command);
        if (dt.link) L.push(dt.link.command);
        L.push('```');
        L.push('');
      }
    } catch (err) {
      L.push(`（展开预览失败: ${(err as Error).message}）`);
    }
  }
  const doc = await vscode.workspace.openTextDocument({ content: L.join('\n'), language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: false });
}

/** Makefile 导出（B4）：展开命令 → 可独立构建的 Makefile（保存对话框选路径） */
async function exportProjectMakefile(): Promise<void> {
  const project = requireProject();
  if (!project) return;
  const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
  const compiler = getCompiler(project.compilerId || vscode.workspace.getConfiguration('codeblocks').get<string>('compilerId', 'gcc'));
  if (!compiler) {
    vscode.window.showWarningMessage(`未找到编译器定义: ${project.compilerId}`);
    return;
  }
  let data: ReturnType<BuildEngine['collectMakefileData']>;
  try {
    data = new BuildEngine(project, compiler, outputChannel).collectMakefileData(targetTitle);
  } catch (err) {
    vscode.window.showErrorMessage(`Makefile 数据收集失败: ${(err as Error).message}`);
    return;
  }
  if (!data.length || data.every((t) => !t.compile.length && !t.link)) {
    vscode.window.showWarningMessage('没有可导出的编译/链接命令（检查目标类型/平台支持）');
    return;
  }
  const content = generateMakefile({
    projectTitle: project.title,
    projectFile: path.basename(project.filename),
    basePath: project.basePath,
    generatedAt: new Date().toISOString(),
    targets: data,
  });
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(project.basePath, 'Makefile.cb')),
    filters: { Makefile: ['cb', 'mk', 'makefile'], 'All files': ['*'] },
    title: '导出 Makefile',
  });
  if (!uri) return;
  try {
    fs.writeFileSync(uri.fsPath, content, 'utf-8');
  } catch (err) {
    vscode.window.showErrorMessage(`写入失败: ${(err as Error).message}`);
    return;
  }
  outputChannel.info(`[Code::Blocks] 已导出 Makefile: ${uri.fsPath}（${data.reduce((n, t) => n + t.compile.length, 0)} 条编译命令）`);
  const pick = await vscode.window.showInformationMessage(
    `已导出 Makefile：${uri.fsPath}`,
    '打开文件',
  );
  if (pick === '打开文件') {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

/** 工作区依赖编辑（C1）：勾选依赖工程（依赖先构建），写入 .workspace 的 <Depends>（含环路检测） */
async function editWorkspaceDependencies(): Promise<void> {
  const wsFile = openedWorkspaceFile;
  if (!wsFile || !fs.existsSync(wsFile)) {
    vscode.window.showWarningMessage('当前会话未打开 .workspace 工作区（依赖编辑需先打开 .workspace）');
    return;
  }
  const project = requireProject();
  if (!project) return;
  let ws: Workspace;
  try {
    ws = new WorkspaceParser().parse(wsFile);
  } catch (err) {
    vscode.window.showErrorMessage(`.workspace 解析失败: ${(err as Error).message}`);
    return;
  }
  const normAbs = (p: string): string => path.resolve(p).replace(/\\/g, '/').toLowerCase();
  const targetRel = ws.projectPaths.find((rel) => normAbs(path.join(ws.basePath, rel)) === normAbs(project.filename));
  if (!targetRel) {
    vscode.window.showWarningMessage(`工程「${project.title}」不在该 .workspace 中：${path.basename(wsFile)}`);
    return;
  }
  const currentDeps = new Set((ws.dependencies[targetRel] ?? []).map((d) => normAbs(path.join(ws.basePath, d))));
  const candidates = ws.projectPaths.filter((rel) => normAbs(path.join(ws.basePath, rel)) !== normAbs(project.filename));
  if (!candidates.length) {
    vscode.window.showInformationMessage('该 .workspace 中没有其它工程');
    return;
  }
  type DepItem = vscode.QuickPickItem & { rel: string; cycle: boolean };
  const items: DepItem[] = candidates.map((rel) => {
    const isCurrent = currentDeps.has(normAbs(path.join(ws.basePath, rel)));
    const cycle = !isCurrent && wouldCreateCycle(ws.dependencies, targetRel, rel);
    return {
      label: path.basename(path.dirname(rel)) || rel,
      description: `${rel}${cycle ? '  ⛔ 会形成循环依赖' : ''}`,
      picked: isCurrent,
      rel,
      cycle,
    };
  });
  const sel = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    placeHolder: `选择「${project.title}」依赖的工程（依赖先构建；已勾选 = 当前依赖）`,
  });
  if (!sel) return;
  const pickedCycle = sel.filter((s) => s.cycle);
  if (pickedCycle.length) {
    vscode.window.showWarningMessage(`已忽略会形成循环依赖的选择: ${pickedCycle.map((s) => s.rel).join(', ')}`);
  }
  const newDeps = sel.filter((s) => !s.cycle).map((s) => s.rel);
  const text = fs.readFileSync(wsFile, 'utf-8');
  const updated = setProjectDependencies(text, targetRel, newDeps);
  if (updated === null) {
    vscode.window.showErrorMessage(`未在 ${path.basename(wsFile)} 中找到工程节点: ${targetRel}`);
    return;
  }
  if (updated !== text) {
    try {
      fs.writeFileSync(wsFile, updated, 'utf-8');
    } catch (err) {
      vscode.window.showErrorMessage(`写入 .workspace 失败: ${(err as Error).message}`);
      return;
    }
    outputChannel.info(`[Code::Blocks] 已更新工作区依赖: ${targetRel} → [${newDeps.join(', ')}]`);
  }
  // 重新加载依赖映射（构建拓扑排序立即生效；不重开工程）
  try {
    const ws2 = new WorkspaceParser().parse(wsFile);
    const depsAbs: Record<string, string[]> = {};
    for (const [proj, deps] of Object.entries(ws2.dependencies)) {
      depsAbs[path.join(ws2.basePath, proj)] = deps.map((d) => path.join(ws2.basePath, d));
    }
    workspaceDeps = depsAbs;
  } catch { /* 非关键 */ }
  analysisTreeProvider?.refresh();
}

/** 工程导入（C5）：Dev-C++（.dev）/ VC6（.dsp）/ VS2010+（.vcxproj）→ 新建 .cbp 并可立即打开 */
async function importExternalProject(): Promise<void> {
  const sel = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { '工程文件': ['dev', 'dsp', 'vcxproj'], 'All files': ['*'] },
    title: '导入工程（Dev-C++ / VC6 / VS2010+）',
  });
  if (!sel?.length) return;
  const src = sel[0].fsPath;
  const ext = path.extname(src).toLowerCase();
  let text: string;
  try {
    text = decodeText(fs.readFileSync(src));
  } catch (err) {
    vscode.window.showErrorMessage(`读取失败: ${(err as Error).message}`);
    return;
  }
  const fallback = path.basename(src, path.extname(src));
  let imp;
  try {
    imp = ext === '.vcxproj'
      ? importVcxproj(text, fallback)
      : ext === '.dsp'
        ? importDspProject(text, fallback)
        : importDevProject(text, fallback);
  } catch (err) {
    vscode.window.showErrorMessage(`解析失败（${path.basename(src)}）: ${(err as Error).message}`);
    return;
  }
  const compilerId = vscode.workspace.getConfiguration('codeblocks').get<string>('compilerId', 'gcc');
  const { project, cbpPath, skipped } = buildProjectFromImport(src, imp, compilerId);
  if (fs.existsSync(cbpPath)) {
    vscode.window.showWarningMessage(`目标工程已存在，取消导入: ${cbpPath}`);
    return;
  }
  try {
    fs.writeFileSync(cbpPath, serializeProject(project), 'utf-8');
  } catch (err) {
    vscode.window.showErrorMessage(`写入 .cbp 失败: ${(err as Error).message}`);
    return;
  }
  outputChannel.info(`[Code::Blocks] 已导入工程 ${path.basename(src)} → ${cbpPath}（${project.files.length} 个文件${skipped.length ? `，跳过 ${skipped.length} 个工程外文件` : ''}）`);
  const detail = skipped.length ? `（跳过 ${skipped.length} 个工程目录外的文件）` : '';
  const pick = await vscode.window.showInformationMessage(
    `已导入 ${project.files.length} 个文件 → ${path.basename(cbpPath)}${detail}`,
    '打开工程',
  );
  if (pick === '打开工程') {
    await openProject(cbpPath);
  }
}

/** 打开 Code::Blocks default.conf —— 全局编译器设置/全局变量的手工编辑入口（评估结论 A：扩展只读取，不写回） */
async function openDefaultConf(): Promise<void> {
  const confPath = codeBlocksConfig?.location() ?? new CodeBlocksConfig().location();
  if (!confPath || !fs.existsSync(confPath)) {
    vscode.window.showWarningMessage(
      `未找到 Code::Blocks default.conf${confPath ? `：${confPath}` : '（已搜索 %APPDATA%/CodeBlocks 与 ~/.codeblocks）'}`,
    );
    return;
  }
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(confPath));
  await vscode.window.showTextDocument(doc, { preview: false });
  outputChannel.info(`[Code::Blocks] 已打开 default.conf: ${confPath}（保存后扩展读取立即生效；Code::Blocks 本体需重启）`);
}

/** 构建目标类型显示名 */
function targetTypeLabel(tt: TargetType): string {
  switch (tt) {
    case TargetType.Executable: return 'Executable';
    case TargetType.ConsoleOnly: return 'Console';
    case TargetType.StaticLib: return 'Static library';
    case TargetType.DynamicLib: return 'Dynamic library';
    case TargetType.CommandsOnly: return 'Commands only';
    case TargetType.Native: return 'Native';
    default: return 'Executable';
  }
}

/** 平台位掩码显示名（0x01 Mac / 0x02 Unix / 0x04 Windows / 0xff All；0 视为全部） */
function platformsLabelOf(platforms: number): string {
  if (!platforms || platforms === PLATFORM_ALL) return '全部';
  const parts: string[] = [];
  if (platforms & 0x04) parts.push('Windows');
  if (platforms & 0x02) parts.push('Unix');
  if (platforms & 0x01) parts.push('Mac');
  return parts.length ? parts.join(' / ') : '全部';
}

/** 在 .cbp 中定位属性对应的配置行（按候选文本顺序搜索首个匹配并高亮） */
async function locateInCbp(filename: string, candidates: string[]): Promise<void> {
  try {
    const doc = await vscode.workspace.openTextDocument(filename);
    const editor = await vscode.window.showTextDocument(doc, { preview: false });
    const text = doc.getText();
    for (const candidate of candidates) {
      if (!candidate) continue;
      const idx = text.indexOf(candidate);
      if (idx >= 0) {
        const start = doc.positionAt(idx);
        const end = doc.positionAt(idx + candidate.length);
        editor.selection = new vscode.Selection(start, end);
        editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenter);
        return;
      }
    }
    vscode.window.showInformationMessage('未在 .cbp 中找到对应配置行（已打开文件）');
  } catch { /* 打开失败忽略 */ }
}

/** 汇总工程分析数据（各工程 .cbp 重要属性；供 AnalysisTreeProvider 懒计算） */
function computeAnalysisData(): AnalysisData {
  const projects: AnalysisProjectInfo[] = [];
  try {
    for (const p of openProjects) {
      projects.push({
        filename: p.filename,
        title: p.title,
        dirName: path.basename(path.dirname(p.filename)),
        compilerId: p.compilerId,
        basePath: p.basePath,
        pchMode: p.pchMode,
        pchLabel: p.pchMode === 2 ? '生成 PCH' : p.pchMode === 1 ? '使用 PCH' : '关闭',
        objectNamingLabel: p.extendedObjNames ? '扩展名（如 .cpp.o）' : '默认',
        platformsLabel: platformsLabelOf(p.platforms),
        fileCount: p.files.length,
        compileCount: p.files.filter((f) => f.compile).length,
        linkCount: p.files.filter((f) => f.link).length,
        autoGeneratedCount: p.files.filter((f) => !!f.autoGeneratedBy).length,
        virtualFolderCount: p.virtualFolders.length,
        customCommandFileCount: p.files.filter((f) => Object.keys(f.customBuildCommands ?? {}).length > 0).length,
        virtualTargets: p.virtualTargets.map((v) => ({ title: v.title, targets: v.targets })),
        targets: p.buildTargets.map((t) => ({
          title: t.title,
          typeValue: t.targetType,
          typeLabel: targetTypeLabel(t.targetType),
          compilerId: t.compilerId,
          outputFilename: t.outputFilename,
          objectOutput: t.objectOutput,
          platformsLabel: platformsLabelOf(t.platforms),
          compilerOptionCount: t.compilerOptions.length,
          linkerOptionCount: t.linkerOptions.length,
          linkLibCount: t.linkLibs.length,
          includeDirCount: t.includeDirs.length,
          preBuildCount: t.commandsBeforeBuild.length,
          postBuildCount: t.commandsAfterBuild.length,
          externalDepsCount: t.externalDeps.length,
          sampleCompilerOption: t.compilerOptions[0],
          sampleLinkerOption: t.linkerOptions[0],
          sampleLinkLib: t.linkLibs[0],
          sampleIncludeDir: t.includeDirs[0],
          samplePreBuild: t.commandsBeforeBuild[0],
          sampleExternalDep: t.externalDeps[0],
        })),
        cmd: {
          preBuild: p.commandsBeforeBuild.length,
          postBuild: p.commandsAfterBuild.length,
          scriptCount: p.buildScripts.length,
          makefileCustom: p.makefileIsCustom,
          makefile: p.makefile,
          executionDir: p.executionDir,
        },
        dirs: { include: p.includeDirs, lib: p.libDirs, resource: p.resourceIncludeDirs },
        customVariables: Object.entries(p.customVariables ?? {}).map(([name, value]) => ({ name, value })),
        envVarCount: (p.envVars ?? []).length,
        notes: p.notes ?? '',
        sampleFileName: p.files[0]?.relativeFilename,
        sampleScript: p.buildScripts[0],
      });
    }
  } catch { /* 部分失败返回已收集数据 */ }
  return { generatedAt: Date.now(), projects, lastBuild: lastBuildMeta };
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
  // 记录最近构建摘要（供工程分析视图）
  lastBuildMeta = {
    ok: allOk,
    durationMs: Date.now() - buildStartMs,
    compiled: currentBuildProjects.reduce((n, p) => n + p.compiledCount, 0),
    skipped: currentBuildProjects.reduce((n, p) => n + p.skippedCount, 0),
    failed: currentBuildProjects.reduce((n, p) => n + p.failedCount, 0),
    errors: errorCount,
    warnings: warningCount,
  };
  analysisTreeProvider?.refresh();
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
  // 对齐 CB SaveBuildLog（compilergcc.cpp:3898/4051）：构建结束写 buildlog.html（失败不影响构建）
  try {
    const projDir = activeProject?.basePath ?? openProjects[0]?.basePath;
    if (projDir) {
      const esc = (s: unknown): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const rows: string[] = [];
      for (const p of currentBuildProjects) {
        rows.push(`<tr><th colspan="4" style="text-align:left">${esc(p.projectName)} — ${esc(p.targetName)}</th></tr>`);
        for (const d of p.diagnostics) {
          rows.push(`<tr class="${esc(d.severity)}"><td>${esc(d.severity)}</td><td>${esc(d.file ?? '')}</td><td>${d.line ?? ''}</td><td>${esc(d.message)}</td></tr>`);
        }
      }
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Build Log</title><style>table{border-collapse:collapse}td,th{border:1px solid #999;padding:2px 6px;font-family:monospace;font-size:12px}.error{color:#c00}.warning{color:#c60}</style></head><body><h2>Code::Blocks Build Log — ${esc(new Date().toLocaleString())}</h2><table>${rows.join('')}</table></body></html>`;
      fs.writeFileSync(path.join(projDir, 'buildlog.html'), html, 'utf-8');
    }
  } catch { /* 非致命：日志导出失败不影响构建 */ }
}

async function clean(): Promise<void> {
  const project = requireProject();
  if (!project) return;
  // 对齐 OnClean:3385-3397：清理前确认
  if (!(await confirmClean('清理目标/项目'))) return;
  // 对齐 DoBuild:2897：清理前须先停止调试会话
  if (!(await stopDebuggerIfRunning())) {
    return;
  }
  // 清理前自动保存
  await saveAllBeforeBuild();
  outputChannel.show(true);
  // 对齐 OnClean → Clean("") → GetTargetString：只清理选中目标（虚拟目标展开组）
  const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
  if (!targetTitle) {
    vscode.window.showWarningMessage('项目没有构建目标');
    return;
  }
  await cleanTargets(project, targetTitle);
  outputChannel.info('[Code::Blocks] 清理完成');
}

/** Clean 确认对话框 —— 对齐 OnClean/OnCleanAll 的 AnnoyingDialog */
async function confirmClean(scope: string): Promise<boolean> {
  const choice = await vscode.window.showWarningMessage(
    `${scope} 将删除所有相关对象文件，下次构建需要从头编译。\n是否继续清理？`,
    { modal: true },
    '清理',
  );
  return choice === '清理';
}

/** 清理选中目标（虚拟目标展开组逐个 cleanTarget）——对齐 ExpandTargets + bsTargetClean */
async function cleanTargets(project: Project, targetTitle: string): Promise<void> {
  const vt = project.virtualTargets.find((v) => v.title === targetTitle);
  const titles: string[] = vt ? vt.targets : [targetTitle];
  for (const title of titles) {
    const target = project.buildTargets.find((t) => t.title === title);
    if (!target) continue;
    // makefile 项目模式：Clean 走 make clean（对齐 UseMake → DoCleanWithMake:2530-2531）
    if (project.makefileIsCustom) {
      const cleanCmd = getMakeCommand(project, target, 'clean');
      if (cleanCmd) {
        await runMakeBuild(project, cleanCmd, title);
        continue;
      }
    }
    const compiler = getCompiler(target.compilerId || project.compilerId);
    new BuildEngine(project, compiler, outputChannel, (id) => resolveTargetCompiler(id)).cleanTarget(target);
  }
}

/** makefile 项目模式：解析 make 命令（对齐 GetMakeCommandFor:2178-2197：目标优先项目，$makefile/$make/$target 替换 + ReplaceMacros） */
function getMakeCommand(project: Project, target: BuildTarget | undefined, key: 'build' | 'compileFile' | 'clean' | 'distClean' | 'askRebuildNeeded' | 'silentBuild'): string | undefined {
  const raw = (target?.makeCommands?.[key] ?? '') || project.makeCommands[key];
  if (!raw) return undefined;
  const compiler = getCompiler(target?.compilerId || project.compilerId);
  const cmd = raw
    .replace(/\$makefile/g, project.makefile || 'Makefile')
    .replace(/\$make/g, compiler.programs.MAKE || 'make')
    .replace(/\$target/g, target?.title ?? '');
  const vars = { ...envVarMap(project.envVars, target?.envVars), ...cbBuiltinVars(project.basePath, target?.outputFilename ?? '', target?.title ?? '', target?.objectOutput ?? '', project.title, project.filename, compiler.masterPath) };
  return replaceCbMacros(cmd, { vars, customVars: project.customVariables ?? {}, basePath: project.basePath });
}

/** makefile 项目模式：执行 make 命令（工作目录 = GetExecutionDir 语义：execution_dir 或项目根；退出码按 statusSuccess 判定） */
async function runMakeBuild(project: Project, command: string, targetTitle: string): Promise<boolean> {
  const compiler = getCompiler(project.compilerId);
  outputChannel.show(true);
  outputChannel.info(`[Code::Blocks] Make: ${command}`);
  const cwd = project.executionDir ? path.resolve(project.basePath, project.executionDir) : project.basePath;
  const cancelSource = new BuildCancelSource();
  currentBuildCancel = cancelSource;
  buildInProgress = true;
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const proc = spawn(command, { cwd, shell: true, windowsHide: true });
      cancelSource.register(proc);
      const onData = (buf: Buffer): void => {
        for (const line of decodeText(buf).split(/\r?\n/)) {
          if (line.trim()) outputChannel.info(line);
        }
      };
      proc.stdout?.on('data', onData);
      proc.stderr?.on('data', onData);
      proc.on('error', (err) => {
        outputChannel.error(`[Code::Blocks] 无法执行: ${err.message}`);
        reject(err);
      });
      proc.on('close', (c) => {
        cancelSource.unregister(proc);
        resolve(c);
      });
    });
    const ok = code !== null && code >= 0 && code <= (compiler.switches.statusSuccess ?? 0);
    if (!ok) outputChannel.error(`[Code::Blocks] make 失败 (exit ${code})`);
    return ok;
  } catch {
    return false;
  } finally {
    buildInProgress = false;
    currentBuildCancel = undefined;
  }
}

/** Clean Workspace —— 对齐 OnCleanAll → CleanWorkspace：全部已打开工程各自的选中目标，依赖拓扑排序 */
async function cleanWorkspace(): Promise<void> {
  if (openProjects.length === 0) {
    vscode.window.showWarningMessage('请先打开一个 Code::Blocks 项目 (.cbp)');
    return;
  }
  if (!(await confirmClean('清理全部已打开工程'))) return;
  if (!(await stopDebuggerIfRunning())) {
    return;
  }
  await saveAllBeforeBuild();
  outputChannel.show(true);
  for (const project of topologicalBuildOrder(openProjects)) {
    if (!supportsCurrentPlatform(project.platforms)) {
      outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 不支持当前平台，跳过`);
      continue;
    }
    const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
    if (!targetTitle) {
      outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 没有构建目标，跳过`);
      continue;
    }
    await cleanTargets(project, targetTitle);
  }
  outputChannel.info('[Code::Blocks] 清理完成');
}

/**
 * Rebuild Workspace —— 对齐 OnRebuildAll → RebuildWorkspace（compilergcc.cpp:3009-3019）：
 * 确认对话框 → cbClearBackticksCache → clean 遍（DoWorkspaceBuild true,false）+ build 遍（DoWorkspaceBuild false,true,clearLog=false）。
 * rebuild_seperately 配置未移植：扩展固定走「先全清后全建」两遍式（= CB 默认 false 分支）。
 */
async function rebuildWorkspace(): Promise<void> {
  if (openProjects.length === 0) {
    vscode.window.showWarningMessage('请先打开一个 Code::Blocks 项目 (.cbp)');
    return;
  }
  if (buildInProgress) {
    vscode.window.showWarningMessage('已有构建正在进行，请等待完成或先停止');
    return;
  }
  const choice = await vscode.window.showWarningMessage(
    '重新构建全部已打开工程将删除所有对象文件并全量重新编译。\n确定继续？',
    { modal: true },
    '重新构建全部',
  );
  if (choice !== '重新构建全部') return;
  if (!(await stopDebuggerIfRunning())) return;
  await saveAllBeforeBuild();
  clearBackticksCache();
  outputChannel.clear();
  outputChannel.show(true);
  // rebuild_seperately（default.conf /compiler/rebuild_seperately，RebuildWorkspace:3012-3014）：
  // true → 单遍交错（DoWorkspaceBuild true,true，每工程 clean+build）；false → 两遍（默认分支）
  if (codeBlocksConfig?.rebuildSeperately() === true) {
    buildInProgress = true;
    try {
      for (const project of topologicalBuildOrder(openProjects)) {
        if (!supportsCurrentPlatform(project.platforms)) {
          outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 不支持当前平台，跳过`);
          continue;
        }
        const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
        if (!targetTitle) {
          outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 没有构建目标，跳过`);
          continue;
        }
        await cleanTargets(project, targetTitle);
        await buildOneProject(project, targetTitle, false);
      }
    } finally {
      buildInProgress = false;
    }
    return;
  }
  // clean 遍：对齐 DoWorkspaceBuild(target, true, false)——依赖拓扑顺序清理全部工程选中目标
  for (const project of topologicalBuildOrder(openProjects)) {
    if (!supportsCurrentPlatform(project.platforms)) {
      outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 不支持当前平台，跳过`);
      continue;
    }
    const targetTitle = getSelectedTarget(project) ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title;
    if (!targetTitle) {
      outputChannel.warn(`[Code::Blocks] 项目 "${project.title}" 没有构建目标，跳过`);
      continue;
    }
    await cleanTargets(project, targetTitle);
  }
  outputChannel.info('[Code::Blocks] 清理完成');
  // build 遍：对齐 DoWorkspaceBuild(target, false, true, false)——clearLog=false 保留 clean 遍日志
  await buildWorkspace(false, false);
}

/**
 * 运行工作目录 —— 对齐 CB Run() 的 m_CdRun = target->GetWorkingDir()（compilergcc.cpp:2020-2025 + compiletargetbase.cpp:190-201）：
 * working_dir 非空 → 环境变量展开（CB ReplaceEnvVars）→ 相对路径按项目根解析；
 * 为空且目标类型为控制台/可执行/动态库 → 输出文件所在目录；其余目标类型 → 项目根。
 */
function runWorkingDir(project: Project, target: BuildTarget, vars: Record<string, string>): string {
  const tt = target.targetType;
  if (tt !== TargetType.ConsoleOnly && tt !== TargetType.Executable && tt !== TargetType.DynamicLib) {
    return project.basePath;
  }
  const wd = (target.workingDir ?? '').trim();
  if (wd) {
    const envExp = wd.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (_m, n: string) => process.env[n] ?? '');
    return path.resolve(project.basePath, envExp);
  }
  // 默认：输出文件所在目录（GetOutputFilename → wxFileName::GetPath）
  const expOut = replaceCbMacros(target.outputFilename, {
    vars,
    customVars: project.customVariables ?? {},
  }).replace(/\\/g, '/');
  const idx = expOut.lastIndexOf('/');
  if (idx < 0) return project.basePath;
  return path.resolve(project.basePath, expOut.slice(0, idx));
}

/**
 * 无项目单文件编译 —— 对齐 CB CompileFileWithoutProject（compilergcc.cpp:3174-3191：默认编译器 + 控制台模板 + 编译后询问运行），
 * 改用 VS Code 任务系统执行（ShellExecution + $gcc 问题匹配器，集成终端展示）。
 */
async function compileFileWithoutProject(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('没有打开的文件');
    return;
  }
  const filePath = editor.document.uri.fsPath;
  const ext = path.extname(filePath).toLowerCase();
  if (!['.c', '.cpp', '.cc', '.cxx'].includes(ext)) {
    vscode.window.showWarningMessage('仅支持编译 C/C++ 源文件（.c/.cpp/.cc/.cxx）');
    return;
  }
  // 对齐 CB：切换默认编译器（SwitchCompiler(GetDefaultCompilerID)）
  const compiler = getCompiler(vscode.workspace.getConfiguration('codeblocks').get<string>('compilerId', 'gcc'));
  const prog = ext === '.c' ? compiler.programs.C : compiler.programs.CPP;
  if (!prog) {
    vscode.window.showErrorMessage('默认编译器不可用，请先探测/配置编译器');
    return;
  }
  await saveAllBeforeBuild();
  const fileDir = path.dirname(filePath);
  const base = path.basename(filePath, ext);
  const outName = process.platform === 'win32' ? `${base}.exe` : base;
  const cc = compiler.masterPath ? path.join(compiler.masterPath, 'bin', prog) : prog;
  const cmd = `"${cc}" -g -Wall "${filePath}" -o "${path.join(fileDir, outName)}"`;
  const exec = new vscode.ShellExecution(cmd, { cwd: fileDir });
  const task = new vscode.Task(
    { type: 'shell' },
    vscode.TaskScope.Workspace,
    'Compile File (Without Project)',
    'codeblocks',
    exec,
    ['$gcc'],
  );
  task.group = vscode.TaskGroup.Build;
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true, panel: vscode.TaskPanelKind.Shared };
  // 编译成功后询问运行（对齐 CB GetCompileSingleFileCommand 流程）
  const onEnd = vscode.tasks.onDidEndTaskProcess((e) => {
    if (e.execution.task !== task) return;
    onEnd.dispose();
    if (e.exitCode === 0) {
      vscode.window.showInformationMessage('编译成功，是否运行生成的可执行文件？', '运行').then((pick) => {
        if (pick === '运行') {
          const t = vscode.window.createTerminal({ name: 'Run (no project)', cwd: fileDir });
          t.show();
          t.sendText(`"${path.join(fileDir, outName)}"`);
        }
      });
    }
  });
  await vscode.tasks.executeTask(task);
}

async function run(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  // 运行前自动保存
  await saveAllBeforeBuild();

  // 对齐 CB OnRun：默认活动目标（m_LastTargetName），仅无选中目标时弹选择器
  const selectedTitle = getSelectedTarget(project)
    ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title
    ?? await selectTarget();
  const target = project.buildTargets.find((t) => t.title === selectedTitle);
  if (!target) return;

  // 执行参数宏展开（对齐 GetExecutionParameters → GetFullCompilerVarsSet 全集：$(TARGET_OUTPUT_FILE) 等）
  const vars = { ...envVarMap(project.envVars, target.envVars), ...cbBuiltinVars(project.basePath, target.outputFilename, target.title, target.objectOutput, project.title, project.filename, getCompiler(target.compilerId)?.masterPath ?? '') };
  const args = target.executionParameters ? expandMacros(target.executionParameters, vars) : '';
  // 环境变量（项目级 + 目标级 <Environment><Variable name value>）
  const env: Record<string, string> = {};
  for (const ev of [...project.envVars, ...target.envVars]) env[ev.name] = ev.value;

  // 库/CommandsOnly 目标：宿主程序运行（对齐 compilergcc.cpp:2091-2126）
  const tt = target.targetType;
  if (tt === TargetType.DynamicLib || tt === TargetType.StaticLib || tt === TargetType.CommandsOnly) {
    const host = target.hostApplication
      ? replaceCbMacros(target.hostApplication, { vars, customVars: project.customVariables ?? {} })
      : '';
    if (!host) {
      vscode.window.showErrorMessage('You must select a host application to "run" a library...');
      return;
    }
    const terminalLib = vscode.window.createTerminal({
      name: `Run: ${target.title}`,
      cwd: runWorkingDir(project, target, vars),
      env: Object.keys(env).length ? { ...(process.env as Record<string, string>), ...env } : undefined,
    });
    terminalLib.show();
    terminalLib.sendText(`"${host}" ${args}`.trim());
    return;
  }

  const expandedOut = replaceCbMacros(target.outputFilename, { vars, customVars: project.customVariables ?? {}, basePath: project.basePath });
  const exePath = resolveExecutablePath(project.basePath, expandedOut, process.platform, isExecutableTargetType(target.targetType));
  if (!fs.existsSync(exePath)) {
    vscode.window.showErrorMessage(`可执行文件不存在，请先构建（${path.relative(project.basePath, exePath)}）`);
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: `Run: ${target.title}`,
    cwd: runWorkingDir(project, target, vars),
    env: Object.keys(env).length ? { ...(process.env as Record<string, string>), ...env } : undefined,
  });
  terminal.show();
  terminal.sendText(`"${exePath}" ${args}`.trim());
}

async function debug(): Promise<void> {
  const project = requireProject();
  if (!project) return;

  // 调试前自动保存
  await saveAllBeforeBuild();

  // 对齐 CB：默认活动目标，仅无选中目标时弹选择器
  const selectedTitle = getSelectedTarget(project)
    ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms))?.title
    ?? await selectTarget();
  const target = project.buildTargets.find((t) => t.title === selectedTitle);
  if (!target) return;

  // 执行参数与环境变量（对齐 GetExecutionParameters + <Environment>）
  const vars = { ...envVarMap(project.envVars, target.envVars), ...cbBuiltinVars(project.basePath, target.outputFilename, target.title, target.objectOutput, project.title, project.filename, getCompiler(target.compilerId)?.masterPath ?? '') };

  // 调试目标：库/CommandsOnly 走宿主程序（对齐 run()/CB compilergcc.cpp:2091-2126），其余走可执行输出
  let program = '';
  const tt = target.targetType;
  if (tt === TargetType.DynamicLib || tt === TargetType.StaticLib || tt === TargetType.CommandsOnly) {
    const host = target.hostApplication
      ? replaceCbMacros(target.hostApplication, { vars, customVars: project.customVariables ?? {} })
      : '';
    if (!host) {
      vscode.window.showErrorMessage('You must select a host application to "run" a library...');
      return;
    }
    if (!fs.existsSync(host)) {
      vscode.window.showErrorMessage(`宿主程序不存在，请先构建（${host}）`);
      return;
    }
    program = host;
  } else {
    // 输出文件名宏展开 + 真实可执行路径（Windows 无扩展名输出 → 链接器追加 .exe，需回退）
    const expandedOut = replaceCbMacros(target.outputFilename, { vars, customVars: project.customVariables ?? {}, basePath: project.basePath });
    const exePath = resolveExecutablePath(project.basePath, expandedOut, process.platform, isExecutableTargetType(target.targetType));
    if (!fs.existsSync(exePath)) {
      vscode.window.showErrorMessage(`可执行文件不存在，请先构建（${path.relative(project.basePath, exePath)}）`);
      return;
    }
    program = exePath;
  }

  // 定位 GDB（codeblocks.debug.gdbPath → masterPath/bin → PATH，第五十轮 D9）
  const gdb = await locateGdb();
  if (!gdb.path) {
    vscode.window.showErrorMessage(`未找到 GDB 调试器（已尝试：${summarizeTried(gdb.tried)}）。可在设置 codeblocks.debug.gdbPath 指定完整路径`);
    return;
  }
  const argsStr = target.executionParameters ? expandMacros(target.executionParameters, vars) : '';
  const env: Record<string, string> = {};
  for (const ev of [...project.envVars, ...target.envVars]) env[ev.name] = ev.value;

  // R3/R4：工程调试器扩展配置（源目录 search_path + 远程目标 remote_debugging）
  const searchDirs = debugSearchDirs(project, vars);
  const dc = parseProjectDebuggerConfig(project.extensions);
  const mergedRemote = mergeRemoteOptions(
    dc.remote.find((r) => !r.target),
    dc.remote.find((r) => r.target === target.title),
  );
  const remoteDebugging = mergedRemote ? expandRemoteOptions(mergedRemote, vars, project) : undefined;

  const started = await vscode.debug.startDebugging(undefined, {
    type: 'codeblocks',
    name: `Debug: ${target.title}`,
    request: 'launch',
    program,
    cwd: runWorkingDir(project, target, vars),
    gdbPath: gdb.path,
    args: splitCommandLine(argsStr),
    environment: env,
    searchDirs,
    remoteDebugging,
  });

  if (!started) {
    vscode.window.showErrorMessage('调试启动失败');
  }
}

/** 简单命令行分词（引号感知），供 DAP launch args 使用 */
function splitCommandLine(s: string): string[] {
  if (!s.trim()) return [];
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/**
 * R3：调试器源搜索目录（对齐 debuggergdb ParseSearchDirs + AddSourceDir）：
 * 工程根 + 公共顶层目录 + `<Extensions><debugger><search_path>`（支持 $(VAR) 宏）；
 * 设置 codeblocks.debug.addOtherProjectDirs 开启时追加其它已打开工程的目录（对齐 add_other_search_dirs，默认关）。
 */
function debugSearchDirs(project: Project, vars: Record<string, string>): string[] {
  let addOthers = false;
  try {
    addOthers = vscode.workspace.getConfiguration('codeblocks').get<boolean>('debug.addOtherProjectDirs', false) === true;
  } catch { addOthers = false; }
  const dc = parseProjectDebuggerConfig(project.extensions);
  const out: string[] = [];
  const add = (p: string): void => {
    const t = String(p ?? '').trim();
    if (t && !out.includes(t)) out.push(t);
  };
  add(project.basePath);
  if (project.commonTopLevelPath && project.commonTopLevelPath !== project.basePath) add(project.commonTopLevelPath);
  for (const p of dc.searchPaths) {
    add(p.includes('$') ? replaceCbMacros(p, { vars, customVars: project.customVariables ?? {}, basePath: project.basePath }) : p);
  }
  if (addOthers) {
    for (const op of openProjects) {
      if (op.filename === project.filename) continue;
      add(op.basePath);
      if (op.commonTopLevelPath && op.commonTopLevelPath !== op.basePath) add(op.commonTopLevelPath);
    }
  }
  return out;
}

/** R4：远程调试命令的宏展开（对齐 CB Prepare 中对每条命令 ReplaceMacros） */
function expandRemoteOptions(
  rd: RemoteDebuggingOptions,
  vars: Record<string, string>,
  project: Project,
): RemoteDebuggingOptions {
  const expand = (s: string): string =>
    s ? replaceCbMacros(s, { vars, customVars: project.customVariables ?? {}, basePath: project.basePath }) : s;
  return {
    ...rd,
    additionalCmds: expand(rd.additionalCmds),
    additionalCmdsBefore: expand(rd.additionalCmdsBefore),
    additionalShellCmdsAfter: expand(rd.additionalShellCmdsAfter),
    additionalShellCmdsBefore: expand(rd.additionalShellCmdsBefore),
  };
}

/**
 * 定位 GDB 可执行文件（第五十轮 D9）：
 * 优先级 codeblocks.debug.gdbPath → masterPath/bin → PATH；返回尝试过的路径便于错误提示。
 */
async function locateGdb(): Promise<{ path?: string; tried: string[] }> {
  const cfg = vscode.workspace.getConfiguration('codeblocks');
  const tried: string[] = [];
  const found = resolveGdbPath({
    settingPath: cfg.get<string>('debug.gdbPath', ''),
    masterPath: cfg.get<string>('masterPath', ''),
    pathEnv: process.env.PATH ?? '',
    platform: process.platform,
    exists: (p) => { tried.push(p); return fs.existsSync(p); },
  });
  return { path: found, tried };
}

/** 错误提示用：截断尝试路径列表 */
function summarizeTried(tried: string[]): string {
  const head = tried.slice(0, 5).join('、');
  return tried.length > 5 ? `${head} 等 ${tried.length} 处` : head;
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
