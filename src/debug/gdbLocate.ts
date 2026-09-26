/**
 * GDB 定位纯函数（第五十轮 D9）
 *
 * 优先级（对齐「显式配置 > 编译器根目录 > PATH」）：
 *  1. `codeblocks.debug.gdbPath`（可为 gdb 文件本身，或含 bin/gdb 的目录）
 *  2. `codeblocks.masterPath`/bin/gdb
 *  3. PATH 逐目录扫描
 * exists 可注入，便于单测；不做架构校验（失败时由启动错误上报呈现）。
 */
import * as path from 'path';

export interface GdbLocateInput {
  /** codeblocks.debug.gdbPath（文件或目录） */
  settingPath?: string;
  /** codeblocks.masterPath（编译器安装根目录） */
  masterPath?: string;
  /** process.env.PATH */
  pathEnv?: string;
  platform?: string;
  exists: (p: string) => boolean;
}

/** 返回首个存在的 GDB 候选路径；均不存在返回 undefined */
export function resolveGdbPath(input: GdbLocateInput): string | undefined {
  const platform = input.platform ?? process.platform;
  const name = platform === 'win32' ? 'gdb.exe' : 'gdb';
  const candidates: string[] = [];
  const push = (p: string) => { if (p) candidates.push(p); };

  const setting = (input.settingPath ?? '').trim();
  if (setting) {
    push(setting);
    push(path.join(setting, 'bin', name));
    push(path.join(setting, name));
  }

  const master = (input.masterPath ?? '').trim();
  if (master) push(path.join(master, 'bin', name));

  const sep = platform === 'win32' ? ';' : ':';
  for (const dir of (input.pathEnv ?? '').split(sep)) {
    if (dir) push(path.join(dir, name));
  }

  return candidates.find((c) => input.exists(c));
}
