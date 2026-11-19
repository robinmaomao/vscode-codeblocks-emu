// 验证搜索目录 + 项目设置编辑后的序列化结果
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve(__dirname, '../test-project/hello-cb.cbp');
const parser = new ProjectParser();
const project = parser.parse(cbp);

// 项目设置应用（先于 files，影响默认编译器）
const projectSettings = { title: 'hello-cb2', compilerId: 'riscv', virtualFolders: ['Headers', 'Sources'] };
project.title = projectSettings.title.trim() || project.title;
project.compilerId = projectSettings.compilerId.trim() || project.compilerId;
project.virtualFolders = projectSettings.virtualFolders;

// 搜索目录应用
const searchDirs = {
  project: { includeDirs: ['../include', '../sdk/inc'], libDirs: ['../lib'], resourceDirs: ['../res'] },
  targets: [
    { includeDirs: ['inc'], libDirs: [], resourceDirs: [] },
    { includeDirs: [], libDirs: ['lib'], resourceDirs: [] },
  ],
};
project.includeDirs = searchDirs.project.includeDirs;
project.libDirs = searchDirs.project.libDirs;
project.resourceIncludeDirs = searchDirs.project.resourceDirs;
for (let i = 0; i < project.buildTargets.length && i < searchDirs.targets.length; i++) {
  project.buildTargets[i].includeDirs = searchDirs.targets[i].includeDirs;
  project.buildTargets[i].libDirs = searchDirs.targets[i].libDirs;
  project.buildTargets[i].resourceIncludeDirs = searchDirs.targets[i].resourceDirs;
}

const xml = serializeProject(project);
console.log(xml);
console.log('='.repeat(40));

// 再解析验证
const tmp = path.join(require('os').tmpdir(), 'cb-dirs-settings-test.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const reparse = parser.parse(tmp);
console.log('title:', reparse.title, 'compiler:', reparse.compilerId, 'vfolders:', JSON.stringify(reparse.virtualFolders));
console.log('项目级 dirs:', JSON.stringify({ inc: reparse.includeDirs, lib: reparse.libDirs, res: reparse.resourceIncludeDirs }));
for (const t of reparse.buildTargets) {
  console.log(`${t.title} dirs:`, JSON.stringify({ inc: t.includeDirs, lib: t.libDirs, res: t.resourceIncludeDirs }));
}
fs.unlinkSync(tmp);

// ---- 断言 ----
let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
check('项目设置序列化', reparse.title === 'hello-cb2' && reparse.compilerId === 'riscv' && JSON.stringify(reparse.virtualFolders) === JSON.stringify(['Headers', 'Sources']), { title: reparse.title, compiler: reparse.compilerId, vf: reparse.virtualFolders });
const norm = (arr) => JSON.stringify((arr || []).map((d) => d.replace(/\\/g, '/')));
check('项目级搜索目录', norm(reparse.includeDirs) === norm(['../include', '../sdk/inc']) && norm(reparse.libDirs) === norm(['../lib']) && norm(reparse.resourceIncludeDirs) === norm(['../res']), { inc: reparse.includeDirs, lib: reparse.libDirs, res: reparse.resourceIncludeDirs });
check('目标级搜索目录', JSON.stringify(reparse.buildTargets[0].includeDirs) === JSON.stringify(['inc']) && JSON.stringify(reparse.buildTargets[1].libDirs) === JSON.stringify(['lib']), reparse.buildTargets.map((t) => ({ inc: t.includeDirs, lib: t.libDirs, res: t.resourceIncludeDirs })));
console.log(`搜索目录设置: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
