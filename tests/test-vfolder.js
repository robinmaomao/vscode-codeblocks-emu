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

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
const byRel = new Map(p.files.map((f) => [f.relativeFilename, f]));
check('virtualFolders 列表', JSON.stringify(p.virtualFolders) === JSON.stringify(['Headers', 'Sources', 'Sources/Generated']), p.virtualFolders);
check('Unit virtualFolder 归属', byRel.get('foo.h')?.virtualFolder === 'Headers' && byRel.get('bar.c')?.virtualFolder === 'Sources' && byRel.get('gen.c')?.virtualFolder === 'Sources/Generated' && !byRel.get('main.c')?.virtualFolder, [...byRel.values()].map((f) => ({ f: f.relativeFilename, v: f.virtualFolder })));
console.log(`virtualFolder 解析: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
