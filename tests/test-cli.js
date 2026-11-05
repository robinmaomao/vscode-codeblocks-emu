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

// ---------- 运行时语言：CB_UI_LANGUAGE 决定 i18n 文案 ----------
const brokenCbp = path.join(TMP, 'broken.cbp');
fs.writeFileSync(brokenCbp, '<?xml version="1.0"?><foo></foo>');
const enParse = run(['show', brokenCbp, '--json'], { CB_UI_LANGUAGE: 'en' });
const zhParse = run(['show', brokenCbp, '--json'], { CB_UI_LANGUAGE: 'zh-cn' });
check('C14 CB_UI_LANGUAGE=en → 解析错误为英文', enParse.code === 3 && /Not a valid \.cbp file/.test(enParse.stderr), enParse.stderr.slice(0, 200));
check('C15 CB_UI_LANGUAGE=zh-cn → 解析错误为中文', zhParse.code === 3 && /不是有效的 \.cbp 文件/.test(zhParse.stderr), zhParse.stderr.slice(0, 200));

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
