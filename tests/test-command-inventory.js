// 命令清单分区守卫（审计轮 0.9.2）：136 条贡献命令必须全部有归属——
//   1) 不在 HEAVY 里的命令 → 由 tests/test-command-entry-smoke.js 逐条执行；
//   2) HEAVY 里的命令 → 至少被一个非契约测试引用（真实构建/宿主/分域覆盖）。
// 目的：新增命令后若既不执行、又无任何测试引用，会静默零覆盖；本守卫让它报红。
// 证据强弱（菜单级 vs 行为级）由 docs/testing/functional-audit-0.9.2.md 人工复核，不由本脚本判定。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const commands = pkg.contributes.commands.map((c) => c.command);
const smokeSrc = fs.readFileSync(path.join(__dirname, 'test-command-entry-smoke.js'), 'utf-8');

function setOf(name) {
  const m = smokeSrc.match(new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\);`));
  return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
}

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const heavy = setOf('HEAVY');
check('HEAVY 集合可解析且非空', heavy.length > 0, `got ${heavy.length}`);

const declared = new Set(commands);
const unknown = heavy.filter((id) => !declared.has(id));
check('HEAVY 不含未声明的命令', unknown.length === 0, unknown.join(', '));
check('HEAVY 无重复项', new Set(heavy).size === heavy.length);

const heavySet = new Set(heavy);
const executed = commands.filter((id) => !heavySet.has(id));
check('分区完整（执行集合 + HEAVY == 全部命令）', executed.length + heavy.length === commands.length,
  `${executed.length} + ${heavy.length} != ${commands.length}`);
check('执行集合非空（入口冒烟确实覆盖绝大多数命令）', executed.length > 100, `got ${executed.length}`);

// 扫描非契约、非入口冒烟测试，确认每条 HEAVY 命令至少被引用一次
const testFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) testFiles.push(p);
  }
})(path.join(ROOT, 'tests'));
const evidence = testFiles
  .filter((f) => !/[\\/]contract[\\/]/.test(f) && !/[\\/]test-command-entry-smoke\.js$/.test(f))
  .map((f) => ({ rel: path.relative(ROOT, f).replace(/\\/g, '/'), text: fs.readFileSync(f, 'utf-8') }));
const orphanHeavy = heavy.filter((id) => !evidence.some((e) => e.text.includes(id)));
check('每条 HEAVY 命令都有测试引用', orphanHeavy.length === 0, orphanHeavy.join(', '));

console.log(`命令清单分区: ${pass} pass, ${fail} fail（执行 ${executed.length} + HEAVY ${heavy.length} = ${commands.length}）`);
process.exit(fail ? 1 : 0);
