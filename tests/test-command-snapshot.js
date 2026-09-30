// 命令快照（golden）回归：hello-cb.cbp 的 Debug/Release 编译/链接命令逐字节比对
// 期望值 = CB 25.03 源码推导 + 实测定格（docs/第四轮编译链接对齐核查报告.md 附录 A）
// 任何宏顺序/分隔符/引号/空格数量回归立即暴露。
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

const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { BuildEngine } = require('../dist/build/buildEngine.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '\n  got =' + JSON.stringify(got) + '\n  want=' + JSON.stringify(want)); }
}

const p = new ProjectParser().parse(path.join(process.cwd(), 'test-project', 'hello-cb.cbp'));
const c = createGccCompiler('win32');
const out = { info(){}, warn(){}, error(){}, debug(){}, append(){}, clear(){}, show(){}, hide(){}, dispose(){} };
const engine = new BuildEngine(p, c, out, (id) => (id === 'gcc' ? c : undefined));

const golden = {
  'Debug compile main.c': 'gcc.exe -g -Wall  -c "E:\\Work_Share\\VSCode Workstation\\codeblocks-power-by-vscode\\test-project\\main.c" -o obj\\Debug\\main.o',
  'Debug compile util.c': 'gcc.exe -g -Wall  -c "E:\\Work_Share\\VSCode Workstation\\codeblocks-power-by-vscode\\test-project\\util.c" -o obj\\Debug\\util.o',
  'Debug link': 'gcc.exe  -o bin\\Debug\\hello obj\\Debug\\main.o obj\\Debug\\util.o   ',
  'Release compile main.c': 'gcc.exe -O2  -c "E:\\Work_Share\\VSCode Workstation\\codeblocks-power-by-vscode\\test-project\\main.c" -o obj\\Release\\main.o',
  'Release compile util.c': 'gcc.exe -O2  -c "E:\\Work_Share\\VSCode Workstation\\codeblocks-power-by-vscode\\test-project\\util.c" -o obj\\Release\\util.o',
  'Release link': 'gcc.exe  -o bin\\Release\\hello obj\\Release\\main.o obj\\Release\\util.o   ',
};

for (const t of ['Debug', 'Release']) {
  const d = engine.collectMakefileData(t)[0];
  check(`${t} 编译单元数 = 2`, d.compile.length === 2, d.compile.length);
  for (const x of d.compile) {
    const base = path.basename(x.source);
    const key = `${t} compile ${base}`;
    check(key, golden[key] !== undefined && x.command === golden[key], x.command, golden[key]);
  }
  check(`${t} link`, !!d.link && d.link.command === golden[`${t} link`], d.link && d.link.command, golden[`${t} link`]);
}

console.log(`command-snapshot: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
