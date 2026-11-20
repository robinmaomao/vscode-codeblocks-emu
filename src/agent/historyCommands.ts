/** Agent 变更历史命令：QuickPick、撤销确认与冲突处理（仅 vscode 层）。 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as i18n from '../i18n';
import { AgentChangeEntry, AgentHistoryError } from '../api/agentHistory';
import { AgentHistoryStore } from './historyStore';

export interface AgentHistoryCommandHost {
  getStore: () => AgentHistoryStore | undefined;
  isTrusted: () => boolean;
  isBusy: () => boolean;
  reloadAfterUndo: (file: string) => Promise<void>;
  log?: (line: string) => void;
}

interface HistoryPick extends vscode.QuickPickItem {
  entry?: AgentChangeEntry;
  clear?: boolean;
  openAudit?: boolean;
}

interface ActionPick extends vscode.QuickPickItem {
  action: 'undo' | 'reveal' | 'copy';
}

const BTN_UNDO = i18n.t('Undo');
const BTN_CANCEL = i18n.t('Cancel');
const BTN_FORCE = i18n.t('Force Undo…');
const BTN_FORCE_CONFIRM = i18n.t('Force Undo');
const BTN_RESTORE = i18n.t('Restore');
const BTN_UNDO_LATEST = i18n.t('Undo Latest');

function bytesLabel(entry: AgentChangeEntry): string {
  const delta = entry.afterBytes - entry.beforeBytes;
  const sign = delta > 0 ? '+' : '';
  return `${entry.beforeBytes} B → ${entry.afterBytes} B (${sign}${delta} B)`;
}

function timeLabel(entry: AgentChangeEntry): string {
  const date = new Date(entry.at);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : entry.at;
}

function fileLabel(entry: AgentChangeEntry): string {
  return entry.relativeFile ?? entry.file;
}

function fileKey(file: string): string {
  const resolved = path.resolve(file);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function latestAppliedByFile(entries: AgentChangeEntry[]): Map<string, AgentChangeEntry> {
  const map = new Map<string, AgentChangeEntry>();
  for (const entry of entries) {
    const key = fileKey(entry.file);
    if (entry.status === 'undone' || map.has(key)) continue;
    map.set(key, entry);
  }
  return map;
}

function statusLabel(entry: AgentChangeEntry, latestId: string | undefined): string {
  if (entry.status === 'undone') return i18n.t('Undone');
  if (entry.status === 'corrupt') return i18n.t('Snapshot corrupt');
  if (latestId !== entry.id) return i18n.t('Superseded');
  return i18n.t('Undo available');
}

function hostLog(host: AgentHistoryCommandHost, line: string): void {
  try {
    host.log?.(line);
  } catch {
    // 日志失败不影响命令。
  }
}

async function confirmUndo(
  host: AgentHistoryCommandHost,
  store: AgentHistoryStore,
  entry: AgentChangeEntry,
): Promise<boolean> {
  if (entry.status === 'undone') {
    void vscode.window.showInformationMessage(i18n.t('This Agent change is already undone.'));
    return false;
  }
  if (entry.status === 'corrupt') {
    void vscode.window.showWarningMessage(i18n.t('The Agent change has a corrupt snapshot and cannot be undone.'));
    return false;
  }
  if (!host.isTrusted()) {
    void vscode.window.showWarningMessage(i18n.t('Trust the workspace before undoing Agent changes.'));
    return false;
  }
  if (host.isBusy()) {
    void vscode.window.showWarningMessage(i18n.t('Wait for the current Agent tool call, build or debug session to finish before undoing Agent changes.'));
    return false;
  }

  const answer = await vscode.window.showWarningMessage(
    i18n.t('Undo the Agent change to {0}?', fileLabel(entry)),
    {
      modal: true,
      detail: [
        `${i18n.t('Tool')}: ${entry.tool}${entry.action ? ` (${entry.action})` : ''}`,
        `${i18n.t('Time')}: ${timeLabel(entry)}`,
        `${i18n.t('Size')}: ${bytesLabel(entry)}`,
        entry.errorCode ? `${i18n.t('The tool reported an error after writing')}: ${entry.errorCode}` : '',
      ].filter(Boolean).join('\n'),
    },
    BTN_UNDO,
    BTN_CANCEL,
  );
  if (answer !== BTN_UNDO) return false;

  try {
    const result = await store.undo(entry.id);
    hostLog(host, `[agent-history] undo ${entry.id} -> ${entry.file}`);
    try {
      await host.reloadAfterUndo(result.entry.file);
    } catch (err) {
      void vscode.window.showWarningMessage(i18n.t('Restored {0}, but reloading the project failed: {1}', fileLabel(entry), (err as Error).message));
    }
    void vscode.window.showInformationMessage(i18n.t('Restored {0} from Agent history.', fileLabel(entry)));
    return true;
  } catch (err) {
    return handleUndoError(host, store, entry, err);
  }
}

async function handleUndoError(
  host: AgentHistoryCommandHost,
  store: AgentHistoryStore,
  entry: AgentChangeEntry,
  err: unknown,
): Promise<boolean> {
  const error = err instanceof AgentHistoryError ? err : undefined;
  if (!error) {
    void vscode.window.showErrorMessage(i18n.t('Failed to undo Agent change: {0}', (err as Error).message));
    return false;
  }
  if (error.code === 'conflict') {
    const first = await vscode.window.showWarningMessage(
      i18n.t('{0} was modified after the Agent change. Undoing will discard those external changes.', fileLabel(entry)),
      { modal: true },
      BTN_CANCEL,
      BTN_FORCE,
    );
    if (first !== BTN_FORCE) return false;
    const second = await vscode.window.showWarningMessage(
      i18n.t('External changes to {0} will be lost. Force undo?', fileLabel(entry)),
      { modal: true },
      BTN_CANCEL,
      BTN_FORCE_CONFIRM,
    );
    if (second !== BTN_FORCE_CONFIRM) return false;
    try {
      const result = await store.undo(entry.id, { force: true });
      hostLog(host, `[agent-history] force-undo ${entry.id} -> ${entry.file}`);
      try {
        await host.reloadAfterUndo(result.entry.file);
      } catch (reloadErr) {
        void vscode.window.showWarningMessage(i18n.t('Restored {0}, but reloading the project failed: {1}', fileLabel(entry), (reloadErr as Error).message));
      }
      void vscode.window.showInformationMessage(i18n.t('Restored {0} from Agent history.', fileLabel(entry)));
      return true;
    } catch (forceErr) {
      void vscode.window.showErrorMessage(i18n.t('Failed to undo Agent change: {0}', (forceErr as Error).message));
      return false;
    }
  }
  if (error.code === 'missing') {
    const answer = await vscode.window.showWarningMessage(
      i18n.t('{0} no longer exists. Restore it from Agent history?', fileLabel(entry)),
      { modal: true },
      BTN_RESTORE,
      BTN_CANCEL,
    );
    if (answer !== BTN_RESTORE) return false;
    try {
      const result = await store.undo(entry.id, { force: true });
      hostLog(host, `[agent-history] restore ${entry.id} -> ${entry.file}`);
      try {
        await host.reloadAfterUndo(result.entry.file);
      } catch (reloadErr) {
        void vscode.window.showWarningMessage(i18n.t('Restored {0}, but reloading the project failed: {1}', fileLabel(entry), (reloadErr as Error).message));
      }
      void vscode.window.showInformationMessage(i18n.t('Restored {0} from Agent history.', fileLabel(entry)));
      return true;
    } catch (restoreErr) {
      void vscode.window.showErrorMessage(i18n.t('Failed to restore Agent change: {0}', (restoreErr as Error).message));
      return false;
    }
  }
  if (error.code === 'superseded') {
    const latestId = (error.details as { latestId?: string } | undefined)?.latestId;
    const latest = latestId ? store.list().find((e) => e.id === latestId) : undefined;
    if (!latest) {
      void vscode.window.showWarningMessage(i18n.t('A newer Agent change exists for this file. Undo it first.'));
      return false;
    }
    const answer = await vscode.window.showWarningMessage(
      i18n.t('A newer Agent change exists for {0}. Undo the latest change instead?', fileLabel(entry)),
      { modal: true },
      BTN_UNDO_LATEST,
      BTN_CANCEL,
    );
    if (answer !== BTN_UNDO_LATEST) return false;
    return confirmUndo(host, store, latest);
  }
  if (error.code === 'busy') {
    void vscode.window.showWarningMessage(i18n.t('Wait for the current Agent tool call, build or debug session to finish before undoing Agent changes.'));
    return false;
  }
  if (error.code === 'untrusted') {
    void vscode.window.showWarningMessage(i18n.t('Trust the workspace before undoing Agent changes.'));
    return false;
  }
  void vscode.window.showErrorMessage(i18n.t('Failed to undo Agent change: {0}', error.message));
  return false;
}

export async function undoEntry(
  host: AgentHistoryCommandHost,
  entry: AgentChangeEntry,
): Promise<boolean> {
  const store = host.getStore();
  if (!store) {
    void vscode.window.showWarningMessage(i18n.t('Agent change history is unavailable. Open a folder and try again.'));
    return false;
  }
  const latest = latestAppliedByFile(store.list()).get(fileKey(entry.file));
  if (latest && latest.id !== entry.id) {
    const answer = await vscode.window.showWarningMessage(
      i18n.t('A newer Agent change exists for {0}. Undo the latest change instead?', fileLabel(entry)),
      { modal: true },
      BTN_UNDO_LATEST,
      BTN_CANCEL,
    );
    if (answer !== BTN_UNDO_LATEST) return false;
    return confirmUndo(host, store, latest);
  }
  return confirmUndo(host, store, entry);
}

export async function undoLastAgentChange(host: AgentHistoryCommandHost): Promise<boolean> {
  const store = host.getStore();
  if (!store) {
    void vscode.window.showWarningMessage(i18n.t('Agent change history is unavailable. Open a folder and try again.'));
    return false;
  }
  const latest = store.list().find((e) => e.status !== 'undone');
  if (!latest) {
    void vscode.window.showInformationMessage(i18n.t('No Agent changes to undo.'));
    return false;
  }
  if (latest.status === 'corrupt') {
    void vscode.window.showWarningMessage(i18n.t('The latest Agent change has a corrupt snapshot and cannot be undone.'));
    return false;
  }
  return confirmUndo(host, store, latest);
}

async function clearHistory(host: AgentHistoryCommandHost, store: AgentHistoryStore): Promise<void> {
  if (!host.isTrusted()) {
    void vscode.window.showWarningMessage(i18n.t('Trust the workspace before clearing Agent history.'));
    return;
  }
  const answer = await vscode.window.showWarningMessage(
    i18n.t('Delete all Agent change history for this workspace?'),
    { modal: true, detail: i18n.t('This removes local snapshots and the audit log. Project files are not deleted.') },
    i18n.t('Delete'),
    BTN_CANCEL,
  );
  if (answer !== i18n.t('Delete')) return;
  try {
    await store.clear();
  } catch (err) {
    void vscode.window.showErrorMessage(i18n.t('Failed to clear Agent history: {0}', (err as Error).message));
    return;
  }
  hostLog(host, '[agent-history] history cleared');
  void vscode.window.showInformationMessage(i18n.t('Agent change history cleared.'));
}

export async function showAgentHistory(host: AgentHistoryCommandHost): Promise<void> {
  const store = host.getStore();
  if (!store) {
    void vscode.window.showWarningMessage(i18n.t('Agent change history is unavailable. Open a folder and try again.'));
    return;
  }
  if (!host.isTrusted()) {
    void vscode.window.showWarningMessage(i18n.t('Trust the workspace before using Agent history.'));
    return;
  }
  const entries = store.list();
  if (!entries.length && !fs.existsSync(store.auditFile)) {
    void vscode.window.showInformationMessage(i18n.t('No Agent changes recorded for this workspace.'));
    return;
  }

  const latest = latestAppliedByFile(entries);
  const items: HistoryPick[] = entries.map((entry) => ({
    label: `$(history) ${timeLabel(entry)} · ${entry.tool}`,
    description: fileLabel(entry),
    detail: `${bytesLabel(entry)} · ${statusLabel(entry, latest.get(fileKey(entry.file))?.id)}`,
    entry,
  }));
  items.push({
    label: i18n.t('$(output) Open Audit Log'),
    description: i18n.t('audit.jsonl (JSON Lines)'),
    openAudit: true,
  });
  items.push({
    label: i18n.t('$(trash) Clear Agent history…'),
    description: i18n.t('Delete local snapshots and the audit log'),
    clear: true,
  });

  const picked = await vscode.window.showQuickPick(items, {
    title: i18n.t('Code::Blocks: Agent Change History'),
    placeHolder: i18n.t('Select a change to inspect or undo'),
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return;
  if (picked.openAudit) {
    if (!fs.existsSync(store.auditFile)) {
      void vscode.window.showInformationMessage(i18n.t('No audit log recorded for this workspace.'));
      return;
    }
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(store.auditFile));
    return;
  }
  if (picked.clear) {
    await clearHistory(host, store);
    return;
  }
  if (!picked.entry) return;

  const action = await vscode.window.showQuickPick<ActionPick>([
    ...(picked.entry.status === 'applied'
      ? [{ label: i18n.t('$(undo) Undo This Change'), action: 'undo' as const }]
      : []),
    { label: i18n.t('$(go-to-file) Reveal File'), action: 'reveal' as const },
    { label: i18n.t('$(copy) Copy Path'), action: 'copy' as const },
  ], {
    title: fileLabel(picked.entry),
    placeHolder: i18n.t('Choose an action'),
  });
  if (!action) return;
  if (action.action === 'undo') {
    await undoEntry(host, picked.entry);
  } else if (action.action === 'reveal') {
    await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(picked.entry.file));
  } else {
    await vscode.env.clipboard.writeText(picked.entry.file);
  }
}

export function registerAgentHistoryCommands(
  context: vscode.ExtensionContext,
  host: AgentHistoryCommandHost,
): vscode.Disposable[] {
  const disposables = [
    vscode.commands.registerCommand('codeblocks.agent.history', () => showAgentHistory(host)),
    vscode.commands.registerCommand('codeblocks.agent.undoLast', () => undoLastAgentChange(host)),
  ];
  context.subscriptions.push(...disposables);
  return disposables;
}
