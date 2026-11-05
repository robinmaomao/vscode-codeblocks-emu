/**
 * 路径大小写工具 —— 对齐 Code::Blocks 在 Windows 生成命令行时的路径形态。
 *
 * VS Code 工作区 URI / findFiles 返回的路径盘符为小写（如 d:\...），
 * 而 Code::Blocks（从 Explorer 打开）拿到的是大写盘符（D:\...），
 * 二者都会被 GCC 原样写进调试信息（DW_AT_comp_dir / .debug_line），
 * 导致 .a / .o 的 debug 段字节不一致。此处只归一化盘符首字母，不碰其余路径大小写。
 */

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { decodeText } from './encoding';
import { LruCache } from './lru';

/** 盘符首字母大写（仅 win32 且形如 x: 开头；相对路径 / UNC 路径不变） */
export function upperDrive(p: string): string {
  if (process.platform === 'win32' && /^[a-z]:/.test(p)) {
    return p[0].toUpperCase() + p.slice(1);
  }
  return p;
}

/** Windows 短路径缓存（对齐 wxFileName::GetShortPath / GetShortPathName；LRU 512 防长会话无界增长） */
const shortPathCache = new LruCache<string, string>(512);

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
    // Node 默认会给含空格的 /c 参数整体再加一层引号，cmd /s 解析后会把结果拼成
    // `E:\"C:\...\"`（非合法路径）；windowsVerbatimArguments 保留命令行原样。
    // /u 让内部命令以 UTF-16LE 输出，避免非中文代码页把中文短路径写成 `??`。
    const r = spawnSync('cmd', ['/u', '/d', '/s', '/c', `for %I in ("${p}") do @echo %~sI`], {
      encoding: 'buffer',
      windowsHide: true,
      windowsVerbatimArguments: true,
      timeout: 2000,
    });
    const raw = r.stdout ?? Buffer.alloc(0);
    // cmd /u 输出 UTF-16LE；若宿主未按 /u 输出，再回退 UTF-8/GBK。
    // 只有真实存在的路径才可用：畸形拼接 / 代码页丢失（??）都会在此被过滤。
    const out = [
      raw.toString('utf16le').replace(/^\uFEFF/, '').replace(/\0+$/, '').trim(),
      decodeText(raw).trim(),
    ].find((v) => v && !/not found/i.test(v) && existsSync(v));
    const resolved = out || p;
    shortPathCache.set(key, resolved);
    return resolved;
  } catch {
    shortPathCache.set(key, p);
    return p;
  }
}
