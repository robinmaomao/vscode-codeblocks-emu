#!/usr/bin/env node
/**
 * Code::Blocks MCP server（stdio）。
 *
 * 与 LM Tools / CLI 共用 `api/toolRegistry.ts` 的实现，只做协议适配：
 *  - stdout 是协议通道，任何日志都必须走 stderr（runtime 已按此配置）。
 *  - 工具失败返回 `isError: true` + 文本，让模型能读到错误码并自行纠正。
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

function packageVersion(): string {
  try {
    // 打包后 bundle/cb-mcp.js → ../package.json
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function main(): Promise<void> {
  const { createRuntime } = require('../cli/runtime') as typeof import('../cli/runtime');
  const runtime = createRuntime({ echoBuildLog: true });
  const { TOOL_DEFINITIONS } = require('../api/toolRegistry') as typeof import('../api/toolRegistry');

  const server = new Server(
    { name: 'codeblocks-vscode', version: packageVersion() },
    {
      capabilities: { tools: {} },
      instructions:
        'Code::Blocks project control. Call codeblocks_project_read first to inspect a .cbp, ' +
        'then codeblocks_project_edit with structured ops. Use codeblocks_build to compile and ' +
        'codeblocks_build_status to read structured diagnostics.',
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as unknown as { type: 'object'; properties?: Record<string, object> },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const def = TOOL_DEFINITIONS.find((t) => t.name === name);
    if (!def) {
      return {
        isError: true,
        content: [{ type: 'text' as const, text: `Unknown tool: ${name}. Available: ${TOOL_DEFINITIONS.map((t) => t.name).join(', ')}` }],
      };
    }
    try {
      const value = await def.handler(runtime.context, (args ?? {}) as Record<string, unknown>);
      return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
    } catch (err) {
      const e = err as { code?: string; message?: string; details?: unknown };
      return {
        isError: true,
        content: [{
          type: 'text' as const,
          text: JSON.stringify({ ok: false, error: { code: e.code ?? 'io-error', message: e.message ?? String(err), details: e.details } }, null, 2),
        }],
      };
    }
  });

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  process.stderr.write(`[cb-mcp] fatal: ${(err as Error)?.message ?? String(err)}\n`);
  process.exit(1);
});
