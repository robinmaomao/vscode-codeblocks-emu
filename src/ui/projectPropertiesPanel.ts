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

/** WebView 前后端交换的目标编辑数据 */
export interface TargetEditData {
  /** 原始标题（识别目标的 key，重命名时保持不变；新目标为空字符串） */
  originalTitle: string;
  title: string;
  targetType: number;
  outputFilename: string;
  objectOutput: string;
  compilerId: string;
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

/** 项目设置（标题 / 默认编译器 / 虚拟文件夹） */
export interface ProjectSettingsEditData {
  title: string;
  compilerId: string;
  virtualFolders: string[];
}

/** 构建脚本 + pre/post build 命令（作用域：项目级 + 各目标，目标项按 targets 数组顺序对齐） */
export interface ScriptItemEditData {
  /** 构建脚本（<Script file>） */
  scripts: string[];
  /** 构建前命令（<ExtraCommands><Add before>） */
  before: string[];
  /** 构建后命令（<ExtraCommands><Add after>） */
  after: string[];
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
    ) => Promise<void>,
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
    ) => Promise<void>,
  ): void {
    ProjectPropertiesPanel.current?.dispose();
    ProjectPropertiesPanel.current = new ProjectPropertiesPanel(project, extensionUri, onSave);
  }

  private buildHtml(): string {
    const targets: TargetEditData[] = this.project.buildTargets.map((t) => ({
      originalTitle: t.title,
      title: t.title,
      targetType: t.targetType,
      outputFilename: t.outputFilename,
      objectOutput: t.objectOutput,
      compilerId: t.compilerId,
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
    };

    const projectScripts = {
      scripts: [...this.project.buildScripts],
      before: [...this.project.commandsBeforeBuild],
      after: [...this.project.commandsAfterBuild],
    };
    const targetScripts = this.project.buildTargets.map((t) => ({
      scripts: [...t.buildScripts],
      before: [...t.commandsBeforeBuild],
      after: [...t.commandsAfterBuild],
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

    const typeOptions = Object.entries(TARGET_TYPE_NAMES)
      .map(([v, name]) => `<option value="${v}">${this.escapeHtml(name)}</option>`)
      .join('');

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
    let projSettings = { title: data.projectSettings.title, compilerId: data.projectSettings.compilerId, virtualFolders: [...data.projectSettings.virtualFolders] };
    let projScripts = { scripts: [...data.projectScripts.scripts], before: [...data.projectScripts.before], after: [...data.projectScripts.after] };
    let targetScripts = data.targetScripts.map(s => ({ scripts: [...s.scripts], before: [...s.before], after: [...s.after] }));
    let notes = { notes: data.notes.notes, showNotesOnLoad: data.notes.showNotesOnLoad };
    let virtualTargets = data.virtualTargets.map(v => ({ ...v, targets: [...v.targets] }));
    let selected = 0;
    let selectedFile = 0;
    let selectedVT = 0;
    let selectedScope = 'project';
    let selectedDirScope = 'project';
    let selectedScriptScope = 'project';
    let activeTab = 'targets';

    function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
    function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }

    // ---- tab 切换 ----
    function switchTab(tab) {
      activeTab = tab;
      ['targets', 'vtargets', 'files', 'options', 'dirs', 'scripts', 'settings', 'notes'].forEach(name => {
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
    }
    document.getElementById('tabbtn-targets').addEventListener('click', () => { collectTargetForm(); switchTab('targets'); });
    document.getElementById('tabbtn-vtargets').addEventListener('click', () => { collectTargetForm(); switchTab('vtargets'); });
    document.getElementById('tabbtn-files').addEventListener('click', () => { collectTargetForm(); switchTab('files'); });
    document.getElementById('tabbtn-options').addEventListener('click', () => { collectTargetForm(); switchTab('options'); });
    document.getElementById('tabbtn-dirs').addEventListener('click', () => { collectTargetForm(); switchTab('dirs'); });
    document.getElementById('tabbtn-scripts').addEventListener('click', () => { collectTargetForm(); switchTab('scripts'); });
    document.getElementById('tabbtn-settings').addEventListener('click', () => { collectTargetForm(); switchTab('settings'); });
    document.getElementById('tabbtn-notes').addEventListener('click', () => { collectTargetForm(); switchTab('notes'); });

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
        '</details>';
      document.getElementById('f-type').value = String(t.targetType);
      ['f-title', 'f-type', 'f-output', 'f-object', 'f-compiler'].forEach(id => {
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
      targets.push({ originalTitle: '', title: 'Target' + n, targetType: 1, outputFilename: 'bin/Target' + n + '/app', objectOutput: 'obj/Target' + n + '/', compilerId: data.compilerId || 'gcc' });
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
      targets.splice(selected + 1, 0, { ...src, originalTitle: '', title: src.title + ' copy' });
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
        '<div class="hint">每行一个虚拟文件夹名，如 Headers、Sources</div></label>';
      ['set-title', 'set-compiler', 'set-vfolders'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => collectSettingsForm());
      });
    }

    function collectSettingsForm() {
      const el = document.getElementById('sform');
      if (!el || !el.querySelector('#set-title')) return;
      projSettings.title = document.getElementById('set-title').value.trim() || projSettings.title;
      projSettings.compilerId = document.getElementById('set-compiler').value.trim();
      projSettings.virtualFolders = optionsLines(document.getElementById('set-vfolders').value);
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
        '<div class="hint">每行一条命令，构建后执行</div></label>';
      document.getElementById('scr-scope').value = String(selectedScriptScope);
      document.getElementById('scr-scope').addEventListener('change', () => {
        collectScriptsForm();
        selectedScriptScope = document.getElementById('scr-scope').value;
        selectedScriptScope = selectedScriptScope === 'project' ? 'project' : Number(selectedScriptScope);
        renderScriptsForm();
      });
      ['scr-list', 'scr-before', 'scr-after'].forEach(id => {
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
  </script>
</body>
</html>`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg.type === 'save') {
      const targets: TargetEditData[] = (msg.targets ?? []).map((t: any) => ({
        originalTitle: String(t.originalTitle ?? ''),
        title: String(t.title ?? ''),
        targetType: Number(t.targetType ?? 0),
        outputFilename: String(t.outputFilename ?? ''),
        objectOutput: String(t.objectOutput ?? ''),
        compilerId: String(t.compilerId ?? this.project.compilerId),
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
      };
      const scriptItem = (o: any) => ({
        scripts: strArr(o?.scripts),
        before: strArr(o?.before),
        after: strArr(o?.after),
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
      try {
        await this.onSave(targets, files, options, searchDirs, projectSettings, buildScripts, notes, virtualTargets);
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
