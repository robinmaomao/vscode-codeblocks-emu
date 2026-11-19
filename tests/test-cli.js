// cb-cli 端到端（子进程）：stdout 纯 JSON、退出码约定
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'cb-cli.js');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-cli');
const SRC = path.join(ROOT, 'test-project');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

function run(args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf-8',
    timeout: 120000,
    env: env ? { ...process.env, ...env } : process.env,
  });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function freshCopy() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
  for (const entry of fs.readdirSync(SRC)) {
    const from = path.join(SRC, entry);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(TMP, entry));
  }
  return path.join(TMP, 'hello-cb.cbp');
}

const cbp = freshCopy();

// ---------- show ----------
const show = run(['show', cbp, '--section', 'summary', '--json']);
let showJson;
try { showJson = JSON.parse(show.stdout); } catch { showJson = undefined; }
check('C1 show --json 是纯 JSON', show.code === 0 && !!showJson, show.stderr.slice(0, 200));
check('C2 show 摘要正确', showJson && showJson.summary.title === 'hello-cb' && showJson.summary.targetCount === 2, showJson && showJson.summary);

// ---------- schema ----------
const schema = run(['schema', '--json']);
const schemaJson = schema.code === 0 ? JSON.parse(schema.stdout) : undefined;
check('C3 schema 无需工程即可读', !!schemaJson && Array.isArray(schemaJson.schema.target) && schemaJson.schema.target.length > 10);

// ---------- edit ----------
const opsFile = path.join(TMP, 'ops.json');
fs.writeFileSync(opsFile, JSON.stringify([{ op: 'add', scope: 'target', target: 'Debug', field: 'compilerOptions', value: '-std=c++17' }]));
const edit = run(['edit', cbp, '--ops-file', opsFile, '--json']);
const editJson = edit.code === 0 ? JSON.parse(edit.stdout) : undefined;
check('C4 edit --ops-file', !!editJson && editJson.written === true && editJson.changed.length === 1, editJson || edit.stderr.slice(0, 200));
const afterEdit = run(['show', cbp, '--section', 'targets', '--target', 'Debug', '--json']);
check('C5 编辑结果可读回', afterEdit.code === 0 && JSON.parse(afterEdit.stdout).targets[0].compilerOptions.includes('-std=c++17'));

// ---------- build dryRun ----------
const dry = run(['build', cbp, '--dry-run', '--json']);
const dryJson = dry.code === 0 ? JSON.parse(dry.stdout) : undefined;
check('C6 build --dry-run', !!dryJson && dryJson.dryRun === true && typeof dryJson.target === 'string', dryJson || dry.stderr.slice(0, 200));

// ---------- compiler ----------
const compilers = run(['compiler', 'list', '--json']);
const compilersJson = compilers.code === 0 ? JSON.parse(compilers.stdout) : undefined;
check('C7 compiler list 过滤 common_*', !!compilersJson && compilersJson.compilers.includes('gcc') && !compilersJson.compilers.some((c) => /^common[_-]/.test(c)), compilersJson && compilersJson.compilers.slice(0, 6));

// ---------- 退出码 ----------
const badCmd = run(['nope']);
check('C8 未知命令 exit 2', badCmd.code === 2, badCmd.code);
const missing = run(['show', path.join(TMP, 'missing.cbp'), '--json']);
check('C9 工程不存在 exit 5', missing.code === 5, { code: missing.code, stderr: missing.stderr.slice(0, 120) });
const noRun = run(['run', cbp, '--target', 'Debug', '--json']);
check('C10 未构建时 run exit 3', noRun.code === 3, { code: noRun.code, stderr: noRun.stderr.slice(0, 160) });
const badOps = path.join(TMP, 'bad.json');
fs.writeFileSync(badOps, '[{"op":"set","scope":"project","field":"nope","value":1}]');
const badEdit = run(['edit', cbp, '--ops-file', badOps, '--json']);
check('C11 非法字段 exit 3', badEdit.code === 3, { code: badEdit.code, stderr: badEdit.stderr.slice(0, 160) });

// ---------- 失败时的机器可读输出（--json 时 stdout 仍是 JSON） ----------
let missingJson;
try { missingJson = JSON.parse(missing.stdout); } catch { missingJson = undefined; }
check('C17 --json 失败时 stdout 仍是 { ok:false, error.code }',
  !!missingJson && missingJson.ok === false && !!missingJson.error && missingJson.error.code === 'project-not-found',
  missing.stdout.slice(0, 160));

// ---------- 平台守卫：显式指定「当前平台不支持」的目标必须报错，不能静默返回成功 ----------
{
  const platDir = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-cli-platform');
  fs.rmSync(platDir, { recursive: true, force: true });
  fs.mkdirSync(platDir, { recursive: true });
  for (const entry of fs.readdirSync(SRC)) {
    const from = path.join(SRC, entry);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(platDir, entry));
  }
  const platCbp = path.join(platDir, 'hello-cb.cbp');
  // 与当前平台互斥的平台位掩码（spMac=1 / spUnix=2 / spWindows=4）
  const platMask = process.platform === 'win32' ? 0x02 : 0x04;
  const platOpsFile = path.join(platDir, 'ops.json');
  fs.writeFileSync(platOpsFile, JSON.stringify([
    { op: 'set', scope: 'target', target: 'Debug', field: 'platforms', value: platMask },
    { op: 'set', scope: 'target', target: 'Release', field: 'platforms', value: platMask },
  ]));
  const platEdit = run(['edit', platCbp, '--ops-file', platOpsFile, '--json']);
  check('C18 平台位掩码可写回', platEdit.code === 0 && JSON.parse(platEdit.stdout).written === true, platEdit.stderr.slice(0, 200));
  const platBuild = run(['build', platCbp, '--target', 'Debug', '--json']);
  check('C19 平台不支持的目标 → exit 4 且错误码 unsupported',
    platBuild.code === 4 && /unsupported:/.test(platBuild.stderr), { code: platBuild.code, stderr: platBuild.stderr.slice(0, 200) });
  fs.rmSync(platDir, { recursive: true, force: true });
}

// ---------- 运行期校验（审计轮 D-01…D-09） ----------
const help = run(['--help']);
check('C20 --help 退出码 0', help.code === 0 && /Usage:/.test(help.stdout), { code: help.code });
const helpShort = run(['-h']);
check('C20b -h 退出码 0', helpShort.code === 0, helpShort.code);

const unknownFlag = run(['show', cbp, '--json', '--frobnicate']);
let unknownFlagJson;
try { unknownFlagJson = JSON.parse(unknownFlag.stdout); } catch { unknownFlagJson = undefined; }
check('C21 未知开关 → exit 2 + usage 错误', unknownFlag.code === 2 && unknownFlagJson?.error?.code === 'usage',
  { code: unknownFlag.code, out: unknownFlag.stdout.slice(0, 120) });

const badSection = run(['show', cbp, '--section', 'nope', '--json']);
check('C22 非法 section → exit 3 invalid-input', badSection.code === 3 && /invalid-input/.test(badSection.stderr),
  { code: badSection.code, err: badSection.stderr.slice(0, 120) });

const badKind = run(['export', cbp, '--kind', 'nope', '--json']);
check('C23 非法 export kind → exit 3', badKind.code === 3 && /invalid-input/.test(badKind.stderr),
  { code: badKind.code, err: badKind.stderr.slice(0, 120) });

const badCompiler = run(['compiler', 'info', '--compiler-id', 'nope', '--json']);
check('C24 未知编译器 id → exit 3', badCompiler.code === 3 && /invalid-input/.test(badCompiler.stderr),
  { code: badCompiler.code, err: badCompiler.stderr.slice(0, 120) });

const badFormat = run(['edit', cbp, '--format', 'nope', '--ops', JSON.stringify([{ op: 'set', scope: 'project', field: 'title', value: 'hello-cb' }]), '--json']);
check('C25 非法 format → exit 3', badFormat.code === 3, { code: badFormat.code, err: badFormat.stderr.slice(0, 120) });

const badTimeout = run(['build', cbp, '--dry-run', '--timeout', 'abc', '--json']);
check('C26 非法 timeout → exit 3 invalid-input', badTimeout.code === 3 && /invalid-input/.test(badTimeout.stderr),
  { code: badTimeout.code, err: badTimeout.stderr.slice(0, 120) });

const escapeOut = run(['export', cbp, '--kind', 'makefile', '--out', '..\\escape.mk', '--json']);
check('C27 export out 越界 → exit 3', escapeOut.code === 3 && /invalid-input/.test(escapeOut.stderr),
  { code: escapeOut.code, err: escapeOut.stderr.slice(0, 120) });
check('C27b 未写出越界文件', !fs.existsSync(path.join(path.dirname(TMP), 'escape.mk')));

// ---------- run 退出码传播：程序非零退出不得改写成 4 ----------
{
  const where = process.platform === 'win32'
    ? spawnSync('where.exe', ['gcc'], { encoding: 'utf-8' })
    : spawnSync('which', ['gcc'], { encoding: 'utf-8' });
  const gccPath = (where.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  if (gccPath) {
    const dir = path.join(TMP, 'runner');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void){return 3;}\n');
    const rcbp = path.join(dir, 'r.cbp');
    fs.writeFileSync(rcbp, [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
      '<CodeBlocks_project_file><FileVersion major="1" minor="6" /><Project>',
      '<Option title="r" /><Option compiler="gcc" /><Build>',
      '<Target title="Debug"><Option output="bin/Debug/r" prefix_auto="1" extension_auto="1" />',
      '<Option object_output="obj/Debug/" /><Option type="1" /><Option compiler="gcc" /></Target>',
      '</Build><Unit filename="main.c" /></Project></CodeBlocks_project_file>',
      '',
    ].join('\n'));
    const env = { CB_MASTER_PATH: path.dirname(gccPath) };
    const rb = run(['build', rcbp, '--json'], env);
    check('C28 前置：run 用例构建成功', rb.code === 0, { code: rb.code, err: rb.stderr.slice(0, 160) });
    const rr = run(['run', rcbp, '--json'], env);
    check('C29 run 保留程序退出码 3', rr.code === 3, { code: rr.code, out: rr.stdout.slice(0, 160) });
    const rrPlain = run(['run', rcbp], env);
    check('C29b plain 模式同样保留退出码', rrPlain.code === 3, rrPlain.code);
  } else {
    console.log('SKIP C28/C29（PATH 中无 gcc）');
  }
}

// ---------- 运行时语言：CB_UI_LANGUAGE 决定 i18n 文案 ----------
const brokenCbp = path.join(TMP, 'broken.cbp');
fs.writeFileSync(brokenCbp, '<?xml version="1.0"?><foo></foo>');
const enParse = run(['show', brokenCbp, '--json'], { CB_UI_LANGUAGE: 'en' });
const zhParse = run(['show', brokenCbp, '--json'], { CB_UI_LANGUAGE: 'zh-cn' });
check('C14 CB_UI_LANGUAGE=en → 解析错误为英文', enParse.code === 3 && /Not a valid \.cbp file/.test(enParse.stderr), enParse.stderr.slice(0, 200));
check('C15 CB_UI_LANGUAGE=zh-cn → 解析错误为中文', zhParse.code === 3 && /不是有效的 \.cbp 文件/.test(zhParse.stderr), zhParse.stderr.slice(0, 200));

// ---------- CLI 不受扩展 Agent 开关影响（独立工具） ----------
const cliSettings = path.join(TMP, '.vscode');
fs.mkdirSync(cliSettings, { recursive: true });
fs.writeFileSync(path.join(cliSettings, 'settings.json'), JSON.stringify({
  'codeblocks.agent.enabled': false,
  'codeblocks.agent.readOnly': true,
}), 'utf-8');
const cliOps2 = path.join(TMP, 'ops2.json');
fs.writeFileSync(cliOps2, JSON.stringify([{ op: 'add', scope: 'target', target: 'Debug', field: 'compilerOptions', value: '-DCLI_UNGATED=1' }]));
const cliEdit = run(['edit', cbp, '--ops-file', cliOps2, '--json']);
check('C16 CLI 不受 agent.enabled / readOnly 影响（仍可写盘）',
  cliEdit.code === 0 && JSON.parse(cliEdit.stdout).written === true, cliEdit.stdout.slice(0, 120) || cliEdit.stderr.slice(0, 160));

// ---------- 打包后的 bundle 也能正确解析资源目录 ----------
const bundleCli = path.join(ROOT, 'bundle', 'cb-cli.js');
if (fs.existsSync(bundleCli)) {
  const rb = spawnSync(process.execPath, [bundleCli, 'compiler', 'list', '--json'], { encoding: 'utf-8', timeout: 120000 });
  let bj;
  try { bj = JSON.parse(rb.stdout || ''); } catch { bj = undefined; }
  check('C12 bundle CLI 可用', rb.status === 0 && !!bj, (rb.stderr || '').slice(0, 200));
  check('C13 bundle CLI 资源目录正确', !!bj && /resources[\\/]compilers$/.test(bj.resourcesDir || '') && fs.existsSync(bj.resourcesDir), bj && bj.resourcesDir);
} else {
  console.log('SKIP C12/C13 bundle CLI（bundle/cb-cli.js 未构建）');
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ncb-cli: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
