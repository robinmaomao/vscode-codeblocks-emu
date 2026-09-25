// 验证第15轮 W1/W2/W3/W5：反引号全命令展开 + -I/-L 目录汇入 deps 扫描目录、
// 单文件编译/清理目标归属校验、cleanFile 仅删对象保留 .depend
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
const { ProjectParser } = require('./dist/model/parser.js');
const { BuildEngine } = require('./dist/build/buildEngine.js');
const { CommandGenerator } = require('./dist/compiler/commandGenerator.js');
const { createGccCompiler } = require('./dist/compiler/compiler.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-wtest-'));
const cbpPath = path.join(dir, 'wtest.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="wtest" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/Debug/" />
			</Target>
			<Target title="Release">
				<Option output="bin/Release/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/Release/" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Unit filename="util.c">
			<Option target="Release" />
		</Unit>
		<Unit filename="loose.c">
			<Option target="&lt;{~None~}&gt;" />
		</Unit>
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
compiler.compilerOptions = ['`echo -IC:/bt/inc -LC:/bt/lib`'];
const out = { info() {}, warn() {}, error() {}, debug() {}, append() {}, clear() {}, show() {}, hide() {}, dispose() {} };
const engine = new BuildEngine(project, compiler, out, (id) => compiler);

// W1-a：反引号派生 -I 目录汇入 deps 扫描目录（getCompilerSearchDirs）
const gen = new CommandGenerator(project, compiler);
check('反引号 -I 目录汇入 deps', gen.getCompilerSearchDirs('Debug').includes('C:/bt/inc'), gen.getCompilerSearchDirs('Debug'), 'C:/bt/inc');

// W1-b：命令模板直接书写的反引号也展开（renderTemplate 末尾，对齐 compilergcc.cpp:1402）
const tpl = gen.generateFromTemplate('`echo hello` $compiler -c $file -o $object', {
  target: project.buildTargets[0],
  pf: null,
  file: path.join(dir, 'main.c'),
  object: 'obj/Debug/main.o',
  flatObject: 'obj/Debug/main.o',
  deps: '',
});
check('模板反引号展开', tpl.includes('hello') && !tpl.includes('echo'), tpl, 'hello');

// W2-a：未归属当前目标的文件 → compileFile 拒绝（util.c 只属于 Release）
(async () => {
  const r1 = await engine.compileFile('Debug', 'util.c', {});
  check('compileFile 拒绝其它目标文件', r1 === false, r1, false);

  // W2-b：未归属任何目标的文件 → compileFile 拒绝（loose.c = <{~None~}>）
  const r2 = await engine.compileFile('Debug', 'loose.c', {});
  check('compileFile 拒绝未归属文件', r2 === false, r2, false);

  // W2-c/W5：cleanFile 归属校验 + 仅删对象保留 .depend
  const objAbs = path.join(dir, 'obj', 'Debug', 'main.o');
  const depsAbs = path.join(dir, '.deps', 'main.depend');
  fs.mkdirSync(path.dirname(objAbs), { recursive: true });
  fs.mkdirSync(path.dirname(depsAbs), { recursive: true });
  fs.writeFileSync(objAbs, 'x');
  fs.writeFileSync(depsAbs, 'y');
  engine.cleanFile('Debug', 'main.c');
  check('cleanFile 删除对象', !fs.existsSync(objAbs), objAbs, 'deleted');
  check('cleanFile 保留 .depend（W5）', fs.existsSync(depsAbs), depsAbs, 'kept');

  // W2-d：cleanFile 对未归属文件不删对象
  const looseObj = path.join(dir, 'obj', 'Debug', 'loose.o');
  fs.mkdirSync(path.dirname(looseObj), { recursive: true });
  fs.writeFileSync(looseObj, 'x');
  engine.cleanFile('Debug', 'loose.c');
  check('cleanFile 不删未归属文件对象', fs.existsSync(looseObj), looseObj, 'kept');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`反引号全命令 + 单文件归属 + cleanFile: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
