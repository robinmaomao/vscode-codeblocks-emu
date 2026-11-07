/**
 * 工程搜索 WebviewView 的静态 HTML/CSS/JS 模板。
 *
 * 约定：
 *  - 所有中文 UI 文案集中在 `i18n.tr('中文')`（i18n WebView 反查表测试会扫描本文件）；
 *  - 动态数据只经 postMessage 下发，前端用 textContent / createElement 渲染（禁止 innerHTML）；
 *  - 内联 JS 禁止模板字符串 `${}`（会被服务端模板插值），统一字符串拼接。
 */
import * as i18n from '../i18n';

export function buildProjectSearchViewHtml(): string {
  return `<!DOCTYPE html>
<html lang="${i18n.htmlLang()}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
<style>
:root { color-scheme: light dark; }
html, body { height: 100%; margin: 0; padding: 0; }
body {
  font-family: var(--vscode-font-family);
  font-size: 12px;
  color: var(--vscode-foreground);
  background: var(--vscode-sideBar-background);
  overflow: hidden;
}
#root { display: flex; flex-direction: column; height: 100%; min-height: 0; }
button, select, input { font-family: inherit; font-size: 12px; }
button { cursor: pointer; }
.hidden { display: none !important; }
.topbar { display: flex; align-items: center; gap: 6px; padding: 7px 8px 5px; }
.topbar .spacer { flex: 1; }
.ghost {
  border: 1px solid transparent; background: transparent; color: var(--vscode-foreground);
  border-radius: 4px; padding: 2px 5px; line-height: 18px;
}
.ghost:hover { background: var(--vscode-toolbar-hoverBackground); }
.ghost.small { font-size: 11px; }
.ghost.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
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
.history {
  margin: 0 8px 6px; border: 1px solid var(--vscode-widget-border, var(--vscode-input-border, #555));
  border-radius: 5px; background: var(--vscode-editorWidget-background);
  max-height: 220px; overflow: auto; box-shadow: 0 3px 10px var(--vscode-widget-shadow);
}
.history-list { padding: 3px; }
.history-row {
  display: flex; align-items: center; gap: 6px; padding: 4px 6px; border-radius: 4px;
  cursor: pointer; outline: none;
}
.history-row:hover, .history-row:focus-visible { background: var(--vscode-list-hoverBackground); }
.history-row .mode { flex: 0 0 18px; text-align: center; opacity: .8; }
.history-row .q { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-row .meta { flex: 0 0 auto; max-width: 45%; color: var(--vscode-descriptionForeground); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.history-row .rerun { flex: 0 0 auto; border: none; background: transparent; color: var(--vscode-textLink-foreground); padding: 1px 3px; border-radius: 3px; }
.history-row .rerun:hover { background: var(--vscode-toolbar-hoverBackground); }
.history-empty { padding: 12px 8px; color: var(--vscode-descriptionForeground); text-align: center; }
.history-foot { display: flex; gap: 4px; padding: 4px 6px; border-top: 1px solid var(--vscode-widget-border, transparent); }
.confirm { display: flex; align-items: center; gap: 6px; padding: 5px 7px; border-top: 1px solid var(--vscode-widget-border, transparent); }
.confirm span { flex: 1; }
.searchbar { display: flex; align-items: center; gap: 5px; margin: 0 8px; position: relative; }
.search-icon { position: absolute; left: 6px; color: var(--vscode-descriptionForeground); pointer-events: none; font-size: 14px; }
#query {
  flex: 1; min-width: 0; box-sizing: border-box; padding: 4px 22px 4px 23px; height: 26px;
  color: var(--vscode-input-foreground); background: var(--vscode-input-background);
  border: 1px solid var(--vscode-input-border, transparent); border-radius: 4px; outline: none;
}
#query:focus { border-color: var(--vscode-focusBorder); }
#query::placeholder { color: var(--vscode-input-placeholderForeground); }
.icon {
  border: none; background: transparent; color: var(--vscode-foreground); padding: 2px 4px;
  border-radius: 3px; line-height: 16px; font-size: 13px;
}
.icon:hover { background: var(--vscode-toolbar-hoverBackground); }
#clearQuery { position: absolute; right: 64px; }
.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 3px 8px; height: 24px; }
.primary:hover { background: var(--vscode-button-hoverBackground); }
.danger { background: var(--vscode-inputValidation-errorBackground, #a1260d); color: #fff; border: none; border-radius: 4px; padding: 3px 8px; height: 24px; }
.controls { display: flex; align-items: center; gap: 8px; padding: 6px 8px 0; flex-wrap: wrap; }
.segmented { display: inline-flex; border-radius: 4px; overflow: hidden; border: 1px solid var(--vscode-input-border, transparent); }
.segment {
  border: none; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
  padding: 3px 9px; line-height: 18px;
}
.segment.active { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
#scope {
  margin-left: auto; max-width: 52%; color: var(--vscode-dropdown-foreground); background: var(--vscode-dropdown-background);
  border: 1px solid var(--vscode-dropdown-border, transparent); border-radius: 4px; padding: 2px 4px; height: 24px;
}
.chip {
  display: flex; align-items: center; gap: 4px; margin: 5px 8px 0; padding: 2px 3px 2px 7px;
  border-radius: 10px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-size: 11px;
}
.chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chip button { border: none; background: transparent; color: inherit; padding: 0 3px; font-size: 13px; }
.options { display: flex; align-items: center; gap: 4px; padding: 5px 8px 3px; flex-wrap: wrap; }
.options .spacer { flex: 1; }
.toggle {
  min-width: 24px; height: 21px; border-radius: 4px; border: 1px solid transparent;
  background: transparent; color: var(--vscode-foreground); font-size: 11px;
}
.toggle:hover { background: var(--vscode-toolbar-hoverBackground); }
.toggle[aria-pressed="true"] { background: var(--vscode-inputOption-activeBackground, var(--vscode-list-activeSelectionBackground)); border-color: var(--vscode-inputOption-activeBorder, transparent); color: var(--vscode-inputOption-activeForeground, var(--vscode-list-activeSelectionForeground)); }
.hint { color: var(--vscode-descriptionForeground); font-size: 10px; margin-left: 3px; }
.status { display: flex; align-items: center; gap: 6px; padding: 2px 9px 4px; color: var(--vscode-descriptionForeground); font-size: 11px; min-height: 17px; }
.status .text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.progress { flex: 0 0 46px; height: 3px; border-radius: 2px; background: var(--vscode-progressBar-background); opacity: .25; overflow: hidden; }
.progress > div { height: 100%; width: 0; background: var(--vscode-progressBar-background); opacity: 1; transition: width .15s linear; }
.results { flex: 1; min-height: 0; overflow: auto; padding: 0 4px 6px; contain: content; }
.group-head {
  display: flex; align-items: center; gap: 5px; padding: 4px 5px; margin-top: 3px;
  background: var(--vscode-sideBarSectionHeader-background, transparent); border-radius: 3px;
  color: var(--vscode-sideBarSectionHeader-foreground, var(--vscode-foreground)); font-weight: 600;
  position: sticky; top: 0; z-index: 1;
}
.group-head .count { margin-left: auto; font-weight: 400; color: var(--vscode-descriptionForeground); font-size: 11px; }
.result-row {
  display: flex; align-items: center; gap: 5px; padding: 2px 5px; border-radius: 3px;
  line-height: 19px; cursor: pointer; outline: none;
}
.result-row:hover { background: var(--vscode-list-hoverBackground); }
.result-row.selected, .result-row:focus-visible { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.result-row .file-icon { flex: 0 0 15px; opacity: .75; }
.result-row .name { flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.result-row .dir { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); font-size: 11px; }
.result-row.selected .dir { color: inherit; opacity: .8; }
.result-row .reveal { flex: 0 0 auto; opacity: 0; border: none; background: transparent; color: inherit; padding: 0 2px; }
.result-row:hover .reveal, .result-row:focus-within .reveal, .result-row.selected .reveal { opacity: .8; }
.result-row mark, .match-preview mark { background: var(--vscode-editor-findMatchHighlightBackground); color: var(--vscode-editor-findMatchForeground, inherit); border-radius: 2px; }
.file-head {
  display: flex; align-items: center; gap: 5px; padding: 3px 5px; border-radius: 3px;
  color: var(--vscode-foreground); cursor: pointer; outline: none;
}
.file-head:hover { background: var(--vscode-list-hoverBackground); }
.file-head .twisty { flex: 0 0 12px; opacity: .8; }
.file-head .path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-head .count { flex: 0 0 auto; color: var(--vscode-descriptionForeground); font-size: 11px; }
.file-head .reveal { flex: 0 0 auto; opacity: 0; border: none; background: transparent; color: inherit; padding: 0 2px; }
.file-head:hover .reveal, .file-head:focus-within .reveal { opacity: .8; }
.match-row {
  display: flex; align-items: baseline; gap: 6px; padding: 1px 5px 1px 22px; border-radius: 3px;
  cursor: pointer; outline: none; line-height: 19px;
}
.match-row:hover { background: var(--vscode-list-hoverBackground); }
.match-row.selected, .match-row:focus-visible { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
.match-row .line { flex: 0 0 38px; text-align: right; color: var(--vscode-editorLineNumber-foreground, var(--vscode-descriptionForeground)); font-family: var(--vscode-editor-font-family); font-size: 11px; }
.match-row.selected .line { color: inherit; opacity: .8; }
.match-row .match-preview { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: pre; font-family: var(--vscode-editor-font-family); font-size: 12px; }
.load-more { display: block; width: calc(100% - 10px); margin: 6px 5px; padding: 3px; }
.empty { padding: 18px 14px; text-align: center; color: var(--vscode-descriptionForeground); }
.empty .title { color: var(--vscode-foreground); font-weight: 600; margin-bottom: 5px; }
.empty .body { line-height: 17px; }
.empty-actions { display: flex; justify-content: center; gap: 6px; margin-top: 9px; flex-wrap: wrap; }
.footer { flex: 0 0 auto; padding: 4px 9px 6px; color: var(--vscode-descriptionForeground); font-size: 10px; border-top: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); }
.spin { display: inline-block; width: 11px; height: 11px; border: 2px solid var(--vscode-progressBar-background); border-top-color: transparent; border-radius: 50%; animation: spin .8s linear infinite; vertical-align: -2px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { * { transition: none !important; animation: none !important; } }
@media (max-width: 240px) {
  .history-label, .switch-label { display: none; }
  .controls { gap: 4px; }
  #scope { max-width: 60%; }
  .result-row .dir { display: none; }
  .footer { display: none; }
}
</style>
</head>
<body>
<div id="root">
  <div class="topbar">
    <button id="historyToggle" class="ghost" aria-expanded="false" title="${i18n.tr('搜索历史')}">🕘 <span class="history-label">${i18n.tr('搜索历史')}</span></button>
    <span class="spacer"></span>
    <span class="switch-wrap" title="${i18n.tr('保留搜索历史')}">
      <span class="switch-label">${i18n.tr('保留历史')}</span>
      <span id="historySwitch" class="switch" role="switch" aria-checked="true" tabindex="0" aria-label="${i18n.tr('保留搜索历史')}"><span class="knob"></span></span>
    </span>
    <button id="clearHistory" class="ghost small" title="${i18n.tr('清空')}">${i18n.tr('清空')}</button>
  </div>
  <div id="historyPanel" class="history hidden" role="dialog" aria-label="${i18n.tr('搜索历史')}">
    <div id="historyList" class="history-list"></div>
    <div class="history-foot">
      <button id="historyFilterCurrent" class="ghost small active">${i18n.tr('当前模式')}</button>
      <button id="historyFilterAll" class="ghost small">${i18n.tr('全部')}</button>
    </div>
    <div id="historyConfirm" class="confirm hidden">
      <span>${i18n.tr('清空搜索历史？')}</span>
      <button id="historyConfirmYes" class="danger small">${i18n.tr('清空')}</button>
      <button id="historyConfirmNo" class="ghost small">${i18n.tr('取消')}</button>
    </div>
  </div>
  <div class="searchbar">
    <span class="search-icon">⌕</span>
    <input id="query" type="text" autocomplete="off" spellcheck="false" placeholder="${i18n.tr('搜索工程文件或内容…')}" aria-label="${i18n.tr('搜索工程文件或内容…')}">
    <button id="clearQuery" class="icon hidden" title="${i18n.tr('清除')}">×</button>
    <button id="searchBtn" class="primary">${i18n.tr('搜索')}</button>
    <button id="stopBtn" class="danger hidden">${i18n.tr('停止')}</button>
  </div>
  <div class="controls">
    <div class="segmented" role="tablist">
      <button id="modeFiles" class="segment active" role="tab" aria-selected="true">${i18n.tr('文件')}</button>
      <button id="modeText" class="segment" role="tab" aria-selected="false">${i18n.tr('内容')}</button>
    </div>
    <select id="scope" aria-label="${i18n.tr('范围')}">
      <option value="openProjects">${i18n.tr('所有工程')}</option>
      <option value="activeProject">${i18n.tr('当前活动工程')}</option>
    </select>
  </div>
  <div id="scopeChip" class="chip hidden"><span id="scopeChipLabel"></span><button id="scopeChipClear" title="${i18n.tr('清除范围')}">×</button></div>
  <div class="options">
    <button id="caseToggle" class="toggle" title="${i18n.tr('区分大小写')}" aria-pressed="false">Aa</button>
    <button id="regexToggle" class="toggle" title="${i18n.tr('使用正则表达式')}" aria-pressed="false">.*</button>
    <span class="hint">Ctrl+Alt+P</span>
    <span class="spacer"></span>
    <button id="refreshBtn" class="icon" title="${i18n.tr('刷新')}">⟳</button>
    <button id="expandAll" class="icon" title="${i18n.tr('全部展开')}">⊞</button>
    <button id="collapseAll" class="icon" title="${i18n.tr('全部折叠')}">⊟</button>
  </div>
  <div id="status" class="status" aria-live="polite"><span id="statusText" class="text"></span><div id="progress" class="progress hidden"><div id="progressBar"></div></div></div>
  <div id="results" class="results" role="listbox"></div>
  <div id="empty" class="empty hidden"><div id="emptyTitle" class="title"></div><div id="emptyBody" class="body"></div><div id="emptyActions" class="empty-actions"></div></div>
  <div class="footer">${i18n.tr('文件模式空查询浏览全部；内容模式回车搜索')}</div>
</div>
<script>
(function () {
  var vscode = acquireVsCodeApi();
  var T = {
    files: "${i18n.tr('文件')}",
    text: "${i18n.tr('内容')}",
    filesUnit: "${i18n.tr('个文件')}",
    matchesUnit: "${i18n.tr('处匹配')}",
    filesMatchedUnit: "${i18n.tr('个文件')}",
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
  var historyPanel = $('historyPanel');
  var historyList = $('historyList');
  var switchEl = $('historySwitch');
  var scopeEl = $('scope');
  var chipEl = $('scopeChip');

  var S = {
    mode: 'files',
    queries: { files: '', text: '' },
    scope: 'openProjects',
    caseSensitive: false,
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
    historyFilter: 'current',
    historyOpen: false,
    data: { files: null, text: null },
    expanded: {},
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
      S.regex = saved.regex === true;
      if (saved.expanded && typeof saved.expanded === 'object') S.expanded = saved.expanded;
    }
  } catch (e) { /* 忽略损坏状态 */ }

  function persist() {
    try {
      vscode.setState({
        mode: S.mode,
        queries: S.queries,
        scope: S.scope,
        caseSensitive: S.caseSensitive,
        regex: S.regex,
        expanded: S.expanded
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
    $('regexToggle').setAttribute('aria-pressed', S.regex ? 'true' : 'false');
    switchEl.setAttribute('aria-checked', S.keepHistory ? 'true' : 'false');
    $('clearHistory').classList.remove('hidden');
    $('searchBtn').classList.toggle('hidden', S.running);
    $('stopBtn').classList.toggle('hidden', !S.running);
    $('historyToggle').setAttribute('aria-expanded', S.historyOpen ? 'true' : 'false');
    historyPanel.classList.toggle('hidden', !S.historyOpen);
    queryEl.placeholder = S.mode === 'files'
      ? "${i18n.tr('搜索工程文件或内容…')}"
      : "${i18n.tr('搜索工程文件或内容…')}";
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
    post('stateChanged', { mode: S.mode, queries: S.queries, caseSensitive: S.caseSensitive, regex: S.regex });
    updateChrome();
    render();
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

  function makeIcon(text) {
    var el = document.createElement('span');
    el.className = 'file-icon';
    el.textContent = text;
    return el;
  }

  function makeRevealButton(id) {
    var b = document.createElement('button');
    b.className = 'reveal';
    b.textContent = '⤢';
    b.title = T.reveal;
    b.setAttribute('data-reveal-id', id);
    b.setAttribute('aria-label', T.reveal);
    return b;
  }

  function selectRow(row) {
    var old = resultsEl.querySelector('.result-row.selected, .match-row.selected');
    if (old) old.classList.remove('selected');
    if (row) {
      row.classList.add('selected');
      S.selectedId = row.getAttribute('data-select-id') || '';
      row.scrollIntoView({ block: 'nearest' });
    } else {
      S.selectedId = '';
    }
  }

  function renderFileResults(msg) {
    var list = (msg && msg.results) || [];
    if (!list.length) return;
    var groups = [];
    var by = {};
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      var title = r.projectTitle || '';
      if (!by[title]) { by[title] = []; groups.push(title); }
      by[title].push(r);
    }
    var shown = 0;
    for (var g = 0; g < groups.length; g++) {
      var head = document.createElement('div');
      head.className = 'group-head';
      var name = document.createElement('span');
      name.textContent = groups[g] + (list.some(function (x) { return x.projectTitle === groups[g] && x.isActive; }) ? ' · ' + T.activeFirst : '');
      head.appendChild(name);
      var count = document.createElement('span');
      count.className = 'count';
      count.textContent = by[groups[g]].length + ' ' + T.filesUnit;
      head.appendChild(count);
      resultsEl.appendChild(head);

      for (var j = 0; j < by[groups[g]].length && shown < S.renderLimit; j++) {
        var item = by[groups[g]][j];
        var row = document.createElement('div');
        row.className = 'result-row';
        row.setAttribute('role', 'option');
        row.tabIndex = 0;
        row.setAttribute('data-file-id', item.id);
        row.setAttribute('data-select-id', item.id);
        row.title = item.absolutePath || item.relativePath || '';
        row.appendChild(makeIcon('📄'));
        var label = document.createElement('span');
        label.className = 'name';
        appendRanges(label, item.basename || item.relativePath || '', item.ranges);
        row.appendChild(label);
        var dir = document.createElement('span');
        dir.className = 'dir';
        dir.textContent = item.relativePath || '';
        row.appendChild(dir);
        row.appendChild(makeRevealButton(item.id));
        resultsEl.appendChild(row);
        shown++;
      }
    }
    if (list.length > shown || (msg && msg.truncated)) {
      var more = document.createElement('button');
      more.className = 'ghost load-more';
      more.textContent = T.loadMore;
      more.setAttribute('data-load-more', '1');
      resultsEl.appendChild(more);
    }
  }

  function isExpanded(id, index) {
    if (Object.prototype.hasOwnProperty.call(S.expanded, id)) return S.expanded[id] !== false;
    return index < 2;
  }

  function renderTextResults(msg) {
    var files = (msg && msg.files) || [];
    if (!files.length) return;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var head = document.createElement('div');
      head.className = 'file-head';
      head.setAttribute('role', 'treeitem');
      head.setAttribute('tabindex', '0');
      head.setAttribute('data-file-group', f.id);
      head.setAttribute('aria-expanded', isExpanded(f.id, i) ? 'true' : 'false');
      var twisty = document.createElement('span');
      twisty.className = 'twisty';
      twisty.textContent = isExpanded(f.id, i) ? '▾' : '▸';
      head.appendChild(twisty);
      var path = document.createElement('span');
      path.className = 'path';
      path.textContent = (f.projectTitle ? f.projectTitle + ' / ' : '') + (f.relativePath || '');
      head.appendChild(path);
      var count = document.createElement('span');
      count.className = 'count';
      count.textContent = f.matches.length + ' ' + T.matchesUnit;
      head.appendChild(count);
      head.appendChild(makeRevealButton(f.id));
      resultsEl.appendChild(head);

      if (isExpanded(f.id, i)) {
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
    resultsEl.textContent = '';
    var data = S.mode === 'files' ? S.data.files : S.data.text;
    if (data) {
      if (S.mode === 'files') renderFileResults(data);
      else renderTextResults(data);
    }
    renderEmpty();
    updateChrome();
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
    var list = S.history || [];
    if (S.historyFilter === 'current') {
      list = list.filter(function (e) { return e.mode === S.mode; });
    }
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
      mode.textContent = e.mode === 'files' ? '📄' : '🔎';
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
      rerun.textContent = '↻';
      rerun.title = T.rerun;
      rerun.setAttribute('aria-label', T.rerun);
      rerun.setAttribute('data-history-rerun', e.id);
      row.appendChild(rerun);
      historyList.appendChild(row);
    }
  }

  function openHistory(open) {
    S.historyOpen = !!open;
    if (S.historyOpen) {
      $('historyConfirm').classList.add('hidden');
      post('getHistory', { mode: S.historyFilter === 'all' ? 'all' : S.mode });
    }
    updateChrome();
    renderHistory();
  }

  function toggleSwitch() {
    S.keepHistory = !S.keepHistory;
    persist();
    post('setKeepHistory', { value: S.keepHistory });
    updateChrome();
    if (!S.keepHistory) S.historyOpen = false;
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
    var rows = Array.prototype.slice.call(resultsEl.querySelectorAll('.result-row, .match-row'));
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
      if (S.historyOpen) { return; }
      if (ev.ctrlKey || ev.metaKey) { revealSelected(); return; }
      if (S.mode === 'text') { runSearch(); return; }
      if (!activateSelected()) runSearch();
    } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (ev.key === 'ArrowDown' && !queryEl.value.trim()) { openHistory(true); return; }
      moveSelection(ev.key === 'ArrowDown' ? 1 : -1);
    } else if (ev.key === 'Escape') {
      ev.preventDefault();
      if (S.historyOpen) openHistory(false);
      else if (queryEl.value) clearQuery();
    }
  });

  $('modeFiles').addEventListener('click', function () { setMode('files'); });
  $('modeText').addEventListener('click', function () { setMode('text'); });
  $('searchBtn').addEventListener('click', runSearch);
  $('stopBtn').addEventListener('click', function () { post('cancel', {}); });
  $('clearQuery').addEventListener('click', clearQuery);
  $('refreshBtn').addEventListener('click', function () { post('refresh', {}); if (S.mode === 'files') runSearch(); else if (currentQuery().trim()) runSearch(); });
  $('expandAll').addEventListener('click', function () {
    if (S.mode !== 'text' || !S.data.text) return;
    for (var i = 0; i < S.data.text.files.length; i++) S.expanded[S.data.text.files[i].id] = true;
    persist(); render();
  });
  $('collapseAll').addEventListener('click', function () {
    if (S.mode !== 'text' || !S.data.text) return;
    for (var i = 0; i < S.data.text.files.length; i++) S.expanded[S.data.text.files[i].id] = false;
    persist(); render();
  });
  $('caseToggle').addEventListener('click', function () {
    S.caseSensitive = !S.caseSensitive;
    persist();
    post('stateChanged', { mode: S.mode, queries: S.queries, caseSensitive: S.caseSensitive, regex: S.regex });
    updateChrome(); rerunForOptions();
  });
  $('regexToggle').addEventListener('click', function () {
    S.regex = !S.regex;
    persist();
    post('stateChanged', { mode: S.mode, queries: S.queries, caseSensitive: S.caseSensitive, regex: S.regex });
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
  $('historyToggle').addEventListener('click', function () { openHistory(!S.historyOpen); });
  switchEl.addEventListener('click', toggleSwitch);
  switchEl.addEventListener('keydown', function (ev) {
    if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); toggleSwitch(); }
  });
  $('clearHistory').addEventListener('click', function () {
    S.historyOpen = true;
    updateChrome();
    $('historyConfirm').classList.remove('hidden');
  });
  $('historyConfirmNo').addEventListener('click', function () {
    $('historyConfirm').classList.add('hidden');
  });
  $('historyConfirmYes').addEventListener('click', function () {
    $('historyConfirm').classList.add('hidden');
    post('clearHistory', {});
    S.history = [];
    renderHistory();
  });
  $('historyFilterCurrent').addEventListener('click', function () {
    S.historyFilter = 'current';
    $('historyFilterCurrent').classList.add('active');
    $('historyFilterAll').classList.remove('active');
    post('getHistory', { mode: S.mode });
    renderHistory();
  });
  $('historyFilterAll').addEventListener('click', function () {
    S.historyFilter = 'all';
    $('historyFilterAll').classList.add('active');
    $('historyFilterCurrent').classList.remove('active');
    post('getHistory', { mode: 'all' });
    renderHistory();
  });

  resultsEl.addEventListener('click', function (ev) {
    var target = ev.target;
    var reveal = target.closest ? target.closest('[data-reveal-id]') : null;
    if (reveal) { ev.stopPropagation(); post('revealFile', { id: reveal.getAttribute('data-reveal-id') }); return; }
    var more = target.closest ? target.closest('[data-load-more]') : null;
    if (more) { S.renderLimit += 200; render(); return; }
    var group = target.closest ? target.closest('[data-file-group]') : null;
    if (group) {
      var gid = group.getAttribute('data-file-group');
      S.expanded[gid] = !isExpanded(gid, 0);
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
      openHistory(false);
      post('runHistory', { id: rerun.getAttribute('data-history-rerun'), action: 'rerun' });
      return;
    }
    var row = ev.target.closest ? ev.target.closest('[data-history-id]') : null;
    if (row) {
      openHistory(false);
      post('runHistory', { id: row.getAttribute('data-history-id'), action: 'jump' });
    }
  });
  historyList.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    var row = ev.target.closest ? ev.target.closest('[data-history-id]') : null;
    if (row) {
      ev.preventDefault();
      openHistory(false);
      post('runHistory', { id: row.getAttribute('data-history-id'), action: ev.key === 'Enter' ? 'jump' : 'rerun' });
    }
  });
  $('emptyActions').addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-command]') : null;
    if (btn) post('runCommand', { command: btn.getAttribute('data-command') });
  });
  document.addEventListener('click', function (ev) {
    if (!S.historyOpen) return;
    if (historyPanel.contains(ev.target) || $('historyToggle').contains(ev.target) || $('clearHistory').contains(ev.target) || switchEl.contains(ev.target)) return;
    openHistory(false);
  });

  window.addEventListener('message', function (event) {
    var msg = event.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'state') {
      if (msg.mode === 'files' || msg.mode === 'text') S.mode = msg.mode;
      if (msg.queries && typeof msg.queries === 'object') {
        if (typeof msg.queries.files === 'string') S.queries.files = msg.queries.files;
        if (typeof msg.queries.text === 'string') S.queries.text = msg.queries.text;
      }
      if (msg.scope === 'openProjects' || msg.scope === 'activeProject') S.scope = msg.scope;
      S.caseSensitive = msg.caseSensitive === true;
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
      if (S.historyOpen) renderHistory();
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
      showProgress(false, 0);
      render();
      var status = (msg.matchCount || 0) + ' ' + T.matchesUnit + ' · ' + (msg.fileCount || 0) + ' ' + T.filesMatchedUnit + ' · ' + (msg.elapsedMs || 0) + ' ms';
      if (msg.cancelled) status += ' · ' + T.cancelled;
      if (msg.timedOut) status += ' · ' + T.timedOut;
      if (msg.truncated) status += ' · ' + T.truncated;
      setStatus(status, 'ok');
    } else if (msg.type === 'history') {
      S.history = Array.isArray(msg.entries) ? msg.entries : [];
      renderHistory();
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

  updateChrome();
  renderHistory();
  post('ready', {});
})();
</script>
</body>
</html>`;
}
