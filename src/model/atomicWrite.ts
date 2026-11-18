/**
 * 原子写文件 —— 避免 `.cbp` / `.workspace` 在保存过程中被中断后留下截断文件。
 *
 * 实现：同目录临时文件 → `fs.renameSync` 覆盖目标。Windows 上 rename 覆盖已存在文件
 * 由 Node（MoveFileEx REPLACE_EXISTING）完成；杀毒/索引器短暂占用会抛 EPERM/EBUSY，
 * 这里做有限重试，仍失败则清理临时文件并抛出，原文件保持不变。
 */
import * as fs from 'fs';
import * as path from 'path';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

function tmpName(file: string): string {
  const dir = path.dirname(file);
  const base = path.basename(file);
  return path.join(dir, `.${base}.${process.pid}.${Date.now()}.tmp`);
}

function tryRename(from: string, to: string): void {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (err) {
      last = err;
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (!RETRYABLE.has(code)) throw err;
      // 同步重试：短忙等，避免把保存流程改成异步（调用方均为同步序列化路径）
      const until = Date.now() + 15 * (attempt + 1);
      while (Date.now() < until) { /* spin */ }
    }
  }
  throw last;
}

/**
 * 原子写文本/二进制文件。
 * @param file 目标文件（目录必须已存在）
 * @param data 文本或 Buffer
 * @param encoding 文本编码（默认 utf-8；传 Buffer 时忽略）
 */
export function writeFileAtomicSync(file: string, data: string | Buffer, encoding: BufferEncoding = 'utf-8'): void {
  const tmp = tmpName(file);
  try {
    fs.writeFileSync(tmp, data, typeof data === 'string' ? encoding : undefined);
    tryRename(tmp, file);
  } finally {
    // rename 成功后临时文件已不存在；写入失败时清理半成品
    try { fs.unlinkSync(tmp); } catch { /* 不存在/已被 rename */ }
  }
}
