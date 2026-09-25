// 验证静态库输出名是否带 lib 前缀（对齐 Code::Blocks SetupStaticOutput）
const { CommandGenerator } = require('../dist/compiler/commandGenerator');
const { getDefaultSwitches } = require('../dist/compiler/compiler');
const { CommandType, TargetType, OptionsRelation, OptionsRelationType } = require('../dist/model/types');

const relations = {
  [OptionsRelationType.CompilerOptions]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.LinkerOptions]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.IncludeDirs]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.LibDirs]: OptionsRelation.AppendToParentOptions,
  [OptionsRelationType.ResDirs]: OptionsRelation.AppendToParentOptions,
};

function makeTarget(outputFilename) {
  return {
    title: 'Debug', targetType: TargetType.StaticLib, compilerId: 'gcc',
    outputFilename, objectOutput: 'obj/Debug/',
    optionRelations: relations,
    compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
    includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
    files: [], linkerExecutable: 0, createDefFile: false, createStaticLib: false,
    useConsoleRunner: true, includeInTargetAll: true,
    commandsBeforeBuild: [], commandsAfterBuild: [], commandsBeforeClean: [], commandsAfterClean: [],
    buildScripts: [], envVars: [], alwaysRunPostBuildSteps: false,
  };
}

function makeCompiler() {
  const c = {
    id: 'gcc', name: 'GCC', masterPath: '',
    programs: { C: 'gcc', CPP: 'g++', LD: 'g++', LIB: 'ar', WINDRES: 'windres', MAKE: 'make', DBGconfig: 'gdb' },
    switches: getDefaultSwitches(),
    commands: [], options: [], regexes: [], cOnlyFlags: [], cppOnlyFlags: [],
  };
  c.commands[CommandType.LinkStaticCmd] = [{ command: '$lib_linker -r -s $static_output $link_objects', extensions: [], generatedFiles: [] }];
  return c;
}

function generate(outputFilename) {
  const target = makeTarget(outputFilename);
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
  const gen = new CommandGenerator(project, makeCompiler());
  return gen.generate(CommandType.LinkStaticCmd, {
    target, pf: null, file: '',
    object: 'obj\\Debug\\a.o', flatObject: 'obj\\Debug\\a.o', deps: '', hasCppFilesToLink: false,
  });
}

console.log('--- outputFilename=bin/Debug/demo（无 lib 前缀） ---');
const cmd1 = generate('bin/Debug/demo');
console.log(cmd1);
console.log('含 libdemo.a ?', cmd1.includes('libdemo.a'), '| 含 demo.a ?', cmd1.includes('demo.a'));

console.log('--- outputFilename=bin/Debug/libdemo.a（已有 lib 前缀） ---');
const cmd2 = generate('bin/Debug/libdemo.a');
console.log(cmd2);

console.log('--- outputFilename=bin/Debug/demo.a（有扩展无 lib 前缀） ---');
const cmd3 = generate('bin/Debug/demo.a');
console.log(cmd3);
