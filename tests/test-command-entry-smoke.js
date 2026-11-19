// 命令入口层 CI（F-12）：在可激活 mock 宿主中逐条调用非重命令，
// 断言“命令已注册、入口可执行、无异常/无超时”。功能正确性仍由分域测试覆盖。
// 分区守卫见 tests/test-command-inventory.js：除 HEAVY 外的命令都必须在此被执行，
// 新增命令若既不在 HEAVY 里也未被本文件执行，守卫会报红。
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
  try { app.vscode.window.terminals.length = 0; } catch { /* mock 无 terminals：无需清理 */ }
  const ids = allIds.filter((id) => !HEAVY.has(id));
  const failures = [];
  for (const id of ids) {
    const r = await withTimeout(app.invoke(id), 4000);
    if (r.state !== 'ok') failures.push({ id, ...r });
  }
  await app.deactivate().catch(() => undefined);
  if (failures.length) {
    console.log(`FAIL 命令入口 ${failures.length}/${ids.length}`, failures.slice(0, 10));
    console.log(`命令入口冒烟: ${ids.length - failures.length} pass, ${failures.length} fail（${allIds.length} 条声明）`);
    process.exit(1);
  }
  console.log(`OK   命令入口冒烟：${ids.length}/${allIds.length} 条命令可执行（其余 ${HEAVY.size} 条重命令由 e2e/host 覆盖）`);
  console.log(`命令入口冒烟: ${ids.length} pass, 0 fail（${allIds.length} 条声明）`);
  process.exit(0);
})().catch((e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
