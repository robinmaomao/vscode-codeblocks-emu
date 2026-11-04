/**
 * 设置升级迁移（一次性）：
 * - `codeblocks.parallelJobs`：旧版本 `0` = 自动（逻辑核数 × 2）。本版本 `0` 改为
 *   「当前主机逻辑核数」，并在升级时把用户**显式配置**的 `0` 改写为默认并发 `8`；
 *   迁移完成后用户再设 `0` 仍表示按逻辑核数自动。
 * - `codeblocks.clangd.queryDriver`：已移除（只用于输出一条提示）。升级时清理残留配置项，
 *   实际开关是 `codeblocks.clangd.builtinHeaders = queryDriver` + `Configure clangd --query-driver` 命令。
 *
 * 纯函数集中在这里，便于无头测试；作用域写入由 `extension.ts` 完成。
 */

/** 迁移标记（globalState）：写入后不再重复改写用户设置 */
export const PARALLEL_JOBS_MIGRATION_KEY = 'codeblocks.settingsMigration.parallelJobs';
/** 迁移版本：未来需要再次迁移时递增 */
export const PARALLEL_JOBS_MIGRATION_VERSION = 1;
/** 升级后写入的并行任务数默认值 */
export const PARALLEL_JOBS_MIGRATION_VALUE = 8;

/** 配置作用域（与 VS Code ConfigurationTarget 对应） */
export type SettingScope = 'global' | 'workspace' | 'workspaceFolder';

/** `getConfiguration(...).inspect(key)` 中与本模块相关的字段 */
export interface SettingInspect {
  globalValue?: unknown;
  workspaceValue?: unknown;
  workspaceFolderValue?: unknown;
}

/** 是否为「显式 0」（兼容旧配置里写成字符串 "0" 的情况） */
function isZeroJobs(value: unknown): boolean {
  if (value === 0) return true;
  return typeof value === 'string' && value.trim() !== '' && Number(value) === 0;
}

/** 需要把 `parallelJobs` 从 0 改写为 8 的作用域 */
export function parallelJobsMigrationScopes(inspected: SettingInspect | undefined): SettingScope[] {
  if (!inspected) return [];
  const scopes: SettingScope[] = [];
  if (isZeroJobs(inspected.globalValue)) scopes.push('global');
  if (isZeroJobs(inspected.workspaceValue)) scopes.push('workspace');
  if (isZeroJobs(inspected.workspaceFolderValue)) scopes.push('workspaceFolder');
  return scopes;
}

/** 是否存在任意作用域的显式值（用于清理已移除的设置项） */
export function hasExplicitSetting(inspected: SettingInspect | undefined): boolean {
  if (!inspected) return false;
  return inspected.globalValue !== undefined
    || inspected.workspaceValue !== undefined
    || inspected.workspaceFolderValue !== undefined;
}
