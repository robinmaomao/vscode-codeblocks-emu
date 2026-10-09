// 设置结构回归（第53轮配置整理）：
//  - configuration 为 7 个分区块（title+order），设置项总数 60、无重复键
//  - 关键默认值/枚举/scope/数值校验/DBGconfig/描述无轮次标记
//  - 全部设置键在 dist 中被读取（无死配置；ui.symbolsView 由 when 子句使用）
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const cfg = pkg.contributes.configuration;

check('configuration 为数组（分区块）', Array.isArray(cfg), typeof cfg);
if (!Array.isArray(cfg)) { console.log('设置结构: 0 pass, 1 fail'); process.exit(1); }
check('分区块数量 = 7', cfg.length === 7, cfg.length);
check('每块含 title + order', cfg.every((b) => typeof b.title === 'string' && b.title && Number.isFinite(b.order)), cfg.map((b) => [b.title, b.order]));
check('order 严格递增', cfg.every((b, i) => i === 0 || cfg[i - 1].order < b.order), cfg.map((b) => b.order));

// ---- 分区标题 nls（跟随 VS Code 显示语言；默认英文） ----
check('分区标题使用 nls 占位符', cfg.every((b) => /^%[A-Za-z0-9_.]+%$/.test(b.title)), cfg.map((b) => b.title));
const nlsEn = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.nls.json'), 'utf-8'));
const nlsZh = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.nls.zh-cn.json'), 'utf-8'));
const titleKeys = cfg.map((b) => b.title.slice(1, -1));
check('package.nls.json（英文默认）含全部标题键', titleKeys.every((k) => typeof nlsEn[k] === 'string' && nlsEn[k]), titleKeys.filter((k) => !nlsEn[k]));
check('package.nls.zh-cn.json 含全部标题键', titleKeys.every((k) => typeof nlsZh[k] === 'string' && nlsZh[k]), titleKeys.filter((k) => !nlsZh[k]));
check('英文标题不含中文', titleKeys.every((k) => !/[\u4e00-\u9fff]/.test(nlsEn[k] || '')), titleKeys.filter((k) => /[\u4e00-\u9fff]/.test(nlsEn[k] || '')));
check('中文标题多数含中文（IntelliSense/clangd 专名除外）', titleKeys.filter((k) => /[\u4e00-\u9fff]/.test(nlsZh[k] || '')).length >= 6, titleKeys.map((k) => nlsZh[k]));

const keys = [];
const byKey = {};
for (const b of cfg) {
  for (const [k, v] of Object.entries(b.properties || {})) {
    keys.push(k);
    byKey[k] = v;
  }
}
  check('设置项总数 = 60', keys.length === 60, keys.length);
check('无重复键', new Set(keys).size === keys.length, keys.length - new Set(keys).size);
check('disableInit 默认 true（对齐 CB disable_init）', byKey['codeblocks.debug.disableInit']?.default === true, byKey['codeblocks.debug.disableInit']);
check('saveHtmlLogFullCommandLine 默认 false（对齐 CB full_command_line）', byKey['codeblocks.build.saveHtmlLogFullCommandLine']?.default === false, byKey['codeblocks.build.saveHtmlLogFullCommandLine']);
check('linkInputExtensions 默认 xm（保护性增强，可设 [] 关闭；其它扩展名可自行添加）',
  byKey['codeblocks.build.linkInputExtensions']?.type === 'array'
  && JSON.stringify(byKey['codeblocks.build.linkInputExtensions']?.default) === JSON.stringify(['xm']),
  byKey['codeblocks.build.linkInputExtensions']);
check('cleanResponseFiles 默认 false（保护性增强；CB 不清理响应文件）',
  byKey['codeblocks.build.cleanResponseFiles']?.type === 'boolean'
  && byKey['codeblocks.build.cleanResponseFiles']?.default === false,
  byKey['codeblocks.build.cleanResponseFiles']);
check('build.compilerCache 枚举 none/ccache/sccache + 默认 none + machine-overridable',
  JSON.stringify(byKey['codeblocks.build.compilerCache']?.enum) === JSON.stringify(['none', 'ccache', 'sccache'])
  && byKey['codeblocks.build.compilerCache']?.default === 'none'
  && byKey['codeblocks.build.compilerCache']?.scope === 'machine-overridable',
  byKey['codeblocks.build.compilerCache']);
check('build.compilerCachePath 默认空串（自动探测）+ machine-overridable',
  byKey['codeblocks.build.compilerCachePath']?.type === 'string'
  && byKey['codeblocks.build.compilerCachePath']?.default === ''
  && byKey['codeblocks.build.compilerCachePath']?.scope === 'machine-overridable',
  byKey['codeblocks.build.compilerCachePath']);
check('buildLogAutoFocus 默认 errors + 四值枚举',
  JSON.stringify(byKey['codeblocks.ui.buildLogAutoFocus']?.enum) === JSON.stringify(['errors', 'errorsAndWarnings', 'always', 'never'])
  && byKey['codeblocks.ui.buildLogAutoFocus']?.default === 'errors', byKey['codeblocks.ui.buildLogAutoFocus']);
check('buildLogFocusFirstError 默认 true（对齐 CB auto_focus_build_errors）', byKey['codeblocks.ui.buildLogFocusFirstError']?.default === true, byKey['codeblocks.ui.buildLogFocusFirstError']);
check('quietFailure 默认 false', byKey['codeblocks.ui.quietFailure']?.default === false, byKey['codeblocks.ui.quietFailure']);

// ---- 关键项抽查 ----
check('tidyCommentWidth 默认 80（20-200）',
  byKey['codeblocks.editor.tidyCommentWidth']?.default === 80
  && byKey['codeblocks.editor.tidyCommentWidth']?.minimum === 20
  && byKey['codeblocks.editor.tidyCommentWidth']?.maximum === 200, byKey['codeblocks.editor.tidyCommentWidth']);
check('editor.asmHashComment 默认 false（默认 //；开启后汇编行注释为 #）',
  byKey['codeblocks.editor.asmHashComment']?.type === 'boolean'
  && byKey['codeblocks.editor.asmHashComment']?.default === false, byKey['codeblocks.editor.asmHashComment']);
check('headerGuardStyle 枚举 ifndef/pragma-once',
  JSON.stringify(byKey['codeblocks.editor.headerGuardStyle']?.enum) === JSON.stringify(['ifndef', 'pragma-once'])
  && byKey['codeblocks.editor.headerGuardStyle']?.default === 'ifndef', byKey['codeblocks.editor.headerGuardStyle']);
check('recentProjectsLimit 默认 8（0-50）',
  byKey['codeblocks.ui.recentProjectsLimit']?.default === 8
  && byKey['codeblocks.ui.recentProjectsLimit']?.minimum === 0
  && byKey['codeblocks.ui.recentProjectsLimit']?.maximum === 50, byKey['codeblocks.ui.recentProjectsLimit']);
check('build.saveHtmlLog 默认 false（布尔，对齐 CB save_html_build_log）',
  byKey['codeblocks.build.saveHtmlLog']?.type === 'boolean' && byKey['codeblocks.build.saveHtmlLog']?.default === false,
  byKey['codeblocks.build.saveHtmlLog']);
check('build.persistLog 默认 false（输出通道持久化默认关；开启后写盘跨窗口保留）',
  byKey['codeblocks.build.persistLog']?.type === 'boolean' && byKey['codeblocks.build.persistLog']?.default === false,
  byKey['codeblocks.build.persistLog']);
check('build.outputTimestamp 默认 false（普通输出每行时间戳默认关，可开启）',
  byKey['codeblocks.build.outputTimestamp']?.type === 'boolean' && byKey['codeblocks.build.outputTimestamp']?.default === false,
  byKey['codeblocks.build.outputTimestamp']);

check('scope machine-overridable ×3（路径类设置）',
  ['codeblocks.masterPath', 'codeblocks.compilerPrograms', 'codeblocks.debug.gdbPath']
    .every((k) => byKey[k]?.scope === 'machine-overridable'),
  ['codeblocks.masterPath', 'codeblocks.compilerPrograms', 'codeblocks.debug.gdbPath'].map((k) => byKey[k]?.scope));
check('gdbPath 描述无「第 N 轮」内部标记', !String(byKey['codeblocks.debug.gdbPath']?.description || '').includes('第'), null);
check('compilerPrograms 含 DBGconfig 属性', !!byKey['codeblocks.compilerPrograms']?.properties?.DBGconfig, null);

check('parallelJobs 0–64', byKey['codeblocks.parallelJobs']?.minimum === 0 && byKey['codeblocks.parallelJobs']?.maximum === 64, null);
check('gdbTimeoutMs minimum 1000', byKey['codeblocks.gdbTimeoutMs']?.minimum === 1000, null);
check('maxReportedErrors minimum 0', byKey['codeblocks.maxReportedErrors']?.minimum === 0, null);
check('printElements minimum 0', byKey['codeblocks.debug.printElements']?.minimum === 0, null);

// ---- 全部键在 dist 中被读取（无死配置） ----
// ui.symbolsView 例外：仅由视图贡献 when 子句使用（config.codeblocks.ui.symbolsView），不在代码读取
const whenOnly = new Set(['codeblocks.ui.symbolsView']);
function collectJs(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...collectJs(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}
const allText = collectJs(path.resolve(__dirname, '../dist')).map((p) => fs.readFileSync(p, 'utf-8')).join('\n');
const missing = keys.filter((k) => {
  if (whenOnly.has(k)) return false;
  const flat = k.replace(/^codeblocks\./, '');
  return !allText.includes(`'${flat}'`) && !allText.includes(`"${flat}"`);
});
check('全部设置键在 dist 中被读取（无死配置）', missing.length === 0, missing);

console.log(`设置结构回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
