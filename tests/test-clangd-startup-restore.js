// 启动恢复（窗口 reload）路径的 clangd 行为回归：
//  阶段 A（模拟首次会话）：打开两个**同名**工程（app/app.cbp），生成编译数据库与 clangd 配置
//  阶段 B（模拟窗口 reload）：预置 workspaceState（上次会话的 projectOrder）→ 激活时恢复这两个工程
//  期望（修复前的问题）：
//   - 每个工程各打开一次（`Project opened` ×2，且带 `Project file:` 便于区分同名工程）
//   - clangd 生成/配置写入**只跑一次**（批量合并，不再按工程数翻倍）
//   - 编译数据库未变、仅配置变化 ⇒ **不**执行 clangd.restart（避免与 clangd 客户端初始化竞态导致的
//     `command 'clangd.applyFix' already exists` / “couldn't create connection to server”弹窗），并留一行说明
// 两阶段必须在**独立进程**中执行（模块级状态与 require 缓存不跨会话复用），故本文件自身 spawn 自己。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');

const phase = (process.argv.find((a) => a.startsWith('--phase=')) || '').split('=')[1] || '';

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else {
    fail++;
    console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`);
  }
}

async function waitFor(cond, timeoutMs = 20000, stepMs = 50) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = cond(); } catch { ok = false; }
    if (ok) return true;
    if (Date.now() - t0 > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

/** 最小可解析 .cbp（title 可重复：本次回归正是要模拟两个同名工程） */
function writeCbp(dir, title) {
  fs.mkdirSync(dir, { recursive: true });
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n'
    + '\t<FileVersion major="1" minor="6" />\n'
    + '\t<Project>\n'
    + `\t\t<Option title="${title}" />\n`
    + '\t\t<Option compiler="gcc" />\n'
    + '\t\t<Build>\n'
    + '\t\t\t<Target title="Debug">\n'
    + '\t\t\t\t<Option type="1" />\n'
    + '\t\t\t\t<Option compiler="gcc" />\n'
    + `\t\t\t\t<Option output="bin/Debug/${title}" />\n`
    + '\t\t\t\t<Option object_output="obj/Debug/" />\n'
    + '\t\t\t</Target>\n'
    + '\t\t</Build>\n'
    + '\t\t<Unit filename="main.c" />\n'
    + '\t</Project>\n'
    + '</CodeBlocks_project_file>\n';
  const p = path.join(dir, `${title}.cbp`);
  fs.writeFileSync(p, xml, 'utf-8');
  fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void) { return 0; }\n', 'utf-8');
  return p;
}

/** 编译数据库路径：globalStorage/clangd/<作用域哈希>/compile_commands.json */
function findDb(ctx) {
  const root = path.join(ctx.globalStorageUri.fsPath, 'clangd');
  if (!fs.existsSync(root)) return '';
  for (const d of fs.readdirSync(root)) {
    const p = path.join(root, d, 'compile_commands.json');
    if (fs.existsSync(p)) return p;
  }
  return '';
}

/** 阶段 A：打开两个同名工程，产出上次会话的 projectOrder（供阶段 B 预置） */
async function runPhaseA(root) {
  const { activate } = require('./_harness/extensionActivation');
  const fakeClangd = path.join(root, 'clangd-fake.exe');
  if (!fs.existsSync(fakeClangd)) fs.writeFileSync(fakeClangd, 'x', 'utf-8');
  const cbp1 = writeCbp(path.join(root, 'projects', 'earphone'), 'app');
  const cbp2 = writeCbp(path.join(root, 'projects', 'esop8'), 'app');

  const app = await activate({
    tmpDir: root,
    findFilesResult: [], // 只走「恢复上次会话」路径，避免自动检测再打开一批工程干扰计数
    config: {
      'clangd.path': fakeClangd,
      'codeblocks.clangd.enabled': true,
      'codeblocks.clangd.suppressedWarnings': ['-Wunused-function'],
    },
  });
  const channel = app.mock.channels.filter((c) => c.name === 'Code::Blocks').pop();
  await app.invoke('codeblocks.openProject', cbp1);
  await app.invoke('codeblocks.openProject', cbp2);

  const dbReady = await waitFor(() => {
    const db = findDb(app.ctx);
    if (!db) return false;
    const text = fs.readFileSync(db, 'utf-8');
    return text.includes('earphone') && text.includes('esop8');
  });
  check('[A] 两个工程都进了编译数据库', dbReady, findDb(app.ctx));

  const order = app.ctx.workspaceState.get('codeblocks.projectOrder');
  fs.writeFileSync(path.join(root, 'order.json'), JSON.stringify({ order, cbp1, cbp2 }), 'utf-8');
  check('[A] 已持久化 projectOrder（2 项）', Array.isArray(order) && order.length === 2, order);
  check('[A] 已打开同名工程（title 均为 app）', /app\.cbp/.test(cbp1) && /app\.cbp/.test(cbp2), [cbp1, cbp2]);
  await app.deactivate();
  console.log(`PHASE_A pass=${pass} fail=${fail} logs=${channel ? channel.lines.length : 0}`);
  process.exit(fail ? 1 : 0);
}

/** 阶段 B：模拟窗口 reload（预置 projectOrder）→ 恢复期只生成一次、且不重启 clangd */
async function runPhaseB(root) {
  const { activate } = require('./_harness/extensionActivation');
  const saved = JSON.parse(fs.readFileSync(path.join(root, 'order.json'), 'utf-8'));
  const fakeClangd = path.join(root, 'clangd-fake.exe');

  const app = await activate({
    tmpDir: root,
    findFilesResult: [],
    // 与阶段 A 不同的 clangd 设置 ⇒ 本次只有「配置变化」，编译数据库不变
    config: {
      'clangd.path': fakeClangd,
      'codeblocks.clangd.enabled': true,
      'codeblocks.clangd.suppressedWarnings': ['-Wunused-function', '-Wempty-body'],
    },
    // 上次会话的工程列表（窗口 reload 后由扩展恢复）
    workspaceState: { 'codeblocks.projectOrder': saved.order },
    // clangd 扩展已激活（真实场景：reload 后 clangd 客户端正在 initialize）
    installedExtensions: [{ id: 'llvm-vs-code-extensions.vscode-clangd', isActive: true }],
  });
  const channel = app.mock.channels.filter((c) => c.name === 'Code::Blocks').pop();
  const lines = () => (channel ? channel.lines : []);
  const count = (re) => lines().filter((l) => re.test(l)).length;

  const restored = await waitFor(() => count(/已打开项目: app/) >= 2);
  check('[B] reload 后恢复两个工程（Project opened ×2）', restored, count(/已打开项目: app/));
  check('[B] 两个工程路径都可辨识（Project file: 行 ×2）', count(/工程文件: .*app\.cbp/) >= 2, lines().filter((l) => /工程文件:/.test(l)));

  const generated = await waitFor(() => count(/已更新 clangd 用户配置|clangd 用户配置未变化/) >= 1);
  // 等生成链路彻底结束（配置写入后再观察一小段时间，确认没有第二次生成）
  await new Promise((r) => setTimeout(r, 1500));
  check('[B] clangd 配置只写一次（批量合并，不随工程数翻倍）',
    generated && count(/已更新 clangd 用户配置|clangd 用户配置未变化/) === 1,
    lines().filter((l) => /clangd 用户配置/.test(l)));
  check('[B] 编译数据库只检查/写入一次（未变化则跳过写入）',
    count(/compile_commands\.json 未变化，跳过写入/) === 1,
    lines().filter((l) => /compile_commands\.json/.test(l)));

  check('[B] 恢复期「仅配置变化」不重启 clangd（避免与客户端初始化竞态）',
    app.records.executeCommand.filter((c) => c.id === 'clangd.restart').length === 0,
    app.records.executeCommand.map((c) => c.id));
  check('[B] 跳过重启时输出说明日志（可排查「为什么没重启」）',
    count(/仍在启动中，本次仅配置变化，跳过重启/) === 1,
    lines().filter((l) => /跳过重启/.test(l)));

  await app.deactivate();
  console.log(`PHASE_B pass=${pass} fail=${fail}`);
  console.log(`RESULT pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
}

(async () => {
  const root = process.env.CB_STARTUP_ROOT || path.join(os.tmpdir(), 'cb-clangd-startup');
  if (phase === 'a' || phase === 'b') {
    process.env.LOCALAPPDATA = path.join(root, 'LocalAppData');
    process.env.XDG_CONFIG_HOME = path.join(root, 'config');
    if (phase === 'a') await runPhaseA(root);
    else await runPhaseB(root);
    return;
  }

  // 父进程：清空临时根目录 → 顺序跑两次独立进程
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  const env = { ...process.env, CB_STARTUP_ROOT: root };
  let total = 0;
  for (const p of ['a', 'b']) {
    const r = spawnSync(process.execPath, [__filename, `--phase=${p}`], { env, encoding: 'utf-8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`.trim();
    console.log(out);
    const m = out.match(/PHASE_[AB] pass=(\d+) fail=(\d+)/);
    if (!m) { total++; console.log(`FAIL 阶段 ${p} 未产出结果行（exit=${r.status}）`); continue; }
    total += Number(m[2]);
  }
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 句柄占用时忽略 */ }
  console.log(`\n启动恢复 clangd 回归: ${total === 0 ? 'pass' : total + ' fail'}`);
  process.exit(total ? 1 : 0);
})().catch((err) => {
  console.error('启动恢复 clangd 回归：异常退出\n' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
