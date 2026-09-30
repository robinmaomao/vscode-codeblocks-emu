// 验证第三轮 R6/R7/R8/R9：
//  - 目标/工程高级字段序列化与往返（working_dir/deps_output/platforms/宿主程序/库命名策略/pch_mode/makefile 等）
//  - alwaysRunPostBuildSteps（Mode after=always）
//  - 从目标导出独立工程（文件过滤/单目标/虚拟目标不导出/extensions 保留）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { serializeProject, formatPlatforms } = require('../dist/model/projectWriter.js');
const { buildTargetExportProject } = require('../dist/project/exportTarget.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- formatPlatforms ----
check('平台格式：win+unix', formatPlatforms(0x06) === 'Windows;Unix;', formatPlatforms(0x06));
check('平台格式：全选 → All', formatPlatforms(0xff) === 'All' && formatPlatforms(0x07) === 'All', [formatPlatforms(0xff), formatPlatforms(0x07)]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-adv-'));
const cbp = path.join(dir, 'adv.cbp');
fs.copyFileSync(path.resolve(__dirname, '../test-project/hello-cb.cbp'), cbp);
const project = new ProjectParser().parse(cbp);
const t = project.buildTargets[0];

// ---- R6：目标高级字段 ----
t.workingDir = 'run/dir';
t.depsOutput = 'obj/deps';
t.platforms = 0x06;
t.hostApplication = 'bin/host.exe';
t.runHostApplicationInTerminal = false;
t.useConsoleRunner = false;
t.impLib = 'bin/app.lib';
t.defFile = 'bin/app.def';
t.createDefFile = true;
t.createStaticLib = true;
t.prefixAuto = false;
t.extensionAuto = false;
// ---- R7：工程高级字段 ----
project.platforms = 0x02;
project.pchMode = 0;
project.extendedObjNames = true;
project.makefileIsCustom = true;
project.makefile = 'Build.mk';
project.executionDir = 'build';
// ---- always ----
project.alwaysRunPostBuildSteps = true;
t.alwaysRunPostBuildSteps = true;
project.commandsAfterBuild = ['echo proj'];
t.commandsAfterBuild = ['echo target'];

const xml = serializeProject(project);
check('working_dir 写出', xml.includes('working_dir="run/dir"'), true);
check('deps_output 写出', xml.includes('deps_output="obj/deps"'), true);
check('目标 platforms 写出', xml.includes('<Option platforms="Windows;Unix;" />'), true);
check('host_application + 终端开关', xml.includes('host_application="bin/host.exe"') && xml.includes('run_host_application_in_terminal="0"'), true);
check('use_console_runner=0（控制台目标）', xml.includes('use_console_runner="0"'), true);
check('prefix/extension 关闭', xml.includes('prefix_auto="0"') && xml.includes('extension_auto="0"'), true);
check('工程 platforms', xml.includes('<Option platforms="Unix;" />'), true);
check('pch_mode=0', xml.includes('pch_mode="0"'), true);
check('extended_obj_names', xml.includes('extended_obj_names="1"'), true);
check('makefile 模式', xml.includes('makefile="Build.mk"') && xml.includes('makefile_is_custom="1"') && xml.includes('execution_dir="build"'), true);
const modeCount = (xml.match(/<Mode after="always" \/>/g) || []).length;
check('always 写出（项目+目标）', modeCount === 2, modeCount);
// 控制台目标往返（useConsoleRunner）
const tmpC = path.join(dir, 'rt-console.cbp');
fs.writeFileSync(tmpC, xml, 'utf-8');
check('往返 useConsoleRunner（控制台目标）', new ProjectParser().parse(tmpC).buildTargets[0].useConsoleRunner === false, true);

// ---- R6：动态库目标的库命名字段（createDefFile/createStaticLib/imp_lib/def_file） ----
t.targetType = 3; // DynamicLib
const xml2 = serializeProject(project);
check('imp_lib/def_file', xml2.includes('imp_lib="bin/app.lib"') && xml2.includes('def_file="bin/app.def"'), true);
check('createDefFile/createStaticLib', xml2.includes('createDefFile="1"') && xml2.includes('createStaticLib="1"'), true);

const tmp = path.join(dir, 'rt.cbp');
fs.writeFileSync(tmp, xml2, 'utf-8');
const rt = new ProjectParser().parse(tmp);
const rtt = rt.buildTargets[0];
check('往返目标高级字段', rtt.workingDir === 'run/dir' && rtt.depsOutput === 'obj/deps' && rtt.platforms === 0x06
  && rtt.hostApplication === 'bin/host.exe' && rtt.runHostApplicationInTerminal === false
  && rtt.impLib === path.normalize('bin/app.lib') && rtt.defFile === path.normalize('bin/app.def')
  && rtt.createDefFile === true && rtt.createStaticLib === true
  && rtt.prefixAuto === false && rtt.extensionAuto === false, rtt);
check('往返工程高级字段', rt.platforms === 0x02 && rt.pchMode === 0 && rt.extendedObjNames === true
  && rt.makefileIsCustom === true && rt.makefile === 'Build.mk' && rt.executionDir === 'build', rt);
check('往返 always', rt.alwaysRunPostBuildSteps === true && rtt.alwaysRunPostBuildSteps === true, [rt.alwaysRunPostBuildSteps, rtt.alwaysRunPostBuildSteps]);
check('默认工程不写 platforms（全选）', (() => {
  const p2 = new ProjectParser().parse(path.resolve(__dirname, '../test-project/hello-cb.cbp'));
  return !serializeProject(p2).includes('<Option platforms=');
})(), true);

// ---- R9：从目标导出独立工程（文件过滤） ----
const multi = path.join(dir, 'multi.cbp');
fs.writeFileSync(multi, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="multi" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
			<Target title="Release">
				<Option output="bin/Release/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
			<Environment>
				<Variable name="PROJ_V" value="1" />
			</Environment>
		</Build>
		<VirtualTargets>
			<Add alias="All" targets="Debug;Release" />
		</VirtualTargets>
		<Unit filename="main.c">
			<Option target="Debug" />
		</Unit>
		<Unit filename="release.c">
			<Option target="Release" />
		</Unit>
		<Extensions>
			<debugger>
				<search_path add="C:/src" />
			</debugger>
		</Extensions>
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');
const mp = new ProjectParser().parse(multi);
const exp = buildTargetExportProject(mp, 'Debug');
check('导出：单目标', exp.buildTargets.length === 1 && exp.buildTargets[0].title === 'Debug', exp.buildTargets.map((x) => x.title));
check('导出：文件过滤', exp.files.length === 1 && exp.files[0].relativeFilename === 'main.c', exp.files.map((f) => f.relativeFilename));
check('导出：虚拟目标清空', exp.virtualTargets.length === 0, exp.virtualTargets);
check('导出：Extensions 保留', exp.extensions && exp.extensions.debugger !== undefined, exp.extensions);
check('导出：项目环境变量保留', exp.envVars.length === 1 && exp.envVars[0].name === 'PROJ_V', exp.envVars);

const expXml = serializeProject(exp);
check('导出 XML：仅 Debug 目标', expXml.includes('title="Debug"') && !expXml.includes('title="Release"'), true);
check('导出 XML：无 VirtualTargets', !expXml.includes('<VirtualTargets>'), true);
check('导出 XML：仅含 main.c', expXml.includes('filename="main.c"') && !expXml.includes('filename="release.c"'), true);
const tmp2 = path.join(dir, 'exp.cbp');
fs.writeFileSync(tmp2, expXml, 'utf-8');
const expRt = new ProjectParser().parse(tmp2);
check('导出工程可重新解析', expRt.buildTargets.length === 1 && expRt.files.length === 1 && expRt.files[0].buildTargets.includes('Debug'),
  expRt.files.map((f) => f.buildTargets));
check('导出：无效目标抛错', (() => { try { buildTargetExportProject(mp, 'Nope'); return false; } catch { return true; } })(), true);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`高级字段编辑 + 目标导出: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
