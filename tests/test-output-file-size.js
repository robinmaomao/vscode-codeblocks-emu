// 构建产物体积行回归（对齐 Code::Blocks `Output file is <输出文件> with size <大小>`）：
//   CB 证据：compilergcc.cpp CompilerGCC::OnJobEnd（<1024 → bytes；<1048576 → KB；否则 MB；均 %.2f）
//  - formatCbFileSize：三档、两位小数、无 GB 档、1024B ⇒ 1.00 KB
//  - outputFileSizeText：真实文件 / 不存在 / 目录 三种情形
//  - dist 接线：链接与打包成功各一处调用，且**不在** `!buildLogPrefs().plain` 分支内（plain 模式也要打印）
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const { formatCbFileSize, outputFileSizeText } = require('../dist/build/outputFileInfo.js');

// ---------- A. 档位与精度（CB 对齐） ----------
check('A1 0 字节 → 0.00 bytes（CB 小于 1KB 也两位小数）', formatCbFileSize(0) === '0.00 bytes', formatCbFileSize(0));
check('A2 512 字节 → 512.00 bytes（单位小写 bytes，对齐 CB 原文）', formatCbFileSize(512) === '512.00 bytes', formatCbFileSize(512));
check('A3 1023 字节 → 1023.00 bytes（仍属字节档）', formatCbFileSize(1023) === '1023.00 bytes', formatCbFileSize(1023));
check('A4 1024 字节 → 1.00 KB（CB 判档用 <，1024 已进 KB 档）', formatCbFileSize(1024) === '1.00 KB', formatCbFileSize(1024));
check('A5 1536 字节 → 1.50 KB（两位小数）', formatCbFileSize(1536) === '1.50 KB', formatCbFileSize(1536));
check('A6 490014 字节 → 478.53 KB（用户反馈的 CB 样例）', formatCbFileSize(490014) === '478.53 KB', formatCbFileSize(490014));
check('A7 1048575 字节 → 1024.00 KB（差 1 字节仍属 KB 档）', formatCbFileSize(1048575) === '1024.00 KB', formatCbFileSize(1048575));
check('A8 1048576 字节 → 1.00 MB', formatCbFileSize(1048576) === '1.00 MB', formatCbFileSize(1048576));
check('A9 5.5 MB → 5.50 MB', formatCbFileSize(Math.round(5.5 * 1024 * 1024)) === '5.50 MB', formatCbFileSize(Math.round(5.5 * 1024 * 1024)));
check('A10 2 GiB → 2048.00 MB（CB 无 GB 档）',
  formatCbFileSize(2 * 1024 * 1024 * 1024) === '2048.00 MB', formatCbFileSize(2 * 1024 * 1024 * 1024));
check('A11 非法输入（-1 / NaN）→ 0.00 bytes 兜底',
  formatCbFileSize(-1) === '0.00 bytes' && formatCbFileSize(NaN) === '0.00 bytes', [formatCbFileSize(-1), formatCbFileSize(NaN)]);

// ---------- B. outputFileSizeText ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-outsize-'));
try {
  const f = path.join(tmpDir, 'app.elf');
  fs.writeFileSync(f, Buffer.alloc(490014, 0x41));
  check('B1 真实文件 → 体积文本', outputFileSizeText(f) === '478.53 KB', outputFileSizeText(f));
  const small = path.join(tmpDir, 'tiny.bin');
  fs.writeFileSync(small, Buffer.alloc(10, 0x00));
  check('B2 小文件 → bytes 档', outputFileSizeText(small) === '10.00 bytes', outputFileSizeText(small));
  const empty = path.join(tmpDir, 'empty.bin');
  fs.writeFileSync(empty, '');
  check('B3 空文件 → 0.00 bytes', outputFileSizeText(empty) === '0.00 bytes', outputFileSizeText(empty));
  check('B4 不存在 → undefined（不臆造体积）', outputFileSizeText(path.join(tmpDir, 'nope.elf')) === undefined,
    outputFileSizeText(path.join(tmpDir, 'nope.elf')));
  check('B5 目录 → undefined', outputFileSizeText(tmpDir) === undefined, outputFileSizeText(tmpDir));
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

// ---------- C. dist 接线（静态断言） ----------
const engine = fs.readFileSync(path.resolve(__dirname, '../dist/build/buildEngine.js'), 'utf-8');
const reportCalls = (engine.match(/reportOutputFile\(/g) || []).length;
check('C1 buildEngine 调用 reportOutputFile 两处（链接 + 打包）', reportCalls === 3, reportCalls); // 1 处定义 + 2 处调用
check('C2 体积行文案走 logT（可双语）', engine.includes('Output file is {0} with size {1}'), null);
check('C3 链接成功调用（expandedOutputFilename + outputAbs）',
  /reportOutputFile\(this\.expandedOutputFilename\(target\), outputAbs\)/.test(engine), null);
check('C4 静态库打包成功调用（staticOut + staticOutAbs）',
  /reportOutputFile\(staticOut, staticOutAbs\)/.test(engine), null);
check('C5 体积行不受 plain 模式门控（CB 原文基线也要打印）',
  !/if \(!buildLogPrefs\(\)\.plain\) \{\s*this\.reportOutputFile\(/.test(engine), null);
check('C6 enhanced 摘要行保留（[Linked] / [Archived] 未回退）',
  engine.includes('[Linked]') && engine.includes('[Archived]'), null);

console.log(`\n输出文件体积行回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
