// resolveRunPlan 的 cwd 语义回归：相对路径必须按「工程目录」解析。
// 之前用 path.resolve(req.cwd) 按进程 cwd 解析：宿主进程 cwd 可能是 System32，
// 且 CLI / MCP / 宿主三端行为不一致（同一个 'build' 指向不同目录）。
const fs = require('fs');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-run-plan');
const SRC = path.join(ROOT, 'test-project');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const mock = installVscodeMock({});
const { resolveRunPlan } = require(path.join(ROOT, 'dist', 'api', 'runService.js'));

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, 'bin', 'Debug'), { recursive: true });
for (const entry of fs.readdirSync(SRC)) {
  const from = path.join(SRC, entry);
  if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(TMP, entry));
}
const cbp = path.join(TMP, 'hello-cb.cbp');
const exe = path.join(TMP, 'bin', 'Debug', process.platform === 'win32' ? 'hello.exe' : 'hello');
fs.writeFileSync(exe, '');

const deps = { compiler: { getCompiler: () => ({ masterPath: '' }), resolveTargetCompiler: () => undefined } };
const base = { cbp, target: 'Debug' };

const rel = resolveRunPlan({ ...base, cwd: 'build' }, deps);
check('P1 相对 cwd 按工程目录解析', rel.cwd === path.join(TMP, 'build'), rel.cwd);

const abs = resolveRunPlan({ ...base, cwd: path.join(TMP, 'somewhere') }, deps);
check('P2 绝对 cwd 保持不变', abs.cwd === path.join(TMP, 'somewhere'), abs.cwd);

const def = resolveRunPlan(base, deps);
check('P3 缺省 cwd = 目标输出目录（Code::Blocks 语义）', def.cwd === path.join(TMP, 'bin', 'Debug'), def.cwd);

check('P4 可执行文件解析正确', path.normalize(def.executable) === path.normalize(exe), def.executable);

fs.rmSync(TMP, { recursive: true, force: true });
mock.restore();
console.log(`\nrun plan: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
