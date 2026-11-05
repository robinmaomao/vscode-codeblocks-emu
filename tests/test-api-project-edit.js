// Agent 控制层：工程读取 / 增量编辑 / 定点改写（无 vscode 宿主）
const fs = require('fs');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser');
const { projectSnapshot, workspaceSnapshot } = require('../dist/api/projectQuery');
const { editProject } = require('../dist/api/projectService');
const { applyEdits, isPreserveCapable } = require('../dist/api/projectEdit');
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

// 清理
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\nAgent 控制层（工程编辑）: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
