// 验证第十二轮 W1：输出文件名应用 FixPathSeparators（forceFwdSlashes 时 \\ → /）
const { CommandGenerator } = require('../dist/compiler/commandGenerator');
const { getDefaultSwitches } = require('../dist/compiler/compiler');
const { CommandType, TargetType, OptionsRelation, OptionsRelationType } = require('../dist/model/types');

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

function makeCompiler(forceFwdSlashes) {
  const c = {
    id: 'gcc', name: 'GCC', masterPath: '',
    programs: { C: 'gcc', CPP: 'g++', LD: 'g++', LIB: 'ar', WINDRES: 'windres', MAKE: 'make', DBGconfig: 'gdb' },
    switches: { ...getDefaultSwitches(), forceFwdSlashes },
    commands: [], options: [], regexes: [], cOnlyFlags: [], cppOnlyFlags: [],
    includeDirs: [], libDirs: [], resIncludeDirs: [], linkLibs: [],
  };
  c.commands[CommandType.LinkConsoleExeCmd] = [{ command: '$linker $libdirs -o $exe_output $link_objects', extensions: [], generatedFiles: [] }];
  c.commands[CommandType.LinkStaticCmd] = [{ command: '$lib_linker -r -s $static_output $link_objects', extensions: [], generatedFiles: [] }];
  c.commands[CommandType.LinkDynamicCmd] = [{ command: '$linker $def_output $static_output', extensions: [], generatedFiles: [] }];
  return c;
}

function makeTarget(type, output, extra) {
  return {
    title: 'Debug', targetType: type, compilerId: 'gcc',
    outputFilename: output, objectOutput: 'obj\\Debug\\',
    optionRelations: relations, compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
    includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
    files: [], linkerExecutable: 0, createDefFile: extra?.createDefFile ?? false, createStaticLib: true,
    impLib: extra?.impLib ?? '', defFile: extra?.defFile ?? '', prefixAuto: true, extensionAuto: true,
    useConsoleRunner: true, includeInTargetAll: true, platforms: 0xff,
    commandsBeforeBuild: [], commandsAfterBuild: [], commandsBeforeClean: [], commandsAfterClean: [],
    buildScripts: [], envVars: [], alwaysRunPostBuildSteps: false, externalDeps: [], additionalOutput: [],
  };
}

function generate(forceFwdSlashes, type, output, ct, extra) {
  const target = makeTarget(type, output, extra);
  const project = {
    title: 'p', basePath: 'C:\\p', commonTopLevelPath: 'C:\\p',
    filename: 'C:\\p\\p.cbp', compilerId: 'gcc',
    compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
    includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
    virtualTargets: [], virtualFolders: [], commandsBeforeBuild: [], commandsAfterBuild: [],
    buildScripts: [], notes: '', showNotesOnLoad: false, envVars: [], alwaysRunPostBuildSteps: false,
    customVariables: {}, files: [], buildTargets: [target], extendedObjNames: false, pchMode: 1,
  };
  const gen = new CommandGenerator(project, makeCompiler(forceFwdSlashes));
  return gen.generate(ct, {
    target, pf: null, file: '',
    object: 'obj\\Debug\\a.o', flatObject: 'obj\\Debug\\a.o', deps: '',
    hasCppFilesToLink: false,
  });
}

// 1. forceFwdSlashes=true：$exe_output 转正斜杠
const c1 = generate(true, TargetType.ConsoleOnly, 'bin\\Debug\\app', CommandType.LinkConsoleExeCmd);
check('fwd exe_output', c1.includes('-o bin/Debug/app'), c1);
// 2. forceFwdSlashes=false：保持反斜杠
const c2 = generate(false, TargetType.ConsoleOnly, 'bin\\Debug\\app', CommandType.LinkConsoleExeCmd);
check('native exe_output', c2.includes('-o bin\\Debug\\app'), c2);
// 3. forceFwdSlashes=true：$static_output 正斜杠 + lib 前缀
const c3 = generate(true, TargetType.StaticLib, 'bin\\Debug\\app', CommandType.LinkStaticCmd);
check('fwd static_output', c3.includes('bin/Debug/libapp.a'), c3);
// 4. forceFwdSlashes=true：$def_output 正斜杠
const c4 = generate(true, TargetType.DynamicLib, 'bin\\Debug\\app', CommandType.LinkDynamicCmd, { createDefFile: true, defFile: 'bin\\Debug\\app' });
check('fwd def_output', c4.includes('bin/Debug/libapp.def'), c4);

console.log(`test-force-fwd-output: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
