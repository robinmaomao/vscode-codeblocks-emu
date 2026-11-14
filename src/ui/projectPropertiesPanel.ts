/**
 * 工程属性编辑面板 —— 对应 Code::Blocks ProjectOptionsDlg
 *
 * 两个标签页：
 *  - 构建目标：添加/复制/删除/重命名目标，编辑标题、类型、输出文件、
 *    对象输出目录、编译器 ID（对应「Build targets」页）。
 *  - 文件：编辑每个文件的编译变量、编译/链接开关、自定义构建命令，
 *    以及文件归属哪些构建目标（对应 ProjectFileOptionsDlg / 文件列表）。
 * 保存时通过回调交由 extension.ts 序列化写回 .cbp 并刷新项目树。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Project, BuildTarget, OptionsRelationType, MakeCommandsMap } from '../model/types';
import { parseProjectDebuggerConfig, defaultRemoteOptions } from '../model/projectDebuggerExtensions';
import { parseProjectCodeCompletionSearchPaths } from '../model/projectCodeCompletionExtensions';
import { validateSquirrelSyntax } from '../tools/squirrelValidator';
import { cbBuiltinVars, envVarMap, replaceCbMacros } from '../compiler/cbMacros';
import { applyFlagAction, buildCompilerCatalog, writeLanguageFlags } from '../compiler/compilerFlagSettings';
import { BuildOptionsData, BuildOptionsScopeData, buildOptionsCss, buildOptionsMarkup, buildOptionsScript } from './buildOptionsView';
import * as i18n from '../i18n';

/** 面板标题（`工程属性: <工程名>`） */
function projectPropertiesTitle(name: string): string {
  return i18n.t('Project Properties: {0}', name);
}

/** 校验一个构建脚本（存在性 + Squirrel 语法；不执行） */
function validateProjectScript(
  project: Project,
  scope: string,
  file: string,
): { scope: string; file: string; ok: boolean; line: number; column: number; message: string } {
  if (!file) return { scope, file, ok: false, line: 0, column: 0, message: i18n.t('Empty script path') };
  const target = project.buildTargets.find((t) => t.title === scope);
  let expanded = file;
  try {
    const vars = {
      ...envVarMap(project.envVars, target?.envVars),
      ...cbBuiltinVars(
        project.basePath,
        target?.outputFilename ?? '',
        target?.title ?? '',
        target?.objectOutput ?? '',
        project.title,
        project.filename,
      ),
    };
    expanded = replaceCbMacros(file, { vars, customVars: project.customVariables, basePath: project.basePath });
  } catch {
    // 宏展开失败时回退原始路径（后续存在性检查会给出明确错误）
  }
  const abs = path.isAbsolute(expanded) ? expanded : path.join(project.basePath, expanded);
  if (!fs.existsSync(abs)) return { scope, file, ok: false, line: 0, column: 0, message: i18n.t('File not found: {0}', abs) };
  let text: string;
  try {
    text = fs.readFileSync(abs, 'utf-8');
  } catch (err) {
    return { scope, file, ok: false, line: 0, column: 0, message: (err as Error).message };
  }
  const err = validateSquirrelSyntax(text);
  return err
    ? { scope, file, ok: false, line: err.line, column: err.column, message: err.message }
    : { scope, file, ok: true, line: 0, column: 0, message: '' };
}

/** WebView 前后端交换的目标编辑数据 */
export interface TargetEditData {
  /** 原始标题（识别目标的 key，重命名时保持不变；新目标为空字符串） */
  originalTitle: string;
  title: string;
  targetType: number;
  outputFilename: string;
  objectOutput: string;
  compilerId: string;
  /** 执行参数（<Option parameters>，Run/Debug 用；对齐 Code::Blocks Set programs' arguments） */
  executionParameters: string;
  /** 外部依赖（<Option external_deps>，每行一个；比输出文件新时强制重链接） */
  externalDeps: string[];
  /** 附加输出（<Option additional_output>，每行一个；外部依赖比它新时强制重链接） */
  additionalOutput: string[];
  /**
   * 目标环境变量（<Environment><Variable name value>，R1）——
   * 参与构建/运行宏 $(NAME)（目标覆盖项目），Run/Debug 时注入进程环境（对齐 CB Build options → Custom variables）
   */
  envVars: CustomVariableEditData[];
  /** R6：运行工作目录（<Option working_dir>，空 = 输出目录；Run/Debug 用） */
  workingDir: string;
  /** R6：deps 输出目录（<Option deps_output>，默认 .deps） */
  depsOutput: string;
  /** R6：目标平台位掩码（<Option platforms>，0xff = 全部） */
  platforms: number;
  /** R6：宿主程序（<Option host_application>，库/CommandsOnly 目标 Run 用） */
  hostApplication: string;
  /** R6：宿主程序在终端运行（<Option run_host_application_in_terminal>，默认 true） */
  runHostApplicationInTerminal: boolean;
  /** R6：使用 console runner / 结束暂停（<Option use_console_runner>，默认 true） */
  useConsoleRunner: boolean;
  /** R6：动态库 import 库文件名（<Option output imp_lib>，空 = 按策略推导） */
  impLib: string;
  /** R6：def 文件名（<Option output def_file>，空 = 按策略推导） */
  defFile: string;
  /** R6：静态/动态库生成 DEF（<Option createDefFile>） */
  createDefFile: boolean;
  /** R6：动态库生成 import 静态库（<Option createStaticLib>） */
  createStaticLib: boolean;
  /** R6：库名自动前缀（<Option output prefix_auto>，默认 true） */
  prefixAuto: boolean;
  /** R6：库扩展名自动（<Option output extension_auto>，默认 true） */
  extensionAuto: boolean;
  /** 链接器可执行选择（<LinkerExe value>，AutoDetect 不写） */
  linkerExecutable: number;
  /** 目标级 Make 命令（<MakeCommands>，仅自定义 Makefile 时生效） */
  makeCommands: MakeCommandsMap;
}

/** WebView 前后端交换的文件编辑数据 */
export interface FileEditData {
  /** 文件相对项目根的 Unix 路径（识别 key） */
  relativeFilename: string;
  /** 编译变量：'' = 自动(CPP)，或 CC / WINDRES */
  compilerVar: string;
  /** 是否参与编译 */
  compile: boolean;
  /** 是否参与链接 */
  link: boolean;
  /** 归属的目标标题列表（编辑后的标题） */
  buildTargets: string[];
  /** 自定义构建命令（空 = 无），对应项目默认编译器 */
  buildCommand: string;
  /** 编译权重（0-100，默认 50） */
  weight: number;
  /** 虚拟文件夹归属（空 = 根） */
  virtualFolder: string;
}

/** 编译/链接选项（作用域：项目级 + 各目标，目标项按 targets 数组顺序对齐） */
export interface RelationEditData {
  compiler: number; // ortCompilerOptions
  linker: number;   // ortLinkerOptions
  include: number;  // ortIncludeDirs
  lib: number;      // ortLibDirs
  res: number;      // ortResDirs
}

export interface BuildOptionsEditData {
  project: { compilerOptions: string[]; linkerOptions: string[]; linkLibs: string[]; resourceCompilerOptions: string[] };
  targets: { compilerOptions: string[]; linkerOptions: string[]; linkLibs: string[]; resourceCompilerOptions: string[]; relations: RelationEditData }[];
}

/** 搜索目录（作用域：项目级 + 各目标，目标项按 targets 数组顺序对齐） */
export interface SearchDirsEditData {
  project: { includeDirs: string[]; libDirs: string[]; resourceDirs: string[] };
  targets: { includeDirs: string[]; libDirs: string[]; resourceDirs: string[] }[];
}

/** 项目自定义变量（<Extensions><codeblocks_project_custom_variables>；构建宏 $(name)） */
export interface CustomVariableEditData {
  name: string;
  value: string;
}

/** 项目设置（标题 / 默认编译器 / 虚拟文件夹 / 自定义变量 / 环境变量） */
export interface ProjectSettingsEditData {
  title: string;
  compilerId: string;
  virtualFolders: string[];
  customVariables: CustomVariableEditData[];
  /** 项目环境变量（<Build><Environment><Variable>，R1；构建/运行宏 $(NAME) + Run/Debug 进程环境） */
  envVars: CustomVariableEditData[];
  /** R7：工程平台位掩码（<Option platforms>，0xff = 全部） */
  platforms: number;
  /** R7：PCH 模式（<Option pch_mode>：0=源目录 1=对象目录 2=源文件，默认 1） */
  pchMode: number;
  /** R7：扩展对象命名（<Option extended_obj_names>：foo.c → foo.c.o） */
  extendedObjNames: boolean;
  /** R7：自定义 Makefile（<Option makefile_is_custom>） */
  makefileIsCustom: boolean;
  /** R7：Makefile 文件名（<Option makefile>，默认 Makefile） */
  makefile: string;
  /** R7：makefile 模式执行目录（<Option execution_dir>，空 = 项目根） */
  executionDir: string;
  /** 外部修改检测（<Option check_files>，默认 true） */
  checkForExternallyModifiedFiles: boolean;
  /** C/C++ parser 额外搜索目录（Extensions/code_completion/search_path） */
  codeCompletionSearchPaths: string[];
  /** 项目级 Make 命令（<MakeCommands>） */
  makeCommands: MakeCommandsMap;
}

/** 构建脚本 + pre/post build 命令（作用域：项目级 + 各目标，目标项按 targets 数组顺序对齐） */
export interface ScriptItemEditData {
  /** 构建脚本（<Script file>） */
  scripts: string[];
  /** 构建前命令（<ExtraCommands><Add before>） */
  before: string[];
  /** 构建后命令（<ExtraCommands><Add after>） */
  after: string[];
  /** 无构建命令时也执行 post-build（<ExtraCommands><Mode after="always">，R7；对齐 CB Pre/post 页选项） */
  always: boolean;
}

export interface BuildScriptsEditData {
  project: ScriptItemEditData;
  targets: ScriptItemEditData[];
}

/** 项目备注 */
export interface NotesEditData {
  notes: string;
  showNotesOnLoad: boolean;
}

/** 虚拟目标（如 All = Debug + Release） */
export interface VirtualTargetEditData {
  /** 原别名（识别 key，重命名保持不变；新项为空字符串） */
  originalAlias: string;
  alias: string;
  /** 包含的物理目标标题（编辑后的标题） */
  targets: string[];
}

/** 远程调试配置（R4；字段对齐 remotedebugging.h / debuggergdb.cpp SetRemoteDebuggingMap） */
export interface RemoteDebuggingEditData {
  /** 目标标题；'' = 项目级默认（XML target 缺省） */
  target: string;
  /** 0=TCP 1=UDP 2=Serial */
  connType: number;
  serialPort: string;
  serialBaud: string;
  ip: string;
  ipPort: string;
  additionalCmds: string;
  additionalCmdsBefore: string;
  additionalShellCmdsAfter: string;
  additionalShellCmdsBefore: string;
  skipLDpath: boolean;
  extendedRemote: boolean;
}

/** 工程调试器配置（R3/R4：search_path + remote_debugging） */
export interface DebuggerSettingsEditData {
  /** 额外源搜索目录（<debugger><search_path add>） */
  searchPaths: string[];
  /** 远程调试条目（含项目级默认 target=''） */
  remote: RemoteDebuggingEditData[];
}

/** 目标类型下拉项（每次渲染取当前语言，勿在模块级固化） */
function targetTypeNames(): Record<number, string> {
  return {
    0: i18n.t('Executable'),
    1: i18n.t('Console application'),
    2: i18n.t('Static library'),
    3: i18n.t('Dynamic library'),
    4: i18n.t('Commands only'),
    5: i18n.t('Native'),
  };
}

/** 内联 SVG 图标（16x16，跟随 currentColor，兼容深/浅色主题） */
const ICONS = {
  target: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 1.5h4.5L12 5v9.5H4z" stroke="currentColor"/><path d="M8.5 1.5V5H12" stroke="currentColor"/></svg>',
  options: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5h12M2 11.5h12M5 2v5M11 9v5" stroke="currentColor" stroke-width="1.2"/></svg>',
  dirs: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 3.5h4l2 2h7v7.5h-13z" stroke="currentColor"/></svg>',
  settings: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="2" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" stroke="currentColor" stroke-width="1.2"/></svg>',
  moveUp: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v9M4 7.5 8 3.5l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  moveDown: '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 12.5v-9M4 8.5l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** Build options 覆盖层所需的编译器目录（由宿主提供） */
export interface BuildOptionsRuntime {
  compilers: Array<{ id: string; name: string }>;
  compilerCatalogs: Record<
    string,
    Array<{ name: string; option: string; additionalLibs?: string; category: string; custom?: boolean; modified?: boolean; baseOption?: string }>
  >;
  compilerBaseCatalogs?: BuildOptionsRuntime['compilerCatalogs'];
  compilerFlags?: Record<string, { cOnly: string[]; cppOnly: string[] }>;
  /** 扩展设置中的默认编译器（工程未声明 compiler 时的回退） */
  defaultCompilerId?: string;
  /** 工程编译器是否支持 PCH（CB rbPCHStrategy->Enable(hasPCH)） */
  supportsPch?: boolean;
  defineSwitch: string;
}

export class ProjectPropertiesPanel {
  private static current: ProjectPropertiesPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    private project: Project,
    private extensionUri: vscode.Uri,
    private onSave: (
      targets: TargetEditData[],
      files: FileEditData[],
      options: BuildOptionsEditData,
      searchDirs: SearchDirsEditData,
      projectSettings: ProjectSettingsEditData,
      buildScripts: BuildScriptsEditData,
      notes: NotesEditData,
      virtualTargets: VirtualTargetEditData[],
      debuggerSettings: DebuggerSettingsEditData,
    ) => Promise<void>,
    /** 打开时直达的 tab（默认 settings；如 'notes'） */
    private initialTab: string | undefined = undefined,
    /** 打开时在「文件」模态中定位高亮的文件（relativeFilename；M3：文件节点 Properties… 直达） */
    private focusFile: string | undefined = undefined,
    /** Build options 覆盖层所需的编译器目录 */
    private buildOptionsRuntime: BuildOptionsRuntime | undefined = undefined,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'codeblocks.projectProperties',
      projectPropertiesTitle(project.title),
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage(this.onMessage, this, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static show(
    project: Project,
    extensionUri: vscode.Uri,
    onSave: (
      targets: TargetEditData[],
      files: FileEditData[],
      options: BuildOptionsEditData,
      searchDirs: SearchDirsEditData,
      projectSettings: ProjectSettingsEditData,
      buildScripts: BuildScriptsEditData,
      notes: NotesEditData,
      virtualTargets: VirtualTargetEditData[],
      debuggerSettings: DebuggerSettingsEditData,
    ) => Promise<void>,
    initialTab?: string,
    focusFile?: string,
    buildOptionsRuntime?: BuildOptionsRuntime,
  ): void {
    ProjectPropertiesPanel.current?.dispose();
    ProjectPropertiesPanel.current = new ProjectPropertiesPanel(project, extensionUri, onSave, initialTab, focusFile, buildOptionsRuntime);
  }

  /** 界面语言切换后刷新已打开面板的标题（正文与标签在下次打开时按新语言渲染，避免丢弃未保存编辑） */
  public static refreshTitleIfOpen(): void {
    const p = ProjectPropertiesPanel.current;
    if (p) p.panel.title = projectPropertiesTitle(p.project.title);
  }

  /**
   * 工程从磁盘重新加载时关闭面板：面板持有的是旧模型，保存会覆盖刚重载的外部改动。
   * （对齐 Code::Blocks ReloadProject 关闭工程后重建的行为）
   */
  public static closeFor(project: Project): void {
    const p = ProjectPropertiesPanel.current;
    if (p && path.resolve(p.project.filename).toLowerCase() === path.resolve(project.filename).toLowerCase()) p.dispose();
  }

  private buildHtml(): string {
    const targets: TargetEditData[] = this.project.buildTargets.map((t) => ({
      originalTitle: t.title,
      title: t.title,
      targetType: t.targetType,
      outputFilename: t.outputFilename,
      objectOutput: t.objectOutput,
      compilerId: t.compilerId,
      executionParameters: t.executionParameters ?? '',
      externalDeps: [...t.externalDeps],
      additionalOutput: [...t.additionalOutput],
      envVars: t.envVars.map((v) => ({ name: v.name, value: v.value })),
      workingDir: t.workingDir ?? '',
      depsOutput: t.depsOutput ?? '',
      platforms: t.platforms,
      hostApplication: t.hostApplication ?? '',
      runHostApplicationInTerminal: t.runHostApplicationInTerminal !== false,
      useConsoleRunner: t.useConsoleRunner !== false,
      impLib: t.impLib ?? '',
      defFile: t.defFile ?? '',
      createDefFile: t.createDefFile === true,
      createStaticLib: t.createStaticLib === true,
      prefixAuto: t.prefixAuto !== false,
      extensionAuto: t.extensionAuto !== false,
      linkerExecutable: t.linkerExecutable ?? 0,
      makeCommands: { ...(t.makeCommands ?? {}) },
    }));

    const cmp = this.project.compilerId;
    const files: FileEditData[] = this.project.files.map((f) => ({
      relativeFilename: f.relativeFilename,
      compilerVar: f.compilerVar === 'CPP' ? '' : f.compilerVar,
      compile: f.compile !== false,
      link: f.link !== false,
      buildTargets: [...f.buildTargets],
      buildCommand: (f.customBuildCommands[cmp]?.command ?? '').replace(/\r?\n/g, '\\n'),
      weight: f.weight,
      virtualFolder: f.virtualFolder,
    }));

    const projectOpts = {
      compilerOptions: [...this.project.compilerOptions],
      linkerOptions: [...this.project.linkerOptions],
      linkLibs: [...this.project.linkLibs],
      resourceCompilerOptions: [...this.project.resourceCompilerOptions],
    };
    const targetOpts = this.project.buildTargets.map((t) => ({
      compilerOptions: [...t.compilerOptions],
      linkerOptions: [...t.linkerOptions],
      linkLibs: [...t.linkLibs],
      resourceCompilerOptions: [...t.resourceCompilerOptions],
      relations: {
        compiler: t.optionRelations[OptionsRelationType.CompilerOptions],
        linker: t.optionRelations[OptionsRelationType.LinkerOptions],
        include: t.optionRelations[OptionsRelationType.IncludeDirs],
        lib: t.optionRelations[OptionsRelationType.LibDirs],
        res: t.optionRelations[OptionsRelationType.ResDirs],
      },
    }));

    const projectDirs = {
      includeDirs: [...this.project.includeDirs],
      libDirs: [...this.project.libDirs],
      resourceDirs: [...this.project.resourceIncludeDirs],
    };
    const targetDirs = this.project.buildTargets.map((t) => ({
      includeDirs: [...t.includeDirs],
      libDirs: [...t.libDirs],
      resourceDirs: [...t.resourceIncludeDirs],
    }));

    const projectSettings = {
      title: this.project.title,
      compilerId: this.project.compilerId,
      virtualFolders: [...this.project.virtualFolders],
      customVariables: Object.entries(this.project.customVariables ?? {}).map(([name, value]) => ({ name, value })),
      envVars: this.project.envVars.map((v) => ({ name: v.name, value: v.value })),
      platforms: this.project.platforms,
      pchMode: this.project.pchMode,
      extendedObjNames: this.project.extendedObjNames === true,
      makefileIsCustom: this.project.makefileIsCustom === true,
      makefile: this.project.makefile ?? '',
      executionDir: this.project.executionDir ?? '',
      checkForExternallyModifiedFiles: this.project.checkForExternallyModifiedFiles !== false,
      codeCompletionSearchPaths: parseProjectCodeCompletionSearchPaths(this.project.extensions),
      makeCommands: { ...(this.project.makeCommands ?? {}) },
    };

    const projectScripts = {
      scripts: [...this.project.buildScripts],
      before: [...this.project.commandsBeforeBuild],
      after: [...this.project.commandsAfterBuild],
      always: this.project.alwaysRunPostBuildSteps === true,
    };
    const targetScripts = this.project.buildTargets.map((t) => ({
      scripts: [...t.buildScripts],
      before: [...t.commandsBeforeBuild],
      after: [...t.commandsAfterBuild],
      always: t.alwaysRunPostBuildSteps === true,
    }));
    const notes = {
      notes: this.project.notes,
      showNotesOnLoad: this.project.showNotesOnLoad,
    };

    const virtualTargets: VirtualTargetEditData[] = this.project.virtualTargets.map((vt) => ({
      originalAlias: vt.title,
      alias: vt.title,
      targets: [...vt.targets],
    }));

    // R3/R4：调试器配置（search_path + 每目标 remote_debugging；未配置目标回退项目级默认）
    const dc = parseProjectDebuggerConfig(this.project.extensions);
    const debuggerData = {
      searchPaths: [...dc.searchPaths],
      remote: [
        { ...(dc.remote.find((r) => !r.target) ?? defaultRemoteOptions('')) },
        ...this.project.buildTargets.map((t) => ({
          ...(dc.remote.find((r) => r.target === t.title) ?? defaultRemoteOptions(t.title)),
        })),
      ],
    };

    const typeOptions = Object.entries(targetTypeNames())
      .map(([v, name]) => `<option value="${v}">${this.escapeHtml(name)}</option>`)
      .join('');
    // 初始 tab（供脚本注入；JSON.stringify 保证引号安全）
    const initialTabJs = JSON.stringify(this.initialTab ?? 'settings');
    // M3：初始定位文件（文件 tab 高亮行；null = 不定位）
    const focusFileJs = JSON.stringify(this.focusFile ?? null);

    const boRuntime = this.buildOptionsRuntime ?? {
      compilers: [{ id: cmp, name: cmp }],
      compilerCatalogs: {},
      defineSwitch: '-D',
    };
    const boProjectScope: BuildOptionsScopeData = {
      title: this.project.title,
      compilerId: this.project.compilerId,
      compilerOptions: [...this.project.compilerOptions],
      resourceCompilerOptions: [...this.project.resourceCompilerOptions],
      linkerOptions: [...this.project.linkerOptions],
      linkLibs: [...this.project.linkLibs],
      linkerExecutable: 0,
      relations: { compiler: 3, linker: 3, include: 3, lib: 3, res: 3 },
      includeDirs: [...this.project.includeDirs],
      libDirs: [...this.project.libDirs],
      resourceDirs: [...this.project.resourceIncludeDirs],
      commandsBefore: [...this.project.commandsBeforeBuild],
      commandsAfter: [...this.project.commandsAfterBuild],
      alwaysPost: this.project.alwaysRunPostBuildSteps === true,
      envVars: this.project.envVars.map((v) => ({ name: v.name, value: v.value })),
      makeCommands: { ...(this.project.makeCommands ?? {}) },
    };
    const boTargetScopes: BuildOptionsScopeData[] = this.project.buildTargets.map((t) => ({
      title: t.title,
      targetType: t.targetType,
      compilerId: t.compilerId,
      compilerOptions: [...t.compilerOptions],
      resourceCompilerOptions: [...t.resourceCompilerOptions],
      linkerOptions: [...t.linkerOptions],
      linkLibs: [...t.linkLibs],
      linkerExecutable: t.linkerExecutable ?? 0,
      relations: {
        compiler: t.optionRelations[OptionsRelationType.CompilerOptions],
        linker: t.optionRelations[OptionsRelationType.LinkerOptions],
        include: t.optionRelations[OptionsRelationType.IncludeDirs],
        lib: t.optionRelations[OptionsRelationType.LibDirs],
        res: t.optionRelations[OptionsRelationType.ResDirs],
      },
      includeDirs: [...t.includeDirs],
      libDirs: [...t.libDirs],
      resourceDirs: [...t.resourceIncludeDirs],
      commandsBefore: [...t.commandsBeforeBuild],
      commandsAfter: [...t.commandsAfterBuild],
      alwaysPost: t.alwaysRunPostBuildSteps === true,
      envVars: t.envVars.map((v) => ({ name: v.name, value: v.value })),
      makeCommands: { ...(t.makeCommands ?? {}) },
      depsOutput: t.depsOutput ?? '',
      externalDeps: [...(t.externalDeps ?? [])],
      additionalOutput: [...(t.additionalOutput ?? [])],
      hostApplication: t.hostApplication ?? '',
      runHostApplicationInTerminal: t.runHostApplicationInTerminal !== false,
    }));
    const initialBoData: BuildOptionsData = {
      projectTitle: this.project.title,
      makefileIsCustom: this.project.makefileIsCustom === true,
      defineSwitch: boRuntime.defineSwitch,
      project: boProjectScope,
      targets: boTargetScopes,
      compilers: boRuntime.compilers,
      compilerCatalogs: boRuntime.compilerCatalogs,
      customVariables: Object.entries(this.project.customVariables ?? {}).map(([name, value]) => ({ name, value })),
    };

    const data = JSON.stringify({
      title: this.project.title,
      compilerId: cmp,
      filename: this.project.filename,
      basePath: this.project.basePath,
      targets,
      files,
      projectOpts,
      targetOpts,
      projectDirs,
      targetDirs,
      projectSettings,
      projectScripts,
      targetScripts,
      notes,
      virtualTargets,
      debugger: debuggerData,
      boRuntime: this.buildOptionsRuntime ?? {
        compilers: [{ id: cmp, name: cmp }],
        compilerCatalogs: {},
        defineSwitch: '-D',
      },
      icons: ICONS,
    }).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="${i18n.htmlLang()}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    :root {
      --cb-border: var(--vscode-widget-border, rgba(128,128,128,.35));
      --cb-radius: 6px;
      --cb-control-radius: 3px;
      --cb-surface: var(--vscode-editorWidget-background, var(--vscode-editor-background));
      --cb-surface-muted: var(--vscode-sideBar-background, rgba(128,128,128,.06));
      --cb-gap: 14px;
      /* CB 标签列：随面板宽度按比例（960px 下约 212px），并限制在合理区间 */
      --cb-label-w: clamp(150px, 22%, 280px);
      /* Build targets 页标签列略窄（CB 约 110px / 960） */
      --cb-label-w-targets: clamp(120px, 18%, 200px);
    }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      display: flex; flex-direction: column; overflow: hidden;
    }
    /* 顶栏：保存操作 + 目标快速切换 */
    .toolbar {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      min-height: 40px; padding: 5px 12px; flex-shrink: 0;
      border-bottom: 1px solid var(--cb-border);
      background: var(--vscode-sideBarSectionHeader-background, var(--cb-surface));
    }
    button {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border: 1px solid transparent;
      padding: 5px 10px; border-radius: var(--cb-control-radius); cursor: pointer;
      font-family: var(--vscode-font-family); font-size: 12px; line-height: 16px;
      white-space: nowrap;
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground); }
    button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
    button:disabled { opacity: .5; cursor: default; }
    button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.danger { background: transparent; color: var(--vscode-errorForeground, #f48771); }
    button.danger:hover { background: rgba(244,135,113,.12); }
    button.icon { min-width: 28px; padding: 4px 7px; }
    #status {
      margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 12px;
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* 项目标题栏：单行路径，避免长路径换行挤压内容 */
    .project-header {
      padding: 6px 12px 4px; flex-shrink: 0;
      border-bottom: 1px solid var(--cb-border);
      background: var(--vscode-sideBarSectionHeader-background, var(--cb-surface));
    }
    .project-title { font-size: 13px; font-weight: 600; line-height: 18px; }
    .project-subtitle {
      font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 1px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* 主体：顶部页签 + 内容区（对齐 CB ProjectOptionsDlg；页签复用 build options 的 .bo-tabs/.bo-tab） */
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
    /* 内容区 */
    .content { flex: 1; overflow-y: auto; min-width: 0; }
    .tab-pane { width: 100%; padding: 8px 12px 12px; box-sizing: border-box; }
    .layout { display: grid; grid-template-columns: minmax(200px, 260px) minmax(0, 1fr); gap: 10px; align-items: start; }
    .targets-layout { display: grid; grid-template-columns: minmax(230px, 280px) minmax(0, 1fr); gap: 10px; align-items: stretch; }
    .targets-column { display: flex; flex-direction: column; gap: 10px; min-width: 0; }
    .targets-main { min-width: 0; }
    /* 卡片 */
    .card { border: 1px solid var(--cb-border); border-radius: var(--cb-radius); background: var(--cb-surface); overflow: hidden; min-width: 0; }
    .card-header {
      display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 7px 12px;
      border-bottom: 1px solid var(--cb-border);
      background: var(--vscode-sideBarSectionHeader-background, transparent);
      font-size: 12px; font-weight: 600;
    }
    .card-body { padding: 12px; }
    .card-body > :last-child { margin-bottom: 0; }
    .form > .card { margin-bottom: 14px; }
    .form > .card:last-child { margin-bottom: 0; }
    .card-footer { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 12px; border-top: 1px solid var(--cb-border); background: var(--vscode-sideBarSectionHeader-background, transparent); }
    .card-footer .spacer { flex: 1; }
    .card-title { font-weight: 600; }
    .card-subtitle { color: var(--vscode-descriptionForeground); font-size: 11px; font-weight: 400; margin-left: auto; }
    /* 列表 */
    .list {
      border: 1px solid var(--cb-border); border-radius: var(--cb-control-radius);
      max-height: 240px; min-height: 76px; overflow-y: auto;
      background: var(--vscode-input-background, transparent);
    }
    #list { max-height: 220px; }
    #tflist { max-height: 260px; }
    #reorder-list, #vtlist, #flist { max-height: 240px; }
    .list .item { display: flex; align-items: center; gap: 7px; min-height: 28px; padding: 2px 8px; cursor: pointer; line-height: 20px; user-select: none; border-left: 2px solid transparent; }
    .list .item:hover { background: var(--vscode-list-hoverBackground); }
    .list .item.selected { background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground)); border-left-color: var(--vscode-focusBorder); }
    .list .empty { padding: 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
    .item-icon { display: inline-flex; width: 16px; height: 16px; flex: none; opacity: .9; }
    .item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .list-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
    .list-actions .spacer { flex: 1; }
    .list-actions button { padding: 4px 8px; }
    .list-toolbar { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
    .list-toolbar .hint { margin: 0; }
    .list-toolbar .spacer { flex: 1; }
    /* 表单字段与网格 */
    .form label { display: block; margin-bottom: 12px; }
    .form label:last-child { margin-bottom: 0; }
    .form .field-name { display: block; margin-bottom: 5px; font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
    .hint { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; margin-top: 5px; }
    .form-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px 14px; align-items: start; }
    .form-grid > .span-2 { grid-column: 1 / -1; }
    .form-grid > label { margin-bottom: 0; }
    .form-grid > .hint { margin-top: 0; }
    .form-section { margin-bottom: 16px; }
    .form-section:last-child { margin-bottom: 0; }
    .card-body details.fg { border: none; border-radius: 0; background: transparent; margin: 0; }
    .card-body details.fg summary { padding: 7px 0; background: transparent; }
    .card-body details.fg > *:not(summary) { margin-left: 0; margin-right: 0; }
    /* 输入控件 */
    input, select, textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--cb-border));
      border-radius: var(--cb-control-radius); padding: 5px 7px;
      font-family: var(--vscode-font-family); font-size: 12px; line-height: 18px;
      box-sizing: border-box; width: 100%;
    }
    select {
      background: var(--vscode-dropdown-background, var(--vscode-input-background));
      color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
      border-color: var(--vscode-dropdown-border, var(--vscode-input-border, var(--cb-border)));
    }
    input:focus, select:focus, textarea:focus {
      outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
      border-color: var(--vscode-focusBorder);
    }
    textarea { min-height: 64px; resize: vertical; font-family: var(--vscode-editor-font-family); line-height: 1.45; }
    input[type="checkbox"] { width: 16px; height: 16px; flex: none; accent-color: var(--vscode-checkbox-background, var(--vscode-focusBorder)); }
    input[readonly] { color: var(--vscode-descriptionForeground); }
    /* 文件归属复选框组 + 行内开关 */
    .checks { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 2px; }
    .checks label.check { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 0; }
    .inline-field { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .form-grid .inline-field { margin-bottom: 0; }
    .inline-field .field-name { display: inline; margin-bottom: 0; }
    .form label.check { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .form .checks label.check { margin-bottom: 0; }
    .form label.check .field-name { display: inline; margin-bottom: 0; }
    /* 折叠分组：保持 CB 的“高级”区域 */
    details.fg { border: 1px solid var(--cb-border); border-radius: var(--cb-radius); padding: 0; margin-bottom: 12px; background: var(--cb-surface); overflow: hidden; }
    details.fg summary { cursor: pointer; font-weight: 600; font-size: 12px; padding: 9px 12px; color: var(--vscode-foreground); background: var(--vscode-sideBarSectionHeader-background, transparent); }
    details.fg > *:not(summary) { margin-left: 12px; margin-right: 12px; }
    details.fg > *:last-child { margin-bottom: 12px; }
    .group-title { font-weight: 600; font-size: 12px; margin: 2px 0 7px; }
    .target-files { margin-top: 10px; }
    /* 页内模态 */
    .modal { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.52); backdrop-filter: blur(2px); }
    .modal-box { width: min(860px, 100%); max-height: min(88vh, 760px); overflow: auto; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border: 1px solid var(--cb-border); border-radius: var(--cb-radius); box-shadow: 0 18px 48px rgba(0,0,0,.5); }
    .modal-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-bottom: 1px solid var(--cb-border); background: var(--vscode-sideBarSectionHeader-background, transparent); position: sticky; top: 0; z-index: 1; }
    .modal-title { font-weight: 600; font-size: 13px; margin: 0; }
    .modal-body { padding: 14px 16px; }
    .modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 16px; border-top: 1px solid var(--cb-border); background: var(--vscode-sideBarSectionHeader-background, transparent); position: sticky; bottom: 0; }
    .modal .layout { grid-template-columns: minmax(200px, 260px) minmax(0, 1fr); }
    .modal .form { min-width: 0; }
    .modal .form-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .modal .list { max-height: 280px; }
    #modal-platform .modal-box { width: min(420px, 100%); }
    #modal-reorder .modal-box { width: min(560px, 100%); }
    #modal-external .modal-box { width: min(720px, 100%); }
    ${buildOptionsCss()}
    /* ===== Code::Blocks 版式覆盖（属性面板专用；沿用 .bo-root 基底） ===== */
    .cb-props { background: var(--vscode-editor-background); }
    .cb-props .project-header { padding: 10px 14px 8px; }
    /* target: 下拉左对齐并加长（CB 顶部 target 选择器） */
    .cb-props .target-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
    .cb-props .target-row label { font-size: 12px; color: var(--vscode-foreground); white-space: nowrap; }
    .cb-props .target-row select { height: 24px; min-width: 220px; max-width: 420px; }
    /* 静态框：CB wxStaticBox（标题压在边框上，无底色） */
    .cb-props .card { position: relative; margin-top: 12px; border: 1px solid var(--bo-border); border-radius: 0; background: transparent; overflow: visible; }
    .cb-props .card-header { position: absolute; top: -7px; left: 8px; display: inline-flex; align-items: center; gap: 6px; min-height: 0; padding: 0 4px; border: none; background: var(--vscode-editor-background); font-size: 12px; font-weight: 400; }
    .cb-props .card-body { padding: 12px 8px 8px; }
    .cb-props .card-footer { justify-content: flex-end; background: transparent; border-top: 1px solid var(--bo-border); }
    .cb-props .targets-layout { grid-template-columns: clamp(220px, 26%, 300px) minmax(0, 1fr); }
    .cb-props .targets-layout > .card { display: flex; flex-direction: column; min-height: 0; }
    .cb-props .targets-layout > .card > .card-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .cb-props .targets-layout > .card .list-with-stack { flex: 1; min-height: 0; }
    .cb-props .targets-layout .list-with-stack .list { max-height: none; flex: 1; min-height: 120px; }
    .cb-props .targets-column > .card { margin-top: 0; }
    /* 文件静态框：列表弹性填充，底部工具栏始终可见（CB 的 Build target files 静态框） */
    .cb-props .targets-column > .card:last-child { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .cb-props .targets-column > .card:last-child > .card-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
    .cb-props #tflist { flex: 1 1 auto; min-height: 100px; max-height: 120px; }
    /* 表单行：CB 的「标签固定列 + 控件」，vgap/hgap = 4；标签列宽度按面板比例（CB ~22%） */
    .cb-props .form-grid { display: flex; flex-direction: column; gap: 4px; align-items: stretch; --cb-form-label-w: var(--cb-label-w); }
    .cb-props #form .form-grid { --cb-form-label-w: var(--cb-label-w-targets); }
    .cb-props .form-grid > label { display: grid; grid-template-columns: var(--cb-form-label-w) minmax(0, 1fr); gap: 0 4px; align-items: center; margin: 0; }
    .cb-props .form-grid > label > .field-name { grid-column: 1; grid-row: 1; margin: 0; font-weight: 400; font-size: 12px; line-height: 18px; }
    .cb-props .form-grid > label > .hint { grid-column: 2; }
    .cb-props .form-grid > label > .inline-field { min-width: 0; display: flex; gap: 4px; align-items: center; }
    .cb-props .form-grid > .checks { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding-left: calc(var(--cb-form-label-w) + 4px); }
    .cb-props .form-grid > label.check { display: flex; align-items: center; gap: 6px; padding-left: calc(var(--cb-form-label-w) + 4px); }
    .cb-props .form-grid > label.check > span { min-width: 0; }
    .cb-props .form-grid > .row { display: grid; grid-template-columns: var(--cb-form-label-w) minmax(0, 1fr); gap: 0 4px; align-items: start; }
    .cb-props .form-grid > .row > .field-name { grid-column: 1; margin: 0; font-weight: 400; font-size: 12px; line-height: 18px; padding-top: 3px; }
    .cb-props .sub-block { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; }
    .cb-props .sub-block > .check { display: flex; align-items: center; gap: 6px; }
    .cb-props .sub-row { display: flex; align-items: center; gap: 4px; width: 100%; }
    .cb-props .sub-row > .field-name { font-weight: 400; font-size: 12px; white-space: nowrap; }
    .cb-props .sub-row > input { flex: 1; min-width: 0; }
    .cb-props .static-value { font-size: 12px; line-height: 24px; color: var(--vscode-foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cb-props .settings-actions { display: flex; justify-content: flex-end; gap: 6px; margin-top: 10px; }
    .cb-props .cb-gap8 { height: 8px; }
    .cb-props .form-grid > .hint { padding-left: calc(var(--cb-form-label-w) + 4px); }
    .cb-props .checks label.check { display: inline-flex; align-items: center; gap: 6px; margin: 0; }
    /* CB 的红色说明文字：位置/换行按 CB，颜色用主题错误色保证可读 */
    .cb-props .hint { font-size: 11px; line-height: 1.35; }
    .cb-props .hint.red { color: var(--vscode-errorForeground, #f48771); max-width: 68%; }
    /* 度量：CB 24px 控件；按钮皮肤来自 .bo-root/.bo-actions/.bo-move-buttons，不在此覆盖 */
    .cb-props input:not([type="checkbox"]):not([type="radio"]),
    .cb-props select { height: 24px; font-size: 12px; padding: 2px 6px; box-sizing: border-box; }
    .cb-props textarea { font-size: 12px; line-height: 1.4; }
    .cb-props input[type="checkbox"], .cb-props input[type="radio"] { width: 14px; height: 14px; flex: none; accent-color: var(--vscode-checkbox-background, var(--vscode-focusBorder)); }
    /* CB 的灰色态：禁用控件保留文本，仅降低对比度 */
    .cb-props input:disabled, .cb-props select:disabled, .cb-props textarea:disabled { opacity: .65; }
    .cb-props button:disabled { opacity: .5; cursor: default; pointer-events: none; }
    .cb-props label:has(input:disabled) > .field-name { opacity: .65; }
    .cb-props label.check:has(input:disabled) { opacity: .65; }
    .cb-props .row:has(input:disabled) > .field-name { opacity: .65; }
    .cb-props .cb-browse { width: 24px; height: 24px; flex: none; padding: 0; line-height: 1; }
    /* 按钮皮肤对齐 build options：次级背景 + 描边；default/add 用 focus 描边 */
    .cb-props button { border-color: var(--vscode-button-border, var(--bo-border)); }
    .cb-props button.default, .cb-props button[data-act="add"] { border-color: var(--vscode-focusBorder); }
    .cb-props button.danger { border-color: transparent; }
    .cb-props button.primary { border-color: transparent; }
    /* 页脚：与 build options 相同结构，仅收窄高度贴近 CB 按钮条 */
    .bo-root.cb-props > .bo-footer { min-height: 40px; padding: 0 12px; }
    .bo-root.cb-props > .bo-footer .bo-toolbar { gap: 6px; }
    /* 列表高度（外观复用 .bo-list / 旧 .list） */
    .cb-props .list { max-height: 220px; min-height: 76px; }
    .cb-props .list-with-stack { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 6px; align-items: stretch; }
    .cb-props .list-with-stack .list { max-height: 320px; }
    .cb-props .list-with-stack #list { max-height: 320px; }
    .cb-props .btn-stack { display: flex; flex-direction: column; gap: 4px; flex: none; }
    .cb-props .btn-stack button { width: 100%; text-align: center; }
    .cb-props .btn-column { display: flex; flex-direction: column; gap: 4px; min-width: 112px; }
    .cb-props .btn-column > button { width: 100%; }
    .cb-props .btn-spacer { flex: 1; min-height: 10px; }
    .cb-props .bo-actions .spacer { flex: 1; }
    .cb-props .bo-actions button svg { width: 14px; height: 14px; }
    /* 脚本页：CB 1:2 分栏（左概览树 / 右已附加脚本） */
    .cb-props .scripts-layout { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(0, 2fr); gap: 10px; align-items: stretch; }
    .cb-props .scripts-layout .list { max-height: none; min-height: 240px; }
    .cb-props .scripts-column { display: flex; flex-direction: column; min-width: 0; }
    .cb-props .scripts-column > .list { flex: 1; }
    .cb-props .list-with-spin { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 6px; align-items: stretch; flex: 1; min-height: 240px; }
    .cb-props .list-with-spin > .list { min-height: 240px; }
    .cb-props .field-label { font-size: 12px; line-height: 18px; margin: 0 0 4px; }
    /* Debugger：CB wxNotebook 页签 + 内容区（平铺页签，激活页与内容区连成一体） */
    .cb-props .dbg-tabs { display: flex; align-items: flex-end; gap: 0; margin: 0; padding: 0; border-bottom: 1px solid var(--bo-border); }
    .cb-props .dbg-tab { background: transparent; border: 1px solid transparent; border-bottom: none; border-radius: 0; padding: 4px 10px; font-size: 12px; line-height: 18px; color: var(--vscode-descriptionForeground); cursor: pointer; }
    .cb-props .dbg-tab:hover { color: var(--vscode-foreground); }
    .cb-props .dbg-tab.active { background: var(--vscode-editor-background); border-color: var(--bo-border); color: var(--vscode-foreground); margin-bottom: -1px; padding-bottom: 5px; }
    .cb-props .dbg-page { border: 1px solid var(--bo-border); border-top: none; padding: 10px 12px; }
    /* Debugger 远程连接：CB 两列字段（Serial+Baud / IP+Port），标签 90px */
    .cb-props .dbg-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 4px 12px; align-items: start; }
    .cb-props .dbg-grid > .span-2 { grid-column: 1 / -1; }
    .cb-props .dbg-grid > label { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 0 4px; align-items: center; margin: 0; }
    .cb-props .dbg-grid > label.short { grid-template-columns: 90px max-content; }
    .cb-props .dbg-grid > label.short > input { width: 120px; }
    .cb-props .dbg-grid > label > .field-name { margin: 0; font-weight: 400; font-size: 12px; line-height: 18px; white-space: nowrap; }
    .cb-props .dbg-grid > label > input, .cb-props .dbg-grid > label > select { min-width: 0; }
    .cb-props .dbg-grid > label.check { display: flex; align-items: center; gap: 6px; grid-template-columns: none; margin-top: 10px; }
    .cb-props .dbg-scope-grid { display: grid; grid-template-columns: clamp(110px, 14%, 150px) minmax(0, 1fr); gap: 10px; align-items: start; }
    .cb-props .plain-actions { display: flex; justify-content: center; gap: 6px; margin-top: 6px; }
    /* C/C++ parser options：Add/Edit/Remove 左对齐（CB 按钮紧跟列表左侧） */
    .cb-props .plain-actions.left { justify-content: flex-start; }
    .cb-props .tree-item { display: flex; align-items: center; gap: 6px; min-height: 24px; padding: 2px 8px; cursor: pointer; user-select: none; }
    .cb-props .tree-item:hover { background: var(--vscode-list-hoverBackground); }
    .cb-props .tree-item.selected { background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground)); }
    .cb-props .tree-item.child { padding-left: 24px; }
    /* 撑满型页签（备注 / 解析器 / 脚本） */
    .cb-props .fill-pane { display: flex; flex-direction: column; min-height: calc(100vh - 160px); }
    .cb-props .fill-pane .fill-control { flex: 1; min-height: 160px; }
    .cb-props .centered-actions { justify-content: center; }
    /* 单选组（CB wxRadioBox） */
    .cb-props .radio-box { border: 1px solid var(--bo-border); border-radius: 0; margin: 0; padding: 2px 10px 8px; width: max-content; min-width: 300px; max-width: 100%; box-sizing: border-box; }
    .cb-props .radio-box > legend { padding: 0 4px; font-size: 12px; }
    .cb-props .radio-group { display: flex; flex-direction: column; gap: 4px; }
    .cb-props .radio-group label.check { display: flex; align-items: center; gap: 6px; }
    /* 页内模态：容器改用 build options 的 .bo-modal 结构，这里只收窄对话框宽度 */
    #modal-platform .bo-modal-box { width: min(420px, 100%); }
    #modal-reorder .bo-modal-box { width: min(560px, 100%); }
    #modal-external .bo-modal-box { width: min(720px, 100%); }
    #modal-vtargets .bo-modal-box, #modal-files .bo-modal-box { width: min(860px, 100%); }

    @media (max-width: 760px) {
      .targets-layout, .layout { grid-template-columns: minmax(0, 1fr); }
      .form-grid { grid-template-columns: minmax(0, 1fr); }
      .form-grid > .span-2 { grid-column: auto; }
      .tab-pane { padding: 8px; }
      .project-subtitle { display: none; }
      .bo-modal .layout, .bo-modal .form-grid { grid-template-columns: minmax(0, 1fr); }
      .bo-modal { padding: 12px; }
      /* .cb-props 覆盖层选择器优先级更高，窄屏折叠必须在此重复声明 */
      .cb-props .targets-layout, .cb-props .layout, .cb-props .scripts-layout { grid-template-columns: minmax(0, 1fr); }
      .cb-props .form-grid > label, .cb-props .form-grid > .row, .cb-props .modal .form-grid > label { grid-template-columns: minmax(0, 1fr); }
      .cb-props .form-grid > label > .field-name,
      .cb-props .form-grid > .row > .field-name,
      .cb-props .form-grid > label > .inline-field,
      .cb-props .form-grid > label > .hint { grid-column: 1 / -1; grid-row: auto; }
      .cb-props .form-grid > .checks, .cb-props .form-grid > label.check, .cb-props .form-grid > .hint { padding-left: 0; }
      .cb-props .target-row select { width: 100%; min-width: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; }
    }
  </style>
</head>
<body>
<div class="bo-root cb-props">
  <div class="project-header">
    <div class="project-title">${this.escapeHtml(this.project.title)}</div>
    <div class="project-subtitle">${this.escapeHtml(this.project.filename)}</div>
    <div class="target-row">
      <label for="targetSwitch">${i18n.t('Target:')}</label>
      <select id="targetSwitch" title="${i18n.t('Quick switch to this target')}"></select>
    </div>
  </div>
  <div class="main">
    <nav class="bo-tabs">
      <button class="bo-tab active" data-tab="settings" id="tabbtn-settings">${i18n.t('Project settings')}</button>
      <button class="bo-tab" data-tab="targets" id="tabbtn-targets">${i18n.t('Build targets')}</button>
      <button class="bo-tab" data-tab="scripts" id="tabbtn-scripts">${i18n.t('Build scripts')}</button>
      <button class="bo-tab" data-tab="notes" id="tabbtn-notes">${i18n.t('Notes')}</button>
      <button class="bo-tab" data-tab="parser" id="tabbtn-parser">${i18n.t('C/C++ parser options')}</button>
      <button class="bo-tab" data-tab="debugger" id="tabbtn-debugger">${i18n.t('Debugger')}</button>
    </nav>
    <div class="content">
      <div id="tab-settings" class="tab-pane">
        <div class="form" id="sform"></div>
      </div>
      <div id="tab-targets" class="tab-pane" style="display:none">
        <div class="targets-layout">
          <section class="card">
            <div class="card-header"><span class="card-title">${i18n.t('Build targets')}</span></div>
            <div class="card-body">
              <div class="list-with-stack">
                <div class="list" id="list"></div>
                <div class="btn-column">
                  <div class="btn-stack">
                    <button id="add" data-act="add" title="${i18n.tr('添加目标')}">${i18n.tr('添加')}</button>
                    <button id="renameTarget" title="${i18n.tr('重命名选中目标')}">${i18n.tr('重命名')}</button>
                    <button id="copy" title="${i18n.tr('复制选中目标')}">${i18n.tr('复制')}</button>
                    <button id="remove" class="danger" title="${i18n.tr('删除选中目标')}">${i18n.tr('删除')}</button>
                  </div>
                  <div class="bo-move-buttons">
                    <button id="up" title="${i18n.tr('上移选中目标')}" aria-label="${i18n.tr('上移选中目标')}">${ICONS.moveUp}</button>
                    <button id="down" title="${i18n.tr('下移选中目标')}" aria-label="${i18n.tr('下移选中目标')}">${ICONS.moveDown}</button>
                  </div>
                  <div class="btn-spacer"></div>
                  <div class="btn-stack">
                    <button id="virtualTargets" title="${i18n.tr('虚拟目标…')}">${i18n.tr('虚拟目标…')}</button>
                    <button id="externalDeps" title="${i18n.tr('外部依赖与附加输出…')}">${i18n.tr('依赖…')}</button>
                    <button id="reorderTargets" title="${i18n.tr('重排目标顺序…')}">${i18n.tr('重排…')}</button>
                    <button id="targetBuildOptions" title="${i18n.tr('目标构建选项…')}">${i18n.tr('构建选项…')}</button>
                  </div>
                  <div class="btn-spacer"></div>
                  <button id="exportTarget" title="${i18n.tr('把选中目标导出为独立工程（对齐 CB Create project from target）')}">${i18n.tr('从目标创建工程…')}</button>
                </div>
              </div>
            </div>
          </section>
          <div class="targets-column">
            <section class="card targets-main">
              <div class="card-header">${i18n.t('Selected build target options')}</div>
              <div class="card-body"><div class="form" id="form"></div></div>
            </section>
            <section class="card">
              <div class="card-header">
                <span class="card-title">${i18n.t('Build target files:')}</span>
              </div>
              <div class="card-body">
                <div class="list" id="tflist"></div>
                <div class="bo-actions">
                  <button id="toggleChecks">${i18n.tr('切换勾选')}</button>
                  <button id="allOn">${i18n.tr('全部选中')}</button>
                  <button id="allOff">${i18n.tr('全部取消')}</button>
                  <span class="spacer"></span>
                  <button id="fileProps">${i18n.tr('选中文件属性')}</button>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
      <div id="tab-scripts" class="tab-pane" style="display:none">
        <div class="form" id="scrform"></div>
      </div>
      <div id="tab-notes" class="tab-pane" style="display:none">
        <div class="form" id="ntform"></div>
      </div>
      <div id="tab-parser" class="tab-pane" style="display:none">
        <div class="form" id="pform"></div>
      </div>
      <div id="tab-debugger" class="tab-pane" style="display:none">
        <div class="form" id="dbgform"></div>
      </div>
    </div>
  </div>
  <div class="bo-footer">
    <span class="bo-toolbar">
      <button id="save" class="default">${i18n.t('Save')}</button>
      <button id="saveClose">${i18n.t('Save and Close')}</button>
      <button id="restore">${i18n.t('Restore settings')}</button>
    </span>
    <span class="bo-status" id="status"></span>
  </div>

  <!-- 虚拟目标（CB: Virtual targets...） -->
  <div class="bo-modal" id="modal-vtargets" style="display:none">
    <div class="bo-modal-box">
      <div class="bo-modal-title"><span>${i18n.t('Virtual targets')}</span><button class="bo-modal-x" data-close-modal="modal-vtargets" aria-label="${i18n.t('Close')}">×</button></div>
      <div class="bo-modal-body">
        <div class="layout">
          <div>
            <div class="list" id="vtlist" style="min-height:200px"></div>
            <div class="bo-actions">
              <button id="vt-add" data-act="add">${i18n.tr('添加')}</button>
              <button id="vt-remove" class="danger">${i18n.tr('删除')}</button>
            </div>
          </div>
          <div class="form" id="vtform"></div>
        </div>
      </div>
      <div class="bo-modal-actions"><button id="vt-close" class="default">${i18n.t('Close')}</button></div>
    </div>
  </div>

  <!-- 文件属性（CB: Selected file properties） -->
  <div class="bo-modal" id="modal-files" style="display:none">
    <div class="bo-modal-box">
      <div class="bo-modal-title"><span>${i18n.t('File properties')}</span><button class="bo-modal-x" data-close-modal="modal-files" aria-label="${i18n.t('Close')}">×</button></div>
      <div class="bo-modal-body">
        <div class="layout">
          <div><div class="list" id="flist" style="min-height:200px"></div></div>
          <div class="form" id="fform"></div>
        </div>
      </div>
      <div class="bo-modal-actions"><button id="ff-close" class="default">${i18n.t('Close')}</button></div>
    </div>
  </div>

  <!-- 外部依赖（CB: Dependencies...） -->
  <div class="bo-modal" id="modal-external" style="display:none">
    <div class="bo-modal-box">
      <div class="bo-modal-title"><span>${i18n.t('Dependencies')}</span><button class="bo-modal-x" data-close-modal="modal-external" aria-label="${i18n.t('Cancel')}">×</button></div>
      <div class="bo-modal-body">
        <div class="form">
          <label><span class="field-name">${i18n.tr('外部依赖文件（每行一个）')}</span><textarea id="ext-deps"></textarea>
            <div class="hint">${i18n.tr('比输出文件新时强制重链接')}</div></label>
          <label><span class="field-name">${i18n.tr('附加输出文件（每行一个）')}</span><textarea id="ext-outs"></textarea>
            <div class="hint">${i18n.tr('外部依赖比它新时强制重链接')}</div></label>
        </div>
      </div>
      <div class="bo-modal-actions"><button id="ext-cancel">${i18n.t('Cancel')}</button><button id="ext-ok" class="default">${i18n.t('OK')}</button></div>
    </div>
  </div>

  <!-- 目标重排（CB: Re-order...） -->
  <div class="bo-modal" id="modal-reorder" style="display:none">
    <div class="bo-modal-box">
      <div class="bo-modal-title"><span>${i18n.t('Re-order build targets')}</span><button class="bo-modal-x" data-close-modal="modal-reorder" aria-label="${i18n.t('Cancel')}">×</button></div>
      <div class="bo-modal-body">
        <div class="list" id="reorder-list" style="min-height:200px"></div>
        <div class="bo-actions">
          <button id="reorder-up" title="${i18n.tr('上移')}" aria-label="${i18n.tr('上移')}">${ICONS.moveUp}</button>
          <button id="reorder-down" title="${i18n.tr('下移')}" aria-label="${i18n.tr('下移')}">${ICONS.moveDown}</button>
        </div>
      </div>
      <div class="bo-modal-actions"><button id="reorder-cancel">${i18n.t('Cancel')}</button><button id="reorder-ok" class="default">${i18n.t('OK')}</button></div>
    </div>
  </div>

  <!-- 平台多选（CB: Platforms ...） -->
  <div class="bo-modal" id="modal-platform" style="display:none">
    <div class="bo-modal-box">
      <div class="bo-modal-title"><span>${i18n.t('Build target platforms')}</span><button class="bo-modal-x" data-close-modal="modal-platform" aria-label="${i18n.t('Cancel')}">×</button></div>
      <div class="bo-modal-body">
        <div class="checks">
          <label class="check"><input type="checkbox" id="plat-win"> Windows</label>
          <label class="check"><input type="checkbox" id="plat-unix"> Unix</label>
          <label class="check"><input type="checkbox" id="plat-mac"> Mac</label>
        </div>
      </div>
      <div class="bo-modal-actions"><button id="plat-cancel">${i18n.t('Cancel')}</button><button id="plat-ok" class="default">${i18n.t('OK')}</button></div>
    </div>
  </div>

  </div>

<!-- Build options 页内覆盖层（与独立面板共用视图；放在 .bo-root 外，避免继承 properties 的紧凑度量） -->
<div id="bo-overlay" class="bo-overlay" style="display:none">
  <div class="bo-dialog">
    <div id="bo-root-host" class="bo-root">${buildOptionsMarkup(true)}</div>
  </div>
</div>

  <script>
    const vscode = acquireVsCodeApi();
    window.__cbVscode = vscode;
    const data = ${data};
    let targets = data.targets.map(t => ({ ...t }));
    let files = data.files.map(f => ({ ...f, buildTargets: [...f.buildTargets] }));
    let projOpts = { compilerOptions: [...data.projectOpts.compilerOptions], linkerOptions: [...data.projectOpts.linkerOptions], linkLibs: [...data.projectOpts.linkLibs], resourceCompilerOptions: [...(data.projectOpts.resourceCompilerOptions || [])] };
    let targetOpts = data.targetOpts.map(o => ({ compilerOptions: [...o.compilerOptions], linkerOptions: [...o.linkerOptions], linkLibs: [...o.linkLibs], resourceCompilerOptions: [...(o.resourceCompilerOptions || [])], relations: { ...o.relations } }));
    let projDirs = { includeDirs: [...data.projectDirs.includeDirs], libDirs: [...data.projectDirs.libDirs], resourceDirs: [...data.projectDirs.resourceDirs] };
    let targetDirs = data.targetDirs.map(o => ({ includeDirs: [...o.includeDirs], libDirs: [...o.libDirs], resourceDirs: [...o.resourceDirs] }));
    let projSettings = {
      title: data.projectSettings.title,
      compilerId: data.projectSettings.compilerId,
      virtualFolders: [...data.projectSettings.virtualFolders],
      customVariables: (data.projectSettings.customVariables || []).map(v => ({ ...v })),
      envVars: (data.projectSettings.envVars || []).map(v => ({ ...v })),
      platforms: data.projectSettings.platforms,
      pchMode: data.projectSettings.pchMode,
      extendedObjNames: data.projectSettings.extendedObjNames,
      makefileIsCustom: data.projectSettings.makefileIsCustom,
      makefile: data.projectSettings.makefile,
      executionDir: data.projectSettings.executionDir,
      checkForExternallyModifiedFiles: data.projectSettings.checkForExternallyModifiedFiles !== false,
      codeCompletionSearchPaths: [...(data.projectSettings.codeCompletionSearchPaths || [])],
      makeCommands: { ...(data.projectSettings.makeCommands || {}) }
    };
    let parserPaths = [...projSettings.codeCompletionSearchPaths];
    const boRuntime = data.boRuntime || { compilers: [], compilerCatalogs: {}, defineSwitch: '-D' };
    if (boRuntime.supportsPch === undefined) boRuntime.supportsPch = true;
    let projScripts = { scripts: [...data.projectScripts.scripts], before: [...data.projectScripts.before], after: [...data.projectScripts.after], always: data.projectScripts.always === true };
    let targetScripts = data.targetScripts.map(s => ({ scripts: [...s.scripts], before: [...s.before], after: [...s.after], always: s.always === true }));
    let notes = { notes: data.notes.notes, showNotesOnLoad: data.notes.showNotesOnLoad };
    let virtualTargets = data.virtualTargets.map(v => ({ ...v, targets: [...v.targets] }));
    let dbg = { searchPaths: [...((data.debugger && data.debugger.searchPaths) || [])], remote: ((data.debugger && data.debugger.remote) || []).map(r => ({ ...r })) };
    let selected = 0;
    let selectedFile = 0;
    let selectedVT = 0;
    let selectedScope = 'project';
    let selectedDirScope = 'project';
    let selectedScriptScope = 'project';
    let activeTab = ${initialTabJs};
    let focusFile = ${focusFileJs};
    if (activeTab === 'files' || activeTab === 'vtargets' || activeTab === 'options' || activeTab === 'dirs') activeTab = 'targets';
    // CB 默认值：未显式配置时按 CB 的显示值呈现；未被用户改动则保存时仍写回空串（不污染 .cbp）
    const DEFAULT_MAKEFILE = 'Makefile';
    const DEFAULT_WORKDIR = '.';
    const DEFAULT_LIB_EXPR = '$(TARGET_OUTPUT_DIR)$(TARGET_OUTPUT_BASENAME)';
    const DEFAULT_EXEC_DIR = data.basePath || '';

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

    // ---- tab 切换 ----
    function switchTab(tab) {
      activeTab = tab;
      ['settings', 'targets', 'scripts', 'notes', 'parser', 'debugger'].forEach(name => {
        const btn = document.getElementById('tabbtn-' + name);
        if (btn) btn.classList.toggle('active', tab === name);
        const pane = document.getElementById('tab-' + name);
        if (pane) pane.style.display = tab === name ? '' : 'none';
      });
      if (tab === 'targets') { renderList(); renderForm(); renderTargetFileList(); }
      if (tab === 'scripts') renderScriptsForm();
      if (tab === 'settings') renderSettingsForm();
      if (tab === 'notes') renderNotesForm();
      if (tab === 'parser') renderParserForm();
      if (tab === 'debugger') renderDebugForm();
      syncEnabledStates();
    }
    document.getElementById('tabbtn-settings').addEventListener('click', () => { collectTargetForm(); switchTab('settings'); });
    document.getElementById('tabbtn-targets').addEventListener('click', () => { collectTargetForm(); switchTab('targets'); });
    document.getElementById('tabbtn-scripts').addEventListener('click', () => { collectTargetForm(); switchTab('scripts'); });
    document.getElementById('tabbtn-notes').addEventListener('click', () => { collectTargetForm(); switchTab('notes'); });
    document.getElementById('tabbtn-parser').addEventListener('click', () => { collectTargetForm(); switchTab('parser'); });
    document.getElementById('tabbtn-debugger').addEventListener('click', () => { collectTargetForm(); switchTab('debugger'); });

    // ---- 构建目标 tab ----
    function renderList() {
      const el = document.getElementById('list');
      if (!targets.length) {
        el.innerHTML = '<div class="empty">${i18n.tr('（无构建目标）')}</div>';
        return;
      }
      el.innerHTML = targets.map((t, i) =>
        '<div class="item' + (i === selected ? ' selected' : '') + '" data-i="' + i + '"><span class="item-label">' + esc(t.title) + '</span></div>'
      ).join('');
      el.querySelectorAll('.item').forEach(div => {
        div.addEventListener('click', () => { selected = +div.dataset.i; renderList(); renderForm(); renderTargetFileList(); });
      });
      // D1：工具栏目标下拉同步
      const sel = document.getElementById('targetSwitch');
      if (sel) {
        sel.innerHTML = targets.map((t, i) => '<option value="' + i + '">' + esc(t.title) + '</option>').join('');
        sel.value = String(selected);
      }
      syncEnabledStates();
    }

    function renderForm() {
      const el = document.getElementById('form');
      if (!targets.length) { el.innerHTML = ''; return; }
      const t = targets[selected];
      const platText = (t.platforms & 7) === 7 ? 'All' : [(t.platforms & 4) ? 'Windows' : '', (t.platforms & 2) ? 'Unix' : '', (t.platforms & 1) ? 'Mac' : ''].filter(Boolean).join(';');
      el.innerHTML =
        '<div class="form-grid">' +
          '<label><span class="field-name">${i18n.tr('平台：')}</span><span class="inline-field"><input id="f-platforms-text" value="' + escAttr(platText) + '" readonly><button id="f-platforms-btn" class="cb-browse">...</button></span></label>' +
          '<span style="display:none"><input type="checkbox" id="f-pwin"' + ((t.platforms & 4) ? ' checked' : '') + '><input type="checkbox" id="f-punix"' + ((t.platforms & 2) ? ' checked' : '') + '><input type="checkbox" id="f-pmac"' + ((t.platforms & 1) ? ' checked' : '') + '></span>' +
          '<label><span class="field-name">${i18n.tr('类型：')}</span><select id="f-type">${typeOptions}</select></label>' +
          '<div class="row"><span class="field-name"></span><div class="sub-block">' +
            '<label class="check"><input type="checkbox" id="f-console"' + (t.useConsoleRunner !== false ? ' checked' : '') + '> <span>${i18n.tr('执行结束时暂停')}</span></label>' +
            '<label class="check"><input type="checkbox" id="f-staticchk"' + (t.createStaticLib ? ' checked' : '') + '> <span>${i18n.tr('创建导入库')}</span></label>' +
            '<label class="check"><input type="checkbox" id="f-defchk"' + (t.createDefFile ? ' checked' : '') + '> <span>${i18n.tr('创建 .DEF 导出文件')}</span></label>' +
          '</div></div>' +
          '<div class="cb-gap8"></div>' +
          '<label><span class="field-name">${i18n.tr('输出文件名：')}</span><span class="inline-field"><input id="f-output" value="' + escAttr(t.outputFilename) + '" title="${i18n.tr('相对项目根目录，如 bin/Debug/hello')}"><button class="cb-browse" data-browse="file" data-target="f-output">...</button></span></label>' +
          '<label><span class="field-name">${i18n.tr('导入库文件名：')}</span><span class="inline-field"><input id="f-implib" value="' + escAttr(t.impLib || DEFAULT_LIB_EXPR) + '" title="' + escAttr(DEFAULT_LIB_EXPR) + '"><button class="cb-browse" data-browse="file" data-target="f-implib">...</button></span></label>' +
          '<label><span class="field-name">${i18n.tr('定义文件文件名：')}</span><span class="inline-field"><input id="f-deffile" value="' + escAttr(t.defFile || DEFAULT_LIB_EXPR) + '" title="' + escAttr(DEFAULT_LIB_EXPR) + '"><button class="cb-browse" data-browse="file" data-target="f-deffile">...</button></span></label>' +
          '<div class="row"><span class="field-name"></span><div class="sub-block">' +
            '<label class="check"><input type="checkbox" id="f-prefix"' + (t.prefixAuto !== false ? ' checked' : '') + '> <span>${i18n.tr('自动生成文件名前缀')}</span></label>' +
            '<label class="check"><input type="checkbox" id="f-ext"' + (t.extensionAuto !== false ? ' checked' : '') + '> <span>${i18n.tr('自动生成文件名扩展名')}</span></label>' +
          '</div></div>' +
          '<div class="cb-gap8"></div>' +
          '<label><span class="field-name">${i18n.tr('执行工作目录：')}</span><span class="inline-field"><input id="f-workdir" value="' + escAttr(t.workingDir || DEFAULT_WORKDIR) + '"><button class="cb-browse" data-browse="folder" data-target="f-workdir">...</button></span></label>' +
          '<label><span class="field-name">${i18n.tr('对象输出目录：')}</span><span class="inline-field"><input id="f-object" value="' + escAttr(t.objectOutput || '') + '"><button class="cb-browse" data-browse="folder" data-target="f-object">...</button></span></label>' +
        '</div>';
      document.getElementById('f-type').value = String(t.targetType);
      ['f-type', 'f-output', 'f-object', 'f-console',
        'f-workdir', 'f-pwin', 'f-punix', 'f-pmac',
        'f-implib', 'f-deffile', 'f-defchk', 'f-staticchk', 'f-prefix', 'f-ext'].forEach(id => {
        const e = document.getElementById(id); if (e) e.addEventListener('change', () => collectTargetForm());
      });
      document.getElementById('f-platforms-btn').addEventListener('click', () => openPlatformModal('target', selected));
      el.querySelectorAll('button[data-browse]').forEach(btn => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'browse', kind: btn.dataset.browse, target: btn.dataset.target, value: document.getElementById(btn.dataset.target).value });
        });
      });
      document.getElementById('f-type').addEventListener('change', applyTargetTypeRules);
      document.getElementById('f-staticchk').addEventListener('change', syncEnabledStates);
      document.getElementById('f-defchk').addEventListener('change', syncEnabledStates);
      syncEnabledStates();
    }

    function collectTargetForm() {
      // 表单未渲染时元素不存在（例如本次会话从未切到该 tab）：跳过收集，避免保存时抛异常
      if (!targets.length || !document.getElementById('f-type')) return;
      const t = targets[selected];
      t.targetType = Number(document.getElementById('f-type').value);
      t.outputFilename = document.getElementById('f-output').value;
      t.objectOutput = document.getElementById('f-object').value;
      // 目标标题/编译器 ID/执行参数/宿主程序等扩展字段：改由左栏「重命名」、Build options
      // 的 Selected compiler / 扩展页与 Project → Set programs' arguments… 编辑，这里不再读取。
      // CB 默认值（"." / "$(TARGET_OUTPUT_DIR)$(TARGET_OUTPUT_BASENAME)"）：未改动时写回空串，保持 .cbp 原样
      const workdir = document.getElementById('f-workdir').value.trim();
      t.workingDir = workdir === DEFAULT_WORKDIR ? '' : workdir;
      const pw = document.getElementById('f-pwin').checked;
      const pu = document.getElementById('f-punix').checked;
      const pm = document.getElementById('f-pmac').checked;
      t.platforms = (pw && pu && pm) ? 255 : ((pw ? 4 : 0) | (pu ? 2 : 0) | (pm ? 1 : 0));
      t.useConsoleRunner = document.getElementById('f-console').checked;
      const impLib = document.getElementById('f-implib').value.trim();
      t.impLib = impLib === DEFAULT_LIB_EXPR ? '' : impLib;
      const defFile = document.getElementById('f-deffile').value.trim();
      t.defFile = defFile === DEFAULT_LIB_EXPR ? '' : defFile;
      t.createDefFile = document.getElementById('f-defchk').checked;
      t.createStaticLib = document.getElementById('f-staticchk').checked;
      t.prefixAuto = document.getElementById('f-prefix').checked;
      t.extensionAuto = document.getElementById('f-ext').checked;
      renderList();
    }

    document.getElementById('add').addEventListener('click', () => {
      collectTargetForm();
      const n = targets.length + 1;
      targets.push({ originalTitle: '', title: 'Target' + n, targetType: 1, outputFilename: 'bin/Target' + n + '/app', objectOutput: 'obj/Target' + n + '/', compilerId: data.compilerId || 'gcc', executionParameters: '', externalDeps: [], additionalOutput: [], envVars: [], workingDir: '', depsOutput: '', platforms: 255, hostApplication: '', runHostApplicationInTerminal: true, useConsoleRunner: true, impLib: '', defFile: '', createDefFile: false, createStaticLib: false, prefixAuto: true, extensionAuto: true });
      targetOpts.push({ compilerOptions: [], linkerOptions: [], linkLibs: [], resourceCompilerOptions: [], relations: { compiler: 3, linker: 3, include: 3, lib: 3, res: 3 } });
      targetDirs.push({ includeDirs: [], libDirs: [], resourceDirs: [] });
      targetScripts.push({ scripts: [], before: [], after: [], always: false });
      selected = targets.length - 1;
      renderList(); renderForm(); renderTargetFileList();
    });

    // D1：工具栏目标下拉切换
    document.getElementById('targetSwitch').addEventListener('change', () => {
      collectTargetForm();
      selected = Number(document.getElementById('targetSwitch').value) || 0;
      renderList(); renderForm(); renderTargetFileList();
    });

    document.getElementById('copy').addEventListener('click', () => {
      if (!targets.length) return;
      collectTargetForm();
      const src = targets[selected];
      targets.splice(selected + 1, 0, { ...src, originalTitle: '', title: src.title + ' copy', externalDeps: [...(src.externalDeps || [])], additionalOutput: [...(src.additionalOutput || [])], envVars: (src.envVars || []).map(v => ({ ...v })), makeCommands: { ...(src.makeCommands || {}) } });
      targetOpts.splice(selected + 1, 0, { compilerOptions: [...targetOpts[selected].compilerOptions], linkerOptions: [...targetOpts[selected].linkerOptions], linkLibs: [...targetOpts[selected].linkLibs], resourceCompilerOptions: [...(targetOpts[selected].resourceCompilerOptions || [])], relations: { ...targetOpts[selected].relations } });
      targetDirs.splice(selected + 1, 0, { includeDirs: [...targetDirs[selected].includeDirs], libDirs: [...targetDirs[selected].libDirs], resourceDirs: [...targetDirs[selected].resourceDirs] });
      targetScripts.splice(selected + 1, 0, { scripts: [...targetScripts[selected].scripts], before: [...targetScripts[selected].before], after: [...targetScripts[selected].after], always: targetScripts[selected].always === true });
      selected = selected + 1;
      renderList(); renderForm(); renderTargetFileList();
    });

    document.getElementById('remove').addEventListener('click', () => {
      if (!targets.length) return;
      const removedTitle = targets[selected].title;
      targets.splice(selected, 1);
      targetOpts.splice(selected, 1);
      targetDirs.splice(selected, 1);
      targetScripts.splice(selected, 1);
      if (selected >= targets.length) selected = Math.max(0, targets.length - 1);
      // 目标删除：从文件归属中移除
      files.forEach(f => {
        f.buildTargets = f.buildTargets.filter(t => t !== removedTitle);
      });
      virtualTargets.forEach(v => {
        v.targets = v.targets.filter(t => t !== removedTitle);
      });
      // 调试器远程配置同样按标题索引：删掉该目标的行，避免保存出孤儿节点
      dbg.remote = dbg.remote.filter(r => r.target !== removedTitle);
      renderList(); renderForm(); renderTargetFileList();
    });

    // R8：目标上/下移（同步四个并行数组）
    function moveTarget(delta) {
      if (!targets.length) return;
      collectTargetForm();
      const dst = selected + delta;
      if (dst < 0 || dst >= targets.length) return;
      const swap = (arr) => { const tmp = arr[selected]; arr[selected] = arr[dst]; arr[dst] = tmp; };
      swap(targets); swap(targetOpts); swap(targetDirs); swap(targetScripts);
      selected = dst;
      renderList(); renderForm(); renderTargetFileList();
    }
    document.getElementById('up').addEventListener('click', () => moveTarget(-1));
    document.getElementById('down').addEventListener('click', () => moveTarget(1));
    // R9：导出选中目标为独立工程（宿主端命令）
    document.getElementById('exportTarget').addEventListener('click', () => {
      if (!targets.length) return;
      collectTargetForm();
      vscode.postMessage({ type: 'exportTarget', target: targets[selected].title });
    });

    // ---- 虚拟目标 tab ----
    function renderVTList() {
      const el = document.getElementById('vtlist');
      if (!virtualTargets.length) {
        el.innerHTML = '<div class="empty">${i18n.tr('（无虚拟目标）')}</div>';
        return;
      }
      el.innerHTML = virtualTargets.map((v, i) =>
        '<div class="item' + (i === selectedVT ? ' selected' : '') + '" data-i="' + i + '"><span class="item-icon">' + data.icons.target + '</span><span class="item-label">' + esc(v.alias) + '</span></div>'
      ).join('');
      el.querySelectorAll('.item').forEach(div => {
        div.addEventListener('click', () => { selectedVT = +div.dataset.i; renderVTList(); renderVTForm(); });
      });
    }

    function renderVTForm() {
      const el = document.getElementById('vtform');
      if (!virtualTargets.length) { el.innerHTML = ''; return; }
      const v = virtualTargets[selectedVT];
      const targetChecks = targets.length
        ? '<div class="checks">' + targets.map(t =>
            '<label class="check"><input type="checkbox" data-title="' + escAttr(t.title) + '"' +
            (v.targets.includes(t.title) ? ' checked' : '') + '>' + esc(t.title) + '</label>'
          ).join('') + '</div>'
        : '<div class="hint">${i18n.tr('（无物理目标，请先在「构建目标」页添加）')}</div>';
      el.innerHTML =
        '<label><span class="field-name">${i18n.tr('虚拟目标别名')}</span>' +
        '<input id="vt-alias" value="' + escAttr(v.alias) + '">' +
        '<div class="hint">${i18n.tr('如 All')}</div></label>' +
        '<label><span class="field-name">${i18n.tr('包含的物理目标')}</span>' + targetChecks + '</label>' +
        '<div class="list-actions"><button id="vt-all">${i18n.tr('全选')}</button><button id="vt-none">${i18n.tr('全不选')}</button></div>';
      document.getElementById('vt-alias').addEventListener('change', () => collectVTForm());
      document.getElementById('vt-all').addEventListener('click', () => {
        virtualTargets[selectedVT].targets = targets.map(t => t.title);
        renderVTForm();
      });
      document.getElementById('vt-none').addEventListener('click', () => {
        virtualTargets[selectedVT].targets = [];
        renderVTForm();
      });
    }

    function collectVTForm() {
      const aliasEl = document.getElementById('vt-alias');
      if (!aliasEl || !virtualTargets.length) return;
      const v = virtualTargets[selectedVT];
      v.alias = aliasEl.value.trim() || v.alias;
      v.targets = [...document.querySelectorAll('#vtform input[data-title]:checked')].map(c => c.dataset.title);
      renderVTList();
    }

    document.getElementById('vt-add').addEventListener('click', () => {
      collectVTForm();
      const n = virtualTargets.length + 1;
      virtualTargets.push({ originalAlias: '', alias: 'All' + (n > 1 ? n : ''), targets: targets.map(t => t.title) });
      selectedVT = virtualTargets.length - 1;
      renderVTList(); renderVTForm();
    });

    document.getElementById('vt-remove').addEventListener('click', () => {
      if (!virtualTargets.length) return;
      virtualTargets.splice(selectedVT, 1);
      if (selectedVT >= virtualTargets.length) selectedVT = Math.max(0, virtualTargets.length - 1);
      renderVTList(); renderVTForm();
    });

    // ---- 文件 tab ----
    function renderFileList() {
      const el = document.getElementById('flist');
      if (!files.length) {
        el.innerHTML = '<div class="empty">${i18n.tr('（无文件）')}</div>';
        return;
      }
      el.innerHTML = files.map((f, i) =>
        '<div class="item' + (i === selectedFile ? ' selected' : '') + '" data-i="' + i + '" title="' + escAttr(f.relativeFilename) + '"><span class="item-icon">' + data.icons.file + '</span><span class="item-label">' + esc(f.relativeFilename) + '</span></div>'
      ).join('');
      el.querySelectorAll('.item').forEach(div => {
        div.addEventListener('click', () => { selectedFile = +div.dataset.i; renderFileList(); renderFileForm(); });
      });
    }

    function renderFileForm() {
      const el = document.getElementById('fform');
      if (!files.length) { el.innerHTML = ''; return; }
      const f = files[selectedFile];
      const varSel =
        '<select id="ff-var">' +
        '<option value="">${i18n.tr('自动 (CPP)')}</option>' +
        '<option value="CC"' + (f.compilerVar === 'CC' ? ' selected' : '') + '>CC</option>' +
        '<option value="WINDRES"' + (f.compilerVar === 'WINDRES' ? ' selected' : '') + '>WINDRES</option>' +
        '</select>';
      const targetChecks = targets.length
        ? '<div class="checks">' + targets.map(t =>
            '<label class="check"><input type="checkbox" data-title="' + escAttr(t.title) + '"' +
            (f.buildTargets.includes(t.title) ? ' checked' : '') + '>' + esc(t.title) + '</label>'
          ).join('') + '</div>'
        : '<div class="hint">${i18n.tr('（无构建目标，请先在「构建目标」页添加）')}</div>';
      el.innerHTML =
        '<label><span class="field-name">${i18n.tr('编译变量')}</span>' + varSel +
        '<div class="hint">${i18n.tr('默认 CPP，纯 C 文件可设 CC，资源脚本设 WINDRES')}</div></label>' +
        '<label class="check"><input type="checkbox" id="ff-compile"' + (f.compile ? ' checked' : '') + '>' +
        '<span class="field-name" style="display:inline">${i18n.tr('编译此文件')}</span></label>' +
        '<label class="check"><input type="checkbox" id="ff-link"' + (f.link ? ' checked' : '') + '>' +
        '<span class="field-name" style="display:inline">${i18n.tr('链接此文件')}</span></label>' +
        '<label><span class="field-name">${i18n.tr('自定义构建命令')}</span>' +
        '<textarea id="ff-cmd" placeholder="${i18n.tr('留空 = 使用默认编译规则')}">' + esc(f.buildCommand) + '</textarea>' +
        '<div class="hint">${i18n.tr('留空则按编译变量自动生成命令；非空则替换默认编译器的编译命令')}</div></label>' +
        '<label><span class="field-name">${i18n.tr('编译权重（Weight）')}</span>' +
        '<input type="number" id="ff-weight" min="0" max="100" step="1" value="' + f.weight + '">' +
        '<div class="hint">0-100，${i18n.tr('默认 50；值越小越先编译（并行编译调度用）')}</div></label>' +
        '<label><span class="field-name">${i18n.tr('虚拟文件夹归属')}</span>' +
        '<input id="ff-vfolder" placeholder="${i18n.tr('留空 = 根')}" value="' + escAttr(f.virtualFolder) + '">' +
        '<div class="hint">${i18n.tr('虚拟文件夹名，如 Headers / Sources')}</div></label>' +
        '<label><span class="field-name">${i18n.tr('归属构建目标')}</span>' + targetChecks +
        '<div class="hint">${i18n.tr('勾选全部 = 归属所有目标（不写 target）；不勾选 = 不归属任何目标')}</div></label>' +
        '<div class="list-actions"><button id="ff-all">${i18n.tr('全选')}</button><button id="ff-none">${i18n.tr('全不选')}</button></div>';
      ['ff-var', 'ff-compile', 'ff-link', 'ff-cmd', 'ff-weight', 'ff-vfolder'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => collectFileForm());
      });
      document.getElementById('ff-all').addEventListener('click', () => {
        const f2 = files[selectedFile];
        f2.buildTargets = targets.map(t => t.title);
        renderFileForm();
      });
      document.getElementById('ff-none').addEventListener('click', () => {
        files[selectedFile].buildTargets = [];
        renderFileForm();
      });
    }

    function collectFileForm() {
      const varEl = document.getElementById('ff-var');
      if (!varEl || !files.length) return;
      const f = files[selectedFile];
      f.compilerVar = varEl.value;
      f.compile = document.getElementById('ff-compile').checked;
      f.link = document.getElementById('ff-link').checked;
      f.buildCommand = document.getElementById('ff-cmd').value;
      f.weight = Number(document.getElementById('ff-weight').value) || 50;
      f.virtualFolder = document.getElementById('ff-vfolder').value.trim();
      const checked = [...document.querySelectorAll('#fform input[data-title]:checked')].map(c => c.dataset.title);
      f.buildTargets = checked;
    }

    // ---- 构建选项 tab ----
    function optionsLines(text) {
      return text.split('\\n').map(s => s.trim()).filter(Boolean);
    }
    // 项目自定义变量行解析：name=value（无 '=' 时值为空）
    function parseVarLines(text) {
      return text.split('\\n').map(s => s.trim()).filter(Boolean).map(line => {
        const i = line.indexOf('=');
        return i >= 0 ? { name: line.slice(0, i).trim(), value: line.slice(i + 1).trim() } : { name: line, value: '' };
      }).filter(v => v.name);
    }
    function relSel(id, val, label) {
      return '<label><span class="field-name">' + label + '</span>' +
        '<select id="' + id + '">' +
        '<option value="0"' + (val === 0 ? ' selected' : '') + '>${i18n.tr('仅用父级选项')}</option>' +
        '<option value="1"' + (val === 1 ? ' selected' : '') + '>${i18n.tr('仅用目标选项')}</option>' +
        '<option value="2"' + (val === 2 ? ' selected' : '') + '>${i18n.tr('前置到父级选项前')}</option>' +
        '<option value="3"' + (val === 3 ? ' selected' : '') + '>${i18n.tr('追加到父级选项后（默认）')}</option>' +
        '</select></label>';
    }

    function renderOptionsForm() {
      const el = document.getElementById('oform');
      const scopeSel =
        '<select id="opt-scope">' +
        '<option value="project">${i18n.tr('项目级（所有目标的基础）')}</option>' +
        targets.map((t, i) => '<option value="' + i + '">' + esc(t.title) + '</option>').join('') +
        '</select>';
      if (selectedScope !== 'project' && selectedScope >= targets.length) selectedScope = 'project';
      const cur = selectedScope === 'project' ? projOpts : targetOpts[selectedScope];
      const relBlock = selectedScope === 'project' ? '' :
        relSel('opt-rel-compiler', cur.relations.compiler, '${i18n.tr('编译器选项关系')}') +
        relSel('opt-rel-linker', cur.relations.linker, '${i18n.tr('链接器选项关系')}') +
        relSel('opt-rel-include', cur.relations.include, 'Include ${i18n.tr('目录关系')}') +
        relSel('opt-rel-lib', cur.relations.lib, 'Lib ${i18n.tr('目录关系')}') +
        relSel('opt-rel-res', cur.relations.res, '${i18n.tr('资源目录关系')}');
      el.innerHTML =
        '<label><span class="field-name">${i18n.tr('作用域')}</span>' + scopeSel + '</label>' +
        '<label><span class="field-name">${i18n.tr('编译选项')}</span>' +
        '<textarea id="opt-compiler">' + esc(cur.compilerOptions.join('\\n')) + '</textarea>' +
        '<div class="hint">${i18n.tr('每行一个选项，如 -g、-Wall、-std=c11')}</div></label>' +
        '<label><span class="field-name">${i18n.tr('链接选项')}</span>' +
        '<textarea id="opt-linker">' + esc(cur.linkerOptions.join('\\n')) + '</textarea>' +
        '<div class="hint">${i18n.tr('每行一个链接器选项')}</div></label>' +
        '<label><span class="field-name">${i18n.tr('链接库')}</span>' +
        '<textarea id="opt-libs">' + esc(cur.linkLibs.join('\\n')) + '</textarea>' +
        '<div class="hint">${i18n.tr('每行一个库名，如 m、pthread')}</div></label>' +
        relBlock;
      document.getElementById('opt-scope').value = String(selectedScope);
      document.getElementById('opt-scope').addEventListener('change', () => {
        collectOptionsForm();
        selectedScope = document.getElementById('opt-scope').value;
        selectedScope = selectedScope === 'project' ? 'project' : Number(selectedScope);
        renderOptionsForm();
      });
      ['opt-compiler', 'opt-linker', 'opt-libs'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => collectOptionsForm());
      });
      if (selectedScope !== 'project') {
        ['opt-rel-compiler', 'opt-rel-linker', 'opt-rel-include', 'opt-rel-lib', 'opt-rel-res'].forEach(id => {
          document.getElementById(id).addEventListener('change', () => collectOptionsForm());
        });
      }
    }

    function collectOptionsForm() {
      const el = document.getElementById('oform');
      if (!el || !el.querySelector('#opt-compiler')) return;
      const cur = selectedScope === 'project' ? projOpts : targetOpts[selectedScope];
      // 目标被删除后作用域索引可能失效：跳过收集（其余 tab 仍照常保存）
      if (!cur) return;
      cur.compilerOptions = optionsLines(document.getElementById('opt-compiler').value);
      cur.linkerOptions = optionsLines(document.getElementById('opt-linker').value);
      cur.linkLibs = optionsLines(document.getElementById('opt-libs').value);
      if (selectedScope !== 'project') {
        cur.relations.compiler = Number(document.getElementById('opt-rel-compiler').value);
        cur.relations.linker = Number(document.getElementById('opt-rel-linker').value);
        cur.relations.include = Number(document.getElementById('opt-rel-include').value);
        cur.relations.lib = Number(document.getElementById('opt-rel-lib').value);
        cur.relations.res = Number(document.getElementById('opt-rel-res').value);
      }
    }

    // ---- 搜索目录 tab ----
    function renderDirsForm() {
      const el = document.getElementById('dform');
      const scopeSel =
        '<select id="dir-scope">' +
        '<option value="project">${i18n.tr('项目级（所有目标的基础）')}</option>' +
        targets.map((t, i) => '<option value="' + i + '">' + esc(t.title) + '</option>').join('') +
        '</select>';
      if (selectedDirScope !== 'project' && selectedDirScope >= targets.length) selectedDirScope = 'project';
      const cur = selectedDirScope === 'project' ? projDirs : targetDirs[selectedDirScope];
      el.innerHTML =
        '<label><span class="field-name">${i18n.tr('作用域')}</span>' + scopeSel + '</label>' +
        '<label><span class="field-name">${i18n.tr('编译器搜索目录（Include）')}</span>' +
        '<textarea id="dir-include">' + esc(cur.includeDirs.join('\\n')) + '</textarea>' +
        '<div class="hint">${i18n.tr('每行一个目录，如 ../include、$(SDK)/inc')}</div></label>' +
        '<label><span class="field-name">${i18n.tr('链接器搜索目录（Lib）')}</span>' +
        '<textarea id="dir-lib">' + esc(cur.libDirs.join('\\n')) + '</textarea>' +
        '<div class="hint">${i18n.tr('每行一个库搜索目录')}</div></label>' +
        '<label><span class="field-name">${i18n.tr('资源编译器搜索目录')}</span>' +
        '<textarea id="dir-res">' + esc(cur.resourceDirs.join('\\n')) + '</textarea>' +
        '<div class="hint">${i18n.tr('每行一个资源搜索目录')}</div></label>';
      document.getElementById('dir-scope').value = String(selectedDirScope);
      document.getElementById('dir-scope').addEventListener('change', () => {
        collectDirsForm();
        selectedDirScope = document.getElementById('dir-scope').value;
        selectedDirScope = selectedDirScope === 'project' ? 'project' : Number(selectedDirScope);
        renderDirsForm();
      });
      ['dir-include', 'dir-lib', 'dir-res'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => collectDirsForm());
      });
    }

    function collectDirsForm() {
      const el = document.getElementById('dform');
      if (!el || !el.querySelector('#dir-include')) return;
      const cur = selectedDirScope === 'project' ? projDirs : targetDirs[selectedDirScope];
      if (!cur) return;
      cur.includeDirs = optionsLines(document.getElementById('dir-include').value);
      cur.libDirs = optionsLines(document.getElementById('dir-lib').value);
      cur.resourceDirs = optionsLines(document.getElementById('dir-res').value);
    }

    // ---- 项目设置 tab ----
    function renderSettingsForm() {
      const el = document.getElementById('sform');
      const platText = (projSettings.platforms & 7) === 7 ? 'All'
        : [(projSettings.platforms & 4) ? 'Windows' : '', (projSettings.platforms & 2) ? 'Unix' : '', (projSettings.platforms & 1) ? 'Mac' : ''].filter(Boolean).join(';');
      const pchOptions = [
        [0, '${i18n.tr('在与原始头文件同目录生成 PCH')}'],
        [1, '${i18n.tr('在对象输出目录生成 PCH')}'],
        [2, '${i18n.tr('在原头文件旁生成 PCH（默认）')}'],
      ];
      el.innerHTML =
        '<div class="form-grid">' +
          '<label><span class="field-name">${i18n.tr('标题：')}</span><input id="set-title" value="' + escAttr(projSettings.title) + '"></label>' +
          '<label><span class="field-name">${i18n.tr('平台：')}</span><span class="inline-field"><input id="set-platforms-text" value="' + escAttr(platText) + '" readonly><button id="set-platforms-btn" class="cb-browse">...</button></span></label>' +
          '<span style="display:none"><input type="checkbox" id="set-pwin"' + ((projSettings.platforms & 4) ? ' checked' : '') + '><input type="checkbox" id="set-punix"' + ((projSettings.platforms & 2) ? ' checked' : '') + '><input type="checkbox" id="set-pmac"' + ((projSettings.platforms & 1) ? ' checked' : '') + '></span>' +
          '<label><span class="field-name">${i18n.tr('文件名：')}</span><span class="static-value" title="' + escAttr(data.filename) + '">' + esc(data.filename) + '</span></label>' +
          '<label><span class="field-name">${i18n.tr('Makefile：')}</span><span class="inline-field"><input id="set-mkfile" value="' + escAttr(projSettings.makefile || DEFAULT_MAKEFILE) + '"></span></label>' +
          '<div class="row"><span class="field-name"></span><div class="sub-block">' +
            '<label class="check"><input type="checkbox" id="set-mkcustom"' + (projSettings.makefileIsCustom ? ' checked' : '') + '> <span>${i18n.tr('这是一个自定义 Makefile')}</span></label>' +
            '<div class="hint red">${i18n.tr('文件必须存在，不会自动生成 Makefile！')}</div>' +
            '<div class="hint red">${i18n.tr('如果在此处修改，工程构建选项里的特殊设置只有在保存工程后才会启用/禁用。')}</div>' +
            '<div class="sub-row"><span class="field-name">${i18n.tr('执行目录：')}</span><input id="set-mkdir" value="' + escAttr(projSettings.executionDir || DEFAULT_EXEC_DIR) + '" title="' + escAttr(DEFAULT_EXEC_DIR) + '"><button class="cb-browse" data-browse="folder" data-target="set-mkdir">...</button></div>' +
          '</div></div>' +
          '<div class="row"><span class="field-name">${i18n.tr('预编译头：')}</span><fieldset class="radio-box"><legend>${i18n.tr('策略')}</legend><div class="radio-group">' +
            pchOptions.map(o => '<label class="check"><input type="radio" name="set-pch" id="set-pch-' + o[0] + '" value="' + o[0] + '"' + (Number(projSettings.pchMode) === o[0] ? ' checked' : '') + '><span>' + o[1] + '</span></label>').join('') +
          '</div></fieldset></div>' +
          '<div class="row"><span class="field-name"></span><div class="sub-block"><div class="hint red">${i18n.tr('如果修改 PCH 生成策略，')}<br>${i18n.tr('请手动删除旧 PCH 文件（或目录）以避免冲突')}</div></div></div>' +
          '<div class="row cb-gap8"><span class="field-name"></span><span></span></div>' +
          '<div class="row"><span class="field-name">${i18n.tr('对象文件名生成：')}</span><div class="sub-block">' +
            '<label class="check"><input type="checkbox" id="set-extobj"' + (projSettings.extendedObjNames ? ' checked' : '') + '> <span>${i18n.tr('生成扩展对象名（例如 "foo.cpp.o" 而不是 "foo.o"）')}</span></label>' +
            '<div class="hint red">${i18n.tr('（此设置主要用于包含大量同名但扩展名不同文件的大型工程）')}</div>' +
          '</div></div>' +
          '<div class="row" style="margin-top:8px"><span class="field-name">${i18n.tr('检查外部修改的文件：')}</span><div class="sub-block">' +
            '<label class="check"><input type="checkbox" id="set-checkfiles"' + (projSettings.checkForExternallyModifiedFiles !== false ? ' checked' : '') + '> <span>${i18n.tr('检查外部修改的文件（大多数情况下应勾选）')}</span></label>' +
            '<div class="hint red">${i18n.tr('（关闭外部修改检查主要用于慢速网络共享上的工程。注意：外部修改可能静默覆盖文件，如果你没有在 Code::Blocks 内保存它们）')}</div>' +
          '</div></div>' +
        '</div>' +
        '<div class="settings-actions"><button id="set-project-deps">${i18n.tr('工程的依赖…')}</button><button id="set-project-build-options">${i18n.tr('工程的构建选项…')}</button></div>';
      ['set-title', 'set-checkfiles',
        'set-pwin', 'set-punix', 'set-pmac', 'set-extobj', 'set-mkcustom', 'set-mkfile', 'set-mkdir'].forEach(id => {
        const e = document.getElementById(id); if (e) e.addEventListener('change', () => collectSettingsForm());
      });
      el.querySelectorAll('input[name="set-pch"]').forEach(r => r.addEventListener('change', () => collectSettingsForm()));
      document.getElementById('set-platforms-btn').addEventListener('click', () => openPlatformModal('project', -1));
      document.getElementById('set-project-deps').addEventListener('click', () => vscode.postMessage({ type: 'editDependencies' }));
      document.getElementById('set-project-build-options').addEventListener('click', () => openBuildOptions('project'));
      el.querySelectorAll('button[data-browse]').forEach(btn => {
        btn.addEventListener('click', () => vscode.postMessage({ type: 'browse', kind: btn.dataset.browse, target: btn.dataset.target, value: document.getElementById(btn.dataset.target).value }));
      });
      document.getElementById('set-mkcustom').addEventListener('change', () => { collectSettingsForm(); syncEnabledStates(); });
      syncEnabledStates();
    }

    function collectSettingsForm() {
      const el = document.getElementById('sform');
      if (!el || !el.querySelector('#set-title')) return;
      projSettings.title = document.getElementById('set-title').value.trim() || projSettings.title;
      const sw = document.getElementById('set-pwin').checked;
      const su = document.getElementById('set-punix').checked;
      const sm = document.getElementById('set-pmac').checked;
      projSettings.platforms = (sw && su && sm) ? 255 : ((sw ? 4 : 0) | (su ? 2 : 0) | (sm ? 1 : 0));
      const pchRadio = el.querySelector('input[name="set-pch"]:checked');
      if (pchRadio) projSettings.pchMode = Number(pchRadio.value) || 0;
      projSettings.extendedObjNames = document.getElementById('set-extobj').checked;
      projSettings.makefileIsCustom = document.getElementById('set-mkcustom').checked;
      // CB 默认值：保持默认时不写入 .cbp（空串 = 使用 CB 默认解析）
      const mk = document.getElementById('set-mkfile').value.trim();
      projSettings.makefile = mk === DEFAULT_MAKEFILE ? '' : mk;
      const execDir = document.getElementById('set-mkdir').value.trim();
      projSettings.executionDir = execDir === DEFAULT_EXEC_DIR ? '' : execDir;
      projSettings.checkForExternallyModifiedFiles = document.getElementById('set-checkfiles').checked;
    }

    // ---- CB 启用/禁用联动（对齐 codeblocks-src projectoptionsdlg.cpp） ----
    function setDisabled(id, disabled) {
      const el = document.getElementById(id);
      if (el) el.disabled = !!disabled;
    }
    function setBrowseDisabled(target, disabled) {
      document.querySelectorAll('button[data-browse][data-target="' + target + '"]').forEach(b => { b.disabled = !!disabled; });
    }
    /**
     * 一次性同步所有控件的可用状态：
     *  - 自定义 Makefile：Execution dir 启用；PCH / 对象目录 / 目标文件列表与工具栏 / 脚本页禁用
     *  - 目标类型：Console runner / Create import library / .DEF / Import / Definition / Working dir
     *  - 目标数量与列表选中项：Rename / Duplicate / Delete / Re-order / Export / File properties
     */
    function syncEnabledStates() {
      const mkEl = document.getElementById('set-mkcustom');
      const customMake = mkEl ? mkEl.checked : projSettings.makefileIsCustom === true;
      const supportsPch = !boRuntime || boRuntime.supportsPch !== false;
      // Project settings
      setDisabled('set-mkdir', !customMake);
      setBrowseDisabled('set-mkdir', !customMake);
      document.querySelectorAll('input[name="set-pch"]').forEach(r => { r.disabled = customMake || !supportsPch; });

      // Build targets
      const typeEl = document.getElementById('f-type');
      if (typeEl) {
        const type = Number(typeEl.value);
        const dynamic = type === 3;
        const commandsOnly = type === 4;
        const workdirOn = type === 0 || type === 1 || type === 3 || type === 5;
        const staticChk = document.getElementById('f-staticchk');
        const defChk = document.getElementById('f-defchk');
        const impOn = dynamic && !!staticChk && staticChk.checked;
        const defOn = dynamic && !!defChk && defChk.checked;
        setDisabled('f-console', type !== 1);
        setDisabled('f-staticchk', !dynamic);
        setDisabled('f-defchk', !dynamic);
        setDisabled('f-output', commandsOnly);
        setBrowseDisabled('f-output', commandsOnly);
        setDisabled('f-implib', !impOn || commandsOnly);
        setDisabled('f-deffile', !defOn || commandsOnly);
        setBrowseDisabled('f-implib', !impOn || commandsOnly);
        setBrowseDisabled('f-deffile', !defOn || commandsOnly);
        setDisabled('f-workdir', !workdirOn || commandsOnly);
        setBrowseDisabled('f-workdir', !workdirOn || commandsOnly);
        setDisabled('f-object', customMake || commandsOnly);
        setBrowseDisabled('f-object', customMake || commandsOnly);
        document.querySelectorAll('#tflist input[type="checkbox"]').forEach(cb => { cb.disabled = customMake; });
        ['toggleChecks', 'allOn', 'allOff'].forEach(id => setDisabled(id, customMake));
        setDisabled('fileProps', customMake || !files.length);
        setDisabled('remove', targets.length <= 1);
        setDisabled('reorderTargets', targets.length <= 1);
        setDisabled('renameTarget', !targets.length);
        setDisabled('copy', !targets.length);
        setDisabled('exportTarget', !targets.length);
        setDisabled('targetBuildOptions', !targets.length);
      }

      // Build scripts（CB：自定义 Makefile 时整页只读）
      ['scr-tree', 'scr-list-box', 'scr-add', 'scr-validate'].forEach(id => setDisabled(id, customMake));
      const scriptSel = !customMake && selectedScript >= 0;
      setDisabled('scr-remove', !scriptSel);
      setDisabled('scr-up', !scriptSel);
      setDisabled('scr-down', !scriptSel);

      // Parser / Debugger：无选中项时不可编辑
      setDisabled('parser-edit', selectedParser < 0);
      setDisabled('parser-del', selectedParser < 0);
      setDisabled('dbg-path-edit', selectedDbgPath < 0);
      setDisabled('dbg-path-del', selectedDbgPath < 0);
    }
    /** 目标类型切换：对齐 CB OnProjectTypeChanged 的清空规则 */
    function applyTargetTypeRules() {
      const el = document.getElementById('f-type');
      if (!el) return;
      const type = Number(el.value);
      const clear = (id) => { const f = document.getElementById(id); if (f) f.value = ''; };
      if (type === 2) {
        // Static library：CB 清空 Import library / Definition file
        clear('f-implib');
        clear('f-deffile');
      } else if (type === 4) {
        // Commands only：CB 清空并禁用全部输出/文件名/目录
        ['f-output', 'f-implib', 'f-deffile', 'f-workdir', 'f-object'].forEach(clear);
      }
      collectTargetForm();
      syncEnabledStates();
    }

    // ---- 构建脚本 tab（CB: Project overview + Attached build scripts）----
    let selectedScript = -1;
    function scriptScope() {
      return selectedScriptScope === 'project' ? projScripts : targetScripts[selectedScriptScope];
    }
    function renderScriptsForm() {
      const el = document.getElementById('scrform');
      if (selectedScriptScope !== 'project' && selectedScriptScope >= targets.length) selectedScriptScope = 'project';
      const cur = scriptScope();
      el.innerHTML =
        '<div class="scripts-layout">' +
          '<div class="scripts-column">' +
            '<div class="field-label">${i18n.tr('工程概览：')}</div>' +
            '<div class="list fill-control" id="scr-tree"></div>' +
            '<div class="plain-actions"><button id="scr-validate">${i18n.tr('校验所有已附加脚本')}</button></div>' +
          '</div>' +
          '<div class="scripts-column">' +
            '<div class="field-label">${i18n.tr('已附加的构建脚本：')}</div>' +
            '<div class="list-with-spin">' +
              '<div class="list fill-control" id="scr-list-box" title="${i18n.tr('构建前/后命令在 Build options → 构建前/后步骤 中编辑。')}"></div>' +
              '<div class="bo-move-buttons">' +
                '<button id="scr-up" title="${i18n.tr('上移')}" aria-label="${i18n.tr('上移')}">${ICONS.moveUp}</button>' +
                '<button id="scr-down" title="${i18n.tr('下移')}" aria-label="${i18n.tr('下移')}">${ICONS.moveDown}</button>' +
              '</div>' +
            '</div>' +
            '<div class="plain-actions">' +
              '<button id="scr-add">${i18n.tr('添加')}</button>' +
              '<button id="scr-remove">${i18n.tr('删除')}</button>' +
            '</div>' +
            '<div class="hint" id="scr-status"></div>' +
          '</div>' +
        '</div>';
      // 工程概览树（工程 + 各构建目标），点击切换作用域
      const tree = document.getElementById('scr-tree');
      const treeRow = (scope, label, child) =>
        '<div class="tree-item' + (child ? ' child' : '') + (String(selectedScriptScope) === String(scope) ? ' selected' : '') + '" data-scope="' + scope + '">' +
        '<span class="item-label">' + esc(label) + '</span></div>';
      tree.innerHTML = treeRow('project', projSettings.title, false) +
        targets.map((t, i) => treeRow(i, t.title, true)).join('');
      tree.querySelectorAll('.tree-item').forEach(row => row.addEventListener('click', () => {
        selectedScriptScope = row.dataset.scope === 'project' ? 'project' : Number(row.dataset.scope);
        selectedScript = -1;
        renderScriptsForm();
      }));
      const box = document.getElementById('scr-list-box');
      box.innerHTML = cur.scripts.length
        ? cur.scripts.map((s, i) => '<div class="item' + (selectedScript === i ? ' selected' : '') + '" data-i="' + i + '"><span class="item-label">' + esc(s) + '</span></div>').join('')
        : '<div class="empty">${i18n.tr('（空）')}</div>';
      box.querySelectorAll('.item').forEach(row => row.addEventListener('click', () => { selectedScript = Number(row.dataset.i); renderScriptsForm(); }));
      document.getElementById('scr-add').addEventListener('click', () => vscode.postMessage({ type: 'browseScripts' }));
      document.getElementById('scr-remove').addEventListener('click', () => {
        if (selectedScript < 0) return;
        cur.scripts.splice(selectedScript, 1);
        selectedScript = Math.min(selectedScript, cur.scripts.length - 1);
        renderScriptsForm();
      });
      document.getElementById('scr-up').addEventListener('click', () => {
        if (selectedScript <= 0) return;
        const x = cur.scripts[selectedScript - 1]; cur.scripts[selectedScript - 1] = cur.scripts[selectedScript]; cur.scripts[selectedScript] = x;
        selectedScript--; renderScriptsForm();
      });
      document.getElementById('scr-down').addEventListener('click', () => {
        if (selectedScript < 0 || selectedScript >= cur.scripts.length - 1) return;
        const x = cur.scripts[selectedScript + 1]; cur.scripts[selectedScript + 1] = cur.scripts[selectedScript]; cur.scripts[selectedScript] = x;
        selectedScript++; renderScriptsForm();
      });
      document.getElementById('scr-validate').addEventListener('click', () => {
        const all = [];
        projScripts.scripts.forEach(s => all.push({ scope: projSettings.title, file: s }));
        targetScripts.forEach((s, i) => s.scripts.forEach(f => all.push({ scope: targets[i] ? targets[i].title : String(i), file: f })));
        vscode.postMessage({ type: 'validateScripts', scripts: all });
        const st = document.getElementById('scr-status'); if (st) st.textContent = '${i18n.tr('校验中…')}';
      });
      syncEnabledStates();
    }

    function collectScriptsForm() {
      // 脚本列表直接操作数组；无额外表单字段
    }

    // ---- 备注 tab ----
    function renderNotesForm() {
      const el = document.getElementById('ntform');
      el.innerHTML =
        '<div class="fill-pane">' +
          '<div class="field-label">${i18n.tr('项目备注：')}</div>' +
          '<textarea id="nt-text" class="fill-control">' + esc(notes.notes) + '</textarea>' +
          '<label class="check" style="margin-top:6px"><input type="checkbox" id="nt-show"' + (notes.showNotesOnLoad ? ' checked' : '') + '>' +
          '<span>${i18n.tr('加载项目时自动显示这些备注（仅当备注非空）')}</span></label>' +
        '</div>';
      document.getElementById('nt-text').addEventListener('change', () => collectNotesForm());
      document.getElementById('nt-show').addEventListener('change', () => collectNotesForm());
    }

    function collectNotesForm() {
      const el = document.getElementById('ntform');
      if (!el || !el.querySelector('#nt-text')) return;
      notes.notes = document.getElementById('nt-text').value;
      notes.showNotesOnLoad = document.getElementById('nt-show').checked;
    }

    // ---- 调试器 tab（R3/R4）----
    let selectedDebugScope = '';
    let selectedDbgPath = -1;
    let dbgSubTab = 'remote';
    function dbgRemoteFor(target) {
      let r = dbg.remote.find(x => x.target === target);
      if (!r) {
        r = { target: target, connType: 0, serialPort: '', serialBaud: '115200', ip: '', ipPort: '', additionalCmds: '', additionalCmdsBefore: '', additionalShellCmdsAfter: '', additionalShellCmdsBefore: '', skipLDpath: false, extendedRemote: false };
        dbg.remote.push(r);
      }
      return r;
    }
    function renderDebugForm() {
      const el = document.getElementById('dbgform');
      if (selectedDebugScope !== '' && Number(selectedDebugScope) >= targets.length) selectedDebugScope = '';
      if (selectedDbgPath >= dbg.searchPaths.length) selectedDbgPath = dbg.searchPaths.length - 1;
      const r = selectedDebugScope === '' ? dbgRemoteFor('') : dbgRemoteFor(targets[Number(selectedDebugScope)].title);
      const pathRows = dbg.searchPaths.length
        ? dbg.searchPaths.map((p, i) => '<div class="item' + (i === selectedDbgPath ? ' selected' : '') + '" data-i="' + i + '"><span class="item-label">' + esc(p) + '</span></div>').join('')
        : '<div class="empty">${i18n.tr('（空）')}</div>';
      const scopeRows = '<div class="tree-item' + (selectedDebugScope === '' ? ' selected' : '') + '" data-scope="">' + esc('<Project>') + '</div>' +
        targets.map((t, i) => '<div class="tree-item child' + (String(selectedDebugScope) === String(i) ? ' selected' : '') + '" data-scope="' + i + '">' + esc(t.title) + '</div>').join('');
      const connSel = [[0, 'TCP (IP:${i18n.tr('端口)')}'], [1, 'UDP (IP:${i18n.tr('端口)')}'], [2, '${i18n.tr('串口 Serial')}']]
        .map(c => '<option value="' + c[0] + '">' + c[1] + '</option>').join('');
      const subTab = (id, label) => '<button class="dbg-tab' + (dbgSubTab === id ? ' active' : '') + '" data-dtab="' + id + '">' + esc(label) + '</button>';
      const panel = (id, html) => '<div class="dbg-page" data-dpanel="' + id + '"' + (dbgSubTab === id ? '' : ' style="display:none"') + '>' + html + '</div>';
      el.innerHTML =
        '<section class="card">' +
          '<div class="card-header">${i18n.tr('附加调试器搜索目录：')}</div>' +
          '<div class="card-body">' +
            '<div class="list-with-stack">' +
              '<div class="list" id="dbg-paths-list" style="height:150px" title="${i18n.tr('调试会话向 GDB 发 directory 命令（对齐 CB debugger search paths；支持 $(VAR) 宏与相对项目根路径）')}">' + pathRows + '</div>' +
              '<div class="btn-stack">' +
                '<button id="dbg-path-add">${i18n.tr('添加')}</button>' +
                '<button id="dbg-path-edit"' + (selectedDbgPath < 0 ? ' disabled' : '') + '>${i18n.tr('编辑')}</button>' +
                '<button id="dbg-path-del"' + (selectedDbgPath < 0 ? ' disabled' : '') + '>${i18n.tr('删除')}</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +
        '<section class="card">' +
          '<div class="card-header">${i18n.tr('远程调试支持（仅 GDB）：')}</div>' +
          '<div class="card-body">' +
            '<div class="dbg-scope-grid">' +
              '<div>' +
                '<div class="field-label">${i18n.tr('选择目标：')}</div>' +
                '<div class="list" id="dbg-scope-list" style="height:90px">' + scopeRows + '</div>' +
              '</div>' +
              '<div style="min-width:0" title="${i18n.tr('连接顺序（对齐 CB）：连接前命令 → 连接前 shell → [set remotebaud] → target [extended-]remote → 连接后命令 → 连接后 shell；有效连接（串口需端口+波特率；TCP/UDP 需 IP+端口）时启动用 continue 而非 run')}">' +
                '<div class="dbg-tabs">' +
                  subTab('remote', '${i18n.tr('远程连接')}') +
                  subTab('gdb', '${i18n.tr('附加 GDB 命令')}') +
                  subTab('shell', '${i18n.tr('附加 shell 命令')}') +
                '</div>' +
                panel('remote',
                  '<div class="dbg-grid">' +
                    '<label class="span-2" style="grid-template-columns:90px max-content"><span class="field-name">${i18n.tr('连接类型：')}</span><select id="dbg-conn" style="width:120px">' + connSel + '</select></label>' +
                    '<label><span class="field-name">${i18n.tr('串口：')}</span><input id="dbg-serial" value="' + escAttr(r.serialPort) + '" placeholder="COM3 / /dev/ttyUSB0"></label>' +
                    '<label class="short"><span class="field-name">${i18n.tr('波特率：')}</span><input id="dbg-baud" list="dbg-baud-list" value="' + escAttr(r.serialBaud) + '"><datalist id="dbg-baud-list"><option value="4800"><option value="9600"><option value="19200"><option value="38400"><option value="57600"><option value="115200"><option value="230400"></datalist></label>' +
                    '<label><span class="field-name">IP ${i18n.tr('地址：')}</span><input id="dbg-ip" value="' + escAttr(r.ip) + '"></label>' +
                    '<label class="short"><span class="field-name">${i18n.tr('端口：')}</span><input id="dbg-port" value="' + escAttr(r.ipPort) + '"></label>' +
                    '<label class="check span-2"><input type="checkbox" id="dbg-ext"' + (r.extendedRemote ? ' checked' : '') + '> <span>${i18n.tr('使用 extended-remote 连接')}</span></label>' +
                    '<label class="check span-2" style="margin-top:0"><input type="checkbox" id="dbg-skip"' + (r.skipLDpath ? ' checked' : '') + '> <span>${i18n.tr('启动调试器前不要调整 LD_LIBRARY_PATH')}</span></label>' +
                  '</div>') +
                panel('gdb',
                  '<div class="form-grid">' +
                    '<label><span class="field-name">${i18n.tr('连接前命令（每行一条，任意调试均执行）')}</span><textarea id="dbg-before">' + esc(r.additionalCmdsBefore) + '</textarea></label>' +
                    '<label><span class="field-name">${i18n.tr('连接后命令（每行一条）')}</span><textarea id="dbg-after">' + esc(r.additionalCmds) + '</textarea></label>' +
                  '</div>') +
                panel('shell',
                  '<div class="form-grid">' +
                    '<label><span class="field-name">${i18n.tr('连接前 shell 命令（每行一条）')}</span><textarea id="dbg-before-shell">' + esc(r.additionalShellCmdsBefore) + '</textarea></label>' +
                    '<label><span class="field-name">${i18n.tr('连接后 shell 命令（每行一条）')}</span><textarea id="dbg-after-shell">' + esc(r.additionalShellCmdsAfter) + '</textarea></label>' +
                  '</div>') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>';
      document.getElementById('dbg-conn').value = String(r.connType);
      // 作用域列表：<Project> = 项目级默认（未单独配置的目标共用）
      el.querySelectorAll('#dbg-scope-list .tree-item').forEach(row => row.addEventListener('click', () => {
        collectDebugForm();
        selectedDebugScope = row.dataset.scope === '' ? '' : String(row.dataset.scope);
        renderDebugForm();
      }));
      // 子标签：远程连接 / 附加 GDB 命令 / 附加 shell 命令
      el.querySelectorAll('[data-dtab]').forEach(b => b.addEventListener('click', () => {
        collectDebugForm();
        dbgSubTab = b.dataset.dtab;
        renderDebugForm();
      }));
      // 搜索目录列表：添加 / 编辑 / 删除
      el.querySelectorAll('#dbg-paths-list .item').forEach(row => row.addEventListener('click', () => {
        selectedDbgPath = Number(row.dataset.i);
        renderDebugForm();
      }));
      document.getElementById('dbg-path-add').addEventListener('click', () => {
        askText('${i18n.tr('附加调试器搜索目录')}', '', v => {
          if (v && v.trim()) { dbg.searchPaths.push(v.trim()); selectedDbgPath = dbg.searchPaths.length - 1; renderDebugForm(); }
        });
      });
      document.getElementById('dbg-path-edit').addEventListener('click', () => {
        if (selectedDbgPath < 0) return;
        askText('${i18n.tr('附加调试器搜索目录')}', dbg.searchPaths[selectedDbgPath], v => {
          if (v !== null && v.trim()) { dbg.searchPaths[selectedDbgPath] = v.trim(); renderDebugForm(); }
        });
      });
      document.getElementById('dbg-path-del').addEventListener('click', () => {
        if (selectedDbgPath < 0) return;
        dbg.searchPaths.splice(selectedDbgPath, 1);
        selectedDbgPath = Math.min(selectedDbgPath, dbg.searchPaths.length - 1);
        renderDebugForm();
      });
      ['dbg-conn', 'dbg-serial', 'dbg-baud', 'dbg-ip', 'dbg-port', 'dbg-ext', 'dbg-skip', 'dbg-before', 'dbg-before-shell', 'dbg-after', 'dbg-after-shell'].forEach(id => {
        const f = document.getElementById(id);
        if (f) f.addEventListener('change', () => collectDebugForm());
      });
      syncEnabledStates();
    }
    function collectDebugForm() {
      if (!document.getElementById('dbg-conn')) return;
      const scopeTarget = selectedDebugScope === '' ? undefined : targets[Number(selectedDebugScope)];
      // 目标被删除后作用域索引可能失效：search_path 已由列表直接维护，跳过 remote 段
      if (selectedDebugScope !== '' && !scopeTarget) return;
      const cur = dbgRemoteFor(scopeTarget ? scopeTarget.title : '');
      cur.connType = Number(document.getElementById('dbg-conn').value) || 0;
      cur.serialPort = document.getElementById('dbg-serial').value.trim();
      cur.serialBaud = document.getElementById('dbg-baud').value.trim() || '115200';
      cur.ip = document.getElementById('dbg-ip').value.trim();
      cur.ipPort = document.getElementById('dbg-port').value.trim();
      cur.extendedRemote = document.getElementById('dbg-ext').checked;
      cur.skipLDpath = document.getElementById('dbg-skip').checked;
      cur.additionalCmdsBefore = document.getElementById('dbg-before').value;
      cur.additionalShellCmdsBefore = document.getElementById('dbg-before-shell').value;
      cur.additionalCmds = document.getElementById('dbg-after').value;
      cur.additionalShellCmdsAfter = document.getElementById('dbg-after-shell').value;
    }

    // ---- C/C++ parser options tab ----
    function renderParserForm() {
      const el = document.getElementById('pform');
      el.innerHTML =
        '<div class="fill-pane">' +
          '<div class="field-label">${i18n.tr('附加搜索路径：')}</div>' +
          '<div class="list fill-control" id="parser-list"></div>' +
          '<div class="plain-actions left">' +
            '<button id="parser-add">${i18n.tr('添加')}</button>' +
            '<button id="parser-edit">${i18n.tr('编辑')}</button>' +
            '<button id="parser-del">${i18n.tr('删除')}</button>' +
          '</div>' +
          '<div class="hint" style="margin-top:6px">${i18n.tr('写入 Extensions/code_completion/search_path；用于 C/C++ 解析与代码补全')}</div>' +
        '</div>';
      const list = document.getElementById('parser-list');
      list.innerHTML = parserPaths.length
        ? parserPaths.map((p, i) => '<div class="item' + (i === selectedParser ? ' selected' : '') + '" data-i="' + i + '"><span class="item-label">' + esc(p) + '</span></div>').join('')
        : '<div class="empty">${i18n.tr('（空）')}</div>';
      list.querySelectorAll('.item').forEach(row => {
        row.addEventListener('click', () => { selectedParser = Number(row.dataset.i); renderParserForm(); });
      });
      document.getElementById('parser-add').addEventListener('click', () => askText('${i18n.tr('添加搜索目录')}', '', v => { if (v) { parserPaths.push(v); selectedParser = parserPaths.length - 1; renderParserForm(); } }));
      document.getElementById('parser-edit').addEventListener('click', () => { if (selectedParser >= 0) askText('${i18n.tr('编辑搜索目录')}', parserPaths[selectedParser], v => { if (v !== null) { parserPaths[selectedParser] = v; renderParserForm(); } }); });
      document.getElementById('parser-del').addEventListener('click', () => { if (selectedParser >= 0) { parserPaths.splice(selectedParser, 1); selectedParser = Math.min(selectedParser, parserPaths.length - 1); renderParserForm(); } });
      syncEnabledStates();
    }
    let selectedParser = -1;

    // ---- Build target files ----
    let selectedTargetFile = 0;
    function renderTargetFileList() {
      const el = document.getElementById('tflist');
      if (!el) return;
      if (!targets.length) { el.innerHTML = '<div class="empty">${i18n.tr('（无构建目标）')}</div>'; return; }
      const title = targets[selected].title;
      el.innerHTML = files.length
        ? files.map((f, i) => {
            const checked = f.buildTargets.includes(title) ? ' checked' : '';
            return '<label class="item' + (i === selectedTargetFile ? ' selected' : '') + '" data-i="' + i + '" title="' + escAttr(f.relativeFilename) + '">' +
              '<input type="checkbox" data-fi="' + i + '"' + checked + '><span class="item-label">' + esc(f.relativeFilename) + '</span></label>';
          }).join('')
        : '<div class="empty">${i18n.tr('（无文件）')}</div>';
      el.querySelectorAll('.item').forEach(row => {
        row.addEventListener('click', ev => {
          if (ev.target && ev.target.tagName === 'INPUT') return;
          selectedTargetFile = Number(row.dataset.i); renderTargetFileList();
        });
      });
      el.querySelectorAll('input[data-fi]').forEach(cb => {
        cb.addEventListener('change', () => {
          const f = files[Number(cb.dataset.fi)];
          if (!f) return;
          const t = targets[selected].title;
          if (cb.checked) { if (!f.buildTargets.includes(t)) f.buildTargets.push(t); }
          else f.buildTargets = f.buildTargets.filter(x => x !== t);
        });
      });
      syncEnabledStates();
    }
    function toggleTargetFileChecks(on) {
      if (!targets.length) return;
      const t = targets[selected].title;
      files.forEach(f => {
        if (on === true) { if (!f.buildTargets.includes(t)) f.buildTargets.push(t); }
        else if (on === false) f.buildTargets = f.buildTargets.filter(x => x !== t);
        else {
          if (f.buildTargets.includes(t)) f.buildTargets = f.buildTargets.filter(x => x !== t);
          else f.buildTargets.push(t);
        }
      });
      renderTargetFileList();
    }
    document.getElementById('toggleChecks').addEventListener('click', () => toggleTargetFileChecks(undefined));
    document.getElementById('allOn').addEventListener('click', () => toggleTargetFileChecks(true));
    document.getElementById('allOff').addEventListener('click', () => toggleTargetFileChecks(false));
    document.getElementById('fileProps').addEventListener('click', () => openFileModal(selectedTargetFile));

    // ---- 通用输入/确认模态 ----
    function askText(title, initial, cb) {
      const wrap = document.createElement('div');
      wrap.className = 'bo-modal';
      wrap.innerHTML = '<div class="bo-modal-box"><div class="bo-modal-title"><span>' + esc(title) + '</span></div>' +
        '<div class="bo-modal-body"><input id="ask-text-input" type="text" value="' + escAttr(initial || '') + '" style="width:100%"></div>' +
        '<div class="bo-modal-actions"><button id="ask-cancel">${i18n.t('Cancel')}</button><button id="ask-ok" class="default">${i18n.t('OK')}</button></div></div>';
      document.body.appendChild(wrap);
      const input = wrap.querySelector('#ask-text-input');
      input.focus(); input.select();
      wrap.querySelector('#ask-cancel').addEventListener('click', () => wrap.remove());
      wrap.querySelector('#ask-ok').addEventListener('click', () => { const v = input.value; wrap.remove(); cb(v); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = input.value; wrap.remove(); cb(v); } if (e.key === 'Escape') wrap.remove(); });
    }

    function confirmBox(title, cb) {
      const wrap = document.createElement('div');
      wrap.className = 'bo-modal';
      wrap.innerHTML = '<div class="bo-modal-box"><div class="bo-modal-title"><span>' + esc(title) + '</span></div>' +
        '<div class="bo-modal-actions"><button id="confirm-cancel">${i18n.t('Cancel')}</button><button id="confirm-ok" class="default">${i18n.t('OK')}</button></div></div>';
      document.body.appendChild(wrap);
      wrap.querySelector('#confirm-cancel').addEventListener('click', () => wrap.remove());
      wrap.querySelector('#confirm-ok').addEventListener('click', () => { wrap.remove(); cb(); });
    }

    // ---- 平台选择（对齐 CB 的 Platforms ... 对话框） ----
    let platformScope = { kind: 'project', index: -1 };
    function openPlatformModal(kind, index) {
      platformScope = { kind, index };
      const p = kind === 'project' ? projSettings.platforms : targets[index].platforms;
      document.getElementById('plat-win').checked = !!(p & 4);
      document.getElementById('plat-unix').checked = !!(p & 2);
      document.getElementById('plat-mac').checked = !!(p & 1);
      document.getElementById('modal-platform').style.display = 'flex';
    }
    document.getElementById('plat-cancel').addEventListener('click', () => { document.getElementById('modal-platform').style.display = 'none'; });
    document.getElementById('plat-ok').addEventListener('click', () => {
      const p = (document.getElementById('plat-win').checked ? 4 : 0) | (document.getElementById('plat-unix').checked ? 2 : 0) | (document.getElementById('plat-mac').checked ? 1 : 0);
      if (platformScope.kind === 'project') projSettings.platforms = p; else targets[platformScope.index].platforms = p;
      document.getElementById('modal-platform').style.display = 'none';
      renderSettingsForm(); renderForm();
    });

    // 模态右上角 ×（build options 同款 .bo-modal-x）
    document.querySelectorAll('[data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const modal = document.getElementById(btn.dataset.closeModal);
        if (!modal) return;
        if (modal.id === 'modal-vtargets') collectVTForm();
        if (modal.id === 'modal-files') { collectFileForm(); renderTargetFileList(); }
        modal.style.display = 'none';
      });
    });

    // ---- 虚拟目标模态 ----
    document.getElementById('virtualTargets').addEventListener('click', () => { collectTargetForm(); renderVTList(); renderVTForm(); document.getElementById('modal-vtargets').style.display = 'flex'; });
    document.getElementById('vt-close').addEventListener('click', () => { collectVTForm(); document.getElementById('modal-vtargets').style.display = 'none'; });

    // ---- 外部依赖模态 ----
    document.getElementById('externalDeps').addEventListener('click', () => {
      if (!targets.length) return;
      collectTargetForm();
      const t = targets[selected];
      document.getElementById('ext-deps').value = (t.externalDeps || []).join('\\n');
      document.getElementById('ext-outs').value = (t.additionalOutput || []).join('\\n');
      document.getElementById('modal-external').style.display = 'flex';
    });
    document.getElementById('ext-cancel').addEventListener('click', () => { document.getElementById('modal-external').style.display = 'none'; });
    document.getElementById('ext-ok').addEventListener('click', () => {
      const t = targets[selected];
      t.externalDeps = optionsLines(document.getElementById('ext-deps').value);
      t.additionalOutput = optionsLines(document.getElementById('ext-outs').value);
      document.getElementById('modal-external').style.display = 'none';
      renderForm();
    });

    // ---- 目标重排模态 ----
    let reorderDraft = [];
    let reorderSelected = 0;
    document.getElementById('reorderTargets').addEventListener('click', () => {
      collectTargetForm();
      reorderDraft = targets.map((t, i) => ({ ...t, _index: i }));
      reorderSelected = 0;
      renderReorder();
      document.getElementById('modal-reorder').style.display = 'flex';
    });
    function renderReorder() {
      const el = document.getElementById('reorder-list');
      el.innerHTML = reorderDraft.map((t, i) => '<div class="item' + (i === reorderSelected ? ' selected' : '') + '" data-i="' + i + '"><span class="item-label">' + esc(t.title) + '</span></div>').join('');
      el.querySelectorAll('.item').forEach(row => row.addEventListener('click', () => { reorderSelected = Number(row.dataset.i); renderReorder(); }));
    }
    document.getElementById('reorder-up').addEventListener('click', () => {
      if (reorderSelected <= 0) return;
      const x = reorderDraft[reorderSelected - 1]; reorderDraft[reorderSelected - 1] = reorderDraft[reorderSelected]; reorderDraft[reorderSelected] = x;
      reorderSelected--; renderReorder();
    });
    document.getElementById('reorder-down').addEventListener('click', () => {
      if (reorderSelected < 0 || reorderSelected >= reorderDraft.length - 1) return;
      const x = reorderDraft[reorderSelected + 1]; reorderDraft[reorderSelected + 1] = reorderDraft[reorderSelected]; reorderDraft[reorderSelected] = x;
      reorderSelected++; renderReorder();
    });
    document.getElementById('reorder-cancel').addEventListener('click', () => { document.getElementById('modal-reorder').style.display = 'none'; });
    document.getElementById('reorder-ok').addEventListener('click', () => {
      const order = reorderDraft.map(x => x._index);
      const newTargets = order.map(i => targets[i]);
      const newTargetOpts = order.map(i => targetOpts[i]);
      const newDirs = order.map(i => targetDirs[i]);
      const newScripts = order.map(i => targetScripts[i]);
      targets = newTargets; targetOpts = newTargetOpts; targetDirs = newDirs; targetScripts = newScripts;
      selected = 0; selectedTargetFile = 0;
      document.getElementById('modal-reorder').style.display = 'none';
      renderList(); renderForm(); renderTargetFileList();
    });

    // ---- 目标重命名 ----
    document.getElementById('renameTarget').addEventListener('click', () => {
      if (!targets.length) return;
      collectTargetForm();
      const oldTitle = targets[selected].title;
      askText('${i18n.tr('重命名构建目标')}', oldTitle, v => {
        const title = String(v || '').trim();
        if (!title || title === oldTitle) return;
        targets[selected].title = title;
        files.forEach(f => { if (f.buildTargets.includes(oldTitle)) f.buildTargets = f.buildTargets.map(x => x === oldTitle ? title : x); });
        virtualTargets.forEach(vt => { vt.targets = vt.targets.map(x => x === oldTitle ? title : x); });
        dbg.remote.forEach(r => { if (r.target === oldTitle) r.target = title; });
        renderList(); renderForm(); renderTargetFileList();
      });
    });

    // ---- 文件属性模态 ----
    function openFileModal(index) {
      if (!files.length) return;
      selectedFile = Math.max(0, Math.min(index || 0, files.length - 1));
      renderFileList(); renderFileForm();
      document.getElementById('modal-files').style.display = 'flex';
      // 由「文件 → 属性」直达时列表可能已滚动到别处：选中行滚入可视区（不可见时无效，故放在显示之后）
      const selectedRow = document.querySelector('#flist .item.selected');
      if (selectedRow && selectedRow.scrollIntoView) selectedRow.scrollIntoView({ block: 'nearest' });
    }
    document.getElementById('ff-close').addEventListener('click', () => { collectFileForm(); document.getElementById('modal-files').style.display = 'none'; renderTargetFileList(); });

    // ---- Build options 覆盖层 ----
    function boScopeFrom(o, d, s, t, settings, title, compilerId, linkerExecutable) {
      return {
        title: title,
        compilerId: compilerId,
        compilerOptions: [...o.compilerOptions],
        resourceCompilerOptions: [...(o.resourceCompilerOptions || [])],
        linkerOptions: [...o.linkerOptions],
        linkLibs: [...o.linkLibs],
        linkerExecutable: linkerExecutable || 0,
        relations: { ...(o.relations || { compiler: 3, linker: 3, include: 3, lib: 3, res: 3 }) },
        includeDirs: [...d.includeDirs],
        libDirs: [...d.libDirs],
        resourceDirs: [...d.resourceDirs],
        commandsBefore: [...s.before],
        commandsAfter: [...s.after],
        alwaysPost: !!s.always,
        envVars: (settings.envVars || []).map(v => ({ name: v.name, value: v.value })),
        makeCommands: { ...(settings.makeCommands || {}) },
        // 扩展字段（CB project_options 无对应控件）：原先在 Properties「高级（扩展）」，现由 Build options 扩展页编辑
        depsOutput: settings.depsOutput || '',
        externalDeps: [...(settings.externalDeps || [])],
        additionalOutput: [...(settings.additionalOutput || [])],
        hostApplication: settings.hostApplication || '',
        runHostApplicationInTerminal: settings.runHostApplicationInTerminal !== false
      };
    }
    function buildOptionsBootstrap() {
      return {
        projectTitle: projSettings.title,
        makefileIsCustom: projSettings.makefileIsCustom === true,
        defineSwitch: boRuntime.defineSwitch || '-D',
        project: boScopeFrom(projOpts, projDirs, projScripts, undefined, projSettings, projSettings.title, projSettings.compilerId, 0),
        targets: targets.map((t, i) => boScopeFrom(targetOpts[i], targetDirs[i], targetScripts[i], t, t, t.title, t.compilerId, t.linkerExecutable)),
        compilers: boRuntime.compilers || [],
        compilerCatalogs: boRuntime.compilerCatalogs || {},
        compilerBaseCatalogs: boRuntime.compilerBaseCatalogs || {},
        compilerFlags: boRuntime.compilerFlags || {},
        defaultCompilerId: boRuntime.defaultCompilerId || '',
        customVariables: (projSettings.customVariables || []).map(v => ({ name: v.name, value: v.value }))
      };
    }
    function applyBuildOptions(bo) {
      if (!bo) return;
      projOpts.compilerOptions = [...bo.project.compilerOptions];
      projOpts.linkerOptions = [...bo.project.linkerOptions];
      projOpts.linkLibs = [...bo.project.linkLibs];
      projOpts.resourceCompilerOptions = [...(bo.project.resourceCompilerOptions || [])];
      projDirs.includeDirs = [...bo.project.includeDirs];
      projDirs.libDirs = [...bo.project.libDirs];
      projDirs.resourceDirs = [...bo.project.resourceDirs];
      projScripts.before = [...bo.project.commandsBefore];
      projScripts.after = [...bo.project.commandsAfter];
      projScripts.always = !!bo.project.alwaysPost;
      projSettings.compilerId = bo.project.compilerId;
      projSettings.envVars = (bo.project.envVars || []).map(v => ({ ...v }));
      projSettings.makeCommands = { ...(bo.project.makeCommands || {}) };
      if (bo.customVariables) projSettings.customVariables = bo.customVariables.map(v => ({ name: v.name, value: v.value }));
      // 覆盖层里编辑过的编译器参数目录/语言参数要回写到本面板的运行时副本，
      // 否则关闭后重新打开会拿到最初的数据（新增/删除的参数看起来"丢了"）
      if (bo.compilerCatalogs) boRuntime.compilerCatalogs = bo.compilerCatalogs;
      if (bo.compilerBaseCatalogs) boRuntime.compilerBaseCatalogs = bo.compilerBaseCatalogs;
      if (bo.compilerFlags) boRuntime.compilerFlags = bo.compilerFlags;
      if (bo.defaultCompilerId) boRuntime.defaultCompilerId = bo.defaultCompilerId;
      (bo.targets || []).forEach((t, i) => {
        if (!targets[i]) return;
        targets[i].compilerId = t.compilerId;
        targets[i].linkerExecutable = t.linkerExecutable;
        targets[i].envVars = (t.envVars || []).map(v => ({ ...v }));
        targets[i].makeCommands = { ...(t.makeCommands || {}) };
        // 扩展字段（Build options 扩展页 / 自定义变量页）
        if (t.depsOutput !== undefined) targets[i].depsOutput = t.depsOutput;
        if (t.externalDeps) targets[i].externalDeps = [...t.externalDeps];
        if (t.additionalOutput) targets[i].additionalOutput = [...t.additionalOutput];
        if (t.hostApplication !== undefined) targets[i].hostApplication = t.hostApplication;
        if (t.runHostApplicationInTerminal !== undefined) targets[i].runHostApplicationInTerminal = t.runHostApplicationInTerminal !== false;
        targetOpts[i].compilerOptions = [...t.compilerOptions];
        targetOpts[i].linkerOptions = [...t.linkerOptions];
        targetOpts[i].linkLibs = [...t.linkLibs];
        targetOpts[i].resourceCompilerOptions = [...(t.resourceCompilerOptions || [])];
        targetOpts[i].relations = { ...t.relations };
        targetDirs[i].includeDirs = [...t.includeDirs];
        targetDirs[i].libDirs = [...t.libDirs];
        targetDirs[i].resourceDirs = [...t.resourceDirs];
        targetScripts[i].before = [...t.commandsBefore];
        targetScripts[i].after = [...t.commandsAfter];
        targetScripts[i].always = !!t.alwaysPost;
      });
      renderForm(); renderTargetFileList();
      if (document.getElementById('set-title')) renderSettingsForm();
      if (activeTab === 'scripts') renderScriptsForm();
    }
    function openBuildOptions(scope) {
      if (!window.cbBuildOptions) return;
      collectTargetForm();
      collectSettingsForm();
      window.cbBuildOptions.open(buildOptionsBootstrap(), scope == null ? 'project' : scope);
    }
    document.getElementById('targetBuildOptions').addEventListener('click', () => { if (targets.length) openBuildOptions(String(selected)); });
    document.getElementById('bo-overlay').addEventListener('click', e => {
      if (e.target && e.target.id === 'bo-overlay') { window.cbBuildOptions && window.cbBuildOptions.close(); applyBuildOptions(window.cbBuildOptions && window.cbBuildOptions.read()); }
    });

    // ---- 保存 ----
    function setStatus(text) {
      const el = document.getElementById('status');
      if (!el) return;
      el.textContent = text;
      // 窄面板下状态区会省略号截断：悬停看完整原因
      el.title = text;
    }

    function doSave(close) {
      // 收集阶段任何异常都要可见：否则点击「保存」毫无反应（曾因未渲染 tab 的 collect 抛错而静默失败）
      try {
        if (window.cbBuildOptions && window.cbBuildOptions.isOpen()) {
          applyBuildOptions(window.cbBuildOptions.read());
        }
        collectTargetForm();
        collectVTForm();
        collectFileForm();
        collectOptionsForm();
        collectDirsForm();
        collectScriptsForm();
        collectSettingsForm();
        collectNotesForm();
        collectDebugForm();
        projSettings.codeCompletionSearchPaths = [...parserPaths];
      } catch (err) {
        setStatus('${i18n.tr('保存失败:')}' + ' ' + (err && err.message ? err.message : err));
        return;
      }
      vscode.postMessage({
        type: 'save',
        targets: targets,
        files: files,
        options: { project: projOpts, targets: targetOpts },
        searchDirs: { project: projDirs, targets: targetDirs },
        buildScripts: { project: projScripts, targets: targetScripts },
        projectSettings: projSettings,
        notes: notes,
        virtualTargets: virtualTargets,
        debuggerSettings: { searchPaths: dbg.searchPaths, remote: dbg.remote },
        close: close,
      });
    }
    document.getElementById('save').addEventListener('click', () => doSave(false));
    document.getElementById('saveClose').addEventListener('click', () => doSave(true));

    // ---- 还原设置（对齐 Build options 同名按钮：丢弃未保存修改，回到上次保存的内容） ----
    function snapshotDrafts() {
      return JSON.parse(JSON.stringify({
        targets, files,
        projOpts, targetOpts, projDirs, targetDirs,
        projSettings, projScripts, targetScripts,
        notes, virtualTargets, dbg, parserPaths,
      }));
    }
    let restoreBaseline = null;
    function applyDrafts(b) {
      targets = b.targets;
      files = b.files;
      projOpts = b.projOpts;
      targetOpts = b.targetOpts;
      projDirs = b.projDirs;
      targetDirs = b.targetDirs;
      projSettings = b.projSettings;
      projScripts = b.projScripts;
      targetScripts = b.targetScripts;
      notes = b.notes;
      virtualTargets = b.virtualTargets;
      dbg = b.dbg;
      parserPaths = b.parserPaths;
      if (selected >= targets.length) selected = Math.max(0, targets.length - 1);
      if (selectedFile >= files.length) selectedFile = Math.max(0, files.length - 1);
      if (selectedVT >= virtualTargets.length) selectedVT = Math.max(0, virtualTargets.length - 1);
    }
    function restoreSettings() {
      if (!restoreBaseline) return;
      confirmBox('${i18n.t('Discard unsaved changes and restore the saved settings?')}', () => {
        applyDrafts(JSON.parse(JSON.stringify(restoreBaseline)));
        renderList(); renderForm(); renderTargetFileList();
        renderVTList(); renderScriptsForm(); renderSettingsForm(); renderNotesForm(); renderParserForm(); renderDebugForm();
        setStatus('${i18n.t('Settings restored')}');
      });
    }
    document.getElementById('restore').addEventListener('click', restoreSettings);
    setTimeout(() => { restoreBaseline = snapshotDrafts(); }, 0);

    window.addEventListener('message', e => {
      if (e.data.type === 'saved') {
        setStatus('${i18n.tr('已保存 ✔️')}');
        restoreBaseline = snapshotDrafts();
      } else if (e.data.type === 'error') {
        setStatus('${i18n.tr('保存失败:')}' + ' ' + e.data.message);
      } else if (e.data.type === 'browseResult') {
        const el = document.getElementById(e.data.target);
        if (el) el.value = e.data.value;
      } else if (e.data.type === 'scriptsSelected') {
        const cur = scriptScope();
        (e.data.scripts || []).forEach(s => { if (!cur.scripts.includes(s)) cur.scripts.push(s); });
        renderScriptsForm();
      } else if (e.data.type === 'scriptValidation') {
        const st = document.getElementById('scr-status');
        const results = e.data.results || [];
        const errors = results.filter(r => !r.ok);
        if (st) st.textContent = errors.length
          ? errors.map(r => r.scope + ': ' + r.file + ':' + r.line + ':' + r.column + ' ' + r.message).join('\\n')
          : '${i18n.tr('所有脚本校验通过 ✔️')}';
      }
    });

    renderList(); renderForm();
    renderVTList();
    renderFileList();
    renderTargetFileList();
    // M3：定位文件（选中后打开文件属性模态）
    if (focusFile) {
      const fi = files.findIndex(f => f.relativeFilename === focusFile);
      if (fi >= 0) {
        selectedFile = fi;
        selectedTargetFile = fi;
        renderFileList();
        renderTargetFileList();
        openFileModal(fi);
      }
    }
    switchTab(activeTab);
    // Build options 覆盖层的关闭按钮由共享脚本动态重建：用事件委托保证每次关闭都回写草稿
    document.addEventListener('click', e => {
      const target = e.target;
      if (target && target.id === 'bo-close') {
        const api = window.cbBuildOptions;
        if (api) { api.close(); applyBuildOptions(api.read()); }
      }
    }, true);
  </script>
  <script>${buildOptionsScript(initialBoData, true)}</script>
</body>
</html>`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private async onMessage(msg: any): Promise<void> {
    // Build options 覆盖层：参数编辑 / 仅 C·C++ 参数
    if (
      msg.type === 'flagAdd' ||
      msg.type === 'flagUpdate' ||
      msg.type === 'flagDelete' ||
      msg.type === 'languageFlags'
    ) {
      const compilerId = String(msg.compilerId ?? '');
      if (!compilerId) return;
      const base = this.buildOptionsRuntime?.compilerBaseCatalogs?.[compilerId] ?? [];
      let error: string | undefined;
      if (msg.type === 'languageFlags') {
        const cOnly = Array.isArray(msg.cOnly) ? msg.cOnly.map((x: any) => String(x)) : [];
        const cppOnly = Array.isArray(msg.cppOnly) ? msg.cppOnly.map((x: any) => String(x)) : [];
        error = await writeLanguageFlags(compilerId, cOnly, cppOnly);
        if (!error && this.buildOptionsRuntime) {
          this.buildOptionsRuntime.compilerFlags = this.buildOptionsRuntime.compilerFlags ?? {};
          this.buildOptionsRuntime.compilerFlags[compilerId] = { cOnly, cppOnly };
        }
      } else {
        error = await applyFlagAction(
          { type: msg.type, compilerId, flag: msg.flag, original: msg.original },
          base,
        );
        if (this.buildOptionsRuntime?.compilerCatalogs) {
          this.buildOptionsRuntime.compilerCatalogs[compilerId] = buildCompilerCatalog(compilerId, base);
        }
      }
      const flags = this.buildOptionsRuntime?.compilerFlags?.[compilerId] ?? { cOnly: [], cppOnly: [] };
      this.panel.webview.postMessage({
        type: 'compilerFlags',
        compilerId,
        catalog: this.buildOptionsRuntime?.compilerCatalogs?.[compilerId] ?? base,
        cOnly: flags.cOnly,
        cppOnly: flags.cppOnly,
        error,
      });
      return;
    }
    // R9：导出选中目标为独立工程（宿主命令）
    if (msg.type === 'exportTarget') {
      await vscode.commands.executeCommand('codeblocks.exportTargetAsProject', String(msg.target ?? ''), this.project.filename);
      return;
    }
    if (msg.type === 'editDependencies') {
      await vscode.commands.executeCommand('codeblocks.workspace.editDependencies', this.project.filename);
      return;
    }
    if (msg.type === 'browse') {
      const kind = String(msg.kind ?? 'folder');
      const target = String(msg.target ?? '');
      const current = String(msg.value ?? '');
      const base = path.isAbsolute(current) ? current : path.join(this.project.basePath, current || '.');
      const uris = kind === 'file'
        ? await vscode.window.showOpenDialog({ canSelectMany: false, defaultUri: vscode.Uri.file(base), openLabel: i18n.t('Select') })
        : await vscode.window.showOpenDialog({ canSelectMany: false, canSelectFiles: false, canSelectFolders: true, defaultUri: vscode.Uri.file(base), openLabel: i18n.t('Select') });
      if (uris?.length) {
        let value = uris[0].fsPath;
        if (path.isAbsolute(value) && value.startsWith(this.project.basePath)) {
          value = path.relative(this.project.basePath, value).replace(/\\/g, '/');
        }
        this.panel.webview.postMessage({ type: 'browseResult', target, value });
      }
      return;
    }
    if (msg.type === 'browseScripts') {
      const uris = await vscode.window.showOpenDialog({
        canSelectMany: true,
        defaultUri: vscode.Uri.file(this.project.basePath),
        filters: { [i18n.t('Script files')]: ['script'] },
        openLabel: i18n.t('Add'),
      });
      if (uris?.length) {
        const values = uris.map((u) => path.relative(this.project.basePath, u.fsPath).replace(/\\/g, '/'));
        this.panel.webview.postMessage({ type: 'scriptsSelected', scripts: values });
      }
      return;
    }
    if (msg.type === 'validateScripts') {
      const items: Array<{ scope: string; file: string }> = Array.isArray(msg.scripts)
        ? msg.scripts.map((s: any) => ({ scope: String(s?.scope ?? ''), file: String(s?.file ?? '') }))
        : [];
      const results = items.map((it) => validateProjectScript(this.project, it.scope, it.file));
      this.panel.webview.postMessage({ type: 'scriptValidation', results });
      return;
    }
    if (msg.type === 'save') {
      const targets: TargetEditData[] = (msg.targets ?? []).map((t: any) => ({
        originalTitle: String(t.originalTitle ?? ''),
        title: String(t.title ?? ''),
        targetType: Number(t.targetType ?? 0),
        outputFilename: String(t.outputFilename ?? ''),
        objectOutput: String(t.objectOutput ?? ''),
        compilerId: String(t.compilerId ?? this.project.compilerId),
        executionParameters: String(t.executionParameters ?? ''),
        externalDeps: Array.isArray(t.externalDeps) ? t.externalDeps.map((x: any) => String(x)) : [],
        additionalOutput: Array.isArray(t.additionalOutput) ? t.additionalOutput.map((x: any) => String(x)) : [],
        envVars: Array.isArray(t.envVars)
          ? t.envVars
              .map((v: any) => ({ name: String(v?.name ?? '').trim(), value: String(v?.value ?? '') }))
              .filter((v: any) => v.name)
          : [],
        workingDir: String(t.workingDir ?? ''),
        depsOutput: String(t.depsOutput ?? ''),
        platforms: Number.isFinite(Number(t.platforms)) ? Number(t.platforms) : 255,
        hostApplication: String(t.hostApplication ?? ''),
        runHostApplicationInTerminal: t.runHostApplicationInTerminal !== false,
        useConsoleRunner: t.useConsoleRunner !== false,
        impLib: String(t.impLib ?? ''),
        defFile: String(t.defFile ?? ''),
        createDefFile: t.createDefFile === true,
        createStaticLib: t.createStaticLib === true,
        prefixAuto: t.prefixAuto !== false,
        extensionAuto: t.extensionAuto !== false,
        linkerExecutable: Number(t.linkerExecutable ?? 0),
        makeCommands: t.makeCommands && typeof t.makeCommands === 'object' ? { ...t.makeCommands } : {},
      }));
      const files: FileEditData[] = (msg.files ?? []).map((f: any) => ({
        relativeFilename: String(f.relativeFilename ?? ''),
        compilerVar: String(f.compilerVar ?? ''),
        compile: f.compile !== false,
        link: f.link !== false,
        buildTargets: Array.isArray(f.buildTargets) ? f.buildTargets.map((x: any) => String(x)) : [],
        buildCommand: String(f.buildCommand ?? '').replace(/\\n/g, '\n'),
        weight: Number(f.weight) || 50,
        virtualFolder: String(f.virtualFolder ?? ''),
      }));
      const strArr = (v: any): string[] => (Array.isArray(v) ? v.map((x: any) => String(x)) : []);
      const opts = (o: any) => ({
        compilerOptions: strArr(o?.compilerOptions),
        linkerOptions: strArr(o?.linkerOptions),
        linkLibs: strArr(o?.linkLibs),
        resourceCompilerOptions: strArr(o?.resourceCompilerOptions),
      });
      const options: BuildOptionsEditData = {
        project: opts(msg.options?.project),
        targets: Array.isArray(msg.options?.targets) ? msg.options.targets.map((o: any) => ({
          ...opts(o),
          relations: {
            compiler: Number(o?.relations?.compiler ?? 3),
            linker: Number(o?.relations?.linker ?? 3),
            include: Number(o?.relations?.include ?? 3),
            lib: Number(o?.relations?.lib ?? 3),
            res: Number(o?.relations?.res ?? 3),
          },
        })) : [],
      };
      const dirs = (o: any) => ({
        includeDirs: strArr(o?.includeDirs),
        libDirs: strArr(o?.libDirs),
        resourceDirs: strArr(o?.resourceDirs),
      });
      const searchDirs: SearchDirsEditData = {
        project: dirs(msg.searchDirs?.project),
        targets: Array.isArray(msg.searchDirs?.targets) ? msg.searchDirs.targets.map((o: any) => dirs(o)) : [],
      };
      const projectSettings: ProjectSettingsEditData = {
        title: String(msg.projectSettings?.title ?? this.project.title),
        compilerId: String(msg.projectSettings?.compilerId ?? this.project.compilerId),
        virtualFolders: strArr(msg.projectSettings?.virtualFolders),
        customVariables: Array.isArray(msg.projectSettings?.customVariables)
          ? msg.projectSettings.customVariables
              .map((v: any) => ({ name: String(v?.name ?? '').trim(), value: String(v?.value ?? '') }))
              .filter((v: any) => v.name)
          : [],
        envVars: Array.isArray(msg.projectSettings?.envVars)
          ? msg.projectSettings.envVars
              .map((v: any) => ({ name: String(v?.name ?? '').trim(), value: String(v?.value ?? '') }))
              .filter((v: any) => v.name)
          : [],
        platforms: Number.isFinite(Number(msg.projectSettings?.platforms)) ? Number(msg.projectSettings?.platforms) : 255,
        pchMode: [0, 1, 2].includes(Number(msg.projectSettings?.pchMode)) ? Number(msg.projectSettings?.pchMode) : 1,
        extendedObjNames: msg.projectSettings?.extendedObjNames === true,
        makefileIsCustom: msg.projectSettings?.makefileIsCustom === true,
        makefile: String(msg.projectSettings?.makefile ?? ''),
        executionDir: String(msg.projectSettings?.executionDir ?? ''),
        checkForExternallyModifiedFiles: msg.projectSettings?.checkForExternallyModifiedFiles !== false,
        codeCompletionSearchPaths: strArr(msg.projectSettings?.codeCompletionSearchPaths),
        makeCommands: msg.projectSettings?.makeCommands && typeof msg.projectSettings.makeCommands === 'object'
          ? { ...msg.projectSettings.makeCommands }
          : {},
      };
      const scriptItem = (o: any) => ({
        scripts: strArr(o?.scripts),
        before: strArr(o?.before),
        after: strArr(o?.after),
        always: o?.always === true,
      });
      const buildScripts: BuildScriptsEditData = {
        project: scriptItem(msg.buildScripts?.project),
        targets: Array.isArray(msg.buildScripts?.targets) ? msg.buildScripts.targets.map((s: any) => scriptItem(s)) : [],
      };
      const notes: NotesEditData = {
        notes: String(msg.notes?.notes ?? ''),
        showNotesOnLoad: msg.notes?.showNotesOnLoad === true,
      };
      const virtualTargets: VirtualTargetEditData[] = (msg.virtualTargets ?? []).map((v: any) => ({
        originalAlias: String(v.originalAlias ?? ''),
        alias: String(v.alias ?? ''),
        targets: Array.isArray(v.targets) ? v.targets.map((x: any) => String(x)) : [],
      }));
      const remoteItem = (r: any): RemoteDebuggingEditData => ({
        target: String(r?.target ?? ''),
        connType: Number(r?.connType ?? 0) || 0,
        serialPort: String(r?.serialPort ?? ''),
        serialBaud: String(r?.serialBaud ?? '').trim() || '115200',
        ip: String(r?.ip ?? ''),
        ipPort: String(r?.ipPort ?? ''),
        additionalCmds: String(r?.additionalCmds ?? ''),
        additionalCmdsBefore: String(r?.additionalCmdsBefore ?? ''),
        additionalShellCmdsAfter: String(r?.additionalShellCmdsAfter ?? ''),
        additionalShellCmdsBefore: String(r?.additionalShellCmdsBefore ?? ''),
        skipLDpath: r?.skipLDpath === true,
        extendedRemote: r?.extendedRemote === true,
      });
      const debuggerSettings: DebuggerSettingsEditData = {
        searchPaths: strArr(msg.debuggerSettings?.searchPaths),
        remote: Array.isArray(msg.debuggerSettings?.remote) ? msg.debuggerSettings.remote.map(remoteItem) : [],
      };
      try {
        await this.onSave(targets, files, options, searchDirs, projectSettings, buildScripts, notes, virtualTargets, debuggerSettings);
        this.panel.webview.postMessage({ type: 'saved' });
        if (msg.close) {
          this.dispose();
        }
      } catch (err) {
        this.panel.webview.postMessage({ type: 'error', message: (err as Error).message });
      }
    }
  }

  private dispose(): void {
    ProjectPropertiesPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()!.dispose();
    }
  }
}
