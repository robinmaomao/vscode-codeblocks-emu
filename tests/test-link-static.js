// 验证方案 B：静态库归档对齐 LinkStatic 模板（$TO_WINDOWS_PATH 宏 + 多行命令 + $lib_linker 引号）
const { CommandGenerator } = require('../dist/compiler/commandGenerator');
const { getDefaultSwitches } = require('../dist/compiler/compiler');
const { CommandType, TargetType, OptionsRelation, OptionsRelationType } = require('../dist/model/types');

let failed = false;
const check = (name, cond) => {
  if (!cond) { failed = true; console.log(`FAIL ${name}`); }
  else console.log(`PASS ${name}`);
};

// 构造含空格工具链路径的 mock 编译器，LinkStatic 模板用 gcc 的完整两行模板
const compiler = {
  id: 'gcc', name: 'GNU GCC', masterPath: '',
  programs: {
    C: 'C:\\Program Files (x86)\\RV32\\riscv32-elf-gcc.exe',
    CPP: 'C:\\Program Files (x86)\\RV32\\riscv32-elf-g++.exe',
    LD: 'C:\\Program Files (x86)\\RV32\\riscv32-elf-g++.exe',
    LIB: 'C:\\Program Files (x86)\\RV32\\riscv32-elf-ar.exe',
    WINDRES: 'windres.exe', MAKE: 'make', DBGconfig: 'gdb_debugger:Default',
  },
  switches: getDefaultSwitches(),
  commands: [],
  options: [], regexes: [], cOnlyFlags: [], cppOnlyFlags: [],
};
compiler.commands[CommandType.LinkStaticCmd] = [{
  command: 'cmd /c if exist $static_output del $TO_WINDOWS_PATH{$static_output}\n$lib_linker -r -s $static_output $link_objects',
  extensions: [], generatedFiles: [],
}];

const relations = {
  [OptionsRelationType.CompilerOptions]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.LinkerOptions]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.IncludeDirs]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.LibDirs]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.ResDirs]: OptionsRelation.AppendToParentOptions,
};

const target = {
  title: 'Debug', targetType: TargetType.StaticLib, compilerId: 'gcc',
  outputFilename: 'lib/libfoo.a', objectOutput: 'obj/Debug/',
  optionRelations: relations,
  compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
  includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
  files: [], linkerExecutable: 0, createDefFile: false, createStaticLib: false,
  useConsoleRunner: true, includeInTargetAll: true,
  commandsBeforeBuild: [], commandsAfterBuild: [], commandsBeforeClean: [], commandsAfterClean: [],
  buildScripts: [], envVars: [], alwaysRunPostBuildSteps: false,
};

const project = {
  title: 'demo', basePath: 'C:\\demo', commonTopLevelPath: 'C:\\demo',
  filename: 'C:\\demo\\demo.cbp', compilerId: 'gcc',
  compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
  includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
  buildTargets: [target], virtualTargets: [], virtualFolders: [],
  commandsBeforeBuild: [], commandsAfterBuild: [], buildScripts: [],
  notes: '', showNotesOnLoad: false, envVars: [], alwaysRunPostBuildSteps: false,
  files: [], extensions: null,
};

const gen = new CommandGenerator(project, compiler);
const cmd = gen.generate(CommandType.LinkStaticCmd, {
  target, pf: null, file: '',
  object: 'obj\\Debug\\a.o obj\\Debug\\b.o',
  flatObject: 'obj\\Debug\\a.o obj\\Debug\\b.o',
  deps: '', hasCppFilesToLink: false,
});

console.log('--- 生成的 LinkStatic 命令 ---');
console.log(JSON.stringify(cmd));

check('命令生成成功', cmd.length > 0);
check('$lib_linker 含空格路径已加引号', cmd.includes('"C:\\Program Files (x86)\\RV32\\riscv32-elf-ar.exe"'));
check('含多行（\\n 拆分）', cmd.includes('\n'));
const lines = cmd.split('\n').map((s) => s.trim()).filter(Boolean);
check('拆分为 2 条命令', lines.length === 2);
check('第一行为 cmd /c if exist del', lines[0].startsWith('cmd /c if exist'));
check('$TO_WINDOWS_PATH 已展开（无残留宏）', !cmd.includes('$TO_WINDOWS_PATH') && !cmd.includes('$static_output') && !cmd.includes('$link_objects'));
check('第二行以 ar 路径开头', lines[1].startsWith('"C:\\Program Files (x86)\\RV32\\riscv32-elf-ar.exe"'));
check('第二行含对象列表', lines[1].includes('obj\\Debug\\a.o obj\\Debug\\b.o'));

// $TO_WINDOWS_PATH 把 $static_output（lib/libfoo.a）转成反斜杠（第一行 del 后）
check('$TO_WINDOWS_PATH 转反斜杠', lines[0].includes('lib\\libfoo.a'));

process.exit(failed ? 1 : 0);
