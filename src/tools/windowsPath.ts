/**
 * Windows 系统 PATH 实时读取 —— 解决扩展宿主进程 PATH 快照过期问题。
 *
 * VS Code 扩展宿主进程的 process.env.PATH 是启动时快照；运行期间用户/安装程序
 * 加入系统 PATH 的工具（注册表 Machine/User）无法被子进程发现。本模块从注册表
 * 实时读取 Machine + User 两级 PATH，展开 %VAR%，并做短 TTL 缓存。
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import { decodeText } from './encoding';

let cachedPath: string | undefined;
let cachedAt = 0;
const TTL_MS = 5000; // 同一构建内多条脚本复用，跨构建实时刷新

/** 读取注册表 Machine + User 的 PATH 并展开 %VAR%（TTL 缓存） */
export function getWindowsSystemPath(): string {
  const now = Date.now();
  if (cachedPath !== undefined && now - cachedAt < TTL_MS) return cachedPath;

  cachedPath = [
    readRegPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    readRegPath('HKCU\\Environment'),
  ].filter(Boolean).join(';');

  cachedAt = now;
  return cachedPath;
}

/** reg.exe 完整路径（不依赖宿主进程 PATH 快照） */
function regExe(): string {
  return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'reg.exe');
}

/** 读取指定注册表键的 Path 值，展开 %VAR% 后返回；失败返回空串 */
function readRegPath(key: string): string {
  try {
    const buf = execFileSync(regExe(), ['query', key, '/v', 'Path'], {
      windowsHide: true,
    });
    const out = decodeText(buf as Buffer);
    // 兼容 "REG_SZ" 与 "REG_EXPAND_SZ"（中文 Windows 的 reg.exe 输出为 GBK，由 decodeText 处理）
    const m = out.match(/Path\s+REG(?:_EXPAND)?_SZ\s+(.+)/i);
    return m ? expandEnv(m[1].trim()) : '';
  } catch {
    return '';
  }
}

/** 展开 %SystemRoot% / %ProgramFiles% 等环境变量 */
function expandEnv(s: string): string {
  return s.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}
