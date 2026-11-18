/**
 * 编辑器/工具类命令（从 extension.ts 拆出的第一批 feature 模块）。
 *
 * 只依赖 vscode API + 纯工具函数，便于独立测试与后续继续拆分。
 */
import * as vscode from 'vscode';
import * as i18n from '../i18n';
import { extractStringLiterals } from '../tools/copyStrings';
import { clearBackticksCache, getBackticksCacheEntries } from '../compiler/commandGenerator';

/** 注册 Copy Strings / Backtick Cache 命令 */
export function registerToolCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.copyStrings', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) { vscode.window.showWarningMessage(i18n.t('No file is open')); return; }
      const selection = editor.selection;
      const text = selection.isEmpty ? editor.document.getText() : editor.document.getText(selection);
      const strings = extractStringLiterals(text);
      if (!strings.length) {
        vscode.window.showInformationMessage(i18n.t('No double-quoted string literals found'));
        return;
      }
      const eol = process.platform === 'win32' ? '\r\n' : '\n';
      await vscode.env.clipboard.writeText(strings.join(eol));
      vscode.window.showInformationMessage(i18n.t('{0} literal string(s) copied to the clipboard', strings.length));
    }),
    vscode.commands.registerCommand('codeblocks.backtickCache', async () => {
      const entries = getBackticksCacheEntries();
      const clearLabel = i18n.t('Clear and close');
      const items: Array<vscode.QuickPickItem & { expression?: string; value?: string; clear?: boolean }> = [];
      for (const e of entries) {
        items.push({
          label: e.expression,
          description: e.value.length > 160 ? `${e.value.slice(0, 157)}...` : e.value,
          expression: e.expression,
          value: e.value,
        });
      }
      if (entries.length) items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
      items.push({ label: clearLabel, iconPath: new vscode.ThemeIcon('trash'), clear: true });
      const pick = await vscode.window.showQuickPick(items, {
        title: i18n.t('Backtick Cache'),
        placeHolder: entries.length ? i18n.t('Cached backtick commands — select one to copy its value') : i18n.t('The backtick cache is empty'),
        matchOnDescription: true,
      });
      if (!pick) return;
      if (pick.clear) {
        clearBackticksCache();
        vscode.window.setStatusBarMessage(i18n.t('Backtick cache cleared (backtick commands run again on the next build)'), 3000);
        return;
      }
      if (pick.value !== undefined) {
        await vscode.env.clipboard.writeText(pick.value);
        vscode.window.setStatusBarMessage(i18n.t('Backtick value copied: {0}', pick.expression ?? ''), 3000);
      }
    }),
    vscode.commands.registerCommand('codeblocks.clearBacktickCache', () => {
      clearBackticksCache();
      vscode.window.setStatusBarMessage(i18n.t('Backtick cache cleared (backtick commands run again on the next build)'), 3000);
    }),
  );
}
