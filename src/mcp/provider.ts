/**
 * 把随扩展打包的 MCP server 注册到 VS Code（`contributes.mcpServerDefinitionProviders`）。
 *
 * 用 `process.execPath` 启动（VS Code 官方文档明确支持：会用编辑器的 Node 运行脚本），
 * 因此不依赖用户 PATH 里是否有 `node`。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

export const MCP_PROVIDER_ID = 'codeblocks';
export const MCP_SERVER_LABEL = 'Code::Blocks';

export function mcpServerScript(extensionPath: string): string {
  return path.join(extensionPath, 'bundle', 'cb-mcp.js');
}

export interface PlanMcpServerOptions {
  /** 总闸（含工作区信任）是否放行 */
  enabled: boolean;
  /** bundle/cb-mcp.js 是否存在 */
  scriptExists: boolean;
  script: string;
  execPath: string;
  label?: string;
  version?: string;
}

export interface McpServerPlan {
  label: string;
  command: string;
  args: string[];
  version?: string;
}

/**
 * 纯函数：决定当前是否暴露 MCP server（关闭或无脚本 ⇒ 不暴露）。
 * 抽出来便于无宿主单测（真正的 `McpStdioServerDefinition` 需要在宿主内构造）。
 */
export function planMcpServer(opts: PlanMcpServerOptions): McpServerPlan | undefined {
  if (!opts.enabled || !opts.scriptExists) return undefined;
  return {
    label: opts.label ?? MCP_SERVER_LABEL,
    command: opts.execPath,
    args: [opts.script],
    version: opts.version,
  };
}

export interface RegisterMcpProviderOptions {
  /** 是否允许暴露（扩展传「总闸 && 工作区受信任」）；缺省 = 允许 */
  isEnabled?: () => boolean;
  /** 设置变化时通知宿主重新拉取定义 */
  onDidChange?: vscode.Event<void>;
}

/** 注册 MCP provider；宿主不支持时静默跳过。返回句柄供注销 */
export function registerCodeblocksMcpProvider(
  context: vscode.ExtensionContext,
  opts: RegisterMcpProviderOptions = {},
): vscode.Disposable | undefined {
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') return undefined;
  const script = mcpServerScript(context.extensionPath);
  const version = (context.extension.packageJSON as { version?: string } | undefined)?.version;

  return vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
    onDidChangeMcpServerDefinitions: opts.onDidChange,
    provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
      const plan = planMcpServer({
        enabled: opts.isEnabled ? opts.isEnabled() : true,
        scriptExists: fs.existsSync(script),
        script,
        execPath: process.execPath,
        version,
      });
      return plan
        ? [new vscode.McpStdioServerDefinition(plan.label, plan.command, plan.args, undefined, plan.version)]
        : [];
    },
  });
}
