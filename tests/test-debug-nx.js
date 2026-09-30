// 第六轮 F5：GDB -nx（对齐 CB debugger settings disable_init 默认 true；gdb_driver.cpp:104-105/127-128）
//  - gdbMiSession.start：nx=true 时 argv 含 -nx 且位于 userArguments 之前；false/缺省不含（向后兼容）
//  - 静态接线：gdbDebugAdapter launch/attach 两处读取 codeblocks.debug.disableInit
// 用 fake child_process.spawn 捕获启动 argv（握手用伪造的 `1^done` 完成 -gdb-version 探针）。
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const child_process = require('child_process');

const captured = [];
const origSpawn = child_process.spawn;
child_process.spawn = function fakeSpawn(exe, args, opts) {
  captured.push({ exe, args, opts });
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = {
    write(s) {
      // 异步回送（与真实进程一致）：send() 是先 write 后注册 pending，同步回送会被丢弃
      if (String(s).includes('-gdb-version')) setImmediate(() => proc.stdout.emit('data', Buffer.from('1^done\n')));
      return true;
    },
  };
  return proc;
};

const { GdbMiSession } = require(path.resolve(__dirname, '../dist/debug/gdbMiSession.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

async function startAndCapture(opts) {
  captured.length = 0;
  const s = new GdbMiSession(2000);
  await s.start(opts);
  return captured[0];
}

(async () => {
  // A) nx=true → -nx（默认对齐 CB）
  const a = await startAndCapture({ gdbPath: 'gdb', nx: true });
  check('A: nx=true 时 argv 含 -nx', a.args.includes('-nx'), a.args);
  check('A: 顺序 -i=mi --quiet -nx', JSON.stringify(a.args) === JSON.stringify(['-i=mi', '--quiet', '-nx']), a.args);
  check('A: 可执行文件 = gdbPath 且仅 spawn 一次', a.exe === 'gdb' && captured.length === 1, { exe: a.exe, n: captured.length });

  // B) nx=true + userArguments → -nx 在用户参数之前（对齐 CB 顺序）
  const b = await startAndCapture({ gdbPath: 'C:\\gdb\\bin\\gdb.exe', nx: true, args: ['--nx', '-ex', 'set pagination off'] });
  check('B: -nx 在 userArguments 之前',
    JSON.stringify(b.args) === JSON.stringify(['-i=mi', '--quiet', '-nx', '--nx', '-ex', 'set pagination off']), b.args);

  // C) nx=false → 不含 -nx（userArguments 原样传入）
  const c = await startAndCapture({ gdbPath: 'gdb', nx: false, args: ['-ex', 'x'] });
  check('C: nx=false 时不传 -nx', !c.args.includes('-nx') && c.args.includes('-ex'), c.args);

  // D) 缺省 nx（旧调用方）→ 不含 -nx（向后兼容）
  const d = await startAndCapture({ gdbPath: 'gdb' });
  check('D: 缺省 nx 时不传 -nx（向后兼容）', JSON.stringify(d.args) === JSON.stringify(['-i=mi', '--quiet']), d.args);

  // E) 静态接线：适配器 launch + attach 均读取 debug.disableInit（dist 编译后形态）
  const adapterSrc = fs.readFileSync(path.resolve(__dirname, '../dist/debug/gdbDebugAdapter.js'), 'utf8');
  const occurrences = (adapterSrc.match(/debug\.disableInit/g) || []).length;
  check('E: gdbDebugAdapter launch/attach 两处接线', occurrences >= 2, occurrences);

  child_process.spawn = origSpawn;
  console.log(`GDB -nx 回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); child_process.spawn = origSpawn; process.exit(2); });
