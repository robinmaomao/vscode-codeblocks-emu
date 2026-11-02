// 命令行拆分回归（src/build/shellSplit.ts）：
//  A. 常规编译命令拆成 program + args（引号、空格、空参数）
//  B. 不安全的命令一律返回 undefined（交回 shell:true，行为零变化）
//  C. 引擎接线：编译/链接命令优先直接派生，且保留 shell 回退分支
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const { splitCommandLine } = require('../dist/build/shellSplit.js');

// ---------- A. 正常拆分 ----------
{
  const r = splitCommandLine('gcc -Os -c src\\main.c -o obj\\main.o');
  check('A1 普通命令：program = gcc', r && r.program === 'gcc', r);
  check('A2 普通命令：参数逐个还原', r && JSON.stringify(r.args) === JSON.stringify(['-Os', '-c', 'src\\main.c', '-o', 'obj\\main.o']), r && r.args);
}
{
  const r = splitCommandLine('"C:\\Program Files\\toolchain\\bin\\riscv32-elf-gcc.exe" -march=rv32imac -c "C:\\a b\\main.c"');
  check('A3 带空格的程序路径：引号被剥离', r && r.program === 'C:\\Program Files\\toolchain\\bin\\riscv32-elf-gcc.exe', r && r.program);
  check('A4 带空格的源文件路径：保持单个参数', r && r.args[2] === 'C:\\a b\\main.c', r && r.args);
}
{
  const r = splitCommandLine('gcc -DNAME="My App" -I"C:/sdk/include" -c x.c');
  check('A5 引号中断 token 时整段合为一个参数（-DNAME="My App" → -DNAME=My App，与 MSVCRT 一致）', r
    && JSON.stringify(r.args) === JSON.stringify(['-DNAME=My App', '-IC:/sdk/include', '-c', 'x.c']), r && r.args);
}
{
  const r = splitCommandLine('gcc "" -c x.c');
  check('A6 空引号保留为空参数', r && r.args[0] === '' && r.args[1] === '-c', r && r.args);
}
{
  const r = splitCommandLine('  gcc\t-c   x.c  ');
  check('A7 多空格/Tab 折叠，首尾空白忽略', r && JSON.stringify(r.args) === JSON.stringify(['-c', 'x.c']), r && r.args);
}

// ---------- B. 必须回退 shell 的形态 ----------
for (const [name, cmd] of [
  ['B1 管道 |', 'gcc -c x.c | tee log.txt'],
  ['B2 与 &&', 'gcc -c x.c && echo done'],
  ['B3 重定向 >', 'gcc -c x.c > out.txt'],
  ['B4 重定向 <', 'gcc -c x.c < in.txt'],
  ['B5 转义符 ^', 'gcc ^& echo'],
  ['B6 环境变量 %VAR%', 'gcc -I%SDK%\\inc -c x.c'],
  ['B7 反引号', 'gcc -I`pwd` -c x.c'],
  ['B8 延迟展开 !', 'gcc -DX=!A! -c x.c'],
  ['B9 未闭合引号', 'gcc -c "x.c'],
  ['B10 引号内转义引号', 'gcc -DX="a\\"b" -c x.c'],
  ['B11 cmd 自身（PCH del 等）', 'cmd /c if exist obj\\x.o del obj\\x.o'],
  ['B12 powershell', 'powershell -NoProfile -Command "echo 1"'],
  ['B13 空串', '   '],
  ['B15 cmd 内建 echo（自定义 buildCommand 常见）', 'echo lazy-gen-probe'],
  ['B16 cmd 内建 copy', 'copy /Y a.obj b.obj'],
  ['B17 @ 前缀（@echo off）', '@echo off'],
  ['B18 批处理包装器（.bat）', 'C:\\toolchain\\gcc.bat -c x.c'],
  ['B19 命令脚本（.cmd）', '"C:\\Program Files\\tk\\gcc.cmd" -c x.c'],
]) {
  check(name + ' → 回退 shell（undefined）', splitCommandLine(cmd) === undefined, splitCommandLine(cmd));
}
check('B14 引号内的元字符不算 shell（如 -DMSG="a && b" 仍可拆分）',
  (() => { const r = splitCommandLine('gcc -DMSG="a && b" -c x.c'); return !!r && r.args.length === 3; })(),
  splitCommandLine('gcc -DMSG="a && b" -c x.c'));
// `%VAR%` / `!VAR!` 即使位于引号内也会被 cmd 展开 → 必须回退，否则宏值在直接派生时不再展开
check('B20 引号内的 %VAR% 仍回退 shell（cmd 在引号内也展开）',
  splitCommandLine('gcc -DMSG="%CD%" -c x.c') === undefined, splitCommandLine('gcc -DMSG="%CD%" -c x.c'));
check('B21 引号内的 !VAR! 仍回退 shell（延迟展开）',
  splitCommandLine('gcc -DMSG="!X!" -c x.c') === undefined, splitCommandLine('gcc -DMSG="!X!" -c x.c'));

// 程序路径含正斜杠（部分工具链 force_fwd_slashes）→ Windows 上归一为反斜杠
{
  const r = splitCommandLine('C:/toolchain/bin/gcc.exe -c x.c');
  const want = process.platform === 'win32' ? 'C:\\toolchain\\bin\\gcc.exe' : 'C:/toolchain/bin/gcc.exe';
  check('B22 程序路径在 Windows 上统一反斜杠（CreateProcess 兼容）', r && r.program === want, r && r.program, want);
}

// ---------- C. 引擎接线（静态） ----------
const engineJs = fs.readFileSync(path.resolve(__dirname, '..', 'dist/build/buildEngine.js'), 'utf8');
check('C1 引擎调用 splitCommandLine', engineJs.includes('splitCommandLine'), null);
check('C2 保留 shell: true 回退分支', /shell:\s*true/.test(engineJs), null);
check('C3 直接派生分支使用 program + args', /\(direct\.program,\s*direct\.args/.test(engineJs), null);
check('C4 PCH 删除改宿主内 fs.rmSync（不再拼 cmd /c if exist … del …）',
  engineJs.includes('rmSync') && !engineJs.includes('if exist "${objectRel}" del'), null);
{
  // 编译产物形如 `process.platform === 'win32' ? (0, shellSplit_1.splitCommandLine)(command) : undefined`
  const callIdx = engineJs.indexOf('splitCommandLine)(');
  const gateIdx = callIdx >= 0 ? engineJs.lastIndexOf("process.platform === 'win32' ?", callIdx) : -1;
  check('C5 仅 Windows 启用直接派生（POSIX shell 的 ~ / 通配符 / $VAR 展开语义保持不变）',
    gateIdx >= 0 && callIdx > gateIdx && callIdx - gateIdx < 300, { gateIdx, callIdx });
}
check('C6 PCH 删除延迟到派发前（命令收集无副作用：pchGchPath 由 runSingleCommand 消费）',
  /pchGchPath/.test(engineJs) && /runSingleCommand\([^)]*pchGchPath/.test(engineJs), null);

console.log(`命令行拆分回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
