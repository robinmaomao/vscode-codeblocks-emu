// 汇编注释标记切换回归（0.8.128-dev）：
//  - package.json：设置 codeblocks.editor.asmHashComment（boolean，默认 false）
//  - dist/tools/asmCommentConfig.js：asmCommentsRule() 纯函数与常量
//  - dist/extension.js：setLanguageConfiguration('asm') 动态注册接线 + 配置监听 + 释放回退
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const cfg = Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration : [pkg.contributes.configuration];
const byKey = {};
for (const b of cfg) Object.assign(byKey, b.properties || {});

// ---- 1. 设置项 ----
const s = byKey['codeblocks.editor.asmHashComment'];
check('S1 设置存在（boolean，默认 false）', s?.type === 'boolean' && s?.default === false, s);
const sDesc = String(s?.markdownDescription || s?.description || '');
check('S2 描述含 # 与 //（说明默认与开启差异）', sDesc.includes('#') && sDesc.includes('//'), sDesc.slice(0, 60));

// ---- 2. 纯模块 ----
const mod = require(path.join(root, 'dist', 'tools', 'asmCommentConfig.js'));
check('M1 语言 id 常量', mod.ASM_LANGUAGE_ID === 'asm', mod.ASM_LANGUAGE_ID);
check('M2 设置键常量', mod.ASM_HASH_COMMENT_SETTING === 'editor.asmHashComment', mod.ASM_HASH_COMMENT_SETTING);
const ruleOff = mod.asmCommentsRule(false);
const ruleOn = mod.asmCommentsRule(true);
check('M3 默认行注释 //', ruleOff.lineComment === '//', ruleOff);
check('M4 开启后行注释 #', ruleOn.lineComment === '#', ruleOn);
check('M5 块注释保持 C 风格（两种状态一致）',
  JSON.stringify(ruleOn.blockComment) === JSON.stringify(['/*', '*/'])
  && JSON.stringify(ruleOff.blockComment) === JSON.stringify(['/*', '*/']), ruleOn.blockComment);

// ---- 3. extension.js 接线（ES2020 目标保留可选链原形） ----
const ext = fs.readFileSync(path.join(root, 'dist', 'extension.js'), 'utf-8');
check('E1 定义 applyAsmCommentMode', /function applyAsmCommentMode\(/.test(ext), null);
check('E2 动态注册 setLanguageConfiguration(asm)',
  /languages\.setLanguageConfiguration\(asmCommentConfig_1\.ASM_LANGUAGE_ID/.test(ext), null);
check('E3 激活时应用 + 监听内应用（≥2 次调用）',
  (ext.match(/applyAsmCommentMode\(\);/g) || []).length >= 2, (ext.match(/applyAsmCommentMode\(\);/g) || []).length);
check('E4 监听键 codeblocks.editor.asmHashComment',
  ext.includes("affectsConfiguration('codeblocks.editor.asmHashComment')"), null);
check('E5 释放回退接线（dispose 包装 asmCommentOverride）',
  /subscriptions\.push\(\{ dispose: \(\) => asmCommentOverride\?\.dispose\(\) \}\)/.test(ext), null);

console.log(`\nasm 注释切换回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
