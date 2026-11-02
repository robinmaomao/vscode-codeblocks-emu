/**
 * 构建产物目录的 watcher/search 排除项计算（纯逻辑，便于单测）。
 *
 * 背景（实测）：VS Code 的文件监听收到「快速连续的文件创建」后会刷新全工作区文件索引，
 * 每次刷新派生一个 `rg --files` + 一个隐藏控制台（conhost）。构建一次写 57 个目标文件，
 * 在机械盘/内存换页的机器上每次 rg 要跑 10~20 s，于是请求堆积成上百个 rg.exe ——
 * 任务管理器里就表现为「VS Code 组几百个进程 + CPU 100%」。
 * 实测同一风暴：不排除 → rg 峰值 10（10 个文件）；把 `Output` 目录加入 `files.watcherExclude` → 峰值 0。
 *
 * 因此这里按工程配置推导需要排除的目录（对象输出目录 + 输出文件所在目录 + 常见产物目录），
 * 生成 `files.watcherExclude` / `search.exclude` 需要的 glob。
 */
import * as path from 'path';
import { BuildTarget, Project } from '../model/types';
import { cbBuiltinVars } from '../compiler/cbMacros';

/** 常见的构建产物目录名（工程未显式配置时兜底；含 Code::Blocks 的默认 `.objs` / `.deps`） */
const DEFAULT_OUTPUT_DIRS = ['Output', 'obj', 'bin', '.objs', '.deps'];

/**
 * Code::Blocks 在未配置对象/依赖目录时使用的默认值：
 * - `object_output` 为空 → `.objs`（compiletargetbase.cpp GetObjectOutput）；
 * - `deps_output` 为空 → `.deps`（GetDepsOutput）。
 *
 * 两者都在工程目录内，构建时会被批量写入（对象、`*.respFile`、`*.depend`）。
 * VS Code 的文件监视/搜索索引会把它们当成普通工作区文件，进而触发全工作区枚举 —— 必须排除。
 */
const DEFAULT_OBJECT_OUTPUT = '.objs';
const DEFAULT_DEPS_OUTPUT = '.deps';

/** 展开 Code::Blocks 目标路径里的 `$(VAR)` / `${VAR}`（仅用于推导排除目录，不影响构建） */
function expandTargetPath(p: Project, t: BuildTarget, raw: string): string {
  if (!raw || !raw.includes('$')) return raw;
  const vars = cbBuiltinVars(p.basePath, t.outputFilename, t.title, t.objectOutput, p.title, p.filename, '');
  return raw.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, a, b) => {
    const key = String(a ?? b);
    return vars[key] ?? m;
  });
}

/** 把工程内可能含产物的目录（相对工程根）规范化成去重数组 */
export function collectOutputDirs(projects: readonly Project[]): string[] {
  const out: string[] = [];
  const push = (dir: string): void => {
    const norm = dir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').trim();
    if (!norm || norm === '.' || norm.startsWith('..')) return;
    if (!out.includes(norm)) out.push(norm);
  };
  for (const p of projects) {
    for (const t of p.buildTargets) {
      // 对象目录：未配置时必须补默认 `.objs`（否则每个 .o / .respFile 都会触发监视器）
      const objectRaw = (t.objectOutput || '').trim() || DEFAULT_OBJECT_OUTPUT;
      push(expandTargetPath(p, t, objectRaw));
      // 依赖目录：同样补默认 `.deps`（Code::Blocks 默认，扩展的自定义编译命令也可能写）
      const depsRaw = (t.depsOutput || '').trim() || DEFAULT_DEPS_OUTPUT;
      push(expandTargetPath(p, t, depsRaw));
      if (t.outputFilename) {
        const expanded = expandTargetPath(p, t, t.outputFilename);
        const dir = path.dirname(expanded.replace(/\\/g, '/'));
        if (dir && dir !== '.') push(dir);
      }
    }
  }
  if (out.length === 0) for (const d of DEFAULT_OUTPUT_DIRS) push(d);
  return out;
}

/** 目录 → watcher/search 排除 glob（兼容相对与绝对写法） */
export function excludeGlobsFor(dir: string): string[] {
  const d = dir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!d) return [];
  // 绝对路径（跨盘工程）：直接作为前缀；相对路径：任意层级匹配
  if (/^[A-Za-z]:\//.test(d) || d.startsWith('/')) return [`${d}/**`];
  return [`**/${d}/**`];
}

/** 合并排除项：保留用户已有条目，只补缺失的 glob */
export function mergeExcludePatterns(
  existing: Record<string, unknown> | undefined,
  globs: readonly string[],
): { value: Record<string, unknown>; added: string[] } {
  // settings.json 是手写文件：对象型设置可能被写成字符串/数组（VS Code 不强制类型）。
  // 直接展开字符串会得到 {"0":"a",...} 并把它写回设置 —— 这里统一按「非法值忽略」处理。
  const base = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : undefined;
  const value: Record<string, unknown> = { ...(base ?? {}) };
  const added: string[] = [];
  for (const g of globs) {
    if (value[g] === undefined) {
      value[g] = true;
      added.push(g);
    }
  }
  return { value, added };
}
