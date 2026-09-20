/**
 * 代码统计 —— 对应 Code::Blocks 的代码统计插件（行数/注释/空行）
 *
 * 逻辑独立重写。统计每个源文件的代码行、注释行、空行、总行数。
 */
import * as fs from 'fs';

export interface CodeStats {
  filename: string;
  total: number;
  code: number;
  comment: number;
  blank: number;
}

export interface AggregateStats {
  files: number;
  total: number;
  code: number;
  comment: number;
  blank: number;
}

/** 统计单个文件的代码行/注释行/空行 */
export function countFile(filename: string): CodeStats {
  const content = fs.readFileSync(filename, 'utf-8');
  const lines = content.split(/\r?\n/);

  let code = 0;
  let comment = 0;
  let blank = 0;
  let inBlockComment = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line === '') {
      blank++;
      continue;
    }

    if (inBlockComment) {
      comment++;
      if (line.includes('*/')) {
        inBlockComment = false;
      }
      continue;
    }

    // 块注释开始
    if (line.startsWith('/*')) {
      comment++;
      if (!line.includes('*/')) {
        inBlockComment = true;
      }
      continue;
    }

    // 行注释
    if (line.startsWith('//') || line.startsWith('#')) {
      comment++;
      continue;
    }

    // 行内注释（如 `int x; // 注释`）按代码行计
    code++;
  }

  return {
    filename,
    total: lines.length,
    code,
    comment,
    blank,
  };
}

/** 统计多个文件并聚合 */
export function countFiles(files: string[]): { perFile: CodeStats[]; aggregate: AggregateStats } {
  const perFile: CodeStats[] = [];
  const aggregate: AggregateStats = { files: 0, total: 0, code: 0, comment: 0, blank: 0 };

  for (const file of files) {
    try {
      const s = countFile(file);
      perFile.push(s);
      aggregate.files++;
      aggregate.total += s.total;
      aggregate.code += s.code;
      aggregate.comment += s.comment;
      aggregate.blank += s.blank;
    } catch {
      // 忽略不可读文件
    }
  }

  return { perFile, aggregate };
}

/** 根据扩展名判断是否为可统计的源代码文件 */
export function isSourceFile(rel: string): boolean {
  return /\.(c|cpp|cc|cxx|h|hpp|hh|hxx|java|py|js|ts|cs|rs|go|rb|php)$/i.test(rel);
}
