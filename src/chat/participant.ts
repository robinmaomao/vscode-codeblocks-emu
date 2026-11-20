/** @codeblocks Chat participant：确定性命令包装，不替代 Agent 模式的自主工具调用。 */
import * as vscode from 'vscode';
import * as i18n from '../i18n';
import { asControlError } from '../api/types';
import { invokeTool, ToolContext } from '../api/toolRegistry';
import { planParticipantCommand } from './commands';

export interface CodeblocksParticipantOptions {
  getContext: () => ToolContext | undefined;
  getStatus: () => string;
  log?: (line: string) => void;
}

function render(value: unknown): string {
  try {
    return '```json\n' + JSON.stringify(value, null, 2) + '\n```';
  } catch {
    return String(value);
  }
}

const HELP = [
  '**Code::Blocks participant**',
  '',
  '- `/read [target]` — read the active project summary (optionally filtered by target).',
  '- `/build [target] [--rebuild|--clean]` — build, rebuild or clean a target.',
  '- `/fix` — show structured errors from the latest build.',
  '- `/debug [state|stack|variables|stop|continue|step [in|out]]` — inspect or control the debug session.',
  '- `/status` — show Agent control status and bundled paths.',
  '- `/help` — show this help.',
  '',
  'For autonomous edits, use **Agent** mode and let Copilot call the `codeblocks_*` tools.',
].join('\n');

export function registerCodeblocksChatParticipant(
  context: vscode.ExtensionContext,
  opts: CodeblocksParticipantOptions,
): vscode.Disposable | undefined {
  if (typeof vscode.chat?.createChatParticipant !== 'function') return undefined;
  const participant = vscode.chat.createChatParticipant('codeblocks.agent', async (request, _chatContext, response, token) => {
    const plan = planParticipantCommand(request.command, request.prompt);
    if (plan.kind === 'help') {
      response.markdown(HELP);
      return;
    }
    if (plan.kind === 'error') {
      response.markdown(plan.message ?? i18n.t('Unknown command'));
      return;
    }
    if (plan.kind === 'status') {
      response.markdown(opts.getStatus());
      return;
    }
    const toolContext = opts.getContext();
    if (!toolContext) {
      response.markdown(i18n.t('Agent control is disabled. Enable codeblocks.agent.enabled and trust the workspace.'));
      return;
    }
    if (token.isCancellationRequested) return;
    try {
      const value = await invokeTool(toolContext, plan.tool!, plan.input ?? {});
      opts.log?.(`[agent] participant ${request.command ?? 'help'} -> ${plan.tool} ok`);
      response.markdown(render(value));
    } catch (err) {
      const e = asControlError(err);
      opts.log?.(`[agent] participant ${request.command ?? 'help'} -> ${plan.tool} failed code=${e.code}`);
      response.markdown(render({ ok: false, error: { code: e.code, message: e.message, details: e.details } }));
    }
  });
  context.subscriptions.push(participant);
  return participant;
}
