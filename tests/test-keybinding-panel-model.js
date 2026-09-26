// 快捷键设置面板 —— 纯数据模型回归：
//  - buildKeybindingRows：默认/自定义/解绑行、文件一致性（ok）、冲突注解、跨项重复
//  - 方案导出/导入负载（D5）：稳定排序、包装/直接映射、非法与未知项
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const {
  MANAGED_KEYBINDINGS, buildKeybindingRows, buildExportPayload, parseImportPayload, computeDesiredEntries,
} = require('../dist/tools/keybindingConfig.js');

const mBuild = MANAGED_KEYBINDINGS.find((m) => m.id === 'build');
const mDebug = MANAGED_KEYBINDINGS.find((m) => m.id === 'debug');
const mQuit = MANAGED_KEYBINDINGS.find((m) => m.id === 'cbQuit');

// ---- 1. 行模型：默认态 ----
const rowsDefault = buildKeybindingRows(new Map(), []);
const buildRow = rowsDefault.find((r) => r.id === 'build');
check('默认行：status=default 且 effective=默认键', buildRow.status === 'default' && buildRow.effective === 'ctrl+f9', buildRow, 'default');
check('默认行：ok=true（无需文件条目）', buildRow.ok === true, buildRow.ok, true);
const debugRow = rowsDefault.find((r) => r.id === 'debug');
check('默认行：F8 带 VS Code 默认冲突注解', (debugRow.note || '').includes('VS Code 默认冲突'), debugRow.note, '含冲突注解');

// ---- 2. 行模型：自定义态（未写入 / 已写入） ----
const ovCustom = new Map([['build', 'ctrl+alt+b']]);
const rowsNotWritten = buildKeybindingRows(ovCustom, []);
const customNotWritten = rowsNotWritten.find((r) => r.id === 'build');
check('自定义行：未写入 → ok=false + 提示', customNotWritten.status === 'custom' && customNotWritten.ok === false
  && (customNotWritten.note || '').includes('未写入'), customNotWritten, '未写入');

const desired = computeDesiredEntries(ovCustom, MANAGED_KEYBINDINGS);
const rowsWritten = buildKeybindingRows(ovCustom, desired.filter((d) => !d.command.startsWith('-')));
const customWritten = rowsWritten.find((r) => r.id === 'build');
check('自定义行：已写入 → ok=true', customWritten.ok === true, customWritten.ok, true);
check('自定义行：冲突键（f5）注解', (buildKeybindingRows(new Map([['debug', 'f5']]), []).find((r) => r.id === 'debug').note || '').includes('VS Code 默认冲突'),
  buildKeybindingRows(new Map([['debug', 'f5']]), []).find((r) => r.id === 'debug').note, '含冲突');

// ---- 3. 行模型：解绑态 ----
const ovUnbind = new Map([['cbQuit', '']]);
const rowsUnbind = buildKeybindingRows(ovUnbind, []);
const quitRow = rowsUnbind.find((r) => r.id === 'cbQuit');
check('解绑行：status=unbound 且 effective=已解绑', quitRow.status === 'unbound' && quitRow.effective === '（已解绑）', quitRow, 'unbound');
check('解绑行：文件残留条目 → ok=false', buildKeybindingRows(ovUnbind, [{ key: 'ctrl+q', command: mQuit.command, when: mQuit.when }]).find((r) => r.id === 'cbQuit').ok === false, 'n/a', false);

// ---- 4. 跨托管项重复 ----
const rowsDup = buildKeybindingRows(new Map([['build', 'ctrl+alt+k'], ['run', 'ctrl+alt+k']]), []);
check('重复键：两行均带重复注解', (rowsDup.find((r) => r.id === 'build').note || '').includes('重复')
  && (rowsDup.find((r) => r.id === 'run').note || '').includes('重复'), rowsDup.filter((r) => (r.note || '').includes('重复')).map((r) => r.id), 'build+run');

// ---- 5. 导出/导入负载 ----
const exportMap = new Map([['run', 'ctrl+alt+r'], ['build', 'ctrl+alt+b'], ['cbQuit', '']]);
const payload = buildExportPayload(exportMap);
const parsedPayload = JSON.parse(payload);
check('导出：包装结构 + 稳定排序', parsedPayload.version === 1 && parsedPayload.generatedBy === 'codeblocks-vscode'
  && JSON.stringify(Object.keys(parsedPayload.overrides)) === JSON.stringify(['build', 'cbQuit', 'run']), Object.keys(parsedPayload.overrides), ['build', 'cbQuit', 'run']);
const roundtrip = parseImportPayload(payload);
check('导入：包装结构往返一致', !roundtrip.error && roundtrip.overrides.get('build') === 'ctrl+alt+b' && roundtrip.overrides.get('cbQuit') === '', roundtrip, '一致');
const direct = parseImportPayload('{ "debug": "ctrl+alt+d" }');
check('导入：直接映射兼容', !direct.error && direct.overrides.get('debug') === 'ctrl+alt+d', direct, '兼容');
const badJson = parseImportPayload('not json');
check('导入：非法 JSON → error', !!badJson.error, badJson.error, 'error');
const mixed = parseImportPayload('{ "overrides": { "build": "ctrl+alt+b", "nope": "x", "debug": "??" } }');
check('导入：未知/非法项报告', mixed.overrides.size === 1 && mixed.unknown.length === 1 && mixed.invalid.length === 1, { ok: mixed.overrides.size, u: mixed.unknown, i: mixed.invalid.map((x) => x.id) }, { ok: 1, u: ['nope'], i: ['debug'] });

// ---- 6. 行数与分组 ----
check('行模型覆盖全部托管项（30）', rowsDefault.length === MANAGED_KEYBINDINGS.length && rowsDefault.length === 30, rowsDefault.length, 30);
check('行模型分组与托管表一致', rowsDefault.every((r) => MANAGED_KEYBINDINGS.find((m) => m.id === r.id).group === r.group), 'n/a', '一致');

console.log(`快捷键面板模型回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
