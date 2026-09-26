/**
 * 书签（R10）—— 对齐 Code::Blocks Edit → Bookmarks（main_menu.xrc:192-210）：
 * Toggle bookmark / Goto previous bookmark / Goto next bookmark / Clear all bookmarks。
 *
 * 纯逻辑模块（无 vscode 依赖）：书签表操作、排序与前后跳转、行漂移定位。
 * 存储由调用方负责（workspaceState；文本一并保存以便行号漂移时按内容找回）。
 */

export interface Bookmark {
  /** 文件绝对路径（统一小写比较用 bmKey） */
  file: string;
  /** 1-based 行号 */
  line: number;
  /** 该行去除首尾空白后的文本（行漂移回找依据） */
  text: string;
}

/** 书签唯一键（文件 + 行） */
export function bmKey(file: string, line: number): string {
  return `${file.toLowerCase()}#${line}`;
}

/** 切换书签：同行已存在 → 移除；否则新增（并更新文本） */
export function toggleBookmark(list: Bookmark[], file: string, line: number, text: string): { list: Bookmark[]; added: boolean } {
  const idx = list.findIndex((b) => bmKey(b.file, b.line) === bmKey(file, line));
  if (idx >= 0) {
    const next = [...list];
    next.splice(idx, 1);
    return { list: next, added: false };
  }
  return { list: [...list, { file, line, text: text.trim() }], added: true };
}

/** 移除指定文件全部书签 */
export function clearFileBookmarks(list: Bookmark[], file: string): Bookmark[] {
  return list.filter((b) => b.file.toLowerCase() !== file.toLowerCase());
}

/** 排序视图：按文件（忽略大小写）→ 行号 */
export function sortedBookmarks(list: Bookmark[]): Bookmark[] {
  return [...list].sort((a, b) => {
    const fa = a.file.toLowerCase();
    const fb = b.file.toLowerCase();
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.line - b.line;
  });
}

/** 位置比较：负 = a 在 b 前 */
function comparePos(aFile: string, aLine: number, bFile: string, bLine: number): number {
  const fa = aFile.toLowerCase();
  const fb = bFile.toLowerCase();
  if (fa !== fb) return fa < fb ? -1 : 1;
  return aLine - bLine;
}

/** 下一个书签（严格晚于当前位置；越界回绕到首个，对齐编辑器书签习惯） */
export function nextBookmark(list: Bookmark[], file: string, line: number): Bookmark | undefined {
  const sorted = sortedBookmarks(list);
  if (!sorted.length) return undefined;
  return sorted.find((b) => comparePos(b.file, b.line, file, line) > 0) ?? sorted[0];
}

/** 上一个书签（严格早于当前位置；越界回绕到末个） */
export function prevBookmark(list: Bookmark[], file: string, line: number): Bookmark | undefined {
  const sorted = sortedBookmarks(list);
  if (!sorted.length) return undefined;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (comparePos(sorted[i].file, sorted[i].line, file, line) < 0) return sorted[i];
  }
  return sorted[sorted.length - 1];
}

/**
 * 行漂移回找：优先精确行号（文本匹配）；否则 ±半径内查找同文本行；再退回原行号。
 * @returns 1-based 行号
 */
export function locateBookmarkLine(bm: Bookmark, lines: string[], radius = 50): number {
  const norm = (s: string | undefined): string => String(s ?? '').trim();
  const target = norm(bm.text);
  const at = bm.line - 1;
  if (at >= 0 && at < lines.length && norm(lines[at]) === target) return bm.line;
  for (let d = 1; d <= radius; d++) {
    const up = at - d;
    if (up >= 0 && up < lines.length && norm(lines[up]) === target) return up + 1;
    const down = at + d;
    if (down >= 0 && down < lines.length && norm(lines[down]) === target) return down + 1;
  }
  return Math.min(Math.max(1, bm.line), Math.max(1, lines.length));
}
