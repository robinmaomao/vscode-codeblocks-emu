// 验证第十三轮 X1：每目标编译器切换 —— 对齐 directcommands.cpp 各处
// CompilerFactory::GetCompiler(target->GetCompilerID())（593/634/722/965/1011/1167）
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {},
      window: {},
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      ConfigurationTarget: { Global: 1 },
      LogOutputChannel: class {},
      workspaceState: {},
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser');
const { BuildEngine } = require('../dist/build/buildEngine');
const { createGccCompiler } = require('../dist/compiler/compiler');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="mixed" />
		<Option compiler="ccA" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="ccA" />
			</Target>
			<Target title="Release">
				<Option output="bin/Release/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="ccB" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-mixed-compiler.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const project = new ProjectParser().parse(tmp);
fs.unlinkSync(tmp);

const out = { info() {}, warn() {}, error() {}, debug() {}, append() {}, clear() {}, show() {}, hide() {}, dispose() {} };
const mk = (id, prog) => {
  const c = createGccCompiler('win32');
  c.id = id;
  c.name = 'CC-' + id;
  c.programs.C = prog;
  c.programs.CPP = prog;
  return c;
};
const comps = { ccA: mk('ccA', 'gccA.exe'), ccB: mk('ccB', 'gccB.exe') };

const engine = new BuildEngine(project, comps.ccA, out, (id) => comps[id]);
const entries = engine.collectCompileCommands();

check('目标数', entries.length === 2, entries.length, 2);
// Debug 用 ccA → gccA.exe；Release 用 ccB → gccB.exe（$compiler 按目标编译器展开）
check('Debug 目标使用 gccA', entries.length >= 1 && entries[0].command.includes('gccA.exe'), entries[0] && entries[0].command, 'gccA.exe');
check('Release 目标使用 gccB', entries.length >= 2 && entries[1].command.includes('gccB.exe'), entries[1] && entries[1].command, 'gccB.exe');
// 遍历结束后引擎内部编译器停在最后目标（证明 switchCompiler 生效）
check('引擎已切换到最后目标编译器', engine.compiler.id === 'ccB', engine.compiler.id, 'ccB');

// 未注册编译器 id → resolver 返回 undefined → 保持当前编译器（不崩溃）
const engine2 = new BuildEngine(project, comps.ccA, out, (id) => (id === 'ccA' ? comps.ccA : undefined));
engine2.collectCompileCommands();
check('未注册编译器 id 不崩溃', engine2.compiler.id === 'ccA', engine2.compiler.id, 'ccA');

console.log(`混合编译器: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
