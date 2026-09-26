// 验证第三轮 R13（用户工程模板：保存为模板 / 从模板新建）：
//  - slugifyTemplateId 归一化
//  - saveAsUserTemplate：工程名 → $(PROJECT_NAME) 占位符（仅 title/output/def/imp_lib 属性）
//  - instantiateUserTemplate：占位符 → 新工程名、骨架复制、<新名>.cbp 改名
//  - 清单读写 / 列表排序 / 重名与非法参数防御
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  slugifyTemplateId,
  replaceProjectNameInXml,
  applyTemplateNameToXml,
  saveAsUserTemplate,
  instantiateUserTemplate,
  listUserTemplates,
  getUserTemplate,
  PROJECT_NAME_PLACEHOLDER,
} = require('../dist/project/userTemplates.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- slugify ----
check('slugify：空格/大小写', slugifyTemplateId('My Template') === 'my-template', slugifyTemplateId('My Template'));
check('slugify：保留中文', slugifyTemplateId('嵌入式模板') === '嵌入式模板', slugifyTemplateId('嵌入式模板'));
check('slugify：全特殊字符回退', slugifyTemplateId('!!!') === 'template', slugifyTemplateId('!!!'));
check('slugify：连续分隔符折叠', slugifyTemplateId('a -- b') === 'a-b', slugifyTemplateId('a -- b'));

// ---- 纯 XML 改写 ----
const demoXml = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
  '<CodeBlocks_project_file>',
  '  <Project version="1">',
  '    <Option title="demo" />',
  '    <Option pch_mode="2" />',
  '    <Build>',
  '      <Target title="Debug">',
  '        <Option output="bin/Debug/demo" prefix_auto="1" />',
  '        <Option imp_lib="demo.lib" def="demo.def" />',
  '        <Compiler>',
  '          <Add option="-Dname=demo" />',
  '        </Compiler>',
  '      </Target>',
  '    </Build>',
  '  </Project>',
  '</CodeBlocks_project_file>',
].join('\n');

const tplXml = replaceProjectNameInXml(demoXml, 'demo');
check('保存方向：title → 占位符', tplXml.includes(`title="${PROJECT_NAME_PLACEHOLDER}"`), tplXml.includes('$(PROJECT_NAME)'));
check('保存方向：output 路径 → 占位符', tplXml.includes(`output="bin/Debug/${PROJECT_NAME_PLACEHOLDER}"`));
check('保存方向：imp_lib/def → 占位符', tplXml.includes(`imp_lib="${PROJECT_NAME_PLACEHOLDER}.lib"`) && tplXml.includes(`def="${PROJECT_NAME_PLACEHOLDER}.def"`));
check('保存方向：非名称属性不受影响', tplXml.includes('option="-Dname=demo"') && tplXml.includes('pch_mode="2"'));
check('保存方向：pch_mode 等不误替换', !tplXml.includes('pch_mode="$(PROJECT_NAME)"'));

const instXml = applyTemplateNameToXml(tplXml, 'app2');
check('实例化：占位符 → 新工程名', instXml.includes('title="app2"') && instXml.includes('output="bin/Debug/app2"'));
check('实例化：imp_lib/def 亦替换', instXml.includes('imp_lib="app2.lib"') && instXml.includes('def="app2.def"'));
check('实例化：非占位符属性保持', instXml.includes('option="-Dname=demo"'));

// ---- 目录级：保存 → 实例化 往返 ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-tpl-'));
const srcDir = path.join(tmp, 'src-proj');
fs.mkdirSync(path.join(srcDir, 'sub'), { recursive: true });
fs.mkdirSync(path.join(srcDir, 'obj', 'Debug'), { recursive: true });
fs.writeFileSync(path.join(srcDir, 'demo.cbp'), demoXml, 'utf-8');
fs.writeFileSync(path.join(srcDir, 'main.c'), 'int main(){return 0;}\n', 'utf-8');
fs.writeFileSync(path.join(srcDir, 'sub', 'util.c'), 'int util(){return 1;}\n', 'utf-8');
fs.writeFileSync(path.join(srcDir, 'obj', 'Debug', 'main.o'), 'BIN', 'utf-8');

const root = path.join(tmp, 'templates');
const manifest = saveAsUserTemplate({
  root,
  name: 'Demo Starter',
  description: '演示模板',
  projectDir: srcDir,
  cbpPath: path.join(srcDir, 'demo.cbp'),
  projectTitle: 'demo',
  compilerId: 'gcc',
  fileRels: ['main.c', 'sub/util.c', 'missing.c', 'obj/Debug/main.o'],
});
check('保存：清单字段完整', manifest.id === 'demo-starter' && manifest.schema === 1 && manifest.cbp === 'project.cbp',
  [manifest.id, manifest.schema, manifest.cbp]);
check('保存：骨架列表（缺失跳过，其余保留）', JSON.stringify(manifest.files) === JSON.stringify(['main.c', 'sub/util.c', 'obj/Debug/main.o']), manifest.files);
check('保存：template.json 已写', fs.existsSync(path.join(root, 'demo-starter', 'template.json')));
check('保存：project.cbp 已写且含占位符', fs.readFileSync(path.join(root, 'demo-starter', 'project.cbp'), 'utf-8').includes(`title="${PROJECT_NAME_PLACEHOLDER}"`));
check('保存：骨架文件已复制', fs.readFileSync(path.join(root, 'demo-starter', 'sub', 'util.c'), 'utf-8').includes('util()'));

let dupErr = '';
try { saveAsUserTemplate({ root, name: 'Demo Starter', projectDir: srcDir, cbpPath: path.join(srcDir, 'demo.cbp'), projectTitle: 'demo', fileRels: [] }); }
catch (e) { dupErr = e.message; }
check('保存：重名未允许覆盖时报错', dupErr.includes('模板已存在'), dupErr);

const list = listUserTemplates(root);
check('列表：返回 1 个模板', list.length === 1 && list[0].name === 'Demo Starter', list.map((m) => m.name));
check('列表：读取单个模板', getUserTemplate(root, 'demo-starter')?.description === '演示模板');
check('列表：不存在的模板返回 undefined', getUserTemplate(root, 'nope') === undefined);

const outBase = path.join(tmp, 'out');
const res = instantiateUserTemplate(root, 'demo-starter', 'app2', outBase);
check('实例化：工程目录与 cbp 命名', fs.existsSync(res.cbpPath) && path.basename(res.cbpPath) === 'app2.cbp', res.cbpPath);
check('实例化：标题/输出改写为新名', fs.readFileSync(res.cbpPath, 'utf-8').includes('title="app2"') && fs.readFileSync(res.cbpPath, 'utf-8').includes('output="bin/Debug/app2"'));
check('实例化：骨架文件到位', fs.existsSync(path.join(outBase, 'app2', 'main.c')) && fs.existsSync(path.join(outBase, 'app2', 'sub', 'util.c')));
check('实例化：计数正确', res.copiedFiles === 3 && res.missingFiles.length === 0, [res.copiedFiles, res.missingFiles]);

let idErr = '';
try { instantiateUserTemplate(root, 'nope', 'x', outBase); } catch (e) { idErr = e.message; }
check('实例化：未知模板报错', idErr.includes('模板不存在'), idErr);
let nameErr = '';
try { instantiateUserTemplate(root, 'demo-starter', 'bad/name', outBase); } catch (e) { nameErr = e.message; }
check('实例化：非法工程名报错', nameErr.includes('非法字符'), nameErr);

console.log(`用户模板测试: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
