/**
 * 调试会话注册表 —— 适配器实例 ↔ UI（寄存器视图/调试辅助命令）共享访问点（第四十九轮）
 */
import * as vscode from 'vscode';
import type { GdbDebugAdapter } from './gdbDebugAdapter';

let activeAdapter: GdbDebugAdapter | null = null;

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

export function setActiveAdapter(adapter: GdbDebugAdapter | null): void {
  activeAdapter = adapter;
  debugStateChanged.fire();
}

export function getActiveAdapter(): GdbDebugAdapter | null {
  return activeAdapter;
}
