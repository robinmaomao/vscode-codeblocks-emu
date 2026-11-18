/**
 * 状态栏菜单 —— Code::Blocks 菜单栏移植（渲染层）
 *
 * 在 VS Code 状态栏最左侧放置 `$(menu) Menu` 项；点击后弹出分级 QuickPick：
 * 第一级 = 9 个 CB 顶级菜单（Recent Files / Recent Projects / Workspace Build Order 收在 File 内）；
 * 第二级起 = 命令（支持子菜单下钻、面包屑标题、返回、分隔线、快捷键与可用性标注）。
 * 悬停就地展开常用命令链接（与菜单结构共用 menuStructure.ts 单一数据源）。
 * 菜单结构与对齐说明见 docs/guide/alignment.md「菜单对齐」章节。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { CHILD_ICONS, HOVER_GROUPS, MENU_STRUCTURE, MenuDef, MenuItemDef, findMenuItem } from './menuStructure';
import { MenuRenderContext, presentBackItem, presentMenuItem } from './menuPresentation';
import * as i18n from '../i18n';

/** 动态区数据（最近工程 / 工作区构建顺序 / 工程与调试状态 / 自定义工具） */
export interface MenuDynamicData {
  recents: { label: string; file: string; active?: boolean }[];
  order: { label: string; file: string; active?: boolean }[];
  hasProjects: boolean;
  /** 是否打开了 .workspace（Workspace Dependencies… 的可用条件） */
  hasWorkspace?: boolean;
  /** 是否存在活动调试会话（Debug 菜单项的可用条件） */
  hasDebugSession?: boolean;
  /** 工程树是否按文件类型分类（Categorize 项的状态图标） */
  categorize?: boolean;
  /** 用户自定义工具（codeblocks.tools；插到 Tools → Configure Tools… 之前，index = 设置数组下标） */
  tools: { label: string; index: number }[];
}

/** 第一级列表项 */
interface MenuPick extends vscode.QuickPickItem {
  menu: MenuDef;
}

/** 菜单层级列表项（def = 菜单数据；back = 返回上一级） */
interface LevelPick extends vscode.QuickPickItem {
  def?: MenuItemDef;
  back?: true;
}

/** 最近工程二级列表项（clear = 清空历史入口） */
interface RecentPick extends vscode.QuickPickItem {
  file: string;
  clear?: boolean;
  back?: true;
}

/** 工作区构建顺序列表项 */
interface WorkspacePick extends vscode.QuickPickItem {
  file: string;
  back?: true;
}

/** 悬停就地菜单：tooltip 中的可点击命令链接（label 引用 menuStructure，单一数据源） */
function buildHoverMenu(): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  const lines: string[] = [i18n.t('**Code::Blocks menu**')];
  for (const groupLabels of HOVER_GROUPS) {
    const links: string[] = [];
    for (const label of groupLabels) {
      const item = findMenuItem(label);
      if (!item?.command) continue;
      const icon = CHILD_ICONS[label];
      links.push(`[${icon ? `$(${icon}) ` : ''}${i18n.t(label)}](command:${item.command})`);
    }
    if (links.length) lines.push(links.join('　'));
  }
  lines.push(i18n.t('Click the status bar item to open the full menu (submenus + shortcuts)'));
  md.value = lines.join('\n\n');
  return md;
}

/**
 * 注册状态栏菜单：最左状态栏项 + 分级 QuickPick。
 *
 * 一级 = 9 个 CB 顶级菜单（Recent / Workspace 动态区已移入 File）；
 * 二级起 = 命令（子菜单继续下钻）；每个子层级第一项为「返回」。
 * @param getDynamic 按需拉取动态区数据（最近工程 / 构建顺序 / 工程与调试状态 / 自定义工具）
 */
export function registerStatusBarMenu(
  context: vscode.ExtensionContext,
  getDynamic: () => MenuDynamicData,
): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1000);
  item.text = '$(menu) Menu';
  item.tooltip = buildHoverMenu();
  item.command = 'codeblocks.menu.show';
  item.show();

  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.menu.show', async () => {
      const dyn = getDynamic();
      const firstLevel: MenuPick[] = MENU_STRUCTURE.map((menu) => ({
        label: i18n.t(menu.label),
        iconPath: new vscode.ThemeIcon(menu.icon),
        menu,
      }));

      // Back at the top-level menu (or a dynamic picker) re-opens the 9-menu list.
      let picked = await vscode.window.showQuickPick(firstLevel, {
        title: 'Code::Blocks',
        placeHolder: i18n.t('Code::Blocks menu — select a menu'),
        matchOnDescription: true,
        matchOnDetail: true,
      });
      while (picked) {
        const menu = picked.menu;
        const wantBack = await showMenuLevel(menu.children, [menu.label], dyn, menu.label === 'Tools' ? dyn.tools : undefined);
        if (!wantBack) return;
        picked = await vscode.window.showQuickPick(firstLevel, {
          title: 'Code::Blocks',
          placeHolder: i18n.t('Code::Blocks menu — select a menu'),
          matchOnDescription: true,
          matchOnDetail: true,
        });
      }
    }),
  );

  return item;
}

/** 渲染上下文（动态状态 → 标注） */
function renderContext(dyn: MenuDynamicData): MenuRenderContext {
  return {
    hasProjects: dyn.hasProjects,
    hasWorkspace: dyn.hasWorkspace === true,
    hasDebugSession: dyn.hasDebugSession === true,
  };
}

/** QuickPick 图标 → ThemeIcon（统一出口，避免各行自己拼） */
function themeIcon(id: string): vscode.ThemeIcon {
  return new vscode.ThemeIcon(id);
}

/** 菜单层级标题（面包屑） */
function levelTitle(pathLabels: string[]): string {
  return ['Code::Blocks', ...pathLabels.map((l) => i18n.t(l))].join(' › ');
}

/** 最近工程的展示路径（工作区内用相对路径，避免长绝对路径撑满列表） */
function projectLocation(file: string): string {
  try {
    const rel = vscode.workspace.asRelativePath(path.dirname(file), false);
    return rel && rel !== path.dirname(file) ? rel : path.dirname(file);
  } catch {
    return path.dirname(file);
  }
}

/** 最近工程二级列表：打开工程 + 清空历史（E1） */
async function showRecentPick(dyn: MenuDynamicData): Promise<boolean> {
  if (!dyn.recents.length) {
    vscode.window.showInformationMessage(i18n.t('No recent projects'));
    return false;
  }
  const items: RecentPick[] = [
    { label: i18n.t('Back'), description: i18n.t('File'), iconPath: themeIcon('arrow-left'), file: '', back: true },
    { label: '', kind: vscode.QuickPickItemKind.Separator, file: '' },
    ...dyn.recents.map((r) => ({
      label: r.label,
      description: r.active ? `${i18n.t('Active project')} · ${projectLocation(r.file)}` : projectLocation(r.file),
      iconPath: themeIcon(r.active ? 'check' : 'file-code'),
      file: r.file,
    })),
  ];
  items.push(
    { label: '', kind: vscode.QuickPickItemKind.Separator, file: '' },
    { label: i18n.t('Clear Recent Projects'), description: i18n.t('Clear the recent projects list'), iconPath: themeIcon('trash'), file: '', clear: true },
  );
  const sel = await vscode.window.showQuickPick(items, {
    title: levelTitle(['File', 'Recent Projects']),
    placeHolder: i18n.t('Recent Projects — open a project'),
  });
  if (!sel || sel.back) return false;
  if (sel.clear) {
    await vscode.commands.executeCommand('codeblocks.clearRecentProjects');
    return true;
  }
  await vscode.commands.executeCommand('codeblocks.openRecentProject', sel.file);
  return true;
}

/** 工作区二级列表：设为活动项目（E2） */
async function showWorkspacePick(dyn: MenuDynamicData): Promise<boolean> {
  if (!dyn.order.length) {
    vscode.window.showInformationMessage(i18n.t('No open projects'));
    return false;
  }
  const items: WorkspacePick[] = [
    { label: i18n.t('Back'), description: i18n.t('File'), iconPath: themeIcon('arrow-left'), file: '', back: true },
    { label: '', kind: vscode.QuickPickItemKind.Separator, file: '' },
    ...dyn.order.map((o) => ({
      label: o.label,
      description: o.active ? i18n.t('Active project') : i18n.t('Set as active project'),
      iconPath: themeIcon(o.active ? 'check' : 'project'),
      file: o.file,
    })),
  ];
  const sel = await vscode.window.showQuickPick(items, {
    title: levelTitle(['File', 'Workspace Build Order']),
    placeHolder: i18n.t('Workspace — set the active project'),
  });
  if (!sel || sel.back) return false;
  await vscode.commands.executeCommand('codeblocks.setActiveProject', sel.file);
  return true;
}

/** 把 Tools 自定义工具插到 Configure Tools… 之前（对齐 CB ToolsManager） */
function injectCustomTools(items: LevelPick[], children: MenuItemDef[], tools: MenuDynamicData['tools']): LevelPick[] {
  if (!tools.length) return items;
  const configureIndex = children.findIndex((c) => c.label === 'Configure Tools…');
  const insertAt = configureIndex >= 0 ? configureIndex : items.length;
  const toolItems: LevelPick[] = tools.map((tool) => ({
    label: tool.label,
    iconPath: themeIcon('play'),
    def: { label: tool.label, command: 'codeblocks.runTool', args: [tool.index] },
  }));
  const block: LevelPick[] = [
    ...toolItems,
    { label: '', kind: vscode.QuickPickItemKind.Separator },
  ];
  return [...items.slice(0, insertAt), ...block, ...items.slice(insertAt)];
}

/**
 * 菜单层级渲染：叶子项执行命令，子菜单/动态区继续下钻；第一项固定为「返回」。
 * @returns true = 用户选择返回上一级；false = 已执行命令或取消（关闭全部菜单）
 */
async function showMenuLevel(
  children: MenuItemDef[],
  pathLabels: string[],
  dyn: MenuDynamicData,
  dynamicTools?: MenuDynamicData['tools'],
): Promise<boolean> {
  const ctx = renderContext(dyn);
  const parentLabel = pathLabels.length > 1 ? pathLabels[pathLabels.length - 2] : '';
  const currentLabel = pathLabels[pathLabels.length - 1];

  while (true) {
    let items: LevelPick[] = [];
    for (const c of children) {
      if (c.separator) {
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        continue;
      }
      const p = presentMenuItem(c, ctx, i18n.t);
      // Categorize 是 CB 的复选项：用图标表达开/关状态
      const icon = c.label === 'Categorize by File Types' && dyn.categorize ? 'check' : p.icon;
      items.push({ label: p.label, description: p.description, iconPath: themeIcon(icon), def: c });
    }
    if (dynamicTools?.length && currentLabel === 'Tools') {
      items = injectCustomTools(items, children, dynamicTools);
    }
    const back = presentBackItem(parentLabel, i18n.t);
    items = [
      { label: back.label, description: back.description, iconPath: themeIcon(back.icon), back: true },
      { label: '', kind: vscode.QuickPickItemKind.Separator },
      ...items,
    ];

    const sel = await vscode.window.showQuickPick(items, {
      title: levelTitle(pathLabels),
      placeHolder: i18n.t('{0} — select a command', i18n.t(currentLabel)),
      matchOnDescription: true,
      matchOnDetail: true,
    });
    if (!sel) return false;
    if (sel.back) return true;

    const def = sel.def;
    if (!def) continue;

    // 动态区：最近工程 / 构建顺序（选择后关闭菜单；取消则回到当前菜单）
    if (def.dynamic === 'recents') {
      if (await showRecentPick(dyn)) return false;
      continue;
    }
    if (def.dynamic === 'workspace') {
      if (await showWorkspacePick(dyn)) return false;
      continue;
    }

    if (!def.command) {
      if (def.children?.length) {
        const wantBack = await showMenuLevel(def.children, [...pathLabels, def.label], dyn);
        if (wantBack) continue;
      }
      return false;
    }

    try {
      await vscode.commands.executeCommand(def.command, ...(def.args ?? []));
    } catch (err) {
      const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
      vscode.window.showWarningMessage(i18n.t('Command failed: {0}{1}', def.command, detail));
    }
    return false;
  }
}
