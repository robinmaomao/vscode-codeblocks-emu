/**
 * 独立 Build options 面板 —— 对应 Code::Blocks `CompilerOptionsDlg`（工程/目标模式）。
 *
 * 视图与 CSS 在 buildOptionsView.ts 中与工程属性面板共用；
 * 本文件只负责 WebView 生命周期、保存回调与标题刷新。
 */
import * as vscode from 'vscode';
import { BuildOptionsData, buildOptionsPage } from './buildOptionsView';
import { applyFlagAction, buildCompilerCatalog, writeLanguageFlags } from '../compiler/compilerFlagSettings';
import * as i18n from '../i18n';

export interface BuildOptionsSaveResult {
  /** 宿主重新解析后的完整数据（面板据此刷新） */
  data?: BuildOptionsData;
}

export type BuildOptionsApply = (data: BuildOptionsData) => Promise<BuildOptionsSaveResult | void>;

function buildOptionsTitle(): string {
  return i18n.t('Project build options');
}

export class BuildOptionsPanel {
  private static current: BuildOptionsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];
  private applyQueue: Promise<void> = Promise.resolve();

  private constructor(
    private projectTitle: string,
    private readonly projectFilename: string,
    private data: BuildOptionsData,
    private readonly extensionUri: vscode.Uri,
    private readonly onApply?: BuildOptionsApply,
    private readonly initialScope?: string,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'codeblocks.buildOptions',
      buildOptionsTitle(),
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = buildOptionsPage(data, initialScope);
    this.panel.webview.onDidReceiveMessage(this.onMessage, this, this.disposables);
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  public static show(
    projectTitle: string,
    projectFilename: string,
    data: BuildOptionsData,
    extensionUri: vscode.Uri,
    onApply?: BuildOptionsApply,
    initialScope?: string,
  ): void {
    BuildOptionsPanel.current?.dispose();
    BuildOptionsPanel.current = new BuildOptionsPanel(projectTitle, projectFilename, data, extensionUri, onApply, initialScope);
  }

  /** 界面语言切换后刷新标题 */
  public static refreshTitleIfOpen(): void {
    const p = BuildOptionsPanel.current;
    if (p) p.panel.title = buildOptionsTitle();
  }

  /** 工程从磁盘重载时关闭（面板持有旧模型，避免覆盖） */
  public static closeFor(project: { filename: string }): void {
    const p = BuildOptionsPanel.current;
    if (p && p.projectFilename.toLowerCase() === project.filename.toLowerCase()) p.dispose();
  }

  private async onMessage(msg: any): Promise<void> {
    if (
      msg?.type === 'flagAdd' ||
      msg?.type === 'flagUpdate' ||
      msg?.type === 'flagDelete' ||
      msg?.type === 'languageFlags'
    ) {
      await this.applyCompilerFlags(msg);
      return;
    }
    if (msg?.type !== 'save') return;
    this.applyQueue = this.applyQueue.then(() => this.apply(msg)).catch(() => undefined);
  }

  /** 右键参数编辑 / 仅 C·C++ 参数：写入设置后回传新的目录与语言参数 */
  private async applyCompilerFlags(msg: any): Promise<void> {
    const compilerId = String(msg?.compilerId ?? '');
    if (!compilerId) return;
    const base = this.data.compilerBaseCatalogs?.[compilerId] ?? [];
    let error: string | undefined;
    if (msg.type === 'languageFlags') {
      const cOnly = Array.isArray(msg.cOnly) ? msg.cOnly.map((x: any) => String(x)) : [];
      const cppOnly = Array.isArray(msg.cppOnly) ? msg.cppOnly.map((x: any) => String(x)) : [];
      error = await writeLanguageFlags(compilerId, cOnly, cppOnly);
      if (!error) {
        this.data.compilerFlags = this.data.compilerFlags ?? {};
        this.data.compilerFlags[compilerId] = { cOnly, cppOnly };
      }
    } else {
      error = await applyFlagAction(
        { type: msg.type, compilerId, flag: msg.flag, original: msg.original },
        base,
      );
      this.data.compilerCatalogs[compilerId] = buildCompilerCatalog(compilerId, base);
    }
    const flags = this.data.compilerFlags?.[compilerId] ?? { cOnly: [], cppOnly: [] };
    this.panel.webview.postMessage({
      type: 'compilerFlags',
      compilerId,
      catalog: this.data.compilerCatalogs[compilerId] ?? base,
      cOnly: flags.cOnly,
      cppOnly: flags.cppOnly,
      error,
    });
  }

  private async apply(msg: any): Promise<void> {
    const data = msg?.data as BuildOptionsData | undefined;
    if (!data?.project || !Array.isArray(data.targets)) return;
    try {
      if (this.onApply) {
        await this.onApply(data);
      }
      this.data = data;
      this.panel.webview.postMessage({ type: 'saved' });
      vscode.window.showInformationMessage(i18n.t('Build options saved'));
      if (msg?.close) this.dispose();
    } catch (err) {
      this.panel.webview.postMessage({ type: 'error', message: (err as Error).message });
    }
  }

  private dispose(): void {
    BuildOptionsPanel.current = undefined;
    this.panel.dispose();
    while (this.disposables.length) this.disposables.pop()!.dispose();
  }
}
