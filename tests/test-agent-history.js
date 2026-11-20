// Agent 变更历史：写目标解析、快照/撤销、冲突、保留策略与审计脱敏（纯 Node）。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-agent-history');
const SRC = path.join(ROOT, 'test-project');

const { installVscodeMock } = require('./_harness/vscodeMock');
const mock = installVscodeMock({});
const storeApi = require('../dist/api/projectStore');
const { invokeTool } = require('../dist/api/toolRegistry');
const { resolveWriteTargets } = require('../dist/api/agentHistory');
const { AgentHistoryStore } = require('../dist/agent/historyStore');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

function freshCopy(tag) {
  const dir = path.join(TMP, tag);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(SRC)) {
    const from = path.join(SRC, entry);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, entry));
  }
  return { dir, cbp: path.join(dir, 'hello-cb.cbp') };
}

const noop = () => undefined;
const output = {
  info: noop, warn: noop, error: noop, debug: noop, trace: noop,
  append: noop, appendLine: noop, clear: noop, show: noop, hide: noop, dispose: noop,
};

function makeStore(dir, opts = {}) {
  return new AgentHistoryStore({
    rootDir: path.join(dir, '.agent-history'),
    workspaceRoots: [dir],
    maxEntries: opts.maxEntries ?? 50,
    retentionDays: opts.retentionDays ?? 14,
    now: opts.now,
    onError: opts.onError,
  });
}

function makeContext(history, overrides = {}) {
  return {
    settings: { get: (_k, d) => d },
    compiler: { resourcesDir: path.join(ROOT, 'resources', 'compilers'), getCompiler: () => { throw new Error('no compiler'); }, resolveTargetCompiler: () => { throw new Error('no compiler'); } },
    output,
    loadProject: async (cbp) => storeApi.loadProject(cbp),
    saveProject: async (project, opts) => storeApi.saveProject(project, { force: opts.force }),
    history,
    ...overrides,
  };
}

function sha(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

(async () => {
  // ---------- W1 写目标解析 ----------
  {
    const { dir, cbp } = freshCopy('targets');
    const ctx = { listOpenProjects: () => [{ filename: cbp, active: true }] };
    check('W1 project_edit 命中 .cbp', resolveWriteTargets(ctx, 'codeblocks_project_edit', {}).some((t) => t.file === cbp && t.kind === 'cbp'));
    check('W2 dryRun 不快照', resolveWriteTargets(ctx, 'codeblocks_project_edit', { dryRun: true }).length === 0);
    check('W3 project_read 不快照', resolveWriteTargets(ctx, 'codeblocks_project_read', {}).length === 0);
    const ws = path.join(dir, 'dep-test.workspace');
    check('W4 workspace deps 命中 .workspace', resolveWriteTargets(ctx, 'codeblocks_workspace', { action: 'deps', workspace: ws }).some((t) => t.kind === 'workspace'));
    check('W5 workspace info 不快照', resolveWriteTargets(ctx, 'codeblocks_workspace', { action: 'info', workspace: ws }).length === 0);
    check('W6 不存在的 .cbp 不快照', resolveWriteTargets(ctx, 'codeblocks_project_edit', { cbp: path.join(dir, 'nope.cbp') }).length === 0);
  }

  // ---------- W7 workspace deps 实际写入 → 撤销 ----------
  {
    const dir = path.join(TMP, 'workspace');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const ws = path.join(dir, 'dep-test.workspace');
    fs.copyFileSync(path.join(SRC, 'dep-test.workspace'), ws);
    const before = fs.readFileSync(ws);
    const store = makeStore(dir);
    const ctx = makeContext(store);
    const result = await invokeTool(ctx, 'codeblocks_workspace', {
      action: 'deps',
      workspace: ws,
      project: 'dep-app/dep-app.cbp',
      dependencies: [],
    });
    check('W7 workspace deps 写入成功', result.ok === true && result.dependencies.length === 0, result);
    const entries = store.list();
    check('W8 workspace deps 生成历史', entries.length === 1 && entries[0].file === ws && entries[0].relativeFile === 'dep-test.workspace', entries);
    await store.undo(entries[0].id);
    check('W9 workspace deps 字节级撤销', fs.readFileSync(ws).equals(before));
  }

  // ---------- H1 实际工具编辑 → 快照 → 撤销 ----------
  {
    const { dir, cbp } = freshCopy('roundtrip');
    const before = fs.readFileSync(cbp);
    const store = makeStore(dir);
    const ctx = makeContext(store);
    const result = await invokeTool(ctx, 'codeblocks_project_edit', {
      cbp,
      ops: [{ op: 'set', scope: 'project', field: 'title', value: 'history-roundtrip' }],
    });
    check('H1 编辑成功', result.ok === true && result.written === true, result);
    const entries = store.list();
    check('H2 生成一条历史', entries.length === 1 && entries[0].file === cbp && entries[0].status === 'applied', entries);
    check('H3 快照存在且哈希正确', fs.existsSync(path.join(store.root, entries[0].snapshot)) && sha(fs.readFileSync(path.join(store.root, entries[0].snapshot))) === entries[0].beforeHash);
    check('H4 afterHash 等于当前文件', entries[0].afterHash === sha(fs.readFileSync(cbp)));
    check('H5 相对路径', entries[0].relativeFile === 'hello-cb.cbp', entries[0].relativeFile);

    const undone = await store.undo(entries[0].id);
    check('H6 撤销返回字节数', undone.restoredBytes === before.length, undone.restoredBytes);
    check('H7 文件字节完全恢复', fs.readFileSync(cbp).equals(before));
    check('H8 条目标记 undone', store.list()[0].status === 'undone' && !!store.list()[0].undoneAt);
    try {
      await store.undo(entries[0].id);
      check('H9 重复撤销被拒绝', false, 'no error');
    } catch (err) {
      check('H9 重复撤销被拒绝', err && err.code === 'already-undone', err && err.code);
    }
  }

  // ---------- H2 dryRun 不记录 ----------
  {
    const { dir, cbp } = freshCopy('dryrun');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    const result = await invokeTool(ctx, 'codeblocks_project_edit', {
      cbp,
      dryRun: true,
      ops: [{ op: 'set', scope: 'project', field: 'title', value: 'dry' }],
    });
    check('D1 dryRun 校验成功且未写盘', result.ok === true && result.written === false, result);
    check('D2 dryRun 无历史', store.list().length === 0);
  }

  // ---------- H2b 写前错误不把外部修改误记为 Agent 变更 ----------
  {
    const { dir, cbp } = freshCopy('pre-write-error');
    const store = makeStore(dir);
    const capture = await store.capture({ tool: 'codeblocks_project_edit', input: {}, targets: [{ file: cbp, kind: 'cbp' }] });
    fs.appendFileSync(cbp, '\n<!-- external during failed call -->\n');
    const changes = await store.finish(capture, { ok: false, code: 'external-modified', error: 'modified' });
    check('E1 写前错误不返回变更', changes.length === 0, changes);
    check('E2 写前错误不生成历史', store.list().length === 0);
  }

  // ---------- H3 外部修改冲突与 force ----------
  {
    const { dir, cbp } = freshCopy('conflict');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    const before = fs.readFileSync(cbp);
    await invokeTool(ctx, 'codeblocks_project_edit', {
      cbp,
      ops: [{ op: 'set', scope: 'project', field: 'title', value: 'conflict-base' }],
    });
    const entry = store.list()[0];
    fs.appendFileSync(cbp, '\n<!-- external -->\n');
    try {
      await store.undo(entry.id);
      check('C1 外部修改默认拒绝', false, 'no error');
    } catch (err) {
      check('C1 外部修改默认拒绝', err && err.code === 'conflict', err && err.code);
    }
    const result = await store.undo(entry.id, { force: true });
    check('C2 force 覆盖并恢复', result.restoredBytes === before.length && fs.readFileSync(cbp).equals(before));
  }

  // ---------- H4 latest-per-file ----------
  {
    const { dir, cbp } = freshCopy('superseded');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'first' }] });
    const first = store.list()[0];
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'second' }] });
    const second = store.list()[0];
    try {
      await store.undo(first.id);
      check('L1 旧条目被拒绝', false, 'no error');
    } catch (err) {
      check('L1 旧条目被拒绝', err && err.code === 'superseded' && err.details.latestId === second.id, err && err.details);
    }
    await store.undo(second.id);
    const afterLatest = await store.undo(first.id);
    check('L2 撤销最新后可撤销上一条', afterLatest.entry.id === first.id && store.list().find((e) => e.id === first.id).status === 'undone');
  }

  // ---------- H5 保留条数 / 快照清理 ----------
  {
    const { dir, cbp } = freshCopy('prune');
    const store = makeStore(dir, { maxEntries: 2 });
    const ctx = makeContext(store);
    const firstIds = [];
    for (const title of ['one', 'two', 'three']) {
      await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: title }] });
      firstIds.push(store.list()[0].id);
    }
    const entries = store.list();
    check('P1 只保留 maxEntries 条', entries.length === 2, entries.length);
    check('P2 最旧条目被删除', !entries.some((e) => e.id === firstIds[0]), entries.map((e) => e.id));
    const snapshotFiles = fs.readdirSync(path.join(store.root, 'snapshots'));
    check('P3 快照数量与条目一致', snapshotFiles.length === entries.length, snapshotFiles.length);
  }

  // ---------- H6 快照损坏 / 文件缺失 ----------
  {
    const { dir, cbp } = freshCopy('corrupt');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'corrupt' }] });
    const entry = store.list()[0];
    fs.writeFileSync(path.join(store.root, entry.snapshot), 'not the original');
    try {
      await store.undo(entry.id);
      check('S1 损坏快照被拒绝', false, 'no error');
    } catch (err) {
      check('S1 损坏快照被拒绝', err && err.code === 'corrupt', err && err.code);
    }
    check('S2 条目标记 corrupt', store.list()[0].status === 'corrupt');
  }
  {
    const { dir, cbp } = freshCopy('missing');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'missing' }] });
    const entry = store.list()[0];
    fs.rmSync(cbp);
    try {
      await store.undo(entry.id);
      check('S3 文件缺失默认拒绝', false, 'no error');
    } catch (err) {
      check('S3 文件缺失默认拒绝', err && err.code === 'missing', err && err.code);
    }
    const result = await store.undo(entry.id, { force: true });
    check('S4 force 重建文件', fs.existsSync(cbp) && result.restoredBytes > 0);
  }

  // ---------- H7 审计脱敏 ----------
  {
    const { dir, cbp } = freshCopy('audit');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    await invokeTool(ctx, 'codeblocks_project_edit', {
      cbp,
      ops: [{ op: 'set', scope: 'project', field: 'commandsBeforeBuild', value: ['echo SECRET_SHOULD_NOT_BE_LOGGED'] }],
      allowScripts: true,
    });
    await invokeTool(ctx, 'codeblocks_project_read', { cbp, section: 'summary' });
    const auditPath = path.join(store.root, 'audit.jsonl');
    const lines = fs.readFileSync(auditPath, 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
    check('A1 审计记录所有调用', lines.length === 2 && lines.some((l) => l.tool === 'codeblocks_project_edit') && lines.some((l) => l.tool === 'codeblocks_project_read'), lines.length);
    check('A2 审计不记录脚本内容', !fs.readFileSync(auditPath, 'utf8').includes('SECRET_SHOULD_NOT_BE_LOGGED'));
    const editLine = lines.find((l) => l.tool === 'codeblocks_project_edit');
    check('A3 审计只保留白名单与 ops 数量', editLine.args.ops === 1 && editLine.args.allowScripts === true && editLine.args.cbp === undefined, editLine.args);
    check('A4 审计 changedFiles 用相对路径', Array.isArray(editLine.changedFiles) && editLine.changedFiles[0] === 'hello-cb.cbp', editLine.changedFiles);
  }

  // ---------- H8 失败调用审计、不产生历史 ----------
  {
    const { dir, cbp } = freshCopy('failure');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    try {
      await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'nope', value: 1 }] });
      check('F1 非法编辑抛错', false, 'no error');
    } catch (err) {
      check('F1 非法编辑抛错', err && err.code === 'invalid-input', err && err.code);
    }
    check('F2 失败调用无历史', store.list().length === 0);
    const lines = fs.readFileSync(path.join(store.root, 'audit.jsonl'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
    check('F3 失败调用进入审计', lines.length === 1 && lines[0].ok === false && lines[0].code === 'invalid-input', lines);
  }

  // ---------- H9 禁用后不采集 ----------
  {
    const { dir, cbp } = freshCopy('disabled');
    const store = makeStore(dir);
    store.setEnabled(false);
    const ctx = makeContext(store);
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'disabled' }] });
    check('X1 禁用后无历史', store.list().length === 0);
    check('X2 禁用后无审计', !fs.existsSync(path.join(store.root, 'audit.jsonl')));
  }

  // ---------- H9b 只读拒绝仍进入审计、不产生历史 ----------
  {
    const { dir, cbp } = freshCopy('readonly');
    const store = makeStore(dir);
    const ctx = makeContext(store, { readOnly: true });
    try {
      await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'blocked' }] });
      check('X3 只读拒绝', false, 'no error');
    } catch (err) {
      check('X3 只读拒绝', err && err.code === 'read-only', err && err.code);
    }
    check('X4 只读拒绝无历史', store.list().length === 0);
    const lines = fs.readFileSync(path.join(store.root, 'audit.jsonl'), 'utf8').trim().split(/\r?\n/).map((l) => JSON.parse(l));
    check('X5 只读拒绝进入审计', lines.length === 1 && lines[0].ok === false && lines[0].code === 'read-only', lines);
  }

  // ---------- H9c 保留期 ----------
  {
    const { dir, cbp } = freshCopy('retention');
    let clock = new Date('2026-01-01T00:00:00.000Z');
    const store = makeStore(dir, { retentionDays: 1, now: () => clock });
    const ctx = makeContext(store);
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'expires' }] });
    check('R1 初始有一条历史', store.list().length === 1);
    clock = new Date('2026-01-03T00:00:00.000Z');
    await store.prune();
    check('R2 超过保留期后清理', store.list().length === 0);
  }

  // ---------- H9d 索引被篡改为任意文件时拒绝 ----------
  {
    const { dir, cbp } = freshCopy('tamper');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'tamper' }] });
    const indexPath = path.join(store.root, 'index.json');
    const entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    const evil = path.join(dir, 'evil.txt');
    fs.writeFileSync(evil, 'do not touch');
    entries[0].file = evil;
    fs.writeFileSync(indexPath, JSON.stringify(entries));
    try {
      await store.undo(entries[0].id);
      check('T1 非工程文件目标被拒绝', false, 'no error');
    } catch (err) {
      check('T1 非工程文件目标被拒绝', err && err.code === 'corrupt', err && err.code);
    }
    check('T2 目标文件未被改写', fs.readFileSync(evil, 'utf8') === 'do not touch');
  }

  // ---------- H10 索引损坏可恢复 ----------
  {
    const { dir, cbp } = freshCopy('index-corrupt');
    const store = makeStore(dir);
    const ctx = makeContext(store);
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'before-corrupt' }] });
    fs.writeFileSync(path.join(store.root, 'index.json'), '{not json');
    check('I1 损坏索引返回空历史', store.list().length === 0);
    await invokeTool(ctx, 'codeblocks_project_edit', { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'after-corrupt' }] });
    check('I2 损坏后可继续记录', store.list().length === 1);
  }

  console.log(`Agent 变更历史: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
