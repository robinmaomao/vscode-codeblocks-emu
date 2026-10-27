// compile_commands.json 兼容化回归（clangd 用）：
//  - 引号内的空格不得被拆成两个参数（-DAPP_NAME="My App" / -DMSG="hello world"）
//  - 含空格的 -I 路径保留原样
//  - -march= / clang 不认识的 GCC 专属 flag 被剔除
//  - 追加的 -isystem 路径含空格时加引号
//  - resolveCompilerProgram：裸程序名 + masterPath → <masterPath>/bin/<program>
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      window: { showWarningMessage: () => {}, visibleTextEditors: [] },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      commands: { executeCommand: async () => {} },
      extensions: { getExtension: () => undefined },
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
const { createGccCompiler } = require('../dist/compiler/compiler.js');
const { collectClangdEntries } = require('../dist/build/compileCommands.js');
const { resolveCompilerProgram } = require('../dist/tools/clangd.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cflags-'));
const cbpPath = path.join(dir, 'flags.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="flags" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/flags" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/Debug/" />
			</Target>
		</Build>
		<Compiler>
			<Add option="-Wall" />
			<Add option="-DAPP_NAME=&quot;My App&quot;" />
			<Add option="-DVERSION_STR=&quot;1.2.3&quot;" />
			<Add option="-I&quot;C:/Program Files/sdk/include&quot;" />
			<Add option="-march=rv32imac" />
			<Add option="-msave-restore" />
		</Compiler>
		<Unit filename="main.c" />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
const out = { info() {}, warn() {}, error() {}, debug() {}, append() {}, clear() {}, show() {}, hide() {}, dispose() {} };
const entries = collectClangdEntries(project, compiler, out, ['C:/Program Files/sdk/inc2']);
const cmd = entries[0] ? entries[0].command : '';

check('生成 1 条编译命令', entries.length === 1, entries.length);
check('-D 宏的引号值不被拆开（-DAPP_NAME="My App"）', cmd.includes('-DAPP_NAME="My App"'), cmd);
check('-D 宏值的引号保留（-DVERSION_STR="1.2.3"）', cmd.includes('-DVERSION_STR="1.2.3"'), cmd);
check('含空格的 -I 路径保留原样', cmd.includes('-I"C:/Program Files/sdk/include"'), cmd);
check('普通 flag 保留（-Wall）', cmd.includes('-Wall'), cmd);
check('-march= 剔除', !cmd.includes('-march='), cmd);
check('clang 不认识的 GCC 专属 flag 剔除（-msave-restore）', !cmd.includes('-msave-restore'), cmd);
check('追加 -isystem 且含空格路径加引号', cmd.includes('-isystem "C:/Program Files/sdk/inc2"'), cmd);
check('-isystem 路径作为独立参数（不粘连）', !/-isystemC:/.test(cmd), cmd);

// ---- resolveCompilerProgram：宿主 PATH 未含工具链时仍能定位编译器 ----
const mp = path.join(dir, 'toolchain');
fs.mkdirSync(path.join(mp, 'bin'), { recursive: true });
fs.writeFileSync(path.join(mp, 'bin', 'gcc.exe'), 'x', 'utf-8');
check('裸程序名 + masterPath → <masterPath>/bin/<program>',
  resolveCompilerProgram('gcc.exe', mp) === path.join(mp, 'bin', 'gcc.exe'), resolveCompilerProgram('gcc.exe', mp));
const mpBin = path.join(dir, 'toolchain-bin');
fs.mkdirSync(mpBin, { recursive: true });
fs.writeFileSync(path.join(mpBin, 'gcc.exe'), 'x', 'utf-8');
check('masterPath 直接指向 bin 也能命中', resolveCompilerProgram('gcc.exe', mpBin) === path.join(mpBin, 'gcc.exe'), resolveCompilerProgram('gcc.exe', mpBin));
check('masterPath 下不存在 → 原样返回（交给 PATH）', resolveCompilerProgram('gcc.exe', path.join(dir, 'nope')) === 'gcc.exe', resolveCompilerProgram('gcc.exe', path.join(dir, 'nope')));
check('已是路径 → 原样返回', resolveCompilerProgram('C:/x/bin/cc.exe', mp) === 'C:/x/bin/cc.exe', resolveCompilerProgram('C:/x/bin/cc.exe', mp));
check('空程序名 → 空串', resolveCompilerProgram('', mp) === '', resolveCompilerProgram('', mp));

fs.rmSync(dir, { recursive: true, force: true });
console.log(`clangd compile flags: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
