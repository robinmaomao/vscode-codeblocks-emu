/**
 * Agent 控制面策略（无 vscode 依赖）：总闸 + 只读白名单。
 *
 * 判定集中在这里，避免 LM Tool / MCP / CLI 各写一份而漂移。
 * 只读模式由调用方（LM Tools / MCP）注入 `ToolContext.readOnly`，CLI 不注入（独立工具，由用户显式运行）。
 */

/** 读取设置的最小接口（`vscode.WorkspaceConfiguration` 与 `settingsReader` 都满足） */
export interface AgentSettingsLike {
  get<T>(key: string, defaultValue: T): T;
}

/**
 * 总闸：默认开启；**只有显式 false 才关闭**（缺省/非法值按开启处理，避免配置损坏把功能锁死）。
 */
export function isAgentEnabled(settings: AgentSettingsLike): boolean {
  return settings.get<boolean>('agent.enabled', true) !== false;
}

/** 只读模式：默认关闭；只有显式 true 才开启 */
export function isAgentReadOnly(settings: AgentSettingsLike): boolean {
  return settings.get<boolean>('agent.readOnly', false) === true;
}

/**
 * 只读模式下放行的工具与动作。
 * `true` = 整个工具只读；数组 = 仅列出的 `action` 只读。
 * 未列出的工具（project_edit / project_file / project_target / build / run / export）在只读模式下一律拒绝。
 */
const READ_ONLY_RULES: Readonly<Record<string, true | readonly string[]>> = {
  codeblocks_project_read: true,
  codeblocks_build_status: true,
  codeblocks_compiler: ['list', 'info'],
  codeblocks_workspace: ['info', 'deps', 'list'],
  codeblocks_debug: ['state'],
};

/** 判定一次工具调用在只读模式下是否放行 */
export function isReadOnlyToolCall(name: string, input: Record<string, unknown> = {}): boolean {
  const rule = READ_ONLY_RULES[name];
  if (rule === undefined) return false;
  if (rule === true) return true;
  const action = typeof input.action === 'string' ? input.action : '';
  return rule.includes(action);
}

/** 只读拒绝时的提示（含设置键，便于模型/用户自助解除） */
export const READ_ONLY_HINT = 'Read-only mode is on: set codeblocks.agent.readOnly to false to allow changes.';

/** 总闸关闭时的提示 */
export const AGENT_DISABLED_HINT = 'Agent control is disabled: set codeblocks.agent.enabled to true (and trust the workspace) to expose the tools.';
