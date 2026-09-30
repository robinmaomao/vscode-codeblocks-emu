/**
 * Open include file（R11）—— 对齐 Code::Blocks codecompletion/clangd_client 的
 * 「Open include file」（codecompletion.cpp:577）：解析光标行的 #include 指令并定位目标文件。
 *
 * 纯逻辑模块（无 vscode 依赖）：指令解析 + 搜索顺序（当前文件目录 → include 搜索目录）+
 * 存在性检测注入（便于测试）。
 */
import * as path from 'path';

export interface IncludeDirective {
  /** 目标文件名（如 "util.h" / "sys/types.h"） */
  name: string;
  /** 引号形式（"..."）或尖括号形式（<...>） */
  quoted: boolean;
}

/** 解析 #include 指令行（支持前后空白与注释尾随；不是 include 行返回 undefined） */
export function parseIncludeDirective(line: string): IncludeDirective | undefined {
  const m = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(line ?? '');
  if (!m) return undefined;
  const name = m[2].trim();
  if (!name) return undefined;
  return { name, quoted: m[1] === '"' };
}

/**
 * 按搜索顺序解析包含文件路径：
 * 引号形式 → 当前文件目录优先；随后依次尝试各 include 目录（调用方负责宏展开与去重）。
 * @param exists 存在性检测（注入 fs.existsSync 便于测试/虚拟文件系统）
 */
export function resolveIncludePath(
  directive: IncludeDirective,
  fromDir: string,
  includeDirs: string[],
  exists: (p: string) => boolean,
): string | undefined {
  const dirs: string[] = [];
  if (directive.quoted && fromDir) dirs.push(fromDir);
  for (const d of includeDirs ?? []) {
    const t = String(d ?? '').trim();
    if (t) dirs.push(t);
  }
  const seen = new Set<string>();
  for (const dir of dirs) {
    const candidate = path.resolve(dir, directive.name.replace(/[\\/]+/g, path.sep));
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (exists(candidate)) return candidate;
  }
  return undefined;
}
