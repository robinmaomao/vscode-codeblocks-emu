// 项目自定义变量写回往返（Wave 2 C3）
// 覆盖：解析 → applyCustomVariables（改值/新增/删除/非法名跳过）→ 序列化（元素名=变量名）→ 重解析 → 清空移除节点
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const { applyCustomVariables } = require('../dist/model/customVariables');
const fs = require('fs');
const path = require('path');
const os = require('os');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const src = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="vars-test" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="default">
\t\t\t\t<Option output="bin/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions>
\t\t\t<codeblocks_project_custom_variables>
\t\t\t\t<MY_VER value="1.0" />
\t\t\t\t<OUT_DIR value="dist" />
\t\t\t</codeblocks_project_custom_variables>
\t\t</Extensions>
\t</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-cvars-test.cbp');
fs.writeFileSync(tmp, src, 'utf-8');
const parser = new ProjectParser();
const project = parser.parse(tmp);
check('解析自定义变量', project.customVariables.MY_VER === '1.0' && project.customVariables.OUT_DIR === 'dist', project.customVariables);

// 模拟面板编辑：改值 + 新增（含空格值）+ 删除 OUT_DIR + 非法名（含空格）跳过
const result = applyCustomVariables(project.extensions, [
  { name: 'MY_VER', value: '2.0' },
  { name: 'NEW_VAR', value: 'x y' },
  { name: 'bad name', value: 'z' },
]);
project.extensions = result.extensions;
project.customVariables = result.variables;
check('非法名跳过', JSON.stringify(result.skipped) === JSON.stringify(['bad name']), result.skipped);
check('删除的变量不在模型', !('OUT_DIR' in result.variables), Object.keys(result.variables));

const xml = serializeProject(project);
check('写出新值（元素名 = 变量名）', xml.includes('MY_VER value="2.0"'), null);
check('新增变量写出（含空格值转义）', xml.includes('NEW_VAR value="x y"'), null);
check('删除变量不残留', !xml.includes('OUT_DIR'), null);

const tmp2 = path.join(os.tmpdir(), 'cb-cvars-test-2.cbp');
fs.writeFileSync(tmp2, xml, 'utf-8');
const re = parser.parse(tmp2);
check('往返：改值', re.customVariables.MY_VER === '2.0', re.customVariables);
check('往返：新增', re.customVariables.NEW_VAR === 'x y', re.customVariables);
check('往返：删除', re.customVariables.OUT_DIR === undefined, re.customVariables);

// 清空 → 节点移除
const cleared = applyCustomVariables(re.extensions, []);
check('清空后节点移除', !('codeblocks_project_custom_variables' in cleared.extensions), Object.keys(cleared.extensions));

// 无 Extensions 的工程（undefined）也能写入
const fromScratch = applyCustomVariables(undefined, [{ name: 'A', value: '1' }]);
check('无 Extensions 时创建', fromScratch.extensions['codeblocks_project_custom_variables']['A']['@_value'] === '1', fromScratch.extensions);

fs.unlinkSync(tmp);
fs.unlinkSync(tmp2);

console.log(`自定义变量往返: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
