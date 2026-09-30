// 验证第21轮 I1：flatObject 恒为扁平命名（对齐 pfd.object_file_flat），与 useFlatObjects 无关
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      window: { showWarningMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
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
const { CommandType } = require('../dist/model/types.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-itest-'));
const cbpPath = path.join(dir, 'itest.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="itest" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/Debug/" />
			</Target>
		</Build>
		<Unit filename="src/main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
compiler.switches.useFlatObjects = false;
// 模板里同时引用 $object 与 $link_flat_objects，验证两者路径不同
compiler.commands[CommandType.CompileObjectCmd] = [
  { command: '$compiler -c $file -o $object [flat=$link_flat_objects]', extensions: [], generatedFiles: [] },
];
const out = { info() {}, warn() {}, error() {}, debug() {}, append() {}, clear() {}, show() {}, hide() {}, dispose() {} };
const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));

// I1：useFlatObjects=false 时 $object 为层级路径、$link_flat_objects 为扁平路径
const entries = engine.collectCompileCommands();
check('collect 生成条目', entries.length === 1, entries.length, 1);
const cmd = entries[0]?.command ?? '';
const sep = process.platform === 'win32' ? '\\' : '/';
check('$object 层级路径', cmd.includes(`obj${sep}Debug${sep}src${sep}main.o`), cmd, 'obj/Debug/src/main.o');
check('$link_flat_objects 扁平路径', cmd.includes(`obj${sep}Debug${sep}main.o`), cmd, 'obj/Debug/main.o');
check('两宏路径不同', cmd.indexOf(`obj${sep}Debug${sep}src${sep}main.o`) !== cmd.indexOf(`obj${sep}Debug${sep}main.o`), cmd, 'distinct');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`flatObject 扁平传参: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
