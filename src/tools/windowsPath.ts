/**
 * Windows 系统 PATH 实时读取 —— 解决扩展宿主进程 PATH 快照过期问题。
 *
 * VS Code 扩展宿主进程的 process.env.PATH 是启动时快照；运行期间用户/安装程序
 * 加入系统 PATH 的工具（注册表 Machine/User）无法被子进程发现。本模块从注册表
 * 实时读取 Machine + User 两级 PATH，展开 %VAR%。
 *
 * 读取策略（R2，M0 实测：构建「环境准备」阶段 90–196ms/次 = 2×reg.exe 同步查询）：
 * - 首次调用：同步读取（保持既有语义）；
 * - 已有缓存：立即返回缓存值；若超过 TTL（5s）则**后台异步刷新**（stale-while-revalidate），
 *   刷新完成后下一次调用即拿到新值——构建/脚本路径不再被 reg.exe 同步阻塞。
 */
import { execFile, execFileSync } from 'child_process';
import * as path from 'path';
import { decodeText } from './encoding';

let cachedPath: string | undefined;
let cachedAt = 0;
let refreshing = false;
const TTL_MS = 5000; // 同一构建内多条脚本复用；过期后台刷新（不阻塞调用方）

/** 读取注册表 Machine + User 的 PATH 并展开 %VAR%（首查同步；其后缓存 + 过期后台刷新） */
export function getWindowsSystemPath(): string {
  const now = Date.now();
  if (cachedPath !== undefined) {
    if (now - cachedAt >= TTL_MS && !refreshing) {
      refreshing = true;
      // 后台刷新：成功更新值；失败保留旧值（下个 TTL 周期重试）——两者都更新 cachedAt
      void readBothAsync()
        .then((v) => {
          if (v) cachedPath = v;
        })
        .catch(() => { /* 刷新失败：保留旧缓存，TTL 到期后重试 */ })
        .finally(() => {
          refreshing = false;
          cachedAt = Date.now();
        });
    }
    return cachedPath;
  }
  // 首次：同步读取（调用方需要立即可用的值；此后不再走同步路径）
  cachedPath = readBothSync();
  cachedAt = now;
  return cachedPath;
}

/** 同步读取两级 PATH（仅首次调用使用） */
function readBothSync(): string {
  return [
    readRegPath('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    readRegPath('HKCU\\Environment'),
  ].filter(Boolean).join(';');
}

/** 异步读取两级 PATH（后台刷新；execFile 不阻塞事件循环） */
function readBothAsync(): Promise<string> {
  return Promise.all([
    readRegPathAsync('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'),
    readRegPathAsync('HKCU\\Environment'),
  ]).then((parts) => parts.filter(Boolean).join(';'));
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

/** 异步读取指定注册表键的 Path 值（编码固定 buffer，交 decodeText 判定 GBK/UTF-8） */
function readRegPathAsync(key: string): Promise<string> {
  return new Promise((resolve) => {
    execFile(regExe(), ['query', key, '/v', 'Path'], { windowsHide: true, encoding: 'buffer' }, (err, stdout) => {
      if (err) {
        resolve('');
        return;
      }
      const out = decodeText(stdout as Buffer);
      const m = out.match(/Path\s+REG(?:_EXPAND)?_SZ\s+(.+)/i);
      resolve(m ? expandEnv(m[1].trim()) : '');
    });
  });
}

/** 展开 %SystemRoot% / %ProgramFiles% 等环境变量 */
function expandEnv(s: string): string {
  return s.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`);
}
