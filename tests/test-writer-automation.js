// test-writer.js 自动化检查器（A 任务：把手工工具的「非交互部分」抽成可自动回归的约定检查）
//
// 背景：tests/test-writer.js 历史上是需 `<cbp>` 参数的手工脚本，被 run-all.js 列入
// KNOWN_MANUAL 跳过（无参时打印用法并 exit 1）。它真正有价值的自动部分有三块：
//   1) parse → serialize → reparse 的往返一致性（原来只能手工挑文件跑）；
//   2) 探针工程「可移植性」——入库/生成的 .cbp 不应带本机绝对路径；
//   3) 新测试脚本的样板约定（命名自发现 / 摘要行 / 退出码门控）。
// 本检查器把 1、2 变成对全部探针工程的批量断言（直接 require test-writer.js 导出的
// roundTrip / discoverProbeProjects，并校验其 --check CLI 模式），把 3 变成对
// tests/** 的静态约定检查。依据：docs/测试方案.md §7 维护约定
// （「新增无头测试：tests/test-*.js，末行输出 `N pass, M fail` 摘要」「新增分层测试：
// 放对应目录并匹配 test-*.js（host 层为 runTest.js）」）。
//
// 判定口径：
//   · 「摘要行」= 源码中存在 console 输出同时含 pass/fail 字样（或 PASS= 汇总形式），
//     即 run-all.js 摘要正则 `/(\d+\s*(pass|fail))|(PASS=\s*\d+.*FAIL=\s*\d+)/` 依赖的形态；
//   · 冻结清单（GRANDFATHER_*）：均为历史脚本（逐条 PASS/FAIL 输出、或只打印给人看），
//     现状无法自动摘出计数/无退出码门控——新增脚本不允许进清单，且清单内脚本一旦
//     补齐约定即要求从清单移除（见对应检查），避免清单腐烂成「永久豁免」。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const writer = require('./test-writer');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const ROOT = path.resolve(__dirname, '..');
const TESTS = path.join(ROOT, 'tests');
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// ---------- 与 tests/run-all.js 一致的层配置（复刻；run-all.js 属禁改文件） ----------
const LAYERS = {
  contract: { dir: 'contract', pattern: /^test-.*\.js$/ },
  e2e: { dir: 'e2e', pattern: /^test-.*\.js$/ },
  visual: { dir: 'visual', pattern: /^test-.*\.js$/ },
  perf: { dir: 'perf', pattern: /^test-.*\.js$/ },
  pack: { dir: 'pack', pattern: /^test-.*\.js$/ },
  host: { dir: 'host', pattern: /^runTest\.js$/ },
};
const UNIT_PATTERN = /^test-.*\.js$/;
/** tests 根目录下不是测试脚本但参与 runner 的文件 */
const UNIT_ROOT_ALLOW = new Set(['run-all.js']);
/** 辅助目录（非测试层；其 .js 只是被引用） */
const HELPER_DIRS = new Set(['_harness']);

const runAllSrc = fs.readFileSync(path.join(TESTS, 'run-all.js'), 'utf-8');
const knMatch = runAllSrc.match(/const KNOWN_MANUAL = new Set\(\[([^\]]*)\]\)/);
const KNOWN_MANUAL = new Set((knMatch ? knMatch[1].match(/'[^']+'/g) || [] : []).map((s) => s.slice(1, -1)));

// ---------- 约定检查的判据（与 run-all.js 摘要正则同族） ----------
const hasTally = (text) =>
  /PASS=/.test(text) ||
  [...text.matchAll(/console\.(log|error)\(([\s\S]*?)\);/g)].some((m) => /pass/i.test(m[2]) && /fail/i.test(m[2]));
const hasExitGate = (text) => /process\.exit\s*\(/.test(text) || /process\.exitCode\s*=/.test(text);

/** 冻结清单：历史脚本（逐条 PASS/FAIL 输出，无「N pass, M fail」可摘行）——只允许缩小，不允许新增 */
const GRANDFATHER_NO_TALLY = new Set([
  'test-ar-quote.js', 'test-categorize-sim.js', 'test-deps-cache.js', 'test-dirs-settings-edit.js',
  'test-drive-case.js', 'test-file-edit.js', 'test-html-syntax.js', 'test-implib-roundtrip.js',
  'test-keybinding-panel-html.js', 'test-link-static.js', 'test-lru.js', 'test-makecommands.js',
  'test-native-sep.js', 'test-newproject.js', 'test-options-edit.js', 'test-parse-cache.js',
  'test-relation-extracommands-edit.js', 'test-resp-file.js', 'test-roundtrip-notes.js',
  'test-scripts-notes-edit.js', 'test-static-prefix.js', 'test-target-edit.js', 'test-tree-lazy.js',
  'test-tree-lazy2.js', 'test-unit-options.js', 'test-vfolder-sim.js', 'test-vfolder.js',
  'test-virtualtarget-edit.js', 'test-weight-sort.js', 'test-workspace-deps.js',
]);
/** 冻结清单：无退出码门控的历史脚本（只打印给人看）——只允许缩小，不允许新增 */
const GRANDFATHER_NO_EXIT = new Set([
  'test-dirs-settings-edit.js', 'test-file-edit.js', 'test-options-edit.js',
  'test-relation-extracommands-edit.js', 'test-scripts-notes-edit.js', 'test-static-prefix.js',
  'test-target-edit.js', 'test-vfolder-sim.js', 'test-vfolder.js', 'test-virtualtarget-edit.js',
]);

/** 探针工程白名单：手写视觉 fixture 有意含 `D:/…` 值（覆盖 SDK/search_path 渲染），
 *  仅豁免「入库文件不得含本机绝对路径」；「序列化不新增绝对路径」对它仍然生效 */
const ABS_PATH_EXEMPT = new Map([
  ['tests/visual/fixtures/rich.cbp', '视觉面 fixture：有意含 D:/sdk/current、D:/toolchains/src 以覆盖 SDK/搜索目录渲染'],
]);

// ---------- 自动发现（与 run-all.js 的 readdirSync 规则一致） ----------
function discoverLayer(layer) {
  const { dir, pattern } = LAYERS[layer];
  const abs = path.join(TESTS, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs).filter((f) => pattern.test(f)).sort().map((f) => ({ layer, file: f, abs: path.join(abs, f) }));
}
function discoverAllScripts() {
  const out = fs.readdirSync(TESTS).filter((f) => UNIT_PATTERN.test(f)).sort()
    .map((f) => ({ layer: 'unit', file: f, abs: path.join(TESTS, f) }));
  for (const layer of Object.keys(LAYERS)) out.push(...discoverLayer(layer));
  return out;
}
/** 自动发现脚本 = run-all 会真正执行的集合（排除 KNOWN_MANUAL） */
const scripts = discoverAllScripts().filter((s) => !(s.layer === 'unit' && KNOWN_MANUAL.has(s.file)));

// ---------- 可达性语料（辅助脚本必须被引用，防止「新增了但不会被跑」的孤儿文件） ----------
function buildCorpus() {
  const chunks = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|ts)$/.test(e.name)) chunks.push(fs.readFileSync(p, 'utf-8'));
    }
  };
  walk(TESTS);
  chunks.push(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  for (const f of fs.readdirSync(path.join(ROOT, 'docs'))) {
    if (f.endsWith('.md') && fs.statSync(path.join(ROOT, 'docs', f)).isFile()) {
      chunks.push(fs.readFileSync(path.join(ROOT, 'docs', f), 'utf-8'));
    }
  }
  return chunks.join('\n');
}
const corpus = buildCorpus();
const isReferenced = (file) => {
  const base = file.replace(/\.js$/, '');
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return corpus.includes(file) || new RegExp('[/.\'"`]' + esc + '[\'"`)]').test(corpus);
};

// ---------- 1. 命名与自动发现规则 ----------
check('1.1 KNOWN_MANUAL 从 run-all.js 解析成功且条目存在（防陈旧跳过项）',
  !!knMatch && [...KNOWN_MANUAL].every((f) => fs.existsSync(path.join(TESTS, f))),
  [...KNOWN_MANUAL], '解析成功且文件存在');

const unitExtra = fs.readdirSync(TESTS, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith('.js') && !UNIT_PATTERN.test(e.name) && !UNIT_ROOT_ALLOW.has(e.name))
  .map((e) => e.name);
check('1.2 tests 根目录无「不会被发现」的 .js（命名必须匹配 test-*.js）', unitExtra.length === 0, unitExtra, []);

const helperFiles = [];
const orphanHelpers = [];
for (const [layer, cfg] of Object.entries(LAYERS)) {
  const abs = path.join(TESTS, cfg.dir);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.js'))) {
    if (cfg.pattern.test(f)) continue;
    helperFiles.push(`${cfg.dir}/${f}`);
    if (!isReferenced(f)) orphanHelpers.push(`${cfg.dir}/${f}`);
  }
}
for (const d of HELPER_DIRS) {
  const abs = path.join(TESTS, d);
  if (!fs.existsSync(abs)) continue;
  for (const f of fs.readdirSync(abs).filter((x) => x.endsWith('.js'))) {
    helperFiles.push(`${d}/${f}`);
    if (!isReferenced(f)) orphanHelpers.push(`${d}/${f}`);
  }
}
check('1.3 分层目录中的辅助脚本都被引用（require / package.json scripts / docs 提及）',
  orphanHelpers.length === 0, orphanHelpers, []);

const knownDirs = new Set([...Object.values(LAYERS).map((c) => c.dir), ...HELPER_DIRS]);
const unknownDirs = fs.readdirSync(TESTS, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !knownDirs.has(e.name)).map((e) => e.name);
check('1.4 tests 子目录都已在 run-all.js 层配置或辅助目录白名单内（新增层需登记）',
  unknownDirs.length === 0, unknownDirs, [...knownDirs].sort());

// ---------- 2. 摘要行与退出码门控（docs/测试方案.md §7） ----------
const noTally = [], noExit = [];
for (const s of scripts) {
  const text = fs.readFileSync(s.abs, 'utf-8');
  const id = s.layer === 'unit' ? s.file : `${s.layer}/${s.file}`;
  if (!hasTally(text)) noTally.push(id);
  if (!hasExitGate(text)) noExit.push(id);
}
const newNoTally = noTally.filter((f) => !GRANDFATHER_NO_TALLY.has(f));
check('2.1 每个自动发现脚本都有「N pass, M fail」摘要（或属冻结的历史脚本）',
  newNoTally.length === 0, newNoTally, []);
const staleNoTally = [...GRANDFATHER_NO_TALLY].filter((f) => !noTally.includes(f));
check('2.2 摘要冻结清单无腐烂（清单内脚本不得已具备摘要；缺文件视为腐烂）',
  staleNoTally.length === 0, staleNoTally, []);

const newNoExit = noExit.filter((f) => !GRANDFATHER_NO_EXIT.has(f));
check('2.3 每个自动发现脚本都有退出码门控 process.exit/exitCode（或属冻结的历史脚本）',
  newNoExit.length === 0, newNoExit, []);
const staleNoExit = [...GRANDFATHER_NO_EXIT].filter((f) => !noExit.includes(f));
check('2.4 退出码冻结清单无腐烂（清单内脚本不得已具备门控）', staleNoExit.length === 0, staleNoExit, []);

// ---------- 3. test-writer.js 的自动模式 ----------
const probes = writer.discoverProbeProjects(ROOT);
check('3.0 探针自动发现非空（零探针视为失败，避免静默全绿）', probes.length > 0, probes.length, '> 0');

const rtFail = [];
for (const p of probes) {
  try {
    const r = writer.roundTrip(path.join(ROOT, p));
    if (!r.ok) rtFail.push({ p, before: r.before, after: r.after });
  } catch (e) { rtFail.push({ p, error: e && e.message }); }
}
check(`3.1 require 导出 API：全部探针往返一致（${probes.length} 个 .cbp）`, rtFail.length === 0, rtFail.slice(0, 2), []);

const cli = spawnSync(process.execPath, [path.join('tests', 'test-writer.js'), '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
const cliOut = `${cli.stdout || ''}${cli.stderr || ''}`;
const cliSummary = cliOut.match(/(\d+)\s*pass,\s*(\d+)\s*fail/);
check('3.2 CLI --check 退出 0 且摘要为「N pass, 0 fail」（N = 自动发现数）',
  cli.status === 0 && !!cliSummary && Number(cliSummary[1]) === probes.length && cliSummary[2] === '0',
  { status: cli.status, summary: cliSummary && cliSummary[0] }, `exit=0, ${probes.length} pass, 0 fail`);

const cliDir = spawnSync(process.execPath, [path.join('tests', 'test-writer.js'), '--check', 'tests/visual/fixtures'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
const cliDirOut = `${cliDir.stdout || ''}${cliDir.stderr || ''}`;
check('3.3 CLI --check <目录> 只跑该目录探针（子集筛选生效）',
  cliDir.status === 0 && /1 pass, 0 fail/.test(cliDirOut), cliDirOut.trim().split('\n').pop(), '1 pass, 0 fail');

const cliManual = spawnSync(process.execPath, [path.join('tests', 'test-writer.js'), 'test-project/hello-cb.cbp'], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
const cliManualOut = `${cliManual.stdout || ''}${cliManual.stderr || ''}`;
check('3.4 手工用法兼容：带 <cbp> 参数退出 0 且输出「往返一致: OK」',
  cliManual.status === 0 && cliManualOut.includes('往返一致: OK'), cliManual.status, 0);

const cliNoArg = spawnSync(process.execPath, [path.join('tests', 'test-writer.js')], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
const cliNoArgOut = `${cliNoArg.stdout || ''}${cliNoArg.stderr || ''}`;
check('3.5 无参数仍为手工语义：打印用法并退出 1（KNOWN_MANUAL 跳过理由保持成立）',
  cliNoArg.status === 1 && cliNoArgOut.includes('用法: node test-writer.js <cbp文件...>'), cliNoArg.status, 1);

// ---------- 4. 探针工程可移植性（生成物不带本机绝对路径） ----------
const ABS_RE = /[A-Za-z]:[\\/]|file:\/\/\//g;
const trackedImpure = [];
const exemptStale = [];
for (const p of probes) {
  const text = fs.readFileSync(path.join(ROOT, p), 'utf-8');
  const hits = (text.match(ABS_RE) || []).length;
  if (ABS_PATH_EXEMPT.has(p)) { if (hits === 0) exemptStale.push(p); continue; }
  if (hits > 0) trackedImpure.push({ p, hits });
}
check('4.1 入库探针工程不含本机绝对路径（盘符 / file:///）', trackedImpure.length === 0, trackedImpure, []);
check('4.2 绝对路径白名单无腐烂（豁免项不再含绝对路径即应移除豁免）',
  exemptStale.length === 0 && [...ABS_PATH_EXEMPT.keys()].every((p) => probes.includes(p)),
  { exemptStale, missing: [...ABS_PATH_EXEMPT.keys()].filter((p) => !probes.includes(p)) }, []);

const introduced = [];
for (const p of probes) {
  const r = writer.roundTrip(path.join(ROOT, p));
  const before = (r.original.match(ABS_RE) || []).length;
  const after = (r.serialized.match(ABS_RE) || []).length;
  if (after > before) introduced.push({ p, before, after });
}
check('4.3 序列化不新增绝对本机路径（每个探针：序列化产物命中数 ≤ 原文件）',
  introduced.length === 0, introduced, []);

// ---------- 汇总 ----------
console.log('');
console.log(`     · 发现脚本 ${scripts.length} 个（unit ${scripts.filter((s) => s.layer === 'unit').length} / 其它层 ${scripts.filter((s) => s.layer !== 'unit').length}）；` +
  `KNOWN_MANUAL=${[...KNOWN_MANUAL].join(',') || '(无)'}`);
console.log(`     · 冻结：无摘要 ${GRANDFATHER_NO_TALLY.size} 个、无退出码门控 ${GRANDFATHER_NO_EXIT.size} 个（历史脚本，新增脚本必须满足约定，见 docs/测试方案.md §7）`);
console.log(`     · 辅助脚本 ${helperFiles.length} 个（${helperFiles.join(', ')}）`);
console.log(`     · 探针工程 ${probes.length} 个（${probes.join(', ')}）`);
console.log(`test-writer-automation: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
