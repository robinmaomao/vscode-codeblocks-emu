/**
 * clangd 重启判定（纯函数，无 vscode 依赖，便于单测覆盖真值表）。
 *
 * 生成 compile_commands.json / clangd 用户配置之后是否重启 clangd：
 *  - 'open'（打开工程）/ 'compiler'（编译器设置变化）：必须重启，不受 codeblocks.clangd.restartOnActiveProjectSwitch 限制；
 *  - 'project'（切换活动工程）：尊重该开关（重启会触发重新索引）。
 *
 * 关键约束（修复 “couldn't create connection to server” / `command 'clangd.applyFix' already exists` 弹窗）：
 * 1. 数据库未变且配置也没变 → 无事可做，不重启；
 * 2. 数据库未变、只有配置变化 → clangd 会监听 config.yaml 并即时生效，一般不重启（避免无谓的重新索引）；
 * 3. 数据库未变、只有配置变化、且本次生成发生在**启动恢复**（窗口重载后恢复上次会话工程）期间 →
 *    此刻 clangd 客户端刚随窗口启动、仍在 initialize，调用 clangd.restart 会与它自身的初始化竞态
 *    （dispose 未完成即新建 client → 命令重复注册 → 连接失败弹窗），必须跳过。
 */

export type ClangdRestartReason = 'project' | 'compiler' | 'open';

export interface ClangdRestartState {
  /** 本次生成的重启原因；undefined = 该次生成不涉及重启（例如仅设置变更触发） */
  reason: ClangdRestartReason | undefined;
  /** 编译数据库未变化（生成结果与磁盘一致，跳过写入） */
  databaseUnchanged: boolean;
  /** 本次实际写入了新的 clangd 用户配置（config.yaml 内容有变化） */
  configWritten: boolean;
  /** 本次生成由启动恢复（窗口重载后恢复上次会话工程）触发 */
  fromSessionRestore: boolean;
  /** 用户是否允许「切换活动工程时重启 clangd」 */
  restartAllowed: boolean;
  /** 存在需要刷新分析的消费者：clangd 扩展已激活，或已打开 C/C++ 文件 */
  hasConsumer: boolean;
}

/** 'restart' = 重启；'skip-config-only' = 启动恢复期间仅配置变化，跳过（需留痕说明）；'skip' = 无需重启 */
export type ClangdRestartAction = 'restart' | 'skip-config-only' | 'skip';

export function decideClangdRestart(state: ClangdRestartState): ClangdRestartAction {
  const { reason, databaseUnchanged, configWritten, fromSessionRestore, restartAllowed, hasConsumer } = state;
  if (!reason || !hasConsumer) return 'skip';
  if (reason === 'project' && !restartAllowed) return 'skip';
  if (databaseUnchanged && !configWritten) return 'skip';
  if (fromSessionRestore && reason === 'open' && databaseUnchanged && configWritten) return 'skip-config-only';
  return 'restart';
}
