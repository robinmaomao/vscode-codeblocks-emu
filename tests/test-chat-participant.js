// @codeblocks 命令解析回归（无宿主）。
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const { planParticipantCommand } = require(path.join(ROOT, 'dist', 'chat', 'commands.js'));

const read = planParticipantCommand('read', 'Debug');
check('P1 /read 带 target', read.kind === 'tool' && read.tool === 'codeblocks_project_read' && read.input.target === 'Debug', read);
const readAll = planParticipantCommand('read', '');
check('P2 /read 无 target 使用 summary', readAll.input && readAll.input.section === 'summary' && readAll.input.target === undefined, readAll);

const build = planParticipantCommand('build', 'Release --rebuild');
check('P3 /build 解析 target 与 --rebuild', build.tool === 'codeblocks_build' && build.input.target === 'Release' && build.input.mode === 'rebuild', build);
const clean = planParticipantCommand('build', '--clean');
check('P4 /build --clean 模式', clean.input.mode === 'clean' && clean.input.target === undefined, clean);

const fix = planParticipantCommand('fix', '');
check('P5 /fix 读取 error 诊断', fix.tool === 'codeblocks_build_status' && fix.input.severity === 'error', fix);

const dbg = planParticipantCommand('debug', 'stack');
check('P6 /debug stack', dbg.tool === 'codeblocks_debug' && dbg.input.action === 'stack', dbg);
const step = planParticipantCommand('debug', 'step out');
check('P7 /debug step out', step.input.action === 'step' && step.input.kind === 'stepOut', step);
const bad = planParticipantCommand('debug', 'fly');
check('P8 未知 /debug 动作报错', bad.kind === 'error', bad);

check('P9 /status 返回 status', planParticipantCommand('status', '').kind === 'status');
check('P10 未给命令回退 help', planParticipantCommand(undefined, '').kind === 'help');
check('P11 /help 返回 help', planParticipantCommand('help', '').kind === 'help');
check('P12 未知命令报错', planParticipantCommand('nope', '').kind === 'error');
check('P13 /history 返回 history', planParticipantCommand('history', '').kind === 'history');
check('P14 /undo 返回 undo', planParticipantCommand('undo', '').kind === 'undo');

console.log(`\n@codeblocks 命令解析回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
