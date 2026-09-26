// 快捷键托管配置回归：
//  - 托管表 ↔ package.json 一致性（默认键 / when 双向校验）
//  - chord 校验 / overrides 解析 / 期望条目生成（含移除规则）
//  - keybindings.json 条目级文本手术（注释保留 / 尾部逗号 / 空文件 / 幂等 / 重置）
//  - D7：托管覆盖 vs 文件实际条目差异
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const {
  MANAGED_KEYBINDINGS, MANAGED_COMMANDS, validateChord, parseOverrides, computeDesiredEntries,
  findTopLevelArray, readManagedEntries, diffManaged, serializeEntry, updateKeybindingsText,
} = require('../dist/tools/keybindingConfig.js');
const { normalizeKey, parseJsonc } = require('../dist/tools/keybindingConflicts.js');

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const bindings = pkg.contributes.keybindings || [];
const norm = (s) => normalizeKey(s);

// ---- 1. 托管表 ↔ package.json 一致性（双向） ----
let tableOk = true;
let tableMsg = '';
for (const m of MANAGED_KEYBINDINGS) {
  for (const d of m.defaults) {
    const hit = bindings.some((b) => b.command === m.command && norm(b.key) === norm(d) && (b.when ?? undefined) === (m.when ?? undefined));
    if (!hit) { tableOk = false; tableMsg = `${m.id}: package.json 缺少 {${m.command}, ${d}, when=${m.when ?? '-'}}`; }
  }
}
check('托管表默认键均在 package.json 中（含 when 一致）', tableOk, tableMsg, '一致');

let reverseOk = true;
let reverseMsg = '';
for (const b of bindings) {
  if (!MANAGED_COMMANDS.has(b.command)) continue;
  const m = MANAGED_KEYBINDINGS.find((x) => x.command === b.command && (x.when ?? undefined) === (b.when ?? undefined));
  if (!m) { reverseOk = false; reverseMsg = `${b.command} (when=${b.when ?? '-'}) 无对应托管条目`; continue; }
  if (!m.defaults.some((d) => norm(d) === norm(b.key))) { reverseOk = false; reverseMsg = `${m.id}: 默认键列表缺少 ${b.key}`; }
}
check('package.json 托管命令键位均登记在托管表（反向）', reverseOk, reverseMsg, '一致');

// ---- 2. 表结构合法性 ----
const ids = MANAGED_KEYBINDINGS.map((m) => m.id);
check('托管 id 唯一且格式稳定', new Set(ids).size === ids.length && ids.every((i) => /^[a-zA-Z][\w]*$/.test(i)), ids, '唯一');
check('分组取值合法', MANAGED_KEYBINDINGS.every((m) => ['builtin', 'cbStyle', 'alias'].includes(m.group)), 'n/a', '合法');

// ---- 3. validateChord ----
const validCases = ['ctrl+alt+b', 'f7', 'shift+f7', 'alt+f1', 'ctrl+k ctrl+c', 'ctrl+shift+up'];
const invalidCases = ['b', 'ctrl+', 'ctrl+foo', 'a b c', 'ctrl+alt+'];
check('validateChord 合法样例', validCases.every((t) => validateChord(t).ok), validCases.filter((t) => !validateChord(t).ok), '全合法');
check('validateChord 非法样例', invalidCases.every((t) => !validateChord(t).ok), invalidCases.filter((t) => validateChord(t).ok), '全非法');

// ---- 4. parseOverrides ----
const parsed = parseOverrides({ build: 'Ctrl+Alt+B', clean: '', 'no-such': 'x', rebuild: 'ctrl+@@' });
check('parseOverrides 未知键名识别', parsed.unknown.length === 1 && parsed.unknown[0] === 'no-such', parsed.unknown, ['no-such']);
check('parseOverrides 非法值识别', parsed.invalid.length === 1 && parsed.invalid[0].id === 'rebuild', parsed.invalid, 'rebuild');
check('parseOverrides 合法值小写归一 + 解绑', parsed.overrides.get('build') === 'ctrl+alt+b' && parsed.overrides.get('clean') === '', [...parsed.overrides.entries()], 'build/clean');

// ---- 5. computeDesiredEntries ----
const mBuild = MANAGED_KEYBINDINGS.find((m) => m.id === 'build');
const mNext = MANAGED_KEYBINDINGS.find((m) => m.id === 'nextError');
check('未覆盖 → 无条目', computeDesiredEntries(new Map()).length === 0, computeDesiredEntries(new Map()), '[]');
const unbind = computeDesiredEntries(new Map([['build', '']]));
check('解绑 → 仅移除默认键', unbind.length === 1 && unbind[0].command === '-codeblocks.build' && norm(unbind[0].key) === 'ctrl+f9', unbind, '移除规则');
const custom = computeDesiredEntries(new Map([['build', 'ctrl+alt+b']]));
check('自定义键 → 正向 + 移除旧默认', custom.length === 2
  && custom.some((e) => e.command === 'codeblocks.build' && e.key === 'ctrl+alt+b' && e.when === mBuild.when)
  && custom.some((e) => e.command === '-codeblocks.build' && norm(e.key) === 'ctrl+f9'), custom, '正向+移除');
const partialDefault = computeDesiredEntries(new Map([['nextError', 'f4']]));
check('覆盖为多默认之一 → 仅移除其余默认', partialDefault.length === 1
  && partialDefault[0].command === '-codeblocks.nextError' && norm(partialDefault[0].key) === 'alt+f2',
  partialDefault, `移除 alt+f2（nextError when=${mNext.when}）`);

// ---- 6. serializeEntry 顺序 ----
check('serializeEntry 输出顺序 key/command/when', serializeEntry({ key: 'f7', command: 'x.y', when: 'a' }) === '{"key":"f7","command":"x.y","when":"a"}',
  serializeEntry({ key: 'f7', command: 'x.y', when: 'a' }), '稳定顺序');

// ---- 7. 文本手术 ----
const fixture = `// 我的键位\n[\n  // 用户条目\n  { "key": "ctrl+shift+p", "command": "workbench.action.showCommands" },\n  { "key": "ctrl+f9", "command": "-codeblocks.build" },\n  { "key": "f5", "command": "codeblocks.debug" }\n]\n`;
const desired = [
  { key: 'ctrl+alt+b', command: 'codeblocks.build', when: 'editorTextFocus' },
  { key: 'ctrl+f9', command: '-codeblocks.build' },
];
const r1 = updateKeybindingsText(fixture, desired, MANAGED_COMMANDS);
check('手术：changed=true', r1.changed, r1, 'changed');
check('手术：保留注释与用户条目', r1.text.includes('// 我的键位') && r1.text.includes('// 用户条目') && r1.text.includes('"workbench.action.showCommands"'), r1.text, '保留');
check('手术：旧托管条目已清除', !r1.text.includes('codeblocks.debug'), r1.text, '无 f5 调试条目');
let reparsedOk = false;
try {
  const arr = parseJsonc(r1.text);
  reparsedOk = Array.isArray(arr) && arr.length === 3
    && arr.some((e) => e.key === 'ctrl+alt+b' && e.command === 'codeblocks.build' && e.when === 'editorTextFocus')
    && arr.some((e) => e.key === 'ctrl+f9' && e.command === '-codeblocks.build');
} catch (e) { reparsedOk = false; console.log('reparse error:', e.message, JSON.stringify(r1.text)); }
check('手术：结果可解析且条目正确', reparsedOk, r1.text, '3 条');

const r2 = updateKeybindingsText(r1.text, desired, MANAGED_COMMANDS);
check('手术：幂等（第二次 no-change）', !r2.changed, r2, 'no-change');

const r3 = updateKeybindingsText('', desired, MANAGED_COMMANDS);
check('手术：空文件创建数组', r3.changed && Array.isArray(parseJsonc(r3.text)) && parseJsonc(r3.text).length === 2, r3.text, '2 条');

const commentOnly = '// 只有注释\n';
const r4 = updateKeybindingsText(commentOnly, desired, MANAGED_COMMANDS);
check('手术：纯注释文件保留注释', r4.text.includes('// 只有注释') && Array.isArray(parseJsonc(r4.text)), r4.text, '注释+数组');

const trailing = `[\n  { "key": "shift+f2", "command": "codeblocks.projectTree.focus" },\n  { "key": "x", "command": "y" },\n]\n`;
const r5 = updateKeybindingsText(trailing, [], MANAGED_COMMANDS);
check('手术：删除首个条目（尾部逗号风格）', r5.changed && !r5.text.includes('projectTree.focus') && r5.text.includes('"command": "y"') && Array.isArray(parseJsonc(r5.text)), r5.text, '保留 y');

const lastRemoved = `[\n  { "key": "x", "command": "y" },\n  { "key": "shift+f2", "command": "codeblocks.projectTree.focus" }\n]\n`;
const r6 = updateKeybindingsText(lastRemoved, [], MANAGED_COMMANDS);
check('手术：删除最后一个条目（前驱逗号）', r6.changed && !r6.text.includes('projectTree.focus') && Array.isArray(parseJsonc(r6.text)) && parseJsonc(r6.text).length === 1, r6.text, '保留 1 条');

// ---- 8. D7：diffManaged ----
const fileEntries = readManagedEntries(r1.text, MANAGED_COMMANDS);
check('readManagedEntries 提取正向托管条目', fileEntries.length === 1 && fileEntries[0].command === 'codeblocks.build' && fileEntries[0].key === 'ctrl+alt+b', fileEntries, '1 条');
const d1 = diffManaged(desired, fileEntries);
check('diffManaged：完全一致 → 无差异', d1.missing.length === 0 && d1.extra.length === 0, d1, '一致');
const d2 = diffManaged([{ key: 'f8', command: 'codeblocks.debug', when: 'editorTextFocus && !inDebugMode' }], []);
check('diffManaged：缺失检测', d2.missing.length === 1 && d2.extra.length === 0, d2, 'missing=1');

// ---- 9. 托管表规模抽查 ----
check('托管表规模（30 项：15 builtin + 3 alias + 12 cbStyle）',
  MANAGED_KEYBINDINGS.length === 30
  && MANAGED_KEYBINDINGS.filter((m) => m.group === 'cbStyle').length === 12
  && MANAGED_KEYBINDINGS.filter((m) => m.group === 'alias').length === 3,
  { total: MANAGED_KEYBINDINGS.length, cb: MANAGED_KEYBINDINGS.filter((m) => m.group === 'cbStyle').length, alias: MANAGED_KEYBINDINGS.filter((m) => m.group === 'alias').length },
  { total: 30, cb: 12, alias: 3 });

console.log(`快捷键托管配置回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
