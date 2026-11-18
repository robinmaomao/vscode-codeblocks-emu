/**
 * File → New 子命令（Build Target… / File…）—— P3-1 第三批拆分。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as i18n from '../i18n';
import { logT } from '../build/logLang';
import { Project, TargetType } from '../model/types';
import { makeTarget } from '../project/newProject';
import { buildUnitXmlForTargets } from '../project/recursiveAdd';
import { writeFileAtomicSync } from '../model/atomicWrite';

export interface NewProjectCommandDeps {
  getOpenProjects(): Project[];
  requireProject(): Project | undefined;
  persistProjectAndReload(project: Project): Promise<void>;
  setActiveProject(project: Project): void;
  setSelectedTarget(project: Project, title: string): void;
  writeUnitsToCbp(cbpPath: string, units: string[]): void;
  reloadProjectFromDisk(filename: string): Promise<boolean>;
  output: { info(line: string): void };
}

function norm(file: string): string {
  const abs = path.resolve(file).replace(/\\/g, '/');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/** 目标名校验（对齐 CB ProjectOptionsDlg::ValidateTargetName 的服务端等价实现） */
export function validateBuildTargetName(project: Project, name: string, exceptTitle?: string): string | undefined {
  const value = name.trim();
  if (!value) return i18n.t('The target name must not be empty');
  if (value !== exceptTitle && (project.buildTargets.some((t) => t.title === value) || project.virtualTargets.some((v) => v.title === value))) {
    return i18n.t('A target with this name already exists');
  }
  if (/[;,!@#$%^&*"'~=?\\><`]/.test(value)) {
    return i18n.t('The target name contains an invalid character (; , ! @ # $ % ^ & * " \' ~ = ? \\ > < `)');
  }
  return undefined;
}

/** File → New → Build Target…（对齐 CB main_menu.xrc idFileNewTarget） */
export async function newBuildTarget(deps: NewProjectCommandDeps): Promise<void> {
  const project = deps.requireProject();
  if (!project) return;
  const title = await vscode.window.showInputBox({
    prompt: i18n.t('New build target name'),
    value: '',
    validateInput: (v) => validateBuildTargetName(project, v),
  });
  if (title === undefined || !title.trim()) return;

  const types: Array<{ label: string; description: string; type: TargetType }> = [
    { label: i18n.t('GUI application'), description: 'ttExecutable', type: TargetType.Executable },
    { label: i18n.t('Console application'), description: 'ttConsoleOnly', type: TargetType.ConsoleOnly },
    { label: i18n.t('Static library'), description: 'ttStaticLib', type: TargetType.StaticLib },
    { label: i18n.t('Dynamic library'), description: 'ttDynamicLib', type: TargetType.DynamicLib },
    { label: i18n.t('Commands only'), description: 'ttCommandsOnly', type: TargetType.CommandsOnly },
  ];
  const pick = await vscode.window.showQuickPick(types, {
    placeHolder: i18n.t('Build target type'),
    matchOnDescription: true,
  });
  if (!pick) return;

  try {
    const target = makeTarget(project.title, title.trim(), pick.type, [], project.compilerId || 'gcc');
    project.buildTargets.push(target);
    await deps.persistProjectAndReload(project);
    const reloaded = deps.getOpenProjects().find((p) => norm(p.filename) === norm(project.filename));
    if (reloaded) {
      deps.setSelectedTarget(reloaded, title.trim());
      deps.setActiveProject(reloaded);
    }
    deps.output.info(logT('[Code::Blocks] Build target added: {0} ({1})', title.trim(), pick.description));
    vscode.window.showInformationMessage(i18n.t('Build target "{0}" created', title.trim()));
  } catch (err) {
    vscode.window.showErrorMessage(i18n.t('Failed to create the build target: {0}', (err as Error).message));
  }
}

/** File → New → File…（对齐 CB main_menu.xrc idFileNewFile 的轻量模板入口） */
export async function newProjectFile(deps: NewProjectCommandDeps): Promise<void> {
  const project = deps.requireProject();
  if (!project) return;
  const rel = await vscode.window.showInputBox({
    prompt: i18n.t('New file path (relative to the project directory)'),
    value: 'main.c',
    validateInput: (v) => {
      const value = v.trim().replace(/\\/g, '/');
      if (!value) return i18n.t('The file path must not be empty');
      if (path.isAbsolute(value) || value.startsWith('../') || value.includes('/../') || value === '..') {
        return i18n.t('The file path must stay inside the project directory');
      }
      if (project.files.some((f) => f.relativeFilename.replace(/\\/g, '/').toLowerCase() === value.toLowerCase())) {
        return i18n.t('This file is already part of the project');
      }
      return undefined;
    },
  });
  if (rel === undefined || !rel.trim()) return;
  const relative = rel.trim().replace(/\\/g, '/').replace(/^\.\//, '');

  const templates: Array<{ label: string; description: string; content: string }> = [
    { label: i18n.t('C source'), description: '.c', content: '#include <stdio.h>\n\nint main(void)\n{\n    printf("Hello, world!\\n");\n    return 0;\n}\n' },
    { label: i18n.t('C++ source'), description: '.cpp', content: '#include <iostream>\n\nint main()\n{\n    std::cout << "Hello, world!" << std::endl;\n    return 0;\n}\n' },
    { label: i18n.t('Header file'), description: '.h', content: '#pragma once\n\n' },
    { label: i18n.t('Empty file'), description: '', content: '' },
  ];
  const pick = await vscode.window.showQuickPick(templates, { placeHolder: i18n.t('File template') });
  if (!pick) return;

  const abs = path.join(project.basePath, relative);
  if (fs.existsSync(abs)) {
    const overwrite = await vscode.window.showWarningMessage(
      i18n.t('"{0}" already exists. Overwrite it?', relative),
      { modal: true },
      i18n.t('Overwrite'),
    );
    if (overwrite !== i18n.t('Overwrite')) return;
  }
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    writeFileAtomicSync(abs, pick.content, 'utf-8');
    const unit = buildUnitXmlForTargets(relative, path.extname(relative).toLowerCase(), null);
    deps.writeUnitsToCbp(project.filename, [unit]);
    await deps.reloadProjectFromDisk(project.filename);
    await vscode.window.showTextDocument(vscode.Uri.file(abs), { preview: false });
    deps.output.info(logT('[Code::Blocks] File created and added to the project: {0}', relative));
  } catch (err) {
    vscode.window.showErrorMessage(i18n.t('Failed to create the file: {0}', (err as Error).message));
  }
}

/** 注册 New Build Target / New File 命令 */
export function registerNewProjectCommands(context: vscode.ExtensionContext, deps: NewProjectCommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.newBuildTarget', () => newBuildTarget(deps)),
    vscode.commands.registerCommand('codeblocks.newFile', () => newProjectFile(deps)),
  );
}
