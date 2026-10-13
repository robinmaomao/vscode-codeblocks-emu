// Problems 诊断发布器回归（构建期批量发布，替代「每条诊断一次 set」）：
//   · 语义与逐条发布一致：同 URI 按到达顺序追加、构建开始时集合已被 clear
//   · 调用次数从 O(N) 降到 ≤ 文件数；提交元素量从 O(N²) 降到 O(N)
//   · 构建期节流发布（Problems 逐步更新），finish() 最终发布 + 释放定时器
// 实测基线（修复前，4000 条 / 20 文件）：set 调用 4000 次、累计提交 402000 个元素；批量后 20 次、4000 个。
const { DiagnosticPublisher, DIAGNOSTIC_PUBLISH_THROTTLE_MS } = require('../dist/build/diagnosticPublisher.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); }
}

/** 伪诊断集合（结构兼容 vscode.DiagnosticCollection：get/set） */
class FakeSink {
  constructor() {
    this.map = new Map();
    this.setCalls = 0;
    this.elements = 0;
  }
  get(uri) { return this.map.get(uri); }
  set(uri, diags) {
    this.setCalls++;
    this.elements += diags.length;
    this.map.set(uri, [...diags]);
  }
  count() { let n = 0; for (const d of this.map.values()) n += d.length; return n; }
}

/** 顺序快照：uri → 诊断（用于与逐条发布基线逐项比对） */
const snapshot = (sink) => [...sink.map.entries()].map(([u, d]) => `${u}:${d.join(',')}`).join('|');

(async () => {
  // 1. 4000 条 / 20 文件：set 调用 ≤ 文件数、元素量 = N（对比逐条发布：4000 次 / 402000 元素）
  const sink = new FakeSink();
  const pub = new DiagnosticPublisher(sink, (u) => u, 0);
  const perFile = 200, files = 20;
  for (let i = 0; i < perFile; i++) {
    for (let f = 0; f < files; f++) pub.add(`file:///${f}.cpp`, `d${f}-${i}`);
  }
  check('批量前：尚未提交（throttle=0 时不自动发布）', sink.setCalls === 0, sink.setCalls, 0);
  check('批量前：待发布数量正确', pub.pendingCount === perFile * files, pub.pendingCount, perFile * files);
  pub.finish();
  check('批量后：set 调用数 = 文件数（≤ 20）', sink.setCalls === files, sink.setCalls, files);
  check('批量后：提交元素量 = 诊断数（O(N) 而非 O(N²)）', sink.elements === perFile * files, sink.elements, perFile * files);
  check('批量后：诊断总量不变', sink.count() === perFile * files, sink.count(), perFile * files);
  check('批量后：finish 清空待发布队列', pub.pendingCount === 0, pub.pendingCount, 0);

  // 2. 语义等价：与「逐条立即发布」得到完全一致的最终内容与顺序
  const seq = new FakeSink();
  const baseline = new DiagnosticPublisher(seq, (u) => u, 0);
  for (let i = 0; i < 5; i++) {
    for (const f of ['a', 'b']) baseline.add(`file:///${f}.cpp`, `x${i}`);
    baseline.flush(); // 模拟逐条发布（每条一次 set）
  }
  baseline.finish();
  const group = new FakeSink();
  const byUri = new DiagnosticPublisher(group, (u) => u, 0);
  for (let i = 0; i < 5; i++) { byUri.add('file:///a.cpp', `x${i}`); byUri.add('file:///b.cpp', `x${i}`); }
  byUri.finish();
  check('顺序等价：与逐条发布内容/顺序一致', snapshot(group) === snapshot(seq), snapshot(group), snapshot(seq));
  check('效率：批量发布调用次数更少（2 文件 → 2 次 vs 10 次）', group.setCalls < seq.setCalls, { batch: group.setCalls, seq: seq.setCalls }, 'batch < seq');

  // 3. 追加语义：集合中已有诊断（构建开始时 clear 之外的情形）→ 追加在其后，不覆盖
  const pre = new FakeSink();
  pre.set('file:///a.cpp', ['pre1', 'pre2']);
  const append = new DiagnosticPublisher(pre, (u) => u, 0);
  append.add('file:///a.cpp', 'new1');
  append.finish();
  check('追加语义：已有诊断保留且新诊断在后', JSON.stringify(pre.get('file:///a.cpp')) === JSON.stringify(['pre1', 'pre2', 'new1']), pre.get('file:///a.cpp'), ['pre1', 'pre2', 'new1']);

  // 4. 构建期节流发布：有数据流动时 Problems 逐步更新（不是等到构建结束才出现）
  const sink4 = new FakeSink();
  const pub4 = new DiagnosticPublisher(sink4, (u) => u, 40);
  check('节流常量：默认 200ms（内部常量，非设置项）', DIAGNOSTIC_PUBLISH_THROTTLE_MS === 200, DIAGNOSTIC_PUBLISH_THROTTLE_MS, 200);
  pub4.add('file:///x.cpp', 'early');
  await new Promise((r) => setTimeout(r, 120));
  check('节流：构建进行中已发布（Problems 无需等到构建结束）', sink4.count() === 1, sink4.count(), 1);
  pub4.add('file:///x.cpp', 'late');
  check('节流：发布后新诊断进入下一批（尚未提交）', sink4.count() === 1, sink4.count(), 1);
  pub4.finish();
  check('节流：finish 冲刷尾部诊断', sink4.count() === 2, sink4.count(), 2);
  await new Promise((r) => setTimeout(r, 80));
  check('节流：finish 后定时器已释放（不再重复发布）', sink4.setCalls === 2, sink4.setCalls, 2);

  // 5. finish 幂等 + 空发布器安全（无诊断时不得产生 set 调用）
  pub4.finish();
  check('finish 幂等：重复调用不产生额外提交', sink4.setCalls === 2, sink4.setCalls, 2);
  const empty = new FakeSink();
  new DiagnosticPublisher(empty, (u) => u, 40).finish();
  check('空发布器：finish 无 set 调用（不写空数组）', empty.setCalls === 0, empty.setCalls, 0);

  // 5b. 构建中点「清除错误」：待发布诊断被丢弃（保持「清除后为空」的既有语义）
  const sink5 = new FakeSink();
  const pub5 = new DiagnosticPublisher(sink5, (u) => u, 30);
  pub5.add('file:///c.cpp', 'stale');
  pub5.clearPending();
  pub5.finish();
  check('clearPending：丢弃待发布诊断', sink5.setCalls === 0 && sink5.count() === 0, { calls: sink5.setCalls, count: sink5.count() }, { calls: 0, count: 0 });
  await new Promise((r) => setTimeout(r, 60));
  check('clearPending：定时器已释放（不复活旧诊断）', sink5.setCalls === 0, sink5.setCalls, 0);
  pub5.add('file:///c.cpp', 'fresh');
  pub5.finish();
  check('clearPending 后：新诊断仍正常发布', JSON.stringify(sink5.get('file:///c.cpp')) === JSON.stringify(['fresh']), sink5.get('file:///c.cpp'), ['fresh']);

  // 6. keyOf 归并：不同 Uri 对象指向同一文件（vscode.Uri 每次新建 ⇒ toString 相同）只算一份
  const sink6 = new FakeSink();
  const pub6 = new DiagnosticPublisher(sink6, (u) => u.toString(), 0);
  const u1 = { toString: () => 'file:///same.cpp', n: 1 };
  const u2 = { toString: () => 'file:///same.cpp', n: 2 };
  pub6.add(u1, 'e1');
  pub6.add(u2, 'e2');
  pub6.finish();
  check('keyOf 归并：同 URI 字符串合并为一次提交', sink6.setCalls === 1, sink6.setCalls, 1);
  check('keyOf 归并：两条诊断均保留且顺序正确', JSON.stringify(sink6.get(u1)) === JSON.stringify(['e1', 'e2']), sink6.get(u1), ['e1', 'e2']);

  console.log(`诊断发布器: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('测试异常:', e); process.exit(1); });
