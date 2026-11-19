// F-07：构建前调试器守卫的本地化与取消分支。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');
const i18n = require('../dist/i18n');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-debug-guard-'));
  const app = await activate({ tmpDir: tmp });
  const cbp = path.resolve(__dirname, '../test-project/hello-cb.cbp');
  await app.invoke('codeblocks.openProject', app.vscode.Uri.file(cbp));
  const beforeTasks = app.records.tasks.length;
  app.mock.vscode.debug.activeDebugSession = { id: 's1' };
  const beforeWarnings = app.mock.warnings.length;
  await app.invoke('codeblocks.build');
  const warnings = app.mock.warnings.slice(beforeWarnings);
  check('构建前调试器守卫：弹出本地化确认', warnings.includes(i18n.t('The debugger must be stopped to do a (re-)build.\nDo you want to stop the debugger now?')), warnings);
  check('构建前调试器守卫：取消后不启动构建', app.records.tasks.length === beforeTasks, app.records.tasks.length - beforeTasks, 0);
  const channel = app.mock.channels.find((c) => c.name === 'Code::Blocks');
  check('构建前调试器守卫：输出本地化中止日志', !!channel && channel.lines.some((l) => l.includes(i18n.t('[Code::Blocks] Aborting (re-)build.'))), channel && channel.lines.slice(-3));
  app.mock.vscode.debug.activeDebugSession = undefined;
  await app.deactivate().catch(() => undefined);
  console.log(`调试器构建守卫: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
