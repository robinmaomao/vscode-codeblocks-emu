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

// ---------- D. 行为面（真实 dist + vscode mock） ----------
{
  const os = require('os');
  const { installVscodeMock } = require('./_harness/vscodeMock');
  const mock = installVscodeMock({ config: {} });
  const vscode = require('vscode');
  const { BuildEngine } = require(path.join(ROOT, 'dist', 'build', 'buildEngine.js'));
  const { BuildProfiler } = require(path.join(ROOT, 'dist', 'build', 'buildProfiler.js'));

  const setCfg = (obj) => {
    for (const k of Object.keys(mock.configStore)) if (k.startsWith('codeblocks.')) delete mock.configStore[k];
    Object.assign(mock.configStore, obj);
  };

  /** 构造只带「构建收尾」所需状态的引擎（不实例化 vscode 依赖的完整对象） */
  const makeEngine = (prof) => {
    const warns = [], infos = [];
    const eng = Object.create(BuildEngine.prototype);
    eng.output = {
      info: (m) => infos.push(String(m)), warn: (m) => warns.push(String(m)),
      error: (m) => warns.push(String(m)), debug: () => {}, trace: () => {},
      append: () => {}, appendLine: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {}, raw: {},
    };
    eng.prof = prof;
    eng.profBuildStartMs = Date.now() - 12_000;
    eng.project = { filename: path.join(ROOT, 'test-project', 'hello-cb.cbp'), basePath: path.join(ROOT, 'test-project') };
    eng.scopeConfig = () => vscode.workspace.getConfiguration('codeblocks', vscode.Uri.file(eng.project.filename));
    eng.maxJobs = () => 8;
    // 模拟「宿主卡顿 60% / 最长 975 ms」的一轮构建统计
    eng.lagActive = false;
    eng.lagSamples = 60;
    eng.lagSumMs = 6000;
    eng.lagMaxMs = 975;
    eng.lagWindowStartMs = Date.now() - 10_000;
    eng.dispatchWaitMs = 11;
    eng.dispatchWaitMaxMs = 5;
    eng.spawnCount = 57;
    eng.profTotalCompileMs = 5000;
    eng.demotedSpawns = 0;
    eng.peakSpawns = 8;
    eng.sysSampler = undefined;
    eng.sysSamples = [];
    eng.sysBuf = '';
    return { eng, warns, infos };
  };

  /** 在低内存（1%）下调用构建开始检查；os 打桩后必定还原 */
  const runHeadroom = (eng) => {
    const total = os.totalmem, free = os.freemem;
    os.totalmem = () => 100;
    os.freemem = () => 1;
    try { eng.reportSystemHeadroom(); } finally { os.totalmem = total; os.freemem = free; }
  };

  setCfg({});
  {
    const { eng, warns, infos } = makeEngine(undefined);
    eng.emitBuildProfile();
    check('D1 默认构建收尾无 ⚠️ 归因输出', warns.length === 0, warns);
    check('D2 默认无 [profile] 块', !infos.some((l) => l.includes('[profile]')), infos);
    const before = warns.length;
    runHeadroom(eng);
    check('D3 默认低内存检查静默', warns.length === before, warns);
  }

  setCfg({ [KEY]: true });
  {
    const { eng, warns, infos } = makeEngine(undefined);
    eng.emitBuildProfile();
    check('D4 打开后输出 4 行归因告警', warns.length === 4, warns.length);
    check('D5 含卡顿占比与最长滞后', /60%|60 %/.test(warns[0]) && /975/.test(warns[0]), warns[0]);
    check('D6 含 dispatch wait 判定', warns.some((w) => w.includes('dispatch wait')), true);
    check('D7 打开后仍不输出 [profile] 块', !infos.some((l) => l.includes('[profile]')), true);
    const before = warns.length;
    runHeadroom(eng);
    check('D8 打开后低内存检查会提示', warns.length === before + 1, warns.slice(before));
  }

  setCfg({ 'codeblocks.build.profile': true });
  {
    const { eng, warns, infos } = makeEngine(new BuildProfiler());
    eng.emitBuildProfile();
    check('D9 诊断模式（profile）自动输出归因告警', warns.length === 4, warns.length);
    check('D10 诊断模式同时输出 [profile] 块', infos.some((l) => l.includes('[profile]')), true);
  }

  mock.restore();
}

console.log(`\n构建性能顾问: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
