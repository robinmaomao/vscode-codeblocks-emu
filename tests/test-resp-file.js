// 验证响应文件机制：超长命令改用 @file，短命令不变，响应文件内 \ 转义为 \\
const { applyResponseFile } = require('../dist/build/commandLine');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = false;
const check = (name, cond) => {
  if (!cond) { failed = true; console.log(`FAIL ${name}`); }
  else console.log(`PASS ${name}`);
};

// 1. 短命令不变
const short = '"C:\\tool\\gcc.exe" -c main.c -o main.o';
const r1 = applyResponseFile(short);
check('短命令不被改动', r1.command === short && r1.respFile === undefined);

// 2. 构造超长链接命令（对象列表很长，含反斜杠路径）
const linker = '"C:\\Program Files (x86)\\RV32-Toolchain\\RV32-V2\\bin\\riscv32-elf-gcc.exe"';
const objs = [];
for (let i = 0; i < 400; i++) {
  objs.push(`Output\\obj\\sys\\module_${i}.o`);
}
const long = `${linker} -march=rv32imac -o Output\\bin\\app.rv32 ${objs.join(' ')}`;
check('构造的命令超长', long.length > 8000);

const r2 = applyResponseFile(long);
check('超长命令被缩短到阈值内', r2.command.length <= 8000);
check('命令末尾改为 @"..."', / @"[^"]+\.respFile"$/.test(r2.command));
check('保留了链接器路径前缀', r2.command.startsWith(linker));
check('生成了响应文件', r2.respFile && fs.existsSync(r2.respFile));

if (r2.respFile && fs.existsSync(r2.respFile)) {
  const content = fs.readFileSync(r2.respFile, 'utf-8');
  check('响应文件内容含对象', content.includes('module_399.o'));
  check('响应文件内 \\ 转义为 \\\\', content.includes('\\\\obj\\\\sys\\\\module_399.o'));
  // 命令 + 响应文件拼接后应能还原对象数量
  const cmdPart = r2.command.slice(0, r2.command.indexOf(' @"'));
  const respPart = content.replace(/\\\\/g, '\\');
  const merged = (cmdPart + ' ' + respPart);
  check('合并后对象数完整', (merged.match(/module_\d+\.o/g) || []).length === 400);
  fs.unlinkSync(r2.respFile);
}

console.log('--- 新命令（截断前 200 字符）---');
console.log(r2.command.slice(0, 200) + ' ...');

process.exit(failed ? 1 : 0);
