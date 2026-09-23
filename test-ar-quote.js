// 验证方案 A：ar 命令对含空格工具链路径加引号
const { quoteIfNeeded } = require('./dist/compiler/commandGenerator');

const lib = 'C:\\Program Files (x86)\\RV32-Toolchain\\RV32-V2\\bin\\riscv32-elf-ar.exe';
const staticOut = 'bin\\Debug\\libfoo.a';
const objects = ['obj\\Debug\\main.o', 'obj\\Debug\\util.o'];

// 复刻 buildEngine 的 ar 命令拼接
const arCmd = `${quoteIfNeeded(lib)} -r -s ${quoteIfNeeded(staticOut)} ${objects.map((o) => quoteIfNeeded(o)).join(' ')}`;

let failed = false;
const check = (name, cond) => {
  if (!cond) { failed = true; console.log(`FAIL ${name}`); }
  else console.log(`PASS ${name}`);
};

check('LIB 含空格路径被加引号', quoteIfNeeded(lib) === `"${lib}"`);
check('staticOut 不含空格不加引号', quoteIfNeeded(staticOut) === staticOut);
check('objects 不含空格不加引号', objects.every((o) => quoteIfNeeded(o) === o));
check('arCmd 以带引号 LIB 开头', arCmd.startsWith(`"${lib}"`));
check('arCmd 含 -r -s', arCmd.includes(' -r -s '));

// 含空格的输出/对象路径也要加引号
const spacedOut = 'bin\\My Lib\\libfoo.a';
const spacedObj = 'obj\\My Obj\\main.o';
check('含空格 staticOut 加引号', quoteIfNeeded(spacedOut) === `"${spacedOut}"`);
check('含空格 object 加引号', quoteIfNeeded(spacedObj) === `"${spacedObj}"`);

console.log('--- arCmd ---');
console.log(arCmd);

process.exit(failed ? 1 : 0);
