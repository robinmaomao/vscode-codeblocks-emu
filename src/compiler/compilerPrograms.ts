/**
 * 编译器程序路径设置的存储与作用域（D-20 修复）
 *
 * 设置 `codeblocks.compilerPrograms` 记录「编译器程序完整路径」（交叉编译器由「探测编译器」自动写入）。
 * 支持两种形态：
 *   · **按编译器 id 分组**（新，写入形态）：`{ "avr-gcc": { C: "…/avr-gcc.exe", … }, "riscv": { … } }`
 *   · **扁平旧形态**（兼容读取）：`{ C: "…/avr-gcc.exe", … }`
 *
 * 旧形态是全局的：选定交叉编译器后，任何家族（如 `<Option compiler="gcc">` 的工程）都会被覆盖成
 * 交叉工具链的程序路径，且没有任何提示（静默用错工具链）。因此旧形态一律视为
 * 「只属于写入时的全局 compilerId」——迁移与解析都按这条规则处理。
 */

/** 程序键（与 Code::Blocks 编译器程序表一致） */
export const PROGRAM_KEYS = ['C', 'CPP', 'LD', 'LIB', 'WINDRES', 'MAKE', 'DBGconfig'] as const;

export type ProgramMap = Record<string, string>;
/** 设置值：id → 程序表（新形态），或直接是程序表（旧扁平形态） */
export type ProgramsSetting = Record<string, ProgramMap | string>;

/** 旧扁平形态判定：非空且所有键都是程序键、值为字符串（id 不可能恰好等于程序键） */
export function isFlatProgramsMap(value: unknown): value is ProgramMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value as Record<string, unknown>);
  if (keys.length === 0) return false;
  return keys.every((k) => (PROGRAM_KEYS as readonly string[]).includes(k)
    && typeof (value as Record<string, unknown>)[k] === 'string');
}

/**
 * 把旧扁平形态归入它写入时的全局编译器 id（不修改入参）。
 * 新形态原样返回；空值返回空对象。
 */
export function normalizeProgramsSetting(setting: unknown, globalCompilerId: string): Record<string, ProgramMap> {
  if (isFlatProgramsMap(setting)) {
    const flat: ProgramMap = { ...(setting as ProgramMap) };
    return globalCompilerId ? { [globalCompilerId]: flat } : {};
  }
  const out: Record<string, ProgramMap> = {};
  if (setting && typeof setting === 'object' && !Array.isArray(setting)) {
    for (const [id, v] of Object.entries(setting as Record<string, unknown>)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) out[id] = { ...(v as ProgramMap) };
    }
  }
  return out;
}

/**
 * 解析「当前家族实际可用的程序路径」：
 *  - 新形态：取 `setting[compilerId]`（只作用于该家族）；
 *  - 旧扁平形态：仅当 `compilerId === globalCompilerId` 时生效（它正是被写入该 id 时的产物）。
 * 未命中返回 undefined（代表回退到家族默认程序名 + PATH 查找）。
 */
export function resolveProgramsForCompiler(
  setting: unknown,
  compilerId: string,
  globalCompilerId: string,
): ProgramMap | undefined {
  if (isFlatProgramsMap(setting)) {
    return compilerId === globalCompilerId ? { ...(setting as ProgramMap) } : undefined;
  }
  if (setting && typeof setting === 'object' && !Array.isArray(setting)) {
    const scoped = (setting as Record<string, unknown>)[compilerId];
    if (scoped && typeof scoped === 'object' && !Array.isArray(scoped)) return { ...(scoped as ProgramMap) };
  }
  return undefined;
}

/** 写入：把 `programs` 记到 `compilerId` 名下（先迁移旧扁平形态；`programs` 为空则删除该条目） */
export function setProgramsForCompiler(
  setting: unknown,
  compilerId: string,
  programs: ProgramMap | undefined,
  globalCompilerId: string,
): Record<string, ProgramMap> {
  const next = normalizeProgramsSetting(setting, globalCompilerId);
  if (programs && Object.keys(programs).length > 0) next[compilerId] = { ...programs };
  else delete next[compilerId];
  return next;
}
