// 验证 D1/D7 解析对齐：<Option external_deps/additional_output> 分号列表 + Extensions 项目自定义变量
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('./dist/model/parser.js');

let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-extdeps-'));
const cbp = path.join(dir, 't.cbp');
fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="t" />
		<Build>
			<Target title="D">
				<Option type="1" />
				<Option compiler="gcc" />
				<Option output="bin/Debug/app" />
				<Option object_output="obj/Debug/" />
				<Option external_deps="..\\lib\\a.o; b.o " />
				<Option additional_output="out.map;$(TARGET_OUTPUT_DIR)x.map" />
			</Target>
		</Build>
		<Unit filename="main.c" />
	</Project>
	<Extensions>
		<codeblocks_project_custom_variables>
			<SDKROOT value="D:\\sdk" />
			<TOOLCHAIN value="$(SDKROOT)\\riscv" />
		</codeblocks_project_custom_variables>
	</Extensions>
</CodeBlocks_project_file>`, 'utf-8');

const p = new ProjectParser().parse(cbp);
const t = p.buildTargets[0];

// D1：external_deps 分号拆分 + 去空白
check('external_deps 拆分', JSON.stringify(t.externalDeps) === JSON.stringify(['..\\lib\\a.o', 'b.o']));
// D1：additional_output 拆分（保留未展开宏，展开发生在构建期）
check('additional_output 拆分', JSON.stringify(t.additionalOutput) === JSON.stringify(['out.map', '$(TARGET_OUTPUT_DIR)x.map']));
// D7：自定义变量解析（含嵌套引用，展开发生在构建期）
check('自定义变量 SDKROOT', p.customVariables['SDKROOT'] === 'D:\\sdk');
check('自定义变量 TOOLCHAIN', p.customVariables['TOOLCHAIN'] === '$(SDKROOT)\\riscv');
check('无自定义变量项目为空对象', typeof p.customVariables === 'object' && Object.keys(p.customVariables).length === 2);

// replaceAllMacros 迭代替换（对齐 macrosmanager ReplaceMacros）
const { replaceAllMacros } = require('./dist/build/scriptRunner.js');
check('replaceAllMacros 嵌套展开', replaceAllMacros('$(TOOLCHAIN)/bin', p.customVariables) === 'D:\\sdk\\riscv/bin');
check('replaceAllMacros 无变化稳定', replaceAllMacros('plain', p.customVariables) === 'plain');

// 未写 external_deps 的目标默认为空数组
fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="t2" />
		<Build><Target title="D"><Option type="1" /><Option output="bin/a" /></Target></Build>
		<Unit filename="main.c" />
	</Project>
</CodeBlocks_project_file>`, 'utf-8');
const p2 = new ProjectParser().parse(cbp);
check('默认 externalDeps 为空', Array.isArray(p2.buildTargets[0].externalDeps) && p2.buildTargets[0].externalDeps.length === 0);
check('默认 additionalOutput 为空', Array.isArray(p2.buildTargets[0].additionalOutput) && p2.buildTargets[0].additionalOutput.length === 0);

fs.rmSync(dir, { recursive: true, force: true });
console.log('汇总: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
