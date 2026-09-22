/**
 * 错误/警告行解析 —— 对应 compiler.h RegExStruct + options_common_re.xml
 *
 * 移植自 codeblocks-src/src/plugins/compilergcc/resources/compilers/options_common_re.xml（GPL v3）。
 * 将 POSIX 字符类 [[:blank:]] 等转换为 JS 正则等价，并映射为 VS Code Diagnostic。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { CompilerLineType } from '../model/types';
import { RegExStruct } from '../compiler/compiler';

/** GCC 默认错误正则（options_common_re.xml 核心条目） */
export function getDefaultRegexes(): RegExStruct[] {
  // 将 wxRegEx 的 POSIX 字符类转成 JS：
  //   - [\\] 表示字面 ']'（wxRegEx 字符类开头的 ']' 是字面字符）
  //   - 含 " \\t" 空白以匹配带空格的路径（如 "VSCode Workstation"）
  const PATHCHARS = '[\\][{}() \\t#%$~A-Za-z0-9\\u0080-\\uFFFF!&_:+/\\\\.,;=@^\'`-]';
  const FILE = `"?(${PATHCHARS}+)"?`;
  const BLANK = '[ \\t]';
  const COL = ':';
  return [
    { desc: 'Fatal error', lt: 'error', msg: [1], filename: 0, line: 0, regex: `FATAL:${BLANK}*(.*)` },
    { desc: 'Preprocessor error', lt: 'error', msg: [3], filename: 1, line: 2, regex: `${FILE}${COL}([0-9]+)${COL}[0-9]+${COL}${BLANK}(.*)` },
    { desc: 'Compiler warning', lt: 'warning', msg: [3], filename: 1, line: 2, regex: `${FILE}${COL}([0-9]+)${COL}[0-9]+${COL}${BLANK}([Ww]arning:${BLANK}.*)` },
    { desc: 'Compiler error', lt: 'error', msg: [3], filename: 1, line: 2, regex: `${FILE}${COL}([0-9]+)${COL}[0-9]+${COL}${BLANK}(.*)` },
    { desc: 'Undefined reference', lt: 'error', msg: [3], filename: 1, line: 2, regex: `"?${PATHCHARS}+\\.o"?:${FILE}:([0-9]+):${BLANK}(undefined reference.*)` },
    { desc: 'Linker error', lt: 'error', msg: [3], filename: 1, line: 2, regex: `${FILE}${COL}([0-9]+)${COL}[0-9]+${COL}${BLANK}(.*)` },
    { desc: 'Linker error (lib not found)', lt: 'error', msg: [2], filename: 1, line: 0, regex: `.*(ld.*):${BLANK}(cannot find.*)` },
    { desc: 'Linker error (cannot open output file)', lt: 'error', msg: [2, 3], filename: 1, line: 0, regex: `.*(ld.*):${BLANK}(cannot open output file.*):${BLANK}(.*)` },
    { desc: 'Linker error (unrecognized option)', lt: 'error', msg: [2], filename: 1, line: 0, regex: `.*(ld.*):${BLANK}(unrecognized option.*)` },
    { desc: 'No such file or directory', lt: 'error', msg: [2], filename: 1, line: 0, regex: `.*:(.*):${BLANK}(No such file or directory.*)` },
    { desc: 'Undefined reference (plain)', lt: 'error', msg: [2], filename: 1, line: 0, regex: `${FILE}${COL}${BLANK}(undefined reference.*)` },
    { desc: 'General error', lt: 'error', msg: [1], filename: 0, line: 0, regex: `([Ee]rror:${BLANK}.*)` },
    { desc: 'General warning', lt: 'warning', msg: [1], filename: 0, line: 0, regex: `([Ww]arning:${BLANK}.*)` },
  ];
}

/** 解析结果 */
export interface ParsedLine {
  type: CompilerLineType;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

/** 把 XML 里的 lt 字符串（'error'/'warning'/'info'/'normal'）归一化为 CompilerLineType 枚举值 */
function normalizeLineType(lt: string | number): CompilerLineType {
  if (typeof lt === 'number') return lt as CompilerLineType;
  switch (String(lt).toLowerCase()) {
    case 'warning': return CompilerLineType.Warning;
    case 'error': return CompilerLineType.Error;
    case 'info': return CompilerLineType.Info;
    default: return CompilerLineType.Normal;
  }
}

/** 编译输出解析器 */
export class OutputParser {
  private regexes: { re: RegExp; struct: RegExStruct }[];

  constructor(regexes: RegExStruct[] = getDefaultRegexes()) {
    this.regexes = regexes
      .map((struct) => {
        try {
          return { re: new RegExp(struct.regex), struct };
        } catch {
          return null;
        }
      })
      .filter((x): x is { re: RegExp; struct: RegExStruct } => x !== null);
  }

  /** 解析一行编译输出 */
  parseLine(line: string): ParsedLine | null {
    for (const { re, struct } of this.regexes) {
      const m = line.match(re);
      if (!m) continue;

      // 收集消息（msg[0..2] 子表达式拼接，空格分隔）
      const msgParts = struct.msg
        .map((idx) => m[idx])
        .filter((x) => x !== undefined)
        .join(' ');
      const file = struct.filename ? m[struct.filename] : undefined;
      const lineNum = struct.line ? Number(m[struct.line]) : undefined;
      // 列号：GCC 格式 file:line:col: message，正则未捕获 col，命中 file+line 后二次提取
      let column: number | undefined;
      if (file && lineNum && !Number.isNaN(lineNum)) {
        const colMatch = line.match(/:\d+:(\d+):/);
        column = colMatch ? Number(colMatch[1]) : undefined;
        if (column !== undefined && Number.isNaN(column)) column = undefined;
      }

      return {
        type: normalizeLineType(struct.lt),
        message: msgParts || line,
        file,
        line: lineNum && !Number.isNaN(lineNum) ? lineNum : undefined,
        column,
      };
    }
    return null;
  }

  /** 将一行输出转换为 VS Code Diagnostic（file 解析为绝对路径，供 Problems 面板正确定位） */
  toDiagnostic(line: string, cwd: string): vscode.Diagnostic | null {
    const parsed = this.parseLine(line);
    if (!parsed) return null;

    const sev = parsed.type === CompilerLineType.Error
      ? vscode.DiagnosticSeverity.Error
      : parsed.type === CompilerLineType.Warning
        ? vscode.DiagnosticSeverity.Warning
        : parsed.type === CompilerLineType.Info
          ? vscode.DiagnosticSeverity.Information
          : vscode.DiagnosticSeverity.Hint;

    // 行号从 1 开始转 0 基；列号从 1 开始转 0 基（无列号则整行高亮）
    const line0 = parsed.line && parsed.line > 0 ? parsed.line - 1 : 0;
    const col0 = parsed.column && parsed.column > 0 ? parsed.column - 1 : 0;
    const range = parsed.line
      ? (parsed.column
        ? new vscode.Range(line0, col0, line0, col0 + 1)
        : new vscode.Range(line0, 0, line0, Number.MAX_SAFE_INTEGER))
      : new vscode.Range(0, 0, 0, 0);

    const diag = new vscode.Diagnostic(range, parsed.message, sev);
    diag.source = 'Code::Blocks';
    return diag;
  }

  /** 解析诊断对应的文件绝对路径（供 Problems 面板分组） */
  resolveFileUri(line: string, cwd: string): vscode.Uri | undefined {
    const parsed = this.parseLine(line);
    if (!parsed?.file) return undefined;
    const absFile = path.isAbsolute(parsed.file) ? parsed.file : path.join(cwd, parsed.file);
    return vscode.Uri.file(absFile);
  }
}
