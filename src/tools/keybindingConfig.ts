/**
 * 快捷键托管配置（纯逻辑，无 vscode 依赖，供扩展运行时与回归测试共用）
 *
 * 背景：VS Code 扩展无法动态注册键位——"在设置里配置快捷键"的落地方式是：
 *   1) 设置 `codeblocks.keybindings.overrides` 作为唯一数据源；
 *   2) 扩展把设置**物化写入用户 keybindings.json**（仅增删托管条目；自定义键 = 正向条目 +
 *      对默认键的移除规则 `-command`；解绑 = 仅移除规则）；
 *   3) 其它条目与注释原样保留（条目级文本手术，不整体重排文件）。
 */
import { CB_STYLE_WHEN, normalizeKey, parseJsonc } from './keybindingConflicts';

/** 可配置的键位条目（id 稳定，供设置引用） */
export interface ManagedKeybinding {
  /** 设置中的键名（overrides 的属性名） */
  id: string;
  /** 中文名（向导显示） */
  label: string;
  /** VS Code 命令 ID */
  command: string;
  /** 生效条件（与 package.json 默认条目一致） */
  when?: string;
  /** 默认键集合（package.json 中该命令的全部绑定） */
  defaults: string[];
  /** 分组：builtin = 默认启用；cbStyle = CB 保真模式门控；alias = 外部命令别名 */
  group: 'builtin' | 'cbStyle' | 'alias';
}

/** 期望写入用户 keybindings.json 的条目（command 以 '-' 开头表示移除规则） */
export interface DesiredEntry {
  key: string;
  command: string;
  when?: string;
}

/** 托管键位表（与 package.json 的一致性由 tests/test-keybinding-config.js 强制） */
export const MANAGED_KEYBINDINGS: ManagedKeybinding[] = [
  // ---- builtin：默认启用 ----
  { id: 'build', label: 'Build（构建活动工程）', command: 'codeblocks.build', when: 'editorTextFocus', defaults: ['ctrl+f9'], group: 'builtin' },
  { id: 'rebuild', label: 'Rebuild（全量重编译）', command: 'codeblocks.rebuild', when: 'editorTextFocus', defaults: ['ctrl+f11'], group: 'builtin' },
  { id: 'clean', label: 'Clean（清理）', command: 'codeblocks.clean', when: 'editorTextFocus', defaults: [], group: 'builtin' },
  { id: 'run', label: 'Run（运行）', command: 'codeblocks.run', when: 'editorTextFocus', defaults: ['ctrl+f10'], group: 'builtin' },
  { id: 'buildAndRun', label: 'Build and Run（构建并运行）', command: 'codeblocks.buildAndRun', when: 'editorTextFocus && !inDebugMode', defaults: ['f9'], group: 'builtin' },
  { id: 'compileCurrentFile', label: 'Compile Current File（编译当前文件）', command: 'codeblocks.compileCurrentFile', when: 'editorTextFocus', defaults: ['ctrl+shift+f9'], group: 'builtin' },
  { id: 'debug', label: 'Debug / Continue（调试）', command: 'codeblocks.debug', when: 'editorTextFocus && !inDebugMode', defaults: ['f8'], group: 'builtin' },
  { id: 'nextError', label: 'Next Error（下一错误）', command: 'codeblocks.nextError', when: 'editorTextFocus', defaults: ['f4', 'alt+f2'], group: 'builtin' },
  { id: 'prevError', label: 'Previous Error（上一错误）', command: 'codeblocks.prevError', when: 'editorTextFocus', defaults: ['shift+f4', 'alt+f1'], group: 'builtin' },
  { id: 'activatePriorProject', label: 'Activate Prior Project（上一个工程）', command: 'codeblocks.activatePriorProject', defaults: ['alt+f5'], group: 'builtin' },
  { id: 'activateNextProject', label: 'Activate Next Project（下一个工程）', command: 'codeblocks.activateNextProject', defaults: ['alt+f6'], group: 'builtin' },
  { id: 'moveProjectUp', label: 'Move Project Up（上移工程）', command: 'codeblocks.moveProjectUp', when: 'focusedView == codeblocks.projectTree', defaults: ['ctrl+shift+up'], group: 'builtin' },
  { id: 'moveProjectDown', label: 'Move Project Down（下移工程）', command: 'codeblocks.moveProjectDown', when: 'focusedView == codeblocks.projectTree', defaults: ['ctrl+shift+down'], group: 'builtin' },
  { id: 'projectTreeFocus', label: 'Project 视图聚焦（Manager）', command: 'codeblocks.projectTree.focus', defaults: ['shift+f2'], group: 'builtin' },
  { id: 'buildLogFocus', label: 'Build Log 聚焦', command: 'codeblocks.buildLog.focus', defaults: [], group: 'builtin' },
  // ---- alias：外部命令别名 ----
  { id: 'aliasGotoFile', label: 'Goto File（Alt+G → 快速打开）', command: 'workbench.action.quickOpen', defaults: ['alt+g'], group: 'alias' },
  { id: 'aliasReplaceInFiles', label: 'Replace in Files', command: 'workbench.action.replaceInFiles', when: '!inSearchEditor', defaults: ['ctrl+shift+r'], group: 'alias' },
  { id: 'aliasSelectNextMatch', label: 'Select Next Occurrence（选择下一个匹配）', command: 'editor.action.addSelectionToNextFindMatch', when: 'editorTextFocus', defaults: ['ctrl+e'], group: 'alias' },
  // ---- cbStyle：CB 保真模式门控（cbStyle 开关保留为批量启用） ----
  { id: 'cbToggleBreakpoint', label: '[CB] Toggle breakpoint（切换断点）', command: 'editor.debug.action.toggleBreakpoint', when: `${CB_STYLE_WHEN} && editorTextFocus`, defaults: ['f5'], group: 'cbStyle' },
  { id: 'cbStopDebugger', label: '[CB] Stop debugger（停止调试）', command: 'workbench.action.debug.stop', when: `${CB_STYLE_WHEN} && inDebugMode`, defaults: ['shift+f8'], group: 'cbStyle' },
  { id: 'cbBuildLog', label: '[CB] Logs（打开 Build Log）', command: 'codeblocks.buildLog.focus', when: CB_STYLE_WHEN, defaults: ['f2'], group: 'cbStyle' },
  { id: 'cbReplace', label: '[CB] Replace（替换）', command: 'editor.action.startFindReplaceAction', when: `${CB_STYLE_WHEN} && editorTextFocus`, defaults: ['ctrl+r'], group: 'cbStyle' },
  { id: 'cbJumpBracket', label: '[CB] Goto matching brace（跳转括号）', command: 'editor.action.jumpToBracket', when: `${CB_STYLE_WHEN} && editorTextFocus`, defaults: ['ctrl+shift+b'], group: 'cbStyle' },
  { id: 'cbComment', label: '[CB] Comment（注释）', command: 'editor.action.commentLine', when: `${CB_STYLE_WHEN} && editorTextFocus`, defaults: ['ctrl+shift+c'], group: 'cbStyle' },
  { id: 'cbSaveAll', label: '[CB] Save everything（全部保存）', command: 'workbench.action.files.saveAll', when: CB_STYLE_WHEN, defaults: ['ctrl+shift+s'], group: 'cbStyle' },
  { id: 'cbQuit', label: '[CB] Quit（退出）', command: 'workbench.action.quit', when: CB_STYLE_WHEN, defaults: ['ctrl+q'], group: 'cbStyle' },
  { id: 'cbToggleFold', label: '[CB] Toggle fold（折叠当前块）', command: 'editor.toggleFold', when: `${CB_STYLE_WHEN} && editorTextFocus`, defaults: ['f12'], group: 'cbStyle' },
  { id: 'cbStepOver', label: '[CB] Next line（单步跳过）', command: 'workbench.action.debug.stepOver', when: `${CB_STYLE_WHEN} && inDebugMode`, defaults: ['f7'], group: 'cbStyle' },
  { id: 'cbStepInto', label: '[CB] Step into（单步进入）', command: 'workbench.action.debug.stepInto', when: `${CB_STYLE_WHEN} && inDebugMode`, defaults: ['shift+f7'], group: 'cbStyle' },
  { id: 'cbStepOut', label: '[CB] Step out（单步跳出）', command: 'workbench.action.debug.stepOut', when: `${CB_STYLE_WHEN} && inDebugMode`, defaults: ['ctrl+f7'], group: 'cbStyle' },
];

/** 托管命令集合（含 '-' 移除规则对应命令） */
export const MANAGED_COMMANDS: Set<string> = new Set(MANAGED_KEYBINDINGS.map((m) => m.command));

const MODIFIERS = new Set(['ctrl', 'shift', 'alt', 'cmd', 'meta', 'win']);
const KEY_RE = /^(f([1-9]|1[0-9]|2[0-4])|[a-z0-9`\-=[\]\\;',./]|left|right|up|down|pageup|pagedown|home|end|tab|enter|escape|space|backspace|delete|insert|numpad[0-9]|numpad_add|numpad_subtract|numpad_multiply|numpad_divide|numpad_decimal|numpad_separator)$/;

/** 校验键位串（支持最多两段 chord，如 "ctrl+k ctrl+c"） */
export function validateChord(value: string): { ok: boolean; error?: string } {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return { ok: false, error: '键位不能为空' };
  const parts = v.split(/\s+/);
  if (parts.length > 2) return { ok: false, error: '最多两段组合键（如 ctrl+k ctrl+c）' };
  for (const part of parts) {
    const segs = part.split('+');
    const key = segs[segs.length - 1];
    const mods = segs.slice(0, -1);
    if (!KEY_RE.test(key)) return { ok: false, error: `无法识别的按键: ${key}` };
    for (const m of mods) {
      if (!MODIFIERS.has(m)) return { ok: false, error: `无法识别的修饰键: ${m}` };
    }
    if (mods.length === 0 && /^[a-z0-9]$/.test(key)) {
      return { ok: false, error: '单字符键必须搭配修饰键（避免抢占输入）' };
    }
  }
  return { ok: true };
}

/** 解析设置中的 overrides（未知 id / 非法值单独返回，不影响其余项） */
export function parseOverrides(raw: unknown): { overrides: Map<string, string>; invalid: { id: string; value: string; error: string }[]; unknown: string[] } {
  const overrides = new Map<string, string>();
  const invalid: { id: string; value: string; error: string }[] = [];
  const unknown: string[] = [];
  const known = new Set(MANAGED_KEYBINDINGS.map((m) => m.id));
  if (!raw || typeof raw !== 'object') return { overrides, invalid, unknown };
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(id)) { unknown.push(id); continue; }
    const s = String(value ?? '');
    if (s.trim() === '') { overrides.set(id, ''); continue; } // 解绑
    const v = validateChord(s);
    if (!v.ok) { invalid.push({ id, value: s, error: v.error ?? '非法' }); continue; }
    overrides.set(id, s.trim().toLowerCase());
  }
  return { overrides, invalid, unknown };
}

/**
 * 由 overrides 计算"期望写入用户 keybindings.json"的条目：
 *  - 未覆盖 → 无条目（依赖 package.json 默认）
 *  - 解绑（''）→ 对全部默认键生成移除规则
 *  - 自定义键 → 正向条目（when 与默认一致）+ 对其它默认键的移除规则
 */
export function computeDesiredEntries(overrides: Map<string, string>, managed: ManagedKeybinding[] = MANAGED_KEYBINDINGS): DesiredEntry[] {
  const out: DesiredEntry[] = [];
  const seen = new Set<string>();
  const push = (e: DesiredEntry): void => {
    const k = `${normalizeKey(e.key)}|${e.command}|${e.when ?? ''}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(e);
  };
  for (const m of managed) {
    const raw = overrides.get(m.id);
    if (raw === undefined) continue;
    const value = raw.trim();
    if (value === '') {
      for (const d of m.defaults) push({ key: d, command: `-${m.command}` });
      continue;
    }
    const isDefaultKey = m.defaults.some((d) => normalizeKey(d) === normalizeKey(value));
    for (const d of m.defaults) {
      if (normalizeKey(d) !== normalizeKey(value)) push({ key: d, command: `-${m.command}` });
    }
    if (!isDefaultKey) push({ key: value, command: m.command, when: m.when });
  }
  return out;
}

/** 顶层数组结构（元素仅统计对象项） */
export interface TopLevelArraySpan {
  openIdx: number;
  closeIdx: number;
  elements: { start: number; end: number }[];
}

/** 注释/字符串感知地定位顶层数组与各对象元素 span；无数组返回 undefined */
export function findTopLevelArray(text: string): TopLevelArraySpan | undefined {
  let inStr = false;
  let depth = 0;
  let open = -1;
  let elemStart = -1;
  const elements: { start: number; end: number }[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const nx = text[i + 1];
    if (inStr) {
      if (ch === '\\') { i += 2; continue; }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') { inStr = true; i++; continue; }
    if (ch === '/' && nx === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '[') { if (open === -1) open = i; depth++; i++; continue; }
    if (ch === '{') { if (depth === 1 && elemStart === -1) elemStart = i; depth++; i++; continue; }
    if (ch === '}') {
      depth--;
      if (depth === 1 && elemStart !== -1) { elements.push({ start: elemStart, end: i + 1 }); elemStart = -1; }
      i++;
      continue;
    }
    if (ch === ']') {
      depth--;
      if (open !== -1 && depth === 0) return { openIdx: open, closeIdx: i, elements };
      i++;
      continue;
    }
    i++;
  }
  return undefined;
}

/** 读取文件中属于托管命令的条目（仅正向条目；command 以 '-' 开头的不计） */
export function readManagedEntries(text: string, managedCommands: Set<string> = MANAGED_COMMANDS): DesiredEntry[] {
  const span = findTopLevelArray(text);
  const out: DesiredEntry[] = [];
  for (const el of span?.elements ?? []) {
    try {
      const obj = parseJsonc(text.slice(el.start, el.end)) as any;
      const command = typeof obj?.command === 'string' ? obj.command : '';
      if (!command || command.startsWith('-') || !managedCommands.has(command)) continue;
      out.push({ key: String(obj.key ?? ''), command, when: obj.when ? String(obj.when) : undefined });
    } catch { /* 单个条目解析失败则跳过 */ }
  }
  return out;
}

/** D7：期望条目与文件中实际条目的差异 */
export function diffManaged(desired: DesiredEntry[], fileEntries: DesiredEntry[]): { missing: DesiredEntry[]; extra: DesiredEntry[] } {
  const key = (e: DesiredEntry): string => `${normalizeKey(e.key)}|${e.command}|${e.when ?? ''}`;
  const want = new Set(desired.filter((d) => !d.command.startsWith('-')).map(key));
  const got = new Set(fileEntries.map(key));
  return {
    missing: desired.filter((d) => !d.command.startsWith('-') && !got.has(key(d))),
    extra: fileEntries.filter((e) => !want.has(key(e))),
  };
}

/** 生成单条条目的 JSON 文本（key/command/when 顺序稳定） */
export function serializeEntry(e: DesiredEntry): string {
  const obj: Record<string, string> = { key: e.key, command: e.command };
  if (e.when) obj.when = e.when;
  return JSON.stringify(obj);
}

/** 判断 [open, close) 区域内除注释/空白外是否无代码（用于选择插入策略） */
function bodyIsEmpty(text: string, from: number, to: number): boolean {
  let i = from;
  while (i < to) {
    const ch = text[i];
    const nx = text[i + 1];
    if (ch === '"') { return false; }
    if (ch === '/' && nx === '/') { while (i < to && text[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') { i += 2; while (i < to && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    if (!/\s/.test(ch)) return false;
    i++;
  }
  return true;
}

/**
 * 条目级文本手术：
 *  - 删除所有 command ∈ managedCommands（或 `-command` 形式）的既有条目；
 *  - 在数组末尾插入 desired 条目；
 *  - 其余内容（含注释）原样保留；changed=false 表示无需写入。
 */
export function updateKeybindingsText(
  text: string,
  desired: DesiredEntry[],
  managedCommands: Set<string> = MANAGED_COMMANDS,
): { text: string; changed: boolean; added: number; removed: number } {
  const span = findTopLevelArray(text);

  // 无数组：追加（保留原有注释文本）
  if (!span) {
    if (desired.length === 0) return { text, changed: false, added: 0, removed: 0 };
    const body = desired.map((d) => serializeEntry(d));
    const prefix = text.trim() === '' ? '' : text.replace(/\s*$/, '') + '\n';
    return { text: `${prefix}[\n  ${body.join(',\n  ')}\n]\n`, changed: true, added: desired.length, removed: 0 };
  }

  // 分类既有元素：与期望一致的保留；多余的删除；缺失的稍后插入
  const norm = (e: DesiredEntry): string => `${normalizeKey(e.key)}|${e.command}|${e.when ?? ''}`;
  const desiredSet = new Set(desired.map(norm));
  const existingAll: DesiredEntry[] = [];
  const removedSpans: { start: number; end: number }[] = [];
  for (const el of span.elements) {
    let obj: any;
    try { obj = parseJsonc(text.slice(el.start, el.end)); } catch { obj = undefined; }
    const command = typeof obj?.command === 'string' ? obj.command : '';
    const base = command.startsWith('-') ? command.slice(1) : command;
    if (!base || !managedCommands.has(base)) continue;
    const entry: DesiredEntry = { key: String(obj.key ?? ''), command, when: obj.when ? String(obj.when) : undefined };
    existingAll.push(entry);
    if (!desiredSet.has(norm(entry))) removedSpans.push(el);
  }
  const existingSet = new Set(existingAll.map(norm));
  const addedEntries = desired.filter((d) => !existingSet.has(norm(d)));
  const removedEntries = existingAll.filter((e) => !desiredSet.has(norm(e)));
  if (addedEntries.length === 0 && removedEntries.length === 0) {
    return { text, changed: false, added: 0, removed: 0 };
  }

  // 从后往前删除（含逗号处理：优先"元素+后继逗号"，否则"前驱逗号+元素"）
  let out = text;
  for (const el of [...removedSpans].sort((a, b) => b.start - a.start)) {
    let j = el.end;
    while (j < out.length && /\s/.test(out[j])) j++;
    if (out[j] === ',') {
      out = out.slice(0, el.start) + out.slice(j + 1);
      continue;
    }
    let k = el.start - 1;
    while (k >= 0 && /\s/.test(out[k])) k--;
    if (out[k] === ',') {
      out = out.slice(0, k) + out.slice(el.end);
      continue;
    }
    out = out.slice(0, el.start) + out.slice(el.end);
  }

  if (desired.length === 0) {
    return { text: out, changed: true, added: 0, removed: removedEntries.length };
  }

  // 插入 desired（重新定位数组）
  const span2 = findTopLevelArray(out);
  if (!span2) {
    // 理论上不会发生；兜底整体重建
    const body = desired.map((d) => serializeEntry(d));
    return { text: `[\n  ${body.join(',\n  ')}\n]\n`, changed: true, added: addedEntries.length, removed: removedEntries.length };
  }
  const body = addedEntries.map((d) => serializeEntry(d));
  if (bodyIsEmpty(out, span2.openIdx + 1, span2.closeIdx)) {
    const ins = `\n  ${body.join(',\n  ')}\n`;
    out = out.slice(0, span2.openIdx + 1) + ins + out.slice(span2.closeIdx);
  } else {
    let p = span2.closeIdx - 1;
    while (p >= 0 && /\s/.test(out[p])) p--;
    const needComma = out[p] !== ',';
    const ins = `${needComma ? ',' : ''}\n  ${body.join(',\n  ')}\n`;
    out = out.slice(0, p + 1) + ins + out.slice(p + 1);
  }
  return { text: out, changed: true, added: addedEntries.length, removed: removedEntries.length };
}
