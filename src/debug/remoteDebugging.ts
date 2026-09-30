/**
 * 远程调试准备命令构建（R3/R4）—— 对齐 Code::Blocks gdb_driver.cpp:141-260 Prepare + GdbCmd_RemoteTarget
 *
 * 固定顺序（CB 取证）：
 *   ① additional_cmds_before（GDB 命令，任意调试均执行）
 *   ② additional_shell_cmds_before（`shell ` 前缀）
 *   ③ Serial 时 `set remotebaud <baud>`
 *   ④ `target [extended-]remote tcp:|udp:|<串口>`（gdb_commands.h:1711-1745）
 *   ⑤ additional_cmds（连接后）
 *   ⑥ additional_shell_cmds_after（`shell ` 前缀）
 *
 * 另含调试器源目录命令构建（GdbCmd_AddSourceDir：`directory <dir>`，
 * 路径反斜杠转正斜杠、含空格加引号——对齐 ConvertToGDBDirectory）。
 *
 * 纯函数（无 vscode 依赖），供适配器执行与回归测试共用。
 */
import { RemoteDebuggingOptions, isRemoteOptionsOk } from '../model/projectDebuggerExtensions';

export interface DebugCommandStep {
  /** console = GDB CLI 命令；shell = `shell ` 前缀的外部命令 */
  kind: 'console' | 'shell';
  command: string;
}

/** `directory <dir>` 命令列表（CB AddSourceDir：GDB 友好路径 + 按需引号） */
export function buildSourceDirCommands(dirs: string[]): string[] {
  return (dirs ?? [])
    .map((d) => String(d ?? '').trim())
    .filter(Boolean)
    .map((d) => {
      const p = d.replace(/\\/g, '/');
      return `directory ${/\s/.test(p) ? `"${p}"` : p}`;
    });
}

/** 远程调试准备命令序列（配置无效时返回空 = 按本地调试处理） */
export function buildRemoteDebugCommands(rd: RemoteDebuggingOptions): DebugCommandStep[] {
  if (!isRemoteOptionsOk(rd)) return [];
  const steps: DebugCommandStep[] = [];
  const pushLines = (text: string, kind: 'console' | 'shell'): void => {
    for (const line of String(text ?? '').split(/\r?\n/)) {
      if (line.trim()) steps.push({ kind, command: line });
    }
  };

  pushLines(rd.additionalCmdsBefore, 'console');
  pushLines(rd.additionalShellCmdsBefore, 'shell');
  if (rd.connType === 2) {
    steps.push({ kind: 'console', command: `set remotebaud ${rd.serialBaud}` });
  }
  const targetCmd = rd.extendedRemote ? 'target extended-remote ' : 'target remote ';
  let dest = '';
  if (rd.connType === 0) dest = `tcp:${rd.ip}:${rd.ipPort}`;
  else if (rd.connType === 1) dest = `udp:${rd.ip}:${rd.ipPort}`;
  else dest = rd.serialPort;
  steps.push({ kind: 'console', command: targetCmd + dest });
  pushLines(rd.additionalCmds, 'console');
  pushLines(rd.additionalShellCmdsAfter, 'shell');
  return steps;
}

/** 引号感知分词（GDB user arguments；与扩展 run 参数分词同规则） */
export function splitCommandLineArgs(s: string): string[] {
  if (!s || !s.trim()) return [];
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}
