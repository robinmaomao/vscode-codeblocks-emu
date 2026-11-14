/**
 * Set Programs' Arguments 对话框 —— 对应 Code::Blocks `SelectTargetDlg`（sdk/selecttargetdlg.cpp + select_target.xrc）。
 *
 * CB 通过 Project → Set programs' arguments… 打开它（`SelectTarget(-1, true)`，即使只有一个目标也弹窗），
 * 每个目标在此编辑：Program arguments / Host application / Run host in terminal，
 * 并可标记「This target provides the project's main executable」（`<Option default_target>`）。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import * as i18n from '../i18n';

export interface RunTargetEntry {
  title: string;
  executionParameters: string;
  hostApplication: string;
  runHostApplicationInTerminal: boolean;
}

export interface RunTargetsData {
  projectTitle: string;
  /** 工程公共顶层路径（host app 在工程内时转相对路径，对齐 OnHostApplicationButtonClick） */
  commonTopLevelPath: string;
  targets: RunTargetEntry[];
  defaultExecuteTarget: string;
  /** 当前活动构建目标（初始选中） */
  activeTarget?: string;
}

export type RunTargetsApply = (data: RunTargetsData) => Promise<void>;

function labels(): Record<string, string> {
  return {
    target: i18n.t('Target:'),
    setAsDefault: i18n.t("This target provides the project's main executable"),
    programArguments: i18n.t('Program arguments:'),
    hostApplication: i18n.t('Host application:'),
    browse: i18n.t('Browse…'),
    runHostInTerminal: i18n.t('Run host in terminal'),
    ok: i18n.t('OK'),
    cancel: i18n.t('Cancel'),
    noTargets: i18n.t('The project has no build targets'),
    saved: i18n.t('Program arguments saved'),
  };
}

export function runTargetsPage(data: RunTargetsData): string {
  const L = labels();
  const payload = JSON.stringify({ data, labels: L }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="${i18n.htmlLang()}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    html, body { height: 100%; margin: 0; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 16px 18px;
      box-sizing: border-box;
      display: flex; flex-direction: column; gap: 10px; overflow: auto;
    }
    .rt-list {
      height: 190px; min-height: 120px; overflow: auto; padding: 2px;
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,.35)));
      border-radius: 3px;
    }
    .rt-list .row { padding: 4px 8px; border-radius: 2px; cursor: default; }
    .rt-list .row:hover { background: var(--vscode-list-hoverBackground); }
    .rt-list .row.selected { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
    .rt-field { display: flex; flex-direction: column; gap: 4px; }
    .rt-field > label { color: var(--vscode-foreground); }
    textarea, input[type=text] {
      font-family: var(--vscode-editor-font-family, var(--vscode-font-family));
      font-size: var(--vscode-font-size, 13px);
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, rgba(128,128,128,.35)));
      border-radius: 3px; padding: 4px 6px; box-sizing: border-box; width: 100%;
    }
    textarea { min-height: 84px; resize: vertical; }
    textarea:focus, input[type=text]:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px; }
    .rt-row { display: flex; gap: 6px; align-items: center; }
    .rt-row input[type=text] { flex: 1; min-width: 0; }
    .rt-check { display: flex; align-items: center; gap: 8px; }
    .rt-check input { width: 16px; height: 16px; accent-color: var(--vscode-checkbox-background, var(--vscode-focusBorder)); }
    .rt-sep { border-top: 1px solid var(--vscode-widget-border, rgba(128,128,128,.35)); margin: 4px 0; }
    .rt-actions { display: flex; justify-content: flex-end; gap: 8px; }
    button {
      font-family: inherit; font-size: 13px; padding: 4px 14px; border-radius: 3px; cursor: pointer;
      color: var(--vscode-button-secondaryForeground, var(--vscode-foreground));
      background: var(--vscode-button-secondaryBackground, rgba(128,128,128,.2));
      border: 1px solid var(--vscode-button-border, var(--vscode-widget-border, transparent));
    }
    button:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(128,128,128,.3)); }
    button.default {
      color: var(--vscode-button-foreground); background: var(--vscode-button-background);
      border: 1px solid var(--vscode-button-border, transparent);
    }
    button.default:hover { background: var(--vscode-button-hoverBackground); }
    .empty { padding: 8px; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="rt-field">
    <label>${L.target}</label>
    <div class="rt-list" id="rt-list"></div>
  </div>
  <label class="rt-check"><input type="checkbox" id="rt-default"><span>${L.setAsDefault}</span></label>
  <div class="rt-field">
    <label for="rt-params">${L.programArguments}</label>
    <textarea id="rt-params" spellcheck="false"></textarea>
  </div>
  <div class="rt-field">
    <label for="rt-host">${L.hostApplication}</label>
    <div class="rt-row">
      <input type="text" id="rt-host" spellcheck="false">
      <button id="rt-browse">${L.browse}</button>
    </div>
  </div>
  <label class="rt-check"><input type="checkbox" id="rt-terminal"><span>${L.runHostInTerminal}</span></label>
  <div class="rt-sep"></div>
  <div class="rt-actions">
    <button id="rt-cancel">${L.cancel}</button>
    <button id="rt-ok" class="default">${L.ok}</button>
  </div>
  <script>
  (function () {
    var BOOT = ${payload};
    var L = BOOT.labels;
    var DATA = BOOT.data;
    var selected = -1;
    var last = -1;
    function q(id) { return document.getElementById(id); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function post(msg) { if (window.__cbVscode) window.__cbVscode.postMessage(msg); }
    function stash() {
      if (last < 0 || !DATA.targets[last]) return;
      var t = DATA.targets[last];
      t.executionParameters = q('rt-params').value;
      t.hostApplication = q('rt-host').value;
      t.runHostApplicationInTerminal = q('rt-terminal').checked;
      if (q('rt-default').checked) {
        DATA.defaultExecuteTarget = t.title;
      } else if (DATA.defaultExecuteTarget === t.title) {
        DATA.defaultExecuteTarget = '';
      }
    }
    function renderList() {
      var el = q('rt-list');
      if (!DATA.targets.length) { el.innerHTML = '<div class="empty">' + esc(L.noTargets) + '</div>'; return; }
      el.innerHTML = DATA.targets.map(function (t, i) {
        return '<div class="row' + (i === selected ? ' selected' : '') + '" data-i="' + i + '">' + esc(t.title) + '</div>';
      }).join('');
      Array.prototype.forEach.call(el.querySelectorAll('.row'), function (r) {
        r.addEventListener('click', function () { select(Number(r.getAttribute('data-i'))); });
        r.addEventListener('dblclick', function () { select(Number(r.getAttribute('data-i'))); submit(); });
      });
    }
    function select(i) {
      stash();
      selected = i;
      last = i;
      var t = DATA.targets[i];
      q('rt-params').value = t ? (t.executionParameters || '') : '';
      q('rt-host').value = t ? (t.hostApplication || '') : '';
      q('rt-terminal').checked = !!(t && t.runHostApplicationInTerminal);
      q('rt-default').checked = !!(t && DATA.defaultExecuteTarget === t.title);
      renderList();
    }
    function submit() {
      stash();
      post({ type: 'save', data: DATA });
    }
    q('rt-ok').addEventListener('click', submit);
    q('rt-cancel').addEventListener('click', function () { post({ type: 'cancel' }); });
    q('rt-browse').addEventListener('click', function () { post({ type: 'browse', value: q('rt-host').value || '' }); });
    q('rt-params').addEventListener('change', stash);
    q('rt-host').addEventListener('change', stash);
    q('rt-terminal').addEventListener('change', stash);
    q('rt-default').addEventListener('change', stash);
    window.addEventListener('message', function (e) {
      var msg = e.data || {};
      if (msg.type === 'browsed' && typeof msg.value === 'string') {
        q('rt-host').value = msg.value;
        stash();
      }
    });
    var initial = -1;
    if (DATA.activeTarget) {
      DATA.targets.forEach(function (t, i) { if (initial < 0 && t.title === DATA.activeTarget) initial = i; });
    }
    if (initial < 0 && DATA.defaultExecuteTarget) {
      DATA.targets.forEach(function (t, i) { if (initial < 0 && t.title === DATA.defaultExecuteTarget) initial = i; });
    }
    if (DATA.targets.length) select(initial < 0 ? 0 : initial); else renderList();
  })();
  </script>
</body>
</html>`;
}

export class RunTargetsPanel {
  private static current: RunTargetsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly data: RunTargetsData;

  private constructor(
    data: RunTargetsData,
    private readonly onApply: RunTargetsApply,
  ) {
    this.data = JSON.parse(JSON.stringify(data));
    this.panel = vscode.window.createWebviewPanel(
      'codeblocks.runTargets',
      i18n.t('Select target'),
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = runTargetsPage(this.data);
    this.panel.webview.onDidReceiveMessage(this.onMessage, this, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static show(data: RunTargetsData, onApply: RunTargetsApply): void {
    RunTargetsPanel.current?.dispose();
    RunTargetsPanel.current = new RunTargetsPanel(data, onApply);
  }

  /** 界面语言变化时刷新标题 */
  public static refreshTitleIfOpen(): void {
    if (RunTargetsPanel.current) RunTargetsPanel.current.panel.title = i18n.t('Select target');
  }

  private async onMessage(msg: any): Promise<void> {
    if (msg?.type === 'cancel') {
      this.dispose();
      return;
    }
    if (msg?.type === 'browse') {
      const picked = await this.browseHostApplication(String(msg.value ?? ''));
      if (picked !== undefined) this.panel.webview.postMessage({ type: 'browsed', value: picked });
      return;
    }
    if (msg?.type !== 'save') return;
    try {
      await this.onApply(msg.data as RunTargetsData);
      vscode.window.setStatusBarMessage(i18n.t('Program arguments saved'), 3000);
      this.dispose();
    } catch (err) {
      vscode.window.showErrorMessage((err as Error).message);
    }
  }

  /** 文件选择：工程内路径转相对（对齐 OnHostApplicationButtonClick） */
  private async browseHostApplication(current: string): Promise<string | undefined> {
    const base = this.data.commonTopLevelPath || '';
    const defaultUri = current
      ? vscode.Uri.file(path.isAbsolute(current) ? current : path.join(base, current))
      : (base ? vscode.Uri.file(base) : undefined);
    const picked = await vscode.window.showOpenDialog({
      defaultUri,
      canSelectFiles: true,
      canSelectMany: false,
      openLabel: i18n.t('Select host application'),
      filters: process.platform === 'win32'
        ? { [i18n.t('Executable files')]: ['exe'], [i18n.t('All files')]: ['*'] }
        : { [i18n.t('All files')]: ['*'] },
    });
    if (!picked?.length) return undefined;
    const abs = picked[0].fsPath;
    if (base) {
      const rel = path.relative(base, abs);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return rel.replace(/\\/g, '/');
    }
    return abs.replace(/\\/g, '/');
  }

  private dispose(): void {
    RunTargetsPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()!.dispose();
  }
}
