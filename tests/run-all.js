// 回归运行器：逐个执行 tests/test-*.js，汇总退出码与最后一行摘要
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = path.resolve(__dirname);
const files = fs.readdirSync(dir).filter((f) => /^test-.*\.js$/.test(f) && f !== path.basename(__filename)).sort();
const rows = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8', timeout: 600000 });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim();
  const lines = out.split(/\r?\n/).filter((l) => /pass|fail|OK|错误|PASS|FAIL|EXIT/.test(l));
  const code = r.status === null ? -1 : r.status;
  rows.push({ f, code, last: (lines[lines.length - 1] || '').slice(0, 90) });
}
const failed = rows.filter((r) => r.code !== 0);
const out = rows.map((r) => `${r.f.padEnd(40)} exit=${String(r.code).padStart(2)}  ${r.last}`).join('\n');
fs.writeFileSync(path.join(dir, '..', '.cbtest.txt'), out + `\n\nTOTAL=${rows.length} FAIL=${failed.length}${failed.length ? '  [' + failed.map((r) => r.f).join(', ') + ']' : ''}\n`);
console.log(`TOTAL=${rows.length} FAIL=${failed.length}${failed.length ? ' -> ' + failed.map((r) => r.f).join(', ') : ''}`);
