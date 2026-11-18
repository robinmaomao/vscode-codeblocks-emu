/**
 * 项目管理 QuickPick —— 从 extension.ts 拆出的项目切换/打开/新建/检测入口。
 *
 * 共享状态通过 `ProjectManagerDeps` 注入，避免 feature 直接 import extension.ts。
 */
import * as path from 'path';
import * as vscode from 'vscode';
import type { Project } from '../model/types';
import * as i18n from '../i18n';

export interface ProjectManagerDeps {
  getOpenProjects(): Project[];
  getActiveProject(): Project | undefined;
  setActiveProject(project: Project | undefined): void;
  removeProject(filename: string): void;
  scanWorkspaceProjects(): Promise<void>;
}

export interface ProjectManagerItem extends vscode.QuickPickItem {
  action?: 'open' | 'new' | 'scan';
  filename?: string;
}

/** 构建项目管理菜单项：打开 / 新建 / 检测工作区项目 + 已打开项目（活动标记 + 移除按钮） */
export function buildManagerItems(deps: ProjectManagerDeps): ProjectManagerItem[] {
  const openProjects = deps.getOpenProjects();
  const activeProject = deps.getActiveProject();
  const items: ProjectManagerItem[] = [
    { label: i18n.t('$(folder-opened) Open Project...'), description: i18n.t('Open .cbp / .workspace'), action: 'open' },
    { label: i18n.t('$(new-file) New Project...'), description: i18n.t('Create a Code::Blocks project from a template'), action: 'new' },
    { label: i18n.t('$(search) Detect workspace projects...'), description: i18n.t('Scan for and open .cbp / .workspace files in the workspace'), action: 'scan' },
  ];
  if (openProjects.length > 0) {
    items.push({ label: i18n.t('Projects opened'), kind: vscode.QuickPickItemKind.Separator });
    for (const p of openProjects) {
      const isActive = p.filename === activeProject?.filename;
      items.push({
        label: `${isActive ? '$(circle-filled)' : '$(circle-outline)'} ${p.title || path.basename(p.filename, '.cbp')}`,
        description: `${path.basename(path.dirname(p.filename))}${isActive ? i18n.t(' · Active') : ''}`,
        detail: p.filename,
        filename: p.filename,
        buttons: [{ iconPath: new vscode.ThemeIcon('close'), tooltip: i18n.t('Remove the project from the sidebar') }],
      });
    }
  }
  return items;
}

/** 项目管理菜单：打开 / 新建 / 检测工作区项目，下方内联已打开项目（选中即切换活动工程，按钮移除，菜单保持打开） */
export async function showProjectManager(deps: ProjectManagerDeps): Promise<void> {
  const qp = vscode.window.createQuickPick<ProjectManagerItem>();
  qp.title = 'Code::Blocks';
  qp.placeholder = i18n.t('Select an action, or click an opened project to switch the active one');
  qp.matchOnDescription = true;
  qp.items = buildManagerItems(deps);

  const findProject = (filename: string): Project | undefined =>
    deps.getOpenProjects().find((p) => p.filename === filename);

  qp.onDidChangeSelection((sel) => {
    const item = sel[0];
    if (item?.filename) {
      const project = findProject(item.filename);
      if (project) deps.setActiveProject(project);
    }
  });

  qp.onDidAccept(async () => {
    const item = qp.selectedItems[0];
    if (!item) {
      qp.hide();
      return;
    }
    if (item.action === 'open') {
      qp.hide();
      await vscode.commands.executeCommand('codeblocks.openProject');
    } else if (item.action === 'new') {
      qp.hide();
      await vscode.commands.executeCommand('codeblocks.newProject');
    } else if (item.action === 'scan') {
      qp.hide();
      await deps.scanWorkspaceProjects();
    } else if (item.filename) {
      const project = findProject(item.filename);
      if (project) deps.setActiveProject(project);
      qp.hide();
    }
  });

  qp.onDidTriggerItemButton((e) => {
    if (e.item.filename) {
      deps.removeProject(e.item.filename);
      qp.items = buildManagerItems(deps);
    }
  });

  qp.onDidHide(() => qp.dispose());
  qp.show();
}
