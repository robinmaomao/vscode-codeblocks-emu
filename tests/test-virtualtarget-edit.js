// 验证虚拟目标（VirtualTargets）序列化
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve(__dirname, '../test-project/hello-cb.cbp');
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

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
check('虚拟目标序列化', reparse.virtualTargets.length === 2 && reparse.virtualTargets[0].title === 'All' && JSON.stringify(reparse.virtualTargets[0].targets) === JSON.stringify(['Debug', 'Release']) && reparse.virtualTargets[1].title === 'Libs', reparse.virtualTargets);
console.log(`虚拟目标编辑: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
