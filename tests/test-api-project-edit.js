// Agent 控制层：工程读取 / 增量编辑 / 定点改写（无 vscode 宿主）
const fs = require('fs');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser');
const { projectSnapshot, workspaceSnapshot } = require('../dist/api/projectQuery');
const { editProject } = require('../dist/api/projectService');
const { applyEdits, applyUnitOptionToText, isPreserveCapable } = require('../dist/api/projectEdit');
const { loadWorkspace } = require('../dist/api/projectStore');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-project-edit');
const SRC = path.join(ROOT, 'test-project');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

function freshCopy(name) {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(SRC)) {
    const from = path.join(SRC, entry);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, entry));
  }
  return path.join(dir, 'hello-cb.cbp');
}

// ---------- 1. 快照 ----------
const project = new ProjectParser().parse(path.join(SRC, 'hello-cb.cbp'));
const summary = projectSnapshot(project, { section: 'summary' }).summary;
check('S1 summary 基本信息', summary.title === 'hello-cb' && summary.compilerId === 'gcc' && summary.targetCount === 2, summary);
check('S2 summary 文件数', summary.fileCount === 3, summary.fileCount);

const targets = projectSnapshot(project, { section: 'targets' }).targets;
check('S3 targets 列表', Array.isArray(targets) && targets.length === 2 && targets.every((t) => typeof t.outputFilename === 'string'));
const debugTarget = projectSnapshot(project, { section: 'targets', target: 'Debug' }).targets;
check('S4 单目标过滤', debugTarget.length === 1 && debugTarget[0].title === 'Debug');
const files = projectSnapshot(project, { section: 'files' }).files;
check('S5 files 列表', files.length === 3 && files.some((f) => f.file === 'main.c'));

const schema = projectSnapshot(project, { section: 'schema' }).schema;
check('S6 schema 含白名单', schema.project.length > 10 && schema.target.length > 10 && schema.file.length > 3 && Array.isArray(schema.ops));

const ws = workspaceSnapshot(loadWorkspace(path.join(SRC, 'dep-test.workspace')));
check('S7 workspace 快照', Array.isArray(ws.projects) && ws.projects.length >= 2 && typeof ws.dependencies === 'object', ws);

// ---------- 2. 增量编辑 ----------
const cbp = freshCopy('edit');
const r1 = editProject(cbp, [
  { op: 'set', scope: 'project', field: 'title', value: 'edited-title' },
  { op: 'add', scope: 'target', target: 'Debug', field: 'compilerOptions', value: '-std=c++17' },
  { op: 'set', scope: 'file', file: 'main.c', field: 'weight', value: 5 },
]);
check('E1 编辑成功并写盘', r1.ok && r1.written && r1.changed.length === 3, r1.changed);
const reparsed = new ProjectParser().parse(cbp);
check('E2 标题写回', reparsed.title === 'edited-title', reparsed.title);
check('E3 目标选项写回', reparsed.buildTargets.find((t) => t.title === 'Debug').compilerOptions.includes('-std=c++17'));
check('E4 文件权重写回', reparsed.files.find((f) => f.relativeFilename === 'main.c').weight === 5);

// 新增/重命名/删除目标
const r2 = editProject(cbp, [
  { op: 'addTarget', title: 'Custom', copyFrom: 'Release', targetType: 0 },
  { op: 'renameTarget', title: 'Custom', to: 'Custom2' },
]);
check('E5 目标增删改', r2.ok && r2.changed.length === 2, r2.changed);
const afterTargets = new ProjectParser().parse(cbp);
check('E6 重命名生效', afterTargets.buildTargets.some((t) => t.title === 'Custom2') && !afterTargets.buildTargets.some((t) => t.title === 'Custom'));

// 新增文件（先创建真实文件）
fs.writeFileSync(path.join(path.dirname(cbp), 'added.c'), 'int added(void){return 0;}\n');
const r3 = editProject(cbp, [{ op: 'addFile', file: 'added.c', targets: ['Debug'], compile: true, link: false }]);
check('E7 新增文件', r3.ok && r3.written, r3.changed);
const afterAdd = new ProjectParser().parse(cbp);
const added = afterAdd.files.find((f) => f.relativeFilename === 'added.c');
check('E8 新文件属性', !!added && added.compile === true && added.link === false && added.buildTargets.includes('Debug'), added && { compile: added.compile, link: added.link, targets: added.buildTargets });
const dbg = afterAdd.buildTargets.find((t) => t.title === 'Debug');
const rel = afterAdd.buildTargets.find((t) => t.title === 'Release');
check('E8b 目标 files 同步（仅 Debug）', dbg.files.some((f) => f.relativeFilename === 'added.c') && !rel.files.some((f) => f.relativeFilename === 'added.c'), {
  debug: dbg.files.map((f) => f.relativeFilename), release: rel.files.map((f) => f.relativeFilename),
});
check('E8c project.files 与 target.files 同一对象', dbg.files.find((f) => f.relativeFilename === 'added.c') === added);

// 无 targets 的新文件 = 属于所有目标
fs.writeFileSync(path.join(path.dirname(cbp), 'all.c'), 'int all_fn(void){return 1;}\n');
const rAll = editProject(cbp, [{ op: 'addFile', file: 'all.c' }]);
const afterAll = new ProjectParser().parse(cbp);
const allEntry = afterAll.files.find((f) => f.relativeFilename === 'all.c');
check('E8d 无 targets 归属所有目标', rAll.ok && afterAll.buildTargets.every((t) => t.files.some((f) => f.relativeFilename === 'all.c')), afterAll.buildTargets.map((t) => t.title));

// 编辑已加入文件后，目标侧引用同步（共享对象）
editProject(cbp, [{ op: 'set', scope: 'file', file: 'added.c', field: 'compile', value: false }]);
const afterToggle = new ProjectParser().parse(cbp);
check('E8e 文件编辑影响目标列表', afterToggle.buildTargets.find((t) => t.title === 'Debug').files.find((f) => f.relativeFilename === 'added.c').compile === false);

// 校验：未知字段 / 枚举越界 / 脚本门控 / 不安全路径
function expectFail(name, fn, code) {
  try {
    fn();
    check(name, false, 'no error');
  } catch (err) {
    check(name, err && err.code === code, err && err.message);
  }
}
const p2 = new ProjectParser().parse(cbp);
expectFail('V1 未知字段报错', () => applyEdits(p2, [{ op: 'set', scope: 'project', field: 'nope', value: 1 }]), 'invalid-input');
expectFail('V2 枚举越界报错', () => applyEdits(p2, [{ op: 'set', scope: 'target', target: 'Debug', field: 'targetType', value: 99 }]), 'invalid-input');
expectFail('V3 脚本字段需 allowScripts', () => applyEdits(p2, [{ op: 'set', scope: 'project', field: 'commandsBeforeBuild', value: ['echo hi'] }]), 'invalid-input');
const allowed = applyEdits(p2, [{ op: 'set', scope: 'project', field: 'commandsBeforeBuild', value: ['echo hi'] }], { allowScripts: true });
check('V4 allowScripts 放行', allowed.changed.length === 1);
expectFail('V5 不存在的目标报错', () => applyEdits(p2, [{ op: 'set', scope: 'target', target: 'Nope', field: 'outputFilename', value: 'x' }]), 'invalid-input');
expectFail('V6 不存在的文件报错', () => applyEdits(p2, [{ op: 'set', scope: 'file', file: 'nope.c', field: 'compile', value: false }]), 'invalid-input');
expectFail('V7 新增不存在的文件报错', () => applyEdits(p2, [{ op: 'addFile', file: 'ghost.c' }]), 'invalid-input');
// 运行时类型校验（MCP/CLI 的 JSON 入参没有 TS 类型兜底，不能变成 TypeError → io-error）
expectFail('V8 addTarget.title 非字符串报错', () => applyEdits(p2, [{ op: 'addTarget', title: 42 }]), 'invalid-input');
expectFail('V9 addVirtualTarget.targets 非数组报错', () => applyEdits(p2, [{ op: 'addVirtualTarget', alias: 'VT', targets: 'Debug' }]), 'invalid-input');
expectFail('V10 addFile.targets 非数组报错', () => applyEdits(p2, [{ op: 'addFile', file: 'util.c', targets: 'Debug' }]), 'invalid-input');
expectFail('V11 addFile.weight 非数字报错', () => applyEdits(p2, [{ op: 'addFile', file: 'util.c', weight: 'x' }]), 'invalid-input');
expectFail('V14 addFile.weight 越界（>100）报错', () => applyEdits(p2, [{ op: 'addFile', file: 'util.c', weight: 500 }]), 'invalid-input');
expectFail('V15 文件归属引用未知目标报错', () => applyEdits(p2, [{ op: 'set', scope: 'file', file: 'main.c', field: 'buildTargets', value: ['NoSuchTarget'] }]), 'invalid-input');
expectFail('V12 未知 scope 报错', () => applyEdits(p2, [{ op: 'set', scope: 'targt', field: 'title', value: 'x' }]), 'invalid-input');
expectFail('V13 renameFile 目标已存在报错', () => applyEdits(p2, [{ op: 'renameFile', file: 'util.c', to: 'main.c' }]), 'invalid-input');

// dryRun 不写盘
const beforeDry = fs.readFileSync(cbp, 'utf8');
const dry = editProject(cbp, [{ op: 'set', scope: 'project', field: 'notes', value: 'dry' }], { dryRun: true });
check('E9 dryRun 不写盘', dry.ok && !dry.written && fs.readFileSync(cbp, 'utf8') === beforeDry && typeof dry.preview === 'string');

// ---------- 3. preserve 定点改写 ----------
const pcbp = freshCopy('preserve');
const before = fs.readFileSync(pcbp, 'utf8');
check('P1 preserve 能力判定', isPreserveCapable([{ op: 'set', scope: 'file', file: 'main.c', field: 'compile', value: false }]));
check('P2 非白名单不可 preserve', !isPreserveCapable([{ op: 'set', scope: 'project', field: 'title', value: 'x' }]));
const rp = editProject(pcbp, [{ op: 'set', scope: 'file', file: 'main.c', field: 'compile', value: false }], { format: 'preserve' });
const after = fs.readFileSync(pcbp, 'utf8');
check('P3 preserve 写入', rp.ok && rp.written && rp.format === 'preserve');
check('P4 preserve 仅改 Unit 节点', after.includes('<Option compile="0" />') && after.replace(/\s*<Unit filename="main\.c">[\s\S]*?<\/Unit>/, '') === before.replace(/\s*<Unit filename="main\.c" \/>/, ''), after.slice(0, 0));
const rpBack = editProject(pcbp, [{ op: 'set', scope: 'file', file: 'main.c', field: 'compile', value: true }], { format: 'preserve' });
check('P5 preserve 恢复为自闭合', rpBack.ok && fs.readFileSync(pcbp, 'utf8').includes('<Unit filename="main.c" />'));

// preserve 遇到不支持的操作 → 自动降级 canonical 并告警
const rFallback = editProject(pcbp, [{ op: 'set', scope: 'project', field: 'title', value: 'fallback' }], { format: 'preserve' });
check('P6 不支持的操作降级 canonical', rFallback.ok && rFallback.format === 'canonical' && rFallback.warnings.length === 1, rFallback.warnings);

// preserve：含 XML 特殊字符的路径必须按转义形式匹配并回写（磁盘上是 &amp; / &lt; / &quot;）
{
  const text = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n\t<Project>\n\t\t<Unit filename="a&amp;b.c">\n\t\t\t<Option compile="1" />\n\t\t</Unit>\n'
    + '\t\t<Unit filename="c&lt;d.c" />\n\t</Project>\n</CodeBlocks_project_file>\n';
  const off = applyUnitOptionToText(text, 'a&b.c', 'compile', false);
  check('P7 转义路径：禁用写入 compile="0" 且保留转义',
    off.changed && off.text.includes('filename="a&amp;b.c"') && off.text.includes('<Option compile="0" />'), off.text.slice(0, 120));
  const on = applyUnitOptionToText(off.text, 'a&b.c', 'compile', true);
  check('P8 转义路径：启用恢复自闭合', on.changed && on.text.includes('<Unit filename="a&amp;b.c" />'), on.text.slice(0, 120));
  const lt = applyUnitOptionToText(text, 'c<d.c', 'link', false);
  check('P9 转义路径：自闭合 → 成对节点', lt.changed && lt.text.includes('filename="c&lt;d.c">') && lt.text.includes('<Option link="0" />'), lt.text.slice(0, 160));
  // 规范化：`\` 与 `./` 前缀按文件名匹配
  const norm = applyUnitOptionToText(text, '.\\a&b.c', 'compile', false);
  check('P10 反斜杠/前缀规范化后命中', norm.changed, norm);
  let missing = false;
  try { applyUnitOptionToText(text, 'nope.c', 'compile', false); } catch (err) { missing = err.code === 'invalid-input'; }
  check('P11 不存在的文件报 invalid-input', missing);
}

// preserve + dryRun：返回预览文本且不写盘
{
  const beforeDry = fs.readFileSync(pcbp, 'utf8');
  const dryP = editProject(pcbp, [{ op: 'set', scope: 'file', file: 'main.c', field: 'compile', value: false }], { format: 'preserve', dryRun: true });
  check('P12 preserve dryRun 返回 preview 且不写盘',
    dryP.ok === true && dryP.written === false && typeof dryP.preview === 'string' && dryP.preview.includes('<Option compile="0" />')
    && fs.readFileSync(pcbp, 'utf8') === beforeDry, { written: dryP.written, hasPreview: typeof dryP.preview === 'string' });
}

// 清理
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\nAgent 控制层（工程编辑）: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
