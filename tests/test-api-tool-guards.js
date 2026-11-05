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

  fs.rmSync(TMP, { recursive: true, force: true });
  mock.restore();
  console.log(`\ntoolRegistry 守卫回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
