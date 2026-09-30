// 验证第三轮 R2：<Environment> 项目/目标环境变量参与宏展开
// 依据：macrosmanager.cpp:217-243（ReadMacros 大写键、目标覆盖项目）、:675/708（查表前 Upper()）
//      projectloader.cpp:900-915（DoEnvironment）、compilergcc.cpp:2127（Run 命令行展开）
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
const { CommandGenerator } = require('../dist/compiler/commandGenerator.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');
const { CommandType } = require('../dist/model/types.js');
const { envVarMap, replaceCbMacros, cbBuiltinVars } = require('../dist/compiler/cbMacros.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-envtest-'));
const cbpPath = path.join(dir, 'envtest.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="envtest" />
		<Option compiler="gcc" />
		<Build>
			<Environment>
				<Variable name="PROJ_VAR" value="pv" />
				<Variable name="SHARED" value="from-project" />
			</Environment>
			<Target title="Debug">
				<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/Debug/" />
				<Compiler>
					<Add option="-DPV=$(PROJ_VAR)" />
					<Add option="-DTV=$(TGT_VAR)" />
					<Add option="-DSH=$(SHARED)" />
					<Add option="-DLC=$(proj_var)" />
				</Compiler>
				<Environment>
					<Variable name="TGT_VAR" value="tv" />
					<Variable name="SHARED" value="from-target" />
				</Environment>
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(cbpPath);
check('项目 envVars 解析', project.envVars.length === 2, project.envVars, '2 items');
check('目标 envVars 解析', project.buildTargets[0].envVars.length === 2, project.buildTargets[0].envVars, '2 items');

// ---- envVarMap 单元语义 ----
const m = envVarMap([{ name: 'a', value: '1' }], [{ name: 'A', value: '2' }, { name: '', value: 'x' }]);
check('envVarMap 键大写 + 后者覆盖 + 空名跳过', m.A === '2' && Object.keys(m).length === 1, m, { A: '2' });

// ---- 集成：CommandGenerator 渲染的编译器选项包含展开后的环境变量 ----
const gen = new CommandGenerator(project, createGccCompiler('win32'));
const cmd = gen.generate(CommandType.CompileObjectCmd, {
  target: project.buildTargets[0], pf: null, file: path.join(dir, 'main.c'), object: 'main.o', flatObject: 'main.o', deps: '',
});
check('项目级变量展开', cmd.includes('-DPV=pv'), cmd, '-DPV=pv');
check('目标级变量展开', cmd.includes('-DTV=tv'), cmd, '-DTV=tv');
check('目标覆盖项目（SHARED）', cmd.includes('-DSH=from-target'), cmd, '-DSH=from-target');
check('宏名大写回退（$(proj_var)→PROJ_VAR）', cmd.includes('-DLC=pv'), cmd, '-DLC=pv');

// ---- 合并次序：内置宏优先于同名环境变量（保护 TARGET_* 等核心宏） ----
const builtins = cbBuiltinVars('/p', 'bin/Debug/app', 'Debug', 'obj/', 'proj', '/p/proj.cbp', '');
const merged = { ...envVarMap([{ name: 'TARGET_OUTPUT_BASENAME', value: 'evil' }]), ...builtins };
check('内置宏优先于同名环境变量', replaceCbMacros('x $(TARGET_OUTPUT_BASENAME)', { vars: merged }) === 'x app',
  replaceCbMacros('x $(TARGET_OUTPUT_BASENAME)', { vars: merged }), 'x app');

// ---- 环境变量（含大写回退）照常可展开 ----
const merged2 = { ...envVarMap([{ name: 'MY_PORT', value: '42' }]), ...builtins };
check('环境变量展开 $(MY_PORT)', replaceCbMacros('p $(MY_PORT)', { vars: merged2 }) === 'p 42',
  replaceCbMacros('p $(MY_PORT)', { vars: merged2 }), 'p 42');
check('环境变量大写回退 $(my_port)', replaceCbMacros('p $(my_port)', { vars: merged2 }) === 'p 42',
  replaceCbMacros('p $(my_port)', { vars: merged2 }), 'p 42');

// ---- 项目自定义变量（扩展增强）：非内置名可展开；直传 opts 时 vars 优先（既有语义） ----
check('customVars 展开非内置名', replaceCbMacros('$(CC_TEST_VAR)', { customVars: { CC_TEST_VAR: 'custom' } }) === 'custom',
  replaceCbMacros('$(CC_TEST_VAR)', { customVars: { CC_TEST_VAR: 'custom' } }), 'custom');
check('直传 opts：vars 优先于 customVars', replaceCbMacros('$(SH)', { vars: { SH: 'env' }, customVars: { SH: 'custom' } }) === 'env',
  replaceCbMacros('$(SH)', { vars: { SH: 'env' }, customVars: { SH: 'custom' } }), 'env');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`环境变量宏展开: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
