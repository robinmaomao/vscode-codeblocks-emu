// 验证文件类型分组（categorize）匹配逻辑
const { ProjectParser } = require('./dist/model/parser');
const path = require('path');
const fs = require('fs');
const os = require('os');

const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="demo" />
		<Option compiler="gcc" />
		<Build><Target title="Debug"><Option output="bin/Debug/demo" /><Option type="1" /><Option compiler="gcc" /></Target></Build>
		<Unit filename="main.c" />
		<Unit filename="util.cpp" />
		<Unit filename="foo.h" />
		<Unit filename="bar.hpp" />
		<Unit filename="start.s" />
		<Unit filename="icon.rc" />
		<Unit filename="build.script" />
		<Unit filename="readme.txt" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-categorize.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const p = new ProjectParser().parse(tmp);

// 复刻分组匹配（对齐 filegroupsandmasks.cpp SetDefault）
const GROUPS = [
  { name: 'Sources', masks: ['*.c', '*.cpp', '*.cc', '*.cxx'] },
  { name: 'D Sources', masks: ['*.d'] },
  { name: 'Fortran Sources', masks: ['*.f', '*.f77', '*.for', '*.fpp', '*.f90', '*.f95', '*.f03', '*.f08'] },
  { name: 'Java Sources', masks: ['*.java'] },
  { name: 'Headers', masks: ['*.h', '*.hpp', '*.hh', '*.hxx'] },
  { name: 'ASM Sources', masks: ['*.asm', '*.s', '*.ss', '*.s62'] },
  { name: 'Resources', masks: ['*.res', '*.xrc', '*.rc', '*.wxs'] },
  { name: 'Scripts', masks: ['*.script'] },
];
const compiled = GROUPS.map(g => ({ name: g.name, re: g.masks.map(m => new RegExp('^' + m.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')) }));
function match(filename) {
  for (const g of compiled) for (const re of g.re) if (re.test(filename)) return g.name;
  return 'Others';
}

const byGroup = new Map();
for (const f of p.files) {
  const name = match(path.basename(f.relativeFilename));
  if (!byGroup.has(name)) byGroup.set(name, []);
  byGroup.get(name).push(f.relativeFilename);
}
let ok = true;
for (const [name, files] of byGroup) {
  console.log(`${name}: ${files.join(', ')}`);
}
// 断言
const expect = {
  'Sources': ['main.c', 'util.cpp'],
  'Headers': ['foo.h', 'bar.hpp'],
  'ASM Sources': ['start.s'],
  'Resources': ['icon.rc'],
  'Scripts': ['build.script'],
  'Others': ['readme.txt'],
};
for (const [name, files] of Object.entries(expect)) {
  const got = (byGroup.get(name) || []).slice().sort().join(',');
  const want = files.slice().sort().join(',');
  if (got !== want) { ok = false; console.error(`FAIL ${name}: got [${got}] want [${want}]`); }
}
console.log(ok ? '分组匹配 OK' : '分组匹配 FAIL');
fs.unlinkSync(tmp);
process.exit(ok ? 0 : 1);
