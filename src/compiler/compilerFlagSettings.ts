/**
 * 编译器参数自定义 —— 对齐 Code::Blocks 的 Compiler Flags 右键菜单。
 *
 * 三份全局设置（按编译器 id 分组）：
 *  - `codeblocks.compiler.customFlags`   新增的参数
 *  - `codeblocks.compiler.flagOverrides` 覆盖（modified）或删除（removed）内置参数
 *  - `codeblocks.compiler.languageFlags` 仅 C / 仅 C++ 参数（覆盖 XML `<Sort>` 基线）
 *
 * 内置参数只读的旧限制已取消：修改/删除内置参数不会改动编译器 XML，
 * 只在扩展设置里记录差异，清空 `flagOverrides` 即可恢复默认。
 */
import * as vscode from 'vscode';
import * as i18n from '../i18n';
import type { BuildOptionsCompilerOption } from '../ui/buildOptionsView';

export const CUSTOM_FLAGS_SETTING = 'compiler.customFlags';
export const FLAG_OVERRIDES_SETTING = 'compiler.flagOverrides';
export const LANGUAGE_FLAGS_SETTING = 'compiler.languageFlags';

/** 参数条目（设置里的原始形态） */
export interface CompilerFlagEntry {
  name: string;
  option: string;
  category?: string;
  additionalLibs?: string;
}

export interface CompilerFlagOverrides {
  /** 原始 option → 覆盖后的条目 */
  modified: Record<string, CompilerFlagEntry>;
  /** 被删除的原始 option */
  removed: string[];
}

export interface CompilerLanguageFlags {
  cOnly: string[];
  cppOnly: string[];
}

export interface CompilerFlagStores {
  custom: Record<string, CompilerFlagEntry[]>;
  overrides: Record<string, CompilerFlagOverrides>;
  language: Record<string, CompilerLanguageFlags>;
}

export type CompilerFlagActionType = 'flagAdd' | 'flagUpdate' | 'flagDelete';

export interface CompilerFlagAction {
  type: CompilerFlagActionType;
  compilerId: string;
  flag?: { name?: string; option?: string; category?: string; additionalLibs?: string };
  /** 被操作的行：内置行需带 baseOption（覆盖后的原始 option），自定义行 custom=true */
  original?: { name?: string; option?: string; baseOption?: string; custom?: boolean };
}

function config(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('codeblocks');
}

function cleanEntry(value: unknown): CompilerFlagEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const option = typeof raw.option === 'string' ? raw.option.trim() : '';
  if (!name || !option) return undefined;
  return {
    name,
    option,
    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : undefined,
    additionalLibs: typeof raw.additionalLibs === 'string' ? raw.additionalLibs : undefined,
  };
}

function cleanCustomStore(value: unknown): Record<string, CompilerFlagEntry[]> {
  const store: Record<string, CompilerFlagEntry[]> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store;
  for (const [compilerId, flags] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(flags)) continue;
    const list = flags.map(cleanEntry).filter((f): f is CompilerFlagEntry => !!f);
    if (list.length) store[compilerId] = list;
  }
  return store;
}

function cleanOverrides(value: unknown): Record<string, CompilerFlagOverrides> {
  const store: Record<string, CompilerFlagOverrides> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store;
  for (const [compilerId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const src = raw as Record<string, unknown>;
    const modified: Record<string, CompilerFlagEntry> = {};
    if (src.modified && typeof src.modified === 'object' && !Array.isArray(src.modified)) {
      for (const [original, entry] of Object.entries(src.modified as Record<string, unknown>)) {
        const cleaned = cleanEntry(entry);
        const key = String(original).trim();
        if (cleaned && key) modified[key] = cleaned;
      }
    }
    const removed = Array.isArray(src.removed)
      ? Array.from(new Set(src.removed.map((x) => String(x).trim()).filter(Boolean)))
      : [];
    if (Object.keys(modified).length || removed.length) store[compilerId] = { modified, removed };
  }
  return store;
}

function cleanLanguage(value: unknown): Record<string, CompilerLanguageFlags> {
  const store: Record<string, CompilerLanguageFlags> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store;
  const norm = (input: unknown): string[] =>
    Array.isArray(input)
      ? Array.from(new Set(input.map((x) => String(x).trim()).filter(Boolean)))
      : [];
  for (const [compilerId, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const src = raw as Record<string, unknown>;
    const cOnly = norm(src.cOnly);
    const cppOnly = norm(src.cppOnly);
    if (cOnly.length || cppOnly.length) store[compilerId] = { cOnly, cppOnly };
  }
  return store;
}

export function readCompilerFlagStores(): CompilerFlagStores {
  const c = config();
  return {
    custom: cleanCustomStore(c.get<unknown>(CUSTOM_FLAGS_SETTING, {})),
    overrides: cleanOverrides(c.get<unknown>(FLAG_OVERRIDES_SETTING, {})),
    language: cleanLanguage(c.get<unknown>(LANGUAGE_FLAGS_SETTING, {})),
  };
}

/** 合并顺序：基目录 → 去掉 removed → 应用 modified → 追加 custom（幂等） */
export function buildCompilerCatalog(
  compilerId: string,
  baseCatalog: readonly BuildOptionsCompilerOption[],
  stores: CompilerFlagStores = readCompilerFlagStores(),
): BuildOptionsCompilerOption[] {
  const overrides = stores.overrides[compilerId] ?? { modified: {}, removed: [] };
  const removed = new Set(overrides.removed ?? []);
  const result: BuildOptionsCompilerOption[] = [];
  for (const entry of baseCatalog) {
    // 以未合并的基目录为准：忽略已带标记的输入，保证可重复调用
    const option = entry.baseOption || entry.option;
    if (removed.has(option)) continue;
    const mod = overrides.modified?.[option];
    const base: BuildOptionsCompilerOption = {
      name: entry.name,
      option,
      category: entry.category,
      additionalLibs: entry.additionalLibs,
      custom: false,
      modified: false,
      baseOption: option,
    };
    if (mod) {
      result.push({
        ...base,
        name: mod.name,
        option: mod.option,
        category: mod.category || base.category,
        additionalLibs: mod.additionalLibs ?? base.additionalLibs,
        modified: true,
      });
    } else {
      result.push(base);
    }
  }
  for (const entry of stores.custom[compilerId] ?? []) {
    result.push({
      name: entry.name,
      option: entry.option,
      category: entry.category || i18n.t('Custom flags'),
      additionalLibs: entry.additionalLibs,
      custom: true,
      modified: false,
    });
  }
  return result;
}

/** 当前生效的“仅 C / 仅 C++”参数（无用户覆盖时回落到编译器 XML 基线） */
export function readLanguageFlags(
  compilerId: string,
  fallback: CompilerLanguageFlags,
  stores: CompilerFlagStores = readCompilerFlagStores(),
): CompilerLanguageFlags {
  const stored = stores.language[compilerId];
  return stored ? { cOnly: [...stored.cOnly], cppOnly: [...stored.cppOnly] } : { cOnly: [...fallback.cOnly], cppOnly: [...fallback.cppOnly] };
}

/** 编译器缓存键用签名（无覆盖时为空串，保持旧键行为） */
export function languageFlagsSignature(compilerId: string, stores: CompilerFlagStores = readCompilerFlagStores()): string {
  const stored = stores.language[compilerId];
  if (!stored) return '';
  return `${compilerId}\u0001${stored.cOnly.join(' ')}\u0001${stored.cppOnly.join(' ')}`;
}

async function persist(key: string, value: unknown): Promise<string | undefined> {
  try {
    await config().update(key, value, vscode.ConfigurationTarget.Global);
    return undefined;
  } catch (error) {
    return i18n.t('Unable to update the custom compiler flags: {0}', error instanceof Error ? error.message : String(error));
  }
}

function sameEntry(entry: CompilerFlagEntry, original: CompilerFlagAction['original']): boolean {
  if (!original) return false;
  if (original.custom) return entry.option === (original.option ?? '').trim();
  return entry.option === (original.baseOption || original.option || '').trim();
}

/** 校验并写入一条参数增/改/删请求；成功返回 undefined */
export async function applyFlagAction(
  action: CompilerFlagAction,
  baseCatalog: readonly BuildOptionsCompilerOption[],
): Promise<string | undefined> {
  const compilerId = (action.compilerId ?? '').trim();
  if (!compilerId) return i18n.t('No compiler is selected.');

  const stores = readCompilerFlagStores();
  const custom = [...(stores.custom[compilerId] ?? [])];
  const overrides: CompilerFlagOverrides = {
    modified: { ...(stores.overrides[compilerId]?.modified ?? {}) },
    removed: [...(stores.overrides[compilerId]?.removed ?? [])],
  };
  const baseOptions = new Set(baseCatalog.map((o) => (o.baseOption || o.option).trim()));
  const original = action.original;
  const isCustom = original?.custom === true;

  if (action.type === 'flagDelete') {
    if (!original) return i18n.t('The selected compiler flag no longer exists.');
    if (isCustom) {
      const option = (original.option ?? '').trim();
      const before = custom.length;
      const next = custom.filter((f) => f.option !== option);
      if (next.length === before) return i18n.t('The selected compiler flag no longer exists.');
      if (next.length) stores.custom[compilerId] = next;
      else delete stores.custom[compilerId];
      return persist(CUSTOM_FLAGS_SETTING, stores.custom);
    }
    const baseOption = (original.baseOption || original.option || '').trim();
    if (!baseOptions.has(baseOption)) return i18n.t('The selected compiler flag no longer exists.');
    delete overrides.modified[baseOption];
    if (!overrides.removed.includes(baseOption)) overrides.removed.push(baseOption);
    stores.overrides[compilerId] = overrides;
    return persist(FLAG_OVERRIDES_SETTING, stores.overrides);
  }

  const name = (action.flag?.name ?? '').trim();
  const option = (action.flag?.option ?? '').trim();
  if (!name || !option) return i18n.t('Both name and option are required.');

  // 候选目录：先移除被编辑项，再校验 option 唯一性
  const nextCustom = isCustom || !original ? custom.filter((f) => !sameEntry(f, original)) : [...custom];
  const nextOverrides: CompilerFlagOverrides = {
    modified: { ...overrides.modified },
    removed: [...overrides.removed],
  };
  if (!isCustom && original) {
    const baseOption = (original.baseOption || original.option || '').trim();
    if (!baseOptions.has(baseOption)) return i18n.t('The selected compiler flag no longer exists.');
    if (nextOverrides.removed.includes(baseOption)) return i18n.t('The selected compiler flag no longer exists.');
    nextOverrides.modified[baseOption] = { name, option, category: action.flag?.category?.trim() || undefined, additionalLibs: action.flag?.additionalLibs };
  } else {
    nextCustom.push({ name, option, category: action.flag?.category?.trim() || undefined, additionalLibs: action.flag?.additionalLibs });
  }

  const candidate: CompilerFlagStores = {
    custom: { ...stores.custom, [compilerId]: nextCustom },
    overrides: { ...stores.overrides, [compilerId]: nextOverrides },
    language: stores.language,
  };
  const merged = buildCompilerCatalog(compilerId, baseCatalog, candidate);
  const seen = new Set<string>();
  for (const entry of merged) {
    if (seen.has(entry.option)) return i18n.t('A compiler flag with the same option already exists.');
    seen.add(entry.option);
  }

  if (nextCustom.length) stores.custom[compilerId] = nextCustom;
  else delete stores.custom[compilerId];
  if (Object.keys(nextOverrides.modified).length || nextOverrides.removed.length) stores.overrides[compilerId] = nextOverrides;
  else delete stores.overrides[compilerId];

  const error = await persist(CUSTOM_FLAGS_SETTING, stores.custom);
  if (error) return error;
  return persist(FLAG_OVERRIDES_SETTING, stores.overrides);
}

/** 保存“仅 C / 仅 C++”参数（空列表 = 删除覆盖、回落 XML 基线） */
export async function writeLanguageFlags(
  compilerId: string,
  cOnly: readonly string[],
  cppOnly: readonly string[],
): Promise<string | undefined> {
  const id = (compilerId ?? '').trim();
  if (!id) return i18n.t('No compiler is selected.');
  const norm = (input: readonly string[]): string[] =>
    Array.from(new Set(input.map((x) => String(x).trim()).filter(Boolean)));
  const stores = readCompilerFlagStores();
  const next = norm(cOnly);
  const nextCpp = norm(cppOnly);
  if (next.length || nextCpp.length) stores.language[id] = { cOnly: next, cppOnly: nextCpp };
  else delete stores.language[id];
  return persist(LANGUAGE_FLAGS_SETTING, stores.language);
}
