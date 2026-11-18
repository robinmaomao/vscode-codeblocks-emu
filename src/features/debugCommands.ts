/**
 * 指令级步进 / Examine memory 命令（P3-1 调试域首批拆分）。
 */
import * as vscode from 'vscode';
import * as i18n from '../i18n';
import { formatMemoryDump } from '../debug/memoryDump';
import { GdbDebugAdapter } from '../debug/gdbDebugAdapter';

export interface DebugCommandDeps {
  getActiveAdapter(): GdbDebugAdapter | undefined;
  memoryChannel(): vscode.OutputChannel;
}

/** 注册 Next Instruction / Step Into Instruction / Examine Memory */
export function registerDebugInstructionCommands(context: vscode.ExtensionContext, deps: DebugCommandDeps): void {
  const requireStopped = (adapter: GdbDebugAdapter | undefined, message: string): adapter is GdbDebugAdapter => {
    if (!adapter || !adapter.isActive()) { vscode.window.showWarningMessage(i18n.t('No active Code::Blocks debug session')); return false; }
    if (!adapter.isStopped()) { vscode.window.showWarningMessage(message); return false; }
    return true;
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.debug.nextInstruction', async () => {
      const adapter = deps.getActiveAdapter();
      if (!requireStopped(adapter, i18n.t('Pause the program first (instruction stepping is only available while stopped)'))) return;
      try {
        await adapter.stepInstruction('next');
      } catch (err) {
        vscode.window.showErrorMessage(i18n.t('Instruction step failed: {0}', (err as Error).message));
      }
    }),
    vscode.commands.registerCommand('codeblocks.debug.stepIntoInstruction', async () => {
      const adapter = deps.getActiveAdapter();
      if (!requireStopped(adapter, i18n.t('Pause the program first (instruction stepping is only available while stopped)'))) return;
      try {
        await adapter.stepInstruction('into');
      } catch (err) {
        vscode.window.showErrorMessage(i18n.t('Instruction step failed: {0}', (err as Error).message));
      }
    }),
    vscode.commands.registerCommand('codeblocks.debug.examineMemory', async () => {
      const adapter = deps.getActiveAdapter();
      if (!requireStopped(adapter, i18n.t('Pause the program first (memory examination is only available while stopped)'))) return;
      const expr = await vscode.window.showInputBox({
        prompt: i18n.t('Address or expression to examine (for example &buf or 0x1000)'),
        placeHolder: '&buf',
        validateInput: (v) => (v.trim() ? undefined : i18n.t('The expression must not be empty')),
      });
      if (!expr?.trim()) return;
      const countText = await vscode.window.showInputBox({
        prompt: i18n.t('Number of bytes to read (1-65536)'),
        value: '64',
        validateInput: (v) => {
          const n = Number(v);
          if (!Number.isInteger(n) || n <= 0) return i18n.t('Enter a positive integer');
          if (n > 65536) return i18n.t('At most 65536 bytes per read');
          return undefined;
        },
      });
      if (!countText) return;
      try {
        const dump = await adapter.readMemoryDump(expr.trim(), Number(countText));
        const ch = deps.memoryChannel();
        ch.appendLine(i18n.t('Examine memory: {0} ({1} byte(s))', expr.trim(), dump.data.length));
        ch.appendLine(formatMemoryDump(dump.address, dump.data));
        ch.show(true);
      } catch (err) {
        vscode.window.showErrorMessage(i18n.t('Memory read failed: {0}', (err as Error).message));
      }
    }),
  );
}
