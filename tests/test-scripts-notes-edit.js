// 验证构建脚本/备注/weight/virtualFolder 的序列化往返
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve(__dirname, '../test-project/hello-cb.cbp');
const parser = new ProjectParser();
const project = parser.parse(cbp);

// 项目级：备注 + 构建脚本
project.notes = '这是项目备注\n第二行';
project.showNotesOnLoad = true;
project.buildScripts = ['prebuild.script', 'postbuild.script'];

// 目标级：构建脚本
project.buildTargets[0].buildScripts = ['debug.script'];
project.buildTargets[1].buildScripts = [];

// 文件级：weight + virtualFolder
project.files[0].weight = 10;
project.files[0].virtualFolder = 'Sources';
project.files[1].weight = 50; // 默认，不应写
project.files[2].weight = 90;
project.files[2].virtualFolder = 'Headers';

const xml = serializeProject(project);
console.log(xml);
console.log('='.repeat(40));

// 再解析验证
const tmp = path.join(require('os').tmpdir(), 'cb-scripts-notes-test.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const reparse = parser.parse(tmp);
console.log('notes:', JSON.stringify(reparse.notes), 'showNotes:', reparse.showNotesOnLoad);
console.log('项目级 scripts:', JSON.stringify(reparse.buildScripts));
for (const t of reparse.buildTargets) {
  console.log(`${t.title} scripts:`, JSON.stringify(t.buildScripts));
}
for (const f of reparse.files) {
  console.log(`${f.relativeFilename}: weight=${f.weight} vfolder=${JSON.stringify(f.virtualFolder)}`);
}
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
check('项目备注与显示开关', reparse.notes === '这是项目备注\n第二行' && reparse.showNotesOnLoad === true, { notes: reparse.notes, show: reparse.showNotesOnLoad });
check('项目/目标构建脚本', JSON.stringify(reparse.buildScripts) === JSON.stringify(['prebuild.script', 'postbuild.script']) && JSON.stringify(reparse.buildTargets[0].buildScripts) === JSON.stringify(['debug.script']) && reparse.buildTargets[1].buildScripts.length === 0, { project: reparse.buildScripts, targets: reparse.buildTargets.map((t) => t.buildScripts) });
const byRel = new Map(reparse.files.map((f) => [f.relativeFilename, f]));
check('文件 weight / virtualFolder', byRel.get('main.c')?.weight === 10 && byRel.get('main.c')?.virtualFolder === 'Sources' && byRel.get('util.h')?.weight === 90 && byRel.get('util.h')?.virtualFolder === 'Headers', [...byRel.values()].map((f) => ({ f: f.relativeFilename, w: f.weight, v: f.virtualFolder })));
console.log(`备注/脚本/weight: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
