// 验证新建工程模板生成的 .cbp 可被重新解析
const { createProjectFromTemplate, PROJECT_TEMPLATES } = require('./dist/project/newProject');
const { serializeProject } = require('./dist/model/projectWriter');
const { ProjectParser } = require('./dist/model/parser');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-np-'));
let failed = false;
for (const tpl of PROJECT_TEMPLATES) {
  const { project } = createProjectFromTemplate('demo', base, tpl);
  const xml = serializeProject(project);
  const tmp = path.join(base, tpl.id + '.cbp');
  fs.writeFileSync(tmp, xml, 'utf-8');
  const re = new ProjectParser().parse(tmp);
  const ok = re.title === 'demo' && re.buildTargets.length === 2
    && re.buildTargets.every((t) => t.targetType === tpl.targetType)
    && re.files.length === tpl.skeleton.length;
  console.log(`${tpl.label}: ${ok ? 'OK' : 'FAIL'}（targets=${re.buildTargets.length}, files=${re.files.length}）`);
  if (!ok) { failed = true; console.log(xml); }
  fs.unlinkSync(tmp);
}
fs.rmdirSync(base);
process.exit(failed ? 1 : 0);
