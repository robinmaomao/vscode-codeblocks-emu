/**
 * 工程搜索历史（纯逻辑，无 vscode 依赖）。
 *
 * 只保存查询与“上次结果位置”，不保存文件内容/匹配行；存储层（workspaceState）由 provider 负责。
 * 历史按工作区隔离；两种模式各保留最近 20 条。
 */
import { ProjectSearchMode, ProjectSearchScope } from './projectSearch';

export const SEARCH_HISTORY_VERSION = 1;
export const SEARCH_HISTORY_PER_MODE = 20;

export interface SearchHistoryLastResult {
  projectFilename: string;
  relativeFilename: string;
  /** 0-based（仅内容模式） */
  line?: number;
  /** 0-based（仅内容模式） */
  column?: number;
  length?: number;
}

export interface SearchHistoryEntry {
  id: string;
  mode: ProjectSearchMode;
  /** 原始查询（trim 仅用于判空/显示） */
  query: string;
  scope: ProjectSearchScope;
  caseSensitive: boolean;
  regex: boolean;
  updatedAt: number;
  lastResult?: SearchHistoryLastResult;
}

export interface SearchHistoryState {
  version: typeof SEARCH_HISTORY_VERSION;
  entries: SearchHistoryEntry[];
}

export function emptyHistory(): SearchHistoryState {
  return { version: SEARCH_HISTORY_VERSION, entries: [] };
}

/** 稳定 id：模式 + 查询的 FNV-1a 哈希（去重仍以 mode+原文精确匹配为准） */
export function historyId(mode: ProjectSearchMode, query: string): string {
  let hash = 2166136261;
  const text = `${mode}\u0000${query}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${mode}-${(hash >>> 0).toString(36)}`;
}

function isMode(value: unknown): value is ProjectSearchMode {
  return value === 'files' || value === 'text';
}

function isScope(value: unknown): value is ProjectSearchScope {
  return value === 'openProjects' || value === 'activeProject';
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function sanitizeLastResult(value: unknown): SearchHistoryLastResult | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.projectFilename !== 'string' || !raw.projectFilename) return undefined;
  if (typeof raw.relativeFilename !== 'string' || !raw.relativeFilename) return undefined;
  const last: SearchHistoryLastResult = {
    projectFilename: raw.projectFilename,
    relativeFilename: raw.relativeFilename,
  };
  const line = finiteNumber(raw.line);
  const column = finiteNumber(raw.column);
  const length = finiteNumber(raw.length);
  if (line !== undefined) last.line = Math.floor(line);
  if (column !== undefined) last.column = Math.floor(column);
  if (length !== undefined) last.length = Math.floor(length);
  return last;
}

function sanitizeEntry(value: unknown): SearchHistoryEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  if (!isMode(raw.mode) || typeof raw.query !== 'string' || !raw.query.trim()) return undefined;
  if (!isScope(raw.scope)) return undefined;
  const entry: SearchHistoryEntry = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : historyId(raw.mode, raw.query),
    mode: raw.mode,
    query: raw.query,
    scope: raw.scope,
    caseSensitive: raw.caseSensitive === true,
    regex: raw.regex === true,
    updatedAt: finiteNumber(raw.updatedAt) ?? 0,
  };
  const lastResult = sanitizeLastResult(raw.lastResult);
  if (lastResult) entry.lastResult = lastResult;
  return entry;
}

/** 解析持久化值：版本不符/损坏/非法项 → 回退空表（不抛错） */
export function parseHistory(value: unknown): SearchHistoryState {
  if (!value || typeof value !== 'object') return emptyHistory();
  const raw = value as Record<string, unknown>;
  if (raw.version !== SEARCH_HISTORY_VERSION || !Array.isArray(raw.entries)) return emptyHistory();

  const entries: SearchHistoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw.entries) {
    const entry = sanitizeEntry(item);
    if (!entry) continue;
    const key = `${entry.mode}\u0000${entry.query}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  return { version: SEARCH_HISTORY_VERSION, entries: trimPerMode(entries) };
}

function trimPerMode(entries: SearchHistoryEntry[]): SearchHistoryEntry[] {
  const counts: Record<ProjectSearchMode, number> = { files: 0, text: 0 };
  const out: SearchHistoryEntry[] = [];
  for (const entry of entries) {
    if (counts[entry.mode] >= SEARCH_HISTORY_PER_MODE) continue;
    counts[entry.mode]++;
    out.push(entry);
  }
  return out;
}

/**
 * 新增/更新一条历史：同模式 + 同原文精确去重并置顶；每模式最多 20 条。
 * 空查询不记录。
 */
export function addHistoryEntry(
  state: SearchHistoryState,
  input: {
    mode: ProjectSearchMode;
    query: string;
    scope: ProjectSearchScope;
    caseSensitive: boolean;
    regex: boolean;
    now?: number;
  },
): SearchHistoryState {
  const query = input.query;
  if (!query || !query.trim()) return state;
  const entry: SearchHistoryEntry = {
    id: historyId(input.mode, query),
    mode: input.mode,
    query,
    scope: input.scope,
    caseSensitive: input.caseSensitive === true,
    regex: input.regex === true,
    updatedAt: input.now ?? Date.now(),
  };
  const rest = state.entries.filter((e) => !(e.mode === input.mode && e.query === query));
  const previous = state.entries.find((e) => e.mode === input.mode && e.query === query);
  if (previous?.lastResult) entry.lastResult = { ...previous.lastResult };
  return { version: SEARCH_HISTORY_VERSION, entries: trimPerMode([entry, ...rest]) };
}

/** 打开结果时更新“上次结果位置”；记录不存在时原样返回 */
export function updateLastResult(
  state: SearchHistoryState,
  mode: ProjectSearchMode,
  query: string,
  lastResult: SearchHistoryLastResult | undefined,
  now = Date.now(),
): SearchHistoryState {
  if (!query || !state.entries.some((e) => e.mode === mode && e.query === query)) return state;
  const entries = state.entries.map((e) => {
    if (e.mode !== mode || e.query !== query) return e;
    const next: SearchHistoryEntry = { ...e, updatedAt: now };
    if (lastResult) next.lastResult = { ...lastResult };
    else delete next.lastResult;
    return next;
  });
  return { version: SEARCH_HISTORY_VERSION, entries };
}

export function removeHistoryEntry(state: SearchHistoryState, id: string): SearchHistoryState {
  return { version: SEARCH_HISTORY_VERSION, entries: state.entries.filter((e) => e.id !== id) };
}

export function clearHistory(): SearchHistoryState {
  return emptyHistory();
}

/** 取当前模式（或全部）的历史；顺序 = 最近更新在前 */
export function historyForMode(
  state: SearchHistoryState,
  mode: ProjectSearchMode | 'all',
  limit = SEARCH_HISTORY_PER_MODE,
): SearchHistoryEntry[] {
  const list = mode === 'all' ? state.entries : state.entries.filter((e) => e.mode === mode);
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  return sorted.slice(0, Math.max(0, limit));
}

/** 历史条目的查询是否仍与某次结果一致（用于打开结果时精确匹配） */
export function findHistoryEntry(
  state: SearchHistoryState,
  mode: ProjectSearchMode,
  query: string,
): SearchHistoryEntry | undefined {
  return state.entries.find((e) => e.mode === mode && e.query === query);
}
