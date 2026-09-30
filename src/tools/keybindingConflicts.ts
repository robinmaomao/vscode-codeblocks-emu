/**
 * 快捷键冲突检测（纯逻辑，无 vscode 依赖，供扩展运行时与回归测试共用）
 *
 * 冲突来源：
 *   1) VS Code 内置默认键位（VSCODE_DEFAULT_CONFLICTS 精简表，来源：官方 Default keyboard shortcuts reference）
 *   2) 用户 keybindings.json（真实撞车，最高优先级）
 *   3) 其他已安装扩展的 contributes.keybindings（%USERPROFILE%\.vscode\extensions\*\package.json）
 *
 * 扩展键位策略：默认键位全部避开 VS Code 默认；与 VS Code 核心默认冲突的 CB 键位
 * 统一用 when 门控 `config.codeblocks.keybindings.cbStyle`（CB 保真模式，默认关闭）。
 */

/** 单条键位定义（任意来源） */
export interface KeybindingDef {
  key: string;
  command: string;
  when?: string;
  /** 来源标签：'扩展' / '用户 keybindings.json' / '扩展:<name>' / 'VS Code 默认' */
  source: string;
}

/** 一条冲突检测结果（对应扩展自身的一条键位） */
export interface ConflictItem {
  key: string;
  command: string;
  when?: string;
  /** 仅在 CB 保真模式（codeblocks.keybindings.cbStyle）生效 */
  gated: boolean;
  /** 与之冲突的键位条目 */
  findings: KeybindingDef[];
  /** high = 默认生效且覆盖 VS Code 核心键 / 用户撞车；medium = 其他扩展撞车；info = 仅门控或上下文受限 */
  level: 'high' | 'medium' | 'info';
  /** 冲突说明（来自内置默认表） */
  note?: string;
}

/** CB 保真模式的 when 门控片段 */
export const CB_STYLE_WHEN = 'config.codeblocks.keybindings.cbStyle';

/** VS Code 默认冲突表（key = 归一化键位；severity=info 表示上下文受限、真实冲突概率低） */
export const VSCODE_DEFAULT_CONFLICTS: Record<string, { command: string; note: string; severity?: 'high' | 'info' }[]> = {
  'f9': [{ command: 'editor.debug.action.toggleBreakpoint', note: 'VS Code 默认：切换断点', severity: 'high' }],
  'f8': [{ command: 'editor.action.marker.nextInFiles', note: 'VS Code 默认：下一错误/警告（Shift+F8 为上一个）', severity: 'high' }],
  'shift+f8': [{ command: 'editor.action.marker.prevInFiles', note: 'VS Code 默认：上一错误/警告', severity: 'high' }],
  'f5': [{ command: 'workbench.action.debug.start / debug.continue', note: 'VS Code 默认：启动/继续调试', severity: 'high' }],
  'f2': [{ command: 'editor.action.rename', note: 'VS Code 默认：重命名符号', severity: 'high' }],
  'f12': [{ command: 'editor.action.revealDefinition', note: 'VS Code 默认：转到定义', severity: 'high' }],
  'shift+f12': [{ command: 'editor.action.goToReferences', note: 'VS Code 默认：查找所有引用', severity: 'high' }],
  'ctrl+r': [{ command: 'workbench.action.openRecent', note: 'VS Code 默认：打开最近', severity: 'high' }],
  'ctrl+shift+b': [{ command: 'workbench.action.tasks.build', note: 'VS Code 默认：运行生成任务', severity: 'high' }],
  'ctrl+shift+c': [{ command: 'workbench.action.terminal.openNativeConsole', note: 'VS Code 默认：打开新命令行', severity: 'high' }],
  'ctrl+q': [{ command: 'workbench.action.quickOpenView', note: 'VS Code 默认：快速打开视图', severity: 'high' }],
  'ctrl+shift+s': [{ command: 'workbench.action.files.saveAs', note: 'VS Code 默认：另存为', severity: 'high' }],
  'ctrl+shift+r': [{ command: 'rerunSearchEditorSearch', note: '仅 Search Editor 内生效；扩展绑定以 !inSearchEditor 规避', severity: 'info' }],
  'f4': [{ command: 'search.action.focusNextSearchResult', note: '仅搜索视图聚焦时生效；扩展绑定为 editorTextFocus，上下文不重叠', severity: 'info' }],
  'shift+f4': [{ command: 'search.action.focusPreviousSearchResult', note: '仅搜索视图聚焦时生效；上下文不重叠', severity: 'info' }],
  'ctrl+e': [{ command: '(未见官方默认表)', note: '官方默认表未列出；若有其他绑定将被检测命令报告', severity: 'info' }],
};

/** 键位归一化：小写 + 压缩空白（空格是 cord 分隔符，需保留单空格） */
export function normalizeKey(key: string): string {
  return String(key).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * 简化 JSONC 解析：去 `//` 与 `/* *\/` 注释（保留字符串内原样）、去尾随逗号。
 * keybindings.json 允许注释，但 JSON.parse 不允许。
 */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  let inStr = false;
  while (i < text.length) {
    const ch = text[i];
    const nx = text[i + 1];
    if (inStr) {
      out += ch;
      if (ch === '\\') { out += nx ?? ''; i += 2; continue; }
      if (ch === '"') inStr = false;
      i++;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; i++; continue; }
    if (ch === '/' && nx === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (ch === '/' && nx === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return JSON.parse(out.replace(/,\s*([}\]])/g, '$1'));
}

const USER_SOURCE = '用户 keybindings.json';
const DEFAULT_SOURCE = 'VS Code 默认';

/** 汇总冲突：own = 扩展自身键位；user = 用户；others = 其他扩展 */
export function collectConflicts(
  own: KeybindingDef[],
  user: KeybindingDef[],
  others: KeybindingDef[],
  opts: { includeDefaults?: boolean } = {},
): ConflictItem[] {
  const includeDefaults = opts.includeDefaults !== false;
  const out: ConflictItem[] = [];
  const seen = new Set<string>();
  for (const b of own) {
    const key = normalizeKey(b.key);
    const dedupKey = `${key}|${b.when ?? ''}`;
    if (seen.has(dedupKey)) continue;
    seen.add(dedupKey);
    const gated = (b.when ?? '').includes(CB_STYLE_WHEN);

    const findings: KeybindingDef[] = [];
    for (const u of user) {
      if (normalizeKey(u.key) === key) findings.push({ ...u, source: u.source || USER_SOURCE });
    }
    for (const o of others) {
      if (normalizeKey(o.key) === key) findings.push(o);
    }
    const defaults = VSCODE_DEFAULT_CONFLICTS[key] ?? [];
    if (includeDefaults) {
      for (const d of defaults) findings.push({ key, command: d.command, source: DEFAULT_SOURCE, when: d.note });
    }
    if (!findings.length) continue;

    const hasUser = findings.some((f) => f.source === USER_SOURCE);
    const hasOther = findings.some((f) => f.source !== USER_SOURCE && f.source !== DEFAULT_SOURCE);
    const hasHighDefault = defaults.some((d) => d.severity !== 'info');
    let level: ConflictItem['level'] = 'info';
    if (hasUser) level = 'high';
    else if (hasOther) level = 'medium';
    else if (!gated && hasHighDefault) level = 'high';

    out.push({
      key: b.key,
      command: b.command,
      when: b.when,
      gated,
      findings,
      level,
      note: defaults.map((d) => d.note).join('；') || undefined,
    });
  }
  return out;
}
