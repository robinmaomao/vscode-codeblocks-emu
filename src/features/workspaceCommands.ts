/**
 * File / Workspace 生命周期命令（P3-1 第二批拆分）。
 *
 * 依赖通过 `WorkspaceCommandDeps` 注入，避免直接引用 extension.ts 的模块级状态，
 * 便于后续把工程管理器继续拆成独立模块。
 */
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as i18n from '../i18n';
import { logT } from '../build/logLang';
import { Project } from '../model/types';
import { WorkspaceParser } from '../model/parser';
import { serializeProject } from '../model/projectWriter';
import { buildWorkspaceEntries, serializeWorkspace } from '../model/workspaceSerializer';
import { writeFileAtomicSync } from '../model/atomicWrite';
import { ProjectChangeTracker } from '../project/projectChangeTracker';

export interface WorkspaceCommandDeps {
  getOpenProjects(): Project[];
  setOpenProjects(projects: Project[]): void;
  getActiveProject(): Project | undefined;
  setActiveProject(project: Project | undefined): void;
  getOpenedWorkspaceFile(): string | undefined;
  setOpenedWorkspaceFile(file: string | undefined): void;
  getWorkspaceDeps(): Record<string, string[]>;
  setWorkspaceDeps(deps: Record<string, string[]>): void;
  getSelectedTarget(project: Project): string | undefined;
  setSelectedTarget(project: Project, title: string): void;
  forgetSelectedTarget(filename: string): void;
  clearSelectedTargets(): void;
  persistSelectedTargets(): void;
  getRecentProjects(): string[];
  setRecentProjects(list: string[]): void;
  recordRecentProject(file: string): void;
  requireProject(): Project | undefined;
  saveProjectToDisk(filename: string): Promise<void>;
  openProject(filename: string): Promise<void>;
  closePanels(project: Project): void;
  refreshProjectUi(): void;
  persistProjectOrder(): void;
  clearWorkspaceState(): void;
  projectChangeTracker: ProjectChangeTracker;
  workspaceChangeTracker: ProjectChangeTracker;
  output: { info(line: string): void; warn(line: string): void; error(line: string): void };
}

function norm(file: string): string {
  const abs = path.resolve(file).replace(/\\/g, '/');
  return process.platform === 'win32' ? abs.toLowerCase() : abs;
}

/** 最近工程列表里把旧路径替换为新路径（另存工程后避免重复项） */
function replaceRecentProject(deps: WorkspaceCommandDeps, oldFile: string, newFile: string): void {
  const next = deps.getRecentProjects().map((f) => (norm(f) === norm(oldFile) ? newFile : f));
  deps.setRecentProjects(next);
  deps.recordRecentProject(newFile);
}

/** 另存工程后同步工作区依赖图（内存；磁盘上的 .workspace 需 Save Workspace 才写回） */
function remapWorkspaceAfterProjectSaveAs(deps: WorkspaceCommandDeps, oldFile: string, newFile: string): void {
  if (!deps.getOpenedWorkspaceFile()) return;
  const oldKey = norm(oldFile);
  const next: Record<string, string[]> = {};
  for (const [proj, list] of Object.entries(deps.getWorkspaceDeps())) {
    const key = norm(proj) === oldKey ? newFile : proj;
    next[key] = list
      .map((d) => (norm(d) === oldKey ? newFile : d))
      .filter((d) => norm(d) !== norm(key));
  }
  deps.setWorkspaceDeps(next);
}

/** 默认工作区路径（对齐 CB ConfigManager::GetConfigFolder()/default.workspace） */
export function defaultWorkspacePath(): string {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) return path.join(appData, 'CodeBlocks', 'default.workspace');
  }
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '', '.codeblocks', 'default.workspace');
}

/** 另存工程（File → Save Project As…） */
export async function saveProjectAs(deps: WorkspaceCommandDeps): Promise<void> {
  const project = deps.requireProject();
  if (!project) return;
  const save = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.file(path.join(project.basePath, path.basename(project.filename))),
    filters: { [i18n.t('Code::Blocks project')]: ['cbp'], [i18n.t('All files')]: ['*'] },
    saveLabel: i18n.t('Save Project As'),
    title: i18n.t('Save Project As'),
  });
  if (!save) return;
  const target = /\.cbp$/i.test(save.fsPath) ? save.fsPath : `${save.fsPath}.cbp`;
  if (norm(target) === norm(project.filename)) {
    await deps.saveProjectToDisk(project.filename);
    return;
  }
  if (deps.getOpenProjects().some((p) => norm(p.filename) === norm(target))) {
    vscode.window.showErrorMessage(i18n.t('Another open project already uses this file: {0}', target));
    return;
  }
  if (fs.existsSync(target)) {
    const overwrite = await vscode.window.showWarningMessage(
      i18n.t('"{0}" already exists. Overwrite it?', path.basename(target)),
      { modal: true },
      i18n.t('Overwrite'),
    );
    if (overwrite !== i18n.t('Overwrite')) return;
  }

  const oldFilename = project.filename;
  const oldIndex = deps.getOpenProjects().findIndex((p) => norm(p.filename) === norm(oldFilename));
  const previousTarget = deps.getSelectedTarget(project);
  const wasActive = norm(deps.getActiveProject()?.filename ?? '') === norm(oldFilename);
  try {
    const exported: Project = { ...project, filename: target, basePath: path.dirname(target) };
    writeFileAtomicSync(target, serializeProject(exported), 'utf-8');
    deps.closePanels(project);
    deps.projectChangeTracker.forget(oldFilename);
    deps.setOpenProjects(deps.getOpenProjects().filter((p) => norm(p.filename) !== norm(oldFilename)));
    await deps.openProject(target);
    const opened = deps.getOpenProjects().find((p) => norm(p.filename) === norm(target));
    if (!opened) throw new Error(i18n.t('Failed to open the saved project: {0}', target));
    const projects = deps.getOpenProjects();
    if (oldIndex >= 0 && projects[projects.length - 1]?.filename === opened.filename) {
      projects.pop();
      projects.splice(Math.min(oldIndex, projects.length), 0, opened);
    }
    deps.forgetSelectedTarget(oldFilename);
    if (previousTarget) deps.setSelectedTarget(opened, previousTarget);
    if (wasActive) deps.setActiveProject(opened);
    replaceRecentProject(deps, oldFilename, target);
    remapWorkspaceAfterProjectSaveAs(deps, oldFilename, target);
    deps.refreshProjectUi();
    deps.output.info(logT('[Code::Blocks] Project saved as: {0}', target));
    vscode.window.showInformationMessage(i18n.t('Project saved as: {0}', path.basename(target)));
  } catch (err) {
    vscode.window.showErrorMessage(i18n.t('Failed to save the project as: {0}', (err as Error).message));
  }
}

/** 保存工作区（File → Save workspace / Save workspace as…） */
export async function saveWorkspace(deps: WorkspaceCommandDeps, saveAs = false): Promise<void> {
  const projects = deps.getOpenProjects();
  if (!projects.length) {
    vscode.window.showWarningMessage(i18n.t('No open projects — open or create a project first'));
    return;
  }
  let file = saveAs ? undefined : deps.getOpenedWorkspaceFile();
  if (!file) {
    const base = deps.getOpenedWorkspaceFile() ? path.dirname(deps.getOpenedWorkspaceFile()!) : projects[0].basePath;
    const defaultName = deps.getOpenedWorkspaceFile()
      ? path.basename(deps.getOpenedWorkspaceFile()!)
      : `${projects[0].title}.workspace`;
    const save = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(base, defaultName)),
      filters: { [i18n.t('Code::Blocks workspace')]: ['workspace'], [i18n.t('All files')]: ['*'] },
      saveLabel: i18n.t('Save Workspace'),
      title: saveAs ? i18n.t('Save Workspace As') : i18n.t('Save Workspace'),
    });
    if (!save) return;
    file = /\.workspace$/i.test(save.fsPath) ? save.fsPath : `${save.fsPath}.workspace`;
  }

  let title = path.basename(file, '.workspace');
  const opened = deps.getOpenedWorkspaceFile();
  if (!saveAs && opened) {
    try {
      title = new WorkspaceParser().parse(opened).title || title;
    } catch {
      /* 解析失败时用文件名作为标题 */
    }
  }
  try {
    const base = path.dirname(file);
    const entries = buildWorkspaceEntries(base, projects, deps.getWorkspaceDeps(), deps.getActiveProject()?.filename);
    writeFileAtomicSync(file, serializeWorkspace(title, entries), 'utf-8');
    deps.setOpenedWorkspaceFile(file);
    deps.workspaceChangeTracker.remember(file);
    deps.refreshProjectUi();
    deps.output.info(logT('[Code::Blocks] Workspace saved: {0} ({1} project(s))', file, entries.length));
    vscode.window.showInformationMessage(i18n.t('Workspace saved: {0}', path.basename(file)));
  } catch (err) {
    vscode.window.showErrorMessage(i18n.t('Failed to save the workspace: {0}', (err as Error).message));
  }
}

/** 关闭工作区（关闭全部工程，磁盘文件保留） */
export async function closeWorkspace(deps: WorkspaceCommandDeps): Promise<void> {
  const file = deps.getOpenedWorkspaceFile();
  if (!file) {
    vscode.window.showWarningMessage(i18n.t('No workspace is open'));
    return;
  }
  const close = i18n.t('Close Workspace');
  const answer = await vscode.window.showWarningMessage(
    i18n.t('Close workspace "{0}" and all projects? (files on disk are kept)', path.basename(file)),
    { modal: true },
    close,
  );
  if (answer !== close) return;
  for (const p of [...deps.getOpenProjects()]) {
    deps.closePanels(p);
    deps.projectChangeTracker.forget(p.filename);
  }
  deps.setOpenProjects([]);
  deps.setActiveProject(undefined);
  deps.clearSelectedTargets();
  deps.persistSelectedTargets();
  deps.clearWorkspaceState();
  deps.persistProjectOrder();
  deps.refreshProjectUi();
  deps.output.info(logT('[Code::Blocks] Workspace closed'));
}

/** 打开默认工作区；不存在时按 CB 语义提供创建入口 */
export async function openDefaultWorkspace(deps: WorkspaceCommandDeps): Promise<void> {
  const file = defaultWorkspacePath();
  if (!fs.existsSync(file)) {
    const create = i18n.t('Create');
    const answer = await vscode.window.showWarningMessage(
      i18n.t('Default workspace not found: {0}', file),
      { modal: true },
      create,
    );
    if (answer !== create) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      writeFileAtomicSync(file, serializeWorkspace('Default workspace', []), 'utf-8');
    } catch (err) {
      vscode.window.showErrorMessage(i18n.t('Failed to create the default workspace: {0}', (err as Error).message));
      return;
    }
  }
  await deps.openProject(file);
  vscode.window.showInformationMessage(i18n.t('Default workspace opened: {0}', file));
}

/** 注册 File / Workspace 生命周期命令 */
export function registerWorkspaceCommands(context: vscode.ExtensionContext, deps: WorkspaceCommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.saveProjectAs', () => saveProjectAs(deps)),
    vscode.commands.registerCommand('codeblocks.saveWorkspace', () => saveWorkspace(deps, false)),
    vscode.commands.registerCommand('codeblocks.saveWorkspaceAs', () => saveWorkspace(deps, true)),
    vscode.commands.registerCommand('codeblocks.closeWorkspace', () => closeWorkspace(deps)),
    vscode.commands.registerCommand('codeblocks.openDefaultWorkspace', () => openDefaultWorkspace(deps)),
  );
}
