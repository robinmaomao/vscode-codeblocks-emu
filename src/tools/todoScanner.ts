/**
 * TODO 扫描器 —— 对应 todo_parser.cpp ParseBufferForTODOs
 *
 * 移植自 codeblocks-src/src/plugins/todo/todo_parser.cpp（GPL v3，逻辑独立重写）。
 * 在源码注释中查找 TODO/FIXME/NOTE 等标记。
 */
import * as fs from 'fs';

export interface TodoItem {
  type: string;       // TODO / FIXME / NOTE ...
  text: string;
  user?: string;
  filename: string;
  line: number;       // 1-based
  priority: number;
  date?: string;
}

export interface TodoOptions {
  /** 触发标记，如 ["TODO", "FIXME", "NOTE", "HACK"] */
  startStrings: string[];
  /** 允许的类型（与 startStrings 对应） */
  allowedTypes: string[];
}

const DEFAULT_TODO_OPTIONS: TodoOptions = {
  startStrings: ['TODO', 'FIXME', 'NOTE', 'HACK', 'XXX'],
  allowedTypes: ['TODO', 'FIXME', 'NOTE', 'HACK', 'XXX'],
};

/**
 * 解析文本中的 TODO 项。
 * 对应 ParseBufferForTODOs：逐个 startString 查找，识别 user/priority/date，
 * 提取到行尾，处理块注释结尾。
 */
export function parseBufferForTodos(
  buffer: string,
  filename: string,
  opts: TodoOptions = DEFAULT_TODO_OPTIONS,
): TodoItem[] {
  const items: TodoItem[] = [];
  const { startStrings, allowedTypes } = opts;

  // 预处理：行号映射
  const lines = buffer.split(/\r?\n/);

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // 只在注释中出现才算（含行内注释）
    const commentPos = findCommentStart(line);
    if (commentPos < 0) continue;
    const commentText = line.slice(commentPos);

    for (let k = 0; k < startStrings.length; k++) {
      const marker = startStrings[k];
      const pos = commentText.indexOf(marker);
      if (pos < 0) continue;

      // 提取标记后的内容到行尾
      let text = commentText.slice(pos + marker.length).trim();
      // 去掉开头的冒号/冒号+空格
      text = text.replace(/^:?\s*/, '');
      // 去掉块注释结尾 */
      text = text.replace(/\*\/\s*$/, '').trim();

      const type = allowedTypes[k] ?? marker;

      let priority = 0;
      let user: string | undefined;
      let date: string | undefined;

      // 解析优先级：(1) 形式
      const prioMatch = text.match(/^\((\d+)\)\s*/);
      if (prioMatch) {
        priority = Number(prioMatch[1]);
        text = text.slice(prioMatch[0].length);
      }

      // 解析用户：user: 形式（可选）
      const userMatch = text.match(/^([A-Za-z0-9_.-]+):\s*/);
      if (userMatch && !isDateLike(userMatch[1])) {
        user = userMatch[1];
        text = text.slice(userMatch[0].length);
      }

      // 解析日期：YYYY-MM-DD 或 YYYY/MM/DD
      const dateMatch = text.match(/^(\d{4}[-/]\d{2}[-/]\d{2})\s*/);
      if (dateMatch) {
        date = dateMatch[1];
        text = text.slice(dateMatch[0].length);
      }

      items.push({
        type,
        text,
        user,
        filename,
        line: lineIdx + 1,
        priority,
        date,
      });
      break; // 一行只记录第一个匹配的标记
    }
  }

  return items;
}

/** 查找注释起始位置（// 或 /*），未在注释中返回 -1 */
function findCommentStart(line: string): number {
  const lineComment = line.indexOf('//');
  const blockComment = line.indexOf('/*');
  if (lineComment >= 0 && blockComment >= 0) {
    return Math.min(lineComment, blockComment);
  }
  return lineComment >= 0 ? lineComment : blockComment;
}

function isDateLike(s: string): boolean {
  return /^\d{4}[-/]\d{2}[-/]\d{2}$/.test(s);
}

/** 扫描文件列表中的所有 TODO */
export function scanTodos(files: string[], opts: TodoOptions = DEFAULT_TODO_OPTIONS): TodoItem[] {
  const result: TodoItem[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      result.push(...parseBufferForTodos(content, file, opts));
    } catch {
      // 忽略不可读文件
    }
  }
  return result;
}
