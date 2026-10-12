// 性能趋势模块（tests/perf/trend.js）单元自测：用伪造历史数据覆盖对比/告警分支，
// 不依赖真实基准运行（毫秒级完成，可随 unit 层一起跑）。
//
// 覆盖：
//   - 机器指纹稳定性与区分度
//   - JSONL 历史读写（坏行跳过 / 上限裁剪 / 目录自动创建）
//   - 记录构造（NaN 结果 → skipped；预算/基线/超预算字段）
//   - 对比分支：无历史 / 恶化告警（相对 + 绝对同时超限）/ 阈值边界 / 绝对下限抑制 /
//               近 N 次中位数窗口 / 跨机历史排除 / 旧格式（无指纹）兼容
//   - 文本渲染（表格 / 告警 / 元信息）
//
// 临时文件：.cb-tools/perf-trend-test/（gitignored），测试结束删除。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const trend = require('./perf/trend');

const TEMP_DIR = path.join(root, '.cb-tools', 'perf-trend-test');
const HISTORY = path.join(TEMP_DIR, 'history.jsonl');

let pass = 0, fail = 0;
const check = (name, cond, detail) => {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + (detail ? '  ← ' + detail : '')); }
};

function fpRecord(id, medians, ts) {
  const benches = {};
  for (const [name, median] of Object.entries(medians)) benches[name] = { min: median, median, p95: median, budget: 1000, baselineMedian: 100, verdict: 'pass', overBudget: false, n: 5 };
  return { schema: trend.SCHEMA, timestamp: ts || '2026-01-01T00:00:00.000Z', machine: { id }, benches, skipped: [] };
}
const current = (name, median) => ({ name, median, baselineMedian: 100 });

try {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });

  // ---------- 1. 机器指纹 ----------
  const envA = { node: 'v24.19.0', platform: 'win32-x64', cpus: 8, cpuModel: 'Intel i3', totalMemGB: 15.8 };
  const envB = { ...envA, cpuModel: 'AMD Ryzen 9' };
  const envC = { ...envA, node: 'v22.1.0' };
  const fpA = trend.fingerprint(envA);
  check('指纹：同环境稳定', trend.fingerprint(envA).id === fpA.id);
  check('指纹：CPU 不同 → id 不同', trend.fingerprint(envB).id !== fpA.id);
  check('指纹：Node 主版本不同 → id 不同', trend.fingerprint(envC).id !== fpA.id);
  check('指纹：label 含平台与 Node 主版本', fpA.label.includes('win32-x64') && fpA.label.includes('node24'), fpA.label);

  // ---------- 2. 历史读写 ----------
  check('历史：文件不存在 → 空', trend.loadHistory(HISTORY).records.length === 0);
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.writeFileSync(HISTORY, [
    JSON.stringify(fpRecord('m1', { X: 10 })),
    '{ 坏行 not json',
    '',
    JSON.stringify(fpRecord('m1', { X: 12 })),
  ].join('\n') + '\n', 'utf-8');
  const loaded = trend.loadHistory(HISTORY);
  check('历史：坏行跳过并计数', loaded.records.length === 2 && loaded.malformed === 1, JSON.stringify({ n: loaded.records.length, malformed: loaded.malformed }));

  const appended = trend.appendHistory(HISTORY, fpRecord('m1', { X: 14 }), { keep: 3 });
  check('历史：未超上限时不裁剪', appended.total === 3 && appended.dropped === 0, JSON.stringify(appended));
  const appended2 = trend.appendHistory(HISTORY, fpRecord('m1', { X: 16 }), { keep: 3 });
  const after = trend.loadHistory(HISTORY).records;
  check('历史：超上限裁剪最旧', after.length === 3 && after[0].benches.X.median === 12 && after[2].benches.X.median === 16, JSON.stringify(after.map((r) => r.benches.X.median)));
  check('历史：裁剪数量回报', appended2.total === 3 && appended2.dropped === 1, JSON.stringify(appended2));
  const deep = path.join(TEMP_DIR, 'nested', 'deep.jsonl');
  trend.appendHistory(deep, fpRecord('m1', { X: 1 }));
  check('历史：目录自动创建', fs.existsSync(deep));

  // ---------- 3. 记录构造 ----------
  const record = trend.buildRecord({
    env: envA,
    fingerprint: fpA,
    results: [
      { name: 'A', result: { min: 5, median: 10, p95: 12, iterations: 5 }, verdict: { status: 'pass', budget: 30 } },
      { name: 'B', result: { min: NaN, median: NaN, p95: NaN, iterations: 0 }, verdict: { status: 'fail', reason: '执行异常' } },
    ],
    baseline: { benches: { A: { median: 8, budget: 30 } } },
    options: { only: 'A' },
    pkgVersion: '0.0.0-test',
    timestamp: '2026-01-02T00:00:00.000Z',
  });
  check('记录：非有限结果 → skipped', record.skipped.length === 1 && record.skipped[0] === 'B', JSON.stringify(record.skipped));
  check('记录：字段完整（min/median/budget/基线/判定）', record.benches.A.median === 10 && record.benches.A.budget === 30 && record.benches.A.baselineMedian === 8 && record.benches.A.overBudget === false && record.benches.A.n === 5);
  check('记录：meta 完整（schema/时间/版本/指纹/选项）', record.schema === trend.SCHEMA && record.timestamp === '2026-01-02T00:00:00.000Z' && record.pkgVersion === '0.0.0-test' && record.machine.id === fpA.id && record.options.only === 'A');
  check('记录：JSON 可序列化（无 NaN）', (() => { const s = JSON.stringify(record); return !s.includes('null,"median":null') && JSON.parse(s).benches.A.median === 10; })());

  const fp = { id: 'm1' };
  // ---------- 4. 无历史 ----------
  let s = trend.summarizeTrend([], [current('X', 10)], { fingerprint: fp });
  check('对比：无历史 → firstRun 且不告警', s.meta.firstRun === true && s.alerts.length === 0 && s.rows[0].status === 'no-history');
  check('对比：无历史 → 仍给出与基线的相对变化', Math.abs(s.rows[0].vsBaseline - (-0.9)) < 1e-9, String(s.rows[0].vsBaseline));

  // ---------- 5. 恶化告警（相对 + 绝对同超） ----------
  s = trend.summarizeTrend([fpRecord('m1', { X: 10 })], [current('X', 20)], { fingerprint: fp });
  check('对比：较上次 +100%/-+10ms → 告警', s.rows[0].status === 'alert' && s.alerts.length === 1, JSON.stringify(s.rows[0]));
  check('对比：告警文本含「较上次」与「恶化」', s.alerts[0].reason.includes('较上次') && s.alerts[0].reason.includes('恶化'), s.alerts[0].reason);
  const alertLines = trend.formatAlerts(s);
  check('对比：告警文本标注「仅告警不失败」', alertLines.length === 1 && alertLines[0].includes('仅告警不失败'), alertLines[0]);

  // ---------- 6. 改善 / 阈值边界 / 绝对下限 ----------
  s = trend.summarizeTrend([fpRecord('m1', { X: 20 })], [current('X', 10)], { fingerprint: fp });
  check('对比：改善（-50%）→ 稳定', s.rows[0].status === 'stable' && s.alerts.length === 0);
  s = trend.summarizeTrend([fpRecord('m1', { X: 10 })], [current('X', 12.5)], { fingerprint: fp });
  check('对比：恰好 +25%（阈值边界）→ 不告警', s.rows[0].status === 'stable', JSON.stringify(s.rows[0]));
  s = trend.summarizeTrend([fpRecord('m1', { X: 1 })], [current('X', 1.4)], { fingerprint: fp });
  check('对比：+40% 但绝对增量 0.4ms < 3ms → 不告警（绝对下限）', s.rows[0].status === 'stable', JSON.stringify(s.rows[0]));
  s = trend.summarizeTrend([fpRecord('m1', { X: 10 })], [current('X', 14)], { minAbsMs: 0.5, threshold: 0.25, fingerprint: fp });
  check('对比：绝对下限可调（14 > 12.5 且 >0.5ms → 告警）', s.rows[0].status === 'alert');
  s = trend.summarizeTrend([fpRecord('m1', { X: 10 })], [current('X', 10.4)], { threshold: 0.02, minAbsMs: 0.1, fingerprint: fp });
  check('对比：阈值可调（+4% > 2% → 告警）', s.rows[0].status === 'alert');

  // ---------- 7. 近 N 次中位数窗口 ----------
  const hist4 = [fpRecord('m1', { X: 10 }), fpRecord('m1', { X: 12 }), fpRecord('m1', { X: 20 }), fpRecord('m1', { X: 22 })];
  s = trend.summarizeTrend(hist4, [current('X', 26)], { window: 3, fingerprint: fp });
  check('对比：窗口=3 → 近 3 次中位数 20ms', s.rows[0].recentMedian === 20 && s.rows[0].recentCount === 3, JSON.stringify(s.rows[0]));
  check('对比：较近 3 次 +30% → 告警并写明窗口', s.rows[0].status === 'alert' && s.alerts[0].reason.includes('最近 3 次中位数 20ms'), s.alerts[0].reason);
  s = trend.summarizeTrend(hist4, [current('X', 26)], { window: 7, fingerprint: fp });
  check('对比：窗口大于历史条数 → 取全部（中位数 16ms）', s.rows[0].recentMedian === 16 && s.rows[0].recentCount === 4, JSON.stringify(s.rows[0]));

  // ---------- 8. 跨机历史排除 / 旧格式兼容 ----------
  const other = fpRecord('m2', { X: 5 });
  s = trend.summarizeTrend([other], [current('X', 30)], { fingerprint: fp });
  check('对比：跨机历史被排除（无同机可比 → 不告警）', s.meta.sameMachineRuns === 0 && s.meta.otherMachineRuns === 1 && s.rows[0].status === 'no-history' && s.alerts.length === 0);
  check('对比：上轮为跨机 → 明确标记', s.meta.prevRunOtherMachine === true);
  s = trend.summarizeTrend([other, fpRecord('m1', { X: 10 })], [current('X', 20)], { fingerprint: fp });
  check('对比：混合历史只取同机（m1=10 → 告警）', s.meta.sameMachineRuns === 1 && s.rows[0].status === 'alert');
  const legacy = fpRecord(null, { X: 40 });
  delete legacy.machine;
  s = trend.summarizeTrend([legacy], [current('X', 60)], { fingerprint: fp });
  check('对比：旧格式（无 machine）仍参与比较', s.rows[0].status === 'alert' && s.meta.sameMachineRuns === 1, JSON.stringify(s.rows[0]));
  check('对比：已执行到位的项计入可比数', trend.summarizeTrend(hist4, [current('X', 26)], { window: 3, fingerprint: fp }).meta.sameMachineRuns === 4);

  // ---------- 9. 文本渲染 ----------
  s = trend.summarizeTrend(hist4, [current('X', 26), current('Y', 5)], { window: 3, fingerprint: fp });
  const table = trend.formatTrendTable(s);
  check('渲染：表格含全部列头', table[0].includes('较上次') && table[0].includes('近 3 次 median') && table[0].includes('较基线') && table[0].includes('趋势'), table[0]);
  check('渲染：表格每行对应一项基准', table.length === 2 + 2 /* 表头 2 行 */, String(table.length));
  check('渲染：告警在表格中标注 ⚠️', table[2].includes('⚠️ 恶化') && table[3].includes('— 无历史'));
  const meta = trend.formatMeta(s);
  check('渲染：元信息含阈值与参照说明', meta.includes('最近 3 次中位数') && meta.includes('阈值=median 恶化 > 25%'), meta);
  check('渲染：百分比格式（正负号 + 一位小数）', trend.pct(0.3112) === '+31.1%' && trend.pct(-0.05) === '-5.0%' && trend.pct(null) === '—');

  // ---------- 10. 中位数工具 ----------
  check('工具：medianOf 奇数/偶数/空', trend.medianOf([1, 3, 2]) === 2 && trend.medianOf([1, 2, 3, 4]) === 2.5 && Number.isNaN(trend.medianOf([])));
} finally {
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
}

console.log(`\nperf-trend 单元自测: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
