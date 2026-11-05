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

/** 注册 MCP provider；宿主不支持或脚本缺失时静默跳过 */
export function registerCodeblocksMcpProvider(context: vscode.ExtensionContext): void {
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') return;
  const script = mcpServerScript(context.extensionPath);
  if (!fs.existsSync(script)) return;

  const version = (context.extension.packageJSON as { version?: string } | undefined)?.version;
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(MCP_PROVIDER_ID, {
      provideMcpServerDefinitions(): vscode.McpServerDefinition[] {
        return [new vscode.McpStdioServerDefinition(MCP_SERVER_LABEL, process.execPath, [script], undefined, version)];
      },
    }),
  );
}
