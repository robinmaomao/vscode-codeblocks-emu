// L1 真实 GDB 调试 E2E（DAP 协议级，真实 gdb 8.1 + 真实被调试进程）
//
// 覆盖：launch / 断点（普通·条件·命中次数·日志点）/ 单步（行级·步入·步出·指令级）/
//       线程 / 调用栈 / 作用域与变量（含嵌套结构展开）/ 变量修改 / 表达式求值 /
//       反汇编 / 内存读写 / 数据断点 / 指令断点 / 运行到光标（gotoTargets+goto）/
//       Set Next Statement / 异常断点 / 用户命令透传 / 断线终止 /
//       attach(+Detach 不杀进程) / 多线程帧切换（指定线程 ID 取帧与帧下变量）/ 运行中请求防护 /
//       stopOnEntry 入口首停（reason=entry；含关闭对照、GUI 入口符号候选与入口地址兜底）
//
// 用法：node tests/e2e/test-e2e-debug.js [--filter <子串>]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { installVscodeMock } = require('../_harness/vscodeMock');

const args = process.argv.slice(2);
const filter = args.find((a) => a.startsWith('--filter='))?.split('=')[1]
  || (args.includes('--filter') ? args[args.indexOf('--filter') + 1] : '');

let pass = 0, fail = 0, skip = 0;
const failures = [];
function check(name, cond, got, want) {
  if (filter && !name.includes(filter)) return;
  if (cond) { pass++; console.log('OK   ' + name); }
  else {
    fail++;
    failures.push(name);
    console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`);
  }
}
function skipCheck(name, reason) {
  if (filter && !name.includes(filter)) return;
  skip++;
  console.log(`SKIP ${name}  ${reason}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(40);
  }
  return false;
}
function findTool(name) {
  const w = spawnSync('where.exe', [name], { encoding: 'utf-8', windowsHide: true });
  if (w.status === 0) {
    const first = (w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  }
  return undefined;
}

// ---------- 探针程序 ----------
const PROBE_C = `#include <windows.h>
#include <stdio.h>

typedef struct { int a; int b; } Inner;
typedef struct { Inner in; char name[8]; double ratio; } Outer;

int g_counter = 0;
double g_ratio = 1.5;
Outer g_outer = { {1,2}, "abc", 3.25 };

int add(int x, int y) { return x + y; }                       /* MARK:ENDFN_ADD */

int compute(int n) {
    int total = 0;
    for (int i = 0; i < n; i++) {
        g_counter += i;                                        /* MARK:LOOP */
        total += add(i, 1);
    }
    return total;
}

DWORD WINAPI worker(LPVOID p) {
    (void)p;
    for (int i = 0; i < 100000000; i++) { g_counter++; }
    // 长驻：便于 attach/多线程场景在该线程断点命中（每次循环都执行本行）
    for (int w = 0; w < 1000000000; w++) {
        g_counter++;
        Sleep(1);                                              /* MARK:WORKER_KEEPALIVE */
    }
    return 0;
}

int main(void) {
    int local_a = 10;
    int local_b = 32;
    Outer local_outer = { {7,8}, "xyz", 2.5 };
    int sum = add(local_a, local_b);                           /* MARK:BREAK1 */
    int total = compute(6);                                    /* MARK:AFTER_COMPUTE */
    HANDLE th = CreateThread(NULL, 0, worker, NULL, 0, NULL);
    for (int k = 0; k < 3; k++) {
        total += k;                                            /* MARK:LOOP2 */
    }
    if (th) { WaitForSingleObject(th, 0); }
    printf("sum=%d total=%d ratio=%f name=%s\\n", sum, total, local_outer.ratio, g_outer.name);
    fflush(stdout);                                            /* MARK:AFTER_LOOP */
    // 长驻：便于 E2E 在同一会话内做多次断言（含函数调用求值）
    for (;;) { Sleep(50); if (g_counter < 0) break; }          /* MARK:KEEPALIVE */
    if (th) { CloseHandle(th); }
    return 0;
}
`;

// 入口首停专用探针（C-01）：短生命周期（跑完即退出）——首停后可断言 continue → exited/terminated
const ENTRY_PROBE_C = `#include <stdio.h>

int entry_guard = 1;

int main(void) {
    printf("entry-probe start\\n");                             /* MARK:ENTRY_BODY */
    fflush(stdout);
    return 0;
}
`;

// C-01：GUI 探针（仅 WinMain，无 main）——`-mwindows` 下 MinGW CRT 自带 `main` 桩（无 file/line、
// 永不命中），必须回退到 WinMain 才能真正首停。
const GUI_ENTRY_PROBE_C = `#include <windows.h>

int gui_guard = 1;

int WINAPI WinMain(HINSTANCE h, HINSTANCE p, LPSTR cmd, int show) {
    (void)h; (void)p; (void)cmd; (void)show;
    OutputDebugStringA("gui-probe start");                      /* MARK:GUI_ENTRY_BODY */
    return 0;
}
`;

// C-01：Unicode GUI 探针（仅 wWinMain；用 -municode -mwindows 编译）——入口符号候选的第三档。
const WGUI_ENTRY_PROBE_C = `#include <windows.h>

int wgui_guard = 1;

int WINAPI wWinMain(HINSTANCE h, HINSTANCE p, LPWSTR cmd, int show) {
    (void)h; (void)p; (void)cmd; (void)show;
    OutputDebugStringW(L"wgui-probe start");                    /* MARK:WGUI_ENTRY_BODY */
    return 0;
}
`;

const PROBE_CPP = `#include <cstdio>
#include <stdexcept>

static void thrower() { throw std::runtime_error("cb-probe"); }   /* MARK:THROW */

int main() {
    int v = 1;
    (void)v;
    try {
        thrower();
    } catch (const std::exception& e) {
        printf("caught %s\\n", e.what());
    }
    return 0;
}
`;

function lineOf(source, mark) {
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) if (lines[i].includes(`MARK:${mark}`)) return i + 1;
  throw new Error('未找到标记 ' + mark);
}

// ---------- DAP 客户端（直连适配器，捕获 onDidSendMessage） ----------
function makeClient(adapter) {
  const msgs = [];
  let seq = 1;
  const pending = new Map();
  adapter.onDidSendMessage((m) => {
    msgs.push(m);
    if (m.type === 'response' && pending.has(m.request_seq)) {
      const resolve = pending.get(m.request_seq);
      pending.delete(m.request_seq);
      resolve(m);
    }
  });
  const send = (command, args2 = {}) => new Promise((resolve, reject) => {
    const s = seq++;
    const timer = setTimeout(() => {
      if (pending.has(s)) { pending.delete(s); reject(new Error(`DAP 超时: ${command}`)); }
    }, 30000);
    pending.set(s, (m) => { clearTimeout(timer); resolve(m); });
    adapter.handleMessage({ type: 'request', seq: s, command, arguments: args2 });
  });
  const events = (name) => msgs.filter((m) => m.type === 'event' && m.event === name);
  const lastStop = () => [...events('stopped')].pop();
  const waitStop = async (ms) => {
    const before = events('stopped').length;
    const ok = await waitFor(() => events('stopped').length > before, ms);
    return ok ? [...events('stopped')].pop() : null;
  };
  const outputs = () => events('output').map((m) => String(m.body.output)).join('');
  return { msgs, send, events, lastStop, waitStop, outputs, clear: () => { msgs.length = 0; } };
}

/** 启动一次调试会话并返回 { client, adapter }；准备就绪（initialized）后返回 */
async function launchSession(ctx, { program, cwd, breakpoints = [], sourcePath, extra = {} }) {
  const { GdbDebugAdapter } = require('../../dist/debug/gdbDebugAdapter.js');
  const adapter = new GdbDebugAdapter('e2e-' + Math.random().toString(36).slice(2, 8));
  const client = makeClient(adapter);
  const init = await client.send('initialize', { adapterID: 'codeblocks', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
  if (!init.success) throw new Error('initialize 失败: ' + init.message);
  const launch = await client.send('launch', { gdbPath: ctx.gdb, program, cwd, ...extra });
  if (!launch.success) throw new Error('launch 失败: ' + launch.message);
  const inited = await waitFor(() => client.events('initialized').length > 0, 30000);
  if (!inited) throw new Error('未收到 initialized 事件');
  if (breakpoints.length) {
    const bp = await client.send('setBreakpoints', {
      source: { path: sourcePath },
      breakpoints,
    });
    if (!bp.success) throw new Error('setBreakpoints 失败: ' + bp.message);
    client.__bpResponse = bp;
  }
  return { adapter, client };
}

async function main() {
  const gcc = findTool('gcc');
  const gpp = findTool('g++');
  const gdb = findTool('gdb');
  if (!gcc || !gdb) {
    console.log(`SKIP 调试 E2E：gcc=${gcc || '未找到'} gdb=${gdb || '未找到'}`);
    console.log('\ne2e 调试矩阵: 0 pass, 0 fail, 1 skip');
    process.exit(0);
  }

  const mock = installVscodeMock({
    config: {
      'codeblocks.debug.disableInit': true,
      'codeblocks.debug.userArguments': '',
      'codeblocks.debug.printPretty': false,
      'codeblocks.debug.printElements': 0,
      'codeblocks.debug.disassemblyFlavor': 'default',
      'codeblocks.debug.registers': true,
      'codeblocks.debug.trace': false,
    },
  });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-e2e-dbg-'));
  const cleanup = () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    mock.restore();
  };

  try {
    const srcPath = path.join(dir, 'probe.c');
    fs.writeFileSync(srcPath, PROBE_C, 'utf-8');
    const exePath = path.join(dir, 'probe.exe');
    let r = spawnSync(gcc, ['-g', '-O0', '-o', exePath, srcPath], { encoding: 'utf-8', windowsHide: true });
    if (r.status !== 0) {
      console.log('SKIP：探针编译失败 ' + String(r.stderr || '').split('\n')[0]);
      cleanup();
      process.exit(0);
    }

    const BP1 = lineOf(PROBE_C, 'BREAK1');
    const LOOP = lineOf(PROBE_C, 'LOOP');
    const LOOP2 = lineOf(PROBE_C, 'LOOP2');
    const AFTER_LOOP = lineOf(PROBE_C, 'AFTER_LOOP');
    const WORKER_KEEPALIVE = lineOf(PROBE_C, 'WORKER_KEEPALIVE');
    const ctx = { gdb };

    // ================= S1 launch + 普通断点 + 调用栈/作用域/变量 =================
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath,
        breakpoints: [{ line: BP1 }],
      });
      check('S1 setBreakpoints 返回 verified=true', !!client.__bpResponse?.body?.breakpoints?.[0]?.verified, client.__bpResponse?.body, 'verified');
      const cfg = await client.send('configurationDone', {});
      check('S1 configurationDone 成功', cfg.success, cfg.message);
      const stop = await client.waitStop(30000);
      check('S1 命中断点（stopped 事件，reason=breakpoint）', !!stop && stop.body.reason === 'breakpoint', stop && stop.body, 'breakpoint');

      const th = await client.send('threads', {});
      check('S1 threads 返回 ≥1 个线程', th.success && th.body.threads.length >= 1, th.body && th.body.threads.length, '≥1');

      const st = await client.send('stackTrace', { threadId: th.body.threads[0].id, levels: 20 });
      check('S1 stackTrace 返回栈帧且首帧为 main', st.success && st.body.stackFrames.length >= 1 && /main/.test(st.body.stackFrames[0].name), st.body && st.body.stackFrames.slice(0, 2).map((f) => f.name));
      check('S1 停止位置为断点行（栈顶帧 line）', st.body.stackFrames[0].line === BP1, st.body.stackFrames[0].line, BP1);
      const frameId = st.body.stackFrames[0].id;

      const sc = await client.send('scopes', { frameId });
      check('S1 scopes 含 Locals/Globals', sc.success && sc.body.scopes.length >= 1, sc.body && sc.body.scopes.map((s) => s.name));
      const locals = sc.body.scopes.find((s) => /local/i.test(s.name)) || sc.body.scopes[0];
      const vars = await client.send('variables', { variablesReference: locals.variablesReference });
      const byName = Object.fromEntries((vars.body.variables || []).map((v) => [v.name, v]));
      check('S1 局部变量 local_a = 10', byName.local_a && byName.local_a.value === '10', byName.local_a && byName.local_a.value, '10');
      check('S1 局部变量 local_b = 32', byName.local_b && byName.local_b.value === '32', byName.local_b && byName.local_b.value, '32');

      const outer = byName.local_outer;
      check('S1 结构体变量带子变量引用（variablesReference > 0）', !!outer && outer.variablesReference > 0, outer && outer.variablesReference, '>0');
      const children = await client.send('variables', { variablesReference: outer.variablesReference });
      const childNames = (children.body.variables || []).map((v) => v.name);
      check('S1 嵌套结构展开出 in/name/ratio', ['in', 'name', 'ratio'].every((n) => childNames.includes(n)), childNames);
      const childValues = Object.fromEntries((children.body.variables || []).map((v) => [v.name, v.value]));
      // D-02 修复：-var-list-children 带 print-values=1，子成员直接带值
      check('S1 子成员 value 非空（D-02 修复）',
        childValues.ratio === '2.5' && childValues.name === '[8]' && /^\{/.test(String(childValues.in)),
        childValues, 'in={...}, name=[8], ratio=2.5');
      check('S1 子成员带类型信息（type 非空）', (children.body.variables || []).every((v) => !!v.type), (children.body.variables || []).map((v) => [v.name, v.type]));

      const inner = (children.body.variables || []).find((v) => v.name === 'in');
      const innerChildren = await client.send('variables', { variablesReference: inner.variablesReference });
      const innerNames = (innerChildren.body.variables || []).map((v) => v.name);
      check('S1 深层结构可继续展开出 a/b', innerNames.includes('a') && innerNames.includes('b'), innerNames);
      // 深层成员再经表达式求值获取（与变量树取值互为校验）
      const deepA = await client.send('evaluate', { expression: 'local_outer.in.a', frameId, context: 'watch' });
      const deepB = await client.send('evaluate', { expression: 'local_outer.in.b', frameId, context: 'watch' });
      check('S1 深层成员 in.a = 7（经表达式求值）', deepA.success && String(deepA.body.result).trim() === '7', deepA.body && deepA.body.result, '7');
      check('S1 深层成员 in.b = 8（经表达式求值）', deepB.success && String(deepB.body.result).trim() === '8', deepB.body && deepB.body.result, '8');
      const deepName = await client.send('evaluate', { expression: 'local_outer.name', frameId, context: 'watch' });
      check('S1 结构体 char 数组成员可求值（"xyz"）', deepName.success && /xyz/.test(String(deepName.body.result)), deepName.body && deepName.body.result, '"xyz"');

      const ev = await client.send('evaluate', { expression: 'g_ratio', frameId, context: 'watch' });
      check('S1 evaluate 全局变量 g_ratio = 1.5', ev.success && /1\.5/.test(ev.body.result), ev.body && ev.body.result, '1.5');
      const evStruct = await client.send('evaluate', { expression: 'g_outer.in.b', frameId, context: 'watch' });
      check('S1 evaluate 全局结构体成员 g_outer.in.b = 2', evStruct.success && String(evStruct.body.result).trim() === '2', evStruct.body && evStruct.body.result, '2');

      const sv = await client.send('setVariable', { variablesReference: locals.variablesReference, name: 'local_a', value: '123' });
      check('S1 setVariable 修改变量成功', sv.success, sv.message);
      const evAfter = await client.send('evaluate', { expression: 'local_a', frameId, context: 'watch' });
      check('S1 修改后回读 = 123', /123/.test(evAfter.body?.result || ''), evAfter.body && evAfter.body.result, '123');

      // 反汇编 / 内存（用栈顶帧的 instructionPointerReference 定位）
      const ipRef = st.body.stackFrames[0].instructionPointerReference;
      check('S1 栈帧携带 instructionPointerReference（反汇编视图定位）', !!ipRef, ipRef, '0x…');
      const dis = await client.send('disassemble', { memoryReference: ipRef || '0x0', instructionCount: 8 });
      if (dis.success && dis.body.instructions.length) {
        check('S1 disassemble 返回指令序列', dis.body.instructions.length === 8, dis.body.instructions.length, 8);
        const addr = dis.body.instructions[0].address;
        const mem = await client.send('readMemory', { memoryReference: addr, count: 4 });
        check('S1 readMemory 读取 4 字节（base64）', mem.success && !!mem.body.data, mem.body && mem.body.data, 'base64');
        if (mem.success) {
          const wm = await client.send('writeMemory', { memoryReference: addr, data: mem.body.data, allowPartial: true });
          check('S1 writeMemory 原值回写成功', wm.success, wm.message);
        }
      } else {
        check('S1 disassemble 返回指令序列', false, { success: dis.success, message: dis.message, count: dis.body && dis.body.instructions && dis.body.instructions.length }, '≥1 条指令');
      }

      // 用户命令透传（Debug Console `-`/console 语义）；寄存器读取见下方说明
      client.clear();
      await adapter.sendUserCommand('info registers rip');
      const hasRip = await waitFor(() => /rip/.test(client.outputs()), 10000);
      check('S1 用户命令透传输出 rip 寄存器', hasRip, client.outputs().split('\n').filter((l) => /rip/i.test(l)).slice(0, 2), 'rip');
      // 说明：全量寄存器读取（-data-list-register-values）在 MinGW GDB 8.1 上会崩溃 GDB 进程
      //（raw 复现：`info registers` / `-data-list-register-values x` 均导致 GDB 退出），
      // 产品侧已用设置 codeblocks.debug.registers（默认关）门控；此处不调用 registerValues()，
      // 门控行为由 tests/test-debug-registry-providers.js（RegistersTreeProvider 提示节点）覆盖。
      skipCheck('S1 registerValues() 全量寄存器读取', 'MinGW GDB 8.1 读取全量寄存器会崩溃（产品已门控，见设置 debug.registers）');

      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
      check('S1 disconnect 后会话结束', !adapter.isActive(), adapter.isActive(), false);
    }

    // ================= S1c 函数调用求值（GDB 8.1 环境限制探针） =================
    // 实测：raw GDB 8.1（MinGW）在执行 `-data-evaluate-expression "add(2,3)"`（被调试进程内函数调用）
    // 时自身崩溃退出（0xC0000005）。适配器侧只要求「不挂起」——返回成功（新版 GDB）或失败响应均可。
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath, breakpoints: [{ line: BP1 }],
      });
      await client.send('configurationDone', {});
      const stop = await client.waitStop(30000);
      const th = await client.send('threads', {});
      const st = await client.send('stackTrace', { threadId: th.body.threads[0].id, levels: 3 });
      const frameId = st.body.stackFrames[0].id;
      const t0 = Date.now();
      const evCall = await client.send('evaluate', { expression: 'add(2,3)', frameId, context: 'repl' });
      const elapsed = Date.now() - t0;
      const value5 = evCall.success && String(evCall.body?.result || '').trim().replace(/^\(.*?\)\s*/, '') === '5';
      const graceful = evCall.success === true || (evCall.success === false && !!evCall.message);
      check('S1c 函数调用求值：适配器在超时前给出响应（不挂起）', !!stop && graceful && elapsed < 25000, { success: evCall.success, message: evCall.message, elapsed }, '有响应且 <25s');
      check('S1c 结果：成功返回 5（新版 GDB）或按环境限制失败（GDB 8.1 崩溃）',
        value5 || evCall.success === false, { result: evCall.body && evCall.body.result, message: evCall.message }, '5 或 graceful failure');
      if (!value5 && evCall.success === false) {
        console.log('     （环境限制：GDB 8.1 在被调试进程内函数调用时崩溃，非适配器缺陷；raw GDB 复现：exit=3221225477）');
      }
      try { await client.send('disconnect', {}); } catch { /* 会话可能已随 GDB 崩溃结束 */ }
      await waitFor(() => !adapter.isActive(), 8000);
    }

    // ================= S2 条件断点 / 命中次数 / 日志点 =================
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath,
        breakpoints: [{ line: LOOP, condition: 'i == 4' }],
      });
      await client.send('configurationDone', {});
      const stop = await client.waitStop(30000);
      check('S2 条件断点命中（i == 4）', !!stop && stop.body.reason === 'breakpoint', stop && stop.body, 'breakpoint');
      const th = await client.send('threads', {});
      const st = await client.send('stackTrace', { threadId: th.body.threads[0].id, levels: 5 });
      const sc = await client.send('scopes', { frameId: st.body.stackFrames[0].id });
      const vars = await client.send('variables', { variablesReference: sc.body.scopes[0].variablesReference });
      const iVal = (vars.body.variables || []).find((v) => v.name === 'i');
      check('S2 命中时 i = 4（条件确实生效）', iVal && Number(iVal.value) === 4, iVal && iVal.value, '4');
      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
    }

    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath,
        breakpoints: [{ line: LOOP, hitCondition: '3' }],
      });
      await client.send('configurationDone', {});
      const stop = await client.waitStop(30000);
      check('S2 命中次数断点（hitCondition=3）命中', !!stop, stop && stop.body, 'stopped');
      const th = await client.send('threads', {});
      const st = await client.send('stackTrace', { threadId: th.body.threads[0].id, levels: 5 });
      const sc = await client.send('scopes', { frameId: st.body.stackFrames[0].id });
      const vars = await client.send('variables', { variablesReference: sc.body.scopes[0].variablesReference });
      const iVal = (vars.body.variables || []).find((v) => v.name === 'i');
      check('S2 第 3 次命中时 i = 2（0 基循环）', iVal && Number(iVal.value) === 2, iVal && iVal.value, '2');
      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
    }

    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath,
        breakpoints: [
          { line: LOOP, logMessage: 'logpoint i={i}' },
          { line: AFTER_LOOP },
        ],
      });
      await client.send('configurationDone', {});
      const stop = await client.waitStop(30000);
      const stLog = stop ? await client.send('stackTrace', { threadId: (await client.send('threads', {})).body.threads[0].id, levels: 2 }) : null;
      check('S2 日志点不中断执行（仍能到达后续断点）',
        !!stop && !!stLog && stLog.body.stackFrames[0].line === AFTER_LOOP,
        { stopped: !!stop, line: stLog && stLog.body.stackFrames[0].line }, AFTER_LOOP);
      const logSeen = await waitFor(() => /logpoint i=/.test(client.outputs()), 15000);
      check('S2 日志点向 Debug Console 输出渲染文本', logSeen, client.outputs().split('\n').filter((l) => /logpoint/.test(l)).slice(0, 3), 'logpoint i=N');
      const logValued = /logpoint i=\d/.test(client.outputs());
      check('S2 日志点表达式已求值（i 为数字）', logValued, client.outputs().split('\n').filter((l) => /logpoint/.test(l)).slice(0, 2), 'logpoint i=<数字>');
      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
      // D-05 回归：disconnect 之后适配器不得再推送任何 DAP 消息
      // （修复前实测：GDB 退出触发 thread×3 / exited / terminated 共 5 条迟到事件）
      client.clear();
      await sleep(1500);
      check('S2 disconnect 后无迟到 DAP 消息（D-05 修复）', client.msgs.length === 0,
        client.msgs.map((m) => (m.type === 'event' ? 'event/' + m.event : m.type + '/' + m.command)), '0 条');
    }

    // ================= S2b 全局作用域内容（D-03） =================
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath, breakpoints: [{ line: BP1 }],
      });
      await client.send('configurationDone', {});
      await client.waitStop(30000);
      const th = await client.send('threads', {});
      const st = await client.send('stackTrace', { threadId: th.body.threads[0].id, levels: 2 });
      const sc = await client.send('scopes', { frameId: st.body.stackFrames[0].id });
      const globals = sc.body.scopes.find((s) => /全局/.test(s.name));
      const gvars = await client.send('variables', { variablesReference: globals.variablesReference });
      const gNames = (gvars.body.variables || []).map((v) => v.name);
      // D-03 修复：全局作用域改为真实程序全局变量枚举（info variables，过滤工具链符号）
      const localsNames = (await client.send('variables', { variablesReference: sc.body.scopes.find((s) => /本地/.test(s.name)).variablesReference })).body.variables.map((v) => v.name);
      check('S2b 全局作用域含程序全局变量（D-03 修复）',
        ['g_counter', 'g_ratio', 'g_outer'].every((n) => gNames.includes(n)),
        { globals: gNames, locals: localsNames }, 'g_counter/g_ratio/g_outer');
      check('S2b 全局作用域与局部作用域内容不一致',
        JSON.stringify([...gNames].sort()) !== JSON.stringify([...localsNames].sort()), { globals: gNames, locals: localsNames }, '两者不同');
      check('S2b 全局变量在变量树中带值（D-03 修复）',
        (gvars.body.variables || []).every((v) => v.value !== ''),
        (gvars.body.variables || []).map((v) => [v.name, v.value]), '每个都有 value');
      const evGlobal = await client.send('evaluate', { expression: 'g_counter', frameId: st.body.stackFrames[0].id, context: 'watch' });
      check('S2b 全局变量仍可经表达式求值访问（兜底途径）', evGlobal.success && /^\d+$/.test(String(evGlobal.body.result).trim()), evGlobal.body && evGlobal.body.result, '数字');
      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
    }

    // ================= S3 单步（行级 / 步入 / 步出 / 指令级） =================
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath,
        breakpoints: [{ line: BP1 }],
      });
      await client.send('configurationDone', {});
      await client.waitStop(30000);
      const th = await client.send('threads', {});
      const threadId = th.body.threads[0].id;

      // Step Into：BP1 下一语句是 compute(6) 调用 → 应进入被调函数
      const stepIn = await client.send('stepIn', { threadId, granularity: 'statement' });
      const stopIn = await client.waitStop(20000);
      const stIn = await client.send('stackTrace', { threadId, levels: 4 });
      check('S3 Step Into 成功', stepIn.success && !!stopIn, stopIn && stopIn.body, 'stopped');
      check('S3 Step Into 进入被调函数（栈顶为 compute/add）',
        stIn.body.stackFrames.length >= 2 && !/^main$/.test(stIn.body.stackFrames[0].name),
        stIn.body.stackFrames.slice(0, 3).map((f) => f.name), '非 main 帧');

      // Step Out：从被调函数返回 main
      const depthBefore = stIn.body.stackFrames.length;
      const stepOut = await client.send('stepOut', { threadId });
      const stopOut = await client.waitStop(20000);
      const stOut = stopOut ? await client.send('stackTrace', { threadId, levels: 4 }) : null;
      check('S3 Step Out 成功', stepOut.success && !!stopOut, { ok: stepOut.success, message: stepOut.message, stopped: !!stopOut }, 'stopped');
      check('S3 Step Out 返回上层帧（栈顶为 main）',
        !!stOut && /^main$/.test(stOut.body.stackFrames[0].name) && stOut.body.stackFrames.length < depthBefore,
        stOut && stOut.body.stackFrames.slice(0, 2).map((f) => f.name), 'main');

      // Step Over：行号应前进
      const beforeLine = stOut.body.stackFrames[0].line;
      const stepOver = await client.send('next', { threadId, granularity: 'statement' });
      const stop1 = await client.waitStop(20000);
      const st1 = await client.send('stackTrace', { threadId, levels: 2 });
      check('S3 Step Over 成功且原因 step', stepOver.success && !!stop1 && stop1.body.reason === 'step', stop1 && stop1.body, 'step');
      check('S3 Step Over 后行号前进', st1.body.stackFrames[0].line > beforeLine, { before: beforeLine, after: st1.body.stackFrames[0].line }, `>${beforeLine}`);

      // 运行到光标（Run to Cursor）：目标取更后面的循环行，确保 until 有执行空间
      const goto = await client.send('gotoTargets', { source: { path: srcPath }, line: LOOP2 });
      if (goto.success && goto.body.targets?.length) {
        const baseStops = client.events('stopped').length;
        const g = await client.send('goto', { threadId, targetId: goto.body.targets[0].id });
        await waitFor(() => client.events('stopped').length > baseStops, 25000);
        const stGoto = await client.send('stackTrace', { threadId, levels: 2 });
        check('S3 运行到光标（gotoTargets+goto）命中指定行',
          g.success && stGoto.body.stackFrames[0].line === LOOP2,
          { ok: g.success, message: g.message, line: stGoto.body.stackFrames[0].line }, LOOP2);
      } else {
        skipCheck('S3 运行到光标', 'gotoTargets 无目标（GDB 版本差异）');
      }

      // 指令级单步（停止事件不带 ip，用栈帧的 instructionPointerReference 校验）
      const ipBefore = (await client.send('stackTrace', { threadId, levels: 1 })).body.stackFrames[0].instructionPointerReference;
      const stepInstr = await client.send('next', { threadId, granularity: 'instruction' });
      const stopInstr = await client.waitStop(20000);
      const ipAfter = (await client.send('stackTrace', { threadId, levels: 1 })).body.stackFrames[0].instructionPointerReference;
      check('S3 指令级单步（granularity=instruction）成功', stepInstr.success && !!stopInstr && stopInstr.body.reason === 'step', stopInstr && stopInstr.body, 'step');
      check('S3 指令级单步后指令指针变化', !!ipBefore && !!ipAfter && ipBefore !== ipAfter, { before: ipBefore, after: ipAfter }, '地址变化');

      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
    }

    // ================= S4 指令断点 / 数据断点 =================
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath,
        breakpoints: [{ line: BP1 }],
      });
      await client.send('configurationDone', {});
      const stop = await client.waitStop(30000);
      const th = await client.send('threads', {});
      const threadId = th.body.threads[0].id;
      const st = await client.send('stackTrace', { threadId, levels: 2 });
      const ip = st.body.stackFrames[0].instructionPointerReference || st.body.stackFrames[0].instructionPointerReference;

      const dis = await client.send('disassemble', { memoryReference: ip, instructionCount: 4, offset: 1 });
      if (dis.success && dis.body.instructions.length) {
        const target = dis.body.instructions[0];
        const ibp = await client.send('setInstructionBreakpoints', {
          breakpoints: [{ instructionReference: target.address }],
        });
        check('S4 指令断点设置成功（verified=true）', ibp.success && ibp.body.breakpoints[0].verified === true, ibp.body && ibp.body.breakpoints, 'verified');
        const cont = await client.send('continue', { threadId });
        const stop2 = await client.waitStop(20000);
        const st2 = stop2 ? await client.send('stackTrace', { threadId, levels: 2 }) : null;
        const ipAfter = st2 && st2.body.stackFrames[0].instructionPointerReference;
        check('S4 指令断点命中（停在目标地址）',
          cont.success && !!stop2 && String(ipAfter).toLowerCase() === String(target.address).toLowerCase(),
          { reason: stop2 && stop2.body.reason, ip: ipAfter, target: target.address }, 'ip = target');
      } else {
        skipCheck('S4 指令断点', 'disassemble 不可用');
      }

      // 数据断点（监视 g_counter：以表达式名请求，不依赖变量树）
      {
        const info = await client.send('dataBreakpointInfo', { variablesReference: 0, name: 'g_counter' });
        check('S4 dataBreakpointInfo 返回可写数据 id', info.success && !!info.body.dataId, info.body, 'dataId');
        if (info.body?.dataId) {
          const dbp = await client.send('setDataBreakpoints', { breakpoints: [{ dataId: info.body.dataId }] });
          check('S4 数据断点设置成功', dbp.success && dbp.body.breakpoints[0].verified === true, dbp.body && dbp.body.breakpoints, 'verified');
          await client.send('continue', { threadId });
          const stop3 = await client.waitStop(25000);
          check('S4 数据断点命中（写 g_counter 时中断）', !!stop3, stop3 && stop3.body, 'stopped');
        }
      }

      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
    }

    // ================= S5 Set Next Statement / 用户命令透传 =================
    // 语义说明：GDB `jump` = 从新地址**继续执行**（打印 "Continuing at ..."），不会停在目标行；
    // 因此断言方式为「在目标行预置断点 → jump 后立即命中该断点」。
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath,
        breakpoints: [{ line: BP1 }, { line: AFTER_LOOP }],
      });
      await client.send('configurationDone', {});
      const firstStop = await client.waitStop(30000);
      const stFirst = await client.send('stackTrace', { threadId: (await client.send('threads', {})).body.threads[0].id, levels: 2 });
      check('S5 初始停在首断点（BP1）', !!firstStop && stFirst.body.stackFrames[0].line === BP1, stFirst.body.stackFrames[0].line, BP1);

      const baseStops = client.events('stopped').length;
      await adapter.setNextStatement(srcPath, AFTER_LOOP);
      const jumped = await waitFor(() => client.events('stopped').length > baseStops, 25000);
      check('S5 Set Next Statement 后程序从目标行继续并命中该行断点', jumped, jumped, true);
      if (jumped) {
        const thSet = await client.send('threads', {});
        const stSet = await client.send('stackTrace', { threadId: thSet.body.threads[0].id, levels: 2 });
        check('S5 栈顶行号 = 跳转目标行', stSet.body.stackFrames[0].line === AFTER_LOOP, stSet.body.stackFrames[0].line, AFTER_LOOP);
      } else {
        skipCheck('S5 栈顶行号 = 跳转目标行', '未观察到新的停止事件');
      }

      client.clear();
      await adapter.sendUserCommand('info registers rip');
      const ripOk = await waitFor(() => /rip/.test(client.outputs()), 10000);
      check('S5 跳转后会话仍可用（用户命令可执行）', ripOk, client.outputs().split('\n').filter((l) => /rip/i.test(l)).slice(0, 2), 'rip');

      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
    }

    // ================= S6 异常断点（C++ throw/catch） =================
    if (gpp) {
      const cppSrc = path.join(dir, 'probe.cpp');
      fs.writeFileSync(cppSrc, PROBE_CPP, 'utf-8');
      const cppExe = path.join(dir, 'probe_cpp.exe');
      r = spawnSync(gpp, ['-g', '-O0', '-o', cppExe, cppSrc], { encoding: 'utf-8', windowsHide: true });
      if (r.status === 0) {
        const { adapter, client } = await launchSession(ctx, {
          program: cppExe, cwd: dir, sourcePath: cppSrc, breakpoints: [],
        });
        const ebp = await client.send('setExceptionBreakpoints', { filters: ['throw'] });
        check('S6 setExceptionBreakpoints 成功', ebp.success, ebp.message);
        await client.send('configurationDone', {});
        const stop = await client.waitStop(30000);
        check('S6 抛出异常时中断（程序在 throw 处停止）', !!stop, stop && stop.body, 'stopped');
        // D-04 修复：按 catchpoint 编号识别异常命中（GDB 8.1 无 -catch-* MI 命令，走 CLI catch 回退）
        check('S6 异常命中上报 reason=exception（D-04 修复）',
          !!stop && stop.body.reason === 'exception', stop && { reason: stop.body.reason, description: stop.body.description }, "reason='exception'");
        check('S6 异常停止带异常描述（D-04 修复）',
          !!stop && /异常/.test(String(stop.body.description || '')) && !/breakpoint-hit/.test(String(stop.body.description || '')),
          stop && stop.body.description, '已暂停在异常处（抛出异常，GDB catchpoint N）');
        const thEx = await client.send('threads', {});
        const stEx = await client.send('stackTrace', { threadId: thEx.body.threads[0].id, levels: 4 });
        check('S6 停止位置位于抛出的函数内（thrower）',
          stEx.body.stackFrames.slice(0, 3).some((f) => /thrower|main/.test(f.name)),
          stEx.body.stackFrames.map((f) => f.name), 'thrower/main');
        await client.send('disconnect', {});
        await waitFor(() => !adapter.isActive(), 8000);
      } else {
        skipCheck('S6 异常断点', 'C++ 探针编译失败');
      }
    } else {
      skipCheck('S6 异常断点', 'g++ 不可用');
    }

    // ================= S7 多会话并存（两个适配器互不干扰） =================
    {
      const s1 = await launchSession(ctx, { program: exePath, cwd: dir, sourcePath: srcPath, breakpoints: [{ line: BP1 }] });
      const s2 = await launchSession(ctx, { program: exePath, cwd: dir, sourcePath: srcPath, breakpoints: [{ line: BP1 }] });
      const stops1Before = s1.client.events('stopped').length;
      const stops2Before = s2.client.events('stopped').length;
      await s1.client.send('configurationDone', {});
      await s2.client.send('configurationDone', {});
      const ok1 = await waitFor(() => s1.client.events('stopped').length > stops1Before, 30000);
      const ok2 = await waitFor(() => s2.client.events('stopped').length > stops2Before, 30000);
      check('S7 两个会话各自独立命中断点', ok1 && ok2, { s1: ok1, s2: ok2 }, 'both');
      check('S7 两会话适配器均处于活动态', s1.adapter.isActive() && s2.adapter.isActive(), [s1.adapter.isActive(), s2.adapter.isActive()], [true, true]);
      await s1.client.send('disconnect', {});
      await waitFor(() => !s1.adapter.isActive(), 8000);
      check('S7 关闭会话 1 不影响会话 2', s2.adapter.isActive(), s2.adapter.isActive(), true);
      await s2.client.send('disconnect', {});
      await waitFor(() => !s2.adapter.isActive(), 8000);
    }

    // ================= S9 能力请求：函数断点 / 模块 / 已加载源 / 暂停（能力探测） =================
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath, breakpoints: [],
      });
      // ① setFunctionBreakpoints：直接请求（不经 VS Code UI 路径）并验证真实命中 compute
      const fb = await client.send('setFunctionBreakpoints', { breakpoints: [{ name: 'compute' }] });
      check('S9 setFunctionBreakpoints 成功', fb.success, fb.message);
      check('S9 函数断点 verified=true',
        !!(fb.body.breakpoints && fb.body.breakpoints[0] && fb.body.breakpoints[0].verified),
        fb.body && fb.body.breakpoints, 'verified');
      await client.send('configurationDone', {});
      const fstop = await client.waitStop(30000);
      check('S9 函数断点命中（程序在 compute 处停止）', !!fstop, fstop && fstop.body, 'stopped');
      const fth = await client.send('threads', {});
      const fst = await client.send('stackTrace', { threadId: fth.body.threads[0].id, levels: 4 });
      check('S9 命中栈顶为 compute（函数断点语义）',
        /compute/.test(String((fst.body.stackFrames[0] || {}).name)),
        fst.body.stackFrames.slice(0, 3).map((f) => f.name), 'compute');

      // ② modules：调试目标 + 已加载库（=library-loaded 缓存，含 .text 加载地址）
      const mods = await client.send('modules', {});
      const modList = mods.body.modules || [];
      check('S9 modules 含调试目标本体',
        mods.success && modList.some((m) => /probe\.exe$/i.test(String(m.path || m.name))),
        modList.slice(0, 3).map((m) => [m.name, m.baseAddress]), '含 probe.exe');
      check('S9 modules 含已加载 DLL（library-loaded 缓存）',
        modList.some((m) => /\.dll$/i.test(String(m.path || m.name))),
        modList.filter((m) => /\.dll$/i.test(String(m.path))).slice(0, 3).map((m) => m.name), '≥1 个 dll');

      // ③ loadedSources：已加载源文件（-file-list-exec-source-files）
      const ls = await client.send('loadedSources', {});
      const srcList = ls.body.sources || [];
      check('S9 loadedSources 含探针源文件',
        ls.success && srcList.some((s) => /probe\.c$/i.test(String(s.path || s.name))),
        srcList.slice(0, 3).map((s) => s.path), '含 probe.c');

      // ④ pause：能力探测——Windows 原生 GDB 无法中断运行中的进程（-exec-interrupt 会卡死 GDB，D-07）
      await client.send('continue', { threadId: fth.body.threads[0].id });
      await sleep(800);
      const pauseResp = await client.send('pause', {});
      const pstop = await client.waitStop(3000);
      if (process.platform === 'win32') {
        check('S9 pause 在 Windows 原生 GDB 下回「不支持」并说明原因',
          pauseResp.success === false && /暂停/.test(String(pauseResp.message || '')), pauseResp.message, '不支持说明');
        check('S9 pause 未产生 stopped（未下发会卡死 GDB 的 -exec-interrupt）', !pstop, pstop && pstop.body, 'null');
      } else {
        check('S9 pause 触发中断停止', pauseResp.success && !!pstop, pstop && pstop.body, 'stopped');
      }
      const alive = adapter.isActive();
      check('S9 pause 之后会话仍处于活动态（未卡死会话）', alive, alive, true);
      // 注：运行中（未停止）时 GDB 8.1 同步 MI 不回应任何 MI 命令（实测 -thread-info / -break-insert /
      // -data-evaluate-expression 全部阻塞），故此处不再发 MI 请求，改为断言会话状态 + 优雅断开（复验 D-05）。
      await client.send('disconnect', {});
      await waitFor(() => !adapter.isActive(), 8000);
      client.clear();
      await sleep(1000);
      check('S9 断开后无迟到 DAP 消息（D-05 复验）', client.msgs.length === 0,
        client.msgs.map((m) => m.type + '/' + (m.event || m.command)), '0 条');
    }

    // ================= S8 terminate =================
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath, breakpoints: [{ line: BP1 }],
      });
      await client.send('configurationDone', {});
      await client.waitStop(30000);
      const thTerm = await client.send('threads', {});
      const st = await client.send('stackTrace', { threadId: thTerm.body.threads[0].id, levels: 2 });
      check('S8 session 概要：栈帧可用', st.body.stackFrames.length >= 1, st.body.stackFrames.length, '≥1');
      const term = await client.send('terminate', {});
      check('S8 terminate 请求成功', term.success, term.message);
      const ended = await waitFor(() => client.events('terminated').length > 0 || !adapter.isActive(), 10000);
      check('S8 session 终止（terminated 事件或会话失效）', ended, { terminated: client.events('terminated').length, active: adapter.isActive() });
    }

    // ================= S10 attach / detach + 多线程帧切换（真实外部进程，协议级） =================
    // 与 tests/test-debug-detach-symbol.js（D1/D2 单元级）互补：此处只做 DAP 协议级断言
    //（attach(processId) → 断点命中 → 多线程取帧/变量 → Detach 不杀进程）。
    {
      const probe = spawn(exePath, [], { cwd: dir, detached: true, stdio: 'ignore' });
      const pid = probe.pid;
      let killed = false;
      const killProbe = () => {
        if (killed) return;
        killed = true;
        try { spawnSync('taskkill', ['/F', '/PID', String(pid)], { encoding: 'utf-8', windowsHide: true }); } catch { /* ignore */ }
      };
      const alive = () => /probe\.exe/i.test(String(spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf-8', windowsHide: true }).stdout || ''));
      try {
        await sleep(900); // 让探针进入常驻循环（主线程 keepalive + worker 线程循环）
        check('S10 附加前目标进程存活', alive(), pid, 'alive');

        const { GdbDebugAdapter } = require('../../dist/debug/gdbDebugAdapter.js');
        const adapter = new GdbDebugAdapter('e2e-attach-' + Math.random().toString(36).slice(2, 8));
        const client = makeClient(adapter);
        await client.send('initialize', { adapterID: 'codeblocks', linesStartAt1: true, columnsStartAt1: true, pathFormat: 'path' });
        const attachResp = await client.send('attach', { gdbPath: ctx.gdb, processId: pid, program: exePath, cwd: dir });
        check('S10 attach(processId) 请求成功', attachResp.success === true, attachResp.message, 'success');
        const initedA = await waitFor(() => client.events('initialized').length > 0, 30000);
        check('S10 attach 后收到 initialized 事件', initedA, initedA, true);
        check('S10 adapter.isAttached() 语义（对齐 CB IsAttachedToProcess）', adapter.isAttached() === true, adapter.isAttached(), true);
        const stoppedSoon = await waitFor(() => adapter.isStopped(), 8000);
        check('S10 附加后目标进入停止态（GDB attach 默认停住目标）', stoppedSoon, adapter.isStopped(), true);

        const thA = await client.send('threads', {});
        check('S10 attach 后 threads 可用（≥1 线程）', thA.success && (thA.body?.threads || []).length >= 1,
          thA.body && thA.body.threads.map((t) => [t.id, t.name]), '≥1');

        // worker 线程常驻循环断点（PROBE_C 的 MARK:WORKER_KEEPALIVE）
        const bpA = await client.send('setBreakpoints', { source: { path: srcPath }, breakpoints: [{ line: WORKER_KEEPALIVE }] });
        check('S10 附加会话可设置断点且 verified=true',
          bpA.success && bpA.body?.breakpoints?.[0]?.verified === true, bpA.body && bpA.body.breakpoints, 'verified');

        await client.send('continue', { threadId: thA.body?.threads?.[0]?.id ?? 1 });
        const stopA = await client.waitStop(20000);
        check('S10 附加会话断点命中（worker 常驻循环行）',
          !!stopA && stopA.body.reason === 'breakpoint', stopA && stopA.body, 'breakpoint');

        const workerThreadId = stopA ? stopA.body.threadId : 0;
        const stW = await client.send('stackTrace', { threadId: workerThreadId, levels: 12 });
        const stWFrames = stW.body?.stackFrames || [];
        check('S10 命中线程的栈顶帧为 worker（指定线程 ID 取帧）',
          stWFrames.length >= 1 && /worker/.test(String(stWFrames[0].name)),
          stWFrames.slice(0, 3).map((f) => f.name), 'worker');

        const thAll = await client.send('threads', {});
        check('S10 目标含多个线程（≥2）', (thAll.body?.threads || []).length >= 2,
          (thAll.body?.threads || []).map((t) => t.id), '≥2');

        // 找出主线程：逐线程取帧，栈中含 main 的那个（多线程帧切换的定位手段）
        let mainThreadId = 0;
        for (const t of thAll.body?.threads || []) {
          if (t.id === workerThreadId) continue;
          const st = await client.send('stackTrace', { threadId: t.id, levels: 40 });
          if ((st.body?.stackFrames || []).some((f) => /^main$/.test(String(f.name)))) { mainThreadId = t.id; break; }
        }
        check('S10 多线程中可定位主线程（stackTrace 指定其它线程 ID 取帧）', mainThreadId > 0, mainThreadId, '>0');

        const stMain = await client.send('stackTrace', { threadId: mainThreadId, levels: 40 });
        const stMainFrames = stMain.body?.stackFrames || [];
        const mainFrame = stMainFrames.find((f) => /^main$/.test(String(f.name)));
        check('S10 指定主线程 ID 后栈含 main（帧随线程切换，非 worker 栈）',
          !!mainFrame && stMainFrames.length > 0 && !/worker/.test(String(stMainFrames[0].name)),
          stMainFrames.slice(0, 3).map((f) => f.name), '含 main 且栈顶非 worker');

        const stW2 = await client.send('stackTrace', { threadId: workerThreadId, levels: 12 });
        const stW2Frames = stW2.body?.stackFrames || [];
        check('S10 切回 worker 线程 ID 后栈顶恢复为 worker（-thread-select 双向有效）',
          /worker/.test(String((stW2Frames[0] || {}).name)), stW2Frames.slice(0, 2).map((f) => f.name), 'worker');

        // 指定帧下的 scopes/variables（切换帧的 variablesReference 语义）
        if (mainFrame) {
          const scMain = await client.send('scopes', { frameId: mainFrame.id });
          const localsMain = (scMain.body?.scopes || []).find((s) => /本地/.test(s.name));
          const vMain = await client.send('variables', { variablesReference: localsMain.variablesReference });
          const namesMain = (vMain.body?.variables || []).map((v) => v.name);
          check('S10 主线程帧下取到 main 的局部变量（local_a=10）',
            vMain.success && (vMain.body?.variables || []).some((v) => v.name === 'local_a' && v.value === '10'),
            (vMain.body?.variables || []).map((v) => [v.name, v.value]).slice(0, 8), 'local_a=10');
          check('S10 主线程帧变量不含 worker 局部变量 w（线程/帧未串台）', !namesMain.includes('w'), namesMain, '无 w');
        } else {
          skipCheck('S10 主线程帧下变量取值', '未定位到 main 帧（前序断言已失败）');
        }

        if (stW2Frames.length) {
          const scWorker = await client.send('scopes', { frameId: stW2Frames[0].id });
          const localsWorker = (scWorker.body?.scopes || []).find((s) => /本地/.test(s.name));
          const vWorker = await client.send('variables', { variablesReference: localsWorker.variablesReference });
          const namesWorker = (vWorker.body?.variables || []).map((v) => v.name);
          check('S10 worker 线程帧下取到 worker 的局部变量 w（帧切换回 worker 生效）',
            vWorker.success && namesWorker.includes('w'), namesWorker, '含 w');
          check('S10 worker 帧变量不含 local_a（两线程帧相互隔离）', !namesWorker.includes('local_a'), namesWorker, '无 local_a');
        } else {
          skipCheck('S10 worker 线程帧下变量取值', '未取得 worker 栈帧（前序断言已失败）');
        }

        // 表达式求值同样遵循 frameId（切换帧的求值上下文语义；当前选中线程为 worker）
        if (mainFrame) {
          const evMain = await client.send('evaluate', { expression: 'local_a', frameId: mainFrame.id, context: 'watch' });
          check('S10 指定主线程帧求值 local_a = 10（evaluate 遵循 frameId 跨线程切帧）',
            evMain.success && String(evMain.body?.result ?? '').trim() === '10',
            { success: evMain.success, result: evMain.body && evMain.body.result, message: evMain.message }, '10');
        } else {
          skipCheck('S10 指定主线程帧求值', '未定位到 main 帧（前序断言已失败）');
        }
        if (stW2Frames.length) {
          const evWorker = await client.send('evaluate', { expression: 'w', frameId: stW2Frames[0].id, context: 'watch' });
          check('S10 切回 worker 帧求值 w 为数字（求值上下文随 frameId 切回 worker）',
            evWorker.success && /^\d+$/.test(String(evWorker.body?.result ?? '').trim()),
            { success: evWorker.success, result: evWorker.body && evWorker.body.result }, '数字');
        } else {
          skipCheck('S10 worker 帧求值', '未取得 worker 栈帧（前序断言已失败）');
        }

        // Detach（DAP 协议路径：附加会话 disconnect → -target-detach）：CB 语义「分离不杀进程」
        const dcA = await client.send('disconnect', {});
        check('S10 附加会话 disconnect 请求成功', dcA.success === true, dcA.message, 'success');
        await waitFor(() => !adapter.isActive(), 8000);
        check('S10 Detach 后会话结束（适配器释放）', !adapter.isActive(), adapter.isActive(), false);
        check('S10 适配器报告已分离（isDetached）', adapter.isDetached() === true, adapter.isDetached(), true);
        check('S10 Detach 后停止态清除（isStopped=false）', adapter.isStopped() === false, adapter.isStopped(), false);
        await sleep(400);
        check('S10 Detach 后目标进程仍存活（CB「分离不杀进程」语义）', alive(), alive(), true);
      } finally {
        killProbe();
      }
    }

    // ================= S10b stopOnEntry 语义（C-01：正向验收） =================
    // 修复前（能力缺口 SKIP）：适配器未消费 launch 的 stopOnEntry——程序直接运行，无入口首停。
    // 修复后：运行前插入口一次性临时断点，命中上报 DAP reason=entry：
    //   ① 用户入口符号候选 main → WinMain → wWinMain（只接受带 file/line 的解析结果——
    //      `-mwindows` GUI 程序的 `main` 是 CRT 桩符号，无源码行且永不命中，必须剔除）；
    //   ② 兜底「程序入口地址」（`info files` 的 Entry point，覆盖 strip 后无符号表的情形，
    //      该停点无源码行，正是 DAP「入口」语义）；
    //   ③ 两者都不可用才回退为「不首停 + 一行中文说明」（PE/ELF 可执行文件上不可达，防御性分支）。
    {
      const entrySrc = path.join(dir, 'entry-probe.c');
      fs.writeFileSync(entrySrc, ENTRY_PROBE_C, 'utf-8');
      const entryBodyLine = lineOf(ENTRY_PROBE_C, 'ENTRY_BODY');
      const entryExe = path.join(dir, 'entry-probe.exe');
      const rcEntry = spawnSync(gcc, ['-g', '-O0', '-o', entryExe, entrySrc], { encoding: 'utf-8', windowsHide: true });
      if (rcEntry.status !== 0) {
        skipCheck('S10b stopOnEntry=true 入口首停', '入口探针编译失败: ' + String(rcEntry.stderr || '').split('\n')[0]);
      } else {
        // ---- 正例：stopOnEntry=true → 入口首停（reason=entry）→ continue 跑完 → terminated ----
        const { adapter, client } = await launchSession(ctx, {
          program: entryExe, cwd: dir, sourcePath: entrySrc, breakpoints: [], extra: { stopOnEntry: true },
        });
        const cfg = await client.send('configurationDone', {});
        check('S10b configurationDone 成功（stopOnEntry 会话）', cfg.success, cfg.message, 'success');
        const gotStop = await waitFor(() => client.events('stopped').length > 0, 15000);
        const stopEv = client.lastStop();
        check('S10b stopOnEntry=true 触发入口首停（收到 stopped 事件）', gotStop && !!stopEv, stopEv && stopEv.body, 'stopped');
        check('S10b 首停 reason=entry', !!stopEv && stopEv.body.reason === 'entry', stopEv && stopEv.body, "reason='entry'");
        check('S10b 首停描述为入口语义（无「断点命中」误导）',
          !!stopEv && /入口/.test(String(stopEv.body.description || '')) && !/断点/.test(String(stopEv.body.description || '')),
          stopEv && stopEv.body.description, '含「入口」且不含「断点」');
        check('S10b 首停描述标注实际入口符号（main，候选第一档）',
          !!stopEv && /main/.test(String(stopEv.body.description || '')), stopEv && stopEv.body.description, '含「main」');
        check('S10b 首停后为已停止态（isStopped=true）', adapter.isStopped() === true && adapter.isActive(),
          { stopped: adapter.isStopped(), active: adapter.isActive() }, 'stopped');
        const th = await client.send('threads', {});
        check('S10b 首停后 threads 可用（线程缓存一致）', th.success && (th.body?.threads?.length ?? 0) >= 1,
          th.body && th.body.threads, '≥1 线程');
        const st = await client.send('stackTrace', { threadId: th.body?.threads?.[0]?.id, levels: 5 });
        const f0 = st.body?.stackFrames?.[0];
        check('S10b 首停位置在入口（首帧 main + 入口源文件 + 入口行附近）',
          st.success && !!f0 && /main/.test(f0.name)
          && String(f0.source?.path || '').replace(/\\/g, '/').toLowerCase().endsWith('/entry-probe.c')
          && f0.line === entryBodyLine,
          st.body && st.body.stackFrames.slice(0, 2).map((f) => `${f.name}@${f.line}`), `main@${entryBodyLine}`);
        const cont = await client.send('continue', { threadId: th.body?.threads?.[0]?.id });
        check('S10b 首停后 continue 成功下发', cont.success, cont.message, 'success');
        const term = await waitFor(() => client.events('terminated').length > 0, 15000);
        check('S10b continue 后程序跑完（收到 terminated）', term, client.events('terminated').length, '≥1');
        check('S10b 结束后停止态清除（isStopped=false）', adapter.isStopped() === false, adapter.isStopped(), false);
        await client.send('disconnect', {});
        await waitFor(() => !adapter.isActive(), 8000);
        check('S10b 会话正常收尾（disconnect 后适配器释放）', !adapter.isActive(), adapter.isActive(), false);
      }

      // ---- 对照：stopOnEntry=false → 不首停（程序直接跑完，无 stopped 事件） ----
      if (rcEntry.status === 0) {
        const off = await launchSession(ctx, {
          program: entryExe, cwd: dir, sourcePath: entrySrc, breakpoints: [], extra: { stopOnEntry: false },
        });
        await off.client.send('configurationDone', {});
        const offDone = await waitFor(() => off.client.events('terminated').length > 0, 15000);
        check('S10b 对照 stopOnEntry=false：不首停（0 个 stopped 事件）且程序直接跑完',
          offDone && off.client.events('stopped').length === 0 && off.adapter.isStopped() === false,
          { terminated: off.client.events('terminated').length, stoppedEvents: off.client.events('stopped').length, isStopped: off.adapter.isStopped() },
          '0 stopped + terminated');
        await off.client.send('disconnect', {});
        await waitFor(() => !off.adapter.isActive(), 8000);
      }

      // ---- GUI 入口符号候选：`-mwindows`（仅 WinMain）/ `-municode -mwindows`（仅 wWinMain） ----
      // 差分实测（修复前，本机 MinGW GDB 8.1）：`-break-insert -t main` 对 CRT 的 `main` 桩返回
      // `at="<main+9>"` 且无 func/file/line（`info address main` = "in a file compiled without
      // debugging"），断点永不命中 ⇒ 6s 内无 `*stopped`，程序静默跑完（无首停、无提示）。
      const guiCases = [
        {
          tag: 'WinMain', src: GUI_ENTRY_PROBE_C, bodyMark: 'GUI_ENTRY_BODY', srcName: 'gui-entry-probe.c',
          exeName: 'gui-entry-probe.exe', flags: ['-mwindows'], entrySymbol: 'WinMain',
        },
        {
          tag: 'wWinMain', src: WGUI_ENTRY_PROBE_C, bodyMark: 'WGUI_ENTRY_BODY', srcName: 'wgui-entry-probe.c',
          exeName: 'wgui-entry-probe.exe', flags: ['-municode', '-mwindows'], entrySymbol: 'wWinMain',
        },
      ];
      for (const gc of guiCases) {
        const gSrc = path.join(dir, gc.srcName);
        fs.writeFileSync(gSrc, gc.src, 'utf-8');
        const gBodyLine = lineOf(gc.src, gc.bodyMark);
        const gExe = path.join(dir, gc.exeName);
        const rcGui = spawnSync(gcc, ['-g', '-O0', ...gc.flags, '-o', gExe, gSrc], { encoding: 'utf-8', windowsHide: true });
        if (rcGui.status !== 0) {
          skipCheck(`S10b GUI 入口候选（${gc.tag}）首停`, `${gc.flags.join(' ')} 编译失败: ` + String(rcGui.stderr || '').split('\n')[0]);
          continue;
        }
        const { adapter: gAdapter, client: gClient } = await launchSession(ctx, {
          program: gExe, cwd: dir, sourcePath: gSrc, breakpoints: [], extra: { stopOnEntry: true },
        });
        await gClient.send('configurationDone', {});
        const gGot = await waitFor(() => gClient.events('stopped').length > 0, 15000);
        const gStop = gClient.lastStop();
        check(`S10b GUI(${gc.tag}) 入口候选：stopOnEntry=true 首停（含 CRT 的 main 桩时不得误判）`,
          gGot && !!gStop, gStop && gStop.body, 'stopped');
        check(`S10b GUI(${gc.tag}) 首停 reason=entry`, !!gStop && gStop.body.reason === 'entry', gStop && gStop.body, "reason='entry'");
        check(`S10b GUI(${gc.tag}) 首停描述标注实际入口符号（${gc.entrySymbol}）`,
          !!gStop && String(gStop.body.description || '').includes(gc.entrySymbol)
          && !new RegExp(`（main，`).test(String(gStop.body.description || '')),
          gStop && gStop.body.description, `含「${gc.entrySymbol}」且非 main 桩`);
        const gTh = await gClient.send('threads', {});
        const gSt = await gClient.send('stackTrace', { threadId: gTh.body?.threads?.[0]?.id, levels: 3 });
        const gF0 = gSt.body?.stackFrames?.[0];
        check(`S10b GUI(${gc.tag}) 首停停在用户源码入口行（${gc.srcName}:${gBodyLine}）`,
          gSt.success && !!gF0 && gF0.name === gc.entrySymbol
          && String(gF0.source?.path || '').replace(/\\/g, '/').toLowerCase().endsWith('/' + gc.srcName)
          && gF0.line === gBodyLine,
          gSt.body && gSt.body.stackFrames.slice(0, 3).map((f) => `${f.name}@${f.line}`), `${gc.entrySymbol}@${gBodyLine}`);
        const gCont = await gClient.send('continue', { threadId: gTh.body?.threads?.[0]?.id });
        const gTerm = await waitFor(() => gClient.events('terminated').length > 0, 15000);
        check(`S10b GUI(${gc.tag}) continue 后程序跑完（收到 terminated）`,
          gCont.success && gTerm, { cont: gCont.success, terminated: gClient.events('terminated').length }, 'success + terminated');
        await gClient.send('disconnect', {});
        await waitFor(() => !gAdapter.isActive(), 8000);
      }

      // ---- 兜底：无符号表（-s 链接）→ 程序入口地址首停（`info files` 的 Entry point） ----
      // 修复前：三个符号候选全部报 "No symbol table is loaded" ⇒ 不首停；修复后：入口地址断点可用
      //（`-break-insert -t *0x…`），DAP 侧仍上报 reason=entry，但该停点无源码信息（帧为 `??`）。
      const nosymExe = path.join(dir, 'entry-probe-nosym.exe');
      const rcNosym = rcEntry.status === 0
        ? spawnSync(gcc, ['-g', '-s', '-O0', '-o', nosymExe, entrySrc], { encoding: 'utf-8', windowsHide: true })
        : { status: 1, stderr: '入口探针基础编译失败' };
      if (rcNosym.status !== 0) {
        skipCheck('S10b 无符号表入口地址兜底', '入口探针 -s 编译失败: ' + String(rcNosym.stderr || '').split('\n')[0]);
      } else {
        const ns = await launchSession(ctx, {
          program: nosymExe, cwd: dir, sourcePath: entrySrc, breakpoints: [], extra: { stopOnEntry: true },
        });
        await ns.client.send('configurationDone', {});
        const nsGot = await waitFor(() => ns.client.events('stopped').length > 0, 15000);
        const nsStop = ns.client.lastStop();
        check('S10b 无符号表：入口地址兜底触发首停（不再静默不首停）', nsGot && !!nsStop, nsStop && nsStop.body, 'stopped');
        check('S10b 无符号表：首停 reason=entry', !!nsStop && nsStop.body.reason === 'entry', nsStop && nsStop.body, "reason='entry'");
        check('S10b 无符号表：描述标注入口地址（0x…）',
          !!nsStop && /0x[0-9a-fA-F]+/.test(String(nsStop.body.description || ''))
          && /入口/.test(String(nsStop.body.description || '')),
          nsStop && nsStop.body.description, '含「入口」+ 0x…');
        const nsTh = await ns.client.send('threads', {});
        const nsSt = await ns.client.send('stackTrace', { threadId: nsTh.body?.threads?.[0]?.id, levels: 2 });
        const nsF0 = nsSt.body?.stackFrames?.[0];
        check('S10b 无符号表：首帧无源码信息（入口地址停点语义，不伪造源码行）',
          nsSt.success && !!nsF0 && !nsF0.source, nsSt.body && nsSt.body.stackFrames.slice(0, 1).map((f) => ({ name: f.name, src: f.source })),
          '首帧无 source');
        const nsOut = ns.client.outputs();
        check('S10b 无符号表：输出一行可读中文说明（含 stopOnEntry 与入口地址）',
          /stopOnEntry/.test(nsOut) && /程序入口/.test(nsOut) && /0x[0-9a-fA-F]+/.test(nsOut), String(nsOut).slice(0, 400), '中文说明 + 地址');
        const nsCont = await ns.client.send('continue', { threadId: nsTh.body?.threads?.[0]?.id });
        const nsTerm = await waitFor(() => ns.client.events('terminated').length > 0, 15000);
        check('S10b 无符号表：continue 后程序正常跑完（收到 terminated）',
          nsCont.success && nsTerm, { cont: nsCont.success, terminated: ns.client.events('terminated').length }, 'success + terminated');
        await ns.client.send('disconnect', {});
        await waitFor(() => !ns.adapter.isActive(), 8000);
      }
    }

    // ================= S11 运行中请求快速返回（P3 防护验收） =================
    // 实测事实：本机 GDB 8.1 在程序运行时同步 MI 无任何回执（-thread-info/-break-insert/
    // -data-evaluate-expression 全部阻塞）。修复前：每个请求 ~30s 后超时（差分实测 30014ms/30000ms/
    // 30016ms/30005ms 全部 DAP 超时）；修复后：均 <5s 内返回缓存/占位或明确失败。
    {
      const { adapter, client } = await launchSession(ctx, {
        program: exePath, cwd: dir, sourcePath: srcPath, breakpoints: [],
      });
      await client.send('configurationDone', {});
      await sleep(800);
      check('S11 程序处于运行中（未停止）', adapter.isStopped() === false && adapter.isActive(),
        { stopped: adapter.isStopped(), active: adapter.isActive() }, 'running');

      const t0 = Date.now();
      const thRun = await client.send('threads', {});
      const thMs = Date.now() - t0;
      check('S11 运行中 threads 在 5s 内返回（不再等 30s MI 超时）', thRun.success && thMs < 5000,
        { ms: thMs, success: thRun.success }, '<5000ms');
      check('S11 运行中 threads 返回缓存线程列表 + 中文说明',
        Array.isArray(thRun.body?.threads) && /正在运行/.test(String(thRun.message || '')),
        { n: (thRun.body?.threads || []).length, message: thRun.message }, '缓存列表 + 说明');

      const t1 = Date.now();
      const evRun = await client.send('evaluate', { expression: 'g_counter', frameId: 0, context: 'watch' });
      const evMs = Date.now() - t1;
      check('S11 运行中 evaluate 快速失败并给出中文说明',
        evRun.success === false && evMs < 5000 && /正在运行/.test(String(evRun.message || '')),
        { ms: evMs, message: evRun.message }, '<5000ms 失败响应');

      const t2 = Date.now();
      const stRun = await client.send('stackTrace', { threadId: 1, levels: 2 });
      const stMs = Date.now() - t2;
      check('S11 运行中 stackTrace 快速失败（不悬挂）', stRun.success === false && stMs < 5000,
        { ms: stMs, message: stRun.message }, '<5000ms');

      const t3 = Date.now();
      const bpRun = await client.send('setBreakpoints', { source: { path: srcPath }, breakpoints: [{ line: WORKER_KEEPALIVE }] });
      const bpMs = Date.now() - t3;
      check('S11 运行中 setBreakpoints 快速返回「未下发」占位（verified=false + 说明）',
        bpRun.success && bpRun.body?.breakpoints?.[0]?.verified === false
        && /正在运行/.test(String(bpRun.body?.breakpoints?.[0]?.message || '')) && bpMs < 5000,
        { ms: bpMs, bp: bpRun.body && bpRun.body.breakpoints }, '<5000ms + verified=false');

      const totalMs = Date.now() - t0;
      check('S11 四个运行中请求合计 < 10s（修复前每个 ~30s 且全部超时）', totalMs < 10000, totalMs, '<10000ms');

      const t4 = Date.now();
      await client.send('disconnect', {});
      const dcMs = Date.now() - t4;
      await waitFor(() => !adapter.isActive(), 8000);
      check('S11 运行中 disconnect 快速结束会话', dcMs < 5000 && !adapter.isActive(),
        { ms: dcMs, active: adapter.isActive() }, '<5000ms 且会话结束');
    }
  } finally {
    cleanup();
  }

  console.log(`\ne2e 调试矩阵: ${pass} pass, ${fail} fail, ${skip} skip${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);

  function afterComputeLine() { return lineOf(PROBE_C, 'AFTER_COMPUTE'); }
}

main().catch((err) => {
  console.error('e2e 调试运行异常: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
