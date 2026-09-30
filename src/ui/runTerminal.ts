/**
 * 运行终端创建 —— UI 核查 N2（方案 C）
 *
 * Code::Blocks 的 Run 在扩展中落到集成终端。原实现每次 `vscode.window.createTerminal`
 * 都新建实例（VS Code 不合并同名终端），连续运行会在面板里堆积多个同名标签。
 * 方案 C：同名终端已存在时先 dispose 再新建——同一名称始终只保留一个终端标签，
 * 每次运行的输出全新，cwd/env 按本次运行生效。Debug 走 DAP 不经过此模块。
 * 方案 A（用户确认）：同名匹配仅处置**本扩展创建**的终端（WeakSet 记录），
 * 用户手工创建/其它扩展创建的同名终端不误杀。
 * 方案 B1（用户确认）：WeakSet 为内存态、窗口重载即失效——注册表把「本扩展用过的
 * 终端名」持久化到 workspaceState，重载后旧同名标签仍可识别回收，「单一标签」保证
 * 跨窗口重载成立；从未用过的名称不受影响。
 */
import * as vscode from 'vscode';

/** createTerminal 的最小选项子集 */
export interface RunTerminalOptions {
  cwd?: string;
  env?: { [key: string]: string | null | undefined };
}

/** 终端名称注册表（跨窗口重载识别本扩展用过的终端名；方案 B1） */
export interface RunTerminalRegistry {
  /** 该名称是否曾被本扩展创建 */
  has(name: string): boolean;
  /** 登记名称（幂等） */
  add(name: string): void;
}

/** 基于 Memento（workspaceState）的注册表实现 */
export function createWorkspaceRunTerminalRegistry(
  state: vscode.Memento,
  key = 'codeblocks.runTerminalNames',
): RunTerminalRegistry {
  const names = new Set<string>(state.get<string[]>(key, []));
  return {
    has: (n) => names.has(n),
    add: (n) => {
      if (names.has(n)) return;
      names.add(n);
      void state.update(key, [...names]);
    },
  };
}

/** 可注入的终端 API（测试替身） */
export interface RunTerminalApi<T extends object> {
  /** 现有终端列表 */
  existing(): readonly { name: string; dispose(): void }[];
  /** 创建终端（对应 vscode.window.createTerminal） */
  create(options: { name: string; cwd?: string; env?: RunTerminalOptions['env'] }): T;
}

const vscodeTerminalApi: RunTerminalApi<vscode.Terminal> = {
  existing: () => vscode.window.terminals,
  create: (options) => vscode.window.createTerminal(options),
};

/** 本扩展创建的终端（弱引用；同一会话内精确识别） */
const ownedTerminals = new WeakSet<object>();

/** 跨重载名称注册表（extension.ts 激活时注入；测试可注入替身） */
let registry: RunTerminalRegistry | undefined;

/** 注入注册表（激活时调用一次；传 undefined 复位，供测试隔离） */
export function setRunTerminalRegistry(r: RunTerminalRegistry | undefined): void {
  registry = r;
}

/**
 * 创建运行终端：先 dispose 「同名且本扩展创建（WeakSet 命中）或名称曾用过（注册表命中）」
 * 的现有终端，再创建新终端。
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
    if (t.name === name && (ownedTerminals.has(t) || registry?.has(name))) {
      t.dispose();
    }
  }
  const term = api.create({ name, cwd: options.cwd, env: options.env });
  ownedTerminals.add(term);
  registry?.add(name);
  return term;
}
