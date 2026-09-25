// 验证虚拟文件夹解析：项目级 virtualFolders + 文件级 virtualFolder
const { ProjectParser } = require('../dist/model/parser');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="demo" />
		<Option virtualFolders="Headers;Sources;Sources/Generated" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/demo" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Unit filename="foo.h">
			<Option virtualFolder="Headers" />
		</Unit>
		<Unit filename="bar.c">
			<Option virtualFolder="Sources" />
		</Unit>
		<Unit filename="gen.c">
			<Option virtualFolder="Sources/Generated" />
		</Unit>
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-vfolder-test.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const p = new ProjectParser().parse(tmp);
console.log('project.virtualFolders =', JSON.stringify(p.virtualFolders));
for (const f of p.files) {
  console.log(`${f.relativeFilename}: virtualFolder=${JSON.stringify(f.virtualFolder)}`);
}
fs.unlinkSync(tmp);
