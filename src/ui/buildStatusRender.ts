/**
 * 构建状态栏渲染状态机（P5）——避免 250ms 常驻定时器每个 tick 重复赋值
 * text/tooltip/command（尤其空闲态每次重建 MarkdownString tooltip）。
 *
 * 纯函数（无 vscode 依赖），便于单测。
 */

/** 已渲染状态：'idle' = 空闲；number = 构建中已耗时秒数 */
export type BuildSpinRenderState = 'idle' | number;

/**
 * 计算本次 tick 应渲染的状态；与上次相同返回 undefined（调用方跳过渲染）。
 * @param prev 上次已渲染状态（undefined = 尚未渲染，首次强制渲染）
 * @param building 当前是否构建中
 * @param elapsedSecs 构建已耗时秒数（building=false 时忽略）
 */
export function nextBuildSpinRender(
  prev: BuildSpinRenderState | undefined,
  building: boolean,
  elapsedSecs: number,
): BuildSpinRenderState | undefined {
  const next: BuildSpinRenderState = building ? Math.max(0, Math.floor(elapsedSecs)) : 'idle';
  if (prev === next) return undefined;
  return next;
}
