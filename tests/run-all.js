// 分层回归运行器：按测试层（unit / contract / e2e / visual / perf / pack / host）分组执行，
// 汇总退出码与最后一行摘要。
//
// 用法：
//   node tests/run-all.js                       # 等价 npm test：unit 层（tests/test-*.js）+ 写 .cbtest.txt
//   node tests/run-all.js --group contract      # L-1 静态契约
//   node tests/run-all.js --group e2e           # L1 真实工程端到端
//   node tests/run-all.js --group visual        # L3 像素视觉回归
//   node tests/run-all.js --group perf          # L4 性能基准
//   node tests/run-all.js --group pack          # L5 VSIX 打包/安装冒烟
//   node tests/run-all.js --group host          # L2 VS Code 宿主集成（@vscode/test-electron）
//   node tests/run-all.js --group all           # contract+unit+e2e+visual+perf+pack（host 需 --with-host）
//   node tests/run-all.js [--filter <子串>] [--json <报告路径>]
//
// KNOWN_MANUAL：需 <cbp> 参数的辅助脚本（手工工具，非自动测试）——不参与自动回归，单独列出避免"永久 FAIL=1"掩盖真实失败
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.resolve(__dirname);
const root = path.resolve(dir, '..');
const KNOWN_MANUAL = new Set(['test-writer.js']);

// 各层：dir = 相对 tests 的目录（'' = tests 根），pattern = 纳入脚本名
const LAYERS = {
  unit: { dir: '', pattern: /^test-.*\.js$/, note: '无头单元/集成（dist 层）' },
  contract: { dir: 'contract', pattern: /^test-.*\.js$/, note: 'L-1 静态契约' },
  e2e: { dir: 'e2e', pattern: /^test-.*\.js$/, note: 'L1 真实工具链端到端' },
  visual: { dir: 'visual', pattern: /^test-.*\.js$/, note: 'L3 像素视觉回归' },
  perf: { dir: 'perf', pattern: /^test-.*\.js$/, note: 'L4 性能基准' },
  pack: { dir: 'pack', pattern: /^test-.*\.js$/, note: 'L5 打包与安装冒烟' },
  host: { dir: 'host', pattern: /^runTest\.js$/, note: 'L2 VS Code 宿主集成（@vscode/test-electron + 自研框架）' },
};

function parseArgs(argv) {
  const opts = { group: 'unit', filter: '', json: '', withHost: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--group' || a === '-g') opts.group = argv[++i] || '';
    else if (a === '--filter' || a === '-f') opts.filter = argv[++i] || '';
    else if (a === '--json') opts.json = argv[++i] || '';
    else if (a === '--with-host') opts.withHost = true;
    else if (/^--group=/.test(a)) opts.group = a.split('=')[1];
    else if (/^--filter=/.test(a)) opts.filter = a.split('=')[1];
    else if (/^--json=/.test(a)) opts.json = a.split('=')[1];
    else if (!/^-/.test(a)) opts.group = a;
  }
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
const groups = opts.group === 'all'
  ? ['contract', 'unit', 'e2e', 'visual', 'perf', 'pack'].concat(opts.withHost ? ['host'] : [])
  : (LAYERS[opts.group] ? [opts.group] : null);
if (!groups) {
  console.error(`未知分组: ${opts.group}（可选: ${Object.keys(LAYERS).join(' / ')} / all）`);
  process.exit(2);
}

function scriptsFor(layer) {
  const cfg = LAYERS[layer];
  const d = path.join(dir, cfg.dir);
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d)
    .filter((f) => cfg.pattern.test(f) && !KNOWN_MANUAL.has(f))
    .sort()
    .map((f) => path.join(d, f));
}

const rows = [];
for (const layer of groups) {
  const files = scriptsFor(layer).filter((f) => !opts.filter || f.includes(opts.filter));
  if (!files.length) {
    rows.push({ layer, f: '(无脚本)', code: 0, last: `SKIP 未创建（${LAYERS[layer].note}）` });
    console.log(`[${layer}] (无脚本) — SKIP 未创建（${LAYERS[layer].note}）`);
    continue;
  }
  for (const f of files) {
    const r = spawnSync(process.execPath, [f], { encoding: 'utf8', timeout: 900000, cwd: root });
    const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
    const lines = out.split(/\r?\n/).filter((l) => /pass|fail|OK|错误|PASS|FAIL|EXIT|SKIP/.test(l));
    const code = r.status === null ? -1 : r.status;
    // 摘要行优先：含「数字 + pass/fail（或 PASS=/FAIL=）」的行；否则退回最后一条含关键字的行
    const summaryLines = lines.filter((l) => /(\d+\s*(pass|fail))|(PASS=\s*\d+.*FAIL=\s*\d+)/i.test(l));
    const last = ((summaryLines[summaryLines.length - 1] || lines[lines.length - 1]) || '').slice(0, 90);
    rows.push({ layer, f: path.relative(dir, f), code, last });
    console.log(`[${layer}] ${path.relative(dir, f).padEnd(40)} exit=${String(code).padStart(2)}  ${last}`);
  }
}

const failed = rows.filter((r) => r.code !== 0);
// KNOWN_MANUAL 只在 unit 层有意义（脚本位于 tests 根目录），其它分组不再重复提示
const skipped = (groups.includes('unit') && fs.existsSync(dir)) ? fs.readdirSync(dir).filter((f) => KNOWN_MANUAL.has(f)) : [];
const skipNote = skipped.length ? `  SKIP=${skipped.length} [${skipped.join(', ')}]` : '';
const report = rows.map((r) => `${r.f.padEnd(40)} exit=${String(r.code).padStart(2)}  ${r.last}`).join('\n');
const header = `# group=${opts.group}${opts.filter ? ' filter=' + opts.filter : ''}${opts.withHost ? ' withHost' : ''}`;
const tail = `TOTAL=${rows.length} FAIL=${failed.length}${skipNote}${failed.length ? '  [' + failed.map((r) => r.f).join(', ') + ']' : ''}`;

if (opts.group === 'all' || opts.group === 'unit') {
  // 兼容既有行为：unit 层结果仍写 .cbtest.txt（gitignore）
  fs.writeFileSync(path.join(root, '.cbtest.txt'), report + '\n\n' + header + '\n' + tail + '\n');
}
const jsonPath = opts.json || path.join(root, '.cb-tools', `report-${opts.group}.json`);
fs.mkdirSync(path.dirname(jsonPath), { recursive: true });
fs.writeFileSync(jsonPath, JSON.stringify({
  group: opts.group, filter: opts.filter || null, withHost: opts.withHost,
  total: rows.length, failed: failed.map((r) => r.f), rows,
}, null, 2), 'utf-8');

console.log(`\n${header}\n${tail}`);
console.log(`报告: ${path.relative(root, jsonPath)}`);
process.exit(failed.length ? 1 : 0);
