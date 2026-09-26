// 验证含 notes 的 .cbp 往返是否重复 show_notes
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="demo" />
		<Option compiler="gcc" />
		<Option show_notes="1">
			<notes><![CDATA[项目备注]]></notes>
		</Option>
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/demo" prefix_auto="1" extension_auto="1" />
				<Option object_output="obj/Debug/" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-notes-roundtrip.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const p = new ProjectParser().parse(tmp);
const xml = serializeProject(p);
const showNotesCount = (xml.match(/show_notes/g) || []).length;
console.log('show_notes 出现次数:', showNotesCount);
console.log(xml.split('\n').filter(l => l.includes('show_notes')).join('\n'));
fs.unlinkSync(tmp);

// —— 目标执行参数（<Option parameters>）往返（第四十四轮 Set Programs' Arguments）——
const cbpParams = cbp.replace(
  '\t\t\t<Option compiler="gcc" />\n\t\t\t</Target>',
  '\t\t\t<Option compiler="gcc" />\n\t\t\t\t<Option parameters="--verbose &quot;a b.txt&quot;" />\n\t\t\t</Target>',
);
const tmp2 = path.join(os.tmpdir(), 'cb-params-roundtrip.cbp');
fs.writeFileSync(tmp2, cbpParams, 'utf-8');
const pp = new ProjectParser().parse(tmp2);
const okParsed = pp.buildTargets[0].executionParameters === '--verbose "a b.txt"';
const xml2 = serializeProject(pp);
const okWritten = xml2.includes('parameters="--verbose &quot;a b.txt&quot;"');
pp.buildTargets[0].executionParameters = '';
const okOmitted = !serializeProject(pp).includes('<Option parameters=');
console.log('parameters 解析:', okParsed, '转义写出:', okWritten, '空省略:', okOmitted);
fs.unlinkSync(tmp2);

process.exit(showNotesCount > 1 || !okParsed || !okWritten || !okOmitted ? 1 : 0);
