// 验证第14轮 Z1/Z2/Z4/Z5/Z6/Z8：编译器全局选项（default.conf 大小写键 + /libraries 键名）、
// 反引号展开、单文件 $exe_output 原生分隔符、$file_dir 无目录归一、静态库 prependHack
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CodeBlocksConfig } = require('../dist/compiler/codeblocksConfig.js');
const { ProjectParser } = require('../dist/model/parser.js');
const { CommandGenerator } = require('../dist/compiler/commandGenerator.js');
const { CommandType } = require('../dist/model/types.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-globopt-'));
const conf = path.join(dir, 'default.conf');
fs.writeFileSync(conf, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocksConfig>
	<compiler>
		<compiler_sets>
			<tst>
				<include_dirs><str><![CDATA[C:\\sdk\\inc]]></str></include_dirs>
				<libraries><str><![CDATA[global_lib]]></str></libraries>
				<compiler_options><str><![CDATA[-DCMP]]></str></compiler_options>
				<linker_options><str><![CDATA[-Wl,-Map=out.map]]></str></linker_options>
				<resource_compiler_options><str><![CDATA[use-temp-file]]></str></resource_compiler_options>
			</tst>
		</compiler_sets>
		<user_sets>
			<iar8051>
				<NAME><str><![CDATA[IAR 8051]]></str></NAME>
				<PARENT><str><![CDATA[gcc]]></str></PARENT>
				<MASTER_PATH><str><![CDATA[C:\\IAR]]></str></MASTER_PATH>
				<C_COMPILER><str><![CDATA[icc8051.exe]]></str></C_COMPILER>
				<CPP_COMPILER><str><![CDATA[icc8051.exe]]></str></CPP_COMPILER>
				<LINKER><str><![CDATA[icc8051.exe]]></str></LINKER>
				<LIB_LINKER><str><![CDATA[icc8051.exe]]></str></LIB_LINKER>
				<INCLUDE_DIRS><str><![CDATA[C:\\iar\\inc;D:\\hal\\inc]]></str></INCLUDE_DIRS>
				<LIBRARY_DIRS><str><![CDATA[C:\\iar\\lib]]></str></LIBRARY_DIRS>
				<RES_INCLUDE_DIRS><str><![CDATA[C:\\iar\\res]]></str></RES_INCLUDE_DIRS>
				<LIBRARIES><str><![CDATA[iar_rt]]></str></LIBRARIES>
				<COMPILER_OPTIONS><str><![CDATA[--no_wrap_diagnostics]]></str></COMPILER_OPTIONS>
				<LINKER_OPTIONS><str><![CDATA[-u call_graph_root]]></str></LINKER_OPTIONS>
			</iar8051>
		</user_sets>
	</compiler>
</CodeBlocksConfig>`, 'utf-8');

const cfg = new CodeBlocksConfig();
cfg.load(conf);

// Z1/Z2a: compiler_sets 小写键 + 编译器级选项
const sd = cfg.searchDirs('tst');
check('compiler_sets include_dirs', sd.includeDirs.length === 1 && sd.includeDirs[0] === 'C:\\sdk\\inc', sd.includeDirs, ['C:\\sdk\\inc']);
check('compiler_sets libraries 键名', sd.linkLibs.length === 1 && sd.linkLibs[0] === 'global_lib', sd.linkLibs, ['global_lib']);
check('compiler_sets compiler_options', sd.compilerOptions.length === 1 && sd.compilerOptions[0] === '-DCMP', sd.compilerOptions, ['-DCMP']);
check('compiler_sets linker_options', sd.linkerOptions[0] === '-Wl,-Map=out.map', sd.linkerOptions[0], '-Wl,-Map=out.map');
check('compiler_sets resource options', sd.resourceCompilerOptions[0] === 'use-temp-file', sd.resourceCompilerOptions[0], 'use-temp-file');

// Z2a: user_sets 大写键（旧版 CB 存储格式）
const sdu = cfg.searchDirs('iar8051');
check('user_sets INCLUDE_DIRS 大写键', sdu.includeDirs.length === 2 && sdu.includeDirs[1] === 'D:\\hal\\inc', sdu.includeDirs, ['C:\\iar\\inc', 'D:\\hal\\inc']);
check('user_sets LIBRARY_DIRS', sdu.libDirs[0] === 'C:\\iar\\lib', sdu.libDirs[0], 'C:\\iar\\lib');
check('user_sets RES_INCLUDE_DIRS', sdu.resIncludeDirs[0] === 'C:\\iar\\res', sdu.resIncludeDirs[0], 'C:\\iar\\res');
check('user_sets LIBRARIES 大写键', sdu.linkLibs[0] === 'iar_rt', sdu.linkLibs[0], 'iar_rt');
check('user_sets COMPILER_OPTIONS', sdu.compilerOptions[0] === '--no_wrap_diagnostics', sdu.compilerOptions[0], '--no_wrap_diagnostics');
check('user_sets LINKER_OPTIONS', sdu.linkerOptions[0] === '-u call_graph_root', sdu.linkerOptions[0], '-u call_graph_root');

// Z1a: 三处 setup* 追加编译器级选项（项目+目标+编译器顺序）
const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="globopt" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Compiler>
					<Add option="-DTGT" />
				</Compiler>
				<Linker>
					<Add option="-Wl,-Map=tgt.map" />
				</Linker>
			</Target>
		</Build>
		<Compiler>
			<Add option="-DPROJ" />
		</Compiler>
		<Linker>
			<Add option="-Wl,-Map=proj.map" />
		</Linker>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;
const cbpPath = path.join(dir, 'globopt.cbp');
fs.writeFileSync(cbpPath, cbp, 'utf-8');
const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
compiler.compilerOptions = ['-DCMP'];
compiler.linkerOptions = ['-Wl,-Map=cmp.map'];
compiler.resourceCompilerOptions = ['use-temp-file'];
// Z8：反引号展开（cbExpandBackticks：执行 `cmd` 并把输出注入 flags）
compiler.compilerOptions.push('`echo -DBT`');

const gen = new CommandGenerator(project, compiler);
const target = project.buildTargets[0];
const cmd = gen.generate(CommandType.CompileObjectCmd, {
  target,
  pf: null,
  file: path.join(dir, 'main.c'),
  object: 'obj/Debug/main.o',
  flatObject: 'obj/Debug/main.o',
  deps: '.deps/main.depend',
  hasCppFilesToLink: false,
});
// $options = -DPROJ -DTGT -DCMP -DBT（关系 Append → 编译器级最后；反引号输出注入）
check('$options 项目+目标+编译器顺序', cmd.includes('-DPROJ -DTGT -DCMP'), cmd, '-DPROJ -DTGT -DCMP');
check('反引号展开 -DBT', cmd.includes('-DBT'), cmd, '-DBT');
// 链接选项
const link = gen.generate(CommandType.LinkConsoleExeCmd, {
  target,
  pf: null,
  file: '',
  object: 'obj/Debug/main.o',
  flatObject: 'obj/Debug/main.o',
  deps: '',
  hasCppFilesToLink: false,
});
check('$link_options 项目+目标+编译器顺序', link.includes('-Wl,-Map=proj.map -Wl,-Map=tgt.map -Wl,-Map=cmp.map'), link, '-Wl,-Map=proj.map -Wl,-Map=tgt.map -Wl,-Map=cmp.map');

// Z6: 静态库 prependHack 前缀检测
const tpls = createGccCompiler('win32').commands;
tpls[CommandType.LinkStaticCmd] = [{ command: '$lib_linker -r -s $static_output $+link_objects', extensions: [], generatedFiles: [] }];
compiler.commands = tpls;
const hackGen = new CommandGenerator(project, compiler);
check('prependHack +', hackGen.linkObjectsPrependHack() === '+', hackGen.linkObjectsPrependHack(), '+');
tpls[CommandType.LinkStaticCmd] = [{ command: '$lib_linker -r -s $static_output $-+link_objects', extensions: [], generatedFiles: [] }];
compiler.commands = tpls;
const hackGen2 = new CommandGenerator(project, compiler);
check('prependHack -+', hackGen2.linkObjectsPrependHack() === '-+', hackGen2.linkObjectsPrependHack(), '-+');

// Z4/Z5: 单文件编译 $exe_output 原生分隔符 + $file_dir 无目录归一
const tplSingle = createGccCompiler('win32');
tplSingle.commands[CommandType.CompileObjectCmd] = [
  { command: '$compiler $options $includes -c $file -o $object', extensions: [], generatedFiles: [] },
];
const gen2 = new CommandGenerator({ basePath: dir, buildTargets: [], compilerOptions: [], linkerOptions: [], customVariables: {}, title: 'p', filename: cbpPath, includeDirs: [], libDirs: [], resIncludeDirs: [], linkLibs: [], resourceCompilerOptions: [] }, tplSingle);
const single = gen2.generateFromTemplate('$exe_output|$exe_name|$exe_dir|$exe_ext|[$file_dir]', {
  target: undefined,
  pf: null,
  file: 'main.c',
  object: 'obj/main.o',
  flatObject: '',
  deps: '',
});
const nativeExe = path.join('obj', 'main.exe');
check('单文件 $exe_output 原生分隔符', single.startsWith(nativeExe + '|main|' + path.join('obj') + '|exe|[]'), single, nativeExe + '|main|obj|exe|[]');

fs.rmSync(dir, { recursive: true, force: true });
console.log(`编译器全局选项: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
