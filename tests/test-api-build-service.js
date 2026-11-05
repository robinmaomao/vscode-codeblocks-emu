// 构建服务回归（无宿主）：
//  - timeoutMs 真正取消构建（build 前脚本睡眠 → 到时取消，不等待脚本自然结束）
//  - clean 模式可用（不依赖编译器产物）
//  - 目标选择：显式目标优先、非法目标报 invalid-input、缺省取当前平台首个目标
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-build-service');
const SRC = path.join(ROOT, 'test-project');

// 隔离 Code::Blocks 用户配置，避免本机 default.conf 改写编译器程序路径
const isolatedAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-buildsvc-'));
process.env.APPDATA = isolatedAppData;

const mock = installVscodeMock({});
const { loadCodeblocksSettings } = require(path.join(ROOT, 'dist', 'api', 'settingsReader.js'));
const { createCompilerProvider } = require(path.join(ROOT, 'dist', 'api', 'compilerService.js'));
const { buildProject, selectBuildTarget } = require(path.join(ROOT, 'dist', 'api', 'buildService.js'));
const { applyEdits } = require(path.join(ROOT, 'dist', 'api', 'projectEdit.js'));
const store = require(path.join(ROOT, 'dist', 'api', 'projectStore.js'));

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const noop = () => undefined;
const output = {
  info: noop, warn: noop, error: noop, debug: noop, trace: noop,
  append: noop, appendLine: noop, clear: noop, show: noop, hide: noop, dispose: noop,
};

function freshCopy(tag) {
  const dir = path.join(TMP, tag);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(SRC)) {
    const from = path.join(SRC, entry);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, entry));
  }
  return path.join(dir, 'hello-cb.cbp');
}

function expectCode(label, code, fn) {
  try {
    fn();
    check(label, false, '(no error)');
  } catch (err) {
    check(label, err && err.code === code, err && { code: err.code, message: err.message });
  }
}

(async () => {
  const settings = loadCodeblocksSettings();
  const compiler = createCompilerProvider({
    resourcesDir: path.join(ROOT, 'resources', 'compilers'),
    settings,
    defaultConfPath: path.join(TMP, 'no-such-default.conf'),
  });

  // ---------- B1–B4 超时取消 ----------
  {
    const cbp = freshCopy('timeout');
    const project = store.loadProject(cbp);
    // 构建前脚本睡 20s：超时取消必须强杀进程树并立即返回
    applyEdits(project, [{
      op: 'set',
      scope: 'project',
      field: 'commandsBeforeBuild',
      value: ['node -e "setTimeout(()=>{},20000)"'],
    }], { allowScripts: true });
    store.saveProject(project, { force: true });

    const t0 = Date.now();
    const outcome = await buildProject(
      { cbp, target: 'Debug', timeoutMs: 1500 },
      { compiler, settings, output },
    );
    const elapsed = Date.now() - t0;

    check('B1 超时被标记', outcome.timedOut === true, outcome.timedOut);
    check('B2 构建结果非成功', outcome.ok === false, outcome.ok);
    check('B3 摘要标记 cancelled', !!outcome.summary.projects[0] && outcome.summary.projects[0].cancelled === true,
      outcome.summary.projects[0] && outcome.summary.projects[0].cancelled);
    check('B4 及时返回（不等脚本自然结束，< 15s）', elapsed < 15000, elapsed);
  }

  // ---------- B5 clean 模式 ----------
  {
    const cbp = freshCopy('clean');
    const outcome = await buildProject({ cbp, target: 'Debug', mode: 'clean' }, { compiler, settings, output });
    check('B5 clean 模式成功', outcome.ok === true && outcome.timedOut === false, { ok: outcome.ok, timedOut: outcome.timedOut });
    check('B6 clean 摘要目标正确', outcome.target === 'Debug' && outcome.summary.projects[0].projectTitle === 'hello-cb', outcome.summary.projects[0].projectTitle);
  }

  // ---------- B7–B9 目标选择 ----------
  {
    const cbp = freshCopy('target');
    const project = store.loadProject(cbp);
    check('B7 显式目标优先', selectBuildTarget(project, 'Debug') === 'Debug');
    expectCode('B8 非法目标 → invalid-input', 'invalid-input', () => selectBuildTarget(project, 'NoSuchTarget'));
    const fallback = selectBuildTarget(project);
    check('B9 缺省取当前平台可用目标', project.buildTargets.some((t) => t.title === fallback), fallback);
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(isolatedAppData, { recursive: true, force: true });
  mock.restore();
  console.log(`\n构建服务回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
