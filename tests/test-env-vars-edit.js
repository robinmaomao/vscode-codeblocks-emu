// 验证第三轮 R1：工程属性面板环境变量编辑的写回链路
// （saveProjectProperties 应用逻辑镜像 + projectWriter 序列化 + 往返）
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const cbp = path.resolve(__dirname, '../test-project/hello-cb.cbp');
const parser = new ProjectParser();

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const project = parser.parse(cbp);
const norm = (list) => (list ?? []).filter((v) => v.name).map((v) => ({ name: v.name, value: v.value }));

// 模拟 saveProjectProperties：项目级 + 目标级环境变量应用（R1 的两行）
project.envVars = norm([{ name: 'PROJ_A', value: 'p1' }, { name: '', value: 'skip' }]);
project.buildTargets[0].envVars = norm([{ name: 'TGT_A', value: 't1' }]);

const xml = serializeProject(project);
check('项目级 Environment 写出', xml.includes('<Environment>'), xml.includes('<Environment>'), true);
check('项目变量名写出', xml.includes('name="PROJ_A"'), 'PROJ_A');
check('目标变量名写出', xml.includes('name="TGT_A"'), 'TGT_A');
check('空名被过滤', !xml.includes('name=""'), 'no empty name');

// 往返
const tmp = path.join(path.dirname(cbp), '.tmp-envvars-edit.cbp');
fs.writeFileSync(tmp, xml, 'utf-8');
const rt = parser.parse(tmp);
check('往返项目 envVars', JSON.stringify(rt.envVars) === JSON.stringify([{ name: 'PROJ_A', value: 'p1' }]), rt.envVars, 'PROJ_A=p1');
check('往返目标 envVars', JSON.stringify(rt.buildTargets[0].envVars) === JSON.stringify([{ name: 'TGT_A', value: 't1' }]), rt.buildTargets[0].envVars, 'TGT_A=t1');

// 清空 → 不写 <Environment>
rt.envVars = [];
rt.buildTargets[0].envVars = [];
const xml2 = serializeProject(rt);
check('清空后不写项目 Environment', !xml2.includes('<Environment>'), xml2.includes('<Environment>'), false);

fs.rmSync(tmp, { force: true });
console.log(`环境变量编辑往返: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
