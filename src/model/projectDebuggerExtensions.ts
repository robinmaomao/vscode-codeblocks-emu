/**
 * 工程级调试器扩展配置 —— `<Project><Extensions><debugger>`（R3/R4）
 *
 * 对齐 Code::Blocks debuggergdb 插件：
 * - `search_path add="..."`：额外调试器源搜索目录（debuggergdb.cpp:321-340 ParseSearchDirs /
 *   :439-449 SetSearchDirs；启动时 AddSourceDir → GDB `directory <dir>`）
 * - `remote_debugging target="..."`：按目标（空 target = 项目级默认）的远程调试配置
 *   （debuggergdb.cpp:382-437 ParseRemoteDebuggingMap / :439-495 SetRemoteDebuggingMap）
 *     `<options conn_type serial_port serial_baud ip_address ip_port additional_cmds
 *      additional_cmds_before skip_ld_path extended_remote additional_shell_cmds_after
 *      additional_shell_cmds_before/>`
 * - 合并语义对齐 remotedebugging.h `MergeWith`：目标字段覆盖项目级；附加命令按行追加（换行连接）；
 *   布尔项以目标为准；连接有效性判定 `IsOk`（串口需 端口+波特率；TCP/UDP 需 IP+端口）。
 *
 * 纯函数（无 vscode 依赖），供扩展保存、调试启动与回归测试共用。
 */

export interface RemoteDebuggingOptions {
  /** 目标标题；'' = 项目级默认（XML target 属性缺省） */
  target: string;
  /** 连接类型：0=TCP 1=UDP 2=Serial（remotedebugging.h ConnectionType） */
  connType: number;
  serialPort: string;
  serialBaud: string;
  ip: string;
  ipPort: string;
  /** 连接后 GDB 命令（多行） */
  additionalCmds: string;
  /** 连接前 GDB 命令（多行；任意调试均执行） */
  additionalCmdsBefore: string;
  /** 连接后 shell 命令（多行） */
  additionalShellCmdsAfter: string;
  /** 连接前 shell 命令（多行） */
  additionalShellCmdsBefore: string;
  /** 跳过 LD_LIBRARY_PATH（Windows 为 PATH）注入 */
  skipLDpath: boolean;
  /** target extended-remote（默认 target remote） */
  extendedRemote: boolean;
}

export interface DebuggerProjectConfig {
  /** `<debugger><search_path add>` 列表（按文件顺序） */
  searchPaths: string[];
  /** `<debugger><remote_debugging>` 列表（含项目级默认 target=''） */
  remote: RemoteDebuggingOptions[];
}

/** 新建默认远程配置（波特率默认 115200，对齐 CB ParseRemoteDebuggingMap 默认值） */
export function defaultRemoteOptions(target = ''): RemoteDebuggingOptions {
  return {
    target,
    connType: 0,
    serialPort: '',
    serialBaud: '115200',
    ip: '',
    ipPort: '',
    additionalCmds: '',
    additionalCmdsBefore: '',
    additionalShellCmdsAfter: '',
    additionalShellCmdsBefore: '',
    skipLDpath: false,
    extendedRemote: false,
  };
}

const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const str = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

/** 解析 Extensions 原始节点中的 debugger 子树（无则返回空配置） */
export function parseProjectDebuggerConfig(extensions: unknown): DebuggerProjectConfig {
  const out: DebuggerProjectConfig = { searchPaths: [], remote: [] };
  const ext = extensions && typeof extensions === 'object' && !Array.isArray(extensions)
    ? (extensions as Record<string, unknown>)
    : undefined;
  if (!ext) return out;
  const dbgNode = ext['debugger'];
  const dbg = asArray(dbgNode as Record<string, unknown> | Record<string, unknown>[])[0];
  if (!dbg || typeof dbg !== 'object') return out;

  for (const p of asArray(dbg['search_path'] as any)) {
    const add = str(p?.['@_add']).trim();
    if (add && !out.searchPaths.includes(add)) out.searchPaths.push(add);
  }
  for (const rdNode of asArray(dbg['remote_debugging'] as any)) {
    const opt = asArray(rdNode?.['options'] as any)[0];
    if (!opt || typeof opt !== 'object') continue;
    const rd = defaultRemoteOptions(str(rdNode?.['@_target']));
    const num = Number(opt['@_conn_type']);
    if (opt['@_conn_type'] !== undefined && Number.isFinite(num)) rd.connType = num;
    if (opt['@_serial_port'] !== undefined) rd.serialPort = str(opt['@_serial_port']);
    if (opt['@_serial_baud'] !== undefined) rd.serialBaud = str(opt['@_serial_baud']) || '115200';
    if (opt['@_ip_address'] !== undefined) rd.ip = str(opt['@_ip_address']);
    if (opt['@_ip_port'] !== undefined) rd.ipPort = str(opt['@_ip_port']);
    if (opt['@_additional_cmds'] !== undefined) rd.additionalCmds = str(opt['@_additional_cmds']);
    if (opt['@_additional_cmds_before'] !== undefined) rd.additionalCmdsBefore = str(opt['@_additional_cmds_before']);
    if (opt['@_additional_shell_cmds_after'] !== undefined) rd.additionalShellCmdsAfter = str(opt['@_additional_shell_cmds_after']);
    if (opt['@_additional_shell_cmds_before'] !== undefined) rd.additionalShellCmdsBefore = str(opt['@_additional_shell_cmds_before']);
    if (opt['@_skip_ld_path'] !== undefined) rd.skipLDpath = str(opt['@_skip_ld_path']) !== '0';
    if (opt['@_extended_remote'] !== undefined) rd.extendedRemote = str(opt['@_extended_remote']) !== '0';
    out.remote.push(rd);
  }
  return out;
}

/** CB SetRemoteDebuggingMap 的"全默认则跳过"判定 */
export function isRemoteAllDefault(rd: RemoteDebuggingOptions): boolean {
  return (
    !rd.serialPort &&
    (rd.serialBaud === '' || rd.serialBaud === '115200') &&
    !rd.ip &&
    !rd.ipPort &&
    !rd.skipLDpath &&
    !rd.extendedRemote &&
    !rd.additionalCmds &&
    !rd.additionalCmdsBefore &&
    !rd.additionalShellCmdsAfter &&
    !rd.additionalShellCmdsBefore
  );
}

/** 连接有效性（对齐 remotedebugging.h IsOk） */
export function isRemoteOptionsOk(rd: RemoteDebuggingOptions): boolean {
  return rd.connType === 2
    ? Boolean(rd.serialPort) && Boolean(rd.serialBaud)
    : Boolean(rd.ip) && Boolean(rd.ipPort);
}

/**
 * CB remotedebugging.h `MergeWith`：目标覆盖项目默认（连接字段仅在目标 IsOk 时覆盖；
 * 附加命令按行追加；布尔项以目标为准）。两者均无效时返回 undefined。
 */
export function mergeRemoteOptions(
  projectDefault: RemoteDebuggingOptions | undefined,
  targetSpecific: RemoteDebuggingOptions | undefined,
): RemoteDebuggingOptions | undefined {
  if (!projectDefault && !targetSpecific) return undefined;
  if (!targetSpecific) return isRemoteOptionsOk(projectDefault!) ? { ...projectDefault! } : undefined;
  if (!projectDefault) return isRemoteOptionsOk(targetSpecific) ? { ...targetSpecific } : undefined;

  const rd: RemoteDebuggingOptions = { ...projectDefault, target: targetSpecific.target || projectDefault.target };
  if (isRemoteOptionsOk(targetSpecific)) {
    rd.connType = targetSpecific.connType;
    rd.serialPort = targetSpecific.serialPort;
    rd.serialBaud = targetSpecific.serialBaud;
    rd.ip = targetSpecific.ip;
    rd.ipPort = targetSpecific.ipPort;
  }
  const append = (a: string, b: string): string => (a && b ? a + '\n' + b : a || b);
  rd.additionalCmds = append(rd.additionalCmds, targetSpecific.additionalCmds);
  rd.additionalCmdsBefore = append(rd.additionalCmdsBefore, targetSpecific.additionalCmdsBefore);
  rd.additionalShellCmdsAfter = append(rd.additionalShellCmdsAfter, targetSpecific.additionalShellCmdsAfter);
  rd.additionalShellCmdsBefore = append(rd.additionalShellCmdsBefore, targetSpecific.additionalShellCmdsBefore);
  rd.skipLDpath = targetSpecific.skipLDpath;
  rd.extendedRemote = targetSpecific.extendedRemote;
  return isRemoteOptionsOk(rd) ? rd : undefined;
}

/**
 * 将调试器配置写回 Extensions 原始节点（保留 debugger 其它子节点与其它扩展节点）：
 * - search_path / remote_debugging 整体重建（对齐 CB GetElementForSaving 的清理+重写）；
 * - 全默认的远程条目跳过（CB SetRemoteDebuggingMap）；
 * - debugger 节点为空则移除，避免写出空节点。
 */
export function applyProjectDebuggerConfig(
  extensions: unknown,
  config: DebuggerProjectConfig,
): Record<string, unknown> {
  const ext = extensions && typeof extensions === 'object' && !Array.isArray(extensions)
    ? { ...(extensions as Record<string, unknown>) }
    : {};
  const dbgPrev = asArray(ext['debugger'] as any)[0];
  const dbg: Record<string, unknown> = dbgPrev && typeof dbgPrev === 'object' ? { ...(dbgPrev as Record<string, unknown>) } : {};
  delete dbg['search_path'];
  delete dbg['remote_debugging'];

  const paths = (config.searchPaths ?? []).map((p) => String(p).trim()).filter(Boolean);
  if (paths.length) {
    dbg['search_path'] = paths.map((p) => ({ '@_add': p }));
  }
  const remote = (config.remote ?? []).filter((rd) => !isRemoteAllDefault(rd));
  if (remote.length) {
    dbg['remote_debugging'] = remote.map((rd) => {
      const options: Record<string, unknown> = { '@_conn_type': String(rd.connType) };
      if (rd.serialPort) options['@_serial_port'] = rd.serialPort;
      if (rd.serialBaud && rd.serialBaud !== '115200') options['@_serial_baud'] = rd.serialBaud;
      if (rd.ip) options['@_ip_address'] = rd.ip;
      if (rd.ipPort) options['@_ip_port'] = rd.ipPort;
      if (rd.additionalCmds) options['@_additional_cmds'] = rd.additionalCmds;
      if (rd.additionalCmdsBefore) options['@_additional_cmds_before'] = rd.additionalCmdsBefore;
      if (rd.skipLDpath) options['@_skip_ld_path'] = '1';
      if (rd.extendedRemote) options['@_extended_remote'] = '1';
      if (rd.additionalShellCmdsAfter) options['@_additional_shell_cmds_after'] = rd.additionalShellCmdsAfter;
      if (rd.additionalShellCmdsBefore) options['@_additional_shell_cmds_before'] = rd.additionalShellCmdsBefore;
      const node: Record<string, unknown> = { options };
      if (rd.target) node['@_target'] = rd.target;
      return node;
    });
  }

  if (Object.keys(dbg).length) {
    ext['debugger'] = dbg;
  } else {
    delete ext['debugger'];
  }
  return ext;
}
