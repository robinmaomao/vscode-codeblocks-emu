/**
 * 构建结束 Build Log 聚焦决策（第六轮 F1；纯模块，无 vscode 依赖，供单测）
 *
 * 对齐 Code::Blocks message_manager（compilergcc.cpp:4064-4107）：
 *  - `/auto_show_build_errors`（默认 true）/ `/auto_show_build_warnings`（默认 true）：错误/警告时保持消息面板；
 *  - `/auto_focus_build_errors`（默认 true）：构建结束聚焦第一个错误（编辑器跳转，默认开）。
 * 扩展映射：面板聚焦用枚举（默认 errors＝仅错误时动作，对齐 CB 无错误不动作）；
 * 首个错误跳转是独立布尔开关（codeblocks.ui.buildLogFocusFirstError，默认 true），见 extension.ts。
 */

export type BuildLogAutoFocusMode = 'errors' | 'errorsAndWarnings' | 'always' | 'never';

/** 默认模式：errors（对齐 CB 默认策略） */
export const BUILD_LOG_AUTO_FOCUS_DEFAULT: BuildLogAutoFocusMode = 'errors';

/** 归一化设置值（非法/缺省 → 默认 errors） */
export function normalizeBuildLogAutoFocusMode(value: unknown): BuildLogAutoFocusMode {
  return value === 'errors' || value === 'errorsAndWarnings' || value === 'always' || value === 'never'
    ? value
    : BUILD_LOG_AUTO_FOCUS_DEFAULT;
}

/** 是否应自动聚焦 Build Log 面板（纯判定；错误/警告计数为本次构建最终统计） */
export function shouldAutoFocusBuildLog(
  mode: BuildLogAutoFocusMode,
  errorCount: number,
  warningCount: number,
): boolean {
  if (mode === 'always') return true;
  if (mode === 'never') return false;
  if (mode === 'errorsAndWarnings') return errorCount > 0 || warningCount > 0;
  return errorCount > 0;
}

/** 判定为真时执行注入的 focus 回调（副作用经回调注入，便于单测）；返回是否已聚焦 */
export function maybeAutoFocusBuildLog(
  mode: BuildLogAutoFocusMode,
  errorCount: number,
  warningCount: number,
  focus: () => void,
): boolean {
  if (!shouldAutoFocusBuildLog(mode, errorCount, warningCount)) return false;
  focus();
  return true;
}
