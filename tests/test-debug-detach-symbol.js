// 批次二 D1/D2 回归（真实 GDB 8.1 e2e + 守卫路径）：
//  D1  附加外部进程 → adapter.detach() → terminated 事件、进程继续存活（对齐 CB Debug → Detach）
//  D2  addSymbolFile：空/非法地址拒绝；带地址真实加载（输出含 add symbol table）、符号可见、
//      主符号未被替换（区别于 -file-symbol-file 的替换语义）；已加载库（=library-loaded）跟踪
// 参考取证：debuggergdb.cpp:2486-2491 / gdb_commands.h:354-375（detach=CLI detach）
//          debuggergdb.cpp:1794/1807（CB 的 Add symbol file 被注释）+ 报告 §2 实验 C2/C3/G
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    // 注意：真实 vscode.EventEmitter.event 会注册监听器（返回 Disposable）；
    // stub 必须同样保存监听器，否则 onDidSendMessage 捕获不到任何消息（本测试初期即因此假失败）。
    class EventEmitter {
      constructor() { this._listeners = []; }
      get event() {
        return (listener) => {
          this._listeners.push(listener);
          return { dispose: () => { const i = this._listeners.indexOf(listener); if (i >= 0) this._listeners.splice(i, 1); } };
        };
      }
      fire(value) { for (const l of [...this._listeners]) l(value); }
      dispose() { this._listeners = []; }
    }
    return {
      EventEmitter,
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => (key === 'gdbTimeoutMs' ? 30000 : def),
        }),
      },
      debug: { activeDebugSession: undefined },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { GdbDebugAdapter } = require('../dist/debug/gdbDebugAdapter.js');

let pass = 0, fail = 0;
let bgPid = 0; // 负载敏感：已加固——异常退出路径也要清理被测长驻进程，避免残留
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 负载敏感：已加固——默认等待 15s → 30s（整组运行时 GDB 启动/握手在 CI 负载下会明显变慢）
const waitFor = async (fn, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(50);
  }
  return false;
};
function findTool(candidates, name) {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  const w = spawnSync('where.exe', [name], { encoding: 'utf-8' });
  if (w.status === 0) {
    const first = (w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  }
  return undefined;
}

// ---- 接线冒烟（不依赖 GDB，先跑；确保无 GDB 环境也覆盖命令/菜单/适配器接线） ----
{
  const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
  const cmd = (id) => (pkg.contributes.commands || []).find((c) => c.command === id);
  check('命令贡献：Detach / Add Symbol File…',
    cmd('codeblocks.debug.detach')?.title === 'Code::Blocks: Detach'
    && cmd('codeblocks.debug.addSymbolFile')?.title === 'Code::Blocks: Add Symbol File…',
    [cmd('codeblocks.debug.detach')?.title, cmd('codeblocks.debug.addSymbolFile')?.title], 'ok');

  const extDist = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf-8');
  check('扩展接线：detach 命令（暂停守卫 + 调用 adapter.detach）',
    /codeblocks\.debug\.detach/.test(extDist) && /adapter\.detach\(\)/.test(extDist) && /仅暂停时提供 Detach/.test(extDist),
    'detach-wiring', 'ok');
  check('扩展接线：addSymbolFile 命令（库列表预填 + 地址校验 + adapter 调用）',
    /codeblocks\.debug\.addSymbolFile/.test(extDist) && /adapter\.loadedLibraries\(\)/.test(extDist)
    && /adapter\.addSymbolFile\(file, input\.trim\(\)\)/.test(extDist), 'symbol-wiring', 'ok');

  const menu = fs.readFileSync(path.resolve(__dirname, '../dist/ui/menuStructure.js'), 'utf-8');
  check('菜单：Debug 菜单六项对齐（Run to Cursor/Set Next/Remove All/Add Symbol/Attach/Detach）',
    /Run to Cursor/.test(menu) && /Set Next Statement/.test(menu) && /Remove All Breakpoints/.test(menu)
    && /Add Symbol File/.test(menu) && /Attach to Process/.test(menu) && /'Detach'/.test(menu), 'menu', 'ok');

  const adapterDist = fs.readFileSync(path.resolve(__dirname, '../dist/debug/gdbDebugAdapter.js'), 'utf-8');
  check('适配器：disconnect 对附加会话先显式 -target-detach',
    /-target-detach/.test(adapterDist) && /this\.attached && this\.session && !this\.detached/.test(adapterDist),
    'adapter-dist', 'ok');
  check('适配器：library-loaded/unloaded 跟踪 + loadedLibraries 暴露',
    /library-loaded/.test(adapterDist) && /library-unloaded/.test(adapterDist) && /loadedLibraries/.test(adapterDist),
    'libs', 'ok');
}

(async () => {
  const gcc = findTool(['D:\\Program Files\\mingw64\\bin\\gcc.exe'], 'gcc.exe');
  const gdb = findTool(['D:\\Program Files\\mingw64\\bin\\gdb.exe'], 'gdb.exe');
  if (!gcc || !gdb) {
    console.log(`SKIP D1/D2 端到端（gcc=${gcc || '未找到'}, gdb=${gdb || '未找到'}）`);
    process.exit(0);
  }

  // 负载敏感：已加固——夹具编译在 CI 高负载/杀软扫描下偶发瞬时失败：
  // 每次尝试前清理半成品，失败重试 1 次，并设显式超时（原为无限等待）
  const compileFixture = (args, outFile) => {
    let r;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try { fs.rmSync(outFile, { force: true }); } catch { /* 清理半成品失败不阻断 */ }
      r = spawnSync(gcc, args, { encoding: 'utf8', timeout: 120000 });
      if (r.status === 0) return r;
      if (attempt === 1) console.log(`     （夹具编译瞬时失败 exit=${r.status}，清理后重试 1 次）`);
    }
    return r;
  };
  // 负载敏感：已加固——预热 GDB 进程镜像（首次启动在负载下可能显著变慢），失败重试 1 次
  if (spawnSync(gdb, ['--version'], { encoding: 'utf8', timeout: 60000 }).status !== 0) {
    spawnSync(gdb, ['--version'], { encoding: 'utf8', timeout: 60000 });
  }

  // ---- 夹具：长驻进程 + 无 main 的符号探针对象 ----
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-detach-'));
  fs.writeFileSync(path.join(dir, 'loop.c'), '#include <windows.h>\nint main(void){ for(;;) Sleep(150); return 0; }\n');
  const loopExe = path.join(dir, 'loop.exe');
  let r = compileFixture(['-g', '-O0', '-o', loopExe, path.join(dir, 'loop.c')], loopExe);
  if (r.status !== 0) { console.log('SKIP：夹具编译失败 ' + (r.stderr || r.error)); process.exit(0); }
  fs.writeFileSync(path.join(dir, 'probe.c'), 'int cb_detach_probe(void) { return 42; }\n');
  const probeObj = path.join(dir, 'probe.o');
  r = compileFixture(['-g', '-O0', '-c', '-o', probeObj, path.join(dir, 'probe.c')], probeObj);
  if (r.status !== 0) { console.log('SKIP：探针编译失败 ' + (r.stderr || r.error)); process.exit(0); }

  const alive = (pid) => /\.exe/.test(spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8' }).stdout || '');

  // ---- 守卫路径：无会话 ----
  {
    const a = new GdbDebugAdapter('guard');
    let threw = false;
    try { await a.detach(); } catch { threw = true; }
    check('D1 守卫：无会话时 detach 抛错', threw, threw, true);
    threw = false;
    try { await a.addSymbolFile(probeObj, '0x1000'); } catch { threw = true; }
    check('D2 守卫：无会话时 addSymbolFile 抛错', threw, threw, true);
  }

  // ---- 附加会话（D1/D2 共用一台真实 GDB） ----
  const bg = spawn(loopExe, [], { detached: true, stdio: 'ignore' });
  bgPid = bg.pid;
  const pid = bgPid;
  // 负载敏感：已加固——轮询等待目标进程就绪（原为固定 600ms），避免高负载下附加到尚未就绪的进程
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && !alive(pid)) await sleep(250);
  }

  const msgs = [];
  const outputs = () => msgs.filter((m) => m.type === 'event' && m.event === 'output').map((m) => m.body.output).join('\n');
  const hasEvent = (name) => msgs.some((m) => m.type === 'event' && m.event === name);

  // 负载敏感：已加固——附加握手在 CI 负载下偶发超时（GDB 启动/响应慢）：
  // 每次尝试单独记录消息，无响应或 success=false 时整体重试 1 次
  const tryAttach = async () => {
    const got = [];
    const a = new GdbDebugAdapter('e2e');
    a.onDidSendMessage((m) => { got.push(m); msgs.push(m); });
    a.handleMessage({
      type: 'request', seq: 1, command: 'attach',
      arguments: { gdbPath: gdb, pid, program: loopExe, cwd: dir },
    });
    await waitFor(() => got.some((m) => m.type === 'response' && m.command === 'attach'));
    const resp = got.find((m) => m.type === 'response' && m.command === 'attach');
    return { adapter: resp && resp.success === true ? a : undefined, resp };
  };
  let attempt = await tryAttach();
  if (!attempt.adapter) {
    console.log('     （附加握手未成功，重试 1 次：' + (attempt.resp ? attempt.resp.message : '无响应') + '）');
    await sleep(1500);
    attempt = await tryAttach();
  }
  const adapter = attempt.adapter;
  const attachResp = attempt.resp;
  check('attach 会话建立成功', !!adapter && !!attachResp && attachResp.success === true, attachResp && attachResp.message, 'success');
  if (!adapter) {
    spawnSync('taskkill', ['/F', '/PID', String(pid)], { encoding: 'utf8' });
    console.log(`D1/D2 回归（真实 GDB）: ${pass} pass, ${fail} fail`);
    process.exit(1);
  }
  await waitFor(() => hasEvent('initialized'));
  // 负载敏感：已加固——轮询等待暂停态（附加后的 *stopped 记录可能略晚于 attach 响应到达）
  await waitFor(() => adapter.isStopped() === true, 10000);
  check('adapter.isAttached() === true（CB IsAttachedToProcess 语义）', adapter.isAttached() === true, adapter.isAttached(), true);
  check('附加后处于暂停态（CB：Detach 仅暂停时可用）', adapter.isStopped() === true, adapter.isStopped(), true);
  check('附加进程存活（前置）', alive(pid) === true, alive(pid), true);

  // D2：已加载库跟踪（=library-loaded；地址预填数据源）
  await waitFor(() => adapter.loadedLibraries().length > 0, 15000); // 负载敏感：已加固（原 4s → 15s）
  const libs = adapter.loadedLibraries();
  check(`已加载库跟踪（${libs.length} 条）`, libs.length > 0 && libs.every((l) => !!l.name), libs.slice(0, 3), '>=1 且含名字');
  check('库条目带 .text 加载地址（可供地址预填）', libs.some((l) => /^0x[0-9a-f]+$/i.test(l.from || '')), libs.find((l) => l.from), '0x…');

  // D2：地址守卫
  let threw = false;
  try { await adapter.addSymbolFile(probeObj, ''); } catch { threw = true; }
  check('D2 守卫：空地址拒绝（GDB 硬约束：无地址必失败）', threw, threw, true);
  threw = false;
  try { await adapter.addSymbolFile(probeObj, 'zzz'); } catch { threw = true; }
  check('D2 守卫：非法地址格式拒绝', threw, threw, true);

  // D2：真实加载附加符号
  await adapter.addSymbolFile(probeObj, '0x30000000');
  // 负载敏感：已加固——以下三处原为固定 sleep(400) 后断言，改为轮询等待 GDB 回显（高负载下回显会晚到）
  await waitFor(() => /add symbol table from file/.test(outputs()), 15000);
  check('D2：GDB 输出含 add symbol table（add 语义生效）', /add symbol table from file/.test(outputs()), outputs().split('\n').filter((l) => /symbol/.test(l)).slice(0, 2), 'add symbol table');
  await adapter.sendUserCommand('info address cb_detach_probe');
  await waitFor(() => /cb_detach_probe.*0x30000000/i.test(outputs()), 15000);
  check('D2：附加符号可见且地址 = 0x30000000',
    /cb_detach_probe.*0x30000000/i.test(outputs()), outputs().split('\n').filter((l) => /cb_detach_probe/.test(l)).slice(0, 2), 'cb_detach_probe @0x30000000');
  await adapter.sendUserCommand('info address main');
  await waitFor(() => /Symbol "main" is a function/.test(outputs()), 15000);
  check('D2：主符号未被替换（区别于 -file-symbol-file 的替换语义，实验 C1）',
    /Symbol "main" is a function/.test(outputs()) && !/No symbol "main"/.test(outputs()),
    outputs().split('\n').filter((l) => /"main"/.test(l)).slice(-2), 'main 仍可见');

  // D1：detach
  await adapter.detach();
  // 负载敏感：已加固——轮询等待 terminated 事件（原固定 sleep(1300)），高负载下事件可能晚到
  await waitFor(() => hasEvent('terminated'), 15000);
  check('D1：detach 后发送 terminated 事件', hasEvent('terminated'), 'terminated', 'terminated');
  check('D1：adapter.isDetached() === true', adapter.isDetached() === true, adapter.isDetached(), true);
  check('D1：被附加进程继续运行（CB 语义：分离不杀进程）', alive(pid) === true, alive(pid), true);

  // 清理
  spawnSync('taskkill', ['/F', '/PID', String(pid)], { encoding: 'utf8' });
  fs.rmSync(dir, { recursive: true, force: true });

  console.log(`D1/D2 回归（真实 GDB）: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  // 负载敏感：已加固——异常路径同样清理被测长驻进程，避免残留进程拖慢后续用例
  if (bgPid) spawnSync('taskkill', ['/F', '/PID', String(bgPid)], { encoding: 'utf8' });
  console.error('异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
