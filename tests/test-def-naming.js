// 验证第23轮 K1/K2：def 命名（静态替换/动态追加+大小写不敏感）+ import 库扩展名大小写不敏感
const { CommandGenerator } = require('../dist/compiler/commandGenerator.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');
const { TargetType } = require('../dist/model/types.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// 最小 project 夹具（CommandGenerator.init 仅遍历 buildTargets）
function makeProject(targets) {
  return {
    basePath: 'C:\\proj', filename: 'C:\\proj\\p.cbp', title: 'p',
    buildTargets: targets,
    compilerOptions: [], linkerOptions: [], linkLibs: [],
    includeDirs: [], libDirs: [], resIncludeDirs: [], resourceIncludeDirs: [], resourceCompilerOptions: [],
    customVariables: {}, extendedObjNames: false, pchMode: 1,
    commandsBeforeBuild: [], commandsAfterBuild: [], buildScripts: [], envVars: [],
    alwaysRunPostBuildSteps: false, platforms: 0xff, compilerId: 'gcc',
    virtualTargets: [], files: [], makefileIsCustom: false, executionDir: '', commonTopLevelPath: '',
  };
}
function makeTarget(over) {
  return {
    title: 'Debug', targetType: TargetType.StaticLib, compilerId: 'gcc',
    outputFilename: 'bin/Debug/libfoo.a', objectOutput: 'obj/Debug/', depsOutput: '.deps',
    compilerOptions: [], linkerOptions: [], linkLibs: [],
    includeDirs: [], libDirs: [], resIncludeDirs: [], resourceIncludeDirs: [], resourceCompilerOptions: [],
    optionRelations: [], prefixAuto: true, extensionAuto: true,
    impLib: '', defFile: '', createDefFile: true, createStaticLib: true,
    files: [], platforms: 0xff, includeInTargetAll: true, linkerExecutable: 0,
    commandsBeforeBuild: [], commandsAfterBuild: [], buildScripts: [], envVars: [],
    alwaysRunPostBuildSteps: false, useConsoleRunner: true, externalDeps: [], additionalOutput: [],
    executionParameters: '', executionWorkingDir: '', hostApplication: '', runHostInTerminal: false,
    ...over,
  };
}

const compiler = createGccCompiler('win32');

// K1-a：静态库 def——前缀随策略、扩展恒替换（extension_auto=false 仍为 .def）
const t1 = makeTarget({ targetType: TargetType.StaticLib, outputFilename: 'bin/Debug/libfoo.a', extensionAuto: false });
const g1 = new CommandGenerator(makeProject([t1]), compiler);
// setupDefOutput 为私有方法；通过 renderTemplate 步骤 8 的 $def_output 间接验证
const cmd1 = g1.generateFromTemplate('$def_output', { target: t1, pf: null, file: '', object: '', flatObject: '', deps: '' });
// 静态 lib 模板 $def_output 在 target.createDefFile 时替换（cache.defOutput）
// 直接检查 cache 产物：重新构造模板令 renderTemplate 输出 def
const tpl = { command: '$lib_linker -r -s $static_output $def_output', extensions: [], generatedFiles: [] };
compiler.commands[6] = [tpl];
const g1b = new CommandGenerator(makeProject([t1]), compiler);
const c1b = g1b.generateFromTemplate('$def_output', { target: t1, pf: null, file: '', object: '', flatObject: '', deps: '' });
check('静态 def 恒替换 .def（extension_auto=false）', c1b === 'bin\\Debug\\libfoo.def' || c1b === 'bin/Debug/libfoo.def', c1b, 'libfoo.def');

// K1-b/L1：动态默认 def 基础名 = 输出去扩展名 → libfoo.def（不再 libfoo.dll.def）
const t2 = makeTarget({ targetType: TargetType.DynamicLib, outputFilename: 'bin/Debug/libfoo.dll', prefixAuto: true, extensionAuto: true });
const tpl2 = { command: '$linker -shared $def_output', extensions: [], generatedFiles: [] };
compiler.commands[5] = [tpl2];
const g2 = new CommandGenerator(makeProject([t2]), compiler);
const c2 = g2.generateFromTemplate('$def_output', { target: t2, pf: null, file: '', object: '', flatObject: '', deps: '' });
check('动态默认 def = 输出去扩展名 + .def', c2 === 'bin\\Debug\\libfoo.def' || c2 === 'bin/Debug/libfoo.def', c2, 'libfoo.def');

// K1-c：显式 def_file 含扩展名 → 追加 .def（保持 K1 动态分支语义）
const t5 = makeTarget({ targetType: TargetType.DynamicLib, outputFilename: 'bin/Debug/libfoo.dll', defFile: 'bin/Debug/libfoo.dll' });
const g5 = new CommandGenerator(makeProject([t5]), compiler);
const c5 = g5.generateFromTemplate('$def_output', { target: t5, pf: null, file: '', object: '', flatObject: '', deps: '' });
check('显式 def_file 追加 .def', c5 === 'bin\\Debug\\libfoo.dll.def' || c5 === 'bin/Debug/libfoo.dll.def', c5, 'libfoo.dll.def');

// L1：动态默认 import 库基础名 = 输出去扩展名 → libfoo.a（不再 libfoo.dll.a）
const t4 = makeTarget({ targetType: TargetType.DynamicLib, outputFilename: 'bin/Debug/libfoo.dll' });
const tpl4 = { command: '$linker -shared $static_output', extensions: [], generatedFiles: [] };
compiler.commands[5] = [tpl4];
const g4 = new CommandGenerator(makeProject([t4]), compiler);
const c4 = g4.generateFromTemplate('$static_output', { target: t4, pf: null, file: '', object: '', flatObject: '', deps: '' });
check('动态默认 import = libfoo.a', c4 === 'bin\\Debug\\libfoo.a' || c4 === 'bin/Debug/libfoo.a', c4, 'libfoo.a');

// K2：显式 imp_lib 含大写扩展 .A → 大小写不敏感不追加 .a
const t3 = makeTarget({ targetType: TargetType.DynamicLib, outputFilename: 'bin/Debug/libfoo.dll', impLib: 'bin/Debug/libfoo.A' });
const tpl3 = { command: '$linker -shared $static_output', extensions: [], generatedFiles: [] };
compiler.commands[5] = [tpl3];
const g3 = new CommandGenerator(makeProject([t3]), compiler);
const c3 = g3.generateFromTemplate('$static_output', { target: t3, pf: null, file: '', object: '', flatObject: '', deps: '' });
check('显式 imp_lib .A 大小写不敏感不追加', c3 === 'bin\\Debug\\libfoo.A' || c3 === 'bin/Debug/libfoo.A', c3, 'libfoo.A');

console.log(`def 命名 + import 库扩展名: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
