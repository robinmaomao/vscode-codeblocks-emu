/**
 * Language Model Tools 注册（VS Code 扩展进程内）。
 *
 * 只做传输适配：真正的实现在 `api/toolRegistry.ts`，与 MCP / CLI 完全一致。
 * 注册失败（旧宿主 / 未启用 Copilot）不应阻断扩展激活。
 */
import * as vscode from 'vscode';
import { TOOL_DEFINITIONS, ToolContext } from '../api/toolRegistry';
import { asControlError } from '../api/types';

type ToolInput = Record<string, unknown>;

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

/** 注册全部工具；返回成功注册的数量 */
export function registerLanguageModelTools(ctx: vscode.ExtensionContext, toolContext: ToolContext): number {
  if (typeof vscode.lm?.registerTool !== 'function') return 0;
  let count = 0;
  for (const def of TOOL_DEFINITIONS) {
    const tool: vscode.LanguageModelTool<ToolInput> = {
      async invoke(options): Promise<vscode.LanguageModelToolResult> {
        try {
          const value = await def.handler(toolContext, options.input ?? {});
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(toText(value))]);
        } catch (err) {
          const e = asControlError(err);
          return new vscode.LanguageModelToolResult([
            new vscode.LanguageModelTextPart(toText({ ok: false, error: { code: e.code, message: e.message, details: e.details } })),
          ]);
        }
      },
      prepareInvocation(options): vscode.PreparedToolInvocation {
        const input = options.input ?? {};
        const hint = typeof input.cbp === 'string' ? input.cbp : '';
        return { invocationMessage: `${def.title}${hint ? `: ${hint}` : ''}` };
      },
    };
    try {
      ctx.subscriptions.push(vscode.lm.registerTool(def.name, tool));
      count++;
    } catch {
      // 单个工具注册失败不影响其余工具
    }
  }
  return count;
}
