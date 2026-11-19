// D-10 调试命令行为回归：8 条调试辅助命令通过真实处理器驱动适配器
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-debug-cmd-'));
  const app = await activate({ tmpDir: tmp, config: {} });
  const registry = require('../dist/debug/debugRegistry.js');

  const calls = [];
  const adapter = {
    isActive: () => true,
    isStopped: () => true,
    stepInstruction: async (kind) => { calls.push(['step', kind]); },
    sendUserCommand: async (cmd) => { calls.push(['cmd', cmd]); return `OUT:${cmd}`; },
    readMemoryDump: async (expr, count) => { calls.push(['mem', expr, count]); return { address: 0x1000, data: Buffer.from([0x90, 0x90, 0x90, 0x90]) }; },
  };
  registry.registerAdapter('d10-session', adapter);

  const channelLines = (name) => {
    const ch = app.mock.channels.find((c) => c.name === name);
    return ch ? ch.lines.join('\n') : '';
  };

  // sendGdbCommand
  app.setInputBox('add-symbol-file build/app.elf');
  await app.invoke('codeblocks.debug.sendGdbCommand');
  check('sendGdbCommand 把输入原样交给适配器',
    calls.some((c) => c[0] === 'cmd' && c[1] === 'add-symbol-file build/app.elf'), calls);
  check('sendGdbCommand 在状态栏显示命令输出',
    app.records.statusBarMessages.some((m) => /GDB: OUT:add-symbol-file/.test(m)), app.records.statusBarMessages.slice(-2));

  // nextInstruction / stepIntoInstruction
  calls.length = 0;
  await app.invoke('codeblocks.debug.nextInstruction');
  check('nextInstruction → stepInstruction(next)', calls.length === 1 && calls[0][0] === 'step' && calls[0][1] === 'next', calls);
  calls.length = 0;
  await app.invoke('codeblocks.debug.stepIntoInstruction');
  check('stepIntoInstruction → stepInstruction(into)', calls.length === 1 && calls[0][0] === 'step' && calls[0][1] === 'into', calls);

  // examineMemory（表达式 + 字节数两个输入框）
  calls.length = 0;
  app.setInputBox('&buf');
  app.setInputBox('4');
  await app.invoke('codeblocks.debug.examineMemory');
  check('examineMemory 读取指定表达式与字节数',
    calls.length === 1 && calls[0][0] === 'mem' && calls[0][1] === '&buf' && calls[0][2] === 4, calls);
  check('examineMemory 把转储写入 Code::Blocks Memory 通道',
    /Examine memory|查看内存/.test(channelLines('Code::Blocks Memory')) && /0000000000001000/.test(channelLines('Code::Blocks Memory')),
    channelLines('Code::Blocks Memory').slice(0, 200));

  // info 系列（GDB CLI 命令透传 + 输出通道留痕）
  for (const [cmd, gdb] of [
    ['codeblocks.debug.infoSharedLibrary', 'info sharedlibrary'],
    ['codeblocks.debug.infoFloat', 'info float'],
    ['codeblocks.debug.infoSignals', 'info signals'],
  ]) {
    calls.length = 0;
    const before = channelLines('Code::Blocks');
    await app.invoke(cmd);
    check(`${cmd} → GDB "${gdb}"`, calls.length === 1 && calls[0][0] === 'cmd' && calls[0][1] === gdb, calls);
    const after = channelLines('Code::Blocks');
    check(`${cmd} 输出写入 Code::Blocks 通道`,
      after.length > before.length && after.includes(`OUT:${gdb}`), after.slice(-160));
  }

  // attachToProcess（真实进程列表 → QuickPick → startDebugging attach 配置）
  app.setQuickPick({ label: 'demo.exe', description: 'PID 4321', pid: 4321 });
  await app.invoke('codeblocks.debug.attachToProcess');
  const prompt = app.records.quickPickPrompts.find((p) => p.items.length > 0 && /process|进程/i.test(String(p.options?.placeHolder || '')));
  check('attachToProcess 列出进程并弹出选择框', !!prompt, app.records.quickPickPrompts.slice(-1));
  check('attachToProcess 以 attach + pid 启动调试',
    app.mock.debugStarts.some((s) => s.config.request === 'attach' && s.config.pid === 4321), app.mock.debugStarts);

  registry.unregisterAdapter('d10-session', adapter);
  await app.deactivate().catch(() => undefined);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\nD-10 调试命令行为: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('D-10 调试命令行为异常: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
