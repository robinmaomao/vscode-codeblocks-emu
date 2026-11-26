// G1：.workspace 外部修改跟踪（复用 ProjectChangeTracker 的 mtime+size 语义）
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ProjectChangeTracker } = require('../dist/project/projectChangeTracker.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ws-change-'));
try {
  const ws = path.join(dir, 'app.workspace');
  fs.writeFileSync(ws, '<CodeBlocks_workspace_file>\n\t<Workspace title="A">\n\t\t<Project filename="a.cbp" />\n\t</Workspace>\n</CodeBlocks_workspace_file>\n');

  const tracker = new ProjectChangeTracker();
  check('未 remember 时不报告变化（避免打开前误报）', tracker.hasChanged(ws) === false, tracker.hasChanged(ws), false);
  tracker.remember(ws);
  check('remember 后立即检查无变化', tracker.hasChanged(ws) === false, tracker.hasChanged(ws), false);
  check('isTracked 命中', tracker.isTracked(ws) === true, tracker.isTracked(ws), true);

  // 内容变化（长度不同）
  fs.writeFileSync(ws, '<CodeBlocks_workspace_file>\n\t<Workspace title="A">\n\t\t<Project filename="a.cbp" active="1" />\n\t</Workspace>\n</CodeBlocks_workspace_file>\n');
  check('外部修改后报告变化', tracker.hasChanged(ws) === true, tracker.hasChanged(ws), true);

  tracker.remember(ws);
  check('重新 remember（忽略/重载后）不再报告', tracker.hasChanged(ws) === false, tracker.hasChanged(ws), false);

  // 同长度修改也必须能检测（mtime + size 口径）
  const before = fs.readFileSync(ws, 'utf8');
  fs.writeFileSync(ws, before.replace('title="A"', 'title="B"'));
  // CI 上连续写入可能落在同一 mtime 时间片；显式推进 mtime，验证 signature 变化路径
  const bumped = new Date(Date.now() + 1000);
  fs.utimesSync(ws, bumped, bumped);
  check('同长度内容修改仍能检测', tracker.hasChanged(ws) === true, tracker.hasChanged(ws), true);

  tracker.forget(ws);
  check('forget 后不跟踪', tracker.isTracked(ws) === false, tracker.isTracked(ws), false);
  check('forget 后不报告变化', tracker.hasChanged(ws) === false, tracker.hasChanged(ws), false);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('workspace-change-tracker: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
