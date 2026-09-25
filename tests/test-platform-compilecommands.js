// 验证第18轮 F2：collectCompileCommands 跳过平台不支持的目标（对齐 GenerateCommandLine:238）
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
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ftest-'));
const cbpPath = path.join(dir, 'ftest.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="ftest" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Win">
				<Option output="bin/Win/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option platforms="Windows" />
				<Option object_output="obj/Win/" />
			</Target>
			<Target title="LinuxOnly">
				<Option output="bin/Linux/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option platforms="Linux" />
				<Option object_output="obj/Linux/" />
			</Target>
		</Build>
		<Unit filename="win.c" />
		<Unit filename="linux.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
const out = { info() {}, warn() {}, error() {}, debug() {}, append() {}, clear() {}, show() {}, hide() {}, dispose() {} };
const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));

// F2：LinuxOnly 目标在本机（Windows）不支持 → 不生成编译命令；
// 两个文件均归属 Win 目标（无 target 属性）→ 仅 2 条（而非 4 条）
const entries = engine.collectCompileCommands();
const files = entries.map((e) => path.basename(e.file)).sort();
check('不支持平台目标被过滤', entries.length === 2 && files[0] === 'linux.c' && files[1] === 'win.c', files, ['linux.c', 'win.c']);
check('条目命令含 Win 编译器程序', entries[0].command.includes('gcc.exe'), entries[0].command, 'gcc.exe');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`compile_commands 平台过滤: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
