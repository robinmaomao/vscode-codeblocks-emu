// 验证搜索目录 + 项目设置编辑后的序列化结果
const { ProjectParser } = require('./dist/model/parser');
const { serializeProject } = require('./dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve('test-project/hello-cb.cbp');
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
