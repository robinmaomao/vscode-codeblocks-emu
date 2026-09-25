// 验证 G1：$libs 构造对齐 FixupLinkLibraries + SetupLinkLibraries（compilercommandgenerator.cpp:1055/1106）
// 直接驱动真实的 CommandGenerator.setupLinkLibraries（private 在 dist JS 中可运行时访问）
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CommandGenerator } = require('./dist/compiler/commandGenerator.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}

function mkCompiler(switches, extra) {
  return {
    id: 'tst', name: 'tst', masterPath: '',
    programs: { C: 'gcc', CPP: 'g++', LD: 'g++', LIB: 'ar', WINDRES: '', MAKE: '', DBGconfig: '' },
    switches: {
      includeDirs: '-I', libDirs: '-L', linkLibs: '-l', defines: '-D', genericSwitch: '-',
      objectExtension: 'o', forceFwdSlashes: false, forceLinkerUseQuotes: false, forceCompilerUseQuotes: false,
      needDependencies: true, libPrefix: 'lib', libExtension: 'a',
      linkerNeedsLibPrefix: false, linkerNeedsLibExtension: false, linkerNeedsPathResolved: false,
      supportsPCH: false, PCHExtension: '', useFlatObjects: false, useFullSourcePaths: true,
      use83Paths: false, includeDirSeparator: ' ', libDirSeparator: ' ', objectSeparator: ' ', statusSuccess: 0,
      ...switches,
    },
    commands: [], options: [], regexes: [], cOnlyFlags: [], cppOnlyFlags: [],
    includeDirs: [], libDirs: [], resIncludeDirs: [], linkLibs: extra?.linkLibs ?? [],
  };
}

function mkProject(target) {
  return {
    title: 't', basePath: 'C:/proj', commonTopLevelPath: 'C:/proj', pchMode: 1, extendedObjNames: false,
    filename: 'C:/proj/t.cbp', compilerId: 'tst',
    compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
    includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
    virtualTargets: [], virtualFolders: [], commandsBeforeBuild: [], commandsAfterBuild: [],
    buildScripts: [], notes: '', showNotesOnLoad: false, envVars: [], alwaysRunPostBuildSteps: false,
    customVariables: {}, files: [], buildTargets: [target],
  };
}

function mkTarget(libDirs = [], linkLibs = []) {
  return {
    title: 'Debug', targetType: 1, compilerId: 'tst', outputFilename: 'bin/Debug/app', objectOutput: 'obj/Debug/',
    depsOutput: '', executionParameters: '', externalDeps: [], additionalOutput: [],
    optionRelations: { 0: 3, 1: 3, 2: 3, 3: 3, 4: 3 },
    compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
    includeDirs: [], libDirs, resourceIncludeDirs: [], linkLibs,
    files: [], linkerExecutable: 0, createDefFile: false, createStaticLib: false,
    impLib: '', defFile: '', useConsoleRunner: true, includeInTargetAll: true,
    commandsBeforeBuild: [], commandsAfterBuild: [], commandsBeforeClean: [], commandsAfterClean: [],
    buildScripts: [], envVars: [], alwaysRunPostBuildSteps: false,
  };
}

function buildLibs(linkLibs, switches, extra, libDirs = []) {
  const t = mkTarget(libDirs, linkLibs);
  const gen = new CommandGenerator(mkProject(t), mkCompiler(switches, extra));
  return gen.setupLinkLibraries(t);
}

// 1. 默认开关（gcc）：无路径库剥 lib 前缀 + 剥扩展
check('裸名库 → -lfoo', buildLibs(['foo']) === '-lfoo');
// 2. libfoo.a → 剥前缀后剥扩展 → -lfoo
check('libfoo.a → -lfoo', buildLibs(['libfoo.a']) === '-lfoo');
// 3. foo.a（无 lib 前缀）→ hadLibPrefix=false → 保留扩展 → -lfoo.a
check('foo.a 保留扩展 → -lfoo.a', buildLibs(['foo.a']) === '-lfoo.a');
// 4. 带路径库原样保留（不加 -l、不处理）
check('带路径库原样保留', buildLibs(['subdir/libfoo.a']) === 'subdir/libfoo.a');
// 5. 含空格库名：与 CB NeedQuotes 行为一致（首字符非引号且含空格 → 外层再加引号）
check('含空格库名引号行为对齐 CB', buildLibs(['a b']) === '"-l"a b""');
// 6. 编译器全局链接库追加（SetupLinkLibraries compiler->GetLinkLibs()）
{
  const t = mkTarget([], ['libfoo.a']);
  const gen = new CommandGenerator(mkProject(t), mkCompiler({}, { linkLibs: ['plat'] }));
  check('编译器全局库追加', gen.setupLinkLibraries(t) === '-lfoo -lplat');
}
// 7. 多库用 objectSeparator 连接且顺序保持
check('多库顺序与分隔', buildLibs(['libfoo.a', 'bar']) === '-lfoo -lbar');
// 8. linkerNeedsLibPrefix=true：不剥前缀（libfoo.a → -llibfoo.a）
check('needsLibPrefix 不剥前缀', buildLibs(['libfoo.a'], { linkerNeedsLibPrefix: true }) === '-llibfoo.a');
// 9. linkerNeedsLibExtension=true：补扩展（foo → -lfoo.a）
check('needsLibExtension 补扩展', buildLibs(['foo'], { linkerNeedsLibExtension: true }) === '-lfoo.a');
// 10. linkerNeedsPathResolved：库目录中存在的库解析为全路径
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-libs-'));
  fs.writeFileSync(path.join(dir, 'libplat.a'), '');
  // 保留全名（needsPrefix+needsExtension）以便按文件名解析
  const out = buildLibs(['libplat.a'], { linkerNeedsLibPrefix: true, linkerNeedsLibExtension: true, linkerNeedsPathResolved: true }, {}, [dir]);
  check('needsPathResolved 解析全路径', out === path.join(dir, 'libplat.a'));
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('汇总: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
