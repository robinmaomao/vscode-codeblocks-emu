// 外部依赖 / 附加输出 编辑往返（Wave 2 C2）
// 覆盖：解析 → 模型编辑 → 序列化（分号列表、Unix 路径、不重复写、透传不受影响）→ 重解析
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
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
\t\t<Option title="dep-test" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="default">
\t\t\t\t<Option output="bin/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option object_output="obj" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option external_deps="lib/libfoo.a;lib/libbar.a" />
\t\t\t\t<Option additional_output="gen/generated.c" />
\t\t\t\t<Option platforms="Windows" />
\t\t\t\t<Compiler>
\t\t\t\t\t<Add option="-g" />
\t\t\t\t</Compiler>
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c">
\t\t\t<Option compile="1" />
\t\t\t<Option link="1" />
\t\t</Unit>
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-extdeps-test.cbp');
fs.writeFileSync(tmp, src, 'utf-8');
const parser = new ProjectParser();
const project = parser.parse(tmp);
const t = project.buildTargets[0];

check('解析 external_deps', JSON.stringify(t.externalDeps) === JSON.stringify(['lib/libfoo.a', 'lib/libbar.a']), t.externalDeps);
check('解析 additional_output', JSON.stringify(t.additionalOutput) === JSON.stringify(['gen/generated.c']), t.additionalOutput);

// 模拟面板编辑：保留一项、替换一项；附加输出改值；反斜杠路径应写为 Unix
t.externalDeps = ['lib/libfoo.a', 'lib\\libbaz.a'];
t.additionalOutput = ['gen/gen2.c'];

const xml = serializeProject(project);
check('写出新 external_deps（分号列表 + Unix 路径）', xml.includes('external_deps="lib/libfoo.a;lib/libbaz.a"'), null);
check('旧值不残留', !xml.includes('libbar.a') && !xml.includes('generated.c'), null);
check('external_deps 只写一次', xml.split('external_deps=').length === 2, xml.split('external_deps=').length - 1);
check('additional_output 只写一次', xml.split('additional_output=').length === 2, xml.split('additional_output=').length - 1);
check('未映射 Option（platforms）仍透传', xml.includes('<Option platforms="Windows" />'), null);

const tmp2 = path.join(os.tmpdir(), 'cb-extdeps-test-2.cbp');
fs.writeFileSync(tmp2, xml, 'utf-8');
const re = parser.parse(tmp2);
const rt = re.buildTargets[0];
check('往返 external_deps', JSON.stringify(rt.externalDeps) === JSON.stringify(['lib/libfoo.a', 'lib/libbaz.a']), rt.externalDeps);
check('往返 additional_output', JSON.stringify(rt.additionalOutput) === JSON.stringify(['gen/gen2.c']), rt.additionalOutput);
check('往返 platforms 透传', rt.platforms === 4, rt.platforms);

// 清空编辑 → 不再写出（且不残留旧属性）
rt.externalDeps = [];
rt.additionalOutput = [];
const xml2 = serializeProject(re);
check('清空后不写出', !xml2.includes('external_deps=') && !xml2.includes('additional_output='), null);

fs.unlinkSync(tmp);
fs.unlinkSync(tmp2);

console.log(`外部依赖往返: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
