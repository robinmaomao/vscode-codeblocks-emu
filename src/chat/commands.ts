/** @codeblocks Chat participant 的确定性命令解析（无 vscode 依赖，便于单测）。 */

export type ParticipantCommand = 'read' | 'build' | 'fix' | 'debug' | 'status' | 'history' | 'undo' | 'help';

export interface ParticipantPlan {
  kind: 'tool' | 'status' | 'history' | 'undo' | 'help' | 'error';
  tool?: string;
  input?: Record<string, unknown>;
  message?: string;
}

const DEBUG_ACTIONS = new Set(['state', 'stack', 'variables', 'stop', 'continue', 'step']);

function words(prompt: string): string[] {
  return prompt.trim().split(/\s+/).filter(Boolean);
}

function buildPlan(prompt: string): ParticipantPlan {
  const args = words(prompt);
  let mode: 'build' | 'rebuild' | 'clean' = 'build';
  const targetParts: string[] = [];
  for (const arg of args) {
    if (arg === '--rebuild' || arg === '-r') mode = 'rebuild';
    else if (arg === '--clean' || arg === '-c') mode = 'clean';
    else targetParts.push(arg);
  }
  const target = targetParts.join(' ').trim();
  return {
    kind: 'tool',
    tool: 'codeblocks_build',
    input: { mode, ...(target ? { target } : {}) },
  };
}

function debugPlan(prompt: string): ParticipantPlan {
  const [action = 'state', ...rest] = words(prompt);
  if (!DEBUG_ACTIONS.has(action)) {
    return {
      kind: 'error',
      message: `Unknown /debug action: ${action}. Use state, stack, variables, stop, continue or step.`,
    };
  }
  if (action === 'step') {
    const kind = rest[0] === 'in' ? 'stepIn' : rest[0] === 'out' ? 'stepOut' : 'next';
    return { kind: 'tool', tool: 'codeblocks_debug', input: { action: 'step', kind } };
  }
  return { kind: 'tool', tool: 'codeblocks_debug', input: { action } };
}

export function planParticipantCommand(command: string | undefined, prompt: string): ParticipantPlan {
  switch (command) {
    case 'read': {
      const target = prompt.trim();
      return {
        kind: 'tool',
        tool: 'codeblocks_project_read',
        input: { section: 'summary', ...(target ? { target } : {}) },
      };
    }
    case 'build':
      return buildPlan(prompt);
    case 'fix':
      return { kind: 'tool', tool: 'codeblocks_build_status', input: { severity: 'error' } };
    case 'debug':
      return debugPlan(prompt);
    case 'status':
      return { kind: 'status' };
    case 'history':
      return { kind: 'history' };
    case 'undo':
      return { kind: 'undo' };
    case 'help':
    case undefined:
      return { kind: 'help' };
    default:
      return { kind: 'error', message: `Unknown command: /${command}` };
  }
}
