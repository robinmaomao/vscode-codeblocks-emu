/**
 * Language Model Tools 注册（VS Code 扩展进程内）。
 *
 * 只做传输适配：真正的实现在 `api/toolRegistry.ts`，与 MCP / CLI 完全一致。
 * 注册失败（旧宿主 / 未启用 Copilot）不应阻断扩展激活。
 *
 * 返回可注销的 `Disposable[]`：设置开关切换时由调用方整体 dispose 后重新注册（无需重载窗口）。
 */
import * as vscode from 'vscode';
import { invokeTool, TOOL_DEFINITIONS, ToolContext } from '../api/toolRegistry';
import { asControlError } from '../api/types';

type ToolInput = Record<string, unknown>;

export interface LmToolOptions {
  /** 审计日志（每次调用一行；扩展传 Code::Blocks 输出通道） */
  log?: (line: string) => void;
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

/** 注册全部工具；返回成功注册的句柄（宿主不支持时返回空数组） */
export function registerLanguageModelTools(toolContext: ToolContext, opts: LmToolOptions = {}): vscode.Disposable[] {
  if (typeof vscode.lm?.registerTool !== 'function') return [];
  const disposables: vscode.Disposable[] = [];
  for (const def of TOOL_DEFINITIONS) {
    const tool: vscode.LanguageModelTool<ToolInput> = {
      async invoke(options): Promise<vscode.LanguageModelToolResult> {
        const started = Date.now();
        try {
          // 走统一入口：只读模式等策略拦截与 MCP / CLI 一致
          const value = await invokeTool(toolContext, def.name, options.input ?? {});
          opts.log?.(`[agent] ${def.name} ok (${Date.now() - started}ms)`);
          return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(toText(value))]);
        } catch (err) {
          const e = asControlError(err);
          opts.log?.(`[agent] ${def.name} failed code=${e.code} (${Date.now() - started}ms)`);
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
      disposables.push(vscode.lm.registerTool(def.name, tool));
    } catch {
      // 单个工具注册失败不影响其余工具
    }
  }
  return disposables;
}
