// 验证文件归属/编译选项编辑后的序列化结果（模拟 saveProjectProperties 的 files 处理）
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve(__dirname, '../test-project/hello-cb.cbp');
const parser = new ProjectParser();
const project = parser.parse(cbp);

// 假设目标不变（Debug, Release），newTitles = {Debug, Release}
const newTitles = new Set(project.buildTargets.map(t => t.title));

// 模拟文件编辑（对齐 saveProjectProperties 的 FileEditData 处理）
const fileEdits = [
  { relativeFilename: 'main.c', compilerVar: 'CC', compile: false, link: true, buildTargets: ['Debug'], customBuild: {} },
  { relativeFilename: 'util.c', compilerVar: '', compile: true, link: true, buildTargets: ['Debug', 'Release'], customBuild: {} },
  { relativeFilename: 'util.h', compilerVar: '', compile: true, link: true, buildTargets: [], customBuild: { gcc: { use: true, command: 'gcc -E $file' } } },
];

const fileByRel = new Map(project.files.map(f => [f.relativeFilename, f]));
for (const fe of fileEdits) {
  const f = fileByRel.get(fe.relativeFilename);
  if (!f) continue;
  const cv = fe.compilerVar.trim();
  f.compilerVar = cv || (fe.compile ? 'CPP' : '');
  f.compile = fe.compile;
  f.link = fe.link;
  const customBuild = {};
  for (const [id, v] of Object.entries(fe.customBuild ?? {})) {
    const command = (v.command ?? '').trim();
    if (command) customBuild[id] = { command, use: v.use === true };
  }
  f.customBuildCommands = customBuild;
  const checked = fe.buildTargets.filter(t => newTitles.has(t));
  if (checked.length === newTitles.size && newTitles.size > 0) {
    f.explicitTargets = false;
    f.buildTargets = [...newTitles];
  } else {
    f.explicitTargets = true;
    f.buildTargets = checked;
  }
}

const xml = serializeProject(project);
console.log(xml);
console.log('='.repeat(40));

// 再解析验证
const tmp = path.join(require('os').tmpdir(), 'cb-file-edit-test.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const reparse = parser.parse(tmp);
for (const f of reparse.files) {
  console.log(`${f.relativeFilename}: var=${JSON.stringify(f.compilerVar)} compile=${f.compile} link=${f.link} targets=${JSON.stringify(f.buildTargets)} explicit=${f.explicitTargets} cmd=${JSON.stringify(f.customBuildCommands)}`);
}
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
const byRel = new Map(reparse.files.map((f) => [f.relativeFilename, f]));
const mainC = byRel.get('main.c');
const utilH = byRel.get('util.h');
check('文件归属：main.c 编译关闭/仅 Debug', mainC && mainC.compilerVar === 'CC' && mainC.compile === false && JSON.stringify(mainC.buildTargets) === JSON.stringify(['Debug']) && mainC.explicitTargets === true, mainC && { cv: mainC.compilerVar, compile: mainC.compile, targets: mainC.buildTargets });
check('文件归属：util.h 自定义命令', utilH && utilH.customBuildCommands?.gcc?.use === true && utilH.customBuildCommands.gcc.command === 'gcc -E $file', utilH && utilH.customBuildCommands);
console.log(`文件归属编辑: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
