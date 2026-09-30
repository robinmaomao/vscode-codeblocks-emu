/**
 * Makefile 导出（B4）—— 把 Code::Blocks 展开后的字面命令导出为可独立构建的 Makefile。
 *
 * 数据来自 BuildEngine.collectMakefileData（与真实构建相同的命令生成路径），
 * 本模块只做格式化（纯函数，无 vscode 依赖）：
 * - 目标规则：<输出>: <对象...> → 链接/打包命令；
 * - 编译规则：<对象>: <源文件> → 编译命令；
 * - clean 规则：删除对象与输出文件；
 * - 命令中的 `$` 转义为 `$$`（Makefile 变量转义）；多行命令以 ` && ` 连接。
 *
 * 限制（导出文件头注明）：头文件依赖未跟踪；生成器文件顺序依赖 make 的默认顺序；
 * 路径含空格的工程建议在无空格目录使用（Make 对目标名空格支持有限）。
 * win32 下目录创建/删除用 `cmd /c` 内联（cmd 与 sh 两种 make shell 下均可执行）。
 */
import * as path from 'path';

export interface MakefileTargetData {
  targetTitle: string;
  /** 输出文件（相对工程根，如 bin/Debug/app.exe；静态库为 libX.a） */
  output: string;
  compile: { object: string; source: string; command: string }[];
  link?: { kind: 'link' | 'archive'; command: string; objects: string[] };
}

export interface MakefileExportOptions {
  projectTitle: string;
  projectFile: string;
  basePath: string;
  generatedAt: string;
  targets: MakefileTargetData[];
  /** 目标平台（默认 process.platform）：win32 → cmd 内联命令；其它 → POSIX 命令 */
  platform?: NodeJS.Platform;
}

/** 绝对路径 → 相对工程根 + 正斜杠（Makefile 推荐风格）；相对路径原样归一 */
export function makeRelative(basePath: string, p: string): string {
  const rel = path.isAbsolute(p) ? path.relative(basePath, p) : p;
  return rel.replace(/\\/g, '/');
}

/** 单个命令 → Makefile 配方（`$` → `$$`；多行以 && 连接为单行） */
export function recipeCommand(command: string): string {
  const cmd = command
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join(' && ');
  return cmd.replace(/\$/g, '$$$$');
}

/** 生成 Makefile 文本 */
export function generateMakefile(opts: MakefileExportOptions): string {
  const L: string[] = [];
  const rel = (p: string): string => makeRelative(opts.basePath, p);
  const win = (opts.platform ?? process.platform) === 'win32';
  // win32 用 `cmd /c` 内联（cmd 与 sh 两种 make shell 下都可执行）；其它平台用 POSIX 命令
  const mkdirCmd = (dir: string): string => {
    const w = dir.replace(/\//g, '\\');
    return win ? `cmd /c if not exist "${w}" mkdir "${w}"` : `mkdir -p "${dir}"`;
  };
  const rmCmd = (p: string): string => (win ? `-cmd /c del /q "${p.replace(/\//g, '\\')}"` : `-rm -f "${p}"`);
  L.push('# Code::Blocks Makefile 导出（自动生成，勿手工编辑）');
  L.push(`# 工程: ${opts.projectTitle}（${opts.projectFile}）`);
  L.push(`# 生成时间: ${opts.generatedAt}`);
  L.push('#');
  L.push('# 用法: mingw32-make -f <本文件> [all | <目标输出> | clean]');
  L.push('# 说明: 命令为 Code::Blocks 展开后的字面量；头文件依赖未跟踪，强制全量重建请用 make -B。');
  L.push('');
  L.push('.PHONY: all clean');
  L.push('');

  const outputs = opts.targets.map((t) => rel(t.output)).filter(Boolean);
  L.push(outputs.length ? `all: ${outputs.join(' ')}` : 'all:');
  L.push('');

  // 目录创建规则（order-only 前置依赖；对齐 CB 构建时的 CreateDirRecursively）
  const dirSet = new Set<string>();
  for (const t of opts.targets) {
    for (const p of [rel(t.output), ...t.compile.map((c) => rel(c.object))]) {
      const d = path.posix.dirname(p);
      if (d && d !== '.') dirSet.add(d);
    }
  }
  for (const d of [...dirSet].sort()) {
    L.push(`${d}/:`);
    L.push('\t' + mkdirCmd(d));
    L.push('');
  }

  // 链接 / 打包规则
  for (const t of opts.targets) {
    if (!t.link) continue;
    const out = rel(t.output);
    const outDir = path.posix.dirname(out);
    const objs = t.link.objects.map(rel);
    L.push(`${out}: ${objs.join(' ')}${outDir && outDir !== '.' ? ` | ${outDir}/` : ''}`);
    L.push('\t' + recipeCommand(t.link.command));
    L.push('');
  }

  // 编译规则（同一对象去重：多目标共享文件时对象路径不同，一般不会重）
  const seen = new Set<string>();
  for (const t of opts.targets) {
    for (const c of t.compile) {
      const obj = rel(c.object);
      if (seen.has(obj)) continue;
      seen.add(obj);
      const objDir = path.posix.dirname(obj);
      L.push(`${obj}: ${rel(c.source)}${objDir && objDir !== '.' ? ` | ${objDir}/` : ''}`);
      L.push('\t' + recipeCommand(c.command));
      L.push('');
    }
  }

  // clean：删除全部对象与输出（失败忽略）
  L.push('clean:');
  const cleanPaths = new Set<string>();
  for (const t of opts.targets) {
    cleanPaths.add(rel(t.output));
    for (const c of t.compile) cleanPaths.add(rel(c.object));
  }
  if (!cleanPaths.size) {
    L.push('\t@echo nothing to clean');
  } else {
    for (const p of cleanPaths) {
      L.push('\t' + rmCmd(p));
    }
  }
  L.push('');
  return L.join('\n');
}
