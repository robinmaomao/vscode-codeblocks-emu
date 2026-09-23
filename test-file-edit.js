// 验证文件归属/编译选项编辑后的序列化结果（模拟 saveProjectProperties 的 files 处理）
const { ProjectParser } = require('./dist/model/parser');
const { serializeProject } = require('./dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve('test-project/hello-cb.cbp');
const parser = new ProjectParser();
const project = parser.parse(cbp);

// 假设目标不变（Debug, Release），newTitles = {Debug, Release}
const newTitles = new Set(project.buildTargets.map(t => t.title));

// 模拟文件编辑
const fileEdits = [
  { relativeFilename: 'main.c', compilerVar: 'CC', compile: false, link: true, buildTargets: ['Debug'], buildCommand: '' },
  { relativeFilename: 'util.c', compilerVar: '', compile: true, link: true, buildTargets: ['Debug', 'Release'], buildCommand: '' },
  { relativeFilename: 'util.h', compilerVar: '', compile: true, link: true, buildTargets: [], buildCommand: 'gcc -E $file' },
];

const fileByRel = new Map(project.files.map(f => [f.relativeFilename, f]));
for (const fe of fileEdits) {
  const f = fileByRel.get(fe.relativeFilename);
  if (!f) continue;
  const cv = fe.compilerVar.trim();
  f.compilerVar = cv === 'CC' || cv === 'WINDRES' ? cv : '';
  f.compile = fe.compile;
  f.link = fe.link;
  const cmp = project.compilerId;
  const cmd = fe.buildCommand.trim();
  if (cmd) f.customBuildCommands[cmp] = cmd; else delete f.customBuildCommands[cmp];
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
