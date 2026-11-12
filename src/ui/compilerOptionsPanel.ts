/**
 * 兼容导出：旧代码/测试通过 compilerOptionsPanel 引用面板。
 * 实际实现已迁移到 buildOptionsPanel.ts（完整 Code::Blocks Build options 对话框）。
 */
export { BuildOptionsPanel as CompilerOptionsPanel } from './buildOptionsPanel';
export type { BuildOptionsApply, BuildOptionsSaveResult } from './buildOptionsPanel';