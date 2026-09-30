// 调试协议解析回归（第四十九轮）：
//  - -data-disassemble 解析（mode 0 / mode 1 源码交织）与窗口截取（DAP instructionOffset 语义）
//  - 寄存器名/值解析、内存 hex↔base64、catchpoint 识别
//  - 进程列表（tasklist / ps）解析、指针 memoryReference 判定
//  - 第五十轮修复 7：裸文本行（MinGW GDB 程序 stdout 无 MI 前缀）识别与会话转发
const {
  parseDisassemble, selectWindow, parseQuotedList, parseRegisterValues, parseReadMemory,
  hexToBase64, base64ToHex, parseCatchpointNumbers, parseTasklist, parsePsList, pointerMemoryReference,
  parseStackFrameTuples, parseThreadTuples, mapStopReason, isExitReason, logpointExpressions,
  breakpointLocation, isPendingBreakpoint, isUnframedLine, truthyMiValue, parseInstructionReference,
} = require('../dist/debug/miParse.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- 1. -data-disassemble mode 0 ----
const mode0 = 'asm_insns=[{address="0x401136",func-name="main",offset="4",inst="push %rbp"},{address="0x401137",func-name="main",offset="5",inst="mov %rsp,%rbp"}]';
const i0 = parseDisassemble(mode0);
check('mode0 解析 2 条指令', i0.length === 2 && i0[0].instruction === 'push %rbp' && i0[0].addressValue === 0x401136, i0.length, 2);
check('mode0 func-name 提取', i0[1].symbol === 'main', i0[1].symbol, 'main');

// ---- 2. -data-disassemble mode 1（源码交织）----
const mode1 = 'asm_insns=[src_and_asm_line={line="10",file="src/main.c",line_asm_insn=[{address="0x401100",func-name="foo",inst="nop"},{address="0x401101",func-name="foo",inst="ret"}]},src_and_asm_line={line="12",file="src/main.c",line_asm_insn=[{address="0x401102",func-name="foo",inst="push %rax"}]}]';
const i1 = parseDisassemble(mode1);
check('mode1 解析 3 条指令', i1.length === 3, i1.length, 3);
check('mode1 携带源码行/文件', i1[2].line === 12 && i1[2].file === 'src/main.c', { line: i1[2].line, file: i1[2].file }, 'line=12');

// ---- 3. selectWindow（DAP instructionOffset 语义）----
const insns = [0x100, 0x102, 0x104, 0x106, 0x108].map((a, n) => ({ address: '0x' + a.toString(16), addressValue: a, instruction: 'i' + n }));
let w = selectWindow(insns, 0x102, 0, 2);
check('窗口：正向截取', w.ok && w.list.length === 2 && w.list[0].addressValue === 0x102, w.ok, true);
w = selectWindow(insns, 0x102, 1, 2);
check('窗口：instructionOffset=+1', w.ok && w.list[0].addressValue === 0x104, w.list.map((x) => x.addressValue), [0x104, 0x106]);
w = selectWindow(insns, 0x104, -1, 2);
check('窗口：instructionOffset=-1', w.ok && w.list[0].addressValue === 0x102, w.list.map((x) => x.addressValue), [0x102, 0x104]);
w = selectWindow(insns, 0x100, -1, 1);
check('窗口：越界回退 back', !w.ok && w.need === 'back', w.need, 'back');
w = selectWindow(insns, 0x102, 0, 10);
check('窗口：数量不足回退 forward', !w.ok && w.need === 'forward', w.need, 'forward');
w = selectWindow(insns, 0x9999, 0, 1);
check('窗口：目标超出范围 → forward', !w.ok && w.need === 'forward', w.need, 'forward');

// ---- 4. 寄存器 ----
const names = parseQuotedList('register-names=["rax","rbx","r12","eflags"]');
check('register-names 解析', names.length === 4 && names[2] === 'r12', names, '4 项');
const vals = parseRegisterValues('register-values=[{number="0",value="0x7fffffffe4a0"},{number="3",value="0x246"}]');
check('register-values 解析', vals.length === 2 && vals[1].number === 3 && vals[1].value === '0x246', vals, '2 项');

// ---- 5. 内存 ----
const mem = parseReadMemory('memory=[{begin="0x400000",offset="0x0",end="0x400004",contents="7f454c46"},{begin="0x400004",offset="0x4",end="0x400008",contents="02010100"}]');
check('readMemory 多块拼接', mem === '7f454c4602010100', mem, '16 字符 hex');
check('hex→base64→hex 往返', base64ToHex(hexToBase64(mem)) === mem, base64ToHex(hexToBase64(mem)), mem);

// ---- 6. catchpoint 编号识别 ----
const bl = 'BreakpointTable={nr_rows="2",body=[bkpt={number="1",type="catchpoint",what="exception throw"},{bkpt={number="2",type="breakpoint",what="main"}]}';
const catches = parseCatchpointNumbers(bl);
check('catchpoint 编号识别（仅 catchpoint）', catches.length === 1 && catches[0] === '1', catches, ['1']);

// ---- 7. 进程列表 ----
const tl = '"notepad.exe","1234","Console","1","12,345 K"\r\n"my app.exe","4321","Console","1","80,000 K"\r\n';
const p1 = parseTasklist(tl);
check('tasklist 解析（含空格名）', p1.length === 2 && p1[1].pid === 4321 && p1[1].name === 'my app.exe', p1, '2 项');
const p2 = parsePsList('  PID COMMAND\n    1 init\n 1234 gdb\n');
check('ps 解析（自动去表头）', p2.length === 2 && p2[1].name === 'gdb', p2, '2 项');

// ---- 8. 指针 memoryReference ----
check('指针 → memoryReference', pointerMemoryReference('int *', '0x7ffe1234') === '0x7ffe1234', 'n/a', '0x7ffe1234');
check('非指针 → undefined', pointerMemoryReference('int', '42') === undefined, 'n/a', undefined);
check('指针但值非地址 → undefined', pointerMemoryReference('char *', '0x0 (null)') === undefined, 'n/a', undefined);

// ---- 9. 栈帧解析（第五十轮 D3：逐 tuple，file/line 必须捕获，fullname 优先）----
const stackSample = 'stack=[frame={level="0",addr="0x4015a6",func="main",file="main.c",fullname="E:\\proj\\main.c",line="12"},frame={level="1",addr="0x7ff1",func="__libc_start_main",file="libc-start.c",fullname="E:\\libc\\libc-start.c",line="308"}]';
const frames = parseStackFrameTuples(stackSample.slice('stack='.length));
check('栈帧：捕获 2 帧', frames.length === 2, frames.length, 2);
check('栈帧：file/line 不再丢失（旧正则缺陷）', frames[0].file === 'main.c' && frames[0].line === 12, { file: frames[0].file, line: frames[0].line }, 'main.c:12');
check('栈帧：fullname 可获取', frames[0].fullname === 'E:\\proj\\main.c', frames[0].fullname, 'E:\\proj\\main.c');
check('栈帧：addr 可获取（Step Out 返回地址用）', frames[1].addr === '0x7ff1', frames[1].addr, '0x7ff1');
check('栈帧：无 file/line 时安全', parseStackFrameTuples('stack=[frame={level="0",func="foo"}]'.slice('stack='.length))[0].file === undefined, 'n/a', undefined);

// ---- 10. 线程解析（逐 tuple）----
const threads = parseThreadTuples('threads=[{id="1",target-id="Thread 0x1",name="main"},{id="2",target-id="Thread 0x2"}]');
check('线程：id/name 解析', threads.length === 2 && threads[0].name === 'main' && threads[1].name === undefined, threads, '2 项');

// ---- 11. 停止原因映射（第五十轮 D5）----
const cases = [
  ['breakpoint-hit', undefined, 'breakpoint'],
  ['watchpoint-trigger', undefined, 'data breakpoint'],
  ['read-watchpoint-trigger', undefined, 'data breakpoint'],
  ['end-stepping-range', undefined, 'step'],
  ['function-finished', undefined, 'step'],
  ['location-reached', undefined, 'goto'],
  ['signal-received', 'SIGINT', 'pause'],
  ['signal-received', 'SIGSEGV', 'exception'],
  ['exception-received', undefined, 'exception'],
  ['something-new', undefined, 'breakpoint'],
];
check('停止原因映射全集', cases.every(([mi, sig, want]) => mapStopReason(mi, sig) === want), cases.filter(([mi, sig, want]) => mapStopReason(mi, sig) !== want), '全部符合');
check('退出原因识别', isExitReason('exited-normally') && isExitReason('exited') && !isExitReason('breakpoint-hit'), 'n/a', '仅退出类为真');

// ---- 12. 日志断点表达式提取（第五十轮 D4）----
const exprs = logpointExpressions('x={x}, y={a.b}, again={x}');
check('logpoint 占位提取（去重、保序）', exprs.length === 2 && exprs[0] === 'x' && exprs[1] === 'a.b', exprs, ['x', 'a.b']);
check('logpoint 无占位 → 空', logpointExpressions('hello').length === 0, 'n/a', 0);

// ---- 13. 断点位置串 / pending 识别（第五十轮修复 3）----
check('位置串：文件:行号', breakpointLocation('E:\\a b\\main.c', 7) === 'E:\\a b\\main.c:7', 'n/a', 'E:\\a b\\main.c:7');
check('pending 识别：真', isPendingBreakpoint('bkpt={number="1",addr="<PENDING>",pending="Z:\\x.c:1"}'), 'n/a', true);
check('pending 识别：假', !isPendingBreakpoint('bkpt={number="1",addr="0x40155d",func="main"}'), 'n/a', false);

// ---- 14. 裸文本行识别（第五十轮修复 7）----
check('裸文本：程序输出行', isUnframedLine('hello-cb: 2 + 3 = 5') === true, 'n/a', true);
check('裸文本：(gdb) 提示符排除', isUnframedLine('(gdb) ') === false, 'n/a', false);
check('裸文本：~ 流排除', isUnframedLine('~"x"') === false, 'n/a', false);
check('裸文本：@ 流排除', isUnframedLine('@"x"') === false, 'n/a', false);
check('裸文本：& 流排除', isUnframedLine('&"x"') === false, 'n/a', false);
check('裸文本：结果记录排除', isUnframedLine('2^done') === false, 'n/a', false);
check('裸文本：异步记录排除', isUnframedLine('*stopped,reason="x"') === false, 'n/a', false);
check('裸文本：通知记录排除', isUnframedLine('=thread-created,id="1"') === false, 'n/a', false);
check('裸文本：空行/空白排除', isUnframedLine('') === false && isUnframedLine('   ') === false, 'n/a', false);

// ---- 15. 会话层：裸文本 → 程序输出（集成，无 GDB 进程）----
const { GdbMiSession } = require('../dist/debug/gdbMiSession.js');
const sess = new GdbMiSession();
const events = [];
sess.onTargetOutput = (t) => events.push(t);
sess.onConsole = (t) => events.push('[console]' + t);
sess['feed']('1^done\r\n');
sess['feed']('(gdb) \r\n');
sess['feed']('hello-cb: 2 + 3 = 5\r\n');
sess['feed']('~"[New Thread 1.2]"\r\n');
check('会话：裸文本行 → 程序输出', events.includes('hello-cb: 2 + 3 = 5'), events, "含 'hello-cb: 2 + 3 = 5'");
check('会话：(gdb) 提示符不进入输出', !events.some((e) => e.startsWith('(gdb)')), events, '无 (gdb)');
check('会话：~ 流仍走 console 不进 stdout', events.includes('[console][New Thread 1.2]') && !events.includes('[New Thread 1.2]'), events, 'console 分类');

// ---- 16. 条件求值结果判定（第五十轮修复 9：条件断点客户端求值）----
check('条件求值：1/true → 真', truthyMiValue('1') === true && truthyMiValue('true') === true, 'n/a', true);
check('条件求值：0/false → 假', truthyMiValue('0') === false && truthyMiValue('false') === false, 'n/a', false);
check('条件求值：0x5 真 / 0x0 假', truthyMiValue('0x5') === true && truthyMiValue('0x0') === false, 'n/a', '0x5/0x0');
check('条件求值：非零十进制', truthyMiValue('42') === true, 'n/a', true);
check('条件求值：空值 → 假', truthyMiValue('') === false && truthyMiValue('  ') === false, 'n/a', false);

// ---- 17. 指令断点地址解析（第五十一轮 E1）----
check('指令地址：0x 引用', parseInstructionReference('0x40156c', 0) === 0x40156c, 'n/a', 0x40156c);
check('指令地址：偏移叠加', parseInstructionReference('0x40156c', 4) === 0x401570, 'n/a', 0x401570);
check('指令地址：十进制引用', parseInstructionReference('4199788', 0) === 4199788, 'n/a', 4199788);
check('指令地址：非法/空 → null', parseInstructionReference('xx', 0) === null && parseInstructionReference('', 0) === null, 'n/a', null);

console.log(`调试协议解析回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
