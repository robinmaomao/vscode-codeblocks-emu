// Set Programs' Arguments 对话框（对齐 Code::Blocks SelectTargetDlg）回归：
//  - 页面结构：目标列表 / 默认执行目标 / Program arguments / Host application + 浏览 / Run host in terminal / OK+Cancel
//  - 脚本行为：切换目标暂存、默认目标互斥、双击 = OK、浏览结果回填
//  - 模型：<Option default_target> 解析 / 写出条件（对齐 projectloader.cpp:1506）
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const { installVscodeMock } = require('./_harness/vscodeMock');
installVscodeMock({ config: {} });

const { runTargetsPage } = require('../dist/ui/runTargetsPanel');
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');

const sample = {
  projectTitle: 'demo',
  commonTopLevelPath: ROOT,
  defaultExecuteTarget: 'Release',
  activeTarget: 'Debug',
  targets: [
    { title: 'Debug', executionParameters: '--verbose', hostApplication: 'bin/host.exe', runHostApplicationInTerminal: false },
    { title: 'Release', executionParameters: '', hostApplication: '', runHostApplicationInTerminal: true },
  ],
};
const html = runTargetsPage(sample);

// ---------- 页面结构 ----------
check('对话框：目标列表容器', /id="rt-list"/.test(html), null);
check('对话框：默认执行目标复选框', /<label class="rt-check"><input type="checkbox" id="rt-default"><span>[^<]+<\/span><\/label>/.test(html), null);
check('对话框：Program arguments 多行输入', /id="rt-params"/.test(html) && /<textarea[^>]*id="rt-params"/.test(html), null);
check('对话框：Host application 输入 + 浏览按钮', /id="rt-host"/.test(html) && /id="rt-browse"/.test(html), null);
check('对话框：Run host in terminal 复选框', /id="rt-terminal"/.test(html), null);
check('对话框：OK / Cancel 按钮（OK 为默认按钮）', /id="rt-ok"[^>]*class="default"/.test(html) && /id="rt-cancel"/.test(html), null);
check('对话框：BOOT 内嵌全部目标与默认目标', /"title":"Debug"/.test(html) && /"defaultExecuteTarget":"Release"/.test(html), null);

// ---------- 脚本行为 ----------
check('脚本：切换目标前暂存当前编辑值（对齐 UpdateSelected）', /function stash\(\)/.test(html) && /if \(last < 0 \|\| !DATA\.targets\[last\]\) return;/.test(html), null);
check('脚本：默认执行目标互斥（勾选即覆盖、取消即清空）', /DATA\.defaultExecuteTarget = t\.title;/.test(html) && /DATA\.defaultExecuteTarget = '';/.test(html), null);
check('脚本：双击目标行等同 OK', /addEventListener\('dblclick'/.test(html) && /submit\(\);/.test(html), null);
check('脚本：浏览结果回填宿主程序', /msg\.type === 'browsed'/.test(html) && /q\('rt-host'\)\.value = msg\.value/.test(html), null);
check('脚本：初始选中优先活动目标，其次默认执行目标', /DATA\.activeTarget/.test(html) && /DATA\.defaultExecuteTarget\) \{/.test(html), null);

// ---------- 模型：default_target ----------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-run-targets-'));
const cbp = path.join(tmpDir, 'demo.cbp');
fs.writeFileSync(cbp, [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
  '<CodeBlocks_project_file>',
  '\t<FileVersion major="1" minor="6" />',
  '\t<Project>',
  '\t\t<Option title="demo" />',
  '\t\t<Option compiler="gcc" />',
  '\t\t<Option default_target="Release" />',
  '\t\t<Build>',
  '\t\t\t<Target title="Debug">',
  '\t\t\t\t<Option type="1" />',
  '\t\t\t\t<Option output="bin/Debug/demo" />',
  '\t\t\t\t<Option parameters="--debug" />',
  '\t\t\t\t<Option host_application="bin/host.exe" />',
  '\t\t\t\t<Option run_host_application_in_terminal="0" />',
  '\t\t\t</Target>',
  '\t\t\t<Target title="Release">',
  '\t\t\t\t<Option type="1" />',
  '\t\t\t\t<Option output="bin/Release/demo" />',
  '\t\t\t</Target>',
  '\t\t</Build>',
  '\t</Project>',
  '</CodeBlocks_project_file>',
].join('\n'), 'utf8');

const project = new ProjectParser().parse(cbp);
check('模型：解析 <Option default_target>', project.defaultExecuteTarget === 'Release', project.defaultExecuteTarget);
check('模型：解析目标执行参数与宿主程序', project.buildTargets[0].executionParameters === '--debug'
  && project.buildTargets[0].hostApplication === 'bin/host.exe'
  && project.buildTargets[0].runHostApplicationInTerminal === false, project.buildTargets[0]);
const firstOut = serializeProject(project);
check('写回：default_target 非第一个目标时写出', /<Option default_target="Release" \/>/.test(firstOut), null);

project.defaultExecuteTarget = 'Debug'; // 等于第一个目标 → CB 不写
const sameAsFirst = serializeProject(project);
check('写回：default_target 等于第一个目标时不写（对齐 projectloader.cpp:1506）', !/default_target=/.test(sameAsFirst), null);

project.defaultExecuteTarget = '';
const cleared = serializeProject(project);
check('写回：default_target 为空时不写', !/default_target=/.test(cleared), null);

fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\nrun-targets-panel: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
