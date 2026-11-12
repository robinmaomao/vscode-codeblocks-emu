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
    }));
    const initialBoData: BuildOptionsData = {
      projectTitle: this.project.title,
      makefileIsCustom: this.project.makefileIsCustom === true,
      defineSwitch: boRuntime.defineSwitch,
      project: boProjectScope,
      targets: boTargetScopes,
      compilers: boRuntime.compilers,
      compilerCatalogs: boRuntime.compilerCatalogs,
    };

    const data = JSON.stringify({
      title: this.project.title,
      compilerId: cmp,
      filename: this.project.filename,
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
      padding: 9px 16px 8px; flex-shrink: 0;
      border-bottom: 1px solid var(--cb-border);
      background: var(--vscode-sideBarSectionHeader-background, var(--cb-surface));
    }
    .project-title { font-size: 15px; font-weight: 600; line-height: 20px; }
    .project-subtitle {
      font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 1px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* 主体：顶部页签 + 内容区（对齐 CB ProjectOptionsDlg） */
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; min-height: 0; }
    .tabs {
      display: flex; flex-direction: row; gap: 2px; flex-shrink: 0;
      overflow-x: auto; overflow-y: hidden; padding: 0 12px;
      border-right: none; border-bottom: 1px solid var(--cb-border);
      background: var(--vscode-editor-background); scrollbar-width: thin;
    }
    .tabs::-webkit-scrollbar { height: 4px; }
    .tabs::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(128,128,128,.45)); border-radius: 2px; }
    .tab {
      display: flex; align-items: center; gap: 7px;
      background: transparent; color: var(--vscode-descriptionForeground);
      border: none; border-bottom: 2px solid transparent;
      padding: 10px 10px 8px; border-radius: 0; cursor: pointer;
      font-size: 12px; line-height: 16px; white-space: nowrap; text-align: left;
    }
    .tab:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
    .tab:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; background: transparent; }
    .tab-icon { display: inline-flex; width: 16px; height: 16px; flex: none; opacity: .9; }
    /* 内容区 */
    .content { flex: 1; overflow-y: auto; min-width: 0; }
    .tab-pane { width: 100%; max-width: 1100px; margin: 0 auto; padding: 16px 20px 28px; box-sizing: border-box; }
    .layout { display: grid; grid-template-columns: minmax(200px, 260px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .targets-layout { display: grid; grid-template-columns: minmax(280px, 320px) minmax(0, 1fr); gap: 16px; align-items: start; }
    .targets-column { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
    .targets-main { min-width: 0; }
    .targets-files { grid-column: 1 / -1; }
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
    @media (max-width: 760px) {
      .targets-layout, .layout { grid-template-columns: minmax(0, 1fr); }
      .form-grid { grid-template-columns: minmax(0, 1fr); }
      .form-grid > .span-2 { grid-column: auto; }
      .tab-pane { padding: 12px 14px 22px; }
      .project-subtitle { display: none; }
      .modal .layout, .modal .form-grid { grid-template-columns: minmax(0, 1fr); }
      .modal { padding: 12px; }
    }
    @media (prefers-reduced-motion: reduce) {
      * { transition: none !important; }
    }
  </style>
</head>
<body>
  <div class="project-header">
    <div class="project-title">${this.escapeHtml(this.project.title)}</div>
    <div class="project-subtitle">${this.escapeHtml(this.project.filename)}</div>
  </div>
  <div class="toolbar">
    <button id="save" class="primary">${i18n.t('Save')}</button>
    <button id="saveClose">${i18n.t('Save and Close')}</button>
    <select id="targetSwitch" title="${i18n.t('Quick switch to this target')}" style="max-width:240px;width:auto"></select>
    <span id="status"></span>
  </div>
  <div class="main">
    <nav class="tabs">
      <button class="tab active" data-tab="settings" id="tabbtn-settings"><span class="tab-icon">${ICONS.settings}</span>${i18n.t('Project settings')}</button>
      <button class="tab" data-tab="targets" id="tabbtn-targets"><span class="tab-icon">${ICONS.target}</span>${i18n.t('Build targets')}</button>
      <button class="tab" data-tab="scripts" id="tabbtn-scripts"><span class="tab-icon">${ICONS.settings}</span>${i18n.t('Build scripts')}</button>
      <button class="tab" data-tab="notes" id="tabbtn-notes"><span class="tab-icon">${ICONS.file}</span>${i18n.t('Notes')}</button>
      <button class="tab" data-tab="parser" id="tabbtn-parser"><span class="tab-icon">${ICONS.options}</span>${i18n.t('C/C++ parser options')}</button>
      <button class="tab" data-tab="debugger" id="tabbtn-debugger"><span class="tab-icon">${ICONS.options}</span>${i18n.t('Debugger')}</button>
    </nav>
    <div class="content">
      <div id="tab-settings" class="tab-pane">
        <div class="form" id="sform"></div>
      </div>
      <div id="tab-targets" class="tab-pane" style="display:none">
        <div class="targets-layout">
          <section class="card">
            <div class="card-header"><span class="card-title">${i18n.t('Build targets')}</span><span class="card-subtitle" id="target-count"></span></div>
            <div class="card-body">
              <div class="list" id="list"></div>
              <div class="list-actions">
                <button id="add" class="primary" title="${i18n.tr('添加目标')}">${i18n.tr('添加')}</button>
                <button id="renameTarget" title="${i18n.tr('重命名选中目标')}">${i18n.tr('重命名')}</button>
                <button id="copy" title="${i18n.tr('复制选中目标')}">${i18n.tr('复制')}</button>
                <button id="remove" class="danger" title="${i18n.tr('删除选中目标')}">${i18n.tr('删除')}</button>
                <button id="up" class="icon" title="${i18n.tr('上移选中目标')}">↑</button>
                <button id="down" class="icon" title="${i18n.tr('下移选中目标')}">↓</button>
              </div>
              <div class="list-actions">
                <button id="virtualTargets" title="${i18n.tr('虚拟目标…')}">${i18n.tr('虚拟目标…')}</button>
                <button id="externalDeps" title="${i18n.tr('外部依赖与附加输出…')}">${i18n.tr('依赖…')}</button>
                <button id="reorderTargets" title="${i18n.tr('重排目标顺序…')}">${i18n.tr('重排…')}</button>
                <button id="targetBuildOptions" title="${i18n.tr('目标构建选项…')}">${i18n.tr('构建选项…')}</button>
                <button id="exportTarget" title="${i18n.tr('把选中目标导出为独立工程（对齐 CB Create project from target）')}">${i18n.tr('从目标创建工程…')}</button>
              </div>
            </div>
          </section>
          <section class="card targets-main">
            <div class="card-header">${i18n.t('Build target options')}</div>
            <div class="card-body"><div class="form" id="form"></div></div>
          </section>
          <section class="card targets-files">
            <div class="card-header">
              <span class="card-title">${i18n.t('Build target files:')}</span>
              <span class="card-subtitle" id="file-count"></span>
            </div>
            <div class="card-body">
              <div class="list" id="tflist"></div>
              <div class="list-actions">
                <button id="toggleChecks">${i18n.tr('切换勾选')}</button>
                <button id="allOn">${i18n.tr('全部选中')}</button>
                <button id="allOff">${i18n.tr('全部取消')}</button>
                <span class="spacer"></span>
                <button id="fileProps">${i18n.tr('选中文件属性…')}</button>
              </div>
            </div>
          </section>
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

  <!-- 虚拟目标（CB: Virtual targets...） -->
  <div class="modal" id="modal-vtargets" style="display:none">
    <div class="modal-box">
      <div class="modal-head"><div class="modal-title">${i18n.t('Virtual targets')}</div></div>
      <div class="modal-body">
        <div class="layout">
          <div>
            <div class="list" id="vtlist"></div>
            <div class="list-actions">
              <button id="vt-add" class="primary">${i18n.tr('添加')}</button>
              <button id="vt-remove" class="danger">${i18n.tr('删除')}</button>
            </div>
          </div>
          <div class="form" id="vtform"></div>
        </div>
      </div>
      <div class="modal-actions"><button id="vt-close">${i18n.t('Close')}</button></div>
    </div>
  </div>

  <!-- 文件属性（CB: Selected file properties） -->
  <div class="modal" id="modal-files" style="display:none">
    <div class="modal-box">
      <div class="modal-head"><div class="modal-title">${i18n.t('File properties')}</div></div>
      <div class="modal-body">
        <div class="layout">
          <div><div class="list" id="flist"></div></div>
          <div class="form" id="fform"></div>
        </div>
      </div>
      <div class="modal-actions"><button id="ff-close">${i18n.t('Close')}</button></div>
    </div>
  </div>

  <!-- 外部依赖（CB: Dependencies...） -->
  <div class="modal" id="modal-external" style="display:none">
    <div class="modal-box">
      <div class="modal-head"><div class="modal-title">${i18n.t('Dependencies')}</div></div>
      <div class="modal-body">
        <div class="form">
          <label><span class="field-name">${i18n.tr('外部依赖文件（每行一个）')}</span><textarea id="ext-deps"></textarea>
            <div class="hint">${i18n.tr('比输出文件新时强制重链接')}</div></label>
          <label><span class="field-name">${i18n.tr('附加输出文件（每行一个）')}</span><textarea id="ext-outs"></textarea>
            <div class="hint">${i18n.tr('外部依赖比它新时强制重链接')}</div></label>
        </div>
      </div>
      <div class="modal-actions"><button id="ext-ok" class="primary">${i18n.t('OK')}</button><button id="ext-cancel">${i18n.t('Cancel')}</button></div>
    </div>
  </div>

  <!-- 目标重排（CB: Re-order...） -->
  <div class="modal" id="modal-reorder" style="display:none">
    <div class="modal-box">
      <div class="modal-head"><div class="modal-title">${i18n.t('Re-order build targets')}</div></div>
      <div class="modal-body">
        <div class="list" id="reorder-list"></div>
        <div class="list-actions"><button id="reorder-up" class="icon">↑</button><button id="reorder-down" class="icon">↓</button></div>
      </div>
      <div class="modal-actions"><button id="reorder-ok" class="primary">${i18n.t('OK')}</button><button id="reorder-cancel">${i18n.t('Cancel')}</button></div>
    </div>
  </div>

  <!-- 平台多选（CB: Platforms ...） -->
  <div class="modal" id="modal-platform" style="display:none">
    <div class="modal-box">
      <div class="modal-head"><div class="modal-title">${i18n.t('Build target platforms')}</div></div>
      <div class="modal-body">
        <div class="checks">
          <label class="check"><input type="checkbox" id="plat-win"> Windows</label>
          <label class="check"><input type="checkbox" id="plat-unix"> Unix</label>
          <label class="check"><input type="checkbox" id="plat-mac"> Mac</label>
        </div>
      </div>
      <div class="modal-actions"><button id="plat-ok" class="primary">${i18n.t('OK')}</button><button id="plat-cancel">${i18n.t('Cancel')}</button></div>
    </div>
  </div>

  <!-- Build options 页内覆盖层（与独立面板共用视图） -->
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
        const targetCount = document.getElementById('target-count');
        if (targetCount) targetCount.textContent = '(0)';
        return;
      }
      el.innerHTML = targets.map((t, i) =>
        '<div class="item' + (i === selected ? ' selected' : '') + '" data-i="' + i + '"><span class="item-icon">' + data.icons.target + '</span><span class="item-label">' + esc(t.title) + '</span></div>'
      ).join('');
      const targetCount = document.getElementById('target-count');
      if (targetCount) targetCount.textContent = '(' + targets.length + ')';
      el.querySelectorAll('.item').forEach(div => {
        div.addEventListener('click', () => { selected = +div.dataset.i; renderList(); renderForm(); renderTargetFileList(); });
      });
      // D1：工具栏目标下拉同步
      const sel = document.getElementById('targetSwitch');
      if (sel) {
        sel.innerHTML = targets.map((t, i) => '<option value="' + i + '">' + esc(t.title) + '</option>').join('');
        sel.value = String(selected);
      }
    }

    function renderForm() {
      const el = document.getElementById('form');
      if (!targets.length) { el.innerHTML = ''; return; }
      const t = targets[selected];
      const platText = (t.platforms & 7) === 7 ? 'All' : [(t.platforms & 4) ? 'Windows' : '', (t.platforms & 2) ? 'Unix' : '', (t.platforms & 1) ? 'Mac' : ''].filter(Boolean).join(';');
      el.innerHTML =
        '<div class="form-section">' +
          '<div class="form-grid">' +
            '<label><span class="field-name">${i18n.tr('平台')}</span><span class="inline-field"><input id="f-platforms-text" value="' + escAttr(platText) + '" readonly><button id="f-platforms-btn">...</button></span></label>' +
            '<span style="display:none"><input type="checkbox" id="f-pwin"' + ((t.platforms & 4) ? ' checked' : '') + '><input type="checkbox" id="f-punix"' + ((t.platforms & 2) ? ' checked' : '') + '><input type="checkbox" id="f-pmac"' + ((t.platforms & 1) ? ' checked' : '') + '></span>' +
            '<label><span class="field-name">${i18n.tr('类型')}</span><select id="f-type">${typeOptions}</select></label>' +
            '<div class="checks span-2">' +
              '<label class="check"><input type="checkbox" id="f-console"' + (t.useConsoleRunner !== false ? ' checked' : '') + '> ${i18n.tr('执行结束时暂停')}</label>' +
              '<label class="check"><input type="checkbox" id="f-staticchk"' + (t.createStaticLib ? ' checked' : '') + '> ${i18n.tr('创建导入库')}</label>' +
              '<label class="check"><input type="checkbox" id="f-defchk"' + (t.createDefFile ? ' checked' : '') + '> ${i18n.tr('创建 .DEF 导出文件')}</label>' +
            '</div>' +
            '<label class="span-2"><span class="field-name">${i18n.tr('输出文件名')}</span><span class="inline-field"><input id="f-output" value="' + escAttr(t.outputFilename) + '"><button data-browse="file" data-target="f-output">...</button></span><div class="hint">${i18n.tr('相对项目根目录，如 bin/Debug/hello')}</div></label>' +
            '<label><span class="field-name">import ${i18n.tr('库文件名')}</span><span class="inline-field"><input id="f-implib" value="' + escAttr(t.impLib || '') + '"><button data-browse="file" data-target="f-implib">...</button></span></label>' +
            '<label><span class="field-name">def ${i18n.tr('文件名')}</span><span class="inline-field"><input id="f-deffile" value="' + escAttr(t.defFile || '') + '"><button data-browse="file" data-target="f-deffile">...</button></span></label>' +
            '<label><span class="field-name">${i18n.tr('执行工作目录')}</span><span class="inline-field"><input id="f-workdir" value="' + escAttr(t.workingDir || '') + '"><button data-browse="folder" data-target="f-workdir">...</button></span></label>' +
            '<label><span class="field-name">${i18n.tr('对象输出目录')}</span><span class="inline-field"><input id="f-object" value="' + escAttr(t.objectOutput || '') + '"><button data-browse="folder" data-target="f-object">...</button></span></label>' +
            '<div class="checks span-2">' +
              '<label class="check"><input type="checkbox" id="f-prefix"' + (t.prefixAuto !== false ? ' checked' : '') + '> ${i18n.tr('自动生成文件名前缀')}</label>' +
              '<label class="check"><input type="checkbox" id="f-ext"' + (t.extensionAuto !== false ? ' checked' : '') + '> ${i18n.tr('自动生成文件名扩展名')}</label>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<details class="fg"><summary>${i18n.tr('高级（扩展）')}</summary>' +
          '<div class="form-grid">' +
            '<label><span class="field-name">${i18n.tr('目标标题')}</span><input id="f-title" value="' + escAttr(t.title) + '"></label>' +
            '<label><span class="field-name">${i18n.tr('编译器 ID')}</span><input id="f-compiler" value="' + escAttr(t.compilerId) + '"></label>' +
            '<label><span class="field-name">${i18n.tr('执行参数')}</span><input id="f-params" value="' + escAttr(t.executionParameters || '') + '"></label>' +
            '<label><span class="field-name">deps ${i18n.tr('输出目录')}</span><input id="f-deps" value="' + escAttr(t.depsOutput || '') + '"></label>' +
            '<label class="span-2"><span class="field-name">${i18n.tr('宿主程序（库/CommandsOnly 目标运行/调试用）')}</span><input id="f-host" value="' + escAttr(t.hostApplication || '') + '"></label>' +
            '<label class="check span-2"><input type="checkbox" id="f-hostterm"' + (t.runHostApplicationInTerminal !== false ? ' checked' : '') + '> ${i18n.tr('宿主程序在终端运行')}</label>' +
            '<label><span class="field-name">${i18n.tr('外部依赖（每行一个）')}</span><textarea id="f-extdeps">' + esc((t.externalDeps || []).join('\\n')) + '</textarea></label>' +
            '<label><span class="field-name">${i18n.tr('附加输出（每行一个）')}</span><textarea id="f-addout">' + esc((t.additionalOutput || []).join('\\n')) + '</textarea></label>' +
            '<label class="span-2"><span class="field-name">${i18n.tr('目标环境变量（每行 name=value）')}</span><textarea id="f-envvars">' + esc((t.envVars || []).map(v => v.name + '=' + v.value).join('\\n')) + '</textarea></label>' +
          '</div>' +
        '</details>';
      document.getElementById('f-type').value = String(t.targetType);
      ['f-title', 'f-type', 'f-output', 'f-object', 'f-compiler', 'f-params', 'f-extdeps', 'f-addout', 'f-envvars',
        'f-workdir', 'f-deps', 'f-pwin', 'f-punix', 'f-pmac', 'f-host', 'f-hostterm', 'f-console',
        'f-implib', 'f-deffile', 'f-defchk', 'f-staticchk', 'f-prefix', 'f-ext'].forEach(id => {
        const e = document.getElementById(id); if (e) e.addEventListener('change', () => collectTargetForm());
      });
      document.getElementById('f-platforms-btn').addEventListener('click', () => openPlatformModal('target', selected));
      el.querySelectorAll('button[data-browse]').forEach(btn => {
        btn.addEventListener('click', () => {
          vscode.postMessage({ type: 'browse', kind: btn.dataset.browse, target: btn.dataset.target, value: document.getElementById(btn.dataset.target).value });
        });
      });
    }

    function collectTargetForm() {
      // 表单未渲染时元素不存在（例如本次会话从未切到该 tab）：跳过收集，避免保存时抛异常
      if (!targets.length || !document.getElementById('f-title')) return;
      const t = targets[selected];
      const oldTitle = t.title;
      const newTitle = document.getElementById('f-title').value.trim() || oldTitle;
      t.title = newTitle;
      t.targetType = Number(document.getElementById('f-type').value);
      t.outputFilename = document.getElementById('f-output').value;
      t.objectOutput = document.getElementById('f-object').value;
      t.compilerId = document.getElementById('f-compiler').value.trim();
      t.executionParameters = document.getElementById('f-params').value;
      t.externalDeps = optionsLines(document.getElementById('f-extdeps').value);
      t.additionalOutput = optionsLines(document.getElementById('f-addout').value);
      t.envVars = parseVarLines(document.getElementById('f-envvars').value);
      // R6：高级字段
      t.workingDir = document.getElementById('f-workdir').value.trim();
      t.depsOutput = document.getElementById('f-deps').value.trim();
      const pw = document.getElementById('f-pwin').checked;
      const pu = document.getElementById('f-punix').checked;
      const pm = document.getElementById('f-pmac').checked;
      t.platforms = (pw && pu && pm) ? 255 : ((pw ? 4 : 0) | (pu ? 2 : 0) | (pm ? 1 : 0));
      t.hostApplication = document.getElementById('f-host').value.trim();
      t.runHostApplicationInTerminal = document.getElementById('f-hostterm').checked;
      t.useConsoleRunner = document.getElementById('f-console').checked;
      t.impLib = document.getElementById('f-implib').value.trim();
      t.defFile = document.getElementById('f-deffile').value.trim();
      t.createDefFile = document.getElementById('f-defchk').checked;
      t.createStaticLib = document.getElementById('f-staticchk').checked;
      t.prefixAuto = document.getElementById('f-prefix').checked;
      t.extensionAuto = document.getElementById('f-ext').checked;
      // 目标重命名：同步文件归属引用
      if (oldTitle !== newTitle) {
        files.forEach(f => {
          const i = f.buildTargets.indexOf(oldTitle);
          if (i >= 0) f.buildTargets[i] = newTitle;
        });
        virtualTargets.forEach(v => {
          const i = v.targets.indexOf(oldTitle);
          if (i >= 0) v.targets[i] = newTitle;
        });
        // 调试器远程配置按目标标题索引：改名后同步，否则原配置变成无法匹配的孤儿节点
        dbg.remote.forEach(r => { if (r.target === oldTitle) r.target = newTitle; });
      }
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
        const fileCount = document.getElementById('file-count');
        if (fileCount) fileCount.textContent = '0/0';
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
      el.innerHTML =
        '<section class="card">' +
          '<div class="card-header">${i18n.t('Project settings')}</div>' +
          '<div class="card-body"><div class="form-grid">' +
            '<label><span class="field-name">${i18n.tr('标题：')}</span><input id="set-title" value="' + escAttr(projSettings.title) + '"></label>' +
            '<label><span class="field-name">${i18n.tr('平台：')}</span><span class="inline-field"><input id="set-platforms-text" value="' + escAttr(platText) + '" readonly><button id="set-platforms-btn">...</button></span></label>' +
            '<span style="display:none"><input type="checkbox" id="set-pwin"' + ((projSettings.platforms & 4) ? ' checked' : '') + '><input type="checkbox" id="set-punix"' + ((projSettings.platforms & 2) ? ' checked' : '') + '><input type="checkbox" id="set-pmac"' + ((projSettings.platforms & 1) ? ' checked' : '') + '></span>' +
            '<label class="span-2"><span class="field-name">${i18n.tr('文件名：')}</span><input value="' + escAttr(data.filename) + '" readonly></label>' +
          '</div></div>' +
        '</section>' +
        '<section class="card">' +
          '<div class="card-header">Makefile</div>' +
          '<div class="card-body"><div class="form-grid">' +
            '<label class="span-2"><span class="field-name">Makefile</span><span class="inline-field"><input id="set-mkfile" value="' + escAttr(projSettings.makefile || '') + '"><button data-browse="file" data-target="set-mkfile">...</button></span></label>' +
            '<label class="check"><input type="checkbox" id="set-mkcustom"' + (projSettings.makefileIsCustom ? ' checked' : '') + '> ${i18n.tr('这是一个自定义 Makefile')}</label>' +
            '<label><span class="field-name">${i18n.tr('执行目录：')}</span><span class="inline-field"><input id="set-mkdir" value="' + escAttr(projSettings.executionDir || '') + '"><button data-browse="folder" data-target="set-mkdir">...</button></span></label>' +
            '<div class="hint span-2">${i18n.tr('文件必须存在，不会自动生成 Makefile！修改后，工程构建选项中的特殊设置只有在保存工程后才会启用/禁用。')}</div>' +
          '</div></div>' +
        '</section>' +
        '<section class="card">' +
          '<div class="card-header">${i18n.t('Build')}</div>' +
          '<div class="card-body"><div class="form-grid">' +
            '<label class="span-2"><span class="field-name">${i18n.tr('预编译头：')}</span><select id="set-pch" title="Strategy">' +
              '<option value="0">${i18n.tr('PCH 与源文件同目录')}</option>' +
              '<option value="1">${i18n.tr('PCH 与对象文件同目录')}</option>' +
              '<option value="2">${i18n.tr('PCH 与源文件同名 .gch')}</option>' +
            '</select><div class="hint">${i18n.tr('如果修改 PCH 生成策略，请手动删除旧 PCH 文件（或目录）以避免冲突……')}</div></label>' +
            '<div class="checks span-2">' +
              '<label class="check"><input type="checkbox" id="set-extobj"' + (projSettings.extendedObjNames ? ' checked' : '') + '> ${i18n.tr('生成扩展对象名（例如 "foo.cpp.o" 而不是 "foo.o"）')}</label>' +
              '<label class="check"><input type="checkbox" id="set-checkfiles"' + (projSettings.checkForExternallyModifiedFiles !== false ? ' checked' : '') + '> ${i18n.tr('检查外部修改的文件（大多数情况下应勾选）')}</label>' +
            '</div>' +
            '<div class="hint span-2">${i18n.tr('（此设置主要用于包含大量同名但扩展名不同文件的大型工程）')}</div>' +
            '<div class="hint span-2">${i18n.tr('（关闭外部修改检查主要用于慢速网络共享上的工程。注意：外部修改可能静默覆盖文件，如果你没有在 Code::Blocks 内保存它们）')}</div>' +
          '</div></div>' +
          '<div class="card-footer"><button id="set-project-deps">${i18n.tr('工程的依赖…')}</button><button id="set-project-build-options">${i18n.tr('工程的构建选项…')}</button></div>' +
        '</section>' +
        '<section class="card"><div class="card-body">' +
          '<details class="fg"><summary>${i18n.tr('高级（扩展）')}</summary>' +
            '<div class="form-grid">' +
              '<label><span class="field-name">${i18n.tr('默认编译器 ID')}</span><input id="set-compiler" value="' + escAttr(projSettings.compilerId) + '"></label>' +
              '<label><span class="field-name">${i18n.tr('虚拟文件夹')}</span><textarea id="set-vfolders">' + esc(projSettings.virtualFolders.join('\\n')) + '</textarea></label>' +
              '<label class="span-2"><span class="field-name">${i18n.tr('项目自定义变量（每行 name=value）')}</span><textarea id="set-vars">' + esc(projSettings.customVariables.map(v => v.name + '=' + v.value).join('\\n')) + '</textarea></label>' +
            '</div>' +
          '</details>' +
        '</div></section>';
      document.getElementById('set-pch').value = String(projSettings.pchMode);
      ['set-title', 'set-compiler', 'set-vfolders', 'set-vars', 'set-checkfiles',
        'set-pwin', 'set-punix', 'set-pmac', 'set-pch', 'set-extobj', 'set-mkcustom', 'set-mkfile', 'set-mkdir'].forEach(id => {
        const e = document.getElementById(id); if (e) e.addEventListener('change', () => collectSettingsForm());
      });
      document.getElementById('set-platforms-btn').addEventListener('click', () => openPlatformModal('project', -1));
      document.getElementById('set-project-deps').addEventListener('click', () => vscode.postMessage({ type: 'editDependencies' }));
      document.getElementById('set-project-build-options').addEventListener('click', () => openBuildOptions('project'));
      el.querySelectorAll('button[data-browse]').forEach(btn => {
        btn.addEventListener('click', () => vscode.postMessage({ type: 'browse', kind: btn.dataset.browse, target: btn.dataset.target, value: document.getElementById(btn.dataset.target).value }));
      });
    }

    function collectSettingsForm() {
      const el = document.getElementById('sform');
      if (!el || !el.querySelector('#set-title')) return;
      projSettings.title = document.getElementById('set-title').value.trim() || projSettings.title;
      projSettings.compilerId = document.getElementById('set-compiler').value.trim();
      projSettings.virtualFolders = optionsLines(document.getElementById('set-vfolders').value);
      projSettings.customVariables = parseVarLines(document.getElementById('set-vars').value);
      const sw = document.getElementById('set-pwin').checked;
      const su = document.getElementById('set-punix').checked;
      const sm = document.getElementById('set-pmac').checked;
      projSettings.platforms = (sw && su && sm) ? 255 : ((sw ? 4 : 0) | (su ? 2 : 0) | (sm ? 1 : 0));
      projSettings.pchMode = Number(document.getElementById('set-pch').value) || 1;
      projSettings.extendedObjNames = document.getElementById('set-extobj').checked;
      projSettings.makefileIsCustom = document.getElementById('set-mkcustom').checked;
      projSettings.makefile = document.getElementById('set-mkfile').value.trim();
      projSettings.executionDir = document.getElementById('set-mkdir').value.trim();
      projSettings.checkForExternallyModifiedFiles = document.getElementById('set-checkfiles').checked;
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
      const scopeSel =
        '<select id="scr-scope">' +
        '<option value="project">' + esc(projSettings.title) + '</option>' +
        targets.map((t, i) => '<option value="' + i + '">' + esc(t.title) + '</option>').join('') +
        '</select>';
      el.innerHTML =
        '<section class="card">' +
          '<div class="card-header">${i18n.t('Build scripts')}</div>' +
          '<div class="card-body">' +
          '<label><span class="field-name">${i18n.tr('工程概览：')}</span>' + scopeSel + '</label>' +
          '<div class="list-toolbar"><span class="field-name" style="margin:0">${i18n.tr('已附加的构建脚本：')}</span><span class="spacer"></span></div>' +
          '<div class="list" id="scr-list-box"></div>' +
          '<div class="list-actions">' +
            '<button id="scr-add" class="primary">${i18n.tr('添加')}</button>' +
            '<button id="scr-remove" class="danger">${i18n.tr('删除')}</button>' +
            '<button id="scr-up" class="icon" title="${i18n.tr('上移')}">↑</button>' +
            '<button id="scr-down" class="icon" title="${i18n.tr('下移')}">↓</button>' +
            '<span class="spacer"></span>' +
            '<button id="scr-validate">${i18n.tr('校验所有已附加脚本')}</button>' +
          '</div>' +
          '<div class="hint" id="scr-status"></div>' +
        '</div></section>';
      document.getElementById('scr-scope').value = String(selectedScriptScope);
      document.getElementById('scr-scope').addEventListener('change', () => {
        selectedScriptScope = document.getElementById('scr-scope').value;
        selectedScriptScope = selectedScriptScope === 'project' ? 'project' : Number(selectedScriptScope);
        selectedScript = -1;
        renderScriptsForm();
      });
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
    }

    function collectScriptsForm() {
      // 脚本列表直接操作数组；无额外表单字段
    }

    // ---- 备注 tab ----
    function renderNotesForm() {
      const el = document.getElementById('ntform');
      el.innerHTML =
        '<section class="card">' +
          '<div class="card-header">${i18n.t('Notes')}</div>' +
          '<div class="card-body">' +
          '<label><span class="field-name">${i18n.tr('项目备注')}</span>' +
          '<textarea id="nt-text" style="min-height:220px">' + esc(notes.notes) + '</textarea></label>' +
          '<label class="check"><input type="checkbox" id="nt-show"' + (notes.showNotesOnLoad ? ' checked' : '') + '>' +
          '<span class="field-name" style="display:inline">${i18n.tr('加载项目时显示备注')}</span></label>' +
        '</div></section>';
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
      const scopes = [{ v: '', label: '${i18n.tr('项目级默认')}' }].concat(targets.map((t, i) => ({ v: String(i), label: t.title })));
      const scopeSel = '<select id="dbg-scope">' + scopes.map(s => '<option value="' + s.v + '">' + esc(s.label) + '</option>').join('') + '</select>';
      const scopeName = selectedDebugScope === '' ? '' : targets[Number(selectedDebugScope)].title;
      const r = selectedDebugScope === '' ? dbgRemoteFor('') : dbgRemoteFor(scopeName);
      const connSel = [[0, 'TCP (IP:${i18n.tr('端口)')}'], [1, 'UDP (IP:${i18n.tr('端口)')}'], [2, '${i18n.tr('串口 Serial')}']]
        .map(c => '<option value="' + c[0] + '">' + c[1] + '</option>').join('');
      el.innerHTML =
        '<section class="card">' +
          '<div class="card-header">${i18n.t('Debugger')}</div>' +
          '<div class="card-body"><div class="form-grid">' +
            '<label class="span-2"><span class="field-name">${i18n.tr('作用域')}</span>' + scopeSel +
              '<div class="hint">${i18n.tr('项目级默认 = 未单独配置的目标共用（对齐 CB 的')} &lt;Project&gt; ${i18n.tr('行）；同名时目标覆盖项目')}</div></label>' +
            '<label class="span-2"><span class="field-name">${i18n.tr('源搜索目录（每行一个）')}</span>' +
              '<textarea id="dbg-paths">' + esc(dbg.searchPaths.join('\\n')) + '</textarea>' +
              '<div class="hint">${i18n.tr('调试会话向 GDB 发 directory 命令（对齐 CB debugger search paths；支持 $(VAR) 宏与相对项目根路径）')}</div></label>' +
          '</div></div>' +
        '</section>' +
        '<section class="card">' +
          '<div class="card-header">${i18n.tr('远程目标（')}' + esc(scopeName || '${i18n.tr('项目级默认')}') + '）</div>' +
          '<div class="card-body"><div class="form-grid">' +
            '<label><span class="field-name">${i18n.tr('连接类型')}</span><select id="dbg-conn">' + connSel + '</select></label>' +
            '<label><span class="field-name">${i18n.tr('串口')}</span><input id="dbg-serial" value="' + escAttr(r.serialPort) + '" placeholder="COM3 / /dev/ttyUSB0"></label>' +
            '<label><span class="field-name">${i18n.tr('波特率')}</span><input id="dbg-baud" value="' + escAttr(r.serialBaud) + '"></label>' +
            '<label><span class="field-name">IP ${i18n.tr('地址')}</span><input id="dbg-ip" value="' + escAttr(r.ip) + '"></label>' +
            '<label><span class="field-name">${i18n.tr('端口')}</span><input id="dbg-port" value="' + escAttr(r.ipPort) + '"></label>' +
            '<div class="checks span-2">' +
              '<label class="check"><input type="checkbox" id="dbg-ext"' + (r.extendedRemote ? ' checked' : '') + '> ${i18n.tr('使用 extended-remote')}</label>' +
              '<label class="check"><input type="checkbox" id="dbg-skip"' + (r.skipLDpath ? ' checked' : '') + '> ${i18n.tr('跳过 PATH/LD_LIBRARY_PATH 注入')}</label>' +
            '</div>' +
            '<label><span class="field-name">${i18n.tr('连接前命令（每行一条，任意调试均执行）')}</span><textarea id="dbg-before">' + esc(r.additionalCmdsBefore) + '</textarea></label>' +
            '<label><span class="field-name">${i18n.tr('连接前 shell 命令（每行一条）')}</span><textarea id="dbg-before-shell">' + esc(r.additionalShellCmdsBefore) + '</textarea></label>' +
            '<label><span class="field-name">${i18n.tr('连接后命令（每行一条）')}</span><textarea id="dbg-after">' + esc(r.additionalCmds) + '</textarea></label>' +
            '<label><span class="field-name">${i18n.tr('连接后 shell 命令（每行一条）')}</span><textarea id="dbg-after-shell">' + esc(r.additionalShellCmdsAfter) + '</textarea></label>' +
            '<div class="hint span-2">${i18n.tr('连接顺序（对齐 CB）：连接前命令 → 连接前 shell → [set remotebaud] → target [extended-]remote → 连接后命令 → 连接后 shell；有效连接（串口需端口+波特率；TCP/UDP 需 IP+端口）时启动用 continue 而非 run')}</div>' +
          '</div></div>' +
        '</section>';
      document.getElementById('dbg-scope').value = selectedDebugScope;
      document.getElementById('dbg-conn').value = String(r.connType);
      document.getElementById('dbg-scope').addEventListener('change', () => {
        collectDebugForm();
        selectedDebugScope = document.getElementById('dbg-scope').value;
        renderDebugForm();
      });
      ['dbg-paths', 'dbg-conn', 'dbg-serial', 'dbg-baud', 'dbg-ip', 'dbg-port', 'dbg-ext', 'dbg-skip', 'dbg-before', 'dbg-before-shell', 'dbg-after', 'dbg-after-shell'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => collectDebugForm());
      });
    }
    function collectDebugForm() {
      const paths = document.getElementById('dbg-paths');
      if (!paths) return;
      dbg.searchPaths = optionsLines(paths.value);
      const scopeTarget = selectedDebugScope === '' ? undefined : targets[Number(selectedDebugScope)];
      // 目标被删除后作用域索引可能失效：search_path 已收集，跳过 remote 段
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
        '<section class="card">' +
          '<div class="card-header">${i18n.t('C/C++ parser options')}</div>' +
          '<div class="card-body">' +
          '<div class="list-toolbar"><span class="field-name" style="margin:0">${i18n.tr('附加搜索路径：')}</span><span class="spacer"></span></div>' +
          '<div class="list" id="parser-list"></div>' +
          '<div class="list-actions">' +
            '<button id="parser-add" class="primary">${i18n.tr('添加')}</button>' +
            '<button id="parser-edit">${i18n.tr('编辑')}</button>' +
            '<button id="parser-del" class="danger">${i18n.tr('删除')}</button>' +
          '</div>' +
          '<div class="hint">${i18n.tr('写入 Extensions/code_completion/search_path；用于 C/C++ 解析与代码补全')}</div>' +
        '</div></section>';
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
              '<input type="checkbox" data-fi="' + i + '"' + checked + '><span class="item-icon">' + data.icons.file + '</span><span class="item-label">' + esc(f.relativeFilename) + '</span></label>';
          }).join('')
        : '<div class="empty">${i18n.tr('（无文件）')}</div>';
      const fileCount = document.getElementById('file-count');
      if (fileCount) {
        const checkedCount = files.filter((f) => f.buildTargets.includes(title)).length;
        fileCount.textContent = checkedCount + '/' + files.length;
      }
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
          const fileCount = document.getElementById('file-count');
          if (fileCount) {
            const checkedCount = files.filter((x) => x.buildTargets.includes(t)).length;
            fileCount.textContent = checkedCount + '/' + files.length;
          }
        });
      });
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
      wrap.className = 'modal';
      wrap.innerHTML = '<div class="modal-box"><div class="modal-head"><div class="modal-title">' + esc(title) + '</div></div>' +
        '<div class="modal-body"><input id="ask-text-input" value="' + escAttr(initial || '') + '" style="width:100%"></div>' +
        '<div class="modal-actions"><button id="ask-cancel">${i18n.t('Cancel')}</button><button id="ask-ok" class="primary">${i18n.t('OK')}</button></div></div>';
      document.body.appendChild(wrap);
      const input = wrap.querySelector('#ask-text-input');
      input.focus(); input.select();
      wrap.querySelector('#ask-cancel').addEventListener('click', () => wrap.remove());
      wrap.querySelector('#ask-ok').addEventListener('click', () => { const v = input.value; wrap.remove(); cb(v); });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { const v = input.value; wrap.remove(); cb(v); } if (e.key === 'Escape') wrap.remove(); });
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
        makeCommands: { ...(settings.makeCommands || {}) }
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
        defaultCompilerId: boRuntime.defaultCompilerId || ''
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

    window.addEventListener('message', e => {
      if (e.data.type === 'saved') {
        setStatus('${i18n.tr('已保存 ✔️')}');
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
