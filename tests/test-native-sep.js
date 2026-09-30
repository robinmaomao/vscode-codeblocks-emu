// 验证 $file 分隔符修复：构建命令用平台原生反斜杠，clangd（nativeSep:false）保持正斜杠
const { createGccCompiler } = require('../dist/compiler/compiler');
const { CommandGenerator } = require('../dist/compiler/commandGenerator');
const { CommandType } = require('../dist/model/types');

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

const file = 'E:/Work_Share/VSCode Workstation/src/main.c';
const base = {
  target: null,
  pf: { compilerVar: 'CC' },
  file,
  object: 'obj/main.o',
  flatObject: 'obj/main.o',
  deps: '',
  hasCppFilesToLink: false,
};

let failed = false;
const check = (name, cond) => {
  if (!cond) { failed = true; console.log(`FAIL ${name}`); }
  else console.log(`PASS ${name}`);
};

const build = gen.generate(CommandType.CompileObjectCmd, { ...base });
const clangd = gen.generate(CommandType.CompileObjectCmd, { ...base, nativeSep: false });

check('构建命令 $file 为反斜杠', build.includes('E:\\Work_Share\\VSCode Workstation\\src\\main.c'));
check('构建命令不含正斜杠文件路径', !build.includes('E:/Work_Share/VSCode Workstation/src/main.c'));
check('clangd 命令 $file 保持正斜杠', clangd.includes('E:/Work_Share/VSCode Workstation/src/main.c'));
check('clangd 命令不含反斜杠文件路径', !clangd.includes('E:\\Work_Share\\VSCode Workstation\\src\\main.c'));

console.log('--- build ---');
console.log(build);
console.log('--- clangd ---');
console.log(clangd);

process.exit(failed ? 1 : 0);
