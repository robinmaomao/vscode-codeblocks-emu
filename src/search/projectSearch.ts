/**
 * 工程内搜索纯逻辑（无 vscode 依赖）：
 *  - 文件模式：只使用已打开 .cbp 的 ProjectFile 列表（内存排序，零 I/O）
 *  - 内容模式：查询解析 / 逐行匹配 / 预览截断（供 worker 与宿主回退共用）
 *  - 内容缓存：字节预算 LRU
 *
 * 行列约定：核心统一 0-based（与 vscode.Position 一致），UI 显示时 +1。
 */
import * as path from 'path';
import { Project, ProjectFile } from '../model/types';

export type ProjectSearchScope = 'openProjects' | 'activeProject';
export type ProjectSearchMode = 'files' | 'text';

/** 文件搜索条目（provider 缓存；路径均已归一化为正斜杠） */
export interface SearchEntry {
  projectTitle: string;
  projectFilename: string;
  projectBasePath: string;
  relativePath: string;
  absolutePath: string;
  basename: string;
  normalizedPath: string;
  normalizedBasename: string;
  isActive: boolean;
}

export interface SearchMatchRange {
  start: number;
  length: number;
}

export interface FileSearchHit {
  entry: SearchEntry;
  score: number;
  ranges: SearchMatchRange[];
}

export interface TextMatch {
  /** 0-based 行号 */
  line: number;
  /** 0-based 列（UTF-16 code unit） */
  column: number;
  length: number;
  preview: string;
  previewStart: number;
  previewLength: number;
}

export interface TextQuery {
  kind: 'literal' | 'regex';
  source: string;
  regex: RegExp;
  error?: string;
}

export interface FindTextOptions {
  caseSensitive?: boolean;
  maxFileMatches?: number;
  maxTotalMatches?: number;
  maxPreviewLength?: number;
  /** 正则模式下单行最大长度（防灾难性回溯放大） */
  maxRegexLineLength?: number;
}

export interface FindTextResult {
  matches: TextMatch[];
  truncated: boolean;
}

export const FILE_SEARCH_LIMIT = 500;
export const TEXT_TOTAL_MATCH_LIMIT = 500;
export const TEXT_FILE_MATCH_LIMIT = 50;
export const TEXT_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const TEXT_CACHE_BUDGET_BYTES = 32 * 1024 * 1024;
export const TEXT_MAX_QUERY_LENGTH = 300;
export const FILE_MAX_QUERY_LENGTH = 200;
export const TEXT_MAX_REGEX_LINE_LENGTH = 4000;

/** 归一化路径：正斜杠、小写（Windows 大小写不敏感；用于比较/排序/去重） */
export function normalizeSearchPath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').toLowerCase();
}

/** 显示用路径：只把反斜杠换成正斜杠，保留大小写 */
export function displaySearchPath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/');
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function activeProjectFilename(projects: Project[], activeFilename: string | undefined): string {
  const wanted = normalizeSearchPath(activeFilename ?? '');
  if (wanted && projects.some((p) => normalizeSearchPath(p.filename) === wanted)) return wanted;
  return '';
}

function rawProjectTitle(project: Project): string {
  return String(project.title ?? '').trim() || path.basename(project.filename || '') || project.filename;
}

/**
 * 工程显示名：
 *  - 默认用 .cbp 的 title；
 *  - 多个工程 title 相同（如 earphone/app.cbp 与 esop8/app.cbp 的 title 都是 app）时，
 *    改用 .cbp 所在目录名区分，否则搜索结果会合并出两个都叫 app 的分组。
 */
export function projectDisplayTitle(projects: Project[], project: Project): string {
  const title = rawProjectTitle(project);
  const duplicates = projects.filter((p) => rawProjectTitle(p).toLowerCase() === title.toLowerCase());
  if (duplicates.length <= 1) return title;
  const folder = path.basename(path.dirname(project.filename || ''));
  return folder && folder.toLowerCase() !== title.toLowerCase() ? folder : title;
}

function projectEntries(project: Project, isActive: boolean, projectTitle: string): SearchEntry[] {
  const out: SearchEntry[] = [];
  for (const file of project.files ?? []) {
    const relativePath = displaySearchPath(file.relativeFilename || path.basename(file.absolutePath));
    const absolutePath = displaySearchPath(file.absolutePath);
    const basename = path.posix.basename(relativePath);
    out.push({
      projectTitle,
      projectFilename: project.filename,
      projectBasePath: displaySearchPath(project.basePath),
      relativePath,
      absolutePath,
      basename,
      normalizedPath: normalizeSearchPath(relativePath),
      normalizedBasename: basename.toLowerCase(),
      isActive,
    });
  }
  return out;
}

/**
 * 构建文件搜索条目：按活动工程优先排序；跨工程重复路径去重（活动工程优先）。
 *
 * 只读工程模型，不调用 workspace.findFiles、不访问磁盘。
 */
export function buildSearchEntries(
  projects: Project[],
  activeFilename: string | undefined,
  scope: ProjectSearchScope = 'openProjects',
): SearchEntry[] {
  const active = activeProjectFilename(projects, activeFilename);
  const selected = scope === 'activeProject'
    ? (active ? projects.filter((p) => normalizeSearchPath(p.filename) === active) : [])
    : projects;
  const ordered = [...selected].sort((a, b) => {
    const aActive = normalizeSearchPath(a.filename) === active ? 1 : 0;
    const bActive = normalizeSearchPath(b.filename) === active ? 1 : 0;
    return bActive - aActive;
  });

  const seen = new Set<string>();
  const out: SearchEntry[] = [];
  for (const project of ordered) {
    const isActive = normalizeSearchPath(project.filename) === active;
    for (const entry of projectEntries(project, isActive, projectDisplayTitle(projects, project))) {
      if (!entry.absolutePath) continue;
      const key = normalizeSearchPath(entry.absolutePath);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(entry);
    }
  }
  return out;
}

/** 从工程树子树构建条目（project 已由调用方确定；files 为该子树下的文件） */
export function buildSubtreeEntries(
  project: Project,
  files: ProjectFile[],
  isActive: boolean,
  projectTitle = rawProjectTitle(project),
): SearchEntry[] {
  const seen = new Set<string>();
  const out: SearchEntry[] = [];
  for (const file of files) {
    const relativePath = displaySearchPath(file.relativeFilename || path.basename(file.absolutePath));
    const absolutePath = displaySearchPath(file.absolutePath);
    const key = normalizeSearchPath(absolutePath);
    if (!absolutePath || seen.has(key)) continue;
    seen.add(key);
    const basename = path.posix.basename(relativePath);
    out.push({
      projectTitle,
      projectFilename: project.filename,
      projectBasePath: displaySearchPath(project.basePath),
      relativePath,
      absolutePath,
      basename,
      normalizedPath: normalizeSearchPath(relativePath),
      normalizedBasename: basename.toLowerCase(),
      isActive,
    });
  }
  return out;
}

/**
 * 条目签名：活动工程 + scope + 工程/文件数量 + 相对路径滚动哈希。
 * 用于 provider 缓存自校验，避免依赖每一个模型变更点都显式失效。
 */
export function searchEntriesSignature(
  projects: Project[],
  activeFilename: string | undefined,
  scope: ProjectSearchScope,
): string {
  const active = activeProjectFilename(projects, activeFilename);
  const selected = scope === 'activeProject'
    ? (active ? projects.filter((p) => normalizeSearchPath(p.filename) === active) : [])
    : projects;
  let hash = 2166136261;
  let files = 0;
  for (const project of selected) {
    const name = normalizeSearchPath(project.filename);
    for (let i = 0; i < name.length; i++) {
      hash ^= name.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    for (const file of project.files ?? []) {
      files++;
      const rel = normalizeSearchPath(file.relativeFilename || file.absolutePath);
      for (let i = 0; i < rel.length; i++) {
        hash ^= rel.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
    }
  }
  return `${scope}|${active}|${selected.length}|${files}|${hash >>> 0}`;
}

function subsequenceScore(haystack: string, needle: string): number {
  if (!needle) return 0;
  let hi = 0;
  let score = 0;
  let streak = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const ch = needle[ni];
    const found = haystack.indexOf(ch, hi);
    if (found < 0) return -1;
    if (found === hi) {
      streak++;
      score += 6 + streak;
    } else {
      streak = 0;
      score += 1;
    }
    hi = found + 1;
  }
  return Math.min(240, score);
}

/** 单个 token 的匹配分；-1 = 不匹配 */
export function scorePathToken(entry: SearchEntry, token: string): number {
  const t = token.toLowerCase();
  const base = entry.normalizedBasename;
  const full = entry.normalizedPath;
  if (!t) return 0;
  if (base === t) return 1200;
  if (base.startsWith(t)) return 900 - Math.min(100, base.length - t.length);
  const baseHit = base.indexOf(t);
  if (baseHit >= 0) return 700 - Math.min(200, baseHit);
  if (full.startsWith(t)) return 520;
  const pathHit = full.indexOf(t);
  if (pathHit >= 0) return 480 - Math.min(200, pathHit >> 2);
  return subsequenceScore(full, t);
}

/** 高亮范围：basename 内每个 token 的首次匹配（重叠合并） */
export function matchRanges(text: string, tokens: string[]): SearchMatchRange[] {
  const lower = text.toLowerCase();
  const ranges: SearchMatchRange[] = [];
  for (const token of tokens) {
    const t = token.toLowerCase();
    if (!t) continue;
    const at = lower.indexOf(t);
    if (at >= 0) ranges.push({ start: at, length: t.length });
  }
  ranges.sort((a, b) => a.start - b.start || b.length - a.length);
  const merged: SearchMatchRange[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.start + last.length) {
      last.length = Math.max(last.length, r.start + r.length - last.start);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/**
 * 文件搜索：逐 token AND、活动工程加权、分数/路径长度/字典序排序、Top N。
 * 空查询列出全部（活动工程优先），用于浏览。
 */
export function rankSearchEntries(
  entries: readonly SearchEntry[],
  query: string,
  limit = FILE_SEARCH_LIMIT,
): FileSearchHit[] {
  const q = String(query ?? '').trim();
  const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
  const hits: FileSearchHit[] = [];
  for (const entry of entries) {
    let score = 0;
    let ok = true;
    for (const token of tokens) {
      const s = scorePathToken(entry, token);
      if (s < 0) {
        ok = false;
        break;
      }
      score += s;
    }
    if (!ok) continue;
    if (entry.isActive) score = Math.round(score * 1.25);
    hits.push({ entry, score, ranges: tokens.length ? matchRanges(entry.basename, tokens) : [] });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.entry.isActive !== b.entry.isActive) return a.entry.isActive ? -1 : 1;
    if (a.entry.relativePath.length !== b.entry.relativePath.length) {
      return a.entry.relativePath.length - b.entry.relativePath.length;
    }
    return a.entry.relativePath.localeCompare(b.entry.relativePath);
  });
  const max = Math.max(0, limit);
  return hits.length > max ? hits.slice(0, max) : hits;
}

/** 解析内容查询：字面量或 /regex/；非法正则返回 error（regex 仍为安全占位） */
export function parseTextQuery(raw: string, caseSensitive = false, wholeWord = false): TextQuery {
  const sourceText = String(raw ?? '').trim();
  if (!sourceText) {
    return { kind: 'literal', source: '', regex: new RegExp('$^'), error: 'empty-query' };
  }
  if (sourceText.length >= 2 && sourceText.startsWith('/') && sourceText.endsWith('/')) {
    const body = sourceText.slice(1, -1);
    try {
      return { kind: 'regex', source: body, regex: new RegExp(body, caseSensitive ? 'g' : 'gi') };
    } catch (err) {
      return {
        kind: 'regex',
        source: body,
        regex: new RegExp('$^'),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
  let pattern = escapeRegExp(sourceText);
  if (wholeWord) {
    // 全字匹配只作用于字面量；按首尾是否为单词字符补 \b，避免 "foo(" 这类查询失效
    const isWordChar = (ch: string) => /[A-Za-z0-9_]/.test(ch);
    if (isWordChar(sourceText[0])) pattern = `\\b${pattern}`;
    if (isWordChar(sourceText[sourceText.length - 1])) pattern = `${pattern}\\b`;
  }
  return {
    kind: 'literal',
    source: sourceText,
    regex: new RegExp(pattern, caseSensitive ? 'g' : 'gi'),
  };
}

function makePreview(line: string, column: number, length: number, maxLength: number): {
  preview: string;
  previewStart: number;
  previewLength: number;
} {
  const cap = Math.max(40, maxLength);
  const matchLength = Math.max(0, length);
  const context = Math.max(20, Math.floor((cap - Math.min(matchLength, cap)) / 2));
  const start = Math.max(0, column - context);
  const end = Math.min(line.length, column + matchLength + context);
  let slice = line.slice(start, end);
  let offset = column - start;

  // 去掉首尾空白并把高亮偏移同步左移
  const leading = slice.length - slice.trimStart().length;
  if (leading > 0) {
    slice = slice.slice(leading);
    offset -= leading;
  }
  const trailing = slice.length - slice.trimEnd().length;
  if (trailing > 0) slice = slice.slice(0, -trailing);

  const prefix = start > 0 ? '…' : '';
  const suffix = end < line.length ? '…' : '';
  let preview = prefix + slice + suffix;
  let previewStart = prefix.length + Math.max(0, offset);
  let previewLength = matchLength;

  if (preview.length > cap) {
    // 匹配本身很长时，只展示前 cap 个字符，高亮同步截断
    const keep = Math.max(0, Math.min(preview.length, cap));
    preview = preview.slice(0, keep) + '…';
    previewStart = Math.min(previewStart, keep);
    previewLength = Math.max(0, Math.min(previewLength, keep - previewStart));
  }
  return { preview, previewStart, previewLength };
}

/**
 * 在整段文本中查找匹配（逐行，0-based，UTF-16 列）。
 *
 * - 字面量：escapeRegExp + i/g（不改变原字符串列偏移）
 * - 正则：/pattern/，大小写由 caseSensitive 控制；超长行跳过（防回溯放大）
 * - 零宽匹配跳过并推进，避免死循环
 */
export function findTextMatches(text: string, query: TextQuery, opts: FindTextOptions = {}): FindTextResult {
  const matches: TextMatch[] = [];
  if (!text || query.error || !query.source) return { matches, truncated: false };

  const maxFileMatches = Math.max(1, opts.maxFileMatches ?? TEXT_FILE_MATCH_LIMIT);
  const maxTotalMatches = Math.max(1, opts.maxTotalMatches ?? TEXT_TOTAL_MATCH_LIMIT);
  const maxPreview = Math.max(40, opts.maxPreviewLength ?? 200);
  const maxRegexLine = Math.max(80, opts.maxRegexLineLength ?? TEXT_MAX_REGEX_LINE_LENGTH);
  const flags = query.regex.flags.includes('g') ? query.regex.flags : query.regex.flags + 'g';
  const flagsWithoutSticky = flags.replace(/y/g, '');
  const re = new RegExp(query.regex.source, flagsWithoutSticky);

  const lines = text.split(/\r?\n/);
  let truncated = false;
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    if (matches.length >= maxTotalMatches) {
      truncated = true;
      break;
    }
    const line = lines[lineNo];
    if (!line) continue;
    if (query.kind === 'regex' && line.length > maxRegexLine) {
      truncated = true;
      continue;
    }
    re.lastIndex = 0;
    let guard = 0;
    while (guard++ < 20000) {
      const m = re.exec(line);
      if (!m) break;
      const value = m[0] ?? '';
      if (!value.length) {
        re.lastIndex = Math.max(re.lastIndex + 1, m.index + 1);
        continue;
      }
      const preview = makePreview(line, m.index, value.length, maxPreview);
      matches.push({
        line: lineNo,
        column: m.index,
        length: value.length,
        preview: preview.preview,
        previewStart: preview.previewStart,
        previewLength: preview.previewLength,
      });
      if (matches.length >= maxFileMatches || matches.length >= maxTotalMatches) {
        truncated = true;
        return { matches, truncated };
      }
    }
  }
  return { matches, truncated };
}

/** UTF-16 BOM 判定（必须在二进制 NUL 检查之前处理：UTF-16 文本天然包含 NUL） */
export function utf16Bom(buf: Buffer): 'le' | 'be' | undefined {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return 'le';
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return 'be';
  return undefined;
}

/** 无 BOM 文件的前 8KB 含 NUL → 视为二进制 */
export function looksBinary(buf: Buffer, sampleBytes = 8192): boolean {
  if (utf16Bom(buf)) return false;
  const n = Math.min(buf.length, Math.max(1, sampleBytes));
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

/** 字节预算 LRU（命中时刷新 LRU 顺序） */
export class ByteBudgetCache<T> {
  private readonly map = new Map<string, { value: T; bytes: number }>();
  private used = 0;
  public hits = 0;
  public misses = 0;

  constructor(private readonly maxBytes: number) {}

  get sizeBytes(): number { return this.used; }
  get size(): number { return this.map.size; }

  get(key: string): T | undefined {
    const hit = this.map.get(key);
    if (!hit) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit.value;
  }

  set(key: string, value: T, bytes: number): void {
    const cost = Math.max(0, Math.ceil(bytes));
    const old = this.map.get(key);
    if (old) {
      this.used -= old.bytes;
      this.map.delete(key);
    }
    if (cost > this.maxBytes) return;
    this.map.set(key, { value, bytes: cost });
    this.used += cost;
    while (this.used > this.maxBytes) {
      const first = this.map.keys().next();
      if (first.done) break;
      const evict = this.map.get(first.value)!;
      this.map.delete(first.value);
      this.used -= evict.bytes;
    }
  }

  delete(key: string): void {
    const old = this.map.get(key);
    if (!old) return;
    this.map.delete(key);
    this.used -= old.bytes;
  }

  clear(): void {
    this.map.clear();
    this.used = 0;
  }
}

/** 并发映射（保留输入顺序；signal 中止后不再启动新任务） */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  if (!items.length) return out;
  let next = 0;
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  const run = async (): Promise<void> => {
    while (true) {
      if (signal?.aborted) return;
      const i = next++;
      if (i >= items.length) return;
      out[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: width }, () => run()));
  return out;
}
