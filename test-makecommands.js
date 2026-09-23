// 验证 MakeCommands（makefile 项目 make 命令）往返是否丢失
const { ProjectParser } = require('./dist/model/parser');
const { serializeProject } = require('./dist/model/projectWriter');
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
				<Option output="bin/Debug/demo" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<MakeCommands>
			<Build command="make -f Makefile" />
			<Clean command="make clean" />
		</MakeCommands>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-makecommands.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const p = new ProjectParser().parse(tmp);
const xml = serializeProject(p);
const hasMakeCommands = xml.includes('MakeCommands');
const hasBuildCmd = xml.includes('make -f Makefile');
console.log('MakeCommands 保留:', hasMakeCommands, '| Build command 保留:', hasBuildCmd);
console.log(xml.split('\n').filter(l => l.includes('MakeCommands') || l.includes('command')).join('\n'));
fs.unlinkSync(tmp);
process.exit(hasMakeCommands && hasBuildCmd ? 0 : 1);
