/**
 * 运行终端创建 —— UI 核查 N2（方案 C）
 *
 * Code::Blocks 的 Run 在扩展中落到集成终端。原实现每次 `vscode.window.createTerminal`
 * 都新建实例（VS Code 不合并同名终端），连续运行会在面板里堆积多个同名标签。
 * 方案 C：同名终端已存在时先 dispose 再新建——同一名称始终只保留一个终端标签，
 * 每次运行的输出全新，cwd/env 按本次运行生效。Debug 走 DAP 不经过此模块。
 */
import * as vscode from 'vscode';

/** createTerminal 的最小选项子集 */
export interface RunTerminalOptions {
  cwd?: string;
  env?: { [key: string]: string | null | undefined };
}

/** 可注入的终端 API（测试替身） */
export interface RunTerminalApi<T> {
  /** 现有终端列表 */
  existing(): readonly { name: string; dispose(): void }[];
  /** 创建终端（对应 vscode.window.createTerminal） */
  create(options: { name: string; cwd?: string; env?: RunTerminalOptions['env'] }): T;
}

const vscodeTerminalApi: RunTerminalApi<vscode.Terminal> = {
  existing: () => vscode.window.terminals,
  create: (options) => vscode.window.createTerminal(options),
};

/**
 * 创建运行终端：先 dispose 同名现有终端，再创建新终端。
 * @param name 终端名（同名互斥，保证单一标签）
 * @param options cwd / env（与 vscode.window.createTerminal 同语义）
 * @param api 终端 API（测试注入；默认 vscode.window）
 */
export function createRunTerminal(
  name: string,
  options: RunTerminalOptions = {},
  api: RunTerminalApi<vscode.Terminal> = vscodeTerminalApi,
): vscode.Terminal {
  for (const t of api.existing()) {
    if (t.name === name) {
      t.dispose();
    }
  }
  return api.create({ name, cwd: options.cwd, env: options.env });
}
