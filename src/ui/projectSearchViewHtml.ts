/**
 * 工程搜索 WebviewView 的静态 HTML/CSS/JS 模板。
 *
 * 约定：
 *  - 所有中文 UI 文案集中在 `i18n.tr('中文')`（i18n WebView 反查表测试会扫描本文件）；
 *  - 动态数据只经 postMessage 下发，前端用 textContent / createElement 渲染（禁止 innerHTML）；
 *  - 内联 JS 禁止模板字符串 `${}`（会被服务端模板插值），统一字符串拼接。
 */
import * as i18n from '../i18n';

export interface ProjectSearchViewHtmlOptions {
  /** Seti 图标字体的 webview URI（与 VS Code Explorer 同款）；缺省时回退为字母图标 */
  fontUri?: string;
  /** webview.cspSource；提供后才允许加载字体 */
  cspSource?: string;
}

export function buildProjectSearchViewHtml(options: ProjectSearchViewHtmlOptions = {}): string {
  const fontUri = options.fontUri ?? '';
  const fontCsp = fontUri && options.cspSource ? ` font-src ${options.cspSource};` : '';
  const fontFace = fontUri
    ? `@font-face { font-family: 'seti'; src: url('${fontUri}') format('woff'); font-weight: normal; font-style: normal; font-display: block; }`
    : '';
  return `<!DOCTYPE html>
<html lang="${i18n.htmlLang()}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';${fontCsp}">
<style>
${fontFace}
:root { color-scheme: light dark; }
html, body { height: 100%; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size, 13px);
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  overflow: hidden;
}
#root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
button, select, input { font-family: inherit; font-size: inherit; color: inherit; }
button { cursor: pointer; }
.hidden { display: none !important; }
.sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.codicon { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; flex: 0 0 16px; }
.codicon > svg { width: 16px; height: 16px; display: block; fill: none; stroke: currentColor; stroke-width: 1.25; stroke-linecap: round; stroke-linejoin: round; }
.toolbar-btn {
  display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 5px;
  border: 1px solid transparent; border-radius: 4px; background: transparent; color: var(--vscode-foreground);
}
.toolbar-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
.toolbar-btn.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.switch-wrap { display: inline-flex; align-items: center; gap: 5px; color: var(--vscode-descriptionForeground); white-space: nowrap; }
.switch {
  width: 28px; height: 16px; border-radius: 9px; position: relative; display: inline-block;
  background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-contrastBorder, #666));
  transition: background-color .12s ease; outline: none; flex: 0 0 auto;
}
.switch .knob {
  position: absolute; top: 1px; left: 1px; width: 12px; height: 12px; border-radius: 50%;
  background: var(--vscode-foreground); transition: transform .12s ease; opacity: .8;
}
.switch[aria-checked="true"] { background: var(--vscode-button-background); border-color: var(--vscode-button-background); }
.switch[aria-checked="true"] .knob { transform: translateX(12px); background: var(--vscode-button-foreground); opacity: 1; }
.switch:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.history-section {
  flex: 0 0 auto;
  border-top: 1px solid var(--vscode-sideBarSectionHeader-border, var(--vscode-widget-border, transparent));
  background: var(--vscode-sideBar-background);
}
.history-head { display: flex; align-items: center; gap: 6px; padding: 3px 8px; min-height: 26px; }
.history-head .spacer { flex: 1; }
.history-toggle {
  display: inline-flex; align-items: center; gap: 5px; min-width: 0; height: 24px; padding: 0 4px;
  border: 1px solid transparent; border-radius: 3px; background: transparent; color: var(--vscode-foreground);
}
.history-toggle:hover { background: var(--vscode-toolbar-hoverBackground); }
.history-toggle .chevron { width: 14px; height: 14px; flex: 0 0 14px; }
.history-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.history-toggle .badge {
  flex: 0 0 auto; min-width: 16px; height: 16px; padding: 0 5px; border-radius: 8px; box-sizing: border-box;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  font-size: 11px; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums;
}
.history-body {
  max-height: 180px; overflow: auto;
  border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent);
}
.history-list { padding: 3px 4px; }
.history-row { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border-radius: 4px; cursor: pointer; outline: none; line-height: 22px; }
.history-row:hover, .history-row:focus-visible { background: var(--vscode-list-hoverBackground); }
.history-row .mode { display: inline-flex; flex: 0 0 16px; opacity: .9; }
.history-row .q { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-row .meta { flex: 0 0 auto; max-width: 45%; color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-row .rerun { flex: 0 0 auto; border: none; background: transparent; color: var(--vscode-textLink-foreground); padding: 0 3px; border-radius: 3px; height: 20px; }
.history-row .rerun .codicon { width: 14px; height: 14px; }
.history-row .rerun:hover { background: var(--vscode-toolbar-hoverBackground); }
.history-empty { padding: 12px 8px; color: var(--vscode-descriptionForeground); text-align: center; }
.searchbar { display: flex; align-items: center; margin: 0 8px; position: relative; }
.search-icon { position: absolute; left: 6px; color: var(--vscode-descriptionForeground); pointer-events: none; }
#query {
  flex: 1; min-width: 0; box-sizing: border-box; padding: 0 98px 0 26px; height: 26px;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; outline: none;
}
#query:focus { border-color: var(--vscode-focusBorder); }
#query::placeholder { color: var(--vscode-input-placeholderForeground); }
.input-options { position: absolute; right: 4px; display: inline-flex; align-items: center; gap: 1px; }
.input-option {
  display: inline-flex; align-items: center; justify-content: center; width: 21px; height: 21px;
  border: 1px solid transparent; border-radius: 3px; background: transparent;
  color: var(--vscode-input-foreground); font-size: 11px; line-height: 1; padding: 0;
}
.input-option:hover { background: var(--vscode-toolbar-hoverBackground); }
.input-option[aria-pressed="true"] {
  background: var(--vscode-inputOption-activeBackground, var(--vscode-list-activeSelectionBackground));
  border-color: var(--vscode-inputOption-activeBorder, transparent);
  color: var(--vscode-inputOption-activeForeground, var(--vscode-list-activeSelectionForeground));
}
.input-option .codicon { width: 14px; height: 14px; }
.input-option .codicon > svg { width: 14px; height: 14px; }
.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 1px solid transparent; border-radius: 3px; height: 24px; padding: 0 10px; }
.primary:hover { background: var(--vscode-button-hoverBackground); }
.danger { background: var(--vscode-inputValidation-errorBackground, #a1260d); color: #fff; border: 1px solid transparent; border-radius: 3px; height: 24px; padding: 0 10px; }
.controls { display: flex; align-items: center; gap: 6px; padding: 6px 8px 0; flex-wrap: wrap; }
.segmented { display: inline-flex; border-radius: 3px; overflow: hidden; border: 1px solid var(--vscode-input-border, transparent); height: 24px; }
.segment {
  border: none; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  padding: 0 10px; line-height: 22px; font-size: 12px;
}
.segment.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
#scope {
  margin-left: auto; max-width: 52%; height: 24px; box-sizing: border-box;
  color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 3px; padding: 0 4px;
}
.chip {
  display: flex; align-items: center; gap: 4px; margin: 5px 8px 0; padding: 1px 3px 1px 7px;
  border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 11px;
}
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip button { border: none; background: transparent; color: inherit; padding: 0 3px; font-size: 13px; }
.statusrow { display: flex; align-items: center; gap: 4px; padding: 4px 8px 2px; min-height: 20px; }
.status { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--vscode-descriptionForeground); font-size: 11px; }
.status .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.progress { flex: 0 0 46px; height: 3px; border-radius: 2px; background: var(--vscode-progressBar-background); opacity: .25; overflow: hidden; }
.progress > div { height: 100%; width: 0; background: var(--vscode-progressBar-background); opacity: 1; transition: width .15s linear; }
.toolbar { display: inline-flex; gap: 1px; flex: 0 0 auto; }
.icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border: none; border-radius: 3px; background: transparent; color: var(--vscode-icon-foreground, var(--vscode-foreground)); padding: 0; }
.icon-btn:hover { background: var(--vscode-toolbar-hoverBackground); }
.icon-btn .codicon { width: 16px; height: 16px; }
.icon-btn .codicon > svg { width: 16px; height: 16px; }
.results { flex: 1; min-height: 0; overflow: auto; padding: 0 4px 6px; contain: content; }
.project-head {
  display: flex; align-items: center; gap: 5px; padding: 2px 6px; margin-top: 3px; line-height: 22px;
  background: var(--vscode-sideBarSectionHeader-background, var(--vscode-sideBar-background, transparent)); border-radius: 3px;
  color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); font-weight: 600;
  position: sticky; top: 0; z-index: 2; cursor: pointer; outline: none;
}
.project-head:hover { background: var(--vscode-list-hoverBackground); }
.project-head .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.project-head .meta { margin-left: auto; font-weight: 400; color: var(--vscode-descriptionForeground); font-size: 11px; white-space: nowrap; }
.file-row {
  display: flex; align-items: center; gap: 4px; padding: 0 6px 0 10px; border-radius: 3px;
  line-height: 22px; cursor: pointer; outline: none;
}
.file-row.project-child { padding-left: 20px; }
.file-row:hover { background: var(--vscode-list-hoverBackground); }
.file-row.selected, .file-row:focus-visible { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.file-row .chevron { flex: 0 0 14px; color: var(--vscode-icon-foreground, var(--vscode-foreground)); opacity: .9; }
.file-row .chevron .codicon { width: 14px; height: 14px; }
.file-row .chevron .codicon > svg { width: 14px; height: 14px; }
.file-row > .codicon { color: var(--vscode-icon-foreground, var(--vscode-foreground)); opacity: .9; }
.lang-icon {
  flex: 0 0 18px; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  font-family: var(--vscode-editor-font-family, var(--vscode-font-family)); font-size: 11px; font-weight: 700;
  line-height: 18px; letter-spacing: -.4px; text-align: center;
}
.lang-icon.lang-c, .lang-icon.lang-cpp { color: #519aba; }
.lang-icon.lang-h, .lang-icon.lang-hpp { color: #a074c4; }
.lang-icon.lang-asm { color: #cc3e44; }
.lang-icon.lang-ld { color: #cbcb41; }
.lang-icon.lang-cpp, .lang-icon.lang-hpp { font-size: 9px; letter-spacing: -.6px; }
.lang-icon.lang-asm, .lang-icon.lang-ld { font-size: 8px; letter-spacing: -.5px; }
.seti-font .lang-icon { font-family: 'seti', var(--vscode-editor-font-family, monospace); font-size: 22px; line-height: 18px; font-weight: normal; letter-spacing: 0; }
.seti-font .lang-icon.lang-cpp, .seti-font .lang-icon.lang-hpp,
.seti-font .lang-icon.lang-asm { font-size: 20px; letter-spacing: 0; }
.seti-font .lang-icon.lang-text { font-family: var(--vscode-editor-font-family, monospace); font-size: 9px; letter-spacing: -.5px; }
.file-row .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-row .dir { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; }
.file-row.selected .dir { color: inherit; opacity: .8; }
.file-row .badge {
  flex: 0 0 auto; min-width: 18px; height: 16px; padding: 0 5px; border-radius: 8px; box-sizing: border-box;
  background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
  font-size: 11px; line-height: 16px; text-align: center; font-variant-numeric: tabular-nums;
}
.file-row .reveal { flex: 0 0 auto; opacity: 0; border: none; background: transparent; color: inherit; padding: 0 2px; height: 20px; }
.file-row:hover .reveal, .file-row:focus-within .reveal, .file-row.selected .reveal { opacity: .85; }
.file-row mark, .match-preview mark {
  background-color: rgba(234, 92, 0, .42); color: inherit; border-radius: 2px;
}
.match-row {
  display: flex; align-items: baseline; gap: 8px; padding: 0 6px 0 38px; border-radius: 3px;
  cursor: pointer; outline: none; line-height: 22px;
}
.match-row:hover { background: var(--vscode-list-hoverBackground); }
.match-row.selected, .match-row:focus-visible { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.match-row .line { flex: 0 0 34px; text-align: right; color: var(--vscode-editorLineNumber-foreground, var(--vscode-descriptionForeground)); font-family: var(--vscode-editor-font-family); font-size: 11px; font-variant-numeric: tabular-nums; }
.match-row.selected .line { color: inherit; opacity: .8; }
.match-row .match-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; font-family: var(--vscode-editor-font-family); font-size: var(--vscode-editor-font-size, 12px); }
.load-more { display: block; width: calc(100% - 10px); margin: 6px 5px; padding: 3px; }
.empty { padding: 18px 14px; text-align: center; color: var(--vscode-descriptionForeground); }
.empty .title { color: var(--vscode-foreground); font-weight: 600; margin-bottom: 5px; }
.empty .body { line-height: 17px; }
.empty-actions { display: flex; justify-content: center; gap: 6px; margin-top: 9px; flex-wrap: wrap; }
.footer { flex: 0 0 auto; padding: 4px 9px 6px; color: var(--vscode-descriptionForeground); font-size: 11px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); }
.spin { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--vscode-progressBar-background); border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media (max-width: 240px) {
  .history-label, .switch-label, .btn-label { display: none; }
  .controls { gap: 4px; }
  #scope { max-width: 60%; }
  .file-row .dir { display: none; }
  .footer { display: none; }
}
</style>
</head>
<body>
<svg class="sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <symbol id="i-search" viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.2"/><path d="M10.2 10.2 14 14"/></symbol>
  <symbol id="i-close" viewBox="0 0 16 16"><path d="M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6"/></symbol>
  <symbol id="i-refresh" viewBox="0 0 16 16"><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7"/><path d="M13.8 2.2v3.6h-3.6"/></symbol>
  <symbol id="i-expand-all" viewBox="0 0 16 16"><path d="M8 2.2v3.9"/><path d="M5.7 4.4 8 2.1l2.3 2.3"/><path d="M8 13.8v-3.9"/><path d="M5.7 11.6 8 13.9l2.3-2.3"/></symbol>
  <symbol id="i-collapse-all" viewBox="0 0 16 16"><path d="M8 2.2v3.9"/><path d="M5.7 3.8 8 6.1l2.3-2.3"/><path d="M8 13.8v-3.9"/><path d="M5.7 12.2 8 9.9l2.3 2.3"/></symbol>
  <symbol id="i-chevron-right" viewBox="0 0 16 16"><path d="M6.2 3.6 10.6 8l-4.4 4.4"/></symbol>
  <symbol id="i-chevron-down" viewBox="0 0 16 16"><path d="M3.6 6.2 8 10.6l4.4-4.4"/></symbol>
  <symbol id="i-file" viewBox="0 0 16 16"><path d="M3.9 1.4h5.3l4.1 4.1v9.1H3.9z" fill="currentColor" stroke="none"/><path d="M9.2 1.4v3.9h3.9" fill="none" stroke="var(--vscode-sideBar-background, #1e1e1e)" stroke-width="1.2"/></symbol>
  <symbol id="i-project" viewBox="0 0 16 16"><path d="M1.8 4.2h4.4l1.3 1.7h6.7v8.3H1.8z"/><path d="M1.8 6.9h12.4"/></symbol>
  <symbol id="i-history" viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.2"/><path d="M8 4.9V8l2.2 1.4"/></symbol>
  <symbol id="i-trash" viewBox="0 0 16 16"><path d="M2.8 4.5h10.4"/><path d="M6.2 4.5V3h3.6v1.5"/><path d="M4.4 4.5 5 13.5h6l.6-9"/></symbol>
  <symbol id="i-reveal" viewBox="0 0 16 16"><path d="M6.2 3.2H13v6.8"/><path d="M13 3.2 7.4 8.8"/><path d="M11.2 9.4v3.4H3.2V4.8h3.4"/></symbol>
</svg>
<div id="root">
  <div class="searchbar">
    <span class="search-icon codicon" aria-hidden="true"><svg><use href="#i-search"></use></svg></span>
    <input id="query" type="text" autocomplete="off" spellcheck="false" placeholder="${i18n.tr('搜索工程文件或内容…')}" aria-label="${i18n.tr('搜索工程文件或内容…')}">
    <div class="input-options">
      <button id="caseToggle" class="input-option" title="${i18n.tr('区分大小写')}" aria-pressed="false">Aa</button>
      <button id="wholeWordToggle" class="input-option" title="${i18n.tr('全字匹配')}" aria-label="${i18n.tr('全字匹配')}" aria-pressed="false">Ab</button>
      <button id="regexToggle" class="input-option" title="${i18n.tr('使用正则表达式')}" aria-pressed="false">.*</button>
      <button id="clearQuery" class="input-option hidden" title="${i18n.tr('清除')}" aria-label="${i18n.tr('清除')}"><span class="codicon" aria-hidden="true"><svg><use href="#i-close"></use></svg></span></button>
    </div>
  </div>
  <div class="controls">
    <div class="segmented" role="tablist">
      <button id="modeFiles" class="segment active" role="tab" aria-selected="true">${i18n.tr('文件')}</button>
      <button id="modeText" class="segment" role="tab" aria-selected="false">${i18n.tr('内容')}</button>
    </div>
    <button id="searchBtn" class="primary hidden">${i18n.tr('搜索')}</button>
    <button id="stopBtn" class="danger hidden">${i18n.tr('停止')}</button>
    <select id="scope" aria-label="${i18n.tr('范围')}">
      <option value="openProjects">${i18n.tr('所有工程')}</option>
      <option value="activeProject">${i18n.tr('当前活动工程')}</option>
    </select>
  </div>
  <div id="scopeChip" class="chip hidden"><span id="scopeChipLabel"></span><button id="scopeChipClear" title="${i18n.tr('清除范围')}">×</button></div>
  <div class="statusrow">
    <div id="status" class="status" aria-live="polite">
      <span id="statusText" class="text"></span>
      <div id="progress" class="progress hidden"><div id="progressBar"></div></div>
    </div>
    <div class="toolbar" role="toolbar" aria-label="${i18n.tr('搜索操作')}">
      <button id="refreshBtn" class="icon-btn" title="${i18n.tr('刷新')}"><span class="codicon" aria-hidden="true"><svg><use href="#i-refresh"></use></svg></span></button>
      <button id="expandAll" class="icon-btn" title="${i18n.tr('全部展开')}"><span class="codicon" aria-hidden="true"><svg><use href="#i-expand-all"></use></svg></span></button>
      <button id="collapseAll" class="icon-btn" title="${i18n.tr('全部折叠')}"><span class="codicon" aria-hidden="true"><svg><use href="#i-collapse-all"></use></svg></span></button>
    </div>
  </div>
  <div id="results" class="results" role="listbox"></div>
  <div id="empty" class="empty hidden"><div id="emptyTitle" class="title"></div><div id="emptyBody" class="body"></div><div id="emptyActions" class="empty-actions"></div></div>
  <section id="historySection" class="history-section" role="region" aria-label="${i18n.tr('搜索历史')}">
    <div class="history-head">
      <button id="historyToggle" class="history-toggle" aria-expanded="false" aria-controls="historyBody" title="${i18n.tr('搜索历史')}">
        <span id="historyChevron" class="chevron codicon" aria-hidden="true"><svg><use href="#i-chevron-right"></use></svg></span>
        <span class="history-title">${i18n.tr('搜索历史')}</span>
        <span id="historyCount" class="badge">0</span>
      </button>
      <span class="spacer"></span>
      <span class="switch-wrap" title="${i18n.tr('保留搜索历史')}">
        <span class="switch-label">${i18n.tr('保留历史')}</span>
        <span id="historySwitch" class="switch" role="switch" aria-checked="true" tabindex="0" aria-label="${i18n.tr('保留搜索历史')}"><span class="knob"></span></span>
      </span>
      <button id="clearHistory" class="icon-btn" title="${i18n.tr('清空')}" aria-label="${i18n.tr('清空')}">
        <span class="codicon" aria-hidden="true"><svg><use href="#i-trash"></use></svg></span>
      </button>
    </div>
    <div id="historyBody" class="history-body hidden">
      <div id="historyList" class="history-list"></div>
    </div>
  </section>
  <div class="footer">Ctrl+Alt+P · ${i18n.tr('文件模式空查询浏览全部；内容模式回车搜索')}</div>
</div>
<script>
(function () {
  var vscode = acquireVsCodeApi();
  var T = {
    files: "${i18n.tr('文件')}",
    text: "${i18n.tr('内容')}",
    filesUnit: "${i18n.tr('个文件')}",
    matchesUnit: "${i18n.tr('处匹配')}",
    resultsUnit: "${i18n.tr('个结果')}",
    expand: "${i18n.tr('展开')}",
    collapse: "${i18n.tr('折叠')}",
    activeFirst: "${i18n.tr('活动工程优先')}",
    truncated: "${i18n.tr('已截断')}",
    scanning: "${i18n.tr('扫描中')}",
    loadMore: "${i18n.tr('加载更多')}",
    showing: "${i18n.tr('已显示')}",
    itemsUnit: "${i18n.tr('条')}",
    openProject: "${i18n.tr('打开工程')}",
    newProject: "${i18n.tr('新建工程')}",
    openFile: "${i18n.tr('打开文件')}",
    reveal: "${i18n.tr('在工程树中定位')}",
    rerun: "${i18n.tr('重新执行')}",
    last: "${i18n.tr('上次')}",
    justNow: "${i18n.tr('刚刚')}",
    noHistory: "${i18n.tr('暂无搜索历史')}",
    noHistoryHint: "${i18n.tr('先搜索一次，历史会出现在这里')}",
    historyOff: "${i18n.tr('历史记录已关闭')}",
    historyOffHint: "${i18n.tr('打开「保留历史」后才会记录')}",
    noProjects: "${i18n.tr('还没有打开工程')}",
    noProjectsHint: "${i18n.tr('打开一个 .cbp 工程后即可搜索工程内文件')}",
    textHintTitle: "${i18n.tr('输入内容后按 Enter 搜索')}",
    textHintBody: "${i18n.tr('搜索内容，只查找已打开 .cbp 工程中的文件')}",
    filesHintTitle: "${i18n.tr('文件模式：空查询可浏览全部工程文件')}",
    noResults: "${i18n.tr('没有匹配结果')}",
    adjustHint: "${i18n.tr('试试调整范围、大小写或正则选项')}",
    searchFailed: "${i18n.tr('搜索失败')}",
    cancelled: "${i18n.tr('已取消')}",
    timedOut: "${i18n.tr('搜索超时')}",
    stop: "${i18n.tr('停止')}",
    clearRange: "${i18n.tr('清除范围')}",
    fileMode: "${i18n.tr('文件模式')}",
    textMode: "${i18n.tr('内容模式')}"
  };

  function $(id) { return document.getElementById(id); }
  var queryEl = $('query');
  var resultsEl = $('results');
  var statusEl = $('statusText');
  var progressEl = $('progress');
  var progressBar = $('progressBar');
  var emptyEl = $('empty');
  var historyBody = $('historyBody');
  var historyList = $('historyList');
  var switchEl = $('historySwitch');
  var scopeEl = $('scope');
  var chipEl = $('scopeChip');

  var S = {
    mode: 'files',
    queries: { files: '', text: '' },
    scope: 'openProjects',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    keepHistory: true,
    hasProjects: false,
    projectCount: 0,
    fileCount: 0,
    activeProject: '',
    subtree: null,
    running: false,
    searchMode: '',
    history: [],
    historyCollapsed: true,
    data: { files: null, text: null },
    expanded: {},
    groups: {},
    renderLimit: 200,
    selectedId: '',
    composing: false,
    requestId: 0
  };

  try {
    var saved = vscode.getState();
    if (saved && typeof saved === 'object') {
      if (saved.mode === 'files' || saved.mode === 'text') S.mode = saved.mode;
      if (saved.queries) {
        if (typeof saved.queries.files === 'string') S.queries.files = saved.queries.files;
        if (typeof saved.queries.text === 'string') S.queries.text = saved.queries.text;
      }
      if (saved.scope === 'openProjects' || saved.scope === 'activeProject') S.scope = saved.scope;
      S.caseSensitive = saved.caseSensitive === true;
      S.wholeWord = saved.wholeWord === true;
      S.regex = saved.regex === true;
      if (saved.expanded && typeof saved.expanded === 'object') S.expanded = saved.expanded;
      if (saved.groups && typeof saved.groups === 'object') S.groups = saved.groups;
      if (typeof saved.historyCollapsed === 'boolean') S.historyCollapsed = saved.historyCollapsed;
    }
  } catch (e) { /* 忽略损坏状态 */ }

  function persist() {
    try {
      vscode.setState({
        mode: S.mode,
        queries: S.queries,
        scope: S.scope,
        caseSensitive: S.caseSensitive,
        wholeWord: S.wholeWord,
        regex: S.regex,
        expanded: S.expanded,
        groups: S.groups,
        historyCollapsed: S.historyCollapsed
      });
    } catch (e) { /* 忽略 */ }
  }

  function post(type, payload) {
    var msg = { type: type };
    if (payload) {
      for (var k in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, k)) msg[k] = payload[k];
      }
    }
    vscode.postMessage(msg);
  }

  function setStatus(text, kind) {
    statusEl.textContent = text || '';
    statusEl.title = text || '';
    statusEl.style.color = kind === 'error'
      ? 'var(--vscode-errorForeground)'
      : (kind === 'ok' ? 'var(--vscode-descriptionForeground)' : '');
  }

  function showProgress(show, ratio) {
    if (show) {
      progressEl.classList.remove('hidden');
      progressBar.style.width = Math.max(2, Math.min(100, Math.round((ratio || 0) * 100))) + '%';
    } else {
      progressEl.classList.add('hidden');
      progressBar.style.width = '0';
    }
  }

  function currentQuery() { return S.queries[S.mode] || ''; }
  function setQuery(value) {
    S.queries[S.mode] = value;
    if (queryEl.value !== value) queryEl.value = value;
    $('clearQuery').classList.toggle('hidden', !value);
    persist();
  }

  function updateChrome() {
    $('modeFiles').classList.toggle('active', S.mode === 'files');
    $('modeText').classList.toggle('active', S.mode === 'text');
    $('modeFiles').setAttribute('aria-selected', S.mode === 'files' ? 'true' : 'false');
    $('modeText').setAttribute('aria-selected', S.mode === 'text' ? 'true' : 'false');
    scopeEl.value = S.scope;
    scopeEl.disabled = !!S.subtree;
    var chipVisible = !!S.subtree;
    chipEl.classList.toggle('hidden', !chipVisible);
    if (chipVisible) $('scopeChipLabel').textContent = (S.subtree && S.subtree.label) || '';
    $('caseToggle').setAttribute('aria-pressed', S.caseSensitive ? 'true' : 'false');
    $('wholeWordToggle').setAttribute('aria-pressed', S.wholeWord ? 'true' : 'false');
    $('regexToggle').setAttribute('aria-pressed', S.regex ? 'true' : 'false');
    switchEl.setAttribute('aria-checked', S.keepHistory ? 'true' : 'false');
    $('clearHistory').classList.remove('hidden');
    $('searchBtn').classList.toggle('hidden', S.running || S.mode !== 'text');
    $('stopBtn').classList.toggle('hidden', !S.running);
    var collapsed = S.historyCollapsed !== false;
    $('historyToggle').setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    historyBody.classList.toggle('hidden', collapsed);
    $('historyChevron').querySelector('use').setAttribute('href', collapsed ? '#i-chevron-right' : '#i-chevron-down');
    $('historyCount').textContent = String((S.history || []).filter(function (e) { return e.mode === S.mode; }).length);
    queryEl.placeholder = "${i18n.tr('搜索工程文件或内容…')}";
    if (document.activeElement !== queryEl) setQuery(currentQuery());
  }

  function runSearch() {
    if (!S.hasProjects) return;
    var q = currentQuery();
    if (S.mode === 'text' && !q.trim()) {
      renderEmpty();
      return;
    }
    S.requestId++;
    S.running = true;
    S.searchMode = S.mode;
    S.renderLimit = 200;
    S.selectedId = '';
    setStatus(S.mode === 'text' ? T.scanning : '', '');
    showProgress(S.mode === 'text', 0);
    updateChrome();
    if (S.mode === 'files') {
      post('searchFiles', { query: q, requestId: S.requestId });
    } else {
      post('searchText', { query: q, requestId: S.requestId });
    }
  }

  function scheduleFiles() {
    if (S.mode !== 'files' || S.composing) return;
    if (S.filesTimer) clearTimeout(S.filesTimer);
    S.filesTimer = setTimeout(runSearch, 70);
  }

  function clearQuery() {
    setQuery('');
    if (S.mode === 'files') runSearch();
    else { S.data.text = null; render(); }
    queryEl.focus();
  }

  function setMode(mode) {
    if (mode !== 'files' && mode !== 'text') return;
    if (S.mode === mode) return;
    S.mode = mode;
    S.selectedId = '';
    persist();
    post('stateChanged', { mode: S.mode, queries: S.queries, caseSensitive: S.caseSensitive, wholeWord: S.wholeWord, regex: S.regex });
    post('getHistory', { mode: S.mode });
    updateChrome();
    render();
    renderHistory();
    queryEl.focus();
  }

  function rerunForOptions() {
    if (!currentQuery().trim()) { render(); return; }
    if (S.mode === 'files') scheduleFiles();
    else runSearch();
  }

  function escapeHtmlText(text) { return String(text == null ? '' : text); }

  function appendHighlighted(parent, text, start, length) {
    var value = escapeHtmlText(text);
    var s = Math.max(0, Math.min(value.length, Number(start) || 0));
    var l = Math.max(0, Math.min(value.length - s, Number(length) || 0));
    if (!l) { parent.appendChild(document.createTextNode(value)); return; }
    if (s > 0) parent.appendChild(document.createTextNode(value.slice(0, s)));
    var mark = document.createElement('mark');
    mark.textContent = value.slice(s, s + l);
    parent.appendChild(mark);
    if (s + l < value.length) parent.appendChild(document.createTextNode(value.slice(s + l)));
  }

  function appendRanges(parent, text, ranges) {
    var value = escapeHtmlText(text);
    var list = Array.isArray(ranges) ? ranges : [];
    if (!list.length) { parent.appendChild(document.createTextNode(value)); return; }
    var at = 0;
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      var s = Math.max(at, Math.min(value.length, Number(r.start) || 0));
      var l = Math.max(0, Math.min(value.length - s, Number(r.length) || 0));
      if (!l) continue;
      if (s > at) parent.appendChild(document.createTextNode(value.slice(at, s)));
      var mark = document.createElement('mark');
      mark.textContent = value.slice(s, s + l);
      parent.appendChild(mark);
      at = s + l;
    }
    if (at < value.length) parent.appendChild(document.createTextNode(value.slice(at)));
  }

  var SVG_NS = 'http://www.w3.org/2000/svg';

  function makeSvgIcon(name) {
    var span = document.createElement('span');
    span.className = 'codicon';
    span.setAttribute('aria-hidden', 'true');
    var svg = document.createElementNS(SVG_NS, 'svg');
    var use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    span.appendChild(svg);
    return span;
  }

  /**
   * 文件类型图标（对齐 VS Code Explorer 的 Seti 主题）：
   * glyph 取 VS Code theme-seti 字体的 fontCharacter，字体加载失败时退回 label。
   */
  function langSpec(fileName) {
    var value = String(fileName || '');
    var dot = value.lastIndexOf('.');
    var ext = dot >= 0 ? value.slice(dot + 1).toLowerCase() : '';
    if (ext === 'c') return { kind: 'c', label: 'C', glyph: '\uE00C' };
    if (ext === 'h') return { kind: 'h', label: 'C', glyph: '\uE00C' };
    if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'c++') return { kind: 'cpp', label: 'C+', glyph: '\uE01A' };
    if (ext === 'hpp' || ext === 'hh' || ext === 'hxx' || ext === 'h++') return { kind: 'hpp', label: 'C+', glyph: '\uE01A' };
    if (ext === 's' || ext === 'asm') return { kind: 'asm', label: 'AS', glyph: '\uE004' };
    if (ext === 'ld' || ext === 'lcf') return { kind: 'ld', label: 'LD' };
    return null;
  }

  function setiActive() {
    return document.documentElement.classList.contains('seti-font');
  }

  function makeLangIcon(spec) {
    var el = document.createElement('span');
    el.className = 'lang-icon lang-' + spec.kind + (spec.glyph ? '' : ' lang-text');
    el.textContent = setiActive() && spec.glyph ? spec.glyph : spec.label;
    el.setAttribute('aria-hidden', 'true');
    return el;
  }

  /** 相对路径拆成「文件名 + 目录」，文件行不再重复显示文件名 */
  function splitPath(name, relativePath) {
    var rel = String(relativePath || '').replace(/\\\\/g, '/');
    var base = String(name || '') || rel.split('/').pop() || rel;
    var dir = rel;
    if (base && dir.slice(-base.length) === base) dir = dir.slice(0, dir.length - base.length);
    dir = dir.replace(/\\/+$/, '');
    return { name: base, dir: dir };
  }

  function projectKeyOf(item) {
    return String(item.projectFilename || item.projectTitle || '');
  }

  function projectTitleOf(item) {
    return String(item.projectTitle || projectKeyOf(item));
  }

  function isGroupExpanded(key) {
    if (Object.prototype.hasOwnProperty.call(S.groups, key)) return S.groups[key] !== false;
    return true;
  }

  function makeRevealButton(id) {
    var b = document.createElement('button');
    b.className = 'reveal';
    b.title = T.reveal;
    b.setAttribute('data-reveal-id', id);
    b.setAttribute('aria-label', T.reveal);
    b.appendChild(makeSvgIcon('reveal'));
    return b;
  }

  function selectRow(row) {
    var old = resultsEl.querySelector('.file-row.selected, .match-row.selected');
    if (old) old.classList.remove('selected');
    if (row) {
      row.classList.add('selected');
      S.selectedId = row.getAttribute('data-select-id') || '';
      row.scrollIntoView({ block: 'nearest' });
    } else {
      S.selectedId = '';
    }
  }

  function groupItems(items, keyOf) {
    var order = [];
    var by = {};
    for (var i = 0; i < items.length; i++) {
      var key = keyOf(items[i]);
      if (!Object.prototype.hasOwnProperty.call(by, key)) { by[key] = []; order.push(key); }
      by[key].push(items[i]);
    }
    return { order: order, by: by };
  }

  /** 工程分组头：工程名 + 活动标记 + 计数，可点击折叠（两种模式共用） */
  function appendProjectHead(title, active, metaText, key) {
    var head = document.createElement('div');
    head.className = 'project-head';
    head.setAttribute('role', 'group');
    head.setAttribute('tabindex', '0');
    head.setAttribute('data-project-group', key);
    head.setAttribute('aria-expanded', isGroupExpanded(key) ? 'true' : 'false');
    head.title = title + ' \u00b7 ' + (isGroupExpanded(key) ? T.collapse : T.expand);
    head.appendChild(makeSvgIcon(isGroupExpanded(key) ? 'chevron-down' : 'chevron-right'));
    var name = document.createElement('span');
    name.className = 'name';
    name.textContent = title + (active ? ' \u00b7 ' + T.activeFirst : '');
    head.appendChild(name);
    var meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = metaText;
    head.appendChild(meta);
    resultsEl.appendChild(head);
    return isGroupExpanded(key);
  }

  function appendFileRow(item, opts) {
    var parts = splitPath(item.basename, item.relativePath);
    var row = document.createElement('div');
    row.className = 'file-row' + (opts.grouped ? ' project-child' : '');
    row.setAttribute('role', 'option');
    row.tabIndex = 0;
    row.setAttribute('data-file-id', item.id);
    row.setAttribute('data-select-id', item.id);
    row.title = item.absolutePath || item.relativePath || '';
    if (opts.collapsible) {
      var chevron = document.createElement('span');
      chevron.className = 'chevron';
      chevron.appendChild(makeSvgIcon(opts.expanded ? 'chevron-down' : 'chevron-right'));
      row.setAttribute('aria-expanded', opts.expanded ? 'true' : 'false');
      row.setAttribute('data-file-group', item.id);
      row.appendChild(chevron);
    }
    var lang = langSpec(parts.name);
    row.appendChild(lang ? makeLangIcon(lang) : makeSvgIcon('file'));
    var label = document.createElement('span');
    label.className = 'name';
    appendRanges(label, parts.name, item.ranges);
    row.appendChild(label);
    var dir = document.createElement('span');
    dir.className = 'dir';
    dir.textContent = parts.dir;
    row.appendChild(dir);
    if (opts.badge) {
      var badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = String(opts.badge);
      row.appendChild(badge);
    }
    row.appendChild(makeRevealButton(item.id));
    resultsEl.appendChild(row);
    return row;
  }

  function renderFileResults(msg) {
    var list = (msg && msg.results) || [];
    if (!list.length) return;
    var grouped = groupItems(list, projectKeyOf);
    var rendered = 0;
    var limitHit = false;
    for (var g = 0; g < grouped.order.length; g++) {
      if (rendered >= S.renderLimit) { limitHit = true; break; }
      var key = grouped.order[g];
      var items = grouped.by[key];
      var active = false;
      for (var a = 0; a < items.length; a++) {
        if (items[a].isActive === true) { active = true; break; }
      }
      var expanded = appendProjectHead(projectTitleOf(items[0]), active, items.length + ' ' + T.filesUnit, key);
      if (!expanded) continue;
      for (var j = 0; j < items.length; j++) {
        if (rendered >= S.renderLimit) { limitHit = true; break; }
        appendFileRow(items[j], { grouped: true, collapsible: false, expanded: true });
        rendered++;
      }
      if (limitHit) break;
    }
    if (limitHit || (msg && msg.truncated)) {
      var more = document.createElement('button');
      more.className = 'toolbar-btn load-more';
      more.textContent = T.loadMore;
      more.setAttribute('data-load-more', '1');
      resultsEl.appendChild(more);
    }
  }

  function isExpanded(id) {
    if (Object.prototype.hasOwnProperty.call(S.expanded, id)) return S.expanded[id] !== false;
    return true;
  }

  function renderTextResults(msg) {
    var files = (msg && msg.files) || [];
    if (!files.length) return;
    var grouped = groupItems(files, projectKeyOf);
    for (var g = 0; g < grouped.order.length; g++) {
      var key = grouped.order[g];
      var items = grouped.by[key];
      var active = false;
      var matchTotal = 0;
      for (var a = 0; a < items.length; a++) {
        if (items[a].isActive === true) active = true;
        matchTotal += items[a].matches ? items[a].matches.length : 0;
      }
      var expanded = appendProjectHead(
        projectTitleOf(items[0]), active,
        items.length + ' ' + T.filesUnit + ' \u00b7 ' + matchTotal + ' ' + T.matchesUnit,
        key
      );
      if (!expanded) continue;
      for (var i = 0; i < items.length; i++) {
        var f = items[i];
        var fileExpanded = isExpanded(f.id);
        appendFileRow(f, { grouped: true, collapsible: true, expanded: fileExpanded, badge: f.matches.length });
        if (!fileExpanded) continue;
        for (var j = 0; j < f.matches.length && j < 50; j++) {
          var m = f.matches[j];
          var row = document.createElement('div');
          row.className = 'match-row';
          row.setAttribute('role', 'option');
          row.tabIndex = 0;
          row.setAttribute('data-match-id', m.id);
          row.setAttribute('data-select-id', m.id);
          var line = document.createElement('span');
          line.className = 'line';
          line.textContent = String((m.line || 0) + 1);
          row.appendChild(line);
          var preview = document.createElement('span');
          preview.className = 'match-preview';
          appendHighlighted(preview, m.preview, m.previewStart, m.previewLength);
          row.appendChild(preview);
          resultsEl.appendChild(row);
        }
      }
    }
  }

  function renderEmpty() {
    var title = '';
    var body = '';
    var actions = [];
    var hasResults = (S.mode === 'files' ? S.data.files : S.data.text);
    var hasRows = !!hasResults && (S.mode === 'files'
      ? !!(S.data.files.results && S.data.files.results.length)
      : !!(S.data.text.files && S.data.text.files.length));
    if (hasRows) {
      emptyEl.classList.add('hidden');
      return;
    }
    if (!S.hasProjects) {
      title = T.noProjects;
      body = T.noProjectsHint;
      actions = [T.openProject, T.newProject];
    } else if (S.mode === 'text' && !currentQuery().trim()) {
      title = T.textHintTitle;
      body = T.textHintBody;
    } else if (hasResults && ((S.mode === 'files' && (!S.data.files.results || !S.data.files.results.length))
      || (S.mode === 'text' && (!S.data.text.files || !S.data.text.files.length)))) {
      title = T.noResults;
      body = T.adjustHint;
    } else if (S.mode === 'files' && !currentQuery().trim()) {
      if (hasResults) {
        title = T.noResults;
        body = T.adjustHint;
      } else {
        title = T.filesHintTitle;
        body = '';
      }
    } else {
      emptyEl.classList.add('hidden');
      return;
    }
    emptyEl.classList.remove('hidden');
    $('emptyTitle').textContent = title;
    $('emptyBody').textContent = body;
    var box = $('emptyActions');
    box.textContent = '';
    for (var i = 0; i < actions.length; i++) {
      var b = document.createElement('button');
      b.className = i === 0 ? 'primary' : 'ghost';
      b.textContent = actions[i];
      b.setAttribute('data-command', actions[i] === T.openProject ? 'codeblocks.openProject' : 'codeblocks.newProject');
      box.appendChild(b);
    }
  }

  function render() {
    var scrollTop = resultsEl.scrollTop;
    resultsEl.textContent = '';
    var data = S.mode === 'files' ? S.data.files : S.data.text;
    if (data) {
      if (S.mode === 'files') renderFileResults(data);
      else renderTextResults(data);
    }
    renderEmpty();
    updateChrome();
    resultsEl.scrollTop = scrollTop;
  }

  function formatTime(ts) {
    var delta = Math.max(0, Date.now() - Number(ts || 0));
    try {
      var lang = document.documentElement.lang || 'en';
      var rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
      if (delta < 60000) return T.justNow;
      if (delta < 3600000) return rtf.format(-Math.round(delta / 60000), 'minute');
      if (delta < 86400000) return rtf.format(-Math.round(delta / 3600000), 'hour');
      return rtf.format(-Math.round(delta / 86400000), 'day');
    } catch (e) {
      return '';
    }
  }

  function renderHistory() {
    historyList.textContent = '';
    var list = (S.history || []).filter(function (e) { return e.mode === S.mode; });
    $('historyCount').textContent = String(list.length);
    if (!S.keepHistory) {
      var off = document.createElement('div');
      off.className = 'history-empty';
      off.textContent = T.historyOff + ' · ' + T.historyOffHint;
      historyList.appendChild(off);
      return;
    }
    if (!list.length) {
      var empty = document.createElement('div');
      empty.className = 'history-empty';
      empty.textContent = T.noHistory + ' · ' + T.noHistoryHint;
      historyList.appendChild(empty);
      return;
    }
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      var row = document.createElement('div');
      row.className = 'history-row';
      row.setAttribute('role', 'button');
      row.setAttribute('tabindex', '0');
      row.setAttribute('data-history-id', e.id);
      row.title = e.query;
      var mode = document.createElement('span');
      mode.className = 'mode';
      mode.appendChild(makeSvgIcon(e.mode === 'files' ? 'file' : 'search'));
      row.appendChild(mode);
      var q = document.createElement('span');
      q.className = 'q';
      q.textContent = e.query;
      row.appendChild(q);
      var meta = document.createElement('span');
      meta.className = 'meta';
      var text = formatTime(e.updatedAt);
      if (e.lastResult && e.lastResult.relativeFilename) {
        text = T.last + ' ' + e.lastResult.relativeFilename + (e.lastResult.line !== undefined ? ':' + (e.lastResult.line + 1) : '') + (text ? ' · ' + text : '');
      }
      meta.textContent = text;
      row.appendChild(meta);
      var rerun = document.createElement('button');
      rerun.className = 'rerun';
      rerun.appendChild(makeSvgIcon('refresh'));
      rerun.title = T.rerun;
      rerun.setAttribute('aria-label', T.rerun);
      rerun.setAttribute('data-history-rerun', e.id);
      row.appendChild(rerun);
      historyList.appendChild(row);
    }
  }

  function setHistoryCollapsed(collapsed) {
    S.historyCollapsed = !!collapsed;
    persist();
    if (!S.historyCollapsed) {
      post('getHistory', { mode: S.mode });
    }
    updateChrome();
    renderHistory();
  }

  function toggleSwitch() {
    S.keepHistory = !S.keepHistory;
    persist();
    post('setKeepHistory', { value: S.keepHistory });
    updateChrome();
    renderHistory();
  }

  function handleFileClick(id) {
    if (!id) return;
    post('openFile', { id: id });
  }

  function handleMatchClick(id) {
    if (!id) return;
    post('openMatch', { id: id });
  }

  function moveSelection(delta) {
    var rows = Array.prototype.slice.call(resultsEl.querySelectorAll('.file-row, .match-row'));
    if (!rows.length) return;
    var at = -1;
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].classList.contains('selected')) { at = i; break; }
    }
    var next = at < 0 ? (delta > 0 ? 0 : rows.length - 1) : Math.max(0, Math.min(rows.length - 1, at + delta));
    selectRow(rows[next]);
  }

  function revealSelected() {
    var row = resultsEl.querySelector('.selected');
    if (!row) return;
    var id = row.getAttribute('data-file-id') || row.getAttribute('data-match-id');
    if (id) post('revealFile', { id: id });
  }

  function activateSelected() {
    var row = resultsEl.querySelector('.selected');
    if (!row) return false;
    var fileId = row.getAttribute('data-file-id');
    if (fileId) { handleFileClick(fileId); return true; }
    var matchId = row.getAttribute('data-match-id');
    if (matchId) { handleMatchClick(matchId); return true; }
    return false;
  }

  queryEl.addEventListener('compositionstart', function () { S.composing = true; });
  queryEl.addEventListener('compositionend', function () {
    S.composing = false;
    if (S.mode === 'files') scheduleFiles();
  });
  queryEl.addEventListener('input', function () {
    setQuery(queryEl.value);
    if (S.mode === 'files' && !S.composing) scheduleFiles();
  });
  queryEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) { revealSelected(); return; }
      if (S.mode === 'text') { runSearch(); return; }
      if (!activateSelected()) {
        runSearch();
        post('commitHistory', { mode: 'files', query: currentQuery() });
      }
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      moveSelection(ev.key === 'ArrowDown' ? 1 : -1);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      if (queryEl.value) clearQuery();
    }
  });

  $('modeFiles').addEventListener('click', function () { setMode('files'); });
  $('modeText').addEventListener('click', function () { setMode('text'); });
  $('searchBtn').addEventListener('click', runSearch);
  $('stopBtn').addEventListener('click', function () { post('cancel', {}); });
  $('clearQuery').addEventListener('click', clearQuery);
  $('refreshBtn').addEventListener('click', function () { post('refresh', {}); if (S.mode === 'files') runSearch(); else if (currentQuery().trim()) runSearch(); });
  function setAllExpanded(value) {
    var items = S.mode === 'files'
      ? (S.data.files && S.data.files.results) || []
      : (S.data.text && S.data.text.files) || [];
    if (!items.length) return;
    for (var i = 0; i < items.length; i++) {
      S.groups[projectKeyOf(items[i])] = value;
      if (S.mode === 'text') S.expanded[items[i].id] = value;
    }
    persist(); render();
  }

  $('expandAll').addEventListener('click', function () { setAllExpanded(true); });
  $('collapseAll').addEventListener('click', function () { setAllExpanded(false); });
  $('caseToggle').addEventListener('click', function () {
    S.caseSensitive = !S.caseSensitive;
    persist();
    post('stateChanged', { mode: S.mode, queries: S.queries, caseSensitive: S.caseSensitive, wholeWord: S.wholeWord, regex: S.regex });
    updateChrome(); rerunForOptions();
  });
  $('wholeWordToggle').addEventListener('click', function () {
    S.wholeWord = !S.wholeWord;
    persist();
    post('stateChanged', { mode: S.mode, queries: S.queries, caseSensitive: S.caseSensitive, wholeWord: S.wholeWord, regex: S.regex });
    updateChrome(); rerunForOptions();
  });
  $('regexToggle').addEventListener('click', function () {
    S.regex = !S.regex;
    persist();
    post('stateChanged', { mode: S.mode, queries: S.queries, caseSensitive: S.caseSensitive, wholeWord: S.wholeWord, regex: S.regex });
    updateChrome(); rerunForOptions();
  });
  scopeEl.addEventListener('change', function () {
    S.scope = scopeEl.value === 'activeProject' ? 'activeProject' : 'openProjects';
    persist();
    post('setScope', { scope: S.scope });
    if (S.mode === 'text' && currentQuery().trim()) runSearch();
    else if (S.mode === 'files') scheduleFiles();
  });
  $('scopeChipClear').addEventListener('click', function () {
    S.subtree = null;
    post('clearSubtreeScope', {});
    updateChrome();
    if (S.mode === 'files') scheduleFiles();
    else if (currentQuery().trim()) runSearch();
  });
  $('historyToggle').addEventListener('click', function () { setHistoryCollapsed(!S.historyCollapsed); });
  switchEl.addEventListener('click', toggleSwitch);
  switchEl.addEventListener('keydown', function (ev) {
    if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggleSwitch(); }
  });
  $('clearHistory').addEventListener('click', function () {
    post('requestClearHistory', {});
  });
  resultsEl.addEventListener('click', function (ev) {
    var target = ev.target;
    var reveal = target.closest ? target.closest('[data-reveal-id]') : null;
    if (reveal) { ev.stopPropagation(); post('revealFile', { id: reveal.getAttribute('data-reveal-id') }); return; }
    var more = target.closest ? target.closest('[data-load-more]') : null;
    if (more) { S.renderLimit += 200; render(); return; }
    var projectHead = target.closest ? target.closest('[data-project-group]') : null;
    if (projectHead) {
      var key = projectHead.getAttribute('data-project-group');
      S.groups[key] = !isGroupExpanded(key);
      persist();
      render();
      return;
    }
    var chevron = target.closest ? target.closest('.chevron') : null;
    var group = chevron && chevron.parentNode ? chevron.parentNode.closest('[data-file-group]') : null;
    if (group) {
      var gid = group.getAttribute('data-file-group');
      S.expanded[gid] = !isExpanded(gid);
      persist();
      render();
      return;
    }
    var match = target.closest ? target.closest('[data-match-id]') : null;
    if (match) { selectRow(match); handleMatchClick(match.getAttribute('data-match-id')); return; }
    var file = target.closest ? target.closest('[data-file-id]') : null;
    if (file) { selectRow(file); handleFileClick(file.getAttribute('data-file-id')); }
  });
  resultsEl.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' || ev.key === ' ') {
      var head = ev.target.closest ? ev.target.closest('[data-project-group]') : null;
      if (head) {
        ev.preventDefault();
        var key = head.getAttribute('data-project-group');
        S.groups[key] = !isGroupExpanded(key);
        persist();
        render();
        return;
      }
      var row = ev.target.closest ? ev.target.closest('[data-select-id]') : null;
      if (row) {
        ev.preventDefault();
        selectRow(row);
        if (ev.key === 'Enter') activateSelected();
      }
    }
  });
  historyList.addEventListener('click', function (ev) {
    var rerun = ev.target.closest ? ev.target.closest('[data-history-rerun]') : null;
    if (rerun) {
      ev.stopPropagation();
      post('runHistory', { id: rerun.getAttribute('data-history-rerun'), action: 'rerun' });
      return;
    }
    var row = ev.target.closest ? ev.target.closest('[data-history-id]') : null;
    if (row) {
      post('runHistory', { id: row.getAttribute('data-history-id'), action: 'jump' });
    }
  });
  historyList.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var row = ev.target.closest ? ev.target.closest('[data-history-id]') : null;
    if (row) {
      ev.preventDefault();
      post('runHistory', { id: row.getAttribute('data-history-id'), action: ev.key === 'Enter' ? 'jump' : 'rerun' });
    }
  });
  $('emptyActions').addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-command]') : null;
    if (btn) post('runCommand', { command: btn.getAttribute('data-command') });
  });
  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'state') {
      var modeChanged = (msg.mode === 'files' || msg.mode === 'text') && msg.mode !== S.mode;
      if (msg.mode === 'files' || msg.mode === 'text') S.mode = msg.mode;
      if (modeChanged) post('getHistory', { mode: S.mode });
      if (msg.queries && typeof msg.queries === 'object') {
        if (typeof msg.queries.files === 'string') S.queries.files = msg.queries.files;
        if (typeof msg.queries.text === 'string') S.queries.text = msg.queries.text;
      }
      if (msg.scope === 'openProjects' || msg.scope === 'activeProject') S.scope = msg.scope;
      S.caseSensitive = msg.caseSensitive === true;
      S.wholeWord = msg.wholeWord === true;
      S.regex = msg.regex === true;
      S.keepHistory = msg.keepHistory !== false;
      S.hasProjects = msg.hasProjects === true;
      S.projectCount = Number(msg.projectCount) || 0;
      S.fileCount = Number(msg.fileCount) || 0;
      S.activeProject = msg.activeProject || '';
      S.subtree = msg.subtree || null;
      if (document.activeElement !== queryEl) setQuery(currentQuery());
      updateChrome();
      render();
      renderHistory();
    } else if (msg.type === 'activated') {
      if (msg.mode === 'files' || msg.mode === 'text') S.mode = msg.mode;
      if (typeof msg.query === 'string' && msg.query) S.queries[S.mode] = msg.query;
      S.running = false;
      updateChrome();
      render();
      queryEl.focus();
      queryEl.select();
    } else if (msg.type === 'searchStarted') {
      S.running = true;
      S.searchMode = msg.mode || S.mode;
      updateChrome();
    } else if (msg.type === 'searchDone') {
      S.running = false;
      showProgress(false, 0);
      updateChrome();
    } else if (msg.type === 'fileResults') {
      S.running = false;
      S.data.files = msg;
      S.expanded = {};
      S.groups = {};
      persist();
      showProgress(false, 0);
      render();
      setStatus((msg.total || 0) + ' ' + T.filesUnit + ' · ' + (msg.elapsedMs || 0) + ' ms' + (msg.truncated ? ' · ' + T.truncated : ''), 'ok');
    } else if (msg.type === 'textProgress') {
      var total = Number(msg.total) || 0;
      var scanned = Number(msg.scanned) || 0;
      setStatus(T.scanning + ' ' + scanned + '/' + total + ' · ' + (Number(msg.matches) || 0) + ' ' + T.matchesUnit, '');
      showProgress(true, total ? scanned / total : 0);
    } else if (msg.type === 'textResults') {
      S.running = false;
      S.data.text = msg;
      S.expanded = {};
      S.groups = {};
      persist();
      showProgress(false, 0);
      render();
      var status = (msg.matchCount || 0) + ' ' + T.resultsUnit + ' \u00b7 ' + (msg.fileCount || 0) + ' ' + T.filesUnit + ' \u00b7 ' + (msg.elapsedMs || 0) + ' ms';
      if (msg.cancelled) status += ' · ' + T.cancelled;
      if (msg.timedOut) status += ' · ' + T.timedOut;
      if (msg.truncated) status += ' · ' + T.truncated;
      setStatus(status, 'ok');
    } else if (msg.type === 'history') {
      S.history = Array.isArray(msg.entries) ? msg.entries : [];
      renderHistory();
      updateChrome();
    } else if (msg.type === 'scopeOverride') {
      S.subtree = msg.subtree || null;
      updateChrome();
    } else if (msg.type === 'error') {
      S.running = false;
      showProgress(false, 0);
      updateChrome();
      setStatus((msg.message || T.searchFailed), 'error');
    }
  });

  // Seti 字体可用时切换为 Explorer 同款字形，否则保留字母图标
  if (document.fonts && document.fonts.load) {
    document.fonts.load('16px seti').then(function (faces) {
      if (!faces || !faces.length) return;
      document.documentElement.classList.add('seti-font');
      render();
    }).catch(function () { /* 忽略：回退字母图标 */ });
  }

  updateChrome();
  renderHistory();
  post('getHistory', { mode: S.mode });
  post('ready', {});
})();
</script>
</body>
</html>`;
}
