// 验证第16轮 B1-B5：Clean/Build/Build file banner 文案对齐 PrintBanner、
// 无效编译器目标跳过（CompilerValid + PrintInvalidCompiler 语义）
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-btest-'));
const cbpPath = path.join(dir, 'btest.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="btest" />
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
			<Target title="Bad2">
				<Option output="bin/Bad2/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="badc" />
				<Option object_output="obj/Bad2/" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
// B5：已注册但 IsValid 失败（masterPath 无工具链）的编译器实例
const badCompiler = createGccCompiler('win32');
badCompiler.masterPath = 'Z:\\no-such-toolchain';
const logs = [];
const out = {
  info: (l) => logs.push('i|' + l),
  warn: (l) => logs.push('w|' + l),
  error: (l) => logs.push('e|' + l),
  debug: () => {},
  append() {}, clear() {}, show() {}, hide() {}, dispose() {},
};
const resolver = (id) => (id === 'gcc' ? compiler : id === 'badc' ? badCompiler : undefined);
const engine = new BuildEngine(project, compiler, out, resolver);

// B4：无效编译器目标（ID 未注册）→ 完整 PrintInvalidCompiler 消息 + 收尾行，build 返回 false，无 banner
(async () => {
  const ok = await engine.build('Bad', {});
  check('无效编译器目标 build 返回 false', ok === false, ok, false);
  const err = logs.find((l) => l.startsWith('e|') && l.includes('invalid'));
  check('打印 invalid compiler 错误', !!err, err, 'invalid compiler message');
  // 0.8.121-dev：结构对齐 CB PrintInvalidCompiler；文案为扩展适配（产品名/设置与命令指引/ID 显示）
  check('消息含 Probably 行（compiler settings）',
    !!err && err.includes('  Probably the toolchain path within the compiler settings is not setup correctly?!'),
    err, undefined);
  check('消息含 Do you have a compiler installed? 行',
    !!err && err.includes('  Do you have a compiler installed?'),
    err, undefined);
  check('产品名改为 Code::Blocks for VS Code',
    !!err && err.includes('so Code::Blocks for VS Code cannot find/run the compiler.'),
    err, undefined);
  check('未注册编译器回退显示其 ID（(nosuch)）',
    !!err && err.includes("The compiler's setup (nosuch) is invalid"),
    err, undefined);
  check('修复指引指向扩展设置与探测命令',
    !!err && err.includes('Check the "codeblocks.masterPath" / "codeblocks.compilerPrograms" settings, or run "Code::Blocks: Detect Compilers" to fix the compiler\'s setup.'),
    err, undefined);
  check('主消息末尾换行（与下一条之间空行）',
    !!err && err.endsWith("fix the compiler's setup.\n"),
    err, undefined);
  const skip = logs.find((l) => l.includes('Skipping...'));
  check('Skipping... 为独立错误条目', skip === 'e|Skipping...', skip, 'e|Skipping...');
  check('收尾行 Nothing to be done（P3-B）',
    logs.includes('i|[Code::Blocks] Nothing to be done (all items are up-to-date).'),
    logs.filter((l) => l.includes('Nothing')), 'i|[Code::Blocks] Nothing to be done (all items are up-to-date).');
  const badBanner = logs.find((l) => l.includes('Build: Bad'));
  check('无效目标不打印 Build banner', !badBanner, badBanner, undefined);

  // B5：编译器已注册但 IsValid 失败（masterPath 无效）→ "(名称) " + MakeInvalidCompilerMessages 尝试路径
  const ok2 = await engine.build('Bad2', {});
  check('已注册无效编译器 build 返回 false', ok2 === false, ok2, false);
  const err2 = logs.find((l) => l.includes('(GNU GCC Compiler) is invalid'));
  check('已注册无效：消息含 (GNU GCC Compiler) 名称', !!err2, err2, undefined);
  check('已注册无效：修复指引（扩展设置）',
    !!err2 && err2.includes('codeblocks.compilerPrograms'),
    err2, undefined);
  const tried = logs.find((l) => l.startsWith('e|') && l.includes('Tried to run compiler executable'));
  check('尝试路径含 masterPath/bin',
    !!tried && tried.includes(`Tried to run compiler executable '${path.join('Z:\\no-such-toolchain', 'bin', badCompiler.programs.C)}', but failed!`),
    tried, undefined);
  check('尝试路径含 masterPath 根目录',
    !!tried && tried.includes(`Tried to run compiler executable '${path.join('Z:\\no-such-toolchain', badCompiler.programs.C)}', but failed!`),
    tried, undefined);

  // B2：cleanTarget 打印 Clean banner（bsTargetClean PrintBanner(baClean) 精确文案）
  const before = logs.length;
  engine.cleanTarget(project.buildTargets[0]);
  const cleanBanner = logs.slice(before).find((l) => l.includes('Clean:'));
  check('Clean banner 精确文案',
    cleanBanner === 'i|-------------- Clean: Debug in btest (compiler: GNU GCC Compiler)---------------',
    cleanBanner, 'i|-------------- Clean: Debug in btest (compiler: GNU GCC Compiler)---------------');

  // B3：compileFile 打印 Build file banner（PrintBanner(baBuildFile)）；对象比源新 → 已最新，不 spawn
  const src = path.join(dir, 'main.c');
  fs.writeFileSync(src, 'int main(void){return 0;}\n');
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(src, past, past);
  const obj = path.join(dir, 'obj', 'Debug', 'main.o');
  fs.mkdirSync(path.dirname(obj), { recursive: true });
  fs.writeFileSync(obj, 'x');
  const now = new Date();
  fs.utimesSync(obj, now, now);
  const before2 = logs.length;
  const r = await engine.compileFile('Debug', 'main.c', {});
  check('compileFile 已最新返回 true', r === true, r, true);
  const fileBanner = logs.slice(before2).find((l) => l.includes('Build file:'));
  check('Build file banner 精确文案',
    fileBanner === 'i|-------------- Build file: Debug in btest (compiler: GNU GCC Compiler)---------------',
    fileBanner, 'i|-------------- Build file: Debug in btest (compiler: GNU GCC Compiler)---------------');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`banner + 无效编译器跳过: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
