// 验证 DynamicLib 的 imp_lib/def_file 往返保留
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
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/libdemo" imp_lib="lib/libdemo.a" def_file="libdemo.def" prefix_auto="1" extension_auto="1" />
				<Option object_output="obj/Debug/" />
				<Option type="3" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<Unit filename="demo.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-implib-roundtrip.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const p = new ProjectParser().parse(tmp);
const xml = serializeProject(p);
const hasImpLib = xml.includes('imp_lib');
const hasDefFile = xml.includes('def_file');
console.log('imp_lib 保留:', hasImpLib, '| def_file 保留:', hasDefFile);
console.log(xml.split('\n').filter(l => l.includes('imp_lib') || l.includes('def_file') || l.includes('output=')).join('\n'));
fs.unlinkSync(tmp);
process.exit(hasImpLib && hasDefFile ? 0 : 1);
