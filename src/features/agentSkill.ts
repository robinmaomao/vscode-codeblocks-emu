/** Agent Skill 安装：把随扩展打包的 codeblocks-project 模板写到工作区或用户技能目录。 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as i18n from '../i18n';

export type AgentSkillTarget = 'workspace' | 'user';

export interface InstallAgentSkillOptions {
  extensionPath: string;
  target: AgentSkillTarget;
  workspaceRoot?: string;
  homeDir?: string;
  force?: boolean;
}

export interface InstallAgentSkillResult {
  path: string;
  existed: boolean;
  written: boolean;
}

export const AGENT_SKILL_NAME = 'codeblocks-project';

export function skillTemplatePath(extensionPath: string): string {
  return path.join(extensionPath, 'skills', AGENT_SKILL_NAME, 'SKILL.md');
}

export function skillTargetDir(target: AgentSkillTarget, workspaceRoot: string | undefined, homeDir = os.homedir()): string {
  if (target === 'workspace') {
    if (!workspaceRoot) throw new Error('A workspace folder is required to install the skill into the workspace');
    return path.join(workspaceRoot, '.github', 'skills', AGENT_SKILL_NAME);
  }
  return path.join(homeDir, '.copilot', 'skills', AGENT_SKILL_NAME);
}

/** 安装（或覆盖）技能文件；不负责交互确认。 */
export function installAgentSkill(opts: InstallAgentSkillOptions): InstallAgentSkillResult {
  const source = skillTemplatePath(opts.extensionPath);
  if (!fs.existsSync(source)) throw new Error(`Bundled skill template not found: ${source}`);
  const dir = skillTargetDir(opts.target, opts.workspaceRoot, opts.homeDir);
  const dest = path.join(dir, 'SKILL.md');
  const existed = fs.existsSync(dest);
  if (existed && !opts.force) return { path: dest, existed, written: false };
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(source, dest);
  return { path: dest, existed, written: true };
}

export function registerAgentSkillCommand(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.agent.installSkill', async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      type Pick = vscode.QuickPickItem & { target: AgentSkillTarget };
      const picks: Pick[] = [];
      if (workspaceRoot) {
        picks.push({
          label: i18n.t('Workspace'),
          description: path.join('.github', 'skills', AGENT_SKILL_NAME, 'SKILL.md'),
          target: 'workspace',
        });
      }
      picks.push({
        label: i18n.t('User profile'),
        description: path.join('~', '.copilot', 'skills', AGENT_SKILL_NAME, 'SKILL.md'),
        target: 'user',
      });
      const pick = await vscode.window.showQuickPick(picks, {
        title: i18n.t('Install Code::Blocks Agent Skill'),
        placeHolder: i18n.t('Choose where to install the skill'),
      });
      if (!pick) return;

      let result: InstallAgentSkillResult;
      try {
        result = installAgentSkill({
          extensionPath: context.extensionPath,
          target: pick.target,
          workspaceRoot,
          force: false,
        });
      } catch (e) {
        vscode.window.showErrorMessage(i18n.t('Failed to install Agent Skill: {0}', (e as Error).message));
        return;
      }
      if (result.existed && !result.written) {
        const overwrite = i18n.t('Overwrite');
        const answer = await vscode.window.showWarningMessage(
          i18n.t('An Agent Skill already exists at {0}. Overwrite it?', result.path),
          { modal: true },
          overwrite,
        );
        if (answer !== overwrite) return;
        try {
          result = installAgentSkill({
            extensionPath: context.extensionPath,
            target: pick.target,
            workspaceRoot,
            force: true,
          });
        } catch (e) {
          vscode.window.showErrorMessage(i18n.t('Failed to install Agent Skill: {0}', (e as Error).message));
          return;
        }
      }

      const open = i18n.t('Open');
      const answer = await vscode.window.showInformationMessage(
        i18n.t('Agent Skill installed: {0}', result.path),
        open,
      );
      if (answer === open) {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(result.path));
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    }),
  );
}
