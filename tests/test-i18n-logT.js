// 构建日志文案统一入口 logT() 回归（docs/国际化.md §2「三种运行时 API」）：
//  - log.english = true  → 恒英文源串（对齐 CB 原文，占位符按 args 替换）
//  - log.english = false → 跟随 codeblocks.ui.language（zh-cn 走词条表，en 回退英文源串）
//  - msg(zh, en) 历史入口保持原语义（仅 log.english 决定）
//  - 静态守卫：src/build/** 不得再出现 msg( 调用
const Module = require('module');
const path = require('path');
const fs = require('fs');

const settings = {};
const envLanguage = { value: 'zh-cn' };
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }) },
      env: { get language() { return envLanguage.value; } },
    };
  }
  return origLoad(request, parent, isMain);
};

const i18n = require('../dist/i18n/index.js');
const lang = require('../dist/build/logLang.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}
const reset = (english, language, envLang) => {
  settings['log.english'] = english;
  settings['ui.language'] = language;
  if (envLang) envLanguage.value = envLang;
  lang.resetBuildLogPrefsCache();
  i18n.refreshUiLanguage();
};

// ---- 1. log.english = false + 中文界面：走词条表 ----
reset(false, 'zh-cn', 'zh-cn');
check('zh：构建日志走中文词条', lang.logT('Build succeeded') === '构建成功', lang.logT('Build succeeded'));
check('zh：占位符按 args 替换',
  lang.logT('Compiled {0} file(s)', 3) === '编译了 3 个文件' || lang.logT('Compiled {0} file(s)', 3).includes('3'),
  lang.logT('Compiled {0} file(s)', 3));
check('zh：i18n.t 与 logT 结果一致', lang.logT('Build failed') === i18n.t('Build failed'), [lang.logT('Build failed'), i18n.t('Build failed')]);

// ---- 2. log.english = false + 英文界面：英文源串 ----
reset(false, 'en');
check('en：构建日志回退英文源串', lang.logT('Build succeeded') === 'Build succeeded', lang.logT('Build succeeded'));
check('en：占位符替换', lang.logT('Compiled {0} file(s)', 3) === 'Compiled 3 file(s)', lang.logT('Compiled {0} file(s)', 3));

// ---- 3. log.english = true：恒英文（覆盖 ui.language 的 zh 设置） ----
reset(true, 'zh-cn');
check('english=true：中文界面下仍输出英文', lang.logT('Build succeeded') === 'Build succeeded', lang.logT('Build succeeded'));
check('english=true：占位符替换',
  lang.logT('Compiled {0} file(s)', 3) === 'Compiled 3 file(s)', lang.logT('Compiled {0} file(s)', 3));
check('english=true：msg(zh, en) 走英文分支', lang.msg('中文', 'english') === 'english', lang.msg('中文', 'english'));

// ---- 4. log.english = true + 英文界面（幂等） ----
reset(true, 'en');
check('english=true + en：结果一致', lang.logT('Build failed') === 'Build failed', lang.logT('Build failed'));

// ---- 5. 缓存：设置变更需 reset 才生效（避免热路径读配置） ----
reset(false, 'zh-cn');
const before = lang.logT('Build succeeded');
settings['log.english'] = true;
check('未重置缓存：仍按旧语言输出', lang.logT('Build succeeded') === before, lang.logT('Build succeeded'));
lang.resetBuildLogPrefsCache();
check('重置后立即切到英文', lang.logT('Build succeeded') === 'Build succeeded', lang.logT('Build succeeded'));

// ---- 6. 词条缺失回退源串（不出现空串/键名泄漏） ----
reset(false, 'zh-cn');
check('词条缺失回退英文源串', lang.logT('__no_such_entry__') === '__no_such_entry__', lang.logT('__no_such_entry__'));

// ---- 7. 静态守卫：src/build/** 不再直接调用 msg( ----
const buildDir = path.resolve(__dirname, '../src/build');
const offenders = [];
for (const f of fs.readdirSync(buildDir)) {
  if (!f.endsWith('.ts')) continue;
  const text = fs.readFileSync(path.join(buildDir, f), 'utf-8');
  text.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;
    if (/\bmsg\s*\(/.test(l) && !/export function msg/.test(l)) offenders.push(`${f}:${i + 1}`);
  });
}
check('构建层统一走 logT（不再调用 msg）', offenders.length === 0, offenders);

console.log(`logT 回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
