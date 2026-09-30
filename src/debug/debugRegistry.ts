/**
 * 调试会话注册表 —— 适配器实例 ↔ UI（寄存器视图/调试辅助命令）共享访问点（第四十九轮）
 * 第五十一轮 E3：单指针 → 「会话 id → 适配器」映射 + 最近会话兜底：
 * 多调试会话时跟随 VS Code 聚焦会话；任一会话结束不再误清其它会话。
 */
import * as vscode from 'vscode';
import type { GdbDebugAdapter } from './gdbDebugAdapter';

const adapters = new Map<string, GdbDebugAdapter>();
let lastAdapter: GdbDebugAdapter | null = null;

/** 调试状态变化（会话建立/销毁、停止/运行） */
export const debugStateChanged = new vscode.EventEmitter<void>();

// ---- DAP 跟踪（第五十轮修复 5：codeblocks.debug.trace） ----
let traceEnabled = false;
let traceSink: ((line: string) => void) | null = null;

/** 由扩展注册输出通道（Code::Blocks 输出） */
export function setDebugTraceSink(fn: ((line: string) => void) | null): void {
  traceSink = fn;
}

/** 由设置 codeblocks.debug.trace 控制 */
export function setDebugTraceEnabled(on: boolean): void {
  traceEnabled = on;
}

/** 写入一条 DAP 跟踪（未开启或无 sink 时为空操作） */
export function debugTrace(line: string): void {
  if (traceEnabled && traceSink) traceSink(line);
}

/** 注册会话适配器（openSession 调用；sessionId 缺省时仅作兜底会话） */
export function registerAdapter(sessionId: string | undefined, adapter: GdbDebugAdapter): void {
  if (sessionId) adapters.set(sessionId, adapter);
  lastAdapter = adapter;
  debugStateChanged.fire();
}

/** 注销会话适配器（dispose 调用；不影响其它已注册会话） */
export function unregisterAdapter(sessionId: string | undefined, adapter: GdbDebugAdapter): void {
  if (sessionId && adapters.get(sessionId) === adapter) adapters.delete(sessionId);
  if (lastAdapter === adapter) lastAdapter = null;
  debugStateChanged.fire();
}

/**
 * 当前适配器：优先 VS Code 聚焦会话 → 最近注册的会话 → 任一存活会话。
 * （防御式读取 vscode.debug，便于直构/测试环境；已结束会话由 isActive() 过滤）
 */
export function getActiveAdapter(): GdbDebugAdapter | null {
  const activeId: string | undefined = (vscode as any).debug?.activeDebugSession?.id;
  if (activeId) {
    const hit = adapters.get(activeId);
    if (hit && hit.isActive()) return hit;
  }
  if (lastAdapter && lastAdapter.isActive()) return lastAdapter;
  for (const a of adapters.values()) {
    if (a.isActive()) return a;
  }
  return null;
}
