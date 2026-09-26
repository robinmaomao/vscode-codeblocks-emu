// 快捷键回归：结构校验（唯一性 / cbStyle 门控 / 白名单 / when 合法性）
// + 冲突检测纯逻辑（collectConflicts / parseJsonc / 默认冲突表）
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const { collectConflicts, parseJsonc, normalizeKey, CB_STYLE_WHEN, VSCODE_DEFAULT_CONFLICTS } = require('../dist/tools/keybindingConflicts.js');
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const bindings = pkg.contributes.keybindings || [];
const contributed = new Set((pkg.contributes.commands || []).map((c) => c.command));

// ---- 1. 键位唯一性（同 key + when 不得对应两个不同命令） ----
const seen = new Map();
let uniqOk = true;
let dupMsg = '';
for (const b of bindings) {
  const k = normalizeKey(b.key) + '|' + (b.when ?? '');
  if (seen.has(k) && seen.get(k) !== b.command) { uniqOk = false; dupMsg = `${k} → ${seen.get(k)} / ${b.command}`; }
  seen.set(k, b.command);
}
check('键位唯一性（同 key+when 无多命令）', uniqOk, dupMsg, '唯一');

// ---- 2. cbStyle 门控完整性 ----
const gatedExpected = ['f5', 'shift+f8', 'f2', 'ctrl+r', 'ctrl+shift+b', 'ctrl+shift+c', 'ctrl+shift+s', 'ctrl+q', 'f12', 'f7', 'shift+f7', 'ctrl+f7'];
const gatedActual = bindings.filter((b) => (b.when ?? '').includes(CB_STYLE_WHEN)).map((b) => normalizeKey(b.key)).sort();
check('cbStyle 门控键集合与预期一致（12 项）',
  JSON.stringify(gatedActual) === JSON.stringify([...gatedExpected].sort()), gatedActual, gatedExpected);
const ungated = bindings.filter((b) => !(b.when ?? '').includes(CB_STYLE_WHEN));
check('非门控键位不含 cbStyle 选项串', ungated.every((b) => !(b.when ?? '').includes('cbStyle')), 'n/a', 'none');

// ---- 3. 默认键位清单齐全（对齐 CB + 安全新增） ----
const expectedDefaults = [
  'ctrl+f9', 'f9', 'ctrl+f10', 'ctrl+f11', 'ctrl+shift+f9', 'f8', 'f4', 'shift+f4', 'alt+f5', 'alt+f6',
  'alt+f1', 'alt+f2', 'alt+g', 'shift+f2', 'ctrl+shift+r', 'ctrl+shift+up', 'ctrl+shift+down', 'ctrl+e',
];
const actualKeys = bindings.map((b) => normalizeKey(b.key));
const missing = expectedDefaults.filter((k) => !actualKeys.includes(k));
check('默认键位清单齐全（18 项）', missing.length === 0, missing, '无缺失');

// ---- 4. 命令有效性 ----
const builtinAllow = new Set([
  'workbench.action.quickOpen', 'workbench.action.replaceInFiles',
  'editor.action.addSelectionToNextFindMatch', 'editor.debug.action.toggleBreakpoint',
  'workbench.action.debug.stop', 'editor.action.startFindReplaceAction',
  'editor.action.jumpToBracket', 'editor.action.commentLine',
  'workbench.action.files.saveAll', 'workbench.action.quit', 'editor.toggleFold',
  'workbench.action.debug.stepOver', 'workbench.action.debug.stepInto', 'workbench.action.debug.stepOut',
]);
let cmdOk = true;
let cmdMsg = '';
const builtinUsed = new Set();
// 运行时注册的 codeblocks.* 命令（不在 package.json contributes.commands 中）
const runtimeRegistered = new Set(['codeblocks.buildLog.focus', 'codeblocks.projectTree.focus']);
for (const b of bindings) {
  if (b.command.startsWith('codeblocks.')) {
    if (!contributed.has(b.command) && !runtimeRegistered.has(b.command)) { cmdOk = false; cmdMsg = `${b.command} 未在 contributes.commands`; }
  } else {
    builtinUsed.add(b.command);
    if (!builtinAllow.has(b.command)) { cmdOk = false; cmdMsg = `${b.command} 不在内置白名单`; }
  }
}
check('键位命令均有效（codeblocks.* 交叉校验 + 内置白名单）', cmdOk, cmdMsg, '有效');
const stale = [...builtinAllow].filter((c) => !builtinUsed.has(c));
check('内置白名单无冗余（反向校验）', stale.length === 0, stale, '无冗余');

// ---- 5. when 子句基础合法性 ----
let whenOk = true;
let whenMsg = '';
for (const b of bindings) {
  if (!b.when) continue;
  const w = b.when;
  if (!/^[\w\s.!&|()='<>\-]+$/.test(w)) { whenOk = false; whenMsg = `${b.command}: ${w}`; }
  let depth = 0;
  for (const ch of w) { if (ch === '(') depth++; else if (ch === ')') depth--; if (depth < 0) break; }
  if (depth !== 0) { whenOk = false; whenMsg = `括号不平衡: ${w}`; }
}
check('when 子句合法（字符集 / 括号平衡）', whenOk, whenMsg, '合法');

// ---- 6. collectConflicts 纯逻辑 ----
const own = [
  { key: 'f9', command: 'codeblocks.buildAndRun', when: 'editorTextFocus && !inDebugMode', source: '扩展' },
  { key: 'F5', command: 'editor.debug.action.toggleBreakpoint', when: CB_STYLE_WHEN + ' && editorTextFocus', source: '扩展' },
  { key: 'ctrl+f9', command: 'codeblocks.build', when: 'editorTextFocus', source: '扩展' },
  { key: 'alt+g', command: 'workbench.action.quickOpen', source: '扩展' },
];
const user = [{ key: 'ctrl+f9', command: 'my.otherCommand', source: '用户 keybindings.json' }];
const others = [{ key: 'Alt+G', command: 'gitlens.someCommand', source: '扩展:gitlens' }];
const found = collectConflicts(own, user, others);
const byKey = new Map(found.map((f) => [normalizeKey(f.key), f]));
check('F9 未门控 → high（覆盖 VS Code 切换断点）', byKey.get('f9')?.level === 'high', byKey.get('f9')?.level, 'high');
check('F5 已门控 → info', byKey.get('f5')?.level === 'info', byKey.get('f5')?.level, 'info');
check('Ctrl+F9 用户撞车 → high', byKey.get('ctrl+f9')?.level === 'high', byKey.get('ctrl+f9')?.level, 'high');
check('Alt+G 其他扩展撞车 → medium', byKey.get('alt+g')?.level === 'medium', byKey.get('alt+g')?.level, 'medium');
check('F9 冲突来源含 VS Code 默认表', (byKey.get('f9')?.findings ?? []).some((f) => f.source === 'VS Code 默认'), byKey.get('f9')?.findings, '含默认');
const quiet = collectConflicts(own, user, [], { includeDefaults: false });
check('includeDefaults=false 不含默认表', quiet.every((f) => f.findings.every((x) => x.source !== 'VS Code 默认')), quiet, '无默认');

// ---- 7. parseJsonc ----
const jsonc = `{
  // 注释行
  "a": "含 // 与 /* 的字符串",
  "b": [1, 2,], /* 块注释 */
  "c": "x\\"y",
}`;
let parsedOk = false;
try {
  const o = parseJsonc(jsonc);
  parsedOk = o.a === '含 // 与 /* 的字符串' && JSON.stringify(o.b) === '[1,2]' && o.c === 'x"y';
} catch (e) { parsedOk = false; console.log('parseJsonc error:', e.message); }
check('parseJsonc 去注释/尾逗号且保留字符串内容', parsedOk, null, true);

// ---- 8. 默认冲突表键位规范 ----
const badKeys = Object.keys(VSCODE_DEFAULT_CONFLICTS).filter((k) => k !== normalizeKey(k));
check('VSCODE_DEFAULT_CONFLICTS 键位均为归一化格式', badKeys.length === 0, badKeys, '规范');

console.log(`快捷键回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
