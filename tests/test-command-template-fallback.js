// 验证第17轮 E1/E3：Compiler::GetCommand 模板回退三态（compiler.cpp:306-332）+
// cleanTarget 无效编译器目标跳过对象清理（GetTargetCleanCommands:966）
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
const { CommandGenerator } = require('../dist/compiler/commandGenerator.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');
const { CommandType } = require('../dist/model/types.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-etest-'));
const cbpPath = path.join(dir, 'etest.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="etest" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/Debug/" />
			</Target>
			<Target title="Bad">
				<Option output="bin/Bad/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="nosuch" />
				<Option object_output="obj/Bad/" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');
const project = new ProjectParser().parse(cbpPath);

// E1-a：扩展名精确匹配优先于空扩展名条目
const c1 = createGccCompiler('win32');
c1.commands[CommandType.CompileObjectCmd] = [
  { command: 'gccA -c $file -o $object', extensions: ['c'], generatedFiles: [] },
  { command: 'gccB -c $file -o $object', extensions: [], generatedFiles: [] },
];
const g1 = new CommandGenerator(project, c1);
const m1 = g1.generate(CommandType.CompileObjectCmd, {
  target: project.buildTargets[0], pf: null, file: path.join(dir, 'x.c'), object: 'x.o', flatObject: 'x.o', deps: '',
});
check('扩展名精确匹配', m1.startsWith('gccA '), m1, 'gccA');

// E1-b：扩展名不匹配 → 最后一条空扩展名条目
const m2 = g1.generate(CommandType.CompileObjectCmd, {
  target: project.buildTargets[0], pf: null, file: path.join(dir, 'x.cpp'), object: 'x.o', flatObject: 'x.o', deps: '',
});
check('不匹配回退最后空扩展名条目', m2.startsWith('gccB '), m2, 'gccB');

// E1-c：无空扩展名条目且不匹配 → vec[0]（CB catchAll 初值 0）
c1.commands[CommandType.CompileObjectCmd] = [
  { command: 'gccA -c $file -o $object', extensions: ['c'], generatedFiles: [] },
];
const g1b = new CommandGenerator(project, c1);
const m3 = g1b.generate(CommandType.CompileObjectCmd, {
  target: project.buildTargets[0], pf: null, file: path.join(dir, 'x.cpp'), object: 'x.o', flatObject: 'x.o', deps: '',
});
check('无通配时回退 vec[0]', m3.startsWith('gccA '), m3, 'gccA');

// E1-d：链接命令扩展名为空 → vec[0]（即使首条声明了扩展名）
const c2 = createGccCompiler('win32');
c2.commands[CommandType.LinkConsoleExeCmd] = [
  { command: 'linkA $file', extensions: ['c'], generatedFiles: [] },
  { command: 'linkB $file', extensions: [], generatedFiles: [] },
];
const g2 = new CommandGenerator(project, c2);
const m4 = g2.generate(CommandType.LinkConsoleExeCmd, {
  target: project.buildTargets[0], pf: null, file: '', object: 'x.o', flatObject: 'x.o', deps: '',
  hasCppFilesToLink: false,
});
check('链接命令空扩展名取 vec[0]', m4.startsWith('linkA '), m4, 'linkA');

// E3：无效编译器目标 cleanTarget → 跳过对象清理、输出文件照删、无 Clean banner
const compiler = createGccCompiler('win32');
const logs = [];
const out = {
  info: (l) => logs.push('i|' + l),
  warn: () => {}, error: () => {}, debug: () => {},
  append() {}, clear() {}, show() {}, hide() {}, dispose() {},
};
const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
const badObj = path.join(dir, 'obj', 'Bad', 'main.o');
const badOut = path.join(dir, 'bin', 'Bad', 'app.exe');
fs.mkdirSync(path.dirname(badObj), { recursive: true });
fs.mkdirSync(path.dirname(badOut), { recursive: true });
fs.writeFileSync(badObj, 'x');
fs.writeFileSync(badOut, 'x');
engine.cleanTarget(project.buildTargets[1]);
check('无效编译器不删对象', fs.existsSync(badObj), badObj, 'kept');
check('无效编译器输出照删', !fs.existsSync(badOut), badOut, 'deleted');
check('无效编译器无 Clean banner', !logs.some((l) => l.includes('Clean:')), logs, 'no banner');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`模板回退 + cleanTarget 无效编译器: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
