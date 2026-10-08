// X2 回归：目标级「平台不支持」跳过输出 CB 原文警告（对齐 PreprocessJob:2749-2756）+
// 全目标被平台跳过后补 NotifyJobDone 收尾行（compilergcc.cpp:4123-4140）。
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
const { supportsCurrentPlatform } = require('../dist/model/types.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-platskip-'));
const cbpPath = path.join(dir, 'ptest.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="ptest" />
		<Option compiler="gcc" />
		<Build>
			<Target title="MacOnly">
				<Option output="bin/MacOnly/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/MacOnly/" />
				<Option platforms="Mac" />
			</Target>
			<Target title="WinOnly">
				<Option output="bin/WinOnly/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/WinOnly/" />
				<Option platforms="Windows" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
const logs = [];
const out = {
  info: (l) => logs.push('i|' + l),
  warn: (l) => logs.push('w|' + l),
  error: (l) => logs.push('e|' + l),
  debug: () => {},
  append() {}, clear() {}, show() {}, hide() {}, dispose() {},
};
const resolver = (id) => (id === 'gcc' ? compiler : undefined);
const engine = new BuildEngine(project, compiler, out, resolver);

// 依当前平台确定「被跳过」与「受支持」的目标（Mac=0x01 / Windows=0x04 与 supportsCurrentPlatform 同源）
const skippedTitle = supportsCurrentPlatform(0x01) ? 'WinOnly' : 'MacOnly';

(async () => {
  const ok = await engine.build(skippedTitle, {});
  check('仅平台跳过 → build 返回 false', ok === false, ok, false);

  const warnLine = `w|"ptest - ${skippedTitle}" does not support the current platform. Skipping...`;
  check('输出 CB 原文警告（含工程-目标引号格式）', logs.includes(warnLine), logs.filter((l) => l.startsWith('w|')), warnLine);

  check('无无效编译器错误条目（平台跳过不误报编译器）', !logs.some((l) => l.startsWith('e|') && l.includes('invalid')), logs.filter((l) => l.startsWith('e|')), '（无）');

  check('收尾行 Nothing to be done（NotifyJobDone 语义，含平台跳过）',
    logs.includes('i|[Code::Blocks] Nothing to be done (all items are up-to-date).'),
    logs.filter((l) => l.includes('Nothing')), 'i|[Code::Blocks] Nothing to be done (all items are up-to-date).');

  check('被跳过目标不打印 Build banner', !logs.some((l) => l.includes(`Build: ${skippedTitle}`)), logs.filter((l) => l.includes('Build:')), undefined);

  // 受支持目标单独构建时不触发该警告（以「未请求该目标」为对照，避免真实编译 spawn）
  check('警告仅针对被跳过目标（受支持目标未请求时无警告）', !logs.some((l) => l.includes(`"ptest - ${skippedTitle === 'MacOnly' ? 'WinOnly' : 'MacOnly'}" does not support`)), logs.filter((l) => l.startsWith('w|')), undefined);

  console.log(`\nplatform-skip-log 回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
