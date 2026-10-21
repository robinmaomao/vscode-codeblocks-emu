// 运行时界面语言回归（0.8.132-dev）：
//  - dist/i18n/core.js：resolveLanguage / formatSource / lookupTemplate / translate 纯函数全路径
//  - dist/i18n/index.js：t() 接线（默认跟随 VS Code 显示语言、设置覆盖、刷新后即生效）
//  - 词条文件随编译产物落地（dist/i18n/strings.zh-cn.json）
const fs = require('fs');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const ROOT = path.resolve(__dirname, '..');
const core = require(path.join(ROOT, 'dist', 'i18n', 'core.js'));

// ---- A. 语言解析 ----
check('A1 auto + zh-cn → zh-cn', core.resolveLanguage('auto', 'zh-cn') === 'zh-cn', core.resolveLanguage('auto', 'zh-cn'));
check('A2 auto + zh-TW（大小写/地区）→ zh-cn', core.resolveLanguage('auto', 'zh-TW') === 'zh-cn', core.resolveLanguage('auto', 'zh-TW'));
check('A3 auto + zh-hans → zh-cn', core.resolveLanguage('auto', 'zh-hans') === 'zh-cn', core.resolveLanguage('auto', 'zh-hans'));
check('A4 auto + en → en', core.resolveLanguage('auto', 'en') === 'en', core.resolveLanguage('auto', 'en'));
check('A5 auto + 空/undefined → en（英文为默认回退）',
  core.resolveLanguage('auto', '') === 'en' && core.resolveLanguage('auto', undefined) === 'en',
  [core.resolveLanguage('auto', ''), core.resolveLanguage('auto', undefined)]);
check('A6 显式 en 覆盖中文显示语言', core.resolveLanguage('en', 'zh-cn') === 'en', core.resolveLanguage('en', 'zh-cn'));
check('A7 显式 zh-cn 覆盖英文显示语言', core.resolveLanguage('zh-cn', 'en') === 'zh-cn', core.resolveLanguage('zh-cn', 'en'));
check('A8 非法设置值按 auto 处理', core.resolveLanguage('jp', 'zh-cn') === 'zh-cn' && core.resolveLanguage(undefined, 'en') === 'en',
  [core.resolveLanguage('jp', 'zh-cn'), core.resolveLanguage(undefined, 'en')]);
check('A9 isUiLanguageSetting 只认三态',
  core.isUiLanguageSetting('auto') && core.isUiLanguageSetting('en') && core.isUiLanguageSetting('zh-cn')
  && !core.isUiLanguageSetting('fr') && !core.isUiLanguageSetting('') && !core.isUiLanguageSetting(undefined),
  core.isUiLanguageSetting('fr'));
check('A10 设置键常量含前缀（与 package.json / getConfiguration 对齐）',
  core.LANGUAGE_SETTING === 'ui.language' && core.LANGUAGE_SETTING_FULL === 'codeblocks.ui.language',
  [core.LANGUAGE_SETTING, core.LANGUAGE_SETTING_FULL]);
check('A11 取值清单顺序固定（QuickPick 展示顺序）',
  JSON.stringify(core.UI_LANGUAGE_VALUES) === JSON.stringify(['auto', 'en', 'zh-cn']), core.UI_LANGUAGE_VALUES);

// ---- B. 占位符替换 ----
check('B1 {N} 按序替换', core.formatSource('A {0} B {1}', [1, 'x']) === 'A 1 B x', core.formatSource('A {0} B {1}', [1, 'x']));
check('B2 同一序号多次引用', core.formatSource('{0}-{0}', ['z']) === 'z-z', core.formatSource('{0}-{0}', ['z']));
check('B3 缺参保留占位符原样（便于定位漏参，不静默吞占位符）',
  core.formatSource('A {0} B {1}', [1]) === 'A 1 B {1}', core.formatSource('A {0} B {1}', [1]));
check('B4 null/undefined 参数保留占位符', core.formatSource('{0}/{1}', [null, undefined]) === '{0}/{1}', core.formatSource('{0}/{1}', [null, undefined]));
check('B5 无参数直接返回源串（不解析花括号）', core.formatSource('{0} 原样', []) === '{0} 原样', core.formatSource('{0} 原样', []));
check('B6 非数字花括号不受影响', core.formatSource('{name} {0}', ['v']) === '{name} v', core.formatSource('{name} {0}', ['v']));
check('B7 数字参数转字符串（0 不被当假值丢弃）', core.formatSource('n={0}', [0]) === 'n=0', core.formatSource('n={0}', [0]));

// ---- C. 词条查找与回退 ----
const dict = { 'Build finished': '构建完成', 'Build {0}': '{0} 构建' };
check('C1 英文 = 源串本身（不查表）', core.lookupTemplate(dict, 'en', 'Build finished') === 'Build finished', core.lookupTemplate(dict, 'en', 'Build finished'));
check('C2 zh-cn 命中词条', core.lookupTemplate(dict, 'zh-cn', 'Build finished') === '构建完成', core.lookupTemplate(dict, 'zh-cn', 'Build finished'));
check('C3 词条缺失回退源串（绝不返回键名/空白）',
  core.lookupTemplate(dict, 'zh-cn', 'Not translated') === 'Not translated', core.lookupTemplate(dict, 'zh-cn', 'Not translated'));
check('C4 空/空白词条按缺失处理',
  core.lookupTemplate({ 'A': '   ', 'B': '' }, 'zh-cn', 'A') === 'A' && core.lookupTemplate({ 'A': '   ', 'B': '' }, 'zh-cn', 'B') === 'B',
  core.lookupTemplate({ 'A': '   ' }, 'zh-cn', 'A'));
check('C5 translate = 查表 + 占位符（中文可重排占位符顺序）',
  core.translate(dict, 'zh-cn', 'Build {0}', ['x']) === 'x 构建', core.translate(dict, 'zh-cn', 'Build {0}', ['x']));
check('C6 translate 英文态保留英文源串与参数',
  core.translate(dict, 'en', 'Build {0}', ['x']) === 'Build x', core.translate(dict, 'en', 'Build {0}', ['x']));

// ---- D. t() 接线（需 mock：默认显示语言 zh-cn） ----
const mock = installVscodeMock({});
const i18n = require(path.join(ROOT, 'dist', 'i18n', 'index.js'));
check('D1 默认（auto + 显示语言 zh-cn）→ 中文词条', i18n.t('Save') === '保存', i18n.t('Save'));
check('D2 uiLanguage() 与解析结果一致', i18n.uiLanguage() === 'zh-cn', i18n.uiLanguage());
check('D3 缺词条回退英文源串', i18n.t('Untranslated probe string') === 'Untranslated probe string', i18n.t('Untranslated probe string'));
check('D4 占位符经 t() 生效（缺词条时参数仍替换）', i18n.t('Build {0} probe', 'X') === 'Build X probe', i18n.t('Build {0} probe', 'X'));

mock.configStore['codeblocks.ui.language'] = 'en';
check('D5 刷新前仍用缓存（未刷新不生效，读数集中可预期）', i18n.t('Save') === '保存', i18n.t('Save'));
check('D6 refreshUiLanguage() → en', i18n.refreshUiLanguage() === 'en', i18n.refreshUiLanguage());
check('D7 刷新后 t() 返回英文源串', i18n.t('Save') === 'Save', i18n.t('Save'));

mock.configStore['codeblocks.ui.language'] = 'zh-cn';
check('D8 切回 zh-cn 后刷新 → 中文词条', i18n.refreshUiLanguage() === 'zh-cn' && i18n.t('Save') === '保存',
  [i18n.refreshUiLanguage(), i18n.t('Save')]);
check('D9 词条表可读且非空', Object.keys(i18n.translationsTable()).length > 0, Object.keys(i18n.translationsTable()).length);
mock.restore();

// ---- E. 词条文件随产物落地 ----
const dictPath = path.join(ROOT, 'dist', 'i18n', 'strings.zh-cn.json');
check('E1 dist/i18n/strings.zh-cn.json 已生成（编译产物含词条）', fs.existsSync(dictPath), fs.existsSync(dictPath));
check('E2 词条文件是合法 JSON 对象', (() => { try { return typeof JSON.parse(fs.readFileSync(dictPath, 'utf-8')) === 'object'; } catch { return false; } })(), null);
const srcDict = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'strings.zh-cn.json'), 'utf-8'));
check('E3 源码与产物词条一致（无构建残留）',
  JSON.stringify(srcDict) === JSON.stringify(JSON.parse(fs.readFileSync(dictPath, 'utf-8'))), null);

console.log(`\ni18n 运行时回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
