// L7 回归：汇编文件编译器选择开关 codeblocks.build.asmUsesCompilerVar（默认 false=强制 C；true=按 compilerVar 对齐 CB）
// 每调用读设置（无缓存），同一进程内可切换
const Module = require('module');
const origLoad = Module._load;
const cfgMap = {};
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k in cfgMap ? cfgMap[k] : d) }) },
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

function asmCommands() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l7-'));
  fs.writeFileSync(path.join(dir, 'l7.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l7" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="foo.s" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  const p = new ProjectParser().parse(path.join(dir, 'l7.cbp'));
  const engine = new BuildEngine(p, createGccCompiler('win32'), out, (id) => (id === 'gcc' ? createGccCompiler('win32') : undefined));
  const t = engine.collectMakefileData('Debug')[0];
  fs.rmSync(dir, { recursive: true, force: true });
  return { compile: t.compile[0].command, link: t.link ? t.link.command : '' };
}

// 默认 false：编译强制 C 编译器
{
  delete cfgMap['build.asmUsesCompilerVar'];
  const r = asmCommands();
  check('默认: foo.s 编译用 gcc.exe', r.compile.startsWith('gcc.exe'), r.compile);
}

// true：按 compilerVar（.s 默认 CPP）→ g++
{
  cfgMap['build.asmUsesCompilerVar'] = true;
  const r = asmCommands();
  check('asmUsesCompilerVar=true: foo.s 编译用 g++.exe（对齐 CB）', r.compile.startsWith('g++.exe'), r.compile);
  delete cfgMap['build.asmUsesCompilerVar'];
}

console.log(`asm-compiler-var: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
