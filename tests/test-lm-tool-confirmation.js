// LM Tool 确认策略回归：写入/执行类需要确认，只读调用不打扰。
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const mock = installVscodeMock({});
const { toolNeedsConfirmation } = require(path.join(ROOT, 'dist', 'lm', 'tools.js'));

check('Q1 project_edit 非 dryRun 需要确认', toolNeedsConfirmation('codeblocks_project_edit', {}) === true);
check('Q2 project_edit dryRun 不需要确认', toolNeedsConfirmation('codeblocks_project_edit', { dryRun: true }) === false);
check('Q3 project_file/target 需要确认',
  toolNeedsConfirmation('codeblocks_project_file', {}) && toolNeedsConfirmation('codeblocks_project_target', {}));
check('Q4 build 不弹确认（显式构建命令）', toolNeedsConfirmation('codeblocks_build', {}) === false);
check('Q5 run 需要确认', toolNeedsConfirmation('codeblocks_run', {}) === true);
check('Q6 debug 查询不确认', toolNeedsConfirmation('codeblocks_debug', { action: 'state' }) === false);
check('Q7 debug 变更需要确认',
  toolNeedsConfirmation('codeblocks_debug', { action: 'start' }) && toolNeedsConfirmation('codeblocks_debug', { action: 'evaluate' }));
check('Q8 workspace 查询不确认', toolNeedsConfirmation('codeblocks_workspace', { action: 'info' }) === false);
check('Q9 workspace open 需要确认', toolNeedsConfirmation('codeblocks_workspace', { action: 'open' }) === true);
check('Q10 export 需要确认', toolNeedsConfirmation('codeblocks_export', { kind: 'makefile' }) === true);
check('Q11 project_read/build_status 不确认',
  !toolNeedsConfirmation('codeblocks_project_read', {}) && !toolNeedsConfirmation('codeblocks_build_status', {}));

mock.restore();
console.log(`\nLM Tool 确认策略回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
