// 验证新建工程模板生成的 .cbp 可被重新解析
const { createProjectFromTemplate, PROJECT_TEMPLATES } = require('../dist/project/newProject');
const { serializeProject } = require('../dist/model/projectWriter');
const { ProjectParser } = require('../dist/model/parser');
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
  // 模板附加选项（C6）：链接库/目录原样进入目标
  if (ok && tpl.linkLibs && JSON.stringify(re.buildTargets[0].linkLibs) !== JSON.stringify(tpl.linkLibs)) {
    console.log(`FAIL ${tpl.label}: linkLibs=${JSON.stringify(re.buildTargets[0].linkLibs)} want=${JSON.stringify(tpl.linkLibs)}`);
    failed = true;
  }
  if (ok && tpl.includeDirs && re.buildTargets[0].includeDirs.length !== tpl.includeDirs.length) {
    console.log(`FAIL ${tpl.label}: includeDirs=${JSON.stringify(re.buildTargets[0].includeDirs)}`);
    failed = true;
  }
  console.log(`${tpl.label}: ${ok ? 'OK' : 'FAIL'}（targets=${re.buildTargets.length}, files=${re.files.length}）`);
  if (!ok) { failed = true; console.log(xml); }
  fs.unlinkSync(tmp);
}
fs.rmdirSync(base);
process.exit(failed ? 1 : 0);
