// 验证盘符归一化（方案 A）：构建命令 $file 盘符大写 + 反斜杠，clangd 保持小写正斜杠
const { upperDrive, shortPathWin } = require('../dist/tools/pathCase');
const { createGccCompiler } = require('../dist/compiler/compiler');
const { CommandGenerator } = require('../dist/compiler/commandGenerator');
const { CommandType } = require('../dist/model/types');
const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = false;
const check = (name, cond, extra) => {
  if (!cond) { failed = true; console.log(`FAIL ${name}${extra !== undefined ? '  got=' + JSON.stringify(extra) : ''}`); }
  else console.log(`PASS ${name}`);
};

// 1. upperDrive 单元行为
check('小写盘符转大写', upperDrive('d:/Work_Share/x.c') === 'D:/Work_Share/x.c');
check('反斜杠小写盘符转大写', upperDrive('d:\\Work_Share\\x.c') === 'D:\\Work_Share\\x.c');
check('大写盘符不变', upperDrive('D:/x') === 'D:/x');
check('相对路径不变', upperDrive('relative/path') === 'relative/path');
check('UNC 路径不变', upperDrive('\\\\server\\share\\x') === '\\\\server\\share\\x');
check('空串不变', upperDrive('') === '');

// 1b. shortPathWin：cmd /u + windowsVerbatimArguments 回归（含空格 / CJK / 特殊字符）
// 回归点：Node 默认引号会让 `for %I ...` 输出 `E:\"C:\...\"`；CI 非中文代码页还会把中文变成 `??`。
if (process.platform === 'win32') {
  const shortTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-short-path-'));
  const cjkDir = path.join(shortTmp, '中文 资源');
  fs.mkdirSync(cjkDir);
  const cjkFile = path.join(cjkDir, 'res.rc');
  fs.writeFileSync(cjkFile, '1');
  const shortCjk = shortPathWin(cjkFile);
  check('shortPathWin：中文+空格路径返回存在的绝对路径',
    /^[A-Za-z]:\\/.test(shortCjk) && fs.existsSync(shortCjk), shortCjk);
  check('shortPathWin：结果不含畸形引号/盘符拼接',
    !shortCjk.includes('\\"') && !/^[A-Za-z]:\\"/.test(shortCjk), shortCjk);
  check('shortPathWin：缓存稳定', shortPathWin(cjkFile) === shortCjk, shortCjk);
  const specialDir = path.join(shortTmp, 'a&b(c)');
  fs.mkdirSync(specialDir);
  const specialFile = path.join(specialDir, 'p%20x.rc');
  fs.writeFileSync(specialFile, '1');
  const shortSpecial = shortPathWin(specialFile);
  check('shortPathWin：特殊字符路径仍返回存在路径', fs.existsSync(shortSpecial), shortSpecial);
  fs.rmSync(shortTmp, { recursive: true, force: true });
} else {
  console.log('SKIP shortPathWin 回归（非 Windows）');
}

// 2. CommandGenerator：构建命令盘符大写 + 反斜杠
const compiler = createGccCompiler('win32');
const project = {
  buildTargets: [],
  includeDirs: [],
  libDirs: [],
  resourceIncludeDirs: [],
  compilerOptions: [],
  linkerOptions: [],
  linkLibs: [],
  basePath: '',
  title: 't',
  filename: '',
};
const gen = new CommandGenerator(project, compiler);

const file = 'd:/Work_Share/VSCode Workstation/src/main.c';
const base = {
  target: null,
  pf: { compilerVar: 'CC' },
  file,
  object: 'obj/main.o',
  flatObject: 'obj/main.o',
  deps: '',
  hasCppFilesToLink: false,
};

const build = gen.generate(CommandType.CompileObjectCmd, { ...base });
const clangd = gen.generate(CommandType.CompileObjectCmd, { ...base, nativeSep: false });

check('构建命令 $file 盘符大写 + 反斜杠', build.includes('D:\\Work_Share\\VSCode Workstation\\src\\main.c'));
check('构建命令不含小写盘符路径', !build.includes('d:/Work_Share/VSCode Workstation/src/main.c') && !build.includes('d:\\Work_Share'));
check('clangd 命令 $file 保持小写正斜杠', clangd.includes('d:/Work_Share/VSCode Workstation/src/main.c'));
check('clangd 命令不含大写盘符', !clangd.includes('D:\\Work_Share'));

console.log('--- build ---');
console.log(build);
console.log('--- clangd ---');
console.log(clangd);

process.exit(failed ? 1 : 0);
