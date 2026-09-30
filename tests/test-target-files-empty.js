// L6 回归：target.files 为空不回退 project.files（对齐 GetProjectFilesSortedByWeight）
// 纯数据断言（collectMakefileData，不执行编译）
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      window: { showWarningMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      Position: class { constructor(l, c) { this.line = l; this.character = c; } },
      Range: class { constructor(a, b) { this.start = a; this.end = b; } },
      Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      ConfigurationTarget: { Global: 1 },
      LogOutputChannel: class {},
      workspaceState: {},
      debug: { activeDebugSession: undefined },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { BuildEngine } = require('../dist/build/buildEngine.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l6t-'));
const cbpPath = path.join(dir, 'l6.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l6" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t\t<Target title="Release">
\t\t\t\t<Option output="bin/Release/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Release/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c">
\t\t\t<Option target="Debug" />
\t\t</Unit>
\t\t<Unit filename="util.c">
\t\t\t<Option target="Debug" />
\t\t</Unit>
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
const out = { info(){}, warn(){}, error(){}, debug(){}, append(){}, clear(){}, show(){}, hide(){}, dispose(){} };
const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));

// 空目标：0 编译 + 无链接（CB：Linking stage skipped）
const release = engine.collectMakefileData('Release');
check('空目标 Release：0 编译单元', release.length === 1 && release[0].compile.length === 0, release);
check('空目标 Release：无链接', release[0].link === undefined, release[0].link);

// 归属目标：正常 2 编译 + 链接
const debug = engine.collectMakefileData('Debug');
check('Debug：2 编译单元', debug.length === 1 && debug[0].compile.length === 2, debug.map((d) => d.compile.length));
check('Debug：链接存在', !!debug[0].link && debug[0].link.objects.length === 2, debug[0].link);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`target-files-empty: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
