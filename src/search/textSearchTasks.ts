/**
 * 内容搜索任务（纯 Node，可被 worker_threads 与宿主回退共用）：
 *  - 读取/编码判定/二进制跳过/4MB 上限
 *  - 字节预算文本缓存（mtimeMs + size 校验）
 *  - 并发扫描 + 进度 + 取消
 *
 * 不 import vscode，保证 esbuild 的 worker 产物不会误依赖扩展宿主 API。
 */
import * as fs from 'fs';
import * as path from 'path';
import { decodeTextWithEncoding } from '../tools/encoding';
import {
  ByteBudgetCache,
  findTextMatches,
  looksBinary,
  mapWithConcurrency,
  parseTextQuery,
  TEXT_CACHE_BUDGET_BYTES,
  TEXT_FILE_MATCH_LIMIT,
  TEXT_MAX_FILE_BYTES,
  TEXT_TOTAL_MATCH_LIMIT,
  TextMatch,
  utf16Bom,
} from './projectSearch';

export interface TextSearchFile {
  absolutePath: string;
  projectFilename: string;
  projectTitle: string;
  relativeFilename: string;
  /** 已打开且脏的编辑器文本：优先于磁盘内容（所见即所搜） */
  dirtyText?: string;
}

export type TextFileSkipReason = 'missing' | 'binary' | 'too-large' | 'read-error' | 'limit' | 'cancelled';

export interface TextFileResult {
  file: TextSearchFile;
  matches: TextMatch[];
  skipped?: TextFileSkipReason;
  error?: string;
}

export interface TextSearchProgress {
  scanned: number;
  total: number;
  matches: number;
}

export interface TextSearchOptions {
  query: string;
  caseSensitive?: boolean;
  regex?: boolean;
  /** 全字匹配（仅字面量查询） */
  wholeWord?: boolean;
  maxFileBytes?: number;
  maxFileMatches?: number;
  maxTotalMatches?: number;
  concurrency?: number;
  cache?: ByteBudgetCache<CachedText>;
  signal?: AbortSignal;
  onProgress?: (progress: TextSearchProgress) => void;
}

export interface CachedText {
  mtimeMs: number;
  size: number;
  text: string;
}

export interface TextSearchTaskResult {
  files: TextFileResult[];
  queryError?: string;
  truncated: boolean;
  aborted: boolean;
  total: number;
  scanned: number;
  matchCount: number;
  skipped: Record<TextFileSkipReason, number>;
  durationMs: number;
}

const DEFAULT_CONCURRENCY = 4;

export function defaultTextCache(): ByteBudgetCache<CachedText> {
  return new ByteBudgetCache<CachedText>(TEXT_CACHE_BUDGET_BYTES);
}

function emptySkips(): Record<TextFileSkipReason, number> {
  return { missing: 0, binary: 0, 'too-large': 0, 'read-error': 0, limit: 0, cancelled: 0 };
}

function decodeBuffer(buf: Buffer): string | undefined {
  const bom = utf16Bom(buf);
  if (bom === 'le') return buf.subarray(2).toString('utf16le');
  if (bom === 'be') {
    const body = buf.subarray(2);
    const even = Buffer.alloc(body.length - (body.length % 2));
    body.copy(even, 0, 0, even.length);
    even.swap16();
    return even.toString('utf16le');
  }
  if (looksBinary(buf)) return undefined;
  return decodeTextWithEncoding(buf).text;
}

async function readFileText(
  file: TextSearchFile,
  maxFileBytes: number,
  cache: ByteBudgetCache<CachedText>,
  signal?: AbortSignal,
): Promise<{ text?: string; skipped?: TextFileSkipReason; error?: string }> {
  if (file.dirtyText !== undefined) {
    if (Buffer.byteLength(file.dirtyText, 'utf8') > maxFileBytes) return { skipped: 'too-large' };
    return { text: file.dirtyText };
  }

  const key = path.resolve(file.absolutePath);
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(key);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return { skipped: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'read-error', error: (err as Error).message };
  }
  if (signal?.aborted) return { skipped: 'cancelled' };
  if (!stat.isFile()) return { skipped: 'read-error' };
  if (stat.size > maxFileBytes) return { skipped: 'too-large' };

  const cached = cache.get(key);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return { text: cached.text };
  }
  if (cached) cache.delete(key);

  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(key);
  } catch (err) {
    return { skipped: 'read-error', error: (err as Error).message };
  }
  if (signal?.aborted) return { skipped: 'cancelled' };
  const text = decodeBuffer(buf);
  if (text === undefined) return { skipped: 'binary' };
  cache.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, text }, Buffer.byteLength(text, 'utf8'));
  return { text };
}

/**
 * 扫描一组文件：逐文件读取/缓存/匹配，保留输入顺序，按需上报进度。
 * 取消后返回已完成部分，aborted=true。
 */
export async function searchFileSet(
  files: readonly TextSearchFile[],
  options: TextSearchOptions,
): Promise<TextSearchTaskResult> {
  const started = Date.now();
  const parsed = parseTextQuery(options.query, options.caseSensitive === true, options.wholeWord === true);
  const skipped = emptySkips();
  const empty: TextSearchTaskResult = {
    files: [],
    queryError: parsed.error,
    truncated: false,
    aborted: false,
    total: files.length,
    scanned: 0,
    matchCount: 0,
    skipped,
    durationMs: 0,
  };
  if (parsed.error) return empty;

  const maxFileBytes = Math.max(1024, options.maxFileBytes ?? TEXT_MAX_FILE_BYTES);
  const maxFileMatches = Math.max(1, options.maxFileMatches ?? TEXT_FILE_MATCH_LIMIT);
  const maxTotalMatches = Math.max(1, options.maxTotalMatches ?? TEXT_TOTAL_MATCH_LIMIT);
  const cache = options.cache ?? defaultTextCache();
  const signal = options.signal;
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);

  let scanned = 0;
  let matchCount = 0;
  let truncated = false;
  let lastProgress = 0;

  const results = await mapWithConcurrency<TextSearchFile, TextFileResult>(
    files,
    concurrency,
    async (file) => {
      if (signal?.aborted) {
        skipped.cancelled++;
        return { file, matches: [], skipped: 'cancelled' };
      }
      if (matchCount >= maxTotalMatches) {
        skipped.limit++;
        truncated = true;
        return { file, matches: [], skipped: 'limit' };
      }

      const read = await readFileText(file, maxFileBytes, cache, signal);
      scanned++;
      if (read.skipped) {
        skipped[read.skipped]++;
        if (read.skipped === 'too-large' || read.skipped === 'binary') truncated = truncated || false;
        const now = Date.now();
        if (options.onProgress && now - lastProgress >= 100) {
          lastProgress = now;
          options.onProgress({ scanned, total: files.length, matches: matchCount });
        }
        return { file, matches: [], skipped: read.skipped, error: read.error };
      }

      const found = findTextMatches(read.text ?? '', parsed, {
        maxFileMatches,
        maxTotalMatches: Math.max(1, maxTotalMatches - matchCount),
      });
      let matches = found.matches;
      if (matchCount + matches.length > maxTotalMatches) {
        matches = matches.slice(0, Math.max(0, maxTotalMatches - matchCount));
        truncated = true;
      }
      if (found.truncated) truncated = true;
      matchCount += matches.length;

      const now = Date.now();
      if (options.onProgress && now - lastProgress >= 100) {
        lastProgress = now;
        options.onProgress({ scanned, total: files.length, matches: matchCount });
      }
      return { file, matches };
    },
    signal,
  );

  options.onProgress?.({ scanned, total: files.length, matches: matchCount });
  return {
    files: results,
    truncated,
    aborted: signal?.aborted === true,
    total: files.length,
    scanned,
    matchCount,
    skipped,
    durationMs: Date.now() - started,
  };
}

/** 供 worker 测试/诊断：解码单个 buffer（不读盘） */
export function decodeTextBuffer(buf: Buffer): string | undefined {
  return decodeBuffer(buf);
}
