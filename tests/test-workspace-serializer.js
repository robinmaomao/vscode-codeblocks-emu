// P1-1：.workspace 序列化（工程顺序 / active / 依赖 / 相对路径 / XML 转义）
const fs = require('fs');
const os = require('os');
const path = require('path');

const { buildWorkspaceEntries, serializeWorkspace, workspaceRelativePath } = require('../dist/model/workspaceSerializer.js');
const { WorkspaceParser } = require('../dist/model/parser.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const base = path.join('C:', 'work', 'ws');
const app = path.join(base, 'app', 'app.cbp');
const lib = path.join(base, 'lib', 'lib.cbp');
check('相对路径使用正斜杠', workspaceRelativePath(base, app) === 'app/app.cbp', workspaceRelativePath(base, app), 'app/app.cbp');

const projects = [{ filename: app }, { filename: lib }];
const deps = { [app]: [lib], [lib]: [] };
const entries = buildWorkspaceEntries(base, projects, deps, app);
check('保持工程顺序', entries.map((e) => e.filename).join(',') === 'app/app.cbp,lib/lib.cbp', entries, 'app,lib');
check('active 只标一个', entries[0].active === true && entries[1].active === false, entries.map((e) => e.active), [true, false]);
check('依赖相对路径', entries[0].dependencies[0] === 'lib/lib.cbp', entries[0].dependencies, ['lib/lib.cbp']);
check('无依赖工程不写 dependencies', entries[1].dependencies === undefined, entries[1].dependencies, undefined);

const xml = serializeWorkspace('A&B workspace', entries);
check('标题 XML 转义', xml.includes('title="A&amp;B workspace"'), xml.split('\n')[2], '&amp;');
check('active 属性写出', xml.includes('<Project filename="app/app.cbp" active="1">'), xml, 'active=1');
check('依赖节点写出', xml.includes('<Depends filename="lib/lib.cbp" />'), xml, '<Depends>');
check('无依赖工程自闭合', xml.includes('<Project filename="lib/lib.cbp" />'), xml, 'self-closing');

// 往返：写到临时文件后用 WorkspaceParser 解析
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ws-ser-'));
try {
  const file = path.join(dir, 'app.workspace');
  fs.writeFileSync(file, xml, 'utf-8');
  const ws = new WorkspaceParser().parse(file);
  check('解析标题', ws.title === 'A&B workspace', ws.title, 'A&B workspace');
  check('解析工程顺序', ws.projectPaths.join(',') === 'app/app.cbp,lib/lib.cbp', ws.projectPaths, 'app,lib');
  check('解析 active', ws.activeProject === 'app/app.cbp', ws.activeProject, 'app/app.cbp');
  check('解析依赖', (ws.dependencies['app/app.cbp'] || []).join(',') === 'lib/lib.cbp', ws.dependencies, 'lib');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// 空工作区
const empty = serializeWorkspace('Default workspace', []);
check('空工作区有 Workspace 节点', empty.includes('<Workspace title="Default workspace">') && empty.includes('</Workspace>'), empty, 'ok');

console.log('workspace-serializer: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
