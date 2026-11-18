// P0-3：原子写（同目录临时文件 + rename）回归
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writeFileAtomicSync } = require('../dist/model/atomicWrite.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-atomic-'));
try {
  const file = path.join(dir, 'app.cbp');
  writeFileAtomicSync(file, '<old />', 'utf-8');
  check('首次写入内容正确', fs.readFileSync(file, 'utf-8') === '<old />', fs.readFileSync(file, 'utf-8'), '<old />');

  writeFileAtomicSync(file, '<new />', 'utf-8');
  check('覆盖已存在文件', fs.readFileSync(file, 'utf-8') === '<new />', fs.readFileSync(file, 'utf-8'), '<new />');
  check('无残留临时文件', fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')).length === 0, fs.readdirSync(dir), []);

  const buf = Buffer.from([0x41, 0x00, 0x42]);
  writeFileAtomicSync(file, buf);
  check('Buffer 写入不损坏二进制', fs.readFileSync(file).equals(buf), fs.readFileSync(file), buf);

  // 序列化/写入抛错时原文件保持不变（模拟数据准备阶段失败）
  let threw = false;
  try {
    const bad = { toString() { throw new Error('boom'); } };
    writeFileAtomicSync(file, bad);
  } catch {
    threw = true;
  }
  check('写入失败抛出', threw, threw, true);
  check('失败后原文件未截断', fs.readFileSync(file).equals(buf), fs.readFileSync(file), buf);

  // 目标目录不存在：抛错且不留下半成品
  let missingDir = false;
  try {
    writeFileAtomicSync(path.join(dir, 'nope', 'x.cbp'), '<x />');
  } catch {
    missingDir = true;
  }
  check('目录不存在时抛错', missingDir, missingDir, true);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('atomic-write: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
