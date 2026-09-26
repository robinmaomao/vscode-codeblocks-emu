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
import { Project, BuildTarget, OptionsRelationType } from '../model/types';
import { parseProjectDebuggerConfig, defaultRemoteOptions } from '../model/projectDebuggerExtensions';

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
  project: { compilerOptions: string[]; linkerOptions: string[]; linkLibs: string[] };
  targets: { compilerOptions: string[]; linkerOptions: string[]; linkLibs: string[]; relations: RelationEditData }[];
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

const TARGET_TYPE_NAMES: Record<number, string> = {
  0: '可执行文件 (Executable)',
  1: '控制台程序 (Console application)',
  2: '静态库 (Static library)',
  3: '动态库 (Dynamic library)',
  4: '仅命令 (Commands only)',
  5: '本机 (Native)',
};

/** 内联 SVG 图标（16x16，跟随 currentColor，兼容深/浅色主题） */
const ICONS = {
  target: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>',
  file: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M4 1.5h4.5L12 5v9.5H4z" stroke="currentColor"/><path d="M8.5 1.5V5H12" stroke="currentColor"/></svg>',
  options: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 4.5h12M2 11.5h12M5 2v5M11 9v5" stroke="currentColor" stroke-width="1.2"/></svg>',
  dirs: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 3.5h4l2 2h7v7.5h-13z" stroke="currentColor"/></svg>',
  settings: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="2" fill="currentColor"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.5 1.5M11.5 11.5L13 13M13 3l-1.5 1.5M4.5 11.5L3 13" stroke="currentColor" stroke-width="1.2"/></svg>',
};

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
    /** 打开时直达的 tab（默认 targets；如 'notes'） */
    private initialTab: string | undefined = undefined,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'codeblocks.projectProperties',
      `工程属性: ${project.title}`,
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
  ): void {
    ProjectPropertiesPanel.current?.dispose();
    ProjectPropertiesPanel.current = new ProjectPropertiesPanel(project, extensionUri, onSave, initialTab);
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
    };
    const targetOpts = this.project.buildTargets.map((t) => ({
      compilerOptions: [...t.compilerOptions],
      linkerOptions: [...t.linkerOptions],
      linkLibs: [...t.linkLibs],
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

    const typeOptions = Object.entries(TARGET_TYPE_NAMES)
      .map(([v, name]) => `<option value="${v}">${this.escapeHtml(name)}</option>`)
      .join('');
    // 初始 tab（供脚本注入；JSON.stringify 保证引号安全）
    const initialTabJs = JSON.stringify(this.initialTab ?? 'targets');

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
      icons: ICONS,
    }).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    :root { --cb-border: var(--vscode-widget-border, rgba(128,128,128,.35)); }
    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      display: flex; flex-direction: column; overflow: hidden;
    }
    /* 顶栏 —— 对齐 VS Code 编辑器操作区 */
    .toolbar {
      display: flex; align-items: center; gap: 6px;
      padding: 6px 12px; flex-shrink: 0;
      border-bottom: 1px solid var(--cb-border);
      background: var(--vscode-sideBarSectionHeader-background, transparent);
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: 1px solid var(--vscode-button-border, transparent);
      padding: 4px 10px; border-radius: 2px; cursor: pointer;
      font-family: var(--vscode-font-family); font-size: 13px; line-height: 18px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
    button:disabled { opacity: .5; cursor: default; }
    button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    #status { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 12px; }
    /* 项目标题栏 */
    .project-header {
      padding: 8px 16px; flex-shrink: 0;
      border-bottom: 1px solid var(--cb-border);
      background: var(--vscode-sideBarSectionHeader-background, transparent);
    }
    .project-title { font-size: 15px; font-weight: 600; line-height: 20px; }
    .project-subtitle { font-size: 12px; color: var(--vscode-descriptionForeground); margin-top: 1px; word-break: break-all; }
    /* 主体：左竖排导航 + 右内容区 */
    .main { flex: 1; display: flex; overflow: hidden; min-height: 0; }
    /* 左侧竖排 Tab —— 对齐 VS Code 活动栏 */
    .tabs {
      display: flex; flex-direction: column; gap: 0; flex-shrink: 0; overflow-y: auto;
      width: 176px; padding: 4px 0;
      border-right: 1px solid var(--cb-border);
      background: var(--vscode-sideBar-background, transparent);
    }
    .tab {
      display: flex; align-items: center; gap: 8px;
      background: transparent; color: var(--vscode-sideBar-foreground, var(--vscode-foreground));
      border: none; border-left: 2px solid transparent;
      padding: 6px 12px; border-radius: 0; cursor: pointer;
      font-size: 13px; white-space: nowrap; text-align: left; width: 100%;
    }
    .tab:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
    .tab:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .tab.active {
      color: var(--vscode-list-activeSelectionForeground, var(--vscode-foreground));
      border-left-color: var(--vscode-focusBorder);
      background: var(--vscode-list-activeSelectionBackground, transparent);
    }
    .tab-icon { display: inline-flex; width: 16px; height: 16px; flex: none; }
    /* 右侧内容区 */
    .content { flex: 1; overflow-y: auto; min-width: 0; }
    .tab-pane { padding: 12px 16px; }
    .layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
    /* 列表 —— 对齐 VS Code 树/列表 */
    .list {
      border: 1px solid var(--cb-border); border-radius: 2px;
      max-height: 70vh; overflow-y: auto;
      background: var(--vscode-input-background, transparent);
    }
    .list .item { display: flex; align-items: center; gap: 6px; padding: 4px 8px; cursor: pointer; line-height: 20px; user-select: none; }
    .list .item:hover { background: var(--vscode-list-hoverBackground); }
    .list .item.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .list .empty { padding: 10px; color: var(--vscode-descriptionForeground); font-style: italic; }
    .item-icon { display: inline-flex; width: 16px; height: 16px; flex: none; }
    .item-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .list-actions { display: flex; gap: 6px; margin-top: 8px; }
    .list-actions button { padding: 3px 9px; }
    /* 表单字段 */
    .form label { display: block; margin-bottom: 14px; }
    .form .field-name { display: block; margin-bottom: 3px; font-size: 13px; color: var(--vscode-foreground); }
    .hint { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 3px; }
    /* 输入控件 */
    input, select, textarea {
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--cb-border));
      border-radius: 2px; padding: 4px 6px;
      font-family: var(--vscode-font-family); font-size: 13px;
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
    textarea { min-height: 64px; resize: vertical; font-family: var(--vscode-editor-font-family); line-height: 1.4; }
    input[type="checkbox"] { width: 16px; height: 16px; flex: none; accent-color: var(--vscode-checkbox-background, var(--vscode-focusBorder)); }
    /* 文件归属复选框组 + 行内开关 */
    .checks { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 2px; }
    .checks label.check { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 0; }
    .inline-field { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .inline-field .field-name { display: inline; margin-bottom: 0; }
    .form label.check { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
    .form label.check .field-name { display: inline; margin-bottom: 0; }
    /* 表单分组折叠（D2） */
    details.fg { border: 1px solid var(--cb-border); border-radius: 4px; padding: 6px 10px; margin-bottom: 10px; }
    details.fg summary { cursor: pointer; font-weight: 600; margin: 2px 0 6px; color: var(--vscode-foreground); }
  </style>
</head>
<body>
  <div class="project-header">
    <div class="project-title">${this.escapeHtml(this.project.title)}</div>
    <div class="project-subtitle">${this.escapeHtml(this.project.filename)}</div>
  </div>
  <div class="toolbar">
    <button id="save">保存</button>
    <button id="saveClose" class="secondary">保存并关闭</button>
    <select id="targetSwitch" title="快速切换到该目标" style="max-width:240px;width:auto"></select>
    <span id="status"></span>
  </div>
  <div class="main">
    <nav class="tabs">
      <button class="tab active" data-tab="targets" id="tabbtn-targets"><span class="tab-icon">${ICONS.target}</span>构建目标</button>
      <button class="tab" data-tab="vtargets" id="tabbtn-vtargets"><span class="tab-icon">${ICONS.target}</span>虚拟目标</button>
      <button class="tab" data-tab="files" id="tabbtn-files"><span class="tab-icon">${ICONS.file}</span>文件</button>
      <button class="tab" data-tab="options" id="tabbtn-options"><span class="tab-icon">${ICONS.options}</span>构建选项</button>
      <button class="tab" data-tab="dirs" id="tabbtn-dirs"><span class="tab-icon">${ICONS.dirs}</span>搜索目录</button>
      <button class="tab" data-tab="scripts" id="tabbtn-scripts"><span class="tab-icon">${ICONS.settings}</span>构建脚本</button>
      <button class="tab" data-tab="settings" id="tabbtn-settings"><span class="tab-icon">${ICONS.settings}</span>项目设置</button>
      <button class="tab" data-tab="notes" id="tabbtn-notes"><span class="tab-icon">${ICONS.file}</span>备注</button>
      <button class="tab" data-tab="debugger" id="tabbtn-debugger"><span class="tab-icon">${ICONS.options}</span>调试器</button>
    </nav>
    <div class="content">
      <div id="tab-targets" class="tab-pane">
        <div class="layout">
          <div>
            <div class="list" id="list"></div>
            <div class="list-actions">
              <button id="add" title="添加目标">添加</button>
              <button id="copy" title="复制选中目标">复制</button>
              <button id="remove" title="删除选中目标">删除</button>
              <button id="up" title="上移选中目标">上移</button>
              <button id="down" title="下移选中目标">下移</button>
              <button id="exportTarget" title="把选中目标导出为独立工程（对齐 CB Create project from target）">导出为工程</button>
            </div>
          </div>
          <div class="form" id="form"></div>
        </div>
      </div>
      <div id="tab-vtargets" class="tab-pane" style="display:none">
        <div class="layout">
          <div>
            <div class="list" id="vtlist"></div>
            <div class="list-actions">
              <button id="vt-add" title="添加虚拟目标">添加</button>
              <button id="vt-remove" title="删除选中虚拟目标">删除</button>
            </div>
          </div>
          <div class="form" id="vtform"></div>
        </div>
      </div>
      <div id="tab-files" class="tab-pane" style="display:none">
        <div class="layout">
          <div>
            <div class="list" id="flist"></div>
          </div>
          <div class="form" id="fform"></div>
        </div>
      </div>
      <div id="tab-options" class="tab-pane" style="display:none">
        <div class="form" id="oform"></div>
      </div>
      <div id="tab-dirs" class="tab-pane" style="display:none">
        <div class="form" id="dform"></div>
      </div>
      <div id="tab-settings" class="tab-pane" style="display:none">
        <div class="form" id="sform"></div>
      </div>
      <div id="tab-scripts" class="tab-pane" style="display:none">
        <div class="form" id="scrform"></div>
      </div>
      <div id="tab-notes" class="tab-pane" style="display:none">
        <div class="form" id="ntform"></div>
      </div>
      <div id="tab-debugger" class="tab-pane" style="display:none">
        <div class="form" id="dbgform"></div>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const data = ${data};
    let targets = data.targets.map(t => ({ ...t }));
    let files = data.files.map(f => ({ ...f, buildTargets: [...f.buildTargets] }));
    let projOpts = { compilerOptions: [...data.projectOpts.compilerOptions], linkerOptions: [...data.projectOpts.linkerOptions], linkLibs: [...data.projectOpts.linkLibs] };
    let targetOpts = data.targetOpts.map(o => ({ compilerOptions: [...o.compilerOptions], linkerOptions: [...o.linkerOptions], linkLibs: [...o.linkLibs], relations: { ...o.relations } }));
    let projDirs = { includeDirs: [...data.projectDirs.includeDirs], libDirs: [...data.projectDirs.libDirs], resourceDirs: [...data.projectDirs.resourceDirs] };
    let targetDirs = data.targetDirs.map(o => ({ includeDirs: [...o.includeDirs], libDirs: [...o.libDirs], resourceDirs: [...o.resourceDirs] }));
    let projSettings = { title: data.projectSettings.title, compilerId: data.projectSettings.compilerId, virtualFolders: [...data.projectSettings.virtualFolders], customVariables: (data.projectSettings.customVariables || []).map(v => ({ ...v })), envVars: (data.projectSettings.envVars || []).map(v => ({ ...v })) };
    let projScripts = { scripts: [...data.projectScripts.scripts], before: [...data.projectScripts.before], after: [...data.projectScripts.after] };
    let targetScripts = data.targetScripts.map(s => ({ scripts: [...s.scripts], before: [...s.before], after: [...s.after] }));
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

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

    // ---- tab 切换 ----
    function switchTab(tab) {
      activeTab = tab;
      ['targets', 'vtargets', 'files', 'options', 'dirs', 'scripts', 'settings', 'notes', 'debugger'].forEach(name => {
        document.getElementById('tabbtn-' + name).classList.toggle('active', tab === name);
        document.getElementById('tab-' + name).style.display = tab === name ? '' : 'none';
      });
      if (tab === 'vtargets') renderVTForm();
      if (tab === 'files') renderFileForm();
      if (tab === 'options') renderOptionsForm();
      if (tab === 'dirs') renderDirsForm();
      if (tab === 'scripts') renderScriptsForm();
      if (tab === 'settings') renderSettingsForm();
      if (tab === 'notes') renderNotesForm();
      if (tab === 'debugger') renderDebugForm();
    }
    document.getElementById('tabbtn-targets').addEventListener('click', () => { collectTargetForm(); switchTab('targets'); });
    document.getElementById('tabbtn-vtargets').addEventListener('click', () => { collectTargetForm(); switchTab('vtargets'); });
    document.getElementById('tabbtn-files').addEventListener('click', () => { collectTargetForm(); switchTab('files'); });
    document.getElementById('tabbtn-options').addEventListener('click', () => { collectTargetForm(); switchTab('options'); });
    document.getElementById('tabbtn-dirs').addEventListener('click', () => { collectTargetForm(); switchTab('dirs'); });
    document.getElementById('tabbtn-scripts').addEventListener('click', () => { collectTargetForm(); switchTab('scripts'); });
    document.getElementById('tabbtn-settings').addEventListener('click', () => { collectTargetForm(); switchTab('settings'); });
    document.getElementById('tabbtn-notes').addEventListener('click', () => { collectTargetForm(); switchTab('notes'); });
    document.getElementById('tabbtn-debugger').addEventListener('click', () => { collectTargetForm(); switchTab('debugger'); });

    // ---- 构建目标 tab ----
    function renderList() {
      const el = document.getElementById('list');
      if (!targets.length) {
        el.innerHTML = '<div class="empty">（无构建目标）</div>';
        return;
      }
      el.innerHTML = targets.map((t, i) =>
        '<div class="item' + (i === selected ? ' selected' : '') + '" data-i="' + i + '"><span class="item-icon">' + data.icons.target + '</span><span class="item-label">' + esc(t.title) + '</span></div>'
      ).join('');
      el.querySelectorAll('.item').forEach(div => {
        div.addEventListener('click', () => { selected = +div.dataset.i; renderList(); renderForm(); });
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
      // D2：基本信息 / 输出与编译器 两组折叠
      el.innerHTML =
        '<details open class="fg"><summary>基本信息</summary>' +
        '<label><span class="field-name">目标标题</span>' +
        '<input id="f-title" value="' + escAttr(t.title) + '"></label>' +
        '<label><span class="field-name">目标类型</span>' +
        '<select id="f-type">${typeOptions}</select></label>' +
        '</details>' +
        '<details open class="fg"><summary>输出与编译器</summary>' +
        '<label><span class="field-name">输出文件</span>' +
        '<input id="f-output" value="' + escAttr(t.outputFilename) + '">' +
        '<div class="hint">相对项目根目录，如 bin/Debug/hello</div></label>' +
        '<label><span class="field-name">对象输出目录</span>' +
        '<input id="f-object" value="' + escAttr(t.objectOutput || '') + '">' +
        '<div class="hint">留空则使用默认 .objs</div></label>' +
        '<label><span class="field-name">编译器 ID</span>' +
        '<input id="f-compiler" value="' + escAttr(t.compilerId) + '"></label>' +
        '</details>' +
        '<details open class="fg"><summary>运行</summary>' +
        '<label><span class="field-name">执行参数</span>' +
        '<input id="f-params" value="' + escAttr(t.executionParameters || '') + '">' +
        '<div class="hint">运行/调试时传递给程序的命令行参数（对齐 Code::Blocks 的 Set programs’ arguments）</div></label>' +
        '</details>' +
        '<details class="fg"><summary>依赖与附加输出</summary>' +
        '<label><span class="field-name">外部依赖（每行一个）</span>' +
        '<textarea id="f-extdeps">' + esc((t.externalDeps || []).join('\\n')) + '</textarea>' +
        '<div class="hint">&lt;Option external_deps&gt;：比输出文件新时强制重链接（相对项目根，支持 $(VAR) 宏）</div></label>' +
        '<label><span class="field-name">附加输出（每行一个）</span>' +
        '<textarea id="f-addout">' + esc((t.additionalOutput || []).join('\\n')) + '</textarea>' +
        '<div class="hint">&lt;Option additional_output&gt;：外部依赖比它新时强制重链接</div></label>' +
        '</details>' +
        '<details class="fg"><summary>环境变量</summary>' +
        '<label><span class="field-name">目标环境变量（每行 name=value）</span>' +
        '<textarea id="f-envvars">' + esc((t.envVars || []).map(v => v.name + '=' + v.value).join('\\n')) + '</textarea>' +
        '<div class="hint">&lt;Environment&gt;&lt;Variable&gt;：构建/运行宏 $(NAME)（对齐 CB Build options → Custom variables；同名时目标覆盖项目）</div></label>' +
        '</details>' +
        '<details class="fg"><summary>高级</summary>' +
        '<label><span class="field-name">运行工作目录</span>' +
        '<input id="f-workdir" value="' + escAttr(t.workingDir || '') + '"><div class="hint">&lt;Option working_dir&gt;：留空 = 输出文件目录；支持 $(VAR) 宏（对齐 CB Run 工作目录）</div></label>' +
        '<label><span class="field-name">deps 输出目录</span>' +
        '<input id="f-deps" value="' + escAttr(t.depsOutput || '') + '"><div class="hint">留空 = 默认 .deps</div></label>' +
        '<label><span class="field-name">平台</span>' +
        '<span class="checks">' +
        '<label class="check"><input type="checkbox" id="f-pwin"' + ((t.platforms & 4) ? ' checked' : '') + '> Windows</label>' +
        '<label class="check"><input type="checkbox" id="f-punix"' + ((t.platforms & 2) ? ' checked' : '') + '> Unix</label>' +
        '<label class="check"><input type="checkbox" id="f-pmac"' + ((t.platforms & 1) ? ' checked' : '') + '> Mac</label>' +
        '</span><div class="hint">全选 = All（0xff）；不支持的平台在构建与目标列表中跳过（对齐 CB platforms）</div></label>' +
        '<label><span class="field-name">宿主程序（库/CommandsOnly 目标运行/调试用）</span>' +
        '<input id="f-host" value="' + escAttr(t.hostApplication || '') + '"></label>' +
        '<label class="check"><input type="checkbox" id="f-hostterm"' + (t.runHostApplicationInTerminal !== false ? ' checked' : '') + '> 宿主程序在终端运行</label>' +
        '<label class="check"><input type="checkbox" id="f-console"' + (t.useConsoleRunner !== false ? ' checked' : '') + '> 使用 console runner（结束时暂停；集成终端下为兼容项）</label>' +
        '<label><span class="field-name">import 库文件名（动态库，空 = 推导）</span>' +
        '<input id="f-implib" value="' + escAttr(t.impLib || '') + '"></label>' +
        '<label><span class="field-name">def 文件名（空 = 推导）</span>' +
        '<input id="f-deffile" value="' + escAttr(t.defFile || '') + '"></label>' +
        '<label class="check"><input type="checkbox" id="f-defchk"' + (t.createDefFile ? ' checked' : '') + '> 静态/动态库生成 DEF 文件</label>' +
        '<label class="check"><input type="checkbox" id="f-staticchk"' + (t.createStaticLib ? ' checked' : '') + '> 动态库生成 import 静态库</label>' +
        '<label class="check"><input type="checkbox" id="f-prefix"' + (t.prefixAuto !== false ? ' checked' : '') + '> 库名自动加前缀（prefix_auto）</label>' +
        '<label class="check"><input type="checkbox" id="f-ext"' + (t.extensionAuto !== false ? ' checked' : '') + '> 库名自动加扩展名（extension_auto）</label>' +
        '</details>';
      document.getElementById('f-type').value = String(t.targetType);
      ['f-title', 'f-type', 'f-output', 'f-object', 'f-compiler', 'f-params', 'f-extdeps', 'f-addout', 'f-envvars',
        'f-workdir', 'f-deps', 'f-pwin', 'f-punix', 'f-pmac', 'f-host', 'f-hostterm', 'f-console',
        'f-implib', 'f-deffile', 'f-defchk', 'f-staticchk', 'f-prefix', 'f-ext'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => collectTargetForm());
      });
    }

    function collectTargetForm() {
      if (!targets.length) return;
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
      }
      renderList();
    }

    document.getElementById('add').addEventListener('click', () => {
      collectTargetForm();
      const n = targets.length + 1;
      targets.push({ originalTitle: '', title: 'Target' + n, targetType: 1, outputFilename: 'bin/Target' + n + '/app', objectOutput: 'obj/Target' + n + '/', compilerId: data.compilerId || 'gcc', executionParameters: '', externalDeps: [], additionalOutput: [], envVars: [], workingDir: '', depsOutput: '', platforms: 255, hostApplication: '', runHostApplicationInTerminal: true, useConsoleRunner: true, impLib: '', defFile: '', createDefFile: false, createStaticLib: false, prefixAuto: true, extensionAuto: true });
      targetOpts.push({ compilerOptions: [], linkerOptions: [], linkLibs: [], relations: { compiler: 3, linker: 3, include: 3, lib: 3, res: 3 } });
      targetDirs.push({ includeDirs: [], libDirs: [], resourceDirs: [] });
      targetScripts.push({ scripts: [], before: [], after: [] });
      selected = targets.length - 1;
      renderList(); renderForm();
    });

    // D1：工具栏目标下拉切换
    document.getElementById('targetSwitch').addEventListener('change', () => {
      collectTargetForm();
      selected = Number(document.getElementById('targetSwitch').value) || 0;
      renderList(); renderForm();
    });

    document.getElementById('copy').addEventListener('click', () => {
      if (!targets.length) return;
      collectTargetForm();
      const src = targets[selected];
      targets.splice(selected + 1, 0, { ...src, originalTitle: '', title: src.title + ' copy', externalDeps: [...(src.externalDeps || [])], additionalOutput: [...(src.additionalOutput || [])], envVars: (src.envVars || []).map(v => ({ ...v })) });
      targetOpts.splice(selected + 1, 0, { compilerOptions: [...targetOpts[selected].compilerOptions], linkerOptions: [...targetOpts[selected].linkerOptions], linkLibs: [...targetOpts[selected].linkLibs], relations: { ...targetOpts[selected].relations } });
      targetDirs.splice(selected + 1, 0, { includeDirs: [...targetDirs[selected].includeDirs], libDirs: [...targetDirs[selected].libDirs], resourceDirs: [...targetDirs[selected].resourceDirs] });
      targetScripts.splice(selected + 1, 0, { scripts: [...targetScripts[selected].scripts], before: [...targetScripts[selected].before], after: [...targetScripts[selected].after] });
      selected = selected + 1;
      renderList(); renderForm();
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
      renderList(); renderForm();
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
      renderList(); renderForm();
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
        el.innerHTML = '<div class="empty">（无虚拟目标）</div>';
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
        : '<div class="hint">（无物理目标，请先在「构建目标」页添加）</div>';
      el.innerHTML =
        '<label><span class="field-name">虚拟目标别名</span>' +
        '<input id="vt-alias" value="' + escAttr(v.alias) + '">' +
        '<div class="hint">如 All</div></label>' +
        '<label><span class="field-name">包含的物理目标</span>' + targetChecks + '</label>' +
        '<div class="list-actions"><button id="vt-all">全选</button><button id="vt-none">全不选</button></div>';
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
      if (!virtualTargets.length) return;
      const v = virtualTargets[selectedVT];
      v.alias = document.getElementById('vt-alias').value.trim() || v.alias;
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
        el.innerHTML = '<div class="empty">（无文件）</div>';
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
        '<option value="">自动 (CPP)</option>' +
        '<option value="CC"' + (f.compilerVar === 'CC' ? ' selected' : '') + '>CC</option>' +
        '<option value="WINDRES"' + (f.compilerVar === 'WINDRES' ? ' selected' : '') + '>WINDRES</option>' +
        '</select>';
      const targetChecks = targets.length
        ? '<div class="checks">' + targets.map(t =>
            '<label class="check"><input type="checkbox" data-title="' + escAttr(t.title) + '"' +
            (f.buildTargets.includes(t.title) ? ' checked' : '') + '>' + esc(t.title) + '</label>'
          ).join('') + '</div>'
        : '<div class="hint">（无构建目标，请先在「构建目标」页添加）</div>';
      el.innerHTML =
        '<label><span class="field-name">编译变量</span>' + varSel +
        '<div class="hint">默认 CPP，纯 C 文件可设 CC，资源脚本设 WINDRES</div></label>' +
        '<label class="check"><input type="checkbox" id="ff-compile"' + (f.compile ? ' checked' : '') + '>' +
        '<span class="field-name" style="display:inline">编译此文件</span></label>' +
        '<label class="check"><input type="checkbox" id="ff-link"' + (f.link ? ' checked' : '') + '>' +
        '<span class="field-name" style="display:inline">链接此文件</span></label>' +
        '<label><span class="field-name">自定义构建命令</span>' +
        '<textarea id="ff-cmd" placeholder="留空 = 使用默认编译规则">' + esc(f.buildCommand) + '</textarea>' +
        '<div class="hint">留空则按编译变量自动生成命令；非空则替换默认编译器的编译命令</div></label>' +
        '<label><span class="field-name">编译权重（Weight）</span>' +
        '<input type="number" id="ff-weight" min="0" max="100" step="1" value="' + f.weight + '">' +
        '<div class="hint">0-100，默认 50；值越小越先编译（并行编译调度用）</div></label>' +
        '<label><span class="field-name">虚拟文件夹归属</span>' +
        '<input id="ff-vfolder" placeholder="留空 = 根" value="' + escAttr(f.virtualFolder) + '">' +
        '<div class="hint">虚拟文件夹名，如 Headers / Sources</div></label>' +
        '<label><span class="field-name">归属构建目标</span>' + targetChecks +
        '<div class="hint">勾选全部 = 归属所有目标（不写 target）；不勾选 = 不归属任何目标</div></label>' +
        '<div class="list-actions"><button id="ff-all">全选</button><button id="ff-none">全不选</button></div>';
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
      if (!files.length) return;
      const f = files[selectedFile];
      f.compilerVar = document.getElementById('ff-var').value;
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
        '<option value="0"' + (val === 0 ? ' selected' : '') + '>仅用父级选项</option>' +
        '<option value="1"' + (val === 1 ? ' selected' : '') + '>仅用目标选项</option>' +
        '<option value="2"' + (val === 2 ? ' selected' : '') + '>前置到父级选项前</option>' +
        '<option value="3"' + (val === 3 ? ' selected' : '') + '>追加到父级选项后（默认）</option>' +
        '</select></label>';
    }

    function renderOptionsForm() {
      const el = document.getElementById('oform');
      const scopeSel =
        '<select id="opt-scope">' +
        '<option value="project">项目级（所有目标的基础）</option>' +
        targets.map((t, i) => '<option value="' + i + '">' + esc(t.title) + '</option>').join('') +
        '</select>';
      if (selectedScope !== 'project' && selectedScope >= targets.length) selectedScope = 'project';
      const cur = selectedScope === 'project' ? projOpts : targetOpts[selectedScope];
      const relBlock = selectedScope === 'project' ? '' :
        relSel('opt-rel-compiler', cur.relations.compiler, '编译器选项关系') +
        relSel('opt-rel-linker', cur.relations.linker, '链接器选项关系') +
        relSel('opt-rel-include', cur.relations.include, 'Include 目录关系') +
        relSel('opt-rel-lib', cur.relations.lib, 'Lib 目录关系') +
        relSel('opt-rel-res', cur.relations.res, '资源目录关系');
      el.innerHTML =
        '<label><span class="field-name">作用域</span>' + scopeSel + '</label>' +
        '<label><span class="field-name">编译选项</span>' +
        '<textarea id="opt-compiler">' + esc(cur.compilerOptions.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一个选项，如 -g、-Wall、-std=c11</div></label>' +
        '<label><span class="field-name">链接选项</span>' +
        '<textarea id="opt-linker">' + esc(cur.linkerOptions.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一个链接器选项</div></label>' +
        '<label><span class="field-name">链接库</span>' +
        '<textarea id="opt-libs">' + esc(cur.linkLibs.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一个库名，如 m、pthread</div></label>' +
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
        '<option value="project">项目级（所有目标的基础）</option>' +
        targets.map((t, i) => '<option value="' + i + '">' + esc(t.title) + '</option>').join('') +
        '</select>';
      if (selectedDirScope !== 'project' && selectedDirScope >= targets.length) selectedDirScope = 'project';
      const cur = selectedDirScope === 'project' ? projDirs : targetDirs[selectedDirScope];
      el.innerHTML =
        '<label><span class="field-name">作用域</span>' + scopeSel + '</label>' +
        '<label><span class="field-name">编译器搜索目录（Include）</span>' +
        '<textarea id="dir-include">' + esc(cur.includeDirs.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一个目录，如 ../include、$(SDK)/inc</div></label>' +
        '<label><span class="field-name">链接器搜索目录（Lib）</span>' +
        '<textarea id="dir-lib">' + esc(cur.libDirs.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一个库搜索目录</div></label>' +
        '<label><span class="field-name">资源编译器搜索目录</span>' +
        '<textarea id="dir-res">' + esc(cur.resourceDirs.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一个资源搜索目录</div></label>';
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
      cur.includeDirs = optionsLines(document.getElementById('dir-include').value);
      cur.libDirs = optionsLines(document.getElementById('dir-lib').value);
      cur.resourceDirs = optionsLines(document.getElementById('dir-res').value);
    }

    // ---- 项目设置 tab ----
    function renderSettingsForm() {
      const el = document.getElementById('sform');
      el.innerHTML =
        '<label><span class="field-name">项目标题</span>' +
        '<input id="set-title" value="' + escAttr(projSettings.title) + '"></label>' +
        '<label><span class="field-name">默认编译器 ID</span>' +
        '<input id="set-compiler" value="' + escAttr(projSettings.compilerId) + '">' +
        '<div class="hint">如 gcc、riscv32-v2；目标未指定编译器时使用该值</div></label>' +
        '<label><span class="field-name">虚拟文件夹</span>' +
        '<textarea id="set-vfolders">' + esc(projSettings.virtualFolders.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一个虚拟文件夹名，如 Headers、Sources</div></label>' +
        '<label><span class="field-name">项目自定义变量（每行 name=value）</span>' +
        '<textarea id="set-vars">' + esc(projSettings.customVariables.map(v => v.name + '=' + v.value).join('\\n')) + '</textarea>' +
        '<div class="hint">构建/运行宏 $(name) 使用（扩展增强：写入 Extensions 节点；变量名不能含空格）</div></label>' +
        '<label><span class="field-name">环境变量（每行 name=value）</span>' +
        '<textarea id="set-envvars">' + esc((projSettings.envVars || []).map(v => v.name + '=' + v.value).join('\\n')) + '</textarea>' +
        '<div class="hint">写入 &lt;Environment&gt;：构建/运行宏 $(NAME)（对齐 Code::Blocks Build options → Custom variables）</div></label>' +
        '<details class="fg"><summary>工程编译与输出</summary>' +
        '<label><span class="field-name">工程平台</span>' +
        '<span class="checks">' +
        '<label class="check"><input type="checkbox" id="set-pwin"' + ((projSettings.platforms & 4) ? ' checked' : '') + '> Windows</label>' +
        '<label class="check"><input type="checkbox" id="set-punix"' + ((projSettings.platforms & 2) ? ' checked' : '') + '> Unix</label>' +
        '<label class="check"><input type="checkbox" id="set-pmac"' + ((projSettings.platforms & 1) ? ' checked' : '') + '> Mac</label>' +
        '</span><div class="hint">全选 = All（0xff）；工程不支持当前平台时整个工程跳过构建</div></label>' +
        '<label><span class="field-name">PCH 生成策略</span>' +
        '<select id="set-pch">' +
        '<option value="0">与源文件同目录（pchSourceDir）</option>' +
        '<option value="1">与对象文件同目录（pchObjectDir，默认）</option>' +
        '<option value="2">与源文件同名 .gch（pchSourceFile）</option>' +
        '</select></label>' +
        '<label class="check"><input type="checkbox" id="set-extobj"' + (projSettings.extendedObjNames ? ' checked' : '') + '> 扩展对象命名（foo.c → foo.c.o）</label>' +
        '</details>' +
        '<details class="fg"><summary>Makefile 模式</summary>' +
        '<label class="check"><input type="checkbox" id="set-mkcustom"' + (projSettings.makefileIsCustom ? ' checked' : '') + '> 使用自定义 Makefile（构建/重建/清理走 make 命令）</label>' +
        '<label><span class="field-name">Makefile 文件名</span>' +
        '<input id="set-mkfile" value="' + escAttr(projSettings.makefile || '') + '"><div class="hint">默认 Makefile</div></label>' +
        '<label><span class="field-name">执行目录</span>' +
        '<input id="set-mkdir" value="' + escAttr(projSettings.executionDir || '') + '"><div class="hint">留空 = 项目根（对齐 GetMakefileExecutionDir）</div></label>' +
        '</details>';
      document.getElementById('set-pch').value = String(projSettings.pchMode);
      ['set-title', 'set-compiler', 'set-vfolders', 'set-vars', 'set-envvars',
        'set-pwin', 'set-punix', 'set-pmac', 'set-pch', 'set-extobj', 'set-mkcustom', 'set-mkfile', 'set-mkdir'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => collectSettingsForm());
      });
    }

    function collectSettingsForm() {
      const el = document.getElementById('sform');
      if (!el || !el.querySelector('#set-title')) return;
      projSettings.title = document.getElementById('set-title').value.trim() || projSettings.title;
      projSettings.compilerId = document.getElementById('set-compiler').value.trim();
      projSettings.virtualFolders = optionsLines(document.getElementById('set-vfolders').value);
      projSettings.customVariables = parseVarLines(document.getElementById('set-vars').value);
      projSettings.envVars = parseVarLines(document.getElementById('set-envvars').value);
      const sw = document.getElementById('set-pwin').checked;
      const su = document.getElementById('set-punix').checked;
      const sm = document.getElementById('set-pmac').checked;
      projSettings.platforms = (sw && su && sm) ? 255 : ((sw ? 4 : 0) | (su ? 2 : 0) | (sm ? 1 : 0));
      projSettings.pchMode = Number(document.getElementById('set-pch').value) || 1;
      projSettings.extendedObjNames = document.getElementById('set-extobj').checked;
      projSettings.makefileIsCustom = document.getElementById('set-mkcustom').checked;
      projSettings.makefile = document.getElementById('set-mkfile').value.trim();
      projSettings.executionDir = document.getElementById('set-mkdir').value.trim();
    }

    // ---- 构建脚本 tab ----
    function renderScriptsForm() {
      const el = document.getElementById('scrform');
      const scopeSel =
        '<select id="scr-scope">' +
        '<option value="project">项目级（所有目标）</option>' +
        targets.map((t, i) => '<option value="' + i + '">' + esc(t.title) + '</option>').join('') +
        '</select>';
      if (selectedScriptScope !== 'project' && selectedScriptScope >= targets.length) selectedScriptScope = 'project';
      const cur = selectedScriptScope === 'project' ? projScripts : targetScripts[selectedScriptScope];
      el.innerHTML =
        '<label><span class="field-name">作用域</span>' + scopeSel + '</label>' +
        '<label><span class="field-name">构建脚本</span>' +
        '<textarea id="scr-list">' + esc(cur.scripts.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一个脚本文件路径，构建时依次执行</div></label>' +
        '<label><span class="field-name">构建前命令</span>' +
        '<textarea id="scr-before">' + esc(cur.before.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一条命令，构建前执行</div></label>' +
        '<label><span class="field-name">构建后命令</span>' +
        '<textarea id="scr-after">' + esc(cur.after.join('\\n')) + '</textarea>' +
        '<div class="hint">每行一条命令，构建后执行</div></label>' +
        '<label class="check"><input type="checkbox" id="scr-always"' + (cur.always ? ' checked' : '') + '> 无构建命令时也执行 post-build（Mode after=always，对齐 CB Pre/post 页）</label>';
      document.getElementById('scr-scope').value = String(selectedScriptScope);
      document.getElementById('scr-scope').addEventListener('change', () => {
        collectScriptsForm();
        selectedScriptScope = document.getElementById('scr-scope').value;
        selectedScriptScope = selectedScriptScope === 'project' ? 'project' : Number(selectedScriptScope);
        renderScriptsForm();
      });
      ['scr-list', 'scr-before', 'scr-after', 'scr-always'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => collectScriptsForm());
      });
    }

    function collectScriptsForm() {
      const el = document.getElementById('scrform');
      if (!el || !el.querySelector('#scr-list')) return;
      const cur = selectedScriptScope === 'project' ? projScripts : targetScripts[selectedScriptScope];
      cur.scripts = optionsLines(document.getElementById('scr-list').value);
      cur.before = optionsLines(document.getElementById('scr-before').value);
      cur.after = optionsLines(document.getElementById('scr-after').value);
      cur.always = document.getElementById('scr-always').checked;
    }

    // ---- 备注 tab ----
    function renderNotesForm() {
      const el = document.getElementById('ntform');
      el.innerHTML =
        '<label><span class="field-name">项目备注</span>' +
        '<textarea id="nt-text" style="min-height:180px">' + esc(notes.notes) + '</textarea></label>' +
        '<label class="check"><input type="checkbox" id="nt-show"' + (notes.showNotesOnLoad ? ' checked' : '') + '>' +
        '<span class="field-name" style="display:inline">加载项目时显示备注</span></label>';
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
      const scopes = [{ v: '', label: '项目级默认' }].concat(targets.map((t, i) => ({ v: String(i), label: t.title })));
      const scopeSel = '<select id="dbg-scope">' + scopes.map(s => '<option value="' + s.v + '">' + esc(s.label) + '</option>').join('') + '</select>';
      const scopeName = selectedDebugScope === '' ? '' : targets[Number(selectedDebugScope)].title;
      const r = selectedDebugScope === '' ? dbgRemoteFor('') : dbgRemoteFor(scopeName);
      const connSel = [[0, 'TCP (IP:端口)'], [1, 'UDP (IP:端口)'], [2, '串口 Serial']]
        .map(c => '<option value="' + c[0] + '">' + c[1] + '</option>').join('');
      el.innerHTML =
        '<label><span class="field-name">作用域</span>' + scopeSel +
        '<div class="hint">项目级默认 = 未单独配置的目标共用（对齐 CB 的 &lt;Project&gt; 行）；同名时目标覆盖项目</div></label>' +
        '<label><span class="field-name">源搜索目录（每行一个）</span>' +
        '<textarea id="dbg-paths">' + esc(dbg.searchPaths.join('\\n')) + '</textarea>' +
        '<div class="hint">调试会话向 GDB 发 directory 命令（对齐 CB debugger search paths；支持 $(VAR) 宏与相对项目根路径）</div></label>' +
        '<details open class="fg"><summary>远程目标（' + esc(scopeName || '项目级默认') + '）</summary>' +
        '<label><span class="field-name">连接类型</span><select id="dbg-conn">' + connSel + '</select></label>' +
        '<label><span class="field-name">串口</span><input id="dbg-serial" value="' + escAttr(r.serialPort) + '" placeholder="COM3 / /dev/ttyUSB0"></label>' +
        '<label><span class="field-name">波特率</span><input id="dbg-baud" value="' + escAttr(r.serialBaud) + '"></label>' +
        '<label><span class="field-name">IP 地址</span><input id="dbg-ip" value="' + escAttr(r.ip) + '"></label>' +
        '<label><span class="field-name">端口</span><input id="dbg-port" value="' + escAttr(r.ipPort) + '"></label>' +
        '<label class="check"><input type="checkbox" id="dbg-ext"' + (r.extendedRemote ? ' checked' : '') + '> 使用 extended-remote</label>' +
        '<label class="check"><input type="checkbox" id="dbg-skip"' + (r.skipLDpath ? ' checked' : '') + '> 跳过 PATH/LD_LIBRARY_PATH 注入</label>' +
        '<label><span class="field-name">连接前命令（每行一条，任意调试均执行）</span><textarea id="dbg-before">' + esc(r.additionalCmdsBefore) + '</textarea></label>' +
        '<label><span class="field-name">连接前 shell 命令（每行一条）</span><textarea id="dbg-before-shell">' + esc(r.additionalShellCmdsBefore) + '</textarea></label>' +
        '<label><span class="field-name">连接后命令（每行一条）</span><textarea id="dbg-after">' + esc(r.additionalCmds) + '</textarea></label>' +
        '<label><span class="field-name">连接后 shell 命令（每行一条）</span><textarea id="dbg-after-shell">' + esc(r.additionalShellCmdsAfter) + '</textarea></label>' +
        '<div class="hint">连接顺序（对齐 CB）：连接前命令 → 连接前 shell → [set remotebaud] → target [extended-]remote → 连接后命令 → 连接后 shell；有效连接（串口需端口+波特率；TCP/UDP 需 IP+端口）时启动用 continue 而非 run</div>' +
        '</details>';
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
      const scopeName = selectedDebugScope === '' ? '' : targets[Number(selectedDebugScope)].title;
      const cur = dbgRemoteFor(scopeName);
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

    // ---- 保存 ----
    function doSave(close) {
      collectTargetForm();
      collectVTForm();
      collectFileForm();
      collectOptionsForm();
      collectDirsForm();
      collectScriptsForm();
      collectSettingsForm();
      collectNotesForm();
      collectDebugForm();
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
        document.getElementById('status').textContent = '已保存 ✓';
      } else if (e.data.type === 'error') {
        document.getElementById('status').textContent = '保存失败: ' + e.data.message;
      }
    });

    renderList(); renderForm();
    renderVTList();
    renderFileList();
    switchTab(activeTab);
  </script>
</body>
</html>`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private async onMessage(msg: any): Promise<void> {
    // R9：导出选中目标为独立工程（宿主命令）
    if (msg.type === 'exportTarget') {
      await vscode.commands.executeCommand('codeblocks.exportTargetAsProject', String(msg.target ?? ''));
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
