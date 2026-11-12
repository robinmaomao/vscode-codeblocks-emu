/**
 * Build options 共享视图 —— 对应 Code::Blocks compileroptionsdlg.cpp（工程/目标模式）。
 *
 * 同一份 CSS/HTML/JS 同时用于：
 *  - 独立 Build options 面板（buildOptionsPanel.ts）
 *  - 工程属性面板内的页内模态覆盖层（projectPropertiesPanel.ts）
 */
import * as i18n from '../i18n';

/** 单个作用域（工程或一个构建目标）的构建选项 */
export interface BuildOptionsScopeData {
  title: string;
  compilerId: string;
  compilerOptions: string[];
  resourceCompilerOptions: string[];
  linkerOptions: string[];
  linkLibs: string[];
  linkerExecutable: number;
  relations: {
    compiler: number;
    linker: number;
    include: number;
    lib: number;
    res: number;
  };
  includeDirs: string[];
  libDirs: string[];
  resourceDirs: string[];
  commandsBefore: string[];
  commandsAfter: string[];
  alwaysPost: boolean;
  envVars: Array<{ name: string; value: string }>;
  makeCommands: {
    build?: string;
    compileFile?: string;
    clean?: string;
    distClean?: string;
    askRebuildNeeded?: string;
    silentBuild?: string;
  };
}

export interface BuildOptionsCompilerOption {
  name: string;
  option: string;
  additionalLibs?: string;
  category: string;
  /** 用户新增的参数（可编辑/删除） */
  custom?: boolean;
  /** 覆盖了内置参数的条目（可编辑/恢复） */
  modified?: boolean;
  /** 覆盖/删除时对应的原始 option */
  baseOption?: string;
}

export interface BuildOptionsCompilerInfo {
  id: string;
  name: string;
}

/** 仅 C / 仅 C++ 编译参数（按编译器） */
export interface BuildOptionsLanguageFlags {
  cOnly: string[];
  cppOnly: string[];
}

export interface BuildOptionsData {
  projectTitle: string;
  makefileIsCustom: boolean;
  defineSwitch: string;
  project: BuildOptionsScopeData;
  targets: BuildOptionsScopeData[];
  compilers: BuildOptionsCompilerInfo[];
  /** 扩展设置中的默认编译器（工程未声明 compiler 时的回退，对齐 CB 的 gcc 缺省） */
  defaultCompilerId?: string;
  /** 合并用户覆盖后的目录（UI 使用） */
  compilerCatalogs: Record<string, BuildOptionsCompilerOption[]>;
  /** 未合并的编译器原始目录（编辑后重新合并用） */
  compilerBaseCatalogs?: Record<string, BuildOptionsCompilerOption[]>;
  compilerFlags?: Record<string, BuildOptionsLanguageFlags>;
}

/** 视图文案（一次性翻译，供内联脚本使用） */
function labels(): Record<string, string> {
  return {
    projectBuildOptions: i18n.t('Project build options'),
    targetBuildOptions: i18n.t('Target build options: {0}'),
    selectedCompiler: i18n.t('Selected compiler'),
    notFound: i18n.t('not found'),
    compilerSettings: i18n.t('Compiler settings'),
    linkerSettings: i18n.t('Linker settings'),
    searchDirectories: i18n.t('Search directories'),
    prePost: i18n.t('Pre/post build steps'),
    customVariables: i18n.t('Custom variables'),
    makeCommands: i18n.t('"Make" commands'),
    policy: i18n.t('Policy:'),
    useProjectOnly: i18n.t('Use project options only'),
    useTargetOnly: i18n.t('Use target options only'),
    prepend: i18n.t('Prepend target options to project options'),
    append: i18n.t('Append target options to project options'),
    compilerFlags: i18n.t('Compiler Flags'),
    otherCompiler: i18n.t('Other compiler options'),
    otherResource: i18n.t('Other resource compiler options'),
    defines: i18n.t('#defines'),
    linkLibraries: i18n.t('Link libraries:'),
    otherLinker: i18n.t('Other linker options:'),
    linkerExecutable: i18n.t('Linker executable:'),
    autoDetect: i18n.t('Auto-detect'),
    cCompiler: i18n.t('C compiler'),
    cppCompiler: i18n.t('C++ compiler'),
    linker: i18n.t('Linker'),
    compilerDirs: i18n.t('Compiler'),
    linkerDirs: i18n.t('Linker'),
    resDirs: i18n.t('Resource compiler'),
    preBuild: i18n.t('Pre-build steps'),
    postBuild: i18n.t('Post-build steps'),
    alwaysPost: i18n.t('Always execute, even if target is up-to-date'),
    variables: i18n.t('Variables:'),
    varsHint: i18n.t('These variables can be used in compiler and/or linker options.\nUse them as compiler/linker options this way: $(varname)'),
    makeHint: i18n.t('IMPORTANT: These commands are ONLY used when the project is using a custom Makefile.'),
    buildTarget: i18n.t('Build project/target:'),
    compileSingle: i18n.t('Compile single file:'),
    cleanTarget: i18n.t('Clean project/target:'),
    distCleanTarget: i18n.t('Dist-clean project/target:'),
    askRebuild: i18n.t('Ask if rebuild is needed:'),
    silentBuild: i18n.t('Silent build:'),
    knownVars: i18n.t('Known variables: $make, $makefile, $target, $file and all macro variables'),
    add: i18n.t('Add'),
    edit: i18n.t('Edit'),
    delete: i18n.t('Delete'),
    clear: i18n.t('Clear'),
    copySelected: i18n.t('Copy selected to...'),
    copyTo: i18n.t('Copy to...'),
    up: i18n.t('Up'),
    down: i18n.t('Down'),
    save: i18n.t('Save'),
    saveClose: i18n.t('Save and Close'),
    close: i18n.t('Close'),
    saved: i18n.t('Saved ✔️'),
    saveFailed: i18n.t('Save failed:'),
    enterValue: i18n.t('Enter a value'),
    confirmDelete: i18n.t('Delete the selected item?'),
    selectTargets: i18n.t('Please select which target to copy these entries to:'),
    ok: i18n.t('OK'),
    cancel: i18n.t('Cancel'),
    noItems: i18n.t('(empty)'),
    otherCategory: i18n.t('Other'),
    flagsNote: i18n.t('NOTE: Right-click to setup or edit compiler flags.'),
    newFlag: i18n.t('New flag...'),
    modifyFlag: i18n.t('Modify flag...'),
    deleteFlag: i18n.t('Delete flag'),
    cOnlyFlags: i18n.t('C - only flags...'),
    cppOnlyFlags: i18n.t('C++ - only flags...'),
    cOnlyTitle: i18n.t('C - only flags'),
    cppOnlyTitle: i18n.t('C++ - only flags'),
    cOnlyHint: i18n.t('List flags that will only be used during C compilation'),
    cppOnlyHint: i18n.t('List flags that will only be used during C++ compilation'),
    expandAll: i18n.t('Expand all categories'),
    collapseAll: i18n.t('Collapse all categories'),
    builtinDeleteConfirm: i18n.t(
      'Delete this built-in compiler flag?\nYou can restore the defaults by clearing "codeblocks.compiler.flagOverrides" in Settings.',
    ),
    customFlagsSaved: i18n.t('Saved ✔️'),
    flagName: i18n.t('Name'),
    flagOption: i18n.t('Option'),
    flagCategory: i18n.t('Category'),
    flagRequired: i18n.t('Both name and option are required.'),
    moreCommands: i18n.t('More commands'),
    silentBuildHint: i18n.t('Read-only: Code::Blocks derives it from the build command (Build + " > $(CMD_NULL)") and rewrites it when saving.'),
    distCleanHint: i18n.t('Read-only: only used by scripts/SDK calls. This extension has no Dist-clean command.'),
  };
}

/** 共享 CSS（仅作用于 .bo-* 类名） */
export function buildOptionsCss(): string {
  return `
  .bo-root {
    --bo-border: var(--vscode-widget-border, rgba(128,128,128,.35));
    --bo-radius: 6px;
    --bo-control-radius: 3px;
    --bo-surface: var(--vscode-editorWidget-background, var(--vscode-editor-background));
    --bo-surface-muted: var(--vscode-sideBar-background, rgba(128,128,128,.06));
    display: flex; flex-direction: column; height: 100%; min-height: 0;
    color: var(--vscode-foreground); background: var(--vscode-editor-background);
  }
  .bo-overlay { --bo-border: var(--vscode-widget-border, rgba(128,128,128,.35)); --bo-radius: 6px; --bo-control-radius: 3px; position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.52); backdrop-filter: blur(2px); }
  .bo-overlay .bo-dialog { width: min(1040px, 100%); height: min(760px, 100%); background: var(--vscode-editor-background); border: 1px solid var(--bo-border); border-radius: 8px; box-shadow: 0 18px 48px rgba(0,0,0,.5); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .bo-header { display: flex; align-items: center; gap: 16px; min-height: 46px; padding: 0 16px; border-bottom: 1px solid var(--bo-border); background: var(--vscode-sideBarSectionHeader-background, var(--bo-surface)); flex: none; }
  .bo-title { font-weight: 600; font-size: 14px; line-height: 20px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bo-compiler-box { margin-left: auto; display: flex; align-items: center; gap: 8px; color: var(--vscode-descriptionForeground); font-size: 12px; flex: none; white-space: nowrap; }
  .bo-compiler-box select { width: 220px; min-width: 150px; }
  .bo-main { flex: 1; display: flex; min-height: 0; }
  .bo-tree { width: 220px; flex: none; border-right: 1px solid var(--bo-border); overflow: auto; padding: 8px; background: var(--bo-surface-muted); }
  .bo-node { position: relative; display: flex; align-items: center; min-height: 30px; padding: 0 10px; border-radius: var(--bo-control-radius); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--vscode-foreground); }
  .bo-node:hover { background: var(--vscode-list-hoverBackground); }
  .bo-node.selected { background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground)); box-shadow: inset 2px 0 0 var(--vscode-focusBorder); font-weight: 600; }
  .bo-node:first-child { margin-bottom: 6px; font-weight: 600; }
  .bo-node.child { padding-left: 30px; color: var(--vscode-sideBar-foreground, var(--vscode-foreground)); }
  .bo-node.child::before { content: ''; position: absolute; left: 14px; top: 50%; width: 8px; height: 1px; background: var(--bo-border); }
  .bo-content { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .bo-tabs { display: flex; gap: 1px; overflow-x: auto; overflow-y: hidden; padding: 0 10px; border-bottom: 1px solid var(--bo-border); background: var(--vscode-editor-background); flex: none; scrollbar-width: thin; }
  .bo-tabs::-webkit-scrollbar { height: 4px; }
  .bo-tabs::-webkit-scrollbar-thumb { background: var(--vscode-scrollbarSlider-background, rgba(128,128,128,.45)); border-radius: 2px; }
  .bo-root .bo-tab { flex: none; background: transparent; color: var(--vscode-descriptionForeground); border: none; border-bottom: 2px solid transparent; border-radius: 0; padding: 10px 8px 8px; cursor: pointer; font-size: 12px; line-height: 16px; white-space: nowrap; }
  .bo-root .bo-tab:hover { color: var(--vscode-foreground); background: var(--vscode-list-hoverBackground); }
  .bo-root .bo-tab.active { color: var(--vscode-foreground); border-bottom-color: var(--vscode-focusBorder); font-weight: 600; background: transparent; }
  .bo-page { flex: 1; overflow: auto; padding: 16px 20px 24px; min-height: 0; }
  .bo-page-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; max-width: 1080px; }
  .bo-page-grid > .span-2 { grid-column: 1 / -1; }
  .bo-card { border: 1px solid var(--bo-border); border-radius: var(--bo-radius); background: var(--bo-surface); overflow: hidden; min-width: 0; }
  .bo-card.span-2 { grid-column: 1 / -1; }
  .bo-card-head { padding: 9px 12px; border-bottom: 1px solid var(--bo-border); background: var(--vscode-sideBarSectionHeader-background, transparent); font-size: 12px; font-weight: 600; }
  .bo-card-body { padding: 12px; }
  .bo-card-body > :last-child { margin-bottom: 0; }
  .bo-footer { flex: none; display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 0 16px; border-top: 1px solid var(--bo-border); background: var(--vscode-sideBarSectionHeader-background, var(--bo-surface)); }
  .bo-root button, .bo-dialog button, .bo-modal button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: 1px solid transparent; padding: 5px 10px; border-radius: var(--bo-control-radius); cursor: pointer; white-space: nowrap; font-family: var(--vscode-font-family); font-size: 12px; line-height: 16px; }
  .bo-root button:hover, .bo-dialog button:hover, .bo-modal button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .bo-root button.primary, .bo-dialog button.primary, .bo-modal button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .bo-root button.primary:hover, .bo-dialog button.primary:hover, .bo-modal button.primary:hover { background: var(--vscode-button-hoverBackground); }
  .bo-root button.danger, .bo-dialog button.danger, .bo-modal button.danger { background: transparent; color: var(--vscode-errorForeground, #f48771); border-color: transparent; }
  .bo-root button.danger:hover, .bo-dialog button.danger:hover, .bo-modal button.danger:hover { background: rgba(244,135,113,.12); }
  .bo-root button:disabled, .bo-dialog button:disabled, .bo-modal button:disabled { opacity: .5; cursor: default; }
  .bo-root button:focus-visible, .bo-dialog button:focus-visible, .bo-modal button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .bo-status { margin-left: auto; color: var(--vscode-descriptionForeground); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .bo-field { display: block; margin: 0; }
  .bo-field > .bo-label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; color: var(--vscode-foreground); }
  .bo-field input[type=text], .bo-field select, .bo-field textarea, .bo-inline input, .bo-inline select,
  .bo-root input[type=text], .bo-root select, .bo-root textarea, .bo-dialog input[type=text], .bo-dialog select, .bo-dialog textarea,
  .bo-modal input[type=text], .bo-modal select, .bo-modal textarea {
    width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, var(--bo-border)); border-radius: var(--bo-control-radius); padding: 5px 7px;
    font-family: var(--vscode-font-family); font-size: 12px; line-height: 18px;
  }
  .bo-root select, .bo-dialog select, .bo-modal select { background: var(--vscode-dropdown-background, var(--vscode-input-background)); color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground)); border-color: var(--vscode-dropdown-border, var(--vscode-input-border, var(--bo-border))); }
  .bo-root input:focus, .bo-root select:focus, .bo-root textarea:focus,
  .bo-dialog input:focus, .bo-dialog select:focus, .bo-dialog textarea:focus,
  .bo-modal input:focus, .bo-modal select:focus, .bo-modal textarea:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; border-color: var(--vscode-focusBorder); }
  .bo-field textarea { min-height: 86px; resize: vertical; font-family: var(--vscode-editor-font-family); line-height: 1.45; }
  .bo-modal input[type=checkbox], .bo-root input[type=checkbox] { width: 16px; height: 16px; flex: none; accent-color: var(--vscode-checkbox-background, var(--vscode-focusBorder)); }
  .bo-inline { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .bo-inline .bo-label { flex: none; }
  .bo-inline input, .bo-inline select { flex: 1; min-width: 0; }
  .bo-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 2px 0 0; }
  .bo-checks label { display: inline-flex; align-items: center; gap: 6px; }
  .bo-group { border: none; border-bottom: 1px solid var(--bo-border); margin: 0; padding: 0; }
  .bo-group:last-child { border-bottom: none; }
  .bo-group > summary { cursor: pointer; padding: 7px 2px; font-size: 12px; font-weight: 600; color: var(--vscode-foreground); background: transparent; list-style-position: inside; }
  .bo-group-body { padding: 2px 0 6px; }
  .bo-opt { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 2px 6px; border-radius: var(--bo-control-radius); }
  .bo-opt:hover { background: var(--vscode-list-hoverBackground); }
  .bo-opt .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .bo-opt code { color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; white-space: nowrap; font-size: 11px; }
  .bo-list { border: 1px solid var(--bo-border); border-radius: var(--bo-control-radius); max-height: 220px; min-height: 96px; overflow: auto; background: var(--vscode-input-background, transparent); }
  .bo-list .row { display: flex; align-items: center; gap: 8px; min-height: 28px; padding: 2px 8px; cursor: default; border-left: 2px solid transparent; }
  .bo-list .row:hover { background: var(--vscode-list-hoverBackground); }
  .bo-list .row.selected { background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground)); border-left-color: var(--vscode-focusBorder); }
  .bo-list .row .txt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bo-list .empty { padding: 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
  .bo-actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 0; padding-top: 8px; border-top: 1px solid var(--bo-border); }
  .bo-actions button { padding: 4px 8px; }
  .bo-hint { color: var(--vscode-descriptionForeground); font-size: 12px; line-height: 1.45; margin-top: 6px; }
  .bo-note { color: var(--vscode-foreground); margin: 0 0 12px; padding: 8px 10px; border-left: 3px solid var(--vscode-editorWarning-foreground, #cca700); border-radius: 0 4px 4px 0; background: var(--vscode-inputValidation-warningBackground, rgba(204,167,0,.1)); font-size: 12px; line-height: 1.45; }
  .bo-subtabs { display: inline-flex; gap: 2px; margin-bottom: 12px; padding: 2px; border: 1px solid var(--bo-border); border-radius: 4px; background: var(--vscode-input-background); }
  .bo-root .bo-subtab { padding: 4px 10px; cursor: pointer; border: none; border-radius: 3px; background: transparent; color: var(--vscode-descriptionForeground); font-size: 12px; }
  .bo-root .bo-subtab:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
  .bo-root .bo-subtab.active { background: var(--vscode-list-inactiveSelectionBackground, var(--vscode-list-hoverBackground)); color: var(--vscode-foreground); font-weight: 600; }
  .bo-modal { --bo-border: var(--vscode-widget-border, rgba(128,128,128,.35)); --bo-radius: 6px; --bo-control-radius: 3px; position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0,0,0,.52); backdrop-filter: blur(2px); }
  .bo-modal-box { width: min(560px, 100%); max-height: min(80vh, 680px); overflow: auto; background: var(--vscode-editorWidget-background, var(--vscode-editor-background)); border: 1px solid var(--bo-border); border-radius: var(--bo-radius); box-shadow: 0 18px 48px rgba(0,0,0,.5); }
  .bo-modal-title { font-weight: 600; font-size: 13px; padding: 13px 16px; margin: 0; border-bottom: 1px solid var(--bo-border); background: var(--vscode-sideBarSectionHeader-background, transparent); display: flex; align-items: center; justify-content: space-between; gap: 8px; position: sticky; top: 0; z-index: 1; }
  .bo-modal-title > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bo-modal .bo-modal-x { background: transparent; color: var(--vscode-descriptionForeground); border: none; padding: 0 2px; font-size: 18px; line-height: 18px; min-width: 24px; }
  .bo-modal .bo-modal-x:hover { background: var(--vscode-list-hoverBackground); color: var(--vscode-foreground); }
  .bo-modal-body { padding: 14px 16px; }
  .bo-modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 11px 16px; border-top: 1px solid var(--bo-border); background: var(--vscode-sideBarSectionHeader-background, transparent); position: sticky; bottom: 0; }
  /* ---- Code::Blocks 对齐覆盖 ---- */
  .bo-header { min-height: 38px; padding: 0 12px; gap: 8px; }
  .bo-title { font-size: 13px; }
  .bo-compiler-group {
    flex: none; margin: 8px 12px 0; padding: 6px 10px 10px; min-width: 0;
    border: 1px solid var(--bo-border); border-radius: 4px; background: var(--bo-surface);
  }
  .bo-compiler-group > legend { padding: 0 4px; font-size: 12px; color: var(--vscode-foreground); }
  .bo-compiler-box { display: block; margin: 0; font-size: 12px; }
  .bo-compiler-box select { width: 100%; }
  .bo-tree { width: 190px; padding: 6px; }
  .bo-node { min-height: 26px; gap: 6px; padding: 0 6px; }
  .bo-node-icon { display: inline-flex; width: 14px; height: 14px; flex: none; opacity: .85; }
  .bo-node-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .bo-node.child { padding-left: 22px; }
  .bo-node.child::before { left: 12px; }
  .bo-page { padding: 12px 16px 18px; }
  .bo-page-fill { display: flex; flex-direction: column; overflow: hidden; }
  .bo-policy-row { display: grid; grid-template-columns: max-content minmax(0, 1fr); align-items: center; gap: 10px; margin-bottom: 8px; }
  .bo-policy-label { font-size: 12px; white-space: nowrap; }
  .bo-root .bo-policy-row select { width: 260px; max-width: 100%; }
  .bo-preline { white-space: pre-line; }
  .bo-policy-row select:disabled { opacity: .65; }
  .bo-sep { height: 1px; background: var(--bo-border); margin: 0 0 10px; }
  .bo-field-label { font-size: 12px; font-weight: 600; margin-bottom: 6px; }
  .bo-flag-list { height: 260px; overflow: auto; border: 1px solid var(--bo-border); border-radius: var(--bo-control-radius); background: var(--vscode-input-background, transparent); }
  .bo-flag-list .empty { padding: 12px; color: var(--vscode-descriptionForeground); font-style: italic; }
  .bo-flag-row { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 2px 8px; border-left: 2px solid transparent; }
  .bo-flag-row:hover { background: var(--vscode-list-hoverBackground); }
  .bo-flag-row.collapsed-child { display: none; }
  .bo-group-head { display: flex; align-items: center; gap: 6px; min-height: 26px; padding: 2px 8px; cursor: pointer; font-weight: 600; font-size: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBarSectionHeader-background, rgba(128,128,128,.08)); border-bottom: 1px solid var(--bo-border); }
  .bo-group-head:hover { background: var(--vscode-list-hoverBackground); }
  .bo-group-arrow { width: 12px; flex: none; font-size: 10px; color: var(--vscode-descriptionForeground); text-align: center; }
  .bo-group-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bo-group-count { flex: none; font-weight: 400; font-size: 11px; color: var(--vscode-descriptionForeground); }
  .bo-flag-row .bo-flag-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bo-flag-row code { flex: none; color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; font-size: 11px; white-space: nowrap; }
  .bo-flag-row input[type=checkbox] { flex: none; margin: 0 0 0 4px; }
  .bo-flag-row.custom .bo-flag-name { color: var(--vscode-textLink-foreground); }
  .bo-flag-row.modified .bo-flag-name { color: var(--vscode-textLink-foreground); font-style: italic; }
  .bo-red-note { color: var(--vscode-errorForeground, #f48771); font-size: 12px; line-height: 1.45; margin: 8px 0 0; }
  .bo-fixed-text { height: 260px; min-height: 260px; max-height: 260px; resize: none; }
  .bo-list-row { display: flex; align-items: stretch; gap: 6px; }
  .bo-list-main { flex: 1; min-width: 0; }
  .bo-move-buttons { display: flex; flex-direction: column; justify-content: center; gap: 6px; flex: none; }
  .bo-move-buttons button {
    width: 28px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.18));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
    border: 1px solid var(--vscode-button-border, var(--bo-border));
    border-radius: var(--bo-control-radius);
  }
  .bo-move-buttons button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.3)); }
  .bo-move-buttons button:active:not(:disabled) { transform: translateY(1px); }
  .bo-move-buttons button:disabled { opacity: .4; cursor: default; }
  .bo-move-buttons svg { width: 14px; height: 14px; }
  .bo-list { height: 260px; min-height: 260px; max-height: 260px; }
  .bo-page-fill > .bo-card { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bo-page-fill > .bo-card > .bo-card-body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bo-page-fill .bo-subpage { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .bo-page-fill .bo-flag-list { flex: 1; height: auto; min-height: 180px; max-height: none; }
  .bo-page-fill .bo-fixed-text { flex: 1; height: auto; min-height: 180px; max-height: none; }
  @media (max-width: 560px) {
    .bo-label-grid { grid-template-columns: minmax(0, 1fr); }
  }
  .bo-actions { margin-top: 8px; padding-top: 0; border-top: none; }
  .bo-actions + .bo-actions { margin-top: 6px; }
  .bo-root .bo-actions button {
    padding: 4px 12px; min-height: 26px;
    border: 1px solid var(--vscode-button-border, var(--bo-border));
    background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.18));
    color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
  }
  .bo-root .bo-actions button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.3)); }
  .bo-root .bo-actions button[data-act=add] { border-color: var(--vscode-focusBorder); }
  .bo-root .bo-actions button:disabled { opacity: .4; cursor: default; }
  .bo-modal-wide .bo-modal-box, .bo-modal-box.bo-modal-wide { width: min(560px, 100%); }
  .bo-hint { font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .bo-more-hint { margin: 6px 0 0; }
  .bo-derived-input { background: var(--vscode-input-background); color: var(--vscode-descriptionForeground); cursor: default; }
  .bo-root .bo-derived-input:focus { outline: none; border-color: var(--vscode-input-border, var(--bo-border)); }
  .bo-flags-text { width: 100%; height: 190px; box-sizing: border-box; resize: vertical; font-family: var(--vscode-editor-font-family); font-size: 12px; line-height: 1.45; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, var(--bo-border)); border-radius: var(--bo-control-radius); padding: 6px 8px; }
  .bo-menu-sep { height: 1px; margin: 3px 4px; background: var(--vscode-menu-separatorBackground, var(--bo-border)); }
  .bo-confirm-text { white-space: pre-line; font-size: 12px; line-height: 1.55; }
  .bo-inline-row { display: flex; align-items: center; gap: 8px; }
  .bo-inline-label { font-size: 12px; white-space: nowrap; }
  .bo-inline-select { width: 220px; flex: none; }
  .bo-root .bo-inline-row .bo-inline-select { width: 220px; flex: 0 0 auto; }
  .bo-label-grid { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 10px; align-items: center; }
  .bo-label-grid > label { font-size: 12px; white-space: nowrap; }
  .bo-label-grid input { min-width: 0; }
  .bo-more { margin-top: 14px; border-top: 1px solid var(--bo-border); padding-top: 8px; }
  .bo-more > summary { cursor: pointer; font-size: 12px; color: var(--vscode-descriptionForeground); margin-bottom: 8px; }
  .bo-extras { display: flex; flex-direction: column; gap: 12px; height: 100%; min-height: 0; }
  .bo-extras .bo-card { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .bo-extras .bo-card-body { flex: 1; display: flex; flex-direction: column; min-height: 0; }
  .bo-extras textarea { flex: 1; min-height: 150px; resize: vertical; }
  .bo-card-body > .bo-vars-list .bo-list { height: 300px; min-height: 300px; max-height: 300px; }
  .bo-root button.default, .bo-modal button.default { border-color: var(--vscode-focusBorder); }
  .bo-footer { justify-content: flex-start; }
  .bo-toolbar { display: inline-flex; align-items: center; gap: 8px; }
  .bo-check { display: inline-flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 12px; }
  .bo-check input[type=checkbox] { width: 16px; height: 16px; flex: none; accent-color: var(--vscode-checkbox-background, var(--vscode-focusBorder)); }
  .bo-menu { position: fixed; z-index: 90; min-width: 180px; padding: 4px; display: flex; flex-direction: column; gap: 2px; background: var(--vscode-menu-background, var(--vscode-editorWidget-background, var(--vscode-editor-background, #252526))); border: 1px solid var(--vscode-menu-border, var(--bo-border)); border-radius: 4px; box-shadow: 0 6px 18px rgba(0,0,0,.4); }
  .bo-menu button { text-align: left; background: transparent; color: var(--vscode-menu-foreground, var(--vscode-foreground)); border: none; border-radius: 3px; padding: 5px 10px; }
  .bo-menu button:hover { background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground)); color: var(--vscode-menu-selectionForeground, var(--vscode-list-activeSelectionForeground)); }
  @media (max-width: 800px) {
    .bo-page-grid { grid-template-columns: minmax(0, 1fr); }
    .bo-tree { width: 160px; }
    .bo-compiler-group { margin: 8px 8px 0; }
    .bo-extras { height: auto; }
    .bo-overlay { padding: 12px; }
  }
  `;
}
/** 共享 HTML 片段（不含 <html>/<body>） */
export function buildOptionsMarkup(embedded = false): string {
  return `<div class="bo-root">
  <div class="bo-header">
    <span class="bo-title" id="bo-title"></span>
  </div>
  <div class="bo-main">
    <div class="bo-tree" id="bo-tree"></div>
    <div class="bo-content">
      <fieldset class="bo-compiler-group">
        <legend id="bo-compiler-legend"></legend>
        <span class="bo-compiler-box" id="bo-compiler-box"></span>
      </fieldset>
      <div class="bo-tabs" id="bo-tabs"></div>
      <div class="bo-page" id="bo-page"></div>
    </div>
  </div>
  <div class="bo-footer">
    <span class="bo-toolbar" id="bo-toolbar"></span>
    <span class="bo-status" id="bo-status"></span>
  </div>
</div>`;
}

/** 生成共享脚本（内联到 WebView） */
export function buildOptionsScript(data: BuildOptionsData, embedded: boolean): string {
  const L = labels();
  const payload = JSON.stringify({ data, embedded, labels: L }).replace(/</g, '\\u003c');
  return `
  (function () {
    var BOOT = ${payload};
    var DATA = BOOT.data;
    var L = BOOT.labels;
    var embedded = BOOT.embedded;
    var scopeKey = 'project';
    var page = 'compiler';
    var dirTab = 'compiler';
    var compilerTab = 'flags';
    var selected = { linker: -1, dir: -1, vars: -1 };
    /** 分类折叠状态：category → true 表示已折叠 */
    var collapsedFlags = {};
    /** Compiler Flags 列表滚动位置（重绘后回填） */
    var flagsScroll = 0;
    /** Code::Blocks 默认 Dist-clean 命令（CompileTargetBase 构造函数） */
    var DIST_CLEAN_DEFAULT = '$make -f $makefile distclean$target';
    var ICON_UP = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5v9M4 7.5 8 3.5l4 4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_DOWN = '<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 12.5v-9M4 8.5l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var ICON_PROJECT = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M1.5 3.5h4l1.5 2h7.5v7.5h-13z" stroke="currentColor"/></svg>';
    var ICON_TARGET = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.5" stroke="currentColor"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';

    function q(id) { return document.getElementById('bo-' + id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function clone(o) { return JSON.parse(JSON.stringify(o)); }
    function post(msg) { if (window.__cbVscode) window.__cbVscode.postMessage(msg); }
    function current() { return scopeKey === 'project' ? DATA.project : DATA.targets[Number(scopeKey)]; }
    function isProject() { return scopeKey === 'project'; }
    function targetTitle() { return isProject() ? DATA.projectTitle : DATA.targets[Number(scopeKey)].title; }
    function catalog() {
      var sc = current();
      return (DATA.compilerCatalogs && DATA.compilerCatalogs[sc.compilerId]) || [];
    }
    function catalogOptions() {
      var out = {};
      catalog().forEach(function (o) { if (o.option) out[o.option] = true; });
      return out;
    }
    function titleText() {
      return isProject() ? L.projectBuildOptions : L.targetBuildOptions.replace('{0}', targetTitle());
    }
    function status(text, isError) {
      var el = q('status'); if (!el) return;
      el.textContent = text || '';
      el.style.color = isError ? 'var(--vscode-errorForeground)' : '';
    }
    function pageList() {
      return [
        ['compiler', L.compilerSettings],
        ['linker', L.linkerSettings],
        ['dirs', L.searchDirectories],
        ['extras', L.prePost],
        ['vars', L.customVariables],
        ['make', L.makeCommands]
      ];
    }
    function render() {
      var sc = current();
      var t = q('title'); if (t) t.textContent = titleText();
      renderCompilerBox(sc);
      renderTree();
      renderTabs();
      renderPage();
      renderToolbar();
    }
    /* ---- 编译器下拉：自动匹配工程/目标声明的编译器（大小写/连字符不敏感） ---- */
    function normCompilerId(value) {
      return String(value == null ? '' : value).toLowerCase().replace(/-/g, '');
    }
    /**
     * 选出下拉应显示的编译器。
     * 匹配顺序：id 精确 → id（忽略大小写/连字符）→ 显示名（忽略大小写/连字符）；
     * 都匹配不到说明工程声明的编译器未安装：追加只读合成项，避免静默落到第一个编译器。
     */
    function compilerSelection(sc) {
      var list = (DATA.compilers || []).map(function (c) { return { id: c.id, name: c.name }; });
      var wanted = String((sc && sc.compilerId) || DATA.defaultCompilerId || '').trim();
      if (!wanted) return { list: list, selected: list.length ? list[0].id : '' };
      var hit = null;
      list.forEach(function (c) { if (!hit && String(c.id) === wanted) hit = c; });
      if (!hit) list.forEach(function (c) { if (!hit && normCompilerId(c.id) === normCompilerId(wanted)) hit = c; });
      if (!hit) list.forEach(function (c) { if (!hit && normCompilerId(c.name) === normCompilerId(wanted)) hit = c; });
      if (hit) return { list: list, selected: hit.id };
      list.push({ id: wanted, name: wanted, missing: true });
      return { list: list, selected: wanted };
    }
    function renderCompilerBox(sc) {
      var legend = q('compiler-legend');
      if (legend) legend.textContent = L.selectedCompiler;
      var box = q('compiler-box');
      if (!box) return;
      var picked = compilerSelection(sc);
      if (!sc.compilerId && picked.selected) sc.compilerId = picked.selected;
      var opts = picked.list.map(function (c) {
        var label = c.missing ? c.name + ' (' + L.notFound + ')' : c.name;
        return '<option value="' + esc(c.id) + '" title="' + esc(c.missing ? c.id + ' (' + L.notFound + ')' : c.id) + '"' + (c.id === picked.selected ? ' selected' : '') + '>' + esc(label) + '</option>';
      }).join('');
      box.innerHTML = '<select id="bo-compiler-select">' + opts + '</select>';
      var sel = q('compiler-select');
      if (sel) sel.addEventListener('change', function () {
        collectPage();
        sc.compilerId = sel.value;
        selected = { linker: -1, dir: -1, vars: -1 };
        render();
      });
    }
    function renderTree() {
      var html = '<div class="bo-node' + (isProject() ? ' selected' : '') + '" data-scope="project" title="' + esc(DATA.projectTitle) + '">' +
        '<span class="bo-node-icon">' + ICON_PROJECT + '</span><span class="bo-node-text">' + esc(DATA.projectTitle) + '</span></div>';
      DATA.targets.forEach(function (t, i) {
        html += '<div class="bo-node child' + (scopeKey === String(i) ? ' selected' : '') + '" data-scope="' + i + '" title="' + esc(t.title) + '">' +
          '<span class="bo-node-icon">' + ICON_TARGET + '</span><span class="bo-node-text">' + esc(t.title) + '</span></div>';
      });
      var el = q('tree');
      if (!el) return;
      el.innerHTML = html;
      Array.prototype.forEach.call(el.querySelectorAll('.bo-node'), function (n) {
        n.addEventListener('click', function () {
          collectPage();
          scopeKey = n.getAttribute('data-scope');
          selected = { linker: -1, dir: -1, vars: -1 };
          render();
        });
      });
    }
    function renderTabs() {
      var el = q('tabs');
      if (!el) return;
      el.innerHTML = pageList().map(function (p) {
        return '<button class="bo-tab' + (page === p[0] ? ' active' : '') + '" data-page="' + p[0] + '">' + esc(p[1]) + '</button>';
      }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('.bo-tab'), function (b) {
        b.addEventListener('click', function () {
          collectPage();
          page = b.getAttribute('data-page');
          selected = { linker: -1, dir: -1, vars: -1 };
          render();
        });
      });
    }
    function subTabs(group, items, active) {
      return '<div class="bo-subtabs">' + items.map(function (it) {
        return '<button class="bo-subtab' + (active === it[0] ? ' active' : '') + '" data-subtab="' + group + '" data-sub="' + it[0] + '">' + esc(it[1]) + '</button>';
      }).join('') + '</div>';
    }
    function policyRow(id, value, label, disabled) {
      return '<div class="bo-policy-row"><label class="bo-policy-label" for="' + id + '">' + esc(label) + '</label><select id="' + id + '"' + (disabled ? ' disabled' : '') + '>' +
        [[0, L.useProjectOnly], [1, L.useTargetOnly], [2, L.prepend], [3, L.append]].map(function (o) {
          return '<option value="' + o[0] + '"' + (Number(value) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
        }).join('') + '</select></div>';
    }
    function renderToolbar() {
      var el = q('toolbar');
      if (!el) return;
      el.innerHTML = embedded
        ? '<button id="bo-close" class="default">' + esc(L.close) + '</button>'
        : '<button id="bo-save" class="default">' + esc(L.save) + '</button><button id="bo-save-close">' + esc(L.saveClose) + '</button>';
      if (embedded) {
        q('close').addEventListener('click', function () { collectPage(); hideOverlay(); });
      } else {
        q('save').addEventListener('click', function () { collectPage(); status('...'); post({ type: 'save', data: readData(), close: false }); });
        q('save-close').addEventListener('click', function () { collectPage(); status('...'); post({ type: 'save', data: readData(), close: true }); });
      }
    }
    function card(title, body, extraClass) {
      return '<section class="bo-card' + (extraClass ? ' ' + extraClass : '') + '">' +
        (title ? '<div class="bo-card-head">' + esc(title) + '</div>' : '') +
        '<div class="bo-card-body">' + body + '</div></section>';
    }
    function pageGrid(inner) {
      return '<div class="bo-page-grid">' + inner + '</div>';
    }
    function listHtml(items, selKey) {
      if (!items.length) return '<div class="bo-list"><div class="empty">' + esc(L.noItems) + '</div></div>';
      return '<div class="bo-list" id="bo-list-' + selKey + '">' + items.map(function (s, i) {
        return '<div class="row' + (selected[selKey] === i ? ' selected' : '') + '" data-i="' + i + '"><span class="txt">' + esc(s) + '</span></div>';
      }).join('') + '</div>';
    }
    function bindList(selKey, items) {
      var el = q('list-' + selKey);
      if (!el) return;
      Array.prototype.forEach.call(el.querySelectorAll('.row'), function (r) {
        r.addEventListener('click', function () {
          selected[selKey] = Number(r.getAttribute('data-i'));
          renderPage();
        });
      });
    }
    function moveButtons() {
      return '<div class="bo-move-buttons">' +
        '<button data-move="up" title="' + esc(L.up) + '" aria-label="' + esc(L.up) + '">' + ICON_UP + '</button>' +
        '<button data-move="down" title="' + esc(L.down) + '" aria-label="' + esc(L.down) + '">' + ICON_DOWN + '</button>' +
        '</div>';
    }
    function bindMove(selKey, items, onChange) {
      Array.prototype.forEach.call(q('page').querySelectorAll('.bo-move-buttons button'), function (b) {
        b.addEventListener('click', function () {
          var idx = selected[selKey];
          if (b.getAttribute('data-move') === 'up') {
            if (idx > 0) { var t = items[idx - 1]; items[idx - 1] = items[idx]; items[idx] = t; selected[selKey] = idx - 1; onChange(); }
          } else if (idx >= 0 && idx < items.length - 1) {
            var t2 = items[idx + 1]; items[idx + 1] = items[idx]; items[idx] = t2; selected[selKey] = idx + 1; onChange();
          }
        });
      });
    }
    function actions(selKey, copyLabel, opts) {
      opts = opts || {};
      return '<div class="bo-actions">' +
        '<button data-act="add">' + esc(L.add) + '</button>' +
        '<button data-act="edit">' + esc(L.edit) + '</button>' +
        '<button data-act="del">' + esc(L.delete) + '</button>' +
        '<button data-act="clear">' + esc(L.clear) + '</button>' +
        (opts.hideMove ? '' : '<button data-act="up" title="' + esc(L.up) + '" aria-label="' + esc(L.up) + '">' + ICON_UP + '</button><button data-act="down" title="' + esc(L.down) + '" aria-label="' + esc(L.down) + '">' + ICON_DOWN + '</button>') +
        (copyLabel ? '<button data-act="copy">' + esc(copyLabel) + '</button>' : '') +
        '</div>';
    }
    function bindActions(selKey, items, onChange) {
      var bar = q('page').querySelector('.bo-actions');
      if (!bar) return;
      function act(name) {
        var idx = selected[selKey];
        if (name === 'add') askText(L.add, '', function (v) { if (v) { items.push(v); selected[selKey] = items.length - 1; onChange(); } });
        else if (name === 'edit') { if (idx >= 0) askText(L.edit, items[idx], function (v) { if (v !== null && v !== undefined) { items[idx] = v; onChange(); } }); }
        else if (name === 'del') { if (idx >= 0) confirmBox(L.confirmDelete, function () { items.splice(idx, 1); selected[selKey] = Math.min(idx, items.length - 1); onChange(); }); }
        else if (name === 'clear') { if (items.length) confirmBox(L.confirmDelete, function () { items.length = 0; selected[selKey] = -1; onChange(); }); }
        else if (name === 'up') { if (idx > 0) { var t = items[idx - 1]; items[idx - 1] = items[idx]; items[idx] = t; selected[selKey] = idx - 1; onChange(); } }
        else if (name === 'down') { if (idx >= 0 && idx < items.length - 1) { var t2 = items[idx + 1]; items[idx + 1] = items[idx]; items[idx] = t2; selected[selKey] = idx + 1; onChange(); } }
      }
      Array.prototype.forEach.call(bar.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () { act(b.getAttribute('data-act')); });
      });
    }
    function copyEntries(dst, field, items) {
      if (!dst[field]) dst[field] = [];
      items.forEach(function (s) { if (s && dst[field].indexOf(s) < 0) dst[field].push(s); });
    }
    function askTargets(title, cb) {
      var items = [{ label: DATA.projectTitle, value: -1 }].concat(DATA.targets.map(function (t, i) { return { label: t.title, value: i }; }));
      var html = items.map(function (it) { return '<label class="bo-opt"><input type="checkbox" data-i="' + it.value + '"><span class="name">' + esc(it.label) + '</span></label>'; }).join('');
      modal(title, '<div>' + html + '</div>', function (body) {
        var picked = [];
        Array.prototype.forEach.call(body.querySelectorAll('input[type=checkbox]'), function (c) { if (c.checked) picked.push(Number(c.getAttribute('data-i'))); });
        cb(picked);
      });
    }
    function modal(title, bodyHtml, onOk) {
      var wrap = document.createElement('div'); wrap.className = 'bo-modal';
      wrap.innerHTML = '<div class="bo-modal-box"><div class="bo-modal-title"><span>' + esc(title) + '</span><button class="bo-modal-x" data-act="cancel" aria-label="' + esc(L.close) + '">×</button></div><div class="bo-modal-body">' + bodyHtml + '</div><div class="bo-modal-actions"><button data-act="cancel">' + esc(L.cancel) + '</button><button class="default" data-act="ok">' + esc(L.ok) + '</button></div></div>';
      document.body.appendChild(wrap);
      var close = function () { wrap.remove(); };
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-act=cancel]'), function (b) { b.addEventListener('click', close); });
      wrap.querySelector('[data-act=ok]').addEventListener('click', function () { onOk(wrap.querySelector('.bo-modal-body')); close(); });
    }
    function askText(title, initial, cb) {
      var id = 'bo-inline-input';
      modal(title, '<input id="' + id + '" type="text" value="' + esc(initial || '') + '">', function (body) {
        cb(body.querySelector('#' + id).value);
      });
      setTimeout(function () { var el = document.getElementById(id); if (el) { el.focus(); el.select(); } }, 0);
    }
    function confirmBox(title, cb, bodyText) {
      modal(title, bodyText ? '<div class="bo-confirm-text">' + bodyText + '</div>' : '', function () { cb(); });
    }
    /* ---- Compiler Flags：分类分组 / 折叠 / 右键编辑 ---- */
    function flagGroups() {
      var groups = [];
      var index = {};
      catalog().forEach(function (o, i) {
        var cat = (o.category || '').trim() || L.otherCategory;
        if (!(cat in index)) { index[cat] = groups.length; groups.push({ category: cat, items: [] }); }
        groups[index[cat]].items.push({ entry: o, index: i });
      });
      return groups;
    }
    function applyCollapse(head) {
      var cat = head.getAttribute('data-cat');
      var hide = !!collapsedFlags[cat];
      head.classList.toggle('collapsed', hide);
      var arrow = head.querySelector('.bo-group-arrow');
      if (arrow) arrow.textContent = hide ? '\\u25B8' : '\\u25BE';
      var node = head.nextElementSibling;
      while (node && !(node.classList && node.classList.contains('bo-group-head'))) {
        if (node.classList && node.classList.contains('bo-flag-row')) node.classList.toggle('collapsed-child', hide);
        node = node.nextElementSibling;
      }
    }
    function setAllCollapsed(hide) {
      flagGroups().forEach(function (g) {
        if (hide) collapsedFlags[g.category] = true; else delete collapsedFlags[g.category];
      });
      renderPage();
    }
    function flagOriginal(opt) {
      return { name: opt.name, option: opt.option, baseOption: opt.baseOption || opt.option, custom: !!opt.custom };
    }
    function deleteCompilerFlag(opt) {
      var send = function () { post({ type: 'flagDelete', compilerId: current().compilerId, original: flagOriginal(opt) }); };
      if (opt.custom) send();
      else confirmBox(L.deleteFlag, send, esc(L.builtinDeleteConfirm));
    }
    function editLanguageFlags(kind) {
      var sc = current();
      var all = (DATA.compilerFlags && DATA.compilerFlags[sc.compilerId]) || { cOnly: [], cppOnly: [] };
      var values = (kind === 'cOnly' ? all.cOnly : all.cppOnly) || [];
      flagsTextDialog(
        kind === 'cOnly' ? L.cOnlyTitle : L.cppOnlyTitle,
        kind === 'cOnly' ? L.cOnlyHint : L.cppOnlyHint,
        values.join('\\n'),
        function (text) {
          var lines = text.split(/\\r?\\n/).map(function (s) { return s.trim(); }).filter(Boolean);
          var cOnly = kind === 'cOnly' ? lines : (all.cOnly || []);
          var cppOnly = kind === 'cppOnly' ? lines : (all.cppOnly || []);
          post({ type: 'languageFlags', compilerId: sc.compilerId, cOnly: cOnly, cppOnly: cppOnly });
        }
      );
    }
    function flagsTextDialog(title, hint, text, onSave) {
      var wrap = document.createElement('div'); wrap.className = 'bo-modal';
      wrap.innerHTML = '<div class="bo-modal-box bo-modal-wide"><div class="bo-modal-title"><span>' + esc(title) + '</span><button class="bo-modal-x" data-act="cancel" aria-label="' + esc(L.close) + '">×</button></div>' +
        '<div class="bo-modal-body"><div class="bo-hint">' + esc(hint) + '</div><textarea class="bo-flags-text" id="bo-flags-text" spellcheck="false"></textarea></div>' +
        '<div class="bo-modal-actions"><button data-act="cancel">' + esc(L.cancel) + '</button><button class="default" data-act="ok">' + esc(L.ok) + '</button></div></div>';
      document.body.appendChild(wrap);
      var ta = wrap.querySelector('#bo-flags-text');
      ta.value = text || '';
      var close = function () { wrap.remove(); };
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-act=cancel]'), function (b) { b.addEventListener('click', close); });
      wrap.querySelector('[data-act=ok]').addEventListener('click', function () { var value = ta.value; close(); onSave(value); });
      setTimeout(function () { ta.focus(); }, 0);
    }
    /* ---- 操作按钮可用状态（无选中/边界时禁用） ---- */
    function refreshActionState(selKey, items) {
      var pageEl = q('page');
      if (!pageEl) return;
      var idx = selected[selKey];
      var has = idx >= 0 && idx < items.length;
      ['edit', 'del', 'clear'].forEach(function (name) {
        var b = pageEl.querySelector('.bo-actions button[data-act=' + name + ']');
        if (b) b.disabled = name === 'clear' ? !items.length : !has;
      });
      var copy = pageEl.querySelector('button[data-act=copy]');
      if (copy) copy.disabled = !items.length;
      [['up', !has || idx <= 0], ['down', !has || idx >= items.length - 1]].forEach(function (pair) {
        var b = pageEl.querySelector('.bo-actions button[data-act=' + pair[0] + ']');
        if (b) b.disabled = pair[1];
      });
      var mv = pageEl.querySelectorAll('.bo-move-buttons button');
      if (mv.length === 2) {
        mv[0].disabled = !has || idx <= 0;
        mv[1].disabled = !has || idx >= items.length - 1;
      }
    }
    function showMenu(x, y, items) {
      var old = document.querySelector('.bo-menu'); if (old) old.remove();
      if (!items.length) return;
      var menu = document.createElement('div'); menu.className = 'bo-menu';
      menu.innerHTML = items.map(function (it, i) {
        return it && it.separator ? '<div class="bo-menu-sep"></div>' : '<button data-mi="' + i + '">' + esc(it.label) + '</button>';
      }).join('');
      document.body.appendChild(menu);
      var w = menu.offsetWidth, h = menu.offsetHeight;
      menu.style.left = Math.max(4, Math.min(x, window.innerWidth - w - 8)) + 'px';
      menu.style.top = Math.max(4, Math.min(y, window.innerHeight - h - 8)) + 'px';
      Array.prototype.forEach.call(menu.querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
          var it = items[Number(b.getAttribute('data-mi'))];
          menu.remove();
          if (it && it.action) it.action();
        });
      });
      setTimeout(function () {
        document.addEventListener('click', function closeMenu() { var m = document.querySelector('.bo-menu'); if (m) m.remove(); document.removeEventListener('click', closeMenu); });
      }, 0);
    }
    function flagDialog(title, initial, onSave) {
      var f = initial || {};
      var wrap = document.createElement('div'); wrap.className = 'bo-modal';
      wrap.innerHTML = '<div class="bo-modal-box"><div class="bo-modal-title"><span>' + esc(title) + '</span><button class="bo-modal-x" data-act="cancel" aria-label="' + esc(L.close) + '">×</button></div>' +
        '<div class="bo-modal-body">' +
          '<label class="bo-field"><span class="bo-label">' + esc(L.flagName) + '</span><input type="text" id="bo-flag-name" value="' + esc(f.name || '') + '"></label>' +
          '<label class="bo-field"><span class="bo-label">' + esc(L.flagOption) + '</span><input type="text" id="bo-flag-option" value="' + esc(f.option || '') + '"></label>' +
          '<label class="bo-field"><span class="bo-label">' + esc(L.flagCategory) + '</span><input type="text" id="bo-flag-category" value="' + esc(f.category || '') + '"></label>' +
          '<div class="bo-red-note" id="bo-flag-error" style="display:none"></div>' +
        '</div>' +
        '<div class="bo-modal-actions"><button data-act="cancel">' + esc(L.cancel) + '</button><button class="default" data-act="ok">' + esc(L.ok) + '</button></div></div>';
      document.body.appendChild(wrap);
      var close = function () { wrap.remove(); };
      Array.prototype.forEach.call(wrap.querySelectorAll('[data-act=cancel]'), function (b) { b.addEventListener('click', close); });
      wrap.querySelector('[data-act=ok]').addEventListener('click', function () {
        var name = wrap.querySelector('#bo-flag-name').value.trim();
        var option = wrap.querySelector('#bo-flag-option').value.trim();
        var category = wrap.querySelector('#bo-flag-category').value.trim();
        var err = wrap.querySelector('#bo-flag-error');
        if (!name || !option) { err.style.display = ''; err.textContent = L.flagRequired; return; }
        var flag = { name: name, option: option, category: category || 'Custom' };
        if (initial && initial.additionalLibs) flag.additionalLibs = initial.additionalLibs;
        close();
        onSave(flag);
      });
      setTimeout(function () { var el = wrap.querySelector('#bo-flag-name'); if (el) el.focus(); }, 0);
    }
    function renderPage() {
      var el = q('page');
      if (!el) return;
      var prevList = el.querySelector('.bo-flag-list');
      if (prevList) flagsScroll = prevList.scrollTop;
      el.className = 'bo-page' + (page === 'extras' || page === 'compiler' ? ' bo-page-fill' : '');
      if (page === 'compiler') renderCompiler(el);
      else if (page === 'linker') renderLinker(el);
      else if (page === 'dirs') renderDirs(el);
      else if (page === 'extras') renderExtras(el);
      else if (page === 'vars') renderVars(el);
      else if (page === 'make') renderMake(el);
      var nextList = el.querySelector('.bo-flag-list');
      if (nextList) nextList.scrollTop = flagsScroll;
    }
    function renderCompiler(el) {
      var sc = current();
      var active = {};
      sc.compilerOptions.forEach(function (o) { active[o] = true; });
      var groups = flagGroups();
      var rows = groups.map(function (g) {
        var hide = !!collapsedFlags[g.category];
        var head = '<div class="bo-group-head' + (hide ? ' collapsed' : '') + '" data-cat="' + esc(g.category) + '">' +
          '<span class="bo-group-arrow">' + (hide ? '\\u25B8' : '\\u25BE') + '</span>' +
          '<span class="bo-group-name">' + esc(g.category) + '</span>' +
          '<span class="bo-group-count">' + g.items.length + '</span>' +
          '</div>';
        return head + g.items.map(function (it) {
          var o = it.entry;
          var checked = o.option && active[o.option] ? ' checked' : '';
          var title = o.name + (o.category ? ' — ' + o.category : '');
          return '<div class="bo-flag-row' + (o.custom ? ' custom' : '') + (o.modified ? ' modified' : '') + (hide ? ' collapsed-child' : '') + '" data-index="' + it.index + '" title="' + esc(title) + '">' +
            '<span class="bo-flag-name">' + esc(o.name) + '</span>' +
            (o.option ? '<code>' + esc(o.option) + '</code>' : '') +
            '<input type="checkbox" data-flag="' + esc(o.option) + '" data-libs="' + esc(o.additionalLibs || '') + '"' + checked + '>' +
            '</div>';
        }).join('');
      }).join('');
      var flagsHtml = groups.length
        ? '<div class="bo-flag-list" id="bo-flag-list">' + rows + '</div>'
        : '<div class="bo-flag-list" id="bo-flag-list"><div class="empty">' + esc(L.noItems) + '</div></div>';
      var known = catalogOptions();
      var custom = sc.compilerOptions.filter(function (o) { return !known[o] && !(DATA.defineSwitch && o.indexOf(DATA.defineSwitch) === 0); });
      var defs = sc.compilerOptions.filter(function (o) { return DATA.defineSwitch && o.indexOf(DATA.defineSwitch) === 0; }).map(function (o) { return o.slice(DATA.defineSwitch.length); });
      var tabs = subTabs('compiler', [
        ['flags', L.compilerFlags],
        ['other', L.otherCompiler],
        ['resource', L.otherResource],
        ['defines', L.defines]
      ], compilerTab);
      function panel(key, html) {
        return '<div class="bo-subpage" data-panel="' + key + '"' + (compilerTab === key ? '' : ' style="display:none"') + '>' + html + '</div>';
      }
      el.innerHTML = '<section class="bo-card"><div class="bo-card-body">' +
        policyRow('bo-pol-compiler', sc.relations.compiler, L.policy, isProject()) +
        '<div class="bo-sep"></div>' + tabs +
        panel('flags', flagsHtml + '<div class="bo-red-note">' + esc(L.flagsNote) + '</div>') +
        panel('other', '<textarea id="bo-other-compiler" class="bo-fixed-text">' + esc(custom.join('\\n')) + '</textarea>') +
        panel('resource', '<textarea id="bo-other-resource" class="bo-fixed-text">' + esc(sc.resourceCompilerOptions.join('\\n')) + '</textarea>') +
        panel('defines', '<textarea id="bo-defines" class="bo-fixed-text">' + esc(defs.join('\\n')) + '</textarea>') +
        '</div></section>';
      var pol = q('pol-compiler');
      if (pol) pol.addEventListener('change', function () { sc.relations.compiler = Number(pol.value); });
      Array.prototype.forEach.call(el.querySelectorAll('[data-subtab]'), function (b) {
        b.addEventListener('click', function () { collectPage(); compilerTab = b.getAttribute('data-sub'); renderPage(); });
      });
      Array.prototype.forEach.call(el.querySelectorAll('input[data-flag]'), function (c) {
        c.addEventListener('change', function () { collectCompilerPage(); });
      });
      ['other-compiler', 'other-resource', 'defines'].forEach(function (id) {
        var x = q(id); if (x) x.addEventListener('change', function () { collectCompilerPage(); });
      });
      Array.prototype.forEach.call(el.querySelectorAll('.bo-group-head'), function (head) {
        head.addEventListener('click', function () {
          var cat = head.getAttribute('data-cat');
          collapsedFlags[cat] = !collapsedFlags[cat];
          applyCollapse(head);
        });
      });
      var list = q('flag-list');
      if (list) list.addEventListener('contextmenu', function (ev) {
        ev.preventDefault();
        var row = ev.target && ev.target.closest ? ev.target.closest('.bo-flag-row') : null;
        var idx = row ? Number(row.getAttribute('data-index')) : -1;
        var opt = idx >= 0 ? catalog()[idx] : null;
        var items = [{
          label: L.newFlag,
          action: function () {
            flagDialog(L.newFlag, null, function (flag) { post({ type: 'flagAdd', compilerId: current().compilerId, flag: flag }); });
          }
        }];
        if (opt) {
          items.push({
            label: L.modifyFlag,
            action: function () {
              flagDialog(L.modifyFlag, opt, function (flag) { post({ type: 'flagUpdate', compilerId: current().compilerId, original: flagOriginal(opt), flag: flag }); });
            }
          });
          items.push({
            label: L.deleteFlag,
            action: function () { deleteCompilerFlag(opt); }
          });
        }
        items.push({ separator: true });
        items.push({ label: L.cOnlyFlags, action: function () { editLanguageFlags('cOnly'); } });
        items.push({ label: L.cppOnlyFlags, action: function () { editLanguageFlags('cppOnly'); } });
        items.push({ separator: true });
        items.push({ label: L.expandAll, action: function () { setAllCollapsed(false); } });
        items.push({ label: L.collapseAll, action: function () { setAllCollapsed(true); } });
        showMenu(ev.clientX, ev.clientY, items);
      });
    }
    function collectCompilerPage() {
      var sc = current();
      if (!q('other-compiler')) return false;
      var checks = document.querySelectorAll('#bo-page input[data-flag]');
      var flags = [];
      var libsToAdd = [];
      Array.prototype.forEach.call(checks, function (c) {
        if (c.checked) {
          flags.push(c.getAttribute('data-flag'));
          var libs = c.getAttribute('data-libs');
          if (libs) libs.split(' ').forEach(function (x) { if (x) libsToAdd.push(x); });
        }
      });
      var other = (q('other-compiler') ? q('other-compiler').value : '').split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
      var defs = (q('defines') ? q('defines').value : '').split('\\n').map(function (s) { return s.trim(); }).filter(Boolean).map(function (s) { return (DATA.defineSwitch || '-D') + s; });
      sc.compilerOptions = flags.concat(other, defs);
      sc.resourceCompilerOptions = (q('other-resource') ? q('other-resource').value : '').split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
      libsToAdd.forEach(function (l) { if (sc.linkLibs.indexOf(l) < 0) sc.linkLibs.push(l); });
      return true;
    }
    function renderLinker(el) {
      var sc = current();
      var left = '<div class="bo-list-row">' + moveButtons() + '<div class="bo-list-main">' + listHtml(sc.linkLibs, 'linker') + '</div></div>' +
        actions('linker', '', { hideMove: true }) +
        '<div class="bo-actions"><button data-act="copy">' + esc(L.copySelected) + '</button></div>';
      var right = '<textarea id="bo-other-linker" class="bo-fixed-text">' + esc(sc.linkerOptions.join('\\n')) + '</textarea>';
      var exe = isProject() ? '' : '<div class="bo-inline-row span-2"><span class="bo-inline-label">' + esc(L.linkerExecutable) + '</span><select id="bo-linker-exe" class="bo-inline-select">' +
        [[0, L.autoDetect], [1, L.cCompiler], [2, L.cppCompiler], [3, L.linker]].map(function (o) { return '<option value="' + o[0] + '"' + (Number(sc.linkerExecutable) === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') +
        '</select></div>';
      el.innerHTML = policyRow('bo-pol-linker', sc.relations.linker, L.policy, isProject()) + '<div class="bo-sep"></div>' +
        pageGrid(card(L.linkLibraries, left) + card(L.otherLinker, right) + exe);
      var pol = q('pol-linker');
      if (pol) pol.addEventListener('change', function () { sc.relations.linker = Number(pol.value); });
      bindList('linker', sc.linkLibs);
      bindActions('linker', sc.linkLibs, function () { renderPage(); });
      bindMove('linker', sc.linkLibs, function () { renderPage(); });
      var copyBtn = q('page').querySelector('[data-act=copy]');
      if (copyBtn) {
        copyBtn.onclick = function () {
          var items = sc.linkLibs.slice();
          if (!items.length) return;
          askTargets(L.selectTargets, function (idxs) {
            idxs.forEach(function (i) { copyEntries(i === -1 ? DATA.project : DATA.targets[i], 'linkLibs', items); });
            renderPage();
          });
        };
      }
      var le = q('linker-exe');
      if (le) le.addEventListener('change', function () { sc.linkerExecutable = Number(le.value); });
      var x = q('other-linker'); if (x) x.addEventListener('change', function () { collectPage(); });
      refreshActionState('linker', sc.linkLibs);
    }
    function dirField() { return dirTab === 'compiler' ? 'includeDirs' : (dirTab === 'linker' ? 'libDirs' : 'resourceDirs'); }
    function renderDirs(el) {
      var sc = current();
      var field = dirField();
      var arr = sc[field];
      var tabs = subTabs('dir', [
        ['compiler', L.compilerDirs],
        ['linker', L.linkerDirs],
        ['res', L.resDirs]
      ], dirTab);
      var policy = policyRow('bo-pol-dir', dirTab === 'compiler' ? sc.relations.include : (dirTab === 'linker' ? sc.relations.lib : sc.relations.res), L.policy, isProject());
      el.innerHTML = '<section class="bo-card"><div class="bo-card-body">' + tabs + policy + '<div class="bo-sep"></div>' +
        '<div class="bo-list-row">' + moveButtons() + '<div class="bo-list-main">' + listHtml(arr, 'dir') + '</div></div>' +
        actions('dir', L.copyTo, { hideMove: true }) +
        '</div></section>';
      Array.prototype.forEach.call(el.querySelectorAll('[data-subtab]'), function (b) {
        b.addEventListener('click', function () { collectPage(); dirTab = b.getAttribute('data-sub'); selected.dir = -1; renderPage(); });
      });
      var pol = q('pol-dir');
      if (pol) pol.addEventListener('change', function () {
        var v = Number(pol.value);
        if (dirTab === 'compiler') sc.relations.include = v; else if (dirTab === 'linker') sc.relations.lib = v; else sc.relations.res = v;
      });
      bindList('dir', arr);
      bindActions('dir', arr, function () { renderPage(); });
      bindMove('dir', arr, function () { renderPage(); });
      var copyBtn = q('page').querySelector('[data-act=copy]');
      if (copyBtn) {
        copyBtn.onclick = function () {
          var items = arr.slice(); if (!items.length) return;
          askTargets(L.selectTargets, function (idxs) {
            idxs.forEach(function (i) { copyEntries(i === -1 ? DATA.project : DATA.targets[i], field, items); });
            renderPage();
          });
        };
      }
      refreshActionState('dir', arr);
    }
    function renderExtras(el) {
      var sc = current();
      el.innerHTML = '<div class="bo-extras">' +
        card(L.preBuild, '<textarea id="bo-pre">' + esc(sc.commandsBefore.join('\\n')) + '</textarea>') +
        card(L.postBuild, '<textarea id="bo-post">' + esc(sc.commandsAfter.join('\\n')) + '</textarea>' +
          '<label class="bo-check"><input type="checkbox" id="bo-always"' + (sc.alwaysPost ? ' checked' : '') + '><span>' + esc(L.alwaysPost) + '</span></label>') +
        '</div>';
      ['pre', 'post', 'always'].forEach(function (id) { var x = q(id); if (x) x.addEventListener('change', function () { collectPage(); }); });
    }
    function renderVars(el) {
      var sc = current();
      var items = sc.envVars.map(function (v) { return v.name + ' = ' + v.value; });
      el.innerHTML = '<section class="bo-card"><div class="bo-card-body">' +
        '<div class="bo-field-label">' + esc(L.variables) + '</div>' +
        '<div class="bo-vars-list">' + listHtml(items, 'vars') + '</div>' +
        '<div class="bo-red-note bo-preline">' + esc(L.varsHint) + '</div>' +
        actions('vars', '', { hideMove: true }) +
        '</div></section>';
      bindList('vars', items);
      bindActions('vars', items, function () {
        sc.envVars = items.map(function (s) {
          var i = s.indexOf('=');
          return i < 0 ? { name: s.trim(), value: '' } : { name: s.slice(0, i).trim(), value: s.slice(i + 1).trim() };
        });
        renderPage();
      });
      refreshActionState('vars', items);
    }
    /* ---- Make 命令：Silent build 派生值 / Dist-clean 只读 ---- */
    function derivedSilent(sc) {
      var build = (sc && sc.makeCommands && sc.makeCommands.build) || '';
      if (build) return build + ' > $(CMD_NULL)';
      return (sc && sc.makeCommands && sc.makeCommands.silentBuild) || '';
    }
    /** 对齐 CB（compileroptionsdlg.cpp:1132）：保存时 Silent build = Build 命令 + " > $(CMD_NULL)" */
    function applyDerivedSilent() {
      [DATA.project].concat(DATA.targets).forEach(function (sc) {
        if (!sc || !sc.makeCommands) return;
        if (sc.makeCommands.build) sc.makeCommands.silentBuild = sc.makeCommands.build + ' > $(CMD_NULL)';
      });
    }
    function refreshDerivedSilent() {
      var sc = current();
      var build = q('mk-build');
      if (!sc.makeCommands) sc.makeCommands = {};
      if (build) sc.makeCommands.build = build.value;
      applyDerivedSilent();
      var out = q('mk-silent');
      if (out) out.value = derivedSilent(sc);
    }    function renderMake(el) {
      var sc = current();
      var dis = DATA.makefileIsCustom ? '' : ' disabled';
      var m = sc.makeCommands || {};
      function row(id, label, val) {
        return '<label for="bo-' + id + '">' + esc(label) + '</label><input type="text" id="bo-' + id + '" value="' + esc(val || '') + '"' + dis + '>';
      }
      function derivedRow(id, label, val, hint) {
        return '<label for="bo-' + id + '">' + esc(label) + '</label><input type="text" id="bo-' + id + '" class="bo-derived-input" value="' + esc(val || '') + '" readonly tabindex="-1" aria-readonly="true" title="' + esc(hint) + '">';
      }
      var derived = derivedSilent(sc);
      var customDist = !!m.distClean && String(m.distClean).trim() !== DIST_CLEAN_DEFAULT;
      var showMore = !!derived || customDist;
      el.innerHTML = '<div class="bo-red-note" style="margin-top:0">' + esc(L.makeHint) + '</div>' +
        '<section class="bo-card"><div class="bo-card-body">' +
          '<div class="bo-label-grid">' +
            row('mk-build', L.buildTarget, m.build) +
            row('mk-compile', L.compileSingle, m.compileFile) +
            row('mk-clean', L.cleanTarget, m.clean) +
            row('mk-ask', L.askRebuild, m.askRebuildNeeded) +
          '</div>' +
          (showMore
            ? '<details class="bo-more"><summary>' + esc(L.moreCommands) + '</summary><div class="bo-label-grid">' +
                (derived ? derivedRow('mk-silent', L.silentBuild, derived, L.silentBuildHint) : '') +
                (customDist ? derivedRow('mk-dist', L.distCleanTarget, m.distClean, L.distCleanHint) : '') +
              '</div>' +
              (derived ? '<div class="bo-hint bo-more-hint">' + esc(L.silentBuildHint) + '</div>' : '') +
              (customDist ? '<div class="bo-hint bo-more-hint">' + esc(L.distCleanHint) + '</div>' : '') +
              '</details>'
            : '') +
        '</div></section>' +
        '<div class="bo-red-note">' + esc(L.knownVars) + '</div>';
      ['mk-build', 'mk-compile', 'mk-clean', 'mk-ask'].forEach(function (id) {
        var x = q(id); if (x) x.addEventListener('change', function () { collectPage(); });
      });
      var build = q('mk-build');
      if (build) {
        build.addEventListener('input', function () { refreshDerivedSilent(); });
        build.addEventListener('change', function () {
          // Build 从空变为非空（或相反）时，「更多命令」需要出现/消失
          if (!!document.querySelector('#bo-page details') !== !!build.value.trim()) renderPage();
        });
      }
    }
    function collectPage() {
      if (page === 'compiler') collectCompilerPage();
      var sc = current();
      if (page === 'linker') {
        var ol = q('other-linker'); if (ol) sc.linkerOptions = ol.value.split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
        var le = q('linker-exe'); if (le) sc.linkerExecutable = Number(le.value);
      } else if (page === 'extras') {
        var pre = q('pre'); if (pre) sc.commandsBefore = pre.value.split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
        var po = q('post'); if (po) sc.commandsAfter = po.value.split('\\n').map(function (s) { return s.trim(); }).filter(Boolean);
        var al = q('always'); if (al) sc.alwaysPost = al.checked;
      } else if (page === 'make') {
        var m = sc.makeCommands || (sc.makeCommands = {});
        var fill = function (key, id) { var el = q(id); if (el) m[key] = el.value; };
        fill('build', 'mk-build');
        fill('compileFile', 'mk-compile');
        fill('clean', 'mk-clean');
        fill('askRebuildNeeded', 'mk-ask');
        // Silent build 为派生值（对齐 CB 保存规则）；Dist-clean 只读展示，保留原值
        applyDerivedSilent();
      }
    }
    function readData() {
      collectPage();
      applyDerivedSilent();
      return clone(DATA);
    }
    function showOverlay() {
      var ov = document.getElementById('bo-overlay');
      if (ov) ov.style.display = 'flex';
    }
    function hideOverlay() {
      var ov = document.getElementById('bo-overlay');
      if (ov) ov.style.display = 'none';
    }
    window.cbBuildOptions = {
      open: function (data, scope) {
        if (data) DATA = clone(data);
        scopeKey = scope == null ? 'project' : String(scope);
        page = 'compiler'; dirTab = 'compiler'; compilerTab = 'flags';
        selected = { linker: -1, dir: -1, vars: -1 };
        render(); showOverlay();
      },
      close: function () { collectPage(); hideOverlay(); },
      read: function () { return readData(); },
      isOpen: function () { var ov = document.getElementById('bo-overlay'); return !!ov && ov.style.display !== 'none'; }
    };
    window.addEventListener('message', function (e) {
      var msg = e.data || {};
      if (msg.type === 'saved') { status(L.saved); }
      else if (msg.type === 'error') { status((L.saveFailed + ' ' + (msg.message || '')), true); }
      else if (msg.type === 'compilerFlags') {
        if (msg.compilerId) {
          if (msg.catalog) DATA.compilerCatalogs[msg.compilerId] = msg.catalog;
          if (msg.cOnly || msg.cppOnly) {
            DATA.compilerFlags = DATA.compilerFlags || {};
            DATA.compilerFlags[msg.compilerId] = { cOnly: msg.cOnly || [], cppOnly: msg.cppOnly || [] };
          }
        }
        if (msg.error) status(msg.error, true); else status(L.customFlagsSaved);
        renderPage();
      }
    });
    render();
  })();`;
}

/** 完整独立页面（Build options 面板） */
export function buildOptionsPage(data: BuildOptionsData, initialScope?: string): string {
  return `<!DOCTYPE html>
<html lang="${i18n.htmlLang()}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    html, body { height: 100%; margin: 0; }
    body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size, 13px); overflow: hidden; }
    ${buildOptionsCss()}
  </style>
</head>
<body>
  <div id="bo-root-host" class="bo-root">${buildOptionsMarkup(false)}</div>
  <script>window.__cbVscode = acquireVsCodeApi();</script>
  <script>${buildOptionsScript(data, false)}</script>
  ${initialScope === undefined ? '' : `<script>window.cbBuildOptions.open(null, ${JSON.stringify(initialScope)});</script>`}
</body>
</html>`;
}
