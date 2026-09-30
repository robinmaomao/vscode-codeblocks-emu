/**
 * Registers 视图 —— 对齐 Code::Blocks cpuregistersdlg（第四十九轮）
 *
 * 挂在 VS Code 调试容器（views.debug）；目标停驻时展示全部寄存器（名 = 十六进制值），
 * 运行中/无会话时显示占位说明；刷新由调试状态变化驱动（另有刷新命令）。
 */
import * as vscode from 'vscode';
import { debugStateChanged, getActiveAdapter } from '../debug/debugRegistry';

type RegNode = { name: string; value: string } | vscode.TreeItem;

export class RegistersTreeProvider implements vscode.TreeDataProvider<RegNode> {
  private emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private values: { name: string; value: string }[] = [];
  private loading = false;

  constructor() {
    debugStateChanged.event(() => void this.reload());
  }

  refresh(): void {
    void this.reload();
  }

  private async reload(): Promise<void> {
    const adapter = getActiveAdapter();
    if (!vscode.workspace.getConfiguration('codeblocks').get<boolean>('debug.registers', false)) {
      // 第五十轮修复 6：寄存器读取默认关闭（部分 MinGW GDB 8.1 读取寄存器会让 GDB 进程崩溃）
      this.values = [];
      this.emitter.fire();
      return;
    }
    if (!adapter || !adapter.isActive() || !adapter.isStopped()) {
      this.values = [];
      this.emitter.fire();
      return;
    }
    if (this.loading) return;
    this.loading = true;
    try {
      this.values = await adapter.registerValues();
    } catch {
      this.values = [];
    } finally {
      this.loading = false;
      this.emitter.fire();
    }
  }

  getTreeItem(el: RegNode): vscode.TreeItem {
    if (el instanceof vscode.TreeItem) return el;
    const item = new vscode.TreeItem(el.name, vscode.TreeItemCollapsibleState.None);
    item.description = el.value;
    item.tooltip = `${el.name} = ${el.value}`;
    item.contextValue = 'cbRegister';
    return item;
  }

  getChildren(): RegNode[] {
    const adapter = getActiveAdapter();
    if (!vscode.workspace.getConfiguration('codeblocks').get<boolean>('debug.registers', false)) {
      return [placeholder('寄存器读取已禁用 — 在设置 codeblocks.debug.registers 中启用（部分 GDB 读取寄存器会崩溃）')];
    }
    if (!adapter || !adapter.isActive()) return [placeholder('调试会话未启动（F8 开始调试）')];
    if (!adapter.isStopped()) return [placeholder('目标运行中 — 中断后显示寄存器')];
    if (!this.values.length) return [placeholder('寄存器不可用')];
    return this.values;
  }
}

function placeholder(text: string): vscode.TreeItem {
  const item = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon('info');
  return item;
}
