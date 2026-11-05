// 构建性能顾问开关回归（`codeblocks.build.performanceAdvisor`，默认关闭）：
//  - package.json 声明该设置、类型 boolean、默认 false
//  - 双语 nls 均有非空文案
//  - dist/build/buildEngine.js 中五类归因输出（宿主卡顿 / 杀软 / 扫描器 / CPU 饱和 / 低内存）
//    均被 adviceEnabled() 门控，且诊断模式（build.profile）自动放行
// 说明：buildEngine 依赖 vscode 模块，无法在无头环境直接实例化，故与 test-build-profiler.js 一致
//       采用「dist 源码静态断言 + 配置面断言」的组合。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); } else {
    fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : ''));
  }
}

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const pkg = JSON.parse(read('package.json'));
const en = JSON.parse(read('package.nls.json'));
const zh = JSON.parse(read('package.nls.zh-cn.json'));
const src = read(path.join('dist', 'build', 'buildEngine.js')).replace(/\s+/g, ' ');

const KEY = 'codeblocks.build.performanceAdvisor';
const NLS = 'configuration.codeblocks.build.performanceAdvisor.description';

// ---------- A. 配置面 ----------
{
  const all = [].concat(...pkg.contributes.configuration.map((s) => Object.keys(s.properties || {})));
  const own = pkg.contributes.configuration
    .map((s) => (s.properties || {})[KEY])
    .filter(Boolean);
  check('A1 package.json 声明 codeblocks.build.performanceAdvisor', own.length === 1, own.length);
  const spec = own[0] || {};
  check('A2 类型为 boolean', spec.type === 'boolean', spec.type);
  check('A3 默认关闭（default=false）', spec.default === false, spec.default);
  check('A4 描述使用 nls 占位符', spec.description === `%${NLS}%`, spec.description);
  check('A5 设置键唯一', all.filter((k) => k === KEY).length === 1, all.filter((k) => k === KEY).length);
  check('A6 英文 nls 文案非空', typeof en[NLS] === 'string' && en[NLS].length > 40, typeof en[NLS]);
  check('A7 中文 nls 文案非空', typeof zh[NLS] === 'string' && zh[NLS].length > 20, typeof zh[NLS]);
  check('A8 英文 nls 不含中文', typeof en[NLS] === 'string' && !/[\u4e00-\u9fff]/.test(en[NLS]), true);
}

// ---------- B. 门控接线（dist 源码静态断言） ----------
check('B1 buildEngine 读取该设置', /build\.performanceAdvisor/.test(src), true);
check(
  'B2 四类收尾归因在 adviceEnabled() 分支内',
  /if \(this\.adviceEnabled\(\)\) \{ this\.reportHostStalls\(/.test(src)
  && src.indexOf('this.reportHostStalls(') < src.indexOf('this.reportSecurityCpu('),
  true,
);
check(
  'B3 杀软 / 扫描器 / 饱和归因同受门控',
  /this\.reportSecurityCpu\(sys\); this\.reportWatcherStorm\(sys\); this\.reportMeasuredSaturation\(sys\); \}/.test(src),
  true,
);
check(
  'B4 构建开始低内存检查同受门控',
  /reportSystemHeadroom\(\) \{ if \(!this\.adviceEnabled\(\)\) return;/.test(src),
  true,
);
check('B5 adviceEnabled(): build.profile 为诊断模式放行', /if \(this\.prof !== undefined\) return true;/.test(src), true);
check('B6 adviceEnabled(): build.profile 设置也放行', /get\('build\.profile', false\) === true/.test(src), true);
check('B7 adviceEnabled(): build.sampleSystem 设置也放行', /get\('build\.sampleSystem', false\) === true/.test(src), true);
check(
  'B8 [profile] 计时块不受门控（仍在 adviceEnabled 分支之外）',
  src.indexOf('this.adviceEnabled()') < src.indexOf('prof.render()'),
  { gate: src.indexOf('this.adviceEnabled()'), render: src.indexOf('prof.render()') },
);
check(
  'B9 traceProcesses 统计行不受门控',
  src.indexOf('this.traceProcessSummary();') < src.indexOf('if (this.adviceEnabled())'),
  { trace: src.indexOf('this.traceProcessSummary();'), gate: src.indexOf('this.adviceEnabled()') },
);

// ---------- C. 文档面 ----------
{
  const settings = read('docs/guide/settings.md');
  const settingsEn = read('docs/guide/settings.en.md');
  check('C1 settings.md 覆盖新设置', settings.includes(KEY), true);
  check('C2 settings.en.md 覆盖新设置', settingsEn.includes(KEY), true);
  check('C3 使用说明覆盖新设置', read('docs/guide/usage.md').includes(KEY), true);
  check('C4 English usage guide covers the setting', read('docs/guide/usage.en.md').includes(KEY), true);
}

console.log(`\n构建性能顾问: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
