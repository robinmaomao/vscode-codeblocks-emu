// 覆盖矩阵生成器：把 package.json 的贡献面（命令/视图/设置/键位/语言/菜单/调试器）
// 与各测试层（contract / 无头 unit / e2e / host）以及 src 实现做交叉统计，
// 输出 docs/测试覆盖矩阵.md（入库）+ .cb-tools/coverage-matrix.json（临时，gitignore）。
// 用法：node tests/contract/gen-coverage-matrix.js
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const c = pkg.contributes || {};

/** 递归收集某目录下所有 .js 文件的相对路径 → 文本（排除生成器自身，避免"自我引用"计入覆盖） */
function collectFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, out);
    else if (/\.(js|ts)$/.test(e.name) && !/^gen-/.test(e.name) && e.name !== path.basename(__filename)) out.push(p);
  }
  return out;
}
const text = (files) => files.map((f) => fs.readFileSync(f, 'utf-8')).join('\n');

const layers = {
  src: collectFiles(path.join(root, 'src')),
  contract: collectFiles(path.join(root, 'tests', 'contract')),
  unit: collectFiles(path.join(root, 'tests')).filter((f) => path.dirname(f) === path.join(root, 'tests') && /test-.*\.js$/.test(path.basename(f))),
  e2e: collectFiles(path.join(root, 'tests', 'e2e')),
  visual: collectFiles(path.join(root, 'tests', 'visual')),
  perf: collectFiles(path.join(root, 'tests', 'perf')),
  host: collectFiles(path.join(root, 'tests', 'host')),
};
const layerText = Object.fromEntries(Object.entries(layers).map(([k, v]) => [k, text(v)]));
const layerNames = ['src', 'contract', 'unit', 'e2e', 'visual', 'perf', 'host'];
const hit = (key, id) => layerNames.filter((l) => layerText[l].includes(id));

// 补充命中：视觉层与性能层不引用命令 ID 字面量，但确实覆盖对应「面/引擎路径」。
// 这些映射经人工核对后固化，避免台账低估覆盖率（判定口径见文件头注释）。
const EXPLICIT_HITS = {
  visual: new Set([
    'codeblocks.projectProperties',   // tests/visual/surfaces.js 渲染工程属性面板 9 个 tab
    'codeblocks.keybindings.panel',   // 渲染快捷键面板并注入宿主 state
    'codeblocks.compilerOptions',     // 渲染编译选项面板（真实 options_gcc.xml）
    'codeblocks.buildLog.showAllMessages', // HTML 构建日志渲染（含命令行块与诊断表）
    'codeblocks.buildLog.clearOutput',
    'codeblocks.buildLog.copyMessage',
    'codeblocks.buildLog.copyDiagnostic',
    'codeblocks.buildLog.toggleErrorsOnly',
  ]),
  perf: new Set([
    'codeblocks.build',               // B8 真实全量构建（BuildEngine.build）
    'codeblocks.rebuild',             // B8 组合 cleanTarget + build
    'codeblocks.clean',               // B8 前置 cleanTarget
    'codeblocks.compileFile',         // B10 真实单文件编译
    'codeblocks.generateCompileCommands', // B2 命令行生成（compile_commands 同源）
  ]),
};

/** 生成一行统计：命中层 + 是否至少被某个测试层覆盖（src 只表示实现存在，不算测试覆盖） */
function row(key, id) {
  const hits = hit(key, id).slice();
  for (const [layer, ids] of Object.entries(EXPLICIT_HITS)) {
    if (ids.has(id) && !hits.includes(layer)) hits.push(layer);
  }
  const ordered = layerNames.filter((l) => hits.includes(l));
  const tested = ordered.filter((l) => l !== 'src');
  return { hits: ordered, tested, covered: tested.length > 0 };
}

const commands = c.commands || [];
const cmdRows = commands.map((x) => ({ id: x.command, title: x.title, ...row(x.command, x.command) }));

const allViews = Object.values(c.views || {}).flat();
const viewRows = allViews.map((v) => ({ id: v.id, title: v.name, ...row(v.id, v.id) }));

const props = Array.isArray(c.configuration)
  ? Object.assign({}, ...c.configuration.map((b) => b.properties || {}))
  : (c.configuration?.properties || {});
const settingRows = Object.entries(props).map(([k, v]) => ({ id: k, title: v.title || '', ...row('"' + k + '"', k) }));

const keyRows = (c.keybindings || []).map((b) => ({ id: b.command, key: b.key, ...row(b.key, b.command) }));

const langRows = [
  ...(c.languages || []).map((l) => ({ kind: 'language', id: l.id, ...row('"' + l.id + '"', l.extensions?.[0] || l.id) })),
  ...(c.grammars || []).map((g) => ({ kind: 'grammar', id: g.scopeName, ...row(g.scopeName, g.scopeName) })),
];

// DAP 请求/能力清单（用于评估调试覆盖；以测试源码中真实发出的 DAP 命令字面量为判据）
// 判据说明：e2e 调试矩阵用 `client.send('<命令>', …)`，宿主层用 `session.customRequest('<命令>', …)`，
// 故 needle 取「调用点 + 命令名」片段，避免 `next`/`goto` 等短词在其它上下文里的误命中。
const DAP_CAPS = [
  ['initialize', ["send('initialize'"]],
  ['launch/attach', ["send('launch'", "send('attach'"]],
  ['setBreakpoints', ["send('setBreakpoints'"]],
  ['setFunctionBreakpoints', ["setFunctionBreakpoints"]],
  ['setConditionalBreakpoints', ['condition:']],
  ['hitCondition', ['hitCondition']],
  ['logMessage', ['logMessage']],
  ['setDataBreakpoints', ["send('setDataBreakpoints'"]],
  ['setExceptionBreakpoints', ["send('setExceptionBreakpoints'"]],
  ['setInstructionBreakpoints', ["send('setInstructionBreakpoints'"]],
  ['configurationDone', ["send('configurationDone'"]],
  ['continue', ["send('continue'", "customRequest('continue'"]],
  ['next', ["send('next'"]],
  ['stepIn', ["send('stepIn'"]],
  ['stepOut', ["send('stepOut'"]],
  ['pause/stop', ["customRequest('pause'", "send('pause'"]],
  ['threads', ["send('threads'", "customRequest('threads'"]],
  ['stackTrace', ["send('stackTrace'", "customRequest('stackTrace'"]],
  ['scopes', ["send('scopes'", "customRequest('scopes'"]],
  ['variables', ["send('variables'", "customRequest('variables'"]],
  ['setVariable', ["send('setVariable'"]],
  ['evaluate', ["send('evaluate'"]],
  ['disassemble', ["send('disassemble'"]],
  ['readMemory', ["send('readMemory'"]],
  ['writeMemory', ["send('writeMemory'"]],
  ['modules', ["send('modules'"]],
  ['gotoTargets', ["send('gotoTargets'"]],
  ['loadedSources', ["send('loadedSources'"]],
  ['terminate', ["send('terminate'"]],
  ['disconnect/detach', ["send('disconnect'", '-target-detach']],
];
const dapRows = DAP_CAPS.map(([name, needles]) => {
  const hits = layerNames.filter((l) => needles.some((n) => layerText[l].includes(n)));
  const tested = hits.filter((l) => l === 'e2e' || l === 'host' || l === 'unit');
  return { id: name, hits, tested, covered: tested.length > 0 };
});

const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0);
const summary = [
  ['命令', cmdRows],
  ['视图', viewRows],
  ['设置', settingRows],
  ['快捷键', keyRows],
  ['语言/语法', langRows],
  ['DAP 能力', dapRows],
];

const md = [];
md.push('# 测试覆盖矩阵（自动生成，勿手工编辑）');
md.push('');
md.push('> 生成方式：`npm run coverage:matrix`（脚本 [`tests/contract/gen-coverage-matrix.js`](../tests/contract/gen-coverage-matrix.js)）');
md.push('> 判定口径：契约项 ID（命令/视图/设置键/键位/语言/语法/DAP 能力标记）在对应测试层源码中出现即计为命中；');
md.push('> 视觉层/性能层不引用命令 ID 字面量，按 `EXPLICIT_HITS`（面/引擎级覆盖）人工补充，明细见脚本内注释。');
md.push('> 列 `src` 表示实现存在（不算测试覆盖）；`契约/无头/E2E/视觉/性能/宿主` 为六个自动化测试层。');
md.push(`> 数据来源：package.json v${pkg.version} + tests/** + src/**`);
md.push('');
md.push('## 汇总');
md.push('');
md.push('| 契约项 | 总数 | 契约层 | 无头层 | E2E 层 | 视觉层 | 性能层 | 宿主层 | 未覆盖 | 覆盖率 |');
md.push('|--------|------|--------|--------|--------|--------|--------|--------|--------|--------|');
for (const [name, rows] of summary) {
  const cnt = (l) => rows.filter((r) => r.hits.includes(l)).length;
  const uncovered = rows.filter((r) => !r.covered).length;
  md.push(`| ${name} | ${rows.length} | ${cnt('contract')} | ${cnt('unit')} | ${cnt('e2e')} | ${cnt('visual')} | ${cnt('perf')} | ${cnt('host')} | ${uncovered} | ${pct(rows.length - uncovered, rows.length)}% |`);
}
md.push('');

function table(title, rows, cols) {
  md.push(`## ${title}`);
  md.push('');
  md.push('| # | 标识 | 标题 | ' + cols.map((x) => x[1]).join(' | ') + ' | 状态 |');
  md.push('|---|------|------|' + cols.map(() => '------').join('|') + '|------|');
  const uncovered = [];
  rows.forEach((r, i) => {
    const cells = cols.map(([key]) => (r.hits.includes(key) ? '✔' : '·'));
    md.push(`| ${i + 1} | \`${r.id}\` | ${String(r.title || r.key || '').replace(/\|/g, '\\|')} | ${cells.join(' | ')} | ${r.covered ? '✅' : '⚠ 未覆盖'} |`);
    if (!r.covered) uncovered.push(r.id);
  });
  md.push('');
  md.push(`未覆盖 ${uncovered.length} 项${uncovered.length ? '：' + uncovered.map((u) => '`' + u + '`').join('、') : ''}`);
  md.push('');
}

const cols = [['contract', '契约'], ['unit', '无头'], ['e2e', 'E2E'], ['visual', '视觉'], ['perf', '性能'], ['host', '宿主']];
table('1. 命令', cmdRows, cols);
table('2. 视图', viewRows, cols);
table('3. 设置项', settingRows, cols);
table('4. 快捷键', keyRows, cols);
table('5. 语言与语法', langRows, cols);
table('6. 调试（DAP）能力', dapRows, cols);

const outMd = path.join(root, 'docs', '测试覆盖矩阵.md');
fs.writeFileSync(outMd, md.join('\n'), 'utf-8');
const cbTools = path.join(root, '.cb-tools');
if (!fs.existsSync(cbTools)) fs.mkdirSync(cbTools, { recursive: true });
fs.writeFileSync(path.join(cbTools, 'coverage-matrix.json'), JSON.stringify({ summary: summary.map(([n, r]) => ({ name: n, total: r.length, uncovered: r.filter((x) => !x.covered).map((x) => x.id) })) }, null, 2), 'utf-8');

for (const [name, rows] of summary) {
  const uncovered = rows.filter((r) => !r.covered).length;
  console.log(`${name.padEnd(10)} total=${String(rows.length).padStart(3)} covered=${String(rows.length - uncovered).padStart(3)} uncovered=${String(uncovered).padStart(3)} (${pct(rows.length - uncovered, rows.length)}%)`);
}
console.log(`\n已写入 ${path.relative(root, outMd)}`);
