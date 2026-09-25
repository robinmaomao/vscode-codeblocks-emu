/**
 * 构建日志树视图 —— 结构化构建摘要（对应 Code::Blocks 的 Build log 面板）
 *
 * 每次构建生成一棵摘要树：根 = 构建结果，项目分支下挂
 * 编译器 / 编译统计 / 链接结果 / 诊断（可点击跳转）/ 失败命令。
 * 原始编译输出仍保留在 OutputChannel「Code::Blocks」中用于排障。
 */
import * as vscode from 'vscode';
import * as path from 'path';

/** 诊断严重程度（仅收集 error/warning，info 噪音大不展示） */
export type BuildLogSeverity = 'error' | 'warning';

/** 单条诊断（对应 OutputParser 解析结果，file 已解析为绝对路径） */
export interface BuildLogDiagnostic {
  severity: BuildLogSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/** 单个项目的构建摘要 */
export interface BuildLogProject {
  projectName: string;      // 显示名（.cbp 所在目录名）
  targetName: string;
  compilerPath: string;
  success: boolean;
  compiledCount: number;    // 本次实际编译的文件数
  skippedCount: number;     // 增量跳过数
  failedCount: number;      // 编译失败数
  linkSuccess: boolean;
  linkSkipped: boolean;     // static lib 无链接步骤
  outputFilename?: string;
  diagnostics: BuildLogDiagnostic[];
  /** 项目源文件绝对路径（供「Build Log 使用 clangd 诊断」模式收集诊断） */
  files?: string[];
  durationMs: number;
  /** 构建开始时间戳（毫秒） */
  startTime?: number;
}

/** 一次构建的整体摘要 */
export interface BuildLogSummary {
  success: boolean;
  durationMs: number;
  /** 构建开始时间戳（毫秒） */
  startTime?: number;
  projects: BuildLogProject[];
  errorCount: number;
  warningCount: number;
  /** 是否因达到 maxReportedErrors 上限而被截断 */
  truncated?: boolean;
}

type BuildLogKind = 'root' | 'project' | 'info' | 'group' | 'diagnostic';

class BuildLogNode extends vscode.TreeItem {
  /** 子节点（覆盖默认，允许后续赋值） */
  declare children: BuildLogNode[];
  /** 诊断数据（diagnostic 节点，供右键复制） */
  diag?: BuildLogDiagnostic;
  /** 项目节点的错误诊断数（errorsOnly 过滤用） */
  errorCount = 0;

  constructor(
    public readonly kind: BuildLogKind,
    label: string,
    collapsible: vscode.TreeItemCollapsibleState,
    icon?: string | vscode.ThemeIcon | vscode.Uri,
  ) {
    super(label, collapsible);
    if (icon) this.iconPath = typeof icon === 'string' ? new vscode.ThemeIcon(icon) : icon;
    this.children = [];
  }
}

export class BuildLogTreeProvider implements vscode.TreeDataProvider<BuildLogNode> {
  private _onDidChangeTreeData = new vscode.EventEmitter<BuildLogNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private summary: BuildLogSummary | undefined;
  /** 只看错误过滤（C2） */
  private errorsOnly = false;

  /** 切换「只看错误」过滤并刷新视图 */
  setErrorsOnly(v: boolean): void {
    this.errorsOnly = v;
    this._onDidChangeTreeData.fire(undefined);
  }

  getErrorsOnly(): boolean { return this.errorsOnly; }
  /** 资源根目录（用于加载彩色图标） */
  private resourcesDir?: vscode.Uri;
  /** 彩色图标缓存：key = icons/ 下文件名，value = URI */
  private iconCache = new Map<string, vscode.Uri>();

  /** 设置资源根目录（用于加载彩色树节点图标） */
  setResourcesDir(dir: string): void {
    this.resourcesDir = vscode.Uri.file(dir);
  }

  /** 取彩色图标 URI（缓存；未设置资源目录则回退 ThemeIcon） */
  private icon(name: string, fallback: string): string | vscode.ThemeIcon | vscode.Uri {
    if (!this.resourcesDir) return new vscode.ThemeIcon(fallback);
    let uri = this.iconCache.get(name);
    if (!uri) {
      uri = vscode.Uri.joinPath(this.resourcesDir, 'icons', name);
      this.iconCache.set(name, uri);
    }
    return uri;
  }
  /** 扁平化的错误列表（只含 error，供 next/prev 导航） */
  private errorList: BuildLogDiagnostic[] = [];
  /** 当前错误索引（-1 = 未定位） */
  private currentErrorIndex = -1;

  setSummary(summary: BuildLogSummary | undefined): void {
    this.summary = summary;
    this.errorList = [];
    this.currentErrorIndex = -1;
    if (summary) {
      for (const p of summary.projects) {
        for (const d of p.diagnostics) {
          if (d.severity === 'error' && d.file) {
            this.errorList.push(d);
          }
        }
      }
    }
    this._onDidChangeTreeData.fire(undefined);
  }

  /** 是否有可导航的错误 */
  hasErrors(): boolean {
    return this.errorList.length > 0;
  }

  /** 跳转到下一个错误（循环），返回是否成功 */
  gotoNextError(): boolean {
    if (this.errorList.length === 0) return false;
    this.currentErrorIndex = (this.currentErrorIndex + 1) % this.errorList.length;
    return this.gotoError(this.errorList[this.currentErrorIndex]);
  }

  /** 跳转到上一个错误（循环），返回是否成功 */
  gotoPreviousError(): boolean {
    if (this.errorList.length === 0) return false;
    this.currentErrorIndex = this.currentErrorIndex <= 0
      ? this.errorList.length - 1
      : this.currentErrorIndex - 1;
    return this.gotoError(this.errorList[this.currentErrorIndex]);
  }

  /** 打开错误所在文件并定位 */
  private gotoError(d: BuildLogDiagnostic): boolean {
    if (!d.file) return false;
    const line0 = d.line && d.line > 0 ? d.line - 1 : 0;
    const col0 = d.column && d.column > 0 ? d.column - 1 : 0;
    const range = new vscode.Range(line0, col0, line0, col0);
    vscode.commands.executeCommand('vscode.open', vscode.Uri.file(d.file), { selection: range, preview: true });
    return true;
  }

  getTreeItem(element: BuildLogNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: BuildLogNode): BuildLogNode[] {
    if (!this.summary) return [];
    if (!element) {
      const root = this.buildRootNode(this.summary);
      if (!this.errorsOnly) return [root];
      // 过滤模式下仅展示含错误的项目
      root.children = root.children.filter((p) => p.errorCount > 0);
      return root.children.length ? [root] : [root];
    }
    return element.children;
  }

  private buildRootNode(s: BuildLogSummary): BuildLogNode {
    const node = new BuildLogNode(
      'root',
      s.success ? '✅ 构建成功' : '❌ 构建失败',
      vscode.TreeItemCollapsibleState.Expanded,
      s.success ? this.icon('log-success.svg', 'check') : this.icon('log-error.svg', 'error'),
    );
    const start = s.startTime !== undefined ? `开始 ${formatTime(s.startTime)} · ` : '';
    node.description = `${start}用时 ${(s.durationMs / 1000).toFixed(1)}s · ${s.errorCount} 错误 · ${s.warningCount} 警告${s.truncated ? '（已截断）' : ''}`;
    node.tooltip = node.description;
    node.children = s.projects.map((p) => this.buildProjectNode(p));
    return node;
  }

  private buildProjectNode(p: BuildLogProject): BuildLogNode {
    const node = new BuildLogNode(
      'project',
      p.projectName,
      vscode.TreeItemCollapsibleState.Expanded,
      p.success ? this.icon('log-project.svg', 'package') : this.icon('log-error.svg', 'error'),
    );
    const errCount = p.diagnostics.filter((d) => d.severity === 'error').length;
    const warnCount = p.diagnostics.filter((d) => d.severity === 'warning').length;
    node.errorCount = errCount;
    node.description = `${p.targetName} · ${p.success ? '成功' : '失败'} · ${(p.durationMs / 1000).toFixed(1)}s · ${errCount} 错误 · ${warnCount} 警告`;
    node.tooltip = `${p.projectName} · 目标 ${p.targetName}`;

    const children: BuildLogNode[] = [];

    // errorsOnly 过滤：仅保留错误分组（跳过编译器/统计/链接信息节点）
    if (this.errorsOnly) {
      const errors = p.diagnostics.filter((d) => d.severity === 'error');
      const errorGroup = new BuildLogNode(
        'group',
        `错误 (${errors.length})`,
        errors.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
        this.icon('log-error.svg', 'error'),
      );
      errorGroup.children = errors.map((d) => this.buildDiagnosticNode(d));
      children.push(errorGroup);
      node.children = children;
      return node;
    }

    // 编译器
    const compilerNode = new BuildLogNode('info', p.compilerPath, vscode.TreeItemCollapsibleState.None, this.icon('log-compiler.svg', 'tools'));
    children.push(compilerNode);

    // 编译统计
    const statsNode = new BuildLogNode(
      'info',
      `编译 ${p.compiledCount} · 跳过 ${p.skippedCount} · 失败 ${p.failedCount}`,
      vscode.TreeItemCollapsibleState.None,
      this.icon('log-stats.svg', 'file-code'),
    );
    children.push(statsNode);

    // 链接结果
    if (!p.linkSkipped) {
      const linkNode = new BuildLogNode(
        'info',
        p.linkSuccess ? '链接成功' : '链接失败',
        vscode.TreeItemCollapsibleState.None,
        p.linkSuccess ? this.icon('log-link.svg', 'link') : this.icon('log-error.svg', 'error'),
      );
      linkNode.description = p.outputFilename;
      children.push(linkNode);
    }

    // 诊断分组：错误 / 警告 各一个分组节点，数量写进 label，具体诊断挂下一层级
    const errors = p.diagnostics.filter((d) => d.severity === 'error');
    const warnings = p.diagnostics.filter((d) => d.severity === 'warning');

    const errorGroup = new BuildLogNode(
      'group',
      `错误 (${errors.length})`,
      errors.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
      this.icon('log-error.svg', 'error'),
    );
    errorGroup.children = errors.map((d) => this.buildDiagnosticNode(d));
    children.push(errorGroup);

    const warningGroup = new BuildLogNode(
      'group',
      `警告 (${warnings.length})`,
      warnings.length > 0 ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
      this.icon('log-warning.svg', 'warning'),
    );
    warningGroup.children = warnings.map((d) => this.buildDiagnosticNode(d));
    children.push(warningGroup);

    node.children = children;
    return node;
  }

  private buildDiagnosticNode(d: BuildLogDiagnostic): BuildLogNode {
    const isError = d.severity === 'error';
    // label 显示「文件名:行:列」，description 显示完整错误信息（Code::Blocks 习惯，易扫读）
    let label: string;
    if (d.file) {
      const parts = [path.basename(d.file)];
      if (d.line) parts.push(String(d.line));
      if (d.column) parts.push(String(d.column));
      label = parts.join(':');
    } else {
      label = d.message;
    }

    const node = new BuildLogNode(
      'diagnostic',
      label,
      vscode.TreeItemCollapsibleState.None,
      isError ? this.icon('log-error.svg', 'error') : this.icon('log-warning.svg', 'warning'),
    );
    node.description = d.file ? d.message : undefined;
    node.contextValue = isError ? 'diagnostic' : 'diagnostic-warning';
    node.diag = d;
    node.contextValue = isError ? 'diagnostic' : 'diagnostic-warning';
    node.diag = d;

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${d.message}**`);
    if (d.file) {
      md.appendMarkdown('\n\n');
      md.appendCodeblock(`${d.file}${d.line ? `:${d.line}` : ''}${d.column ? `:${d.column}` : ''}`, 'text');
    }
    node.tooltip = md;

    if (d.file) {
      const line0 = d.line && d.line > 0 ? d.line - 1 : 0;
      const col0 = d.column && d.column > 0 ? d.column - 1 : 0;
      const range = new vscode.Range(line0, col0, line0, col0);
      node.command = {
        command: 'vscode.open',
        title: '打开文件',
        arguments: [vscode.Uri.file(d.file), { selection: range, preview: true }],
      };
    }
    return node;
  }
}

/** 格式化时间戳为 HH:MM:SS */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
