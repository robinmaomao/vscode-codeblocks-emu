// 命令入口层 CI（F-12）：在可激活 mock 宿主中逐条调用非重命令，
// 断言“命令已注册、入口可执行、无异常/无超时”。功能正确性仍由分域测试覆盖。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const allIds = pkg.contributes.commands.map((c) => c.command);

// 会启动真实构建/外部进程或需要真实 GUI 的命令：由 e2e/host/分域测试覆盖
const HEAVY = new Set([
  'codeblocks.build', 'codeblocks.rebuild', 'codeblocks.buildWorkspace', 'codeblocks.buildAndRun',
  'codeblocks.clean', 'codeblocks.distClean', 'codeblocks.cleanWorkspace', 'codeblocks.rebuildWorkspace',
  'codeblocks.run', 'codeblocks.profileTarget', 'codeblocks.generateCompileCommands', 'codeblocks.restartClangd',
  'codeblocks.installCompilerCache', 'codeblocks.findSymbolInLibraries', 'codeblocks.detectCompilers',
  'codeblocks.workspaceScanReport',
]);
const DEFERRED = new Set([
  'codeblocks.keybindings.panel', 'codeblocks.projectProperties', 'codeblocks.compilerOptions',
  'codeblocks.keybindings.apply', 'codeblocks.keybindings.reset', 'codeblocks.debug.attachToProcess',
]);
const DESTRUCTIVE = new Set(['codeblocks.closeProject', 'codeblocks.removeProject']);
const UI_PENDING = new Set(['codeblocks.detectCompilers']);

async function withTimeout(promise, ms) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(() => ({ state: 'ok' })),
      new Promise((resolve) => { timer = setTimeout(() => resolve({ state: 'timeout' }), ms); }),
    ]);
  } catch (e) {
    return { state: 'threw', error: e && e.message ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-entry-'));
  const app = await activate({ tmpDir: tmp });
  try { app.vscode.window.terminals = []; } catch { /* mock 无 terminals：补空数组即可 */ }
  const ids = allIds.filter((id) => !HEAVY.has(id) && !DEFERRED.has(id) && !DESTRUCTIVE.has(id));
  const failures = [];
  for (const id of ids) {
    const r = await withTimeout(app.invoke(id), UI_PENDING.has(id) ? 2000 : 4000);
    if (r.state !== 'ok' && !(r.state === 'timeout' && UI_PENDING.has(id))) failures.push({ id, ...r });
  }
  await app.deactivate().catch(() => undefined);
  if (failures.length) {
    console.log(`FAIL 命令入口 ${failures.length}/${ids.length}`, failures.slice(0, 10));
    console.log(`命令入口冒烟: ${ids.length - failures.length} pass, ${failures.length} fail（${allIds.length} 条声明）`);
    process.exit(1);
  }
  console.log(`OK   命令入口冒烟：${ids.length}/${ids.length} 条非重命令可执行（${allIds.length} 条声明）`);
  console.log(`命令入口冒烟: ${ids.length} pass, 0 fail（${allIds.length} 条声明）`);
  process.exit(0);
})().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
