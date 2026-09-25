// 验证第20轮 H1：CommandsOnly 目标编译开关（codeblocks.build.compileCommandsOnlyTargets）
// 默认 false：不编译文件（collect 无条目、compileFile 拒绝）；true：按 CB 空存根编译（命令不带选项/include）
const Module = require('module');
const origLoad = Module._load;
let compileSwitch = false;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k) => (k === 'build.compileCommandsOnlyTargets' ? compileSwitch : undefined) }) },
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

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-htest-'));
const cbpPath = path.join(dir, 'htest.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="htest" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Cmd">
				<Option type="4" />
				<Option compiler="gcc" />
				<Option object_output="obj/Cmd/" />
				<Compiler>
					<Add option="-DTGT" />
				</Compiler>
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
const out = { info() {}, warn() {}, error() {}, debug() {}, append() {}, clear() {}, show() {}, hide() {}, dispose() {} };

(async () => {
  // 开关关闭（默认）：collect 无条目、compileFile 拒绝且不 spawn
  compileSwitch = false;
  const engineOff = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
  const entriesOff = engineOff.collectCompileCommands();
  check('开关关闭 collect 无条目', entriesOff.length === 0, entriesOff.length, 0);
  const rOff = await engineOff.compileFile('Cmd', 'main.c', {});
  check('开关关闭 compileFile 拒绝', rOff === false, rOff, false);

  // 开关开启（对齐 CB）：collect 生成条目且命令不带选项（空存根）
  compileSwitch = true;
  const engineOn = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
  const entriesOn = engineOn.collectCompileCommands();
  check('开关开启 collect 生成条目', entriesOn.length === 1, entriesOn.length, 1);
  const cmd = entriesOn[0]?.command ?? '';
  check('开关开启命令含编译器', cmd.includes('gcc.exe'), cmd, 'gcc.exe');
  check('开关开启命令不带目标选项（空存根）', !cmd.includes('-DTGT'), cmd, 'no -DTGT');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`CommandsOnly 编译开关: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
