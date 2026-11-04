/**
 * 编译选项设置 Webview —— 对应 compileroptionsdlg.cpp
 *
 * 以 Webview 展示编译器的 <Option> 列表（按 Category 分组），
 * 勾选后写回当前项目的编译选项（由宿主写盘并返回刷新后的工程/目标，避免面板继续持有陈旧对象）。
 */
import * as vscode from 'vscode';
import { Compiler, CompilerOption } from '../compiler/compiler';
import { Project, BuildTarget } from '../model/types';
import * as i18n from '../i18n';

/** 面板标题（`编译选项: <目标名或工程名>`） */
function compilerOptionsTitle(name: string): string {
  return i18n.t('Compiler Options: {0}', name);
}

/** 应用回调的返回值：宿主重新解析后的工程/目标（面板据此重绑） */
export interface CompilerOptionsApplyResult {
  project: Project;
  target?: BuildTarget;
}

/** 应用编译选项：宿主负责写回 .cbp 并重新解析工程 */
export type CompilerOptionsApply = (options: string[]) => Promise<CompilerOptionsApplyResult | void>;

export class CompilerOptionsPanel {
  private static current: CompilerOptionsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  /** 应用串行化队列（写盘 + 重解析为异步；连点「应用」不得交叉写盘） */
  private applyQueue: Promise<void> = Promise.resolve();
  private disposables: vscode.Disposable[] = [];

  private constructor(
    private compiler: Compiler,
    private project: Project,
    private target: BuildTarget | undefined,
    private extensionUri: vscode.Uri,
    private onApply?: CompilerOptionsApply,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'codeblocks.compilerOptions',
      compilerOptionsTitle(target ? target.title : project.title),
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
    compiler: Compiler,
    project: Project,
    target: BuildTarget | undefined,
    extensionUri: vscode.Uri,
    onApply?: CompilerOptionsApply,
  ): void {
    CompilerOptionsPanel.current?.dispose();
    CompilerOptionsPanel.current = new CompilerOptionsPanel(compiler, project, target, extensionUri, onApply);
  }

  /** 界面语言切换后刷新已打开面板的标题（正文标签在下次打开时按新语言渲染） */
  public static refreshTitleIfOpen(): void {
    const p = CompilerOptionsPanel.current;
    if (!p) return;
    p.panel.title = compilerOptionsTitle(p.target ? p.target.title : p.project.title);
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
<html lang="${i18n.htmlLang()}">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <style>
    body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); }
    details { margin-bottom: 8px; border: 1px solid var(--vscode-widget-border); border-radius: 4px; }
    summary { cursor: pointer; padding: 8px; font-weight: 600; background: var(--vscode-sideBarSectionHeader-background); }
    .count { color: var(--vscode-descriptionForeground); font-weight: normal; margin-left: 6px; }
    .options { padding: 4px 12px; }
    .opt { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 0; border-bottom: 1px solid var(--vscode-widget-border); }
    .opt:last-child { border-bottom: none; }
    .opt.on .name { color: var(--vscode-textLink-foreground); }
    .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
    code.flag { color: var(--vscode-textPreformat-foreground); background: var(--vscode-textCodeBlock-background); padding: 1px 5px; border-radius: 3px; white-space: nowrap; }
    .lib { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    .toolbar { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; align-items: center; }
    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 12px; border-radius: 2px; cursor: pointer; white-space: nowrap; }
    button:hover { background: var(--vscode-button-hoverBackground); }
    #status { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--vscode-descriptionForeground); }
  </style>
</head>
<body>
  <div class="toolbar">
    <button id="apply">${i18n.tr('应用')}</button>
    <button id="reset">${i18n.tr('重置')}</button>
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
      document.getElementById('status').textContent = '${i18n.tr('已重置（点击应用生效）')}';
    });
    window.addEventListener('message', e => {
      if (e.data.type === 'applied') {
        document.getElementById('status').textContent = '${i18n.tr('已应用 ✔️')}';
      } else if (e.data.type === 'error') {
        document.getElementById('status').textContent = '${i18n.tr('应用失败:')}' + ' ' + e.data.message;
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

  private async onMessage(msg: any): Promise<void> {
    if (msg?.type !== 'apply') return;
    // 串行化：应用含写盘 + 工程重解析（异步），连点「应用」时按到达顺序生效，避免交叉写盘
    this.applyQueue = this.applyQueue.then(() => this.applyOptions(msg)).catch(() => undefined);
  }

  private async applyOptions(msg: any): Promise<void> {
    const checked: string[] = Array.isArray(msg.options) ? msg.options.map((x: any) => String(x)) : [];
    // 只管理 options_<id>.xml 里的选项：手写在工程属性页的自定义选项原样保留，避免被本面板静默清除
    const managed = new Set(this.compiler.options.map((o) => o.option).filter(Boolean));
    const current = this.target?.compilerOptions ?? this.project.compilerOptions;
    const options = [...current.filter((o) => !managed.has(o)), ...checked];
    if (!this.onApply) {
      // 无宿主回调（直接构造/测试）：仅更新内存模型
      if (this.target) this.target.compilerOptions = options;
      else this.project.compilerOptions = options;
      this.panel.webview.postMessage({ type: 'applied' });
      vscode.window.showInformationMessage(i18n.t('Applied {0} compiler option(s)', checked.length));
      return;
    }
    try {
      const fresh = await this.onApply(options);
      if (fresh && fresh.project) {
        // 宿主已写盘并重新解析：直接改用新对象（旧对象作废，避免用陈旧数据覆盖磁盘）
        this.project = fresh.project;
        this.target = fresh.target;
      } else if (this.target) {
        this.target.compilerOptions = options;
      } else {
        this.project.compilerOptions = options;
      }
    } catch (err) {
      // 写盘失败时不得改动内存模型（否则后续任何一次序列化都会把未落盘的选项写进去）
      this.panel.webview.postMessage({ type: 'error', message: (err as Error).message });
      return;
    }
    this.panel.webview.postMessage({ type: 'applied' });
    vscode.window.showInformationMessage(i18n.t('Applied {0} compiler option(s)', checked.length));
  }

  private dispose(): void {
    CompilerOptionsPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()!.dispose();
    }
  }
}
