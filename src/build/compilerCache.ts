/**
 * 编译缓存（ccache / sccache）集成 —— R4 保护性增强
 *
 * 纯模块（不依赖 vscode），供三处共用：
 *  - commandGenerator：标准编译命令 `$compiler` 前缀注入（同步路径解析 + 会话缓存）
 *  - buildEngine：构建开始「已启用但未找到」告警（回退语义：不注入前缀，构建照常）
 *  - extension：工具检测、一次性提示矩阵决策、引导安装命令（仅引导，不静默安装）
 *
 * 设计要点：
 *  - 默认 none：不读路径、不探测、命令与 0.8.125-dev 完全一致（零影响）
 *  - 显式路径（build.compilerCachePath）优先且唯一：无效即视为未找到（不静默回退 PATH，
 *    避免用户指定 A 却被悄悄用了 B）
 *  - 未指定路径：PATH → 常见安装目录（WinGet Links / Scoop shims / cargo bin / Chocolatey / Program Files）
 *    → WinGet Packages 兜底扫描（新式 winget 便携包不建 Links、包目录被直写用户 PATH；
 *      扩展宿主 PATH 为启动快照时，这是「运行中安装」能被检测到的关键路径）
 */
import * as fs from 'fs';
import * as path from 'path';

export type CompilerCacheKind = 'none' | 'ccache' | 'sccache';
export type CompilerCacheTool = Exclude<CompilerCacheKind, 'none'>;

/** 支持的编译缓存工具（顺序即提示顺序） */
export const COMPILER_CACHE_TOOLS: readonly CompilerCacheTool[] = ['ccache', 'sccache'];

/** 规范化设置值：未知/空/大小写变体 → none（误配安全回退，构建行为不变） */
export function normalizeCompilerCacheKind(v: unknown): CompilerCacheKind {
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'ccache' || s === 'sccache' ? s : 'none';
}

/** 可执行文件名候选（Windows 追加 .exe/.cmd/.bat，覆盖 scoop shim 与转换脚本） */
export function exeNameCandidates(tool: string, platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? [tool, `${tool}.exe`, `${tool}.cmd`, `${tool}.bat`] : [tool];
}

/** 常见安装目录（Windows 包管理器默认落点；PATH 未刷新时的兜底） */
export function commonInstallDirs(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') return [];
  const dirs: string[] = [];
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'));
  if (env.USERPROFILE) {
    dirs.push(path.join(env.USERPROFILE, 'scoop', 'shims'));
    // sccache 常见 cargo install 落点
    dirs.push(path.join(env.USERPROFILE, '.cargo', 'bin'));
  }
  if (env.ProgramData) dirs.push(path.join(env.ProgramData, 'chocolatey', 'bin'));
  for (const key of ['ProgramFiles', 'ProgramFiles(x86)']) {
    const base = env[key];
    if (!base) continue;
    dirs.push(path.join(base, 'ccache'), path.join(base, 'sccache'), path.join(base, 'WinGet', 'Links'));
  }
  return dirs;
}

function isRunnableFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 在单个目录中查找工具可执行文件（返回绝对路径；未命中 undefined） */
export function findToolInDir(
  dir: string,
  tool: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  for (const name of exeNameCandidates(tool, platform)) {
    const p = path.join(dir, name);
    if (isRunnableFile(p)) return path.resolve(p);
  }
  return undefined;
}

/** WinGet Packages 根目录（新式 winget 便携包：用户作用域 + 机器作用域） */
export function wingetPackagesDirs(
  env: Record<string, string | undefined>,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform !== 'win32') return [];
  const dirs: string[] = [];
  if (env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Packages'));
  if (env.ProgramFiles) dirs.push(path.join(env.ProgramFiles, 'WinGet', 'Packages'));
  return dirs;
}

/** 有界深度递归查找（WinGet 便携包布局：<包目录>\<版本目录>\<工具>.exe） */
export function findToolRecursive(
  dir: string,
  tool: string,
  maxDepth = 3,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (maxDepth < 1) return undefined;
  const direct = findToolInDir(dir, tool, platform);
  if (direct) return direct;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const hit = findToolRecursive(path.join(dir, e.name), tool, maxDepth - 1, platform);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * WinGet Packages 兜底扫描：
 * 新式 winget 安装便携包时**不创建 Links 链接**，而是把包目录直接写入用户 PATH
 * （扩展宿主 PATH 为启动快照时该条目不可见）→ 按包名段匹配（Ccache.Ccache_… / Mozilla.sccache_…）
 * 后在包内做有界递归查找；'ccache' 与 'sccache' 为不同段，互不误配。
 */
export function findToolInWingetPackages(
  baseDir: string,
  tool: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(baseDir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const wanted = tool.toLowerCase();
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!e.name.toLowerCase().split(/[._\-]/).includes(wanted)) continue;
    const hit = findToolRecursive(path.join(baseDir, e.name), tool, 3, platform);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 解析编译缓存工具可执行文件路径。
 * 1) 显式路径非空：仅认该路径（无效 → undefined，语义为「未找到」）
 * 2) 否则 PATH 逐目录扫描
 * 3) 再兜底常见安装目录（Windows：WinGet Links / Scoop / cargo / Chocolatey / Program Files）
 * 4) 最后扫描 WinGet Packages 便携包布局（新式 winget 不建 Links；PATH 快照过期时的主路径）
 */
export function resolveCompilerCachePath(
  kind: CompilerCacheKind,
  explicitPath: string,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  if (kind === 'none') return undefined;
  const explicit = (explicitPath || '').trim();
  if (explicit) {
    const p = path.isAbsolute(explicit) ? explicit : path.resolve(explicit);
    return isRunnableFile(p) ? p : undefined;
  }
  const pathEnv = env.PATH || env.Path || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    const hit = findToolInDir(dir, kind, platform);
    if (hit) return hit;
  }
  for (const dir of commonInstallDirs(env, platform)) {
    const hit = findToolInDir(dir, kind, platform);
    if (hit) return hit;
  }
  for (const base of wingetPackagesDirs(env, platform)) {
    const hit = findToolInWingetPackages(base, kind, platform);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * 会话级解析缓存（命令生成热路径：全量构建数百次调用只做一轮磁盘探测）。
 * 键含 kind|显式路径|PATH；设置变化 / 安装动作 / 重新检测后由调用方
 * 调用 clearCompilerCacheResolveCache() 主动失效。
 */
let resolveCacheKey = '';
let resolveCacheVal: string | undefined;
export function resolveCompilerCachePathCached(
  kind: CompilerCacheKind,
  explicitPath: string,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const key = `${kind}\u0000${explicitPath}\u0000${env.PATH || env.Path || ''}\u0000${platform}`;
  if (key === resolveCacheKey) return resolveCacheVal;
  resolveCacheVal = resolveCompilerCachePath(kind, explicitPath, platform, env);
  resolveCacheKey = key;
  return resolveCacheVal;
}

export function clearCompilerCacheResolveCache(): void {
  resolveCacheKey = '';
  resolveCacheVal = undefined;
}

// ---------------- 检测结果与提示矩阵（extension 用；纯数据便于回归） ----------------

export interface CompilerCacheToolInfo {
  path: string;
  version?: string;
}

export type CompilerCacheDetection = Partial<Record<CompilerCacheTool, CompilerCacheToolInfo>>;

export interface CompilerCachePromptFlags {
  /** 「未检测到任何工具」提示已展示 */
  notFoundShown: boolean;
  /** 「已启用但未找到」提示已展示（每次构建仍会在输出通道告警） */
  missingShown: boolean;
  /** 用户选择「不再提示」 */
  dontAsk: boolean;
}

export type CompilerCachePrompt =
  | { kind: 'none' }
  | { kind: 'install-hint' }
  | { kind: 'enable'; tools: CompilerCacheTool[] }
  | { kind: 'missing'; tool: CompilerCacheTool };

/**
 * 提示矩阵：
 *  - 未启用 + 未检测到：首次 → 安装提示（仅一次）
 *  - 未启用 + 检测到：**每次激活（打开工作区）→ 询问启用**（仅「不再提示」可停止；改设置自动重置）
 *  - 已启用 + 未找到：首次 → 失效提示 + 安装/路径指引（生成时静默回退）
 *  - 已启用 + 找到：无提示
 * manual=true（用户显式运行引导命令/重新检测）绕过全部标记与「不再提示」。
 */
export function decideCompilerCachePrompt(
  enabled: CompilerCacheKind,
  detection: CompilerCacheDetection,
  flags: CompilerCachePromptFlags,
  manual = false,
): CompilerCachePrompt {
  const foundTools = COMPILER_CACHE_TOOLS.filter((t) => detection[t] !== undefined);
  if (enabled === 'none') {
    if (foundTools.length > 0) {
      // 每次激活（打开工作区）都询问；仅「不再提示」可停止（修改设置自动重置）
      if (!manual && flags.dontAsk) return { kind: 'none' };
      return { kind: 'enable', tools: foundTools };
    }
    if (!manual && (flags.notFoundShown || flags.dontAsk)) return { kind: 'none' };
    return { kind: 'install-hint' };
  }
  if (detection[enabled]) return { kind: 'none' };
  if (!manual && (flags.missingShown || flags.dontAsk)) return { kind: 'none' };
  return { kind: 'missing', tool: enabled };
}

/** 版本号提取：ccache → "ccache version 4.8.3"；sccache → "sccache 0.7.7" */
export function parseToolVersion(stdout: string): string | undefined {
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(stdout || '');
  return m ? m[1] : undefined;
}

// ---------------- 引导安装（仅引导：复制命令 / 直接执行 / 打开下载页；无静默安装） ----------------

export interface InstallGuideInfo {
  tool: CompilerCacheTool;
  wingetId: string;
  wingetCommand: string;
  downloadUrl: string;
  license: string;
}

export const COMPILER_CACHE_INSTALL: Record<CompilerCacheTool, InstallGuideInfo> = {
  ccache: {
    tool: 'ccache',
    wingetId: 'Ccache.Ccache',
    wingetCommand: 'winget install --id Ccache.Ccache --accept-package-agreements --accept-source-agreements',
    downloadUrl: 'https://ccache.dev/download.html',
    license: 'GPL-3.0-or-later',
  },
  sccache: {
    tool: 'sccache',
    wingetId: 'Mozilla.sccache',
    wingetCommand: 'winget install --id Mozilla.sccache --accept-package-agreements --accept-source-agreements',
    downloadUrl: 'https://github.com/mozilla/sccache/releases',
    license: 'Apache-2.0',
  },
};

export interface InstallGuideItem {
  action: 'winget-copy' | 'winget-run' | 'open-download' | 'redetect';
  label: string;
  description: string;
}

/** 安装指引 QuickPick 项（winget 不可用时裁剪两项；「重新检测」恒在末尾） */
export function buildInstallGuideItems(tool: CompilerCacheTool, wingetAvailable: boolean): InstallGuideItem[] {
  const info = COMPILER_CACHE_INSTALL[tool];
  const items: InstallGuideItem[] = [];
  if (wingetAvailable) {
    items.push({
      action: 'winget-copy',
      label: '$(clippy) 复制 winget 安装命令',
      description: `${info.wingetCommand}（自行粘贴到终端执行）`,
    });
    items.push({
      action: 'winget-run',
      label: '$(terminal) 在终端执行 winget 安装',
      description: `需要确认；可能弹出 UAC 提权提示（id: ${info.wingetId}）`,
    });
  }
  items.push({
    action: 'open-download',
    label: '$(link-external) 打开官方下载页',
    description: `${info.downloadUrl}（${info.license}；winget 不可用或需手动指定目录时）`,
  });
  items.push({
    action: 'redetect',
    label: '$(refresh) 重新检测并启用',
    description: '安装完成后选择此项：重新探测工具路径，并可直接启用编译缓存',
  });
  return items;
}
