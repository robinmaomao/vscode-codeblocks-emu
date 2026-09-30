// L8 回归：hasCppFilesToLink 按 compilerVar（对齐 CB compilercommandgenerator.cpp:585 + directcommands.cpp:772/903）
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

const out = { info(){}, warn(){}, error(){}, debug(){}, append(){}, clear(){}, show(){}, hide(){}, dispose(){} };

function linkCommand(unitXml) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l8t-'));
  fs.writeFileSync(path.join(dir, 'l8.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l8" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
${unitXml}
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  const project = new ProjectParser().parse(path.join(dir, 'l8.cbp'));
  const compiler = createGccCompiler('win32');
  const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
  const data = engine.collectMakefileData('Debug')[0];
  fs.rmSync(dir, { recursive: true, force: true });
  return { compile: data.compile[0].command, link: data.link ? data.link.command : '' };
}

// (a) .c + 显式 compilerVar=CPP：CB ceCPP → hasCpp=true → g++.exe 链接
{
  const r = linkCommand('\t\t<Unit filename="one.c">\n\t\t\t<Option compilerVar="CPP" />\n\t\t</Unit>');
  check('(a) 编译用 g++.exe（compilerVar 驱动）', r.compile.startsWith('g++.exe'), r.compile);
  check('(a) 链接用 g++.exe（hasCpp 按 compilerVar）', r.link.startsWith('g++.exe'), r.link);
}

// (b) .cpp + 显式 compilerVar=CC：CB ceC → hasCpp=false → gcc.exe 链接
{
  const r = linkCommand('\t\t<Unit filename="two.cpp">\n\t\t\t<Option compilerVar="CC" />\n\t\t</Unit>');
  check('(b) 编译用 gcc.exe（compilerVar 驱动）', r.compile.startsWith('gcc.exe'), r.compile);
  check('(b) 链接用 gcc.exe（hasCpp 按 compilerVar）', r.link.startsWith('gcc.exe'), r.link);
}

// (c) 常规 .cpp 默认 CPP → g++；常规 .c 默认 CC → gcc（回归）
{
  const r = linkCommand('\t\t<Unit filename="three.cpp" />');
  check('(c) 默认 .cpp 链接 g++.exe', r.link.startsWith('g++.exe'), r.link);
}
{
  const r = linkCommand('\t\t<Unit filename="four.c" />');
  check('(c) 默认 .c 链接 gcc.exe', r.link.startsWith('gcc.exe'), r.link);
}

console.log(`hascpp-compilervar: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
