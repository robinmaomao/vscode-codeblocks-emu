/**
 * 头文件保护生成（headerguard 插件移植，第一波 D1）
 *
 * 纯函数：宏生成 / 已有保护检测 / 包装插入（幂等）。
 * 命令侧（extension.ts）：`codeblocks.insertHeaderGuard` + 设置 `codeblocks.editor.autoHeaderGuard`。
 */
import * as path from 'path';

/** 由文件名生成保护宏（大写、非字母数字→_；对齐 headerguard 插件 `__FILE_H__` 风格） */
export function headerGuardMacro(fsPath: string): string {
  const base = path.basename(fsPath).replace(/\.[^.]+$/, '');
  const macro = base.replace(/[^A-Za-z0-9]/g, '_').toUpperCase();
  return `__${macro}_H__`;
}

/** 是否已有保护（前 30 行内 #pragma once / #ifndef；大小写不敏感） */
export function hasHeaderGuard(text: string): boolean {
  const head = text.split(/\r?\n/, 30).join('\n');
  return /^\s*#\s*pragma\s+once\b/im.test(head) || /^\s*#\s*ifndef\b/im.test(head);
}

/**
 * 生成插入保护后的全文（默认顶部 `#ifndef/#define` + 底部 `#endif`；style='pragma-once' 仅顶部 `#pragma once`；已有保护返回 null）。
 * 换行符跟随原文（LF/CRLF）；尾部空行归一。
 */
export function applyHeaderGuard(fsPath: string, text: string, style: 'ifndef' | 'pragma-once' = 'ifndef'): string | null {
  if (hasHeaderGuard(text)) return null;
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const trimmed = text.replace(/\s+$/, '');
  if (style === 'pragma-once') {
    return trimmed ? `#pragma once${eol}${eol}${trimmed}${eol}` : `#pragma once${eol}`;
  }
  const macro = headerGuardMacro(fsPath);
  const top = `#ifndef ${macro}${eol}#define ${macro}${eol}${eol}`;
  const bottom = trimmed ? `${eol}${eol}#endif // ${macro}${eol}` : `#endif // ${macro}${eol}`;
  return top + trimmed + bottom;
}
