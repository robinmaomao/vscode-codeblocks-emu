// 验证盘符归一化（方案 A）：构建命令 $file 盘符大写 + 反斜杠，clangd 保持小写正斜杠
const { upperDrive } = require('../dist/tools/pathCase');
const { createGccCompiler } = require('../dist/compiler/compiler');
const { CommandGenerator } = require('../dist/compiler/commandGenerator');
const { CommandType } = require('../dist/model/types');

let failed = false;
const check = (name, cond) => {
  if (!cond) { failed = true; console.log(`FAIL ${name}`); }
  else console.log(`PASS ${name}`);
};

// 1. upperDrive 单元行为
check('小写盘符转大写', upperDrive('d:/Work_Share/x.c') === 'D:/Work_Share/x.c');
check('反斜杠小写盘符转大写', upperDrive('d:\\Work_Share\\x.c') === 'D:\\Work_Share\\x.c');
check('大写盘符不变', upperDrive('D:/x') === 'D:/x');
check('相对路径不变', upperDrive('relative/path') === 'relative/path');
check('UNC 路径不变', upperDrive('\\\\server\\share\\x') === '\\\\server\\share\\x');
check('空串不变', upperDrive('') === '');

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
