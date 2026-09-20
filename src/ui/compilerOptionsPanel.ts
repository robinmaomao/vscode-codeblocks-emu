/**
 * 编译选项设置 Webview —— 对应 compileroptionsdlg.cpp
 *
 * 以 Webview 展示编译器的 <Option> 列表（按 Category 分组），
 * 勾选后写回当前项目的编译选项。
 */
import * as vscode from 'vscode';
import { Compiler, CompilerOption } from '../compiler/compiler';
import { Project, BuildTarget } from '../model/types';

export class CompilerOptionsPanel {
  private static current: CompilerOptionsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(
    private compiler: Compiler,
    private project: Project,
    private target: BuildTarget | undefined,
    private extensionUri: vscode.Uri,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'codeblocks.compilerOptions',
      `编译选项: ${target ? target.title : project.title}`,
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

  public static show(compiler: Compiler, project: Project, target: BuildTarget | undefined, extensionUri: vscode.Uri): void {
    CompilerOptionsPanel.current?.dispose();
    CompilerOptionsPanel.current = new CompilerOptionsPanel(compiler, project, target, extensionUri);
  }

  private buildHtml(): string {
    // 按 Category 分组
    const grouped = new Map<string, CompilerOption[]>();
    for (const opt of this.compiler.options) {
      const cat = opt.category || 'General';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(opt);
    }

    // 当前已启用的选项（target 或 project）
    const active = this.target?.compilerOptions ?? this.project.compilerOptions;

    let groupsHtml = '';
    for (const [cat, opts] of grouped) {
      let itemsHtml = '';
      for (const opt of opts) {
        const checked = opt.option && active.includes(opt.option) ? 'checked' : '';
        const lib = opt.additionalLibs ? `<span class="lib">+${opt.additionalLibs}</span>` : '';
        itemsHtml += `
          <label class="opt ${checked ? 'on' : ''}">
            <input type="checkbox" value="${this.escapeAttr(opt.option)}" ${checked}>
            <span class="name">${this.escapeHtml(opt.name)}</span>
            <code class="flag">${this.escapeHtml(opt.option)}</code>
            ${lib}
          </label>`;
      }
      groupsHtml += `
        <details open>
          <summary>${this.escapeHtml(cat)} <span class="count">${opts.length}</span></summary>
          <div class="options">${itemsHtml}</div>
        </details>`;
    }

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
    details { margin-bottom: 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
    summary { cursor: pointer; padding: 8px; font-weight: 600; background: var(--vscode-sideBarSectionHeader-background); }
    .count { color: var(--vscode-descriptionForeground); font-weight: normal; margin-left: 6px; }
    .options { padding: 4px 12px; }
    .opt { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--vscode-widget-border); }
    .opt:last-child { border-bottom: none; }
    .opt.on .name { color: var(--vscode-textLink-foreground); }
    .name { flex: 1; }
    code.flag { color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; }
    .lib { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer; }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="apply">应用</button>
    <button id="reset">重置</button>
    <span id="status"></span>
  </div>
  <div id="groups">${groupsHtml}</div>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById('apply').addEventListener('click', () => {
      const checked = [...document.querySelectorAll('input[type=checkbox]:checked')].map(c => c.value);
      vscode.postMessage({ type: 'apply', options: checked });
    });
    document.getElementById('reset').addEventListener('click', () => {
      document.querySelectorAll('input[type=checkbox]').forEach(c => c.checked = false);
      document.getElementById('status').textContent = '已重置（点击应用生效）';
    });
    window.addEventListener('message', e => {
      if (e.data.type === 'applied') {
        document.getElementById('status').textContent = '已应用 ✓';
      }
    });
  </script>
</body>
</html>`;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  private escapeAttr(s: string): string {
    return this.escapeHtml(s).replace(/"/g, '&quot;');
  }

  private onMessage(msg: any): void {
    if (msg.type === 'apply') {
      const options: string[] = msg.options ?? [];
      if (this.target) {
        this.target.compilerOptions = options;
      } else {
        this.project.compilerOptions = options;
      }
      this.panel.webview.postMessage({ type: 'applied' });
      vscode.window.showInformationMessage(`已应用 ${options.length} 个编译选项`);
    }
  }

  private dispose(): void {
    CompilerOptionsPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()!.dispose();
    }
  }
}
