// 验证第九轮 T1：C/C++ flag 过滤只移除首个匹配（对齐 CB aCflags.Index + RemoveAt）
const { CommandGenerator } = require('./dist/compiler/commandGenerator');
const { getDefaultSwitches } = require('./dist/compiler/compiler');
const { CommandType, TargetType, OptionsRelation, OptionsRelationType } = require('./dist/model/types');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const relations = {
  [OptionsRelationType.CompilerOptions]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.LinkerOptions]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.IncludeDirs]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.LibDirs]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.ResDirs]: OptionsRelation.AppendToParentOptions,
};

function makeCompiler(cOnly, cppOnly) {
  const c = {
    id: 'gcc', name: 'GCC', masterPath: '',
    programs: { C: 'gcc', CPP: 'g++', LD: 'g++', LIB: 'ar', WINDRES: 'windres', MAKE: 'make', DBGconfig: 'gdb' },
    switches: getDefaultSwitches(),
    commands: [], options: [], regexes: [], cOnlyFlags: cOnly, cppOnlyFlags: cppOnly,
    includeDirs: [], libDirs: [], resIncludeDirs: [], linkLibs: [],
  };
  c.commands[CommandType.CompileObjectCmd] = [{ command: '$compiler $options -c $file -o $object', extensions: [], generatedFiles: [] }];
  return c;
}

function generate(ext, compilerOptions, cOnly, cppOnly, targetOptions = []) {
  const target = {
    title: 'Debug', targetType: TargetType.ConsoleOnly, compilerId: 'gcc',
    outputFilename: 'bin/Debug/app', objectOutput: 'obj/Debug/',
    optionRelations: relations, compilerOptions: targetOptions, linkerOptions: [], resourceCompilerOptions: [],
    includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
    files: [], linkerExecutable: 0, createDefFile: false, createStaticLib: false,
    impLib: '', defFile: '', prefixAuto: true, extensionAuto: true,
    useConsoleRunner: true, includeInTargetAll: true, platforms: 0xff,
    commandsBeforeBuild: [], commandsAfterBuild: [], commandsBeforeClean: [], commandsAfterClean: [],
    buildScripts: [], envVars: [], alwaysRunPostBuildSteps: false, externalDeps: [], additionalOutput: [],
  };
  const project = {
    title: 'p', basePath: 'C:\\p', commonTopLevelPath: 'C:\\p',
    filename: 'C:\\p\\p.cbp', compilerId: 'gcc',
    compilerOptions, linkerOptions: [], resourceCompilerOptions: [],
    includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
    virtualTargets: [], virtualFolders: [], commandsBeforeBuild: [], commandsAfterBuild: [],
    buildScripts: [], notes: '', showNotesOnLoad: false, envVars: [], alwaysRunPostBuildSteps: false,
    customVariables: {}, files: [], buildTargets: [target], extendedObjNames: false, pchMode: 1,
  };
  const gen = new CommandGenerator(project, makeCompiler(cOnly, cppOnly));
  return gen.generate(CommandType.CompileObjectCmd, {
    target, pf: { compilerVar: '' },
    file: 'C:\\p\\main' + ext, object: 'obj\\Debug\\main.o', flatObject: 'obj\\Debug\\main.o', deps: '',
    hasCppFilesToLink: true,
  });
}

// 1. .cpp 编译剔除 cOnly flag：项目级+目标级重复出现 → 只移除第一个，剩一个
const cmd1 = generate('.cpp', ['-mno-x -g'], ['-mno-x'], [], ['-mno-x -g']);
const m1 = (cmd1.match(/-mno-x/g) || []).length;
check('first-match only', m1 === 1 && cmd1.includes('-g'), cmd1);
// 2. 单一出现 → 完全移除
const cmd2 = generate('.cpp', ['-mno-x'], ['-mno-x'], []);
check('single removed', !cmd2.includes('-mno-x'), cmd2);
// 3. 独立边界：剔除 -mno-x 时 -mno-xyz 保留
const cmd3 = generate('.cpp', ['-mno-xyz'], ['-mno-x'], []);
check('boundary', cmd3.includes('-mno-xyz'), cmd3);
// 4. 带引号 flag 不误删（引号内视为整体，不匹配独立边界）
const cmd4 = generate('.cpp', ['"-mno-x y"'], ['-mno-x'], []);
check('quoted kept', cmd4.includes('"-mno-x y"'), cmd4);
// 5. .c 编译剔除 cppOnly flag 首个匹配
const cmd5 = generate('.c', ['-fno-exceptions -fno-exceptions'], [], ['-fno-exceptions']);
const m5 = (cmd5.match(/-fno-exceptions/g) || []).length;
check('cppOnly first-match', m5 === 1, cmd5);

console.log(`test-flag-filter: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
