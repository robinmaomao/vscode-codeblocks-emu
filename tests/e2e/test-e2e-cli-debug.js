// L1 E2E：cb-cli 无头调试（真实 gdb）——`debug run` = 启动 + 断点 + 栈/变量（R5-13 回归）
// 说明：CLI 每次调用是独立进程（未实现跨进程会话），因此只验证单进程内可完成的动作组合；
// `continue`/`step` 的等待语义由单元测试与文档保证。
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
  else { fail++; console.log(`FAIL ${name}${got === undefined ? '' : '  got=' + JSON.stringify(got)}`); }
}
function skipCheck(name, reason) {
  skip++;
  console.log(`SKIP ${name}  ${reason}`);
}

if (!H.toolAvailable('gcc') || !H.toolAvailable('gdb')) {
  skipCheck('cli-debug-e2e', 'gcc/gdb not available');
  console.log(`\ncb-cli debug e2e: ${pass} pass, ${fail} fail, ${skip} skip`);
  process.exit(0);
}

const isolatedAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cli-debug-appdata-'));
const env = { ...process.env, APPDATA: isolatedAppData, CB_UI_LANGUAGE: 'en' };

function runCli(args, timeout = 10 * 60 * 1000) {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf-8', env, timeout });
  return {
    code: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    json: (() => { try { return JSON.parse(r.stdout || ''); } catch { return undefined; } })(),
  };
}

const dir = H.copyTestProject(['hello-cb.cbp', 'main.c', 'util.c', 'util.h'], 'cli-debug');
const cbp = path.join(dir, 'hello-cb.cbp');
const mainC = path.join(dir, 'main.c');

try {
  // 1) Debug 目标补 -g（工程模板不带调试符号），再构建
  const opsFile = path.join(dir, 'ops-debug.json');
  fs.writeFileSync(opsFile, JSON.stringify([{ op: 'add', scope: 'target', target: 'Debug', field: 'compilerOptions', value: '-g' }]), 'utf-8');
  const edit = runCli(['edit', cbp, '--ops-file', opsFile, '--json']);
  // 工程模板可能已带 -g（`<Add option="-g" />` 会进 compilerOptions）：已有则无变更，同为成功
  check('G0 Debug 目标 -g 就绪（已有则 written=false）',
    edit.code === 0 && !!edit.json && (edit.json.written === true || (Array.isArray(edit.json.changed) && edit.json.changed.length === 0)),
    edit.json || edit.stderr.slice(-300));

  const build = runCli(['build', cbp, '--target', 'Debug', '--json']);
  check('G1 构建成功', build.code === 0 && !!build.json && build.json.ok === true, { code: build.code, stderr: build.stderr.slice(-400) });

  // 2) 断点行 = main.c 里第一处 `int result`（GBK 源文件按 latin1 读，只为定位 ASCII）
  const srcLines = fs.readFileSync(mainC, 'latin1').split(/\r?\n/);
  const bpLine = srcLines.findIndex((l) => l.includes('int result')) + 1;
  check('G2 找到断点行', bpLine > 0, bpLine);

  // 3) `debug run`：单进程内完成 start + 断点 + 栈 + 变量（R5-13：不能再先 setBreakpoints 而报 not-running）
  const run = runCli(['debug', 'run', cbp, '--target', 'Debug', '--file', mainC, '--lines', String(bpLine), '--json']);
  check('G3 debug run 退出码 0', run.code === 0, { code: run.code, stderr: run.stderr.slice(-400) });
  check('G4 start.ok 且命中断点', !!run.json && run.json.start && run.json.start.ok === true && run.json.start.stopped === true,
    run.json && run.json.start);
  const frame = run.json && run.json.stack && run.json.stack.frames && run.json.stack.frames[0];
  check('G5 栈顶落在 main.c 的断点行',
    !!frame && /main\.c$/i.test(String(frame.file || '').replace(/\\/g, '/')) && frame.line === bpLine, frame);
  const vars = run.json && run.json.variables && run.json.variables.scopes && run.json.variables.scopes[0];
  check('G6 变量可读（Locals 作用域非空）', !!vars && Array.isArray(vars.variables) && vars.variables.length > 0,
    run.json && run.json.variables);

  // 4) 无会话的断点设置：CLI 单进程模型下必须明确报 not-running（而不是静默成功）
  const bp = runCli(['debug', 'breakpoints', cbp, '--file', mainC, '--lines', '3', '--json']);
  check('G7 无会话 breakpoints → not-running（exit 4）', bp.code === 4 && /not-running/.test(bp.stderr),
    { code: bp.code, stderr: bp.stderr.slice(-200) });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(isolatedAppData, { recursive: true, force: true });
}

console.log(`\ncb-cli debug e2e: ${pass} pass, ${fail} fail, ${skip} skip`);
process.exit(fail ? 1 : 0);
