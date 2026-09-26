/**
 * 状态栏菜单 —— Code::Blocks 菜单栏移植（渲染层）
 *
 * 在 VS Code 状态栏最左侧放置 `$(menu) Menu` 项；点击后弹出两级/三级 QuickPick：
 * 第一级 = Workspace（构建顺序）/ Recent Projects（可清除历史）/ 9 个顶级菜单；
 * 第二级起 = 命令（支持子菜单下钻、分隔线、快捷键与「（无工程）」标注）。
 * 悬停就地展开常用命令链接（与菜单结构共用 menuStructure.ts 单一数据源）。
 * 菜单结构与对齐说明见 docs/对齐对照.md「菜单对齐」章节。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { CHILD_ICONS, HOVER_GROUPS, MENU_STRUCTURE, MenuDef, MenuItemDef, findMenuItem } from './menuStructure';

/** 动态区数据（最近工程 / 工作区构建顺序 / 是否已打开工程） */
export interface MenuDynamicData {
  recents: { label: string; file: string }[];
  order: { label: string; file: string }[];
  hasProjects: boolean;
}



/** 第一级列表项 */
interface MenuPick extends vscode.QuickPickItem {
  kindTag: 'menu' | 'recent' | 'workspace';
  menu?: MenuDef;
}

/** 最近工程二级列表项（clear = 清空历史入口） */
interface RecentPick extends vscode.QuickPickItem {
  file: string;
  clear?: boolean;
}

/** 悬停就地菜单：tooltip 中的可点击命令链接（label 引用 menuStructure，单一数据源） */
function buildHoverMenu(): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  const lines: string[] = ['**Code::Blocks 菜单**'];
  for (const groupLabels of HOVER_GROUPS) {
    const links: string[] = [];
    for (const label of groupLabels) {
      const item = findMenuItem(label);
      if (!item?.command) continue;
      const icon = CHILD_ICONS[label];
      links.push(`[${icon ? `$(${icon}) ` : ''}${label}](command:${item.command})`);
    }
    if (links.length) lines.push(links.join('　'));
  }
  lines.push('点击状态栏项打开完整菜单（子菜单 + 快捷键）');
  md.value = lines.join('\n\n');
  return md;
}

/**
 * 注册状态栏菜单：最左状态栏项 + 两级/三级 QuickPick。
 * @param getDynamic 按需拉取动态区数据（最近工程 / 工作区构建顺序 / 是否已打开工程）
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

      // 第一级：菜单 / 动态入口
      const firstLevel: MenuPick[] = [];
      if (dyn.order.length) {
        firstLevel.push({
          label: 'Workspace',
          kindTag: 'workspace',
          description: '构建顺序',
          iconPath: new vscode.ThemeIcon('layers'),
        });
      }
      if (dyn.recents.length) {
        firstLevel.push({
          label: 'Recent Projects',
          kindTag: 'recent',
          description: `${dyn.recents.length} 个`,
          iconPath: new vscode.ThemeIcon('history'),
        });
      }
      for (const m of MENU_STRUCTURE) {
        firstLevel.push({
          label: m.label,
          kindTag: 'menu',
          menu: m,
          iconPath: m.icon ? new vscode.ThemeIcon(m.icon) : undefined,
        });
      }

      const picked = await vscode.window.showQuickPick(firstLevel, {
        placeHolder: 'Code::Blocks 菜单 — 选择菜单',
      });
      if (!picked) return;

      // 第二级：动态区
      if (picked.kindTag === 'recent') {
        await showRecentPick(dyn);
        return;
      }
      if (picked.kindTag === 'workspace') {
        await showWorkspacePick(dyn);
        return;
      }

      // 第二级起：菜单命令（支持子菜单继续下钻）
      if (picked.menu) {
        await showMenuLevel(picked.menu.children, `${picked.menu.label} — 选择命令`, dyn);
      }
    }),
  );

  return item;
}

/** 最近工程二级列表：打开工程 + 清空历史（E1） */
async function showRecentPick(dyn: MenuDynamicData): Promise<void> {
  const items: RecentPick[] = dyn.recents.map((r) => ({
    label: r.label,
    description: path.dirname(r.file),
    file: r.file,
  }));
  items.push({ label: '$(trash) Clear Recent Projects', description: '清空最近工程列表', file: '', clear: true });
  const sel = await vscode.window.showQuickPick(items, { placeHolder: 'Recent Projects — 打开工程' });
  if (!sel) return;
  if (sel.clear) {
    await vscode.commands.executeCommand('codeblocks.clearRecentProjects');
    return;
  }
  await vscode.commands.executeCommand('codeblocks.openRecentProject', sel.file);
}

/** 工作区二级列表：设为活动项目（E2） */
async function showWorkspacePick(dyn: MenuDynamicData): Promise<void> {
  const sel = await vscode.window.showQuickPick(
    dyn.order.map((o) => ({ label: o.label, description: '设为活动项目', file: o.file })),
    { placeHolder: 'Workspace — 设为活动项目' },
  );
  if (sel) await vscode.commands.executeCommand('codeblocks.setActiveProject', sel.file);
}

/**
 * 菜单层级渲染：叶子项执行命令，子菜单项继续下钻（与 CB 菜单层级一致）。
 * description 依次展示：子菜单箭头 / 快捷键 / （无工程）提示。
 */
async function showMenuLevel(children: MenuItemDef[], placeHolder: string, dyn: MenuDynamicData): Promise<void> {
  const items: (vscode.QuickPickItem & { def?: MenuItemDef })[] = [];
  for (const c of children) {
    if (c.separator) {
      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
      continue;
    }
    const isSubmenu = !c.command && (c.children?.length ?? 0) > 0;
    const desc: string[] = [];
    if (isSubmenu) desc.push('子菜单 ›');
    if (c.shortcut) desc.push(c.shortcut);
    if (c.needsProject && !dyn.hasProjects) desc.push('（无工程）');
    const icon = CHILD_ICONS[c.label];
    items.push({
      label: c.label,
      description: desc.length ? desc.join(' · ') : undefined,
      iconPath: icon ? new vscode.ThemeIcon(icon) : undefined,
      def: c,
    });
  }
  const sel = await vscode.window.showQuickPick(items, { placeHolder });
  if (!sel?.def) return;
  const def = sel.def;
  if (!def.command) {
    if (def.children?.length) await showMenuLevel(def.children, `${def.label} — 选择命令`, dyn);
    return;
  }
  try {
    await vscode.commands.executeCommand(def.command, ...(def.args ?? []));
  } catch {
    vscode.window.showWarningMessage(`命令不可用: ${def.command}`);
  }
}
