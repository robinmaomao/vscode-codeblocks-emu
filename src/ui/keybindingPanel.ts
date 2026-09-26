/**
 * 快捷键设置面板 —— 可视化配置每个快捷键（第 47 轮，方案 A）
 *
 * 数据源：设置 `codeblocks.keybindings.overrides`（唯一数据源）；
 * 面板操作（录入/手动/解绑/默认）→ 写设置 → 立即应用（复用 keybindingConfig 的托管写入）。
 * 宿主（extension.ts）通过 KeybindingPanelHost 注入数据与动作，面板只负责渲染与消息转递。
 */
import * as vscode from 'vscode';
import { KeybindingRow } from '../tools/keybindingConfig';

/** 面板数据（宿主构建；含行模型 / 文件路径 / cbStyle 状态 / 设置告警） */
export interface KeybindingPanelState {
  rows: KeybindingRow[];
  path: string;
  cbStyle: boolean;
  notices: string[];
}

/** 宿主动作（全部由 extension.ts 注入，复用既有托管写入实现） */
export interface KeybindingPanelHost {
  getState(): KeybindingPanelState;
  validate(chord: string): { ok: boolean; error?: string };
  setOverride(id: string, key: string): Promise<{ ok: boolean; message?: string }>;
  clearOverride(id: string): Promise<{ ok: boolean; message?: string }>;
  resetAll(): Promise<{ ok: boolean; message?: string }>;
  apply(): Promise<{ ok: boolean; message?: string }>;
  check(): void;
  openFile(): void;
  exportScheme(): void;
  importScheme(): void;
}

export class KeybindingPanel {
  private static current: KeybindingPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    private extensionUri: vscode.Uri,
    private host: KeybindingPanelHost,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'codeblocks.keybindings',
      'Code::Blocks 快捷键设置',
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.buildHtml();
    this.panel.webview.onDidReceiveMessage((m) => void this.onMessage(m), this, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /** 打开或聚焦面板（单例；重复打开时刷新数据） */
  public static show(extensionUri: vscode.Uri, host: KeybindingPanelHost): KeybindingPanel {
    if (KeybindingPanel.current) {
      KeybindingPanel.current.host = host;
      KeybindingPanel.current.panel.reveal();
      KeybindingPanel.current.refresh();
      return KeybindingPanel.current;
    }
    KeybindingPanel.current = new KeybindingPanel(extensionUri, host);
    return KeybindingPanel.current;
  }

  /** 外部数据变化（设置变更/应用结果）后刷新面板 */
  public refresh(): void {
    this.post({ type: 'state', state: this.host.getState() });
  }

  /** 面板已打开时刷新（设置变更/导入等外部途径触发） */
  public static refreshIfOpen(): void {
    KeybindingPanel.current?.refresh();
  }

  private post(msg: unknown): void {
    void this.panel.webview.postMessage(msg);
  }

  private async onMessage(msg: any): Promise<void> {
    try {
      const t = msg?.type;
      if (t === 'ready') { this.refresh(); return; }
      if (t === 'set' && typeof msg.id === 'string') {
        const r = await this.host.setOverride(msg.id, String(msg.key ?? ''));
        this.post({ type: r.ok ? 'status' : 'error', message: r.message });
        this.refresh();
        return;
      }
      if (t === 'clear' && typeof msg.id === 'string') {
        const r = await this.host.clearOverride(msg.id);
        this.post({ type: r.ok ? 'status' : 'error', message: r.message });
        this.refresh();
        return;
      }
      if (t === 'resetAll') {
        const r = await this.host.resetAll();
        this.post({ type: r.ok ? 'status' : 'error', message: r.message });
        this.refresh();
        return;
      }
      if (t === 'apply') {
        const r = await this.host.apply();
        this.post({ type: r.ok ? 'status' : 'error', message: r.message });
        this.refresh();
        return;
      }
      if (t === 'check') { this.host.check(); return; }
      if (t === 'openFile') { this.host.openFile(); return; }
      if (t === 'export') { this.host.exportScheme(); return; }
      if (t === 'import') { this.host.importScheme(); return; }
      if (t === 'validate' && typeof msg.id === 'string') {
        const r = this.host.validate(String(msg.key ?? ''));
        this.post({ type: 'validated', id: msg.id, ...r });
      }
    } catch (err) {
      this.post({ type: 'error', message: (err as Error).message });
    }
  }

  private dispose(): void {
    KeybindingPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()?.dispose();
  }

  private buildHtml(): string {
    const data = JSON.stringify({
      rows: [],
      path: '',
      cbStyle: false,
      notices: [],
    } as KeybindingPanelState);

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 14px 14px; }
  h2 { margin: 12px 0 6px; }
  .top { position: sticky; top: 0; background: var(--vscode-editor-background); padding: 10px 0; border-bottom: 1px solid var(--vscode-panel-border); z-index: 2; }
  .top .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  input[type="search"], #manualInput { background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 4px 8px; border-radius: 2px; min-width: 220px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 10px; border-radius: 2px; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground, transparent); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); border: 1px solid var(--vscode-panel-border); }
  button:hover { opacity: .9; }
  #bar { display: none; margin: 8px 0; padding: 8px 10px; border: 1px solid var(--vscode-focusBorder); border-radius: 3px; background: var(--vscode-editorWidget-background); }
  .grp { margin-top: 10px; }
  .grp summary { cursor: pointer; font-weight: 600; padding: 4px 0; }
  table.tb { width: 100%; border-collapse: collapse; }
  .tb th, .tb td { text-align: left; padding: 5px 8px; border-bottom: 1px solid var(--vscode-panel-border); vertical-align: top; }
  .tb th { font-weight: 600; opacity: .8; }
  .name { font-weight: 600; }
  .cmd { opacity: .65; font-size: 11px; }
  .def { opacity: .65; font-size: 11px; }
  .note { color: var(--vscode-editorWarning-foreground, #d18616); font-size: 11px; margin-top: 2px; }
  .tag { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 8px; border: 1px solid var(--vscode-panel-border); margin-right: 4px; }
  .tag.dim { opacity: .7; }
  .tag.ok { color: var(--vscode-testing-iconPassed, #3fb950); border-color: currentColor; }
  .tag.warn { color: var(--vscode-editorWarning-foreground, #d18616); border-color: currentColor; }
  .tag.cust { color: var(--vscode-textLink-foreground, #3794ff); border-color: currentColor; }
  .ops button { margin-right: 4px; }
  code { background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }
  .hint { opacity: .65; font-size: 11px; margin-top: 4px; }
  #notices .notice { color: var(--vscode-editorWarning-foreground, #d18616); font-size: 12px; }
  .footer { margin-top: 12px; opacity: .7; font-size: 11px; }
  .status { margin-top: 6px; min-height: 16px; color: var(--vscode-textLink-foreground, #3794ff); font-size: 12px; }
</style>
</head>
<body>
<h2>Code::Blocks 快捷键设置</h2>
<div class="top">
  <div class="row">
    <input type="search" id="search" placeholder="搜索命令 / id / 命令 ID…">
    <button id="btnApply" class="secondary">应用</button>
    <button id="btnReset" class="secondary">全部重置</button>
    <button id="btnCheck" class="secondary">检查冲突</button>
    <button id="btnOpen" class="secondary">打开 keybindings.json</button>
    <button id="btnExport" class="secondary">导出方案</button>
    <button id="btnImport" class="secondary">导入方案</button>
  </div>
  <div id="bar"></div>
  <div id="notices"></div>
  <div class="status" id="status"></div>
</div>
<div id="list"></div>
<div class="footer" id="footer"></div>

<script>
  'use strict';
  var vscode = acquireVsCodeApi();
  var state = ${data};
  var filter = '';
  var pending = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var GROUP_TITLES = {
    builtin: '构建 / 运行 / 工程（默认启用）',
    alias: '外部命令别名',
    cbStyle: 'Code::Blocks 保真键位（受 cbStyle 批量开关控制）'
  };

  function statusTag(r) {
    if (r.status === 'default') return '<span class="tag dim">默认</span>';
    if (r.status === 'unbound') return '<span class="tag warn">已解绑</span>';
    return '<span class="tag cust">自定义</span>';
  }
  function rowHtml(r) {
    var okBadge = r.ok ? '<span class="tag ok">已生效</span>' : '<span class="tag warn">未写入</span>';
    var note = r.note ? '<div class="note">⚠ ' + esc(r.note) + '</div>' : '';
    var defShow = r.status === 'default' ? '' : '<div class="def">默认: ' + esc(r.defaultsLabel) + '</div>';
    return '<tr data-id="' + esc(r.id) + '">'
      + '<td><div class="name">' + esc(r.label) + '</div>'
      + '<div class="cmd">' + esc(r.id) + ' · ' + esc(r.command) + (r.when ? ' · when: ' + esc(r.when) : '') + '</div>'
      + defShow + note + '</td>'
      + '<td><code>' + esc(r.effective) + '</code></td>'
      + '<td>' + statusTag(r) + '<br>' + okBadge + '</td>'
      + '<td class="ops">'
      + '<button data-op="capture">录入</button>'
      + '<button data-op="manual" class="secondary">手动</button>'
      + '<button data-op="unbind" class="secondary">解绑</button>'
      + '<button data-op="clear" class="secondary">默认</button>'
      + '</td></tr>';
  }
  function render() {
    var notices = document.getElementById('notices');
    notices.innerHTML = (state.notices && state.notices.length)
      ? state.notices.map(function (n) { return '<div class="notice">⚠ ' + esc(n) + '</div>'; }).join('')
      : '';
    var html = '';
    ['builtin', 'alias', 'cbStyle'].forEach(function (g) {
      var rows = state.rows.filter(function (r) { return r.group === g; });
      if (filter) {
        rows = rows.filter(function (r) {
          return (r.label + ' ' + r.id + ' ' + r.command).toLowerCase().indexOf(filter) >= 0;
        });
      }
      html += '<details open class="grp"><summary>' + esc(GROUP_TITLES[g]) + '（' + rows.length + '）</summary>';
      if (!rows.length) {
        html += '<div class="hint">无匹配项</div></details>';
        return;
      }
      html += '<table class="tb"><thead><tr><th>命令</th><th>当前键位</th><th>状态</th><th>操作</th></tr></thead><tbody>';
      rows.forEach(function (r) { html += rowHtml(r); });
      html += '</tbody></table></details>';
    });
    document.getElementById('list').innerHTML = html;
    document.getElementById('footer').textContent = 'keybindings.json: ' + (state.path || '(未定位)')
      + ' · cbStyle: ' + (state.cbStyle ? '已启用' : '未启用')
      + ' · 修改立即写入设置并应用；「全部重置」清除全部自定义';
    bind();
  }
  function bind() {
    var buttons = document.querySelectorAll('button[data-op]');
    for (var i = 0; i < buttons.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var tr = btn.closest('tr');
          var id = tr ? tr.getAttribute('data-id') : '';
          var row = null;
          for (var j = 0; j < state.rows.length; j++) if (state.rows[j].id === id) row = state.rows[j];
          if (!row) return;
          var op = btn.getAttribute('data-op');
          if (op === 'capture') startCapture(row);
          else if (op === 'manual') startManual(row);
          else if (op === 'unbind') vscode.postMessage({ type: 'set', id: id, key: '' });
          else if (op === 'clear') vscode.postMessage({ type: 'clear', id: id });
        });
      })(buttons[i]);
    }
  }
  function showBar(html) {
    var bar = document.getElementById('bar');
    bar.innerHTML = html;
    bar.style.display = 'block';
  }
  function hideBar() {
    pending = null;
    var bar = document.getElementById('bar');
    bar.style.display = 'none';
    bar.innerHTML = '';
  }
  function startCapture(row) {
    pending = row;
    showBar('<b>录入键位</b> — ' + esc(row.label)
      + '：请按下组合键（Esc 取消 · Backspace = 解绑 · 仅按修饰键无效）'
      + '<div class="hint">被 VS Code / 系统优先占用的组合（如 Ctrl+W、Ctrl+Tab）可能无法捕获，请改用「手动」输入</div>');
  }
  function startManual(row) {
    pending = row;
    showBar('<b>手动输入</b> — ' + esc(row.label)
      + '：<input id="manualInput" placeholder="如 ctrl+alt+b / f7 / ctrl+k ctrl+c（空 = 解绑）">'
      + '<button id="manualOk">确定</button> <button id="manualCancel" class="secondary">取消</button>');
    var input = document.getElementById('manualInput');
    input.value = row.status === 'custom' ? row.effective : '';
    input.focus();
    document.getElementById('manualOk').addEventListener('click', function () {
      if (!pending) return;
      vscode.postMessage({ type: 'set', id: pending.id, key: input.value.trim().toLowerCase() });
      hideBar();
    });
    document.getElementById('manualCancel').addEventListener('click', hideBar);
  }
  function keyName(e) {
    var k = e.key;
    if (/^F([0-9]|1[0-9]|2[0-4])$/.test(k)) return k.toLowerCase();
    var map = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      PageUp: 'pageup', PageDown: 'pagedown', Home: 'home', End: 'end',
      Enter: 'enter', ' ': 'space', Backspace: 'backspace', Delete: 'delete', Insert: 'insert', Tab: 'tab',
      '+': '+', '-': '-', '=': '=', ',': ',', '.': '.', '/': '/', ';': ';', '[': '[', ']': ']'
    };
    if (map[k]) return map[k];
    if (/^[a-zA-Z]$/.test(k) || /^[0-9]$/.test(k)) return k.toLowerCase();
    return null;
  }
  function chordFromEvent(e) {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null;
    var key = keyName(e);
    if (!key) return null;
    var parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    if (e.metaKey) parts.push('meta');
    parts.push(key);
    return parts.join('+');
  }
  document.addEventListener('keydown', function (e) {
    if (e.target && e.target.id === 'manualInput') {
      if (e.key === 'Enter') {
        var ok = document.getElementById('manualOk');
        if (ok) ok.click();
      }
      return;
    }
    if (!pending) return;
    if (e.key === 'Escape') { e.preventDefault(); hideBar(); return; }
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      vscode.postMessage({ type: 'set', id: pending.id, key: '' });
      hideBar();
      return;
    }
    var chord = chordFromEvent(e);
    if (!chord) return;
    e.preventDefault();
    e.stopPropagation();
    vscode.postMessage({ type: 'set', id: pending.id, key: chord });
    hideBar();
  });
  document.getElementById('search').addEventListener('input', function (e) {
    filter = String(e.target.value || '').trim().toLowerCase();
    render();
  });
  document.getElementById('btnApply').addEventListener('click', function () { vscode.postMessage({ type: 'apply' }); });
  document.getElementById('btnReset').addEventListener('click', function () { vscode.postMessage({ type: 'resetAll' }); });
  document.getElementById('btnCheck').addEventListener('click', function () { vscode.postMessage({ type: 'check' }); });
  document.getElementById('btnOpen').addEventListener('click', function () { vscode.postMessage({ type: 'openFile' }); });
  document.getElementById('btnExport').addEventListener('click', function () { vscode.postMessage({ type: 'export' }); });
  document.getElementById('btnImport').addEventListener('click', function () { vscode.postMessage({ type: 'import' }); });
  window.addEventListener('message', function (e) {
    var m = e.data;
    if (!m) return;
    if (m.type === 'state') { state = m.state; render(); }
    else if (m.type === 'status') { document.getElementById('status').textContent = m.message || ''; }
    else if (m.type === 'error') { document.getElementById('status').textContent = '错误: ' + (m.message || ''); }
  });
  render();
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
  }
}
