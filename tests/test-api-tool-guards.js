// 写盘守卫回归（toolRegistry 共用 handler）：
//  - 读盘期间文件被外部改动 → external-modified（不落盘），force 可覆盖
//  - preserve 走 isExternallyModified 判定
//  - 结构编辑（project_file）同样受签名守卫保护
//  - 构建互斥 → build-busy
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-guards');
const SRC = path.join(ROOT, 'test-project');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const { installVscodeMock } = require('./_harness/vscodeMock');
// toolRegistry 会拉起构建链路（buildEngine 顶层 import vscode），先装宿主替身
const mock = installVscodeMock({});

const store = require(path.join(ROOT, 'dist', 'api', 'projectStore.js'));
const registry = require(path.join(ROOT, 'dist', 'api', 'toolRegistry.js'));

/** 复制 test-project 的 .cbp 与源文件，返回临时 .cbp 路径 */
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

const noop = () => undefined;
const output = {
  info: noop, warn: noop, error: noop, debug: noop, trace: noop,
  append: noop, appendLine: noop, clear: noop, show: noop, hide: noop, dispose: noop,
};

/** 构造最小 ToolContext（编辑/构建不需要真编译器） */
function makeContext(overrides = {}) {
  return {
    settings: { get: (_k, d) => d },
    compiler: { resourcesDir: path.join(ROOT, 'resources', 'compilers'), getCompiler: () => { throw new Error('no compiler'); }, resolveTargetCompiler: () => { throw new Error('no compiler'); } },
    output,
    loadProject: async (cbp) => store.loadProject(cbp),
    saveProject: async (project, opts) => store.saveProject(project, { force: opts.force }),
    build: async () => { throw new Error('build must not run in guard tests'); },
    ...overrides,
  };
}

/** 期望调用抛出指定 code 的 ControlError */
async function expectCode(label, code, fn) {
  try {
    await fn();
    check(label, false, '(no error)');
    return undefined;
  } catch (err) {
    check(label, err && err.code === code, err && { code: err.code, message: err.message });
    return err;
  }
}

(async () => {
  // ---------- G1 读盘期间被外部改动 → 拒绝写盘 ----------
  {
    const cbp = freshCopy('g1');
    const before = fs.readFileSync(cbp, 'utf-8');
    const ctx = makeContext({
      // 模拟「签名捕获之后、写盘之前」被外部保存：读到模型后再改盘
      loadProject: async (file) => {
        const project = store.loadProject(file);
        fs.appendFileSync(file, '\n<!-- external -->\n');
        return project;
      },
    });
    await expectCode('G1 并发外部修改 → external-modified', 'external-modified', () => registry.invokeTool(
      ctx,
      'codeblocks_project_edit',
      { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'guarded' }] },
    ));
    const after = fs.readFileSync(cbp, 'utf-8');
    check('G1b 未落盘（仅保留外部内容）', after === before + '\n<!-- external -->\n' && !after.includes('guarded'), after.slice(-60));
  }

  // ---------- G2 force 覆盖 ----------
  {
    const cbp = freshCopy('g2');
    const ctx = makeContext({
      loadProject: async (file) => {
        const project = store.loadProject(file);
        fs.appendFileSync(file, '\n<!-- external -->\n');
        return project;
      },
    });
    const r = await registry.invokeTool(ctx, 'codeblocks_project_edit', {
      cbp,
      force: true,
      ops: [{ op: 'set', scope: 'project', field: 'title', value: 'forced' }],
    });
    check('G2 force 覆盖成功', r.ok === true && r.written === true && store.loadProject(cbp).title === 'forced', r);
  }

  // ---------- G3 preserve 走 isExternallyModified ----------
  {
    const cbp = freshCopy('g3');
    const before = fs.readFileSync(cbp, 'utf-8');
    const ctx = makeContext({ isExternallyModified: () => true });
    await expectCode('G3 preserve 外部修改 → external-modified', 'external-modified', () => registry.invokeTool(
      ctx,
      'codeblocks_project_edit',
      { cbp, format: 'preserve', ops: [{ op: 'set', scope: 'file', file: 'main.c', field: 'compile', value: false }] },
    ));
    check('G3b preserve 未落盘', fs.readFileSync(cbp, 'utf-8') === before);
  }

  // ---------- G4 结构编辑同样受签名守卫保护 ----------
  {
    const cbp = freshCopy('g4');
    const ctx = makeContext({
      loadProject: async (file) => {
        const project = store.loadProject(file);
        fs.appendFileSync(file, '\n<!-- external -->\n');
        return project;
      },
    });
    await expectCode('G4 project_file 并发外部修改 → external-modified', 'external-modified', () => registry.invokeTool(
      ctx,
      'codeblocks_project_file',
      { cbp, action: 'rename', file: 'main.c', to: 'main2.c' },
    ));
    check('G4b 未改名', store.loadProject(cbp).files.some((f) => f.relativeFilename === 'main.c'));
  }

  // ---------- G5 保存阶段抛出的 external-modified 会透传 ----------
  {
    const cbp = freshCopy('g5');
    const ctx = makeContext({
      saveProject: async () => {
        const err = new Error('The project file was modified outside the editor');
        err.code = 'external-modified';
        throw err;
      },
    });
    await expectCode('G5 saveProject 拒绝 → external-modified', 'external-modified', () => registry.invokeTool(
      ctx,
      'codeblocks_project_edit',
      { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'nope' }] },
    ));
  }

  // ---------- G6 构建互斥 ----------
  {
    const cbp = freshCopy('g6');
    const ctx = makeContext({ isBuildInProgress: () => true });
    await expectCode('G6 构建中 → build-busy', 'build-busy', () => registry.invokeTool(ctx, 'codeblocks_build', { cbp }));
  }

  // ---------- G7 codeblocks_run 默认超时（避免死循环程序永久占住工具调用） ----------
  {
    const runService = require(path.join(ROOT, 'dist', 'api', 'runService.js'));
    const original = runService.runProject;
    const seen = [];
    runService.runProject = async (req) => {
      seen.push(req.timeoutMs);
      return { ok: true, executable: 'x', args: '', cwd: '.', exitCode: 0, timedOut: false, stdout: '', stderr: '' };
    };
    try {
      const cbp = freshCopy('g7');
      const ctx = makeContext();
      await registry.invokeTool(ctx, 'codeblocks_run', { cbp });
      await registry.invokeTool(ctx, 'codeblocks_run', { cbp, timeoutMs: 0 });
      await registry.invokeTool(ctx, 'codeblocks_run', { cbp, timeoutMs: 5000 });
    } finally {
      runService.runProject = original;
    }
    check('G7 run 缺省超时 = 120000', seen[0] === 120000, seen);
    check('G7b run 显式 0 = 不限时', seen[1] === 0, seen);
    check('G7c run 显式值透传', seen[2] === 5000, seen);
  }

  // ---------- G8 project_read 未知 target → invalid-input（不能 ok:true + error 字段） ----------
  {
    const cbp = freshCopy('g8');
    const ctx = makeContext();
    const err = await expectCode('G8 project_read 未知 target → invalid-input', 'invalid-input', () => registry.invokeTool(
      ctx,
      'codeblocks_project_read',
      { cbp, section: 'targets', target: 'NoSuchTarget' },
    ));
    check('G8b 错误详情含可选目标', !!err && Array.isArray(err.details?.targets) && err.details.targets.includes('Debug'), err && err.details);
  }

  // ---------- G9 workspace deps：绝对路径规范化 / 类型错误不静默清空 ----------
  {
    const ctx = makeContext();
    const wsDir = path.join(TMP, 'g9ws');
    fs.rmSync(wsDir, { recursive: true, force: true });
    fs.mkdirSync(wsDir, { recursive: true });
    const wsPath = path.join(wsDir, 'dep-test.workspace');
    fs.copyFileSync(path.join(SRC, 'dep-test.workspace'), wsPath);
    const projectPath = path.join(wsDir, 'dep-app', 'dep-app.cbp');
    await expectCode('G9 dependencies 非数组 → invalid-input', 'invalid-input', () => registry.invokeTool(
      ctx,
      'codeblocks_workspace',
      { action: 'deps', workspace: wsPath, project: projectPath, dependencies: 'Debug' },
    ));
    const ok = await registry.invokeTool(ctx, 'codeblocks_workspace', {
      action: 'deps',
      workspace: wsPath,
      project: projectPath,
      dependencies: [path.join(wsDir, 'dep-lib', 'dep-lib.cbp')],
    });
    check('G9b 绝对路径 → 返回 workspace 相对路径',
      ok.ok === true && ok.project === 'dep-app/dep-app.cbp' && ok.dependencies[0] === 'dep-lib/dep-lib.cbp', ok);
    const wsText = fs.readFileSync(wsPath, 'utf8');
    check('G9c 落盘写成相对路径（不含绝对路径）',
      wsText.includes('<Depends filename="dep-lib/dep-lib.cbp" />') && !wsText.includes(wsDir.replace(/\\/g, '/')), wsText.slice(0, 240));
    await expectCode('G9d 依赖不在 workspace 中 → invalid-input', 'invalid-input', () => registry.invokeTool(
      ctx,
      'codeblocks_workspace',
      { action: 'deps', workspace: wsPath, project: projectPath, dependencies: [path.join(wsDir, 'nope', 'nope.cbp')] },
    ));
  }

  // ---------- G10 export 显式 out 命中工程 Makefile → 拒绝覆盖 ----------
  {
    const cbp = freshCopy('g10');
    const ctx = makeContext();
    const edit = await registry.invokeTool(ctx, 'codeblocks_project_edit', {
      cbp,
      ops: [{ op: 'set', scope: 'project', field: 'makefile', value: 'MyMakefile' }],
    });
    check('G10 前置：makefile 字段可写', edit.ok === true, edit);
    const guardCtx = { ...ctx, compiler: { ...ctx.compiler, getCompiler: () => ({ name: 'gcc', programs: { C: 'gcc', CPP: 'g++' }, switches: {} }), resolveTargetCompiler: () => undefined } };
    await expectCode('G10b export out=Makefile → invalid-input', 'invalid-input', () => registry.invokeTool(
      guardCtx,
      'codeblocks_export',
      { cbp, kind: 'makefile', out: 'MyMakefile' },
    ));
    check('G10c 未写出被保护的文件', !fs.existsSync(path.join(path.dirname(cbp), 'MyMakefile')));
  }

  // ---------- G11 debug run：断点随 start 应用；continue/step 透传 timeoutMs ----------
  {
    const cbp = freshCopy('g11');
    const calls = [];
    const debugBridge = {
      start: async (req) => { calls.push(['start', req]); return { ok: true }; },
      stop: async () => ({ ok: true }),
      setBreakpoints: async (req) => { calls.push(['setBreakpoints', req]); return { ok: true }; },
      state: async () => ({ active: true }),
      stack: async () => ({ frames: [] }),
      variables: async () => ({ scopes: [] }),
      evaluate: async () => ({ expression: '', result: '' }),
      continue: async (req) => { calls.push(['continue', req]); return { ok: true }; },
      step: async (req) => { calls.push(['step', req]); return { ok: true }; },
    };
    const ctx = makeContext({ debug: debugBridge });
    await registry.invokeTool(ctx, 'codeblocks_debug', {
      action: 'run', cbp, file: path.join(path.dirname(cbp), 'main.c'), lines: [3], timeoutMs: 5000,
    });
    check('G11 run 不先 setBreakpoints（CLI 无会话会 not-running）',
      !calls.some(([n]) => n === 'setBreakpoints'), calls.map(([n]) => n));
    const startCall = calls.find(([n]) => n === 'start');
    check('G11b run 把 file/lines/timeoutMs 传给 start',
      !!startCall && startCall[1].file.endsWith('main.c') && startCall[1].lines[0] === 3 && startCall[1].timeoutMs === 5000, startCall);
    await registry.invokeTool(ctx, 'codeblocks_debug', { action: 'continue', timeoutMs: 1500 });
    await registry.invokeTool(ctx, 'codeblocks_debug', { action: 'step', kind: 'stepIn', timeoutMs: 2500 });
    const cont = calls.filter(([n]) => n === 'continue').pop();
    const step = calls.filter(([n]) => n === 'step').pop();
    check('G11c continue/step 透传 timeoutMs 与 kind',
      !!cont && cont[1].timeoutMs === 1500 && !!step && step[1].timeoutMs === 2500 && step[1].kind === 'stepIn', { cont, step });
  }

  // ---------- G12 部分失败不得污染宿主内存模型（编辑在副本上进行） ----------
  {
    const cbp = freshCopy('g12');
    const live = store.loadProject(cbp);
    const ctx = makeContext({ loadProject: async () => live });
    await expectCode('G12 第 2 个 op 非法 → 报错', 'invalid-input', () => registry.invokeTool(ctx, 'codeblocks_project_edit', {
      cbp,
      ops: [
        { op: 'set', scope: 'project', field: 'title', value: 'polluted' },
        { op: 'set', scope: 'project', field: 'nope', value: 1 },
      ],
    }));
    check('G12b 内存模型未被部分修改', live.title !== 'polluted', live.title);
    check('G12c 磁盘未写入', store.loadProject(cbp).title !== 'polluted', store.loadProject(cbp).title);
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  mock.restore();
  console.log(`\ntoolRegistry 守卫回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
