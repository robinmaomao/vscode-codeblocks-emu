/**
 * 路径大小写工具 —— 对齐 Code::Blocks 在 Windows 生成命令行时的路径形态。
 *
 * VS Code 工作区 URI / findFiles 返回的路径盘符为小写（如 d:\...），
 * 而 Code::Blocks（从 Explorer 打开）拿到的是大写盘符（D:\...），
 * 二者都会被 GCC 原样写进调试信息（DW_AT_comp_dir / .debug_line），
 * 导致 .a / .o 的 debug 段字节不一致。此处只归一化盘符首字母，不碰其余路径大小写。
 */

import { spawnSync } from 'child_process';

/** 盘符首字母大写（仅 win32 且形如 x: 开头；相对路径 / UNC 路径不变） */
export function upperDrive(p: string): string {
  if (process.platform === 'win32' && /^[a-z]:/.test(p)) {
    return p[0].toUpperCase() + p.slice(1);
  }
  return p;
}

/** Windows 短路径缓存（对齐 wxFileName::GetShortPath / GetShortPathName） */
const shortPathCache = new Map<string, string>();

/**
 * 获取 Windows 8.3 短路径 —— 对齐 Code::Blocks 的 GetShortPath（windres 空格 bug 修复 + Use83Paths）。
 * 通过 cmd 的 %~sI 展开（Node 无 GetShortPathName 绑定）；失败/非 Windows 返回原路径。
 */
export function shortPathWin(p: string): string {
  if (process.platform !== 'win32') return p;
  const key = p.toLowerCase();
  const hit = shortPathCache.get(key);
  if (hit !== undefined) return hit;
  try {
    // for %I in ("path") do @echo %~sI —— 与 cb 的 GetShortPathName 等价
    const r = spawnSync('cmd', ['/d', '/s', '/c', `for %I in ("${p}") do @echo %~sI`], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000,
    });
    const out = (r.stdout ?? '').trim();
    const resolved = out && !out.toLowerCase().includes('not found') ? out : p;
    shortPathCache.set(key, resolved);
    return resolved;
  } catch {
    shortPathCache.set(key, p);
    return p;
  }
}
