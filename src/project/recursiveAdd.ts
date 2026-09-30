/**
 * 递归添加文件（对齐 Code::Blocks「Add files recursively...」，ProjectManagerUI::OnAddFilesToProjectRecursively）
 *
 * 参考 codeblocks-src/src/src/projectmanagerui.cpp:1625-1712：
 *   - 选择目录 → 递归枚举 → 过滤 SCM 目录与 *.cbp → 多选确认 → AddMultipleFilesToProject(..., targets)
 *   - 仅当工程只有一个构建目标时直接归属该目标；多目标时在对话框中选择
 *
 * 保护性差异（相对 CB 源实现）：
 *   - CB 使用「文件组掩码」全集(GetFileMasks) 作为过滤串，且不排除 obj/bin 输出目录；
 *     本扩展改用固定源文件白名单并额外跳过 obj/bin（否则对象文件/依赖文件会被写进 .cbp 单元）。
 *   - CB 允许选中工程目录之外的目录；本扩展限制在工程目录子树内（返回相对项目根的路径更可控）。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 递归枚举时跳过的目录名（SCM 控制目录 + 本工程约定的输出目录） */
export const RECURSIVE_SKIP_DIRS = new Set(['.git', '.hg', '.svn', 'cvs', 'obj', 'bin']);

/** 可加入工程的源文件扩展名（与「Add Files…」对话框过滤器一致） */
export const RECURSIVE_SOURCE_EXTS = new Set(['c', 'cpp', 'cc', 'cxx', 'h', 'hpp', 'hh', 'rc', 's']);

/** 是否为可递归添加的源文件（排除 .cbp / .layout 等工程与布局文件） */
export function isRecursiveSourceFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.endsWith('.cbp') || lower.endsWith('.layout')) return false;
  const dot = lower.lastIndexOf('.');
  if (dot <= 0) return false;
  return RECURSIVE_SOURCE_EXTS.has(lower.slice(dot + 1));
}

/**
 * 递归枚举目录下的可添加源文件。
 * @returns 相对 rootDir 的 POSIX 路径（已按字典序排序）
 */
export function enumerateRecursiveSourceFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 无权限/竞态删除：跳过
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (RECURSIVE_SKIP_DIRS.has(e.name.toLowerCase())) continue;
        walk(path.join(dir, e.name));
      } else if (e.isFile() && isRecursiveSourceFile(e.name)) {
        out.push(path.relative(rootDir, path.join(dir, e.name)).replace(/\\/g, '/'));
      }
    }
  };
  walk(rootDir);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/** XML 属性值转义（对齐 TiXml 写出行为；目标名可能含 & < " 等） */
function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * 生成 <Unit> 节点文本。
 * @param rel  相对项目根的 POSIX 路径
 * @param ext  扩展名（含点，如 '.c'）
 * @param targets 归属目标子集；null/空 = 归属全部目标（不写 Option target，对齐 projectloader.cpp 仅当数量不等才写）
 */
export function buildUnitXmlForTargets(
  rel: string,
  ext: string,
  targets: string[] | null,
  isWin32: boolean = process.platform === 'win32',
): string {
  let compilerVar = 'CPP';
  if (ext === '.c') compilerVar = 'CC';
  else if (ext === '.rc' && isWin32) compilerVar = 'WINDRES';

  const opts: string[] = [];
  if (compilerVar !== 'CPP') opts.push(`\t\t\t<Option compilerVar="${compilerVar}" />`);
  if (targets && targets.length) {
    for (const t of targets) opts.push(`\t\t\t<Option target="${escXml(t)}" />`);
  }
  const filename = escXml(rel);
  if (opts.length === 0) return `\t\t<Unit filename="${filename}" />`;
  return `\t\t<Unit filename="${filename}">\n${opts.join('\n')}\n\t\t</Unit>`;
}
