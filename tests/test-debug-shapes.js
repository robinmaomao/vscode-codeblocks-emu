// 调试响应归一化回归：LM Tools（DAP）与 CLI/MCP（gdb MI）必须返回同一份形状
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

// debugService 会拉起运行/构建链路（buildEngine 顶层 import vscode），先装宿主替身
const mock = installVscodeMock({});
const { normalizeDebugResult } = require('../dist/api/debugShapes');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

// ---- state ----
const hostState = normalizeDebugResult('state', { active: true, id: 's1', name: 'gdb', type: 'cppdbg' });
check('D1 DAP state 保留 id/name/type', hostState.active === true && hostState.id === 's1' && hostState.name === 'gdb' && hostState.type === 'cppdbg', hostState);
const cliState = normalizeDebugResult('state', { active: true, stopped: true, reason: 'breakpoint', threadId: 1 });
check('D2 gdb state 保留 stopped/reason/threadId', cliState.stopped === true && cliState.reason === 'breakpoint' && cliState.threadId === 1, cliState);
check('D3 inactive 只有 active', JSON.stringify(normalizeDebugResult('state', { active: false })) === '{"active":false}', normalizeDebugResult('state', { active: false }));

// ---- stack ----
const hostStack = normalizeDebugResult('stack', {
  threadId: 1,
  frames: [{ id: 7, name: 'main', file: 'C:/p/main.c', line: 3, column: 5 }],
});
check('D4 DAP 帧 → id/name/file/line/column', hostStack.frames[0].id === 7 && hostStack.frames[0].name === 'main' && hostStack.frames[0].column === 5, hostStack);
const cliStack = normalizeDebugResult('stack', {
  threadId: 1,
  frames: [{ level: 0, addr: '0x401000', func: 'main', file: 'main.c', fullname: 'C:/p/main.c', line: 3 }],
});
check('D5 gdb 帧 → level/name/address/file 归一化，且把 level 暴露为 id',
  cliStack.frames[0].level === 0 && cliStack.frames[0].id === 0 && cliStack.frames[0].name === 'main'
  && cliStack.frames[0].file === 'C:/p/main.c' && cliStack.frames[0].address === '0x401000', cliStack);

// ---- variables ----
const hostVars = normalizeDebugResult('variables', {
  frameId: 2,
  scopes: [{ name: 'Locals', variables: [{ name: 'x', value: '1', type: 'int', children: 0 }] }],
});
check('D6 DAP scopes 原样保留结构', hostVars.frameId === 2 && hostVars.scopes[0].name === 'Locals' && hostVars.scopes[0].variables[0].value === '1', hostVars);
const cliVars = normalizeDebugResult('variables', { variables: [{ name: 'x', value: '1' }] });
check('D7 gdb 扁平变量 → 单个 Locals 作用域', cliVars.scopes.length === 1 && cliVars.scopes[0].name === 'Locals' && cliVars.scopes[0].variables[0].name === 'x', cliVars);

// ---- evaluate ----
check('D8 DAP evaluate → {expression,result,type}',
  JSON.stringify(normalizeDebugResult('evaluate', { expression: 'x', result: '1', type: 'int' })) === JSON.stringify({ expression: 'x', result: '1', type: 'int' }));
check('D9 gdb evaluate 的 value → result',
  JSON.stringify(normalizeDebugResult('evaluate', { expression: 'x', value: '1' })) === JSON.stringify({ expression: 'x', result: '1' }), normalizeDebugResult('evaluate', { expression: 'x', value: '1' }));

// ---- start ----
check('D10 DAP start 保留 session', normalizeDebugResult('start', { ok: true, session: { id: 's1' } }).session.id === 's1');
const cliStart = normalizeDebugResult('start', { ok: true, gdb: 'gdb', program: 'C:/p/a.exe', cwd: 'C:/p', stopped: true, reason: 'entry', threadId: 1 });
check('D11 gdb start → program/cwd/stopped，不泄漏 gdb 实现细节',
  cliStart.program === 'C:/p/a.exe' && cliStart.cwd === 'C:/p' && cliStart.stopped === true && cliStart.gdb === undefined, cliStart);

// ---- 未知 action 原样返回 ----
const raw = { ok: true, extra: 1 };
check('D12 未归一化的 action 原样返回', normalizeDebugResult('stop', raw) === raw);

// ---- 断点号解析（gdb MI 的 bkpt 是嵌套元组字符串） ----
const { parseBreakpointNumber } = require('../dist/api/debugService');
check('D13 解析 -break-insert 的断点号',
  parseBreakpointNumber({ bkpt: '{number="7",type="breakpoint",disp="keep",enabled="y"}' }) === 7,
  parseBreakpointNumber({ bkpt: '{number="7",type="breakpoint"}' }));
check('D14 无 bkpt → undefined', parseBreakpointNumber({}) === undefined);
check('D15 非法断点号 → undefined', parseBreakpointNumber({ bkpt: '{number="x"}' }) === undefined, parseBreakpointNumber({ bkpt: '{number="x"}' }));

mock.restore();
console.log(`\n调试响应归一化: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
