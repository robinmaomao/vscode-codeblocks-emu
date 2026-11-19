/**
 * 「仅 C / 仅 C++ 参数」的纯逻辑（无 vscode 依赖）。
 *
 * 宿主侧（`compilerFlagSettings`，读写 `codeblocks.compiler.languageFlags` 设置）
 * 与 CLI/MCP 侧（`api/compilerService`，从 settings.json 直接读）共用同一份净化/回落逻辑，
 * 保证 UI 构建与 agent 构建拿到的编译参数完全一致。
 */

export interface CompilerLanguageFlags {
  cOnly: string[];
  cppOnly: string[];
}

/** 设置原始值 → 规范化存储（丢弃非法形态、去重、去空白） */
export function normalizeLanguageFlags(value: unknown): Record<string, CompilerLanguageFlags> {
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

/** 当前生效的「仅 C / 仅 C++」参数（无用户覆盖时回落到编译器 XML 基线） */
export function pickLanguageFlags(
  compilerId: string,
  fallback: CompilerLanguageFlags,
  store: Record<string, CompilerLanguageFlags>,
): CompilerLanguageFlags {
  const stored = store[compilerId];
  return stored
    ? { cOnly: [...stored.cOnly], cppOnly: [...stored.cppOnly] }
    : { cOnly: [...fallback.cOnly], cppOnly: [...fallback.cppOnly] };
}

/** 编译器缓存键用签名（无覆盖时为空串，保持旧键行为） */
export function languageFlagsKey(compilerId: string, store: Record<string, CompilerLanguageFlags>): string {
  const stored = store[compilerId];
  if (!stored) return '';
  return `${compilerId}\u0001${stored.cOnly.join(' ')}\u0001${stored.cppOnly.join(' ')}`;
}
