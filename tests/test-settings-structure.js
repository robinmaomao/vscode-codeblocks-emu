// 设置结构回归（第53轮配置整理）：
//  - configuration 为 7 个分区块（title+order），设置项总数 42、无重复键
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
check('设置项总数 = 42', keys.length === 42, keys.length);
check('无重复键', new Set(keys).size === keys.length, keys.length - new Set(keys).size);

// ---- 关键项抽查 ----
check('tidyCommentWidth 默认 80（20-200）',
  byKey['codeblocks.editor.tidyCommentWidth']?.default === 80
  && byKey['codeblocks.editor.tidyCommentWidth']?.minimum === 20
  && byKey['codeblocks.editor.tidyCommentWidth']?.maximum === 200, byKey['codeblocks.editor.tidyCommentWidth']);
check('headerGuardStyle 枚举 ifndef/pragma-once',
  JSON.stringify(byKey['codeblocks.editor.headerGuardStyle']?.enum) === JSON.stringify(['ifndef', 'pragma-once'])
  && byKey['codeblocks.editor.headerGuardStyle']?.default === 'ifndef', byKey['codeblocks.editor.headerGuardStyle']);
check('recentProjectsLimit 默认 8（0-50）',
  byKey['codeblocks.ui.recentProjectsLimit']?.default === 8
  && byKey['codeblocks.ui.recentProjectsLimit']?.minimum === 0
  && byKey['codeblocks.ui.recentProjectsLimit']?.maximum === 50, byKey['codeblocks.ui.recentProjectsLimit']);

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
