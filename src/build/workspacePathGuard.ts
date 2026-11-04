/**
 * 工作区路径 glob 元字符检查 + AI 指令目录扫描治理（纯逻辑，便于单测）。
 *
 * 背景（实测，详见 docs/archive/RG风暴根因分析与方案-2026-11-04.md §14–§16）：
 * VS Code 的 `PromptFilesLocator` 会把「AI 指令文件位置」拼成绝对路径后用 `Eao()`
 * 拆成 `{ searchRoot, filePattern }`：**遇到第一个含 glob 元字符的路径段就截断**。
 * `Eao()` 内部用 `xgn()` 逐段判断，`*`/`?` 直接命中，`[...]`/`{...}` 成对时命中。
 *
 * 于是工作区路径里只要有 `[内部]xxx` 这样的目录名：
 *   location   = E:\Work_Share\2026\10\[内部]5756C_lvd_reset\SDK_...\.github\instructions
 *   searchRoot = E:\Work_Share\2026\10          ← 被放大到祖先目录
 *   filePattern= [内部]5756C_lvd_reset/SDK_.../.github/instructions
 * 因为 glob 在 JS 侧匹配，ripgrep 拿不到任何 `-g` ⇒ 每次文件变更都把 `2026\10` 整棵树列一遍
 * （`rg.exe` + `conhost.exe` 风暴、CPU 100%）。路径干净时 `Eao()` 直接返回整条 location 作为
 * searchRoot、不带 filePattern ⇒ 调用方走 `fileStat` 分支，**不会启动 rg**。
 *
 * 这里复刻上述两段逻辑（VS Code 1.144.1 `workbench.desktop.main.js`），用于：
 * 1. 检查工作区路径是否会让 VS Code 放大搜索根（给用户可读的提醒）；
 * 2. 计算"VS Code 实际会用的搜索根"，让提醒能落到具体目录；
 * 3. 生成把 `.github/instructions` / `.claude/rules` 两处扫描关掉的设置值（幂等合并）。
 *
 * 注意：本模块**不 import vscode / i18n**，只做纯计算，便于在 unit 层直接测试。
 */
import * as fs from 'fs';
import * as path from 'path';

/** 命中类型（与 `xgn()` 的判定分支对应） */
export type GlobKind = 'star' | 'bracket' | 'brace';

export interface GlobSegmentHit {
  /** 路径段下标（从 0 开始，含盘符段） */
  index: number;
  segment: string;
  kind: GlobKind;
}

/**
 * 单个路径段是否含 glob 元字符 —— 复刻 VS Code `xgn(segment)`：
 * - `*` / `?` 出现即命中（不受转义以外条件限制）；
 * - `[` 计数 +1、`]` 计数 -1，**收尾时计数为 0 且出现过 `[`** 才命中（即成对）；
 * - `{` / `}` 同理；
 * - `\` 转义后一个字符（与上游一致）。
 */
export function globKindOfSegment(segment: string): GlobKind | undefined {
  let sawBracket = false;
  let bracketDepth = 0;
  let sawBrace = false;
  let braceDepth = 0;
  let prev = '';
  for (const ch of segment) {
    if (prev === '\\') {
      prev = ch;
      continue;
    }
    if (ch === '*' || ch === '?') return 'star';
    if (ch === '[') {
      sawBracket = true;
      bracketDepth++;
      prev = ch;
      continue;
    }
    if (ch === ']') {
      sawBracket = true;
      bracketDepth--;
      prev = ch;
      continue;
    }
    if (ch === '{') {
      sawBrace = true;
      braceDepth++;
      continue;
    }
    if (ch === '}') {
      sawBrace = true;
      braceDepth--;
      prev = ch;
      continue;
    }
    prev = ch;
  }
  if (sawBracket && bracketDepth === 0) return 'bracket';
  if (sawBrace && braceDepth === 0) return 'brace';
  return undefined;
}

/** 按 `/` 与 `\` 切段（保留盘符 `e:` 作为独立段），丢弃空段 */
export function splitSegments(fsPath: string): string[] {
  return fsPath.split(/[\\/]+/).filter((s) => s.length > 0);
}

/** 找出路径中所有含 glob 元字符的段 */
export function findGlobSegments(fsPath: string): GlobSegmentHit[] {
  const hits: GlobSegmentHit[] = [];
  splitSegments(fsPath).forEach((segment, index) => {
    const kind = globKindOfSegment(segment);
    if (kind) hits.push({ index, segment, kind });
  });
  return hits;
}

export interface InstructionSearchRoot {
  /** VS Code 会用来做全量枚举的目录；干净路径时等于 location 本身（只 stat） */
  searchRoot: string;
  /** 非空 ⇒ 会启动 ripgrep 并按该 glob 在 JS 侧过滤 */
  filePattern?: string;
}

/** 按输入的分隔符风格把段拼回路径（保留盘符根、UNC 前缀与 POSIX 前导斜杠） */
function joinLike(reference: string, segments: readonly string[]): string {
  if (/^\\\\[^\\]/.test(reference)) return `\\\\${segments.join('\\')}`;
  const sep = reference.includes('\\') ? '\\' : '/';
  const joined = segments.join(sep);
  if (segments.length === 1 && /^[A-Za-z]:$/.test(segments[0])) return joined + sep;
  if (/^[\\/]/.test(reference) && !/^[A-Za-z]:/.test(segments[0] ?? '')) return sep + joined;
  return joined;
}

/**
 * 复刻 `Eao('instructions', <workspace>/<location>)`：返回 VS Code 实际使用的搜索根与 glob。
 * @param workspaceFsPath 工作区目录（绝对路径）
 * @param location 指令文件位置（相对工作区），默认 `.github/instructions`
 */
export function computeInstructionSearchRoot(
  workspaceFsPath: string,
  location = '.github/instructions',
): InstructionSearchRoot {
  const locationSegments = location.split(/[\\/]+/).filter(Boolean);
  const absolute = path.isAbsolute(location)
    ? location
    : path.join(workspaceFsPath, ...locationSegments);
  const segments = splitSegments(absolute);
  let first = 0;
  while (first < segments.length && globKindOfSegment(segments[first]) === undefined) first++;
  if (first === segments.length) {
    return { searchRoot: joinLike(absolute, segments) };
  }
  return {
    searchRoot: joinLike(absolute, segments.slice(0, first)),
    filePattern: segments.slice(first).join('/'),
  };
}

export interface WorkspacePathAnalysis {
  /** 路径是否干净（没有会让 VS Code 放大搜索根的段） */
  ok: boolean;
  offending: GlobSegmentHit[];
  /** VS Code 对默认指令位置（`.github/instructions`）会使用的搜索根 */
  searchRoot: string;
  /** 非空 ⇒ 会启动 rg 全量枚举 */
  filePattern?: string;
  /** 搜索根是否就是工作区目录本身 */
  searchRootIsWorkspace: boolean;
}

/** 分析一个工作区目录 */
export function analyzeWorkspacePath(workspaceFsPath: string): WorkspacePathAnalysis {
  const offending = findGlobSegments(workspaceFsPath);
  const split = computeInstructionSearchRoot(workspaceFsPath);
  return {
    ok: offending.length === 0,
    offending,
    searchRoot: split.searchRoot,
    filePattern: split.filePattern,
    searchRootIsWorkspace: path.resolve(split.searchRoot).toLowerCase() === path.resolve(workspaceFsPath).toLowerCase(),
  };
}

export interface FileCountResult {
  count: number;
  /** 达到上限提前结束（数字只是下限） */
  capped: boolean;
  /** 目录不存在/不可读 */
  missing: boolean;
}

/**
 * 深度受限地统计目录内文件数（用于量化"搜索根被放大"的代价）。
 * 失败静默（不抛错），`cap` 达到即返回，避免大目录拖慢激活。
 */
export function countFilesCapped(dir: string, cap = 5000, maxDepth = 8): FileCountResult {
  // 盘符/UNC 根目录（如 E:\、\\server\share）不做遍历：搜根被放大到根目录时既无意义又可能很慢
  if (path.parse(dir).root === dir) return { count: 0, capped: true, missing: false };
  let count = 0;
  let capped = false;
  let missing = false;
  const walk = (current: string, depth: number): void => {
    if (capped) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      if (depth === 0) missing = true;
      return;
    }
    for (const entry of entries) {
      if (count >= cap) {
        capped = true;
        return;
      }
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (depth + 1 <= maxDepth) walk(child, depth + 1);
        continue;
      }
      count++;
    }
  };
  walk(dir, 0);
  return { count, capped, missing };
}

/** 需要关闭的 AI 指令文件位置（工作区相对路径） */
export const PROMPT_SCAN_LOCATIONS = ['.github/instructions', '.claude/rules'] as const;

/**
 * 把 `chat.instructionsFilesLocations` 合并成"关闭两处扫描"的值。
 *
 * 关键（实测）：该设置的实现是「以默认列表为基线，只有显式 `false` 才剔除」，
 * 所以 `{}` **不能**关闭任何扫描；必须写成 `{ ".github/instructions": false, ".claude/rules": false }`。
 * 其它条目原样保留；已经全为 `false` 时不产生变更（幂等）。
 */
export function mergePromptScanLocations(existing: unknown): { value: Record<string, unknown>; changed: string[] } {
  const base = existing && typeof existing === 'object' && !Array.isArray(existing)
    ? existing as Record<string, unknown>
    : undefined;
  const value: Record<string, unknown> = { ...(base ?? {}) };
  const changed: string[] = [];
  for (const location of PROMPT_SCAN_LOCATIONS) {
    if (value[location] !== false) {
      value[location] = false;
      changed.push(location);
    }
  }
  return { value, changed };
}
