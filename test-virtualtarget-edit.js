// 验证虚拟目标（VirtualTargets）序列化
const { ProjectParser } = require('./dist/model/parser');
const { serializeProject } = require('./dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve('test-project/hello-cb.cbp');
const parser = new ProjectParser();
const project = parser.parse(cbp);

// 设置虚拟目标
project.virtualTargets = [
  { title: 'All', targets: ['Debug', 'Release'] },
  { title: 'Libs', targets: ['Debug'] },
];

const xml = serializeProject(project);
console.log(xml);
console.log('='.repeat(40));

const tmp = path.join(require('os').tmpdir(), 'cb-vtarget-test.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const reparse = parser.parse(tmp);
for (const vt of reparse.virtualTargets) {
  console.log(`${vt.title}: [${vt.targets.join(', ')}]`);
}
fs.unlinkSync(tmp);
