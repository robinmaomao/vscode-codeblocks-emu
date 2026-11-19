/**
 * 无项目单文件编译设置 —— `codeblocks.noProjectCompile.useTaskTerminal`
 * （true = 走任务系统/集成终端，false = 扩展自管进程并逐行解码输出）。
 */
import * as vscode from 'vscode';

export const USE_TASK_TERMINAL_SETTING = 'noProjectCompile.useTaskTerminal';

export function useTaskTerminalForNoProjectCompile(): boolean {
  return vscode.workspace.getConfiguration('codeblocks').get<boolean>(USE_TASK_TERMINAL_SETTING, false);
}
