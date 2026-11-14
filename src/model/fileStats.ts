/**
 * 文件属性对话框（CB `ProjectFileOptionsDlg`）所需的文件统计与对象名计算。
 *
 * 对齐：
 *  - `projectfileoptionsdlg.cpp` FillGeneralProperties / CountLines / AnalyseLine（总行 / 空行 / 代码行 / 注释行 / 大小 / 时间戳 / 只读）
 *  - `projectfile.cpp` SetObjName / GetObjName（对象文件名，含 extended_obj_names 与 PCH 规则）
 */
import * as fs from 'fs';
import * as path from 'path';

export interface FileStatistics {
  /** 是否有行数统计（CB 仅对已知高亮语言统计；未知语言留空） */
  counted: boolean;
  totalLines: number;
  emptyLines: number;
  /** 实际代码行（含“代码 + 注释”混合行，对齐 CB code_lines + codecomments_lines） */
  codeLines: number;
  commentLines: number;
  fileSize: number;
  /** DD/MM/YYYY HH:MM:SS（对齐 CB 的 _("%02hd/%02hd/%d %02hd:%02hd:%02hd")） */
  modified: string;
  readOnly: boolean;
}

interface CommentToken {
  line: string;
  blockStart: string;
  blockEnd: string;
}

const C_STYLE: CommentToken = { line: '//', blockStart: '/*', blockEnd: '*/' };
const NONE: CommentToken = { line: '', blockStart: '', blockEnd: '' };

/** 按扩展名取注释标记（对齐 EditorColourSet::GetCommentToken 的 C/C++ 系列；未知语言无注释） */
export function commentTokenFor(filename: string): CommentToken {
  const ext = path.extname(filename).toLowerCase();
  if (['.c', '.cc', '.cpp', '.cxx', '.c++', '.h', '.hh', '.hpp', '.hxx', '.h++', '.inl', '.inc', '.rc', '.rc2', '.m', '.mm'].includes(ext)) {
    return C_STYLE;
  }
  return NONE;
}

interface LineState {
  comment: boolean;
  code: boolean;
  inBlock: boolean;
}

/**
 * 单行注释分析（逐字符复刻 CB AnalyseLine 的判定顺序与累积语义）。
 * 入参 line 已 trim；状态在递归中累积（comment/code 一旦置位保持）。
 */
function analyseLine(token: CommentToken, line: string, st: LineState): void {
  if (!line) return;
  const single = token.line ? line.indexOf(token.line) : -1;
  const begin = token.blockStart ? line.indexOf(token.blockStart) : -1;
  const end = token.blockEnd ? line.indexOf(token.blockEnd) : -1;
  if (st.inBlock) {
    st.comment = true;
    if (end > -1) {
      st.inBlock = false;
      const rest = line.slice(end + token.blockEnd.length);
      if (rest.length) analyseLine(token, rest, st);
    }
  } else if (single > -1 && (begin === -1 || single < begin)) {
    st.comment = true;
    if (single > 0) st.code = true;
  } else if (begin > -1) {
    st.inBlock = true;
    st.comment = true;
    if (begin > 0) st.code = true;
    const rest = line.slice(begin + token.blockStart.length);
    if (rest.length) analyseLine(token, rest, st);
  } else {
    st.code = true;
  }
}

/** 读取文件统计；文件不存在返回 null（CB：FillGeneralProperties 直接 return，字段留空） */
export function analyzeFile(absPath: string): FileStatistics | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;

  let text = '';
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    text = '';
  }
  const token = commentTokenFor(absPath);
  const counted = token.line !== '' || token.blockStart !== '';
  const lines = text.length ? text.split(/\r?\n/) : [];
  // split 会在结尾换行时多出一个空串：CB 的 wxTextFile 不把结尾换行算成额外一行
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  let emptyLines = 0;
  let codeLines = 0;
  let commentLines = 0;
  if (counted) {
    const state: LineState = { comment: false, code: false, inBlock: false };
    for (const raw of lines) {
      const line = raw.trim();
      if (!line) {
        emptyLines++;
        continue;
      }
      state.comment = false;
      state.code = false;
      analyseLine(token, line, state);
      // CB：comment && code → codecomments_lines（计入「Actual Code Lines」）
      if (state.code) codeLines++;
      else if (state.comment) commentLines++;
    }
  }

  const d = stat.mtime;
  const pad = (n: number) => String(n).padStart(2, '0');
  const modified = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  let readOnly = false;
  try {
    fs.accessSync(absPath, fs.constants.W_OK);
  } catch {
    readOnly = true;
  }

  return { counted, totalLines: lines.length, emptyLines, codeLines, commentLines, fileSize: stat.size, modified, readOnly };
}

/** 目标对象文件名用的扩展名（资源文件恒为 res，其余取编译器 objectExtension） */
function isResourceFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.rc' || ext === '.rc2';
}

function isHeaderFile(filename: string): boolean {
  return ['.h', '.hh', '.hpp', '.hxx', '.h++', '.inl', '.inc'].includes(path.extname(filename).toLowerCase());
}

/** 替换扩展名（保留目录部分） */
function replaceExt(name: string, ext: string): string {
  const dir = path.posix.dirname(name);
  const base = path.posix.basename(name);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  const next = `${stem}.${ext}`;
  return dir === '.' ? next : `${dir}/${next}`;
}

export interface ObjectNameOptions {
  /** <Option extended_obj_names> */
  extendedObjectNames: boolean;
  objectExtension: string;
  supportsPch: boolean;
  pchExtension: string;
  /** PCHMode.pchSourceFile */
  pchSourceFile: boolean;
  relativeFilename: string;
}

/**
 * 对象文件名（对齐 ProjectFile::GetObjName/SetObjName；不存在的文件仍按规则给出名字）。
 * 输入 base 为 relativeToCommonTopLevelPath（无 `..`），输出使用 `/` 分隔。
 */
export function objectNameFor(base: string, opts: ObjectNameOptions): string {
  if (isResourceFile(base)) {
    return opts.extendedObjectNames ? `${base}.res` : replaceExt(base, 'res');
  }
  if (isHeaderFile(base)) {
    if (!opts.supportsPch) return base;
    // PCH 始终使用扩展名模式（CB: fname.SetName(fname.GetFullName()) → 追加 .gch）
    const source = opts.pchSourceFile ? opts.relativeFilename : base;
    return `${source.replace(/\\/g, '/')}.${opts.pchExtension}`;
  }
  return opts.extendedObjectNames ? `${base}.${opts.objectExtension}` : replaceExt(base, opts.objectExtension);
}
