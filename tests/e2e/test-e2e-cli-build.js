// L1 E2E：cb-cli 在真实工具链上构建/增量/运行/导出
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./harness');

const ROOT = path.resolve(__dirname, '..', '..');
const CLI = path.join(ROOT, 'dist', 'cli', 'cb-cli.js');

let pass = 0, fail = 0, skip = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}`); }
}
function skipCheck(name, reason) {
  skip++;
  console.log(`SKIP ${name}  ${reason}`);
}

const HAS_GCC = H.toolAvailable('gcc');
if (!HAS_GCC) {
  skipCheck('cli-e2e', 'gcc not available');
  console.log(`\ncb-cli e2e: ${pass} pass, ${fail} fail, ${skip} skip`);
  process.exit(0);
}

// 隔离 Code::Blocks 的 default.conf（用户自定义编译器会影响程序路径，属真实行为但不可复现）
const isolatedAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cli-appdata-'));
const env = { ...process.env, APPDATA: isolatedAppData, CB_UI_LANGUAGE: 'en' };

function runCli(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8', env, timeout: 10 * 60 * 1000 });
  return { code: r.status, stdout: r.stdout || '', stderr: r.stderr || '', json: (() => { try { return JSON.parse(r.stdout || ''); } catch { return undefined; } })() };
}

const dir = H.copyTestProject(['hello-cb.cbp', 'main.c', 'util.c', 'util.h'], 'cli-e2e');
const cbp = path.join(dir, 'hello-cb.cbp');
const exe = path.join(dir, 'bin', 'Debug', 'hello.exe');

try {
  const b1 = runCli(['build', cbp, '--target', 'Debug', '--json']);
  check('E1 首次构建成功', b1.code === 0 && b1.json && b1.json.ok === true, { code: b1.code, stderr: b1.stderr.slice(-400) });
  check('E2 产物存在', fs.existsSync(exe), exe);
  check('E3 结构化摘要含诊断字段', !!b1.json && Array.isArray(b1.json.summary.projects) && Array.isArray(b1.json.summary.projects[0].diagnostics));

  const b2 = runCli(['build', cbp, '--target', 'Debug', '--json']);
  check('E4 二次构建增量跳过', b2.code === 0 && b2.json && b2.json.summary.projects[0].compiledCount === 0 && b2.json.summary.projects[0].skippedCount > 0, b2.json && b2.json.summary.projects[0]);

  const r1 = runCli(['run', cbp, '--target', 'Debug', '--json']);
  check('E5 运行成功', r1.code === 0 && r1.json && r1.json.exitCode === 0 && /hello-cb/.test(r1.json.stdout || ''), r1.json || r1.stderr.slice(-300));

  const mk = path.join(dir, 'Makefile.cli');
  const e1 = runCli(['export', cbp, '--kind', 'makefile', '--out', mk, '--json']);
  check('E6 导出 Makefile', e1.code === 0 && fs.existsSync(mk) && fs.readFileSync(mk, 'utf-8').includes('SHELL := cmd.exe'), e1.json || e1.stderr.slice(-200));

  const cc = runCli(['export', cbp, '--kind', 'commands', '--json']);
  check('E7 导出编译命令', cc.code === 0 && cc.json && cc.json.count > 0 && /main\.c/.test(cc.json.text || ''), cc.json || cc.stderr.slice(-200));
} finally {
  fs.rmSync(isolatedAppData, { recursive: true, force: true });
}

console.log(`\ncb-cli e2e: ${pass} pass, ${fail} fail, ${skip} skip`);
process.exit(fail ? 1 : 0);
