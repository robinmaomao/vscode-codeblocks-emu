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
process.exit(showNotesCount > 1 ? 1 : 0);
