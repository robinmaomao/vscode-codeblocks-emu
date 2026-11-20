/**
 * Agent 变更历史的公共类型与写目标解析（无 vscode 依赖）。
 *
 * 这里只决定「哪些工具会写哪个工程文件」；持久化、快照与撤销在
 * `src/agent/historyStore.ts` 中完成，避免 API 层依赖 Node 文件系统细节。
 */
import * as path from 'path';
import { requireCbpPath, requireWorkspacePath } from './projectStore';

export type AgentChangeStatus = 'applied' | 'undone' | 'corrupt';

/** 一条可撤销的工程文件变更（.cbp / .workspace） */
export interface AgentChangeEntry {
  id: string;
  at: string;
  tool: string;
  action?: string;
  file: string;
  relativeFile?: string;
  beforeHash: string;
  afterHash: string;
  beforeBytes: number;
  afterBytes: number;
  snapshot: string;
  status: AgentChangeStatus;
  mode?: number;
  errorCode?: string;
  undoneAt?: string;
}

/** 撤销失败的稳定错误码（命令层据此给用户不同提示） */
export type AgentHistoryUndoErrorCode =
  | 'history-unavailable'
  | 'not-found'
  | 'already-undone'
  | 'superseded'
  | 'conflict'
  | 'missing'
  | 'corrupt'
  | 'busy'
  | 'untrusted'
  | 'io-error';

export class AgentHistoryError extends Error {
  readonly code: AgentHistoryUndoErrorCode;
  readonly details: unknown;

  constructor(code: AgentHistoryUndoErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AgentHistoryError';
    this.code = code;
    this.details = details;
  }
}

export interface AgentWriteTarget {
  file: string;
  kind: 'cbp' | 'workspace';
}

/** `resolveWriteTargets` 所需的最小上下文（ToolContext 结构兼容） */
export interface AgentWriteTargetContext {
  listOpenProjects?: () => Array<{ filename: string; active?: boolean }>;
}

export interface AgentHistoryCapture {
  id: string;
}

export interface AgentHistoryChangeInfo {
  file: string;
  relativeFile?: string;
  beforeBytes: number;
  afterBytes: number;
}

export interface AgentHistoryOutcome {
  ok: boolean;
  code?: string;
  error?: string;
}

export interface AgentHistoryCaptureRequest {
  tool: string;
  input: Record<string, unknown>;
  targets: AgentWriteTarget[];
}

export interface AgentCallAudit {
  id?: string;
  at: string;
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  code?: string;
  error?: string;
  durationMs: number;
  changedFiles: string[];
}

/** `invokeTool` 与扩展历史实现之间的窄接口；历史实现可替换/测试 */
export interface AgentHistoryHooks {
  capture(request: AgentHistoryCaptureRequest): Promise<AgentHistoryCapture | undefined>;
  finish(capture: AgentHistoryCapture | undefined, outcome: AgentHistoryOutcome): Promise<AgentHistoryChangeInfo[]>;
  recordCall(call: AgentCallAudit): Promise<void>;
}

function optionalText(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function activeCbp(ctx: AgentWriteTargetContext): string | undefined {
  const open = ctx.listOpenProjects?.() ?? [];
  return open.find((p) => p.active)?.filename ?? open[0]?.filename;
}

function safeCbp(ctx: AgentWriteTargetContext, input: Record<string, unknown>): string | undefined {
  const explicit = optionalText(input, 'cbp');
  if (explicit) {
    try {
      return requireCbpPath(explicit);
    } catch {
      return undefined;
    }
  }
  const active = activeCbp(ctx);
  return active ? path.resolve(active) : undefined;
}

function safeWorkspace(input: Record<string, unknown>): string | undefined {
  const value = optionalText(input, 'workspace');
  if (!value) return undefined;
  try {
    return requireWorkspacePath(value);
  } catch {
    return undefined;
  }
}

/**
 * 解析一次工具调用可能写入的工程文件。
 *
 * - `dryRun` 不写盘，返回空；
 * - 目标不存在/参数非法时返回空，让原工具生成原有错误，而不是提前报错；
 * - 只覆盖 .cbp / .workspace；export 产物、构建产物不进入撤销历史。
 */
export function resolveWriteTargets(
  ctx: AgentWriteTargetContext,
  tool: string,
  input: Record<string, unknown>,
): AgentWriteTarget[] {
  if (input.dryRun === true) return [];

  let target: AgentWriteTarget | undefined;
  if (tool === 'codeblocks_project_edit' || tool === 'codeblocks_project_file' || tool === 'codeblocks_project_target') {
    const file = safeCbp(ctx, input);
    if (file) target = { file, kind: 'cbp' };
  } else if (tool === 'codeblocks_workspace' && input.action === 'deps') {
    const file = safeWorkspace(input);
    if (file) target = { file, kind: 'workspace' };
  }
  return target ? [target] : [];
}
