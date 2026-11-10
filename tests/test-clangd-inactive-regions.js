// clangd inactiveRegions 装饰生命周期修复回归：
//  - 通过 LanguageClient._features 鸭子类型定位 Feature
//  - reset：释放装饰类型并清空旧区域（停止/启动过渡）
//  - ensure：装饰类型缺失时重建，并把已缓存区域重新应用到可见编辑器
//  - watcher：Stopped/Starting 时 reset、Running 时 ensure；客户端被替换时重新 attach
const { installVscodeMock } = require('./_harness/vscodeMock');

const mock = installVscodeMock({ config: {} });

const {
  findInactiveRegionsFeature,
  resetInactiveRegionsFeature,
  ensureInactiveRegionsDecorations,
  ClangdInactiveRegionsWatcher,
} = require('../dist/tools/clangdInactiveRegions.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

/** 造一个形状与 clangd InactiveRegionsFeature 一致的替身 */
function makeFeature() {
  const calls = { disposed: 0, updates: 0, applied: [] };
  const feature = {
    decorationType: { dispose() { calls.disposed += 1; } },
    files: new Map([['a.c', []]]),
    async updateDecorationType() {
      calls.updates += 1;
      this.decorationType = { dispose() { calls.disposed += 1; } };
    },
    applyHighlights(filePath) { calls.applied.push(filePath); },
  };
  return { feature, calls };
}

// ---- 鸭子类型定位 ----
{
  const { feature } = makeFeature();
  const client = { _features: [{ unrelated: true }, feature] };
  check('按运行时形状定位 InactiveRegionsFeature', findInactiveRegionsFeature(client) === feature);
  check('_features 非数组时返回 undefined', findInactiveRegionsFeature({ _features: {} }) === undefined);
  check('缺少 files Map 的对象不误判', findInactiveRegionsFeature({
    _features: [{ async updateDecorationType() {}, applyHighlights() {} }],
  }) === undefined);
  check('无 _features 的客户端返回 undefined', findInactiveRegionsFeature({ state: 2 }) === undefined);
}

// ---- reset：模拟 languageclient 停止时 clear() 只 dispose 不置空的现场 ----
{
  const { feature, calls } = makeFeature();
  feature.decorationType = { dispose() { calls.disposed += 1; } };
  const ok = resetInactiveRegionsFeature({ _features: [feature] });
  check('reset 找到 Feature 并返回 true', ok === true);
  check('reset 释放旧装饰类型', calls.disposed === 1, calls.disposed);
  check('reset 置空 decorationType（关键：否则永不重建）', feature.decorationType === undefined, feature.decorationType);
  check('reset 清空 files 缓存', feature.files.size === 0, feature.files.size);
  check('找不到 Feature 时 reset 返回 false', resetInactiveRegionsFeature({ _features: [] }) === false);
}

(async () => {
  // ---- ensure：装饰类型缺失时重建 + 重新应用 ----
  {
    const { feature, calls } = makeFeature();
    feature.decorationType = undefined;
    const editors = [
      { document: { fileName: 'a.c' } },
      { document: { fileName: 'b.c' } },
    ];
    const ok = await ensureInactiveRegionsDecorations({ _features: [feature] }, editors);
    check('ensure 成功返回 true', ok === true);
    check('ensure 重建装饰类型', calls.updates === 1 && !!feature.decorationType, { updates: calls.updates, type: feature.decorationType });
    check('ensure 重新应用到所有可见编辑器', calls.applied.join(',') === 'a.c,b.c', calls.applied);
  }
  {
    // 装饰类型已存在时不重复重建（避免每次 refresh 都 dispose/新建）
    const { feature, calls } = makeFeature();
    await ensureInactiveRegionsDecorations({ _features: [feature] }, []);
    check('装饰类型已存在时不重复重建', calls.updates === 0, calls.updates);
  }
  {
    const { feature } = makeFeature();
    feature.decorationType = undefined;
    feature.updateDecorationType = async () => { throw new Error('boom'); };
    check('updateDecorationType 抛错时 ensure 返回 false', (await ensureInactiveRegionsDecorations({ _features: [feature] }, [])) === false);
  }
  {
    // 单编辑器应用抛错不影响其它编辑器
    const { feature } = makeFeature();
    const applied = [];
    feature.applyHighlights = (f) => {
      if (f === 'boom.c') throw new Error('boom');
      applied.push(f);
    };
    const ok = await ensureInactiveRegionsDecorations({ _features: [feature] }, [
      { document: { fileName: 'boom.c' } },
      { document: { fileName: 'ok.c' } },
    ]);
    check('单个编辑器应用失败不影响其它编辑器', ok === true && applied.join(',') === 'ok.c', applied);
  }

  // ---- watcher：状态过渡 + 客户端替换 ----
  const { feature, calls } = makeFeature();
  const listeners = [];
  const logs = [];
  const client = {
    state: 1,
    onDidChangeState(listener) {
      listeners.push(listener);
      return { dispose() {} };
    },
    _features: [feature],
  };
  let current = client;
  const watcher = new ClangdInactiveRegionsWatcher({
    getClient: () => current,
    log: (event) => logs.push(event),
    intervalMs: 5000,
  });
  const fire = async (newState) => {
    client.state = newState;
    for (const listener of listeners) listener({ newState });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };

  check('watcher 初始 Stopped 时清空旧区域', feature.files.size === 0, feature.files.size);
  await fire(2);
  check('Running 时重建装饰类型', calls.updates >= 1 && !!feature.decorationType, { updates: calls.updates, type: feature.decorationType });
  check('Running 时输出一次性初始化日志', logs.join(',') === 'initialized', logs);

  await fire(3);
  check('Starting 时释放并清空装饰类型', feature.decorationType === undefined, feature.decorationType);
  await fire(2);
  check('再次 Running 时重新建立装饰类型', calls.updates >= 2 && !!feature.decorationType, { updates: calls.updates, type: feature.decorationType });

  // 客户端被替换（clangd.restart 命令）：轮询/refresh 发现新客户端并重新 ensure
  const replacementFeature = makeFeature();
  replacementFeature.feature.decorationType = undefined;
  const replacement = {
    state: 2,
    onDidChangeState() { return { dispose() {} }; },
    _features: [replacementFeature.feature],
  };
  current = replacement;
  watcher.refresh();
  await new Promise((resolve) => setTimeout(resolve, 30));
  check('客户端被替换后 refresh 重新 attach 并重建装饰',
    replacementFeature.calls.updates === 1 && !!replacementFeature.feature.decorationType,
    { updates: replacementFeature.calls.updates, type: replacementFeature.feature.decorationType });

  watcher.dispose();
  const beforeDispose = replacementFeature.calls.updates;
  current = { state: 2, _features: [makeFeature().feature] };
  await new Promise((resolve) => setTimeout(resolve, 30));
  check('dispose 后不再 attach 新客户端', replacementFeature.calls.updates === beforeDispose, replacementFeature.calls.updates);

  mock.restore();
  console.log(`TOTAL=${pass + fail} PASS=${pass} FAIL=${fail}`);
  process.exit(fail ? 1 : 0);
})();
