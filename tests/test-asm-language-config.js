// X4 回归：asm（.S/.s）language-configuration（ld/xm 已有的同类配置），
// 行注释默认 `//`（0.8.128-dev 起；设置 asmHashComment 开启后动态切换为 GAS 原生 `#`）+ 块注释；并校验 package.json 引用与文件存在。
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const langs = pkg.contributes.languages || [];
const asmLang = langs.find((l) => l.id === 'asm') || {};
check('A1 asm 语言声明 configuration', asmLang.configuration === './language-configurations/asm.json', asmLang.configuration, './language-configurations/asm.json');
check('A2 asm 扩展名与别名保持（.S/.s；GNU Assembly (RISC-V)）', JSON.stringify(asmLang.extensions) === JSON.stringify(['.S', '.s']) && (asmLang.aliases || []).length > 0, asmLang, { extensions: ['.S', '.s'] });

const cfgPath = path.join(__dirname, '..', 'language-configurations', 'asm.json');
check('B1 配置文件存在', fs.existsSync(cfgPath), cfgPath, 'exists');
let cfg = null;
try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch (e) { /* B2 报失败 */ }
check('B2 配置为合法 JSON', !!cfg, cfg, 'object');
check('B3 行注释 = //（默认；设置 asmHashComment 开启后动态切换为 #）', cfg?.comments?.lineComment === '//', cfg?.comments?.lineComment, '//');
check('B4 块注释 = /* */（GAS 支持）', JSON.stringify(cfg?.comments?.blockComment) === JSON.stringify(['/*', '*/']), cfg?.comments?.blockComment, ['/*', '*/']);
check('B5 brackets 三对', JSON.stringify(cfg?.brackets) === JSON.stringify([['(', ')'], ['{', '}'], ['[', ']']]), cfg?.brackets, [['(', ')'], ['{', '}'], ['[', ']']]);
check('B6 autoClosingPairs / surroundingPairs 非空', (cfg?.autoClosingPairs || []).length >= 3 && (cfg?.surroundingPairs || []).length >= 3, { auto: (cfg?.autoClosingPairs || []).length, sur: (cfg?.surroundingPairs || []).length }, '>=3 / >=3');

// C. 语法注册仍有效 + ld/xm 配置未被波及
const asmGrammar = (pkg.contributes.grammars || []).find((g) => g.language === 'asm') || {};
check('C1 asm 语法文件存在', !!asmGrammar.path && fs.existsSync(path.join(__dirname, '..', asmGrammar.path)), asmGrammar.path, 'exists');
for (const id of ['ld', 'xm']) {
  const l = langs.find((x) => x.id === id) || {};
  check(`C2 ${id} 配置引用保持`, !!l.configuration && fs.existsSync(path.join(__dirname, '..', l.configuration)), l.configuration, 'exists');
}

console.log(`\nasm-language-config 回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
