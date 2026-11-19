/**
 * TODO 扫描器 —— 对应 todo_parser.cpp ParseBufferForTODOs
 *
 * 移植自 codeblocks-src/src/plugins/todo/todo_parser.cpp（GPL v3，逻辑独立重写）。
 * 在源码注释中查找 TODO/FIXME/NOTE 等标记。
 */
import * as fs from 'fs';
import * as path from 'path';

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
  /** .asm/.s 是否使用 GAS 原生 `#` 行注释（对应 codeblocks.editor.asmHashComment） */
  asmHashComment?: boolean;
}

interface CommentSyntax {
  /** 行注释起始符（按行内最早出现者判定） */
  line: string[];
  /** 仅允许出现在行首（允许缩进与可选 `@`）的注释起始符，大小写不敏感 */
  lineAtStart?: string[];
  /** 块注释起止符 */
  block?: [string, string];
  /** 汇编 `#` 模式下跳过 C 预处理器指令（.S 经 cpp 时 `#define TODO` 不是注释） */
  hashDirectiveGuard?: boolean;
}

/** 按文件扩展名选择注释语法；未知扩展名保持 C/C++ 风格默认行为 */
function commentSyntaxFor(filename: string, opts: TodoOptions): CommentSyntax {
  const ext = path.extname(String(filename ?? '')).toLowerCase();
  switch (ext) {
    case '.ld':
    case '.lcf':
      // GNU ld 原生行注释是 #；保留 // 以兼容 F-02 修复前的既有行为
      return { line: ['#', '//'], block: ['/*', '*/'] };
    case '.xm':
      return { line: ['#', '//'] };
    case '.asm':
    case '.s':
      return {
        line: opts.asmHashComment === true ? ['#', '//'] : ['//'],
        block: ['/*', '*/'],
        hashDirectiveGuard: opts.asmHashComment === true,
      };
    case '.bat':
    case '.cmd':
      return { line: [], lineAtStart: ['REM', '::'] };
    default:
      return { line: ['//'], block: ['/*', '*/'] };
  }
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
  const syntax = commentSyntaxFor(filename, opts);

  // 预处理：行号映射
  const lines = buffer.split(/\r?\n/);
  let inBlockComment = false;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    // 只在注释中出现才算（含行内注释）；支持跨行块注释
    let commentText: string;
    if (inBlockComment) {
      const end = syntax.block ? line.indexOf(syntax.block[1]) : -1;
      commentText = end >= 0 ? line.slice(0, end) : line;
      if (end >= 0) inBlockComment = false;
    } else {
      const commentPos = findCommentStart(line, syntax);
      if (commentPos < 0) continue;
      commentText = line.slice(commentPos);
      if (syntax.block && commentText.startsWith(syntax.block[0]) && !commentText.includes(syntax.block[1])) {
        inBlockComment = true;
      }
    }

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

/** 查找注释起始位置；按文件语言选择 `//`、`#`、`REM`/`::` 或 `/*` */
function findCommentStart(line: string, syntax: CommentSyntax): number {
  const candidates: number[] = [];
  for (const token of syntax.line) {
    if (syntax.hashDirectiveGuard && token === '#'
      && /^\s*#\s*(?:include|define|if|ifdef|ifndef|elif|else|endif|undef|pragma|error|warning|line)\b/i.test(line)) {
      continue;
    }
    const idx = line.indexOf(token);
    if (idx >= 0) candidates.push(idx);
  }
  for (const token of syntax.lineAtStart ?? []) {
    const pattern = token === '::'
      ? /^\s*@?\s*::/
      : new RegExp(`^\\s*@?\\s*${token}\\b`, 'i');
    const match = pattern.exec(line);
    if (match) candidates.push(match.index + match[0].length - token.length);
  }
  if (syntax.block) {
    const idx = line.indexOf(syntax.block[0]);
    if (idx >= 0) candidates.push(idx);
  }
  return candidates.length ? Math.min(...candidates) : -1;
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
