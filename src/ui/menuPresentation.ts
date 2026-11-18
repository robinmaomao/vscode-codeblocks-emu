/**
 * 状态栏菜单展示模型（纯逻辑，无 vscode 依赖）
 *
 * 统一 QuickPick 每行的呈现规则，避免渲染层各写一套：
 *  - 除分隔线外每项都有 icon（取自 menuStructure.CHILD_ICONS；测试保证 100% 覆盖且是 1.85 合法 codicon）；
 *  - 子菜单/动态下钻项在 label 末尾追加 `$(chevron-right)`，不再用 description 文案标注；
 *  - description 只放右侧上下文，固定顺序：快捷键 · 不可用原因（无工程 / 无 .workspace / 无调试会话）。
 */
import { CHILD_ICONS, MenuItemDef } from './menuStructure';

/** 渲染时的动态状态（由 extension.ts 的 getMenuDynamicData 提供） */
export interface MenuRenderContext {
  hasProjects: boolean;
  hasWorkspace: boolean;
  hasDebugSession: boolean;
}

/** 翻译函数（英文源串 → 当前语言；与 i18n.t 同签名） */
export type Translate = (source: string, ...args: unknown[]) => string;

/** 一行菜单展示数据（除 kind 外均为最终文案） */
export interface MenuItemPresentation {
  label: string;
  description?: string;
  icon: string;
  /** 子菜单 / 动态下钻（渲染层据此决定点击后行为） */
  drillDown: boolean;
}

/** 是否下钻项（有 children 或 dynamic 占位） */
export function isDrillDown(item: MenuItemDef): boolean {
  return item.dynamic !== undefined || (item.children?.length ?? 0) > 0;
}

/** 图标（缺失时给安全回落；回归测试要求所有项都已收录，运行时不应走到回落） */
export function menuIcon(item: MenuItemDef): string {
  return item.icon ?? CHILD_ICONS[item.label] ?? 'circle-outline';
}

/** 不可用原因（按固定顺序；全部可用时为空数组） */
export function unavailableReasons(
  item: MenuItemDef,
  ctx: MenuRenderContext,
  t: Translate,
): string[] {
  const reasons: string[] = [];
  if (item.needsProject && !ctx.hasProjects) reasons.push(t('(no project)'));
  if (item.needsWorkspace && !ctx.hasWorkspace) reasons.push(t('(no .workspace)'));
  if (item.needsDebugSession && !ctx.hasDebugSession) reasons.push(t('(no debug session)'));
  return reasons;
}

/**
 * 单个菜单项的展示数据。
 * description 拼接顺序固定：shortcut → 不可用原因，` · ` 分隔；全部为空时不设置。
 */
export function presentMenuItem(
  item: MenuItemDef,
  ctx: MenuRenderContext,
  t: Translate,
): MenuItemPresentation {
  const parts: string[] = [];
  if (item.shortcut) parts.push(item.shortcut);
  parts.push(...unavailableReasons(item, ctx, t));
  const suffix = isDrillDown(item) ? ' $(chevron-right)' : '';
  return {
    label: `${t(item.label)}${suffix}`,
    description: parts.length ? parts.join(' · ') : undefined,
    icon: menuIcon(item),
    drillDown: isDrillDown(item),
  };
}

/** 返回上一级的固定项（子层级第一行） */
export function presentBackItem(parentLabel: string, t: Translate): MenuItemPresentation {
  return {
    label: t('Back'),
    description: parentLabel ? t(parentLabel) : undefined,
    icon: 'arrow-left',
    drillDown: false,
  };
}
