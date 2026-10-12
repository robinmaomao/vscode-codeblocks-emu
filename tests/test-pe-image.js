// C-01（入口地址兜底的前提）：PE `DllCharacteristics.DYNAMICBASE` 解析
// 背景：PE 置了 DYNAMICBASE 时加载器可能重定位映像 ⇒ 文件内入口地址在运行前不可知，
// 该地址断点会让 `-exec-run` 直接中止（CI 实测 GDB 17.1：Cannot access memory at address
// 0x1400013f0 → Command aborted.）⇒ 适配器必须先判断「是否可重定位」再决定是否走地址兜底。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { peDynamicBase, peDynamicBaseFromFile } = require('../dist/debug/peImage.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

/** 造一个最小 PE 缓冲区（dos + COFF + 可选头），dllChars 写进可选头 */
function makePe({ magic = 0x20b, dllChars = 0, lfanew = 0x80, signature = 0x00004550 } = {}) {
  const opt = 24 + 72; // COFF(20) + 签名(4) + 需要覆盖到 DllCharacteristics(+70,+2)
  const buf = Buffer.alloc(lfanew + opt);
  buf.writeUInt16LE(0x5a4d, 0);          // 'MZ'
  buf.writeUInt32LE(lfanew, 0x3c);
  buf.writeUInt32LE(signature, lfanew);
  buf.writeUInt16LE(magic, lfanew + 24);
  buf.writeUInt16LE(dllChars, lfanew + 24 + 70);
  return buf;
}

check('PE32+ 置 DYNAMICBASE(0x40) → true', peDynamicBase(makePe({ magic: 0x20b, dllChars: 0x40 })) === true, peDynamicBase(makePe({ magic: 0x20b, dllChars: 0x40 })), true);
check('PE32 置 DYNAMICBASE → true', peDynamicBase(makePe({ magic: 0x10b, dllChars: 0x40 })) === true, peDynamicBase(makePe({ magic: 0x10b, dllChars: 0x40 })), true);
check('PE32+ 未置 DYNAMICBASE → false', peDynamicBase(makePe({ magic: 0x20b, dllChars: 0x00 })) === false, peDynamicBase(makePe({ magic: 0x20b, dllChars: 0x00 })), false);
check('其它位（NXCOMPAT|HIGhentROPYVA|TERMINAL_AWARE=0x8140 之外）不影响判定：0x0100 → false',
  peDynamicBase(makePe({ dllChars: 0x0100 })) === false, peDynamicBase(makePe({ dllChars: 0x0100 })), false);
check('DYNAMICBASE + 其它位（0x8160）→ true', peDynamicBase(makePe({ dllChars: 0x8160 })) === true, peDynamicBase(makePe({ dllChars: 0x8160 })), true);
check('非 PE（无 MZ）→ undefined', peDynamicBase(Buffer.from('not a pe file at all.....................', 'ascii')) === undefined, peDynamicBase(Buffer.from('not a pe file at all', 'ascii')), undefined);
check('MZ 但签名错误 → undefined', peDynamicBase(makePe({ signature: 0x12345678 })) === undefined, peDynamicBase(makePe({ signature: 0x12345678 })), undefined);
check('PE 但 magic 非法（0x999）→ undefined', peDynamicBase(makePe({ magic: 0x999 })) === undefined, peDynamicBase(makePe({ magic: 0x999 })), undefined);
check('缓冲区过短（截断到 DOS 头内）→ undefined', peDynamicBase(makePe().subarray(0, 0x20)) === undefined, peDynamicBase(makePe().subarray(0, 0x20)), undefined);
check('缓冲区截断在可选头中间 → undefined',
  peDynamicBase(makePe({ dllChars: 0x40 }).subarray(0, 0x80 + 24 + 70)) === undefined,
  peDynamicBase(makePe({ dllChars: 0x40 }).subarray(0, 0x80 + 24 + 70)), undefined);
check('lfanew 为 0（损坏）→ undefined', peDynamicBase(makePe({ lfanew: 0 })) === undefined, peDynamicBase(makePe({ lfanew: 0 })), undefined);

// 文件形态：真实二进制（本机 gcc 产物；DYNAMICBASE 取决于 binutils 默认值，故只断言「能解析出布尔值」）
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pe-'));
try {
  const { spawnSync } = require('child_process');
  const src = path.join(dir, 'pe-probe.c');
  fs.writeFileSync(src, 'int main(void){return 0;}\n', 'utf-8');
  const exe = path.join(dir, 'pe-probe.exe');
  const r = spawnSync('gcc', ['-g', '-O0', '-o', exe, src], { encoding: 'utf-8', windowsHide: true, shell: false });
  const noGcc = /ENOENT|not recognized|cannot find/i.test(String(r.error && r.error.message || ''));
  if (r.status !== 0) {
    console.log(`SKIP 文件形态用例（gcc 不可用或编译失败：${String(r.stderr || (r.error && r.error.message) || '').split('\n')[0]}）`);
  } else {
    const v = peDynamicBaseFromFile(exe);
    check('真实 PE 文件 → 解析出布尔值（本机 binutils 8.1/2.30 默认未置 DYNAMICBASE）',
      v === true || v === false, v, 'true|false');
    check('文件形态与缓冲区形态一致', peDynamicBase(fs.readFileSync(exe)) === v, { file: v, buf: peDynamicBase(fs.readFileSync(exe)) }, v);
    check('非 PE 文件（.c 文本）→ undefined', peDynamicBaseFromFile(src) === undefined, peDynamicBaseFromFile(src), undefined);
    check('不存在的文件 → undefined', peDynamicBaseFromFile(path.join(dir, 'nope.exe')) === undefined, peDynamicBaseFromFile(path.join(dir, 'nope.exe')), undefined);
    check('目录路径（读取失败）→ undefined', peDynamicBaseFromFile(dir) === undefined, peDynamicBaseFromFile(dir), undefined);
    if (noGcc) console.log('（gcc 探测：' + noGcc + '）');
  }
} catch (e) {
  console.log('SKIP 文件形态用例：' + (e && e.message));
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(`\npe-image(DYNAMICBASE): ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
