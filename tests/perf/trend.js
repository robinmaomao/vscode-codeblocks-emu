// 性能趋势记录与漂移对比（L4 性能基准的时间维度扩展）
//
// 职责：
//   1. 历史落盘：每次 test-perf.js 运行追加一条 JSON 记录到 .cb-tools/perf-history.jsonl
//      （gitignored：历史只对本机有意义——跨机比较会被 CPU/OS/Node 差异主导；
//        需要入库的结论以 docs/性能基准.md 的「趋势」小节形式呈现）
//   2. 漂移对比：本次 median 与「上次运行」「最近 N 次中位数」比较；
//      恶化超过阈值（默认相对 +25% 且绝对 +3ms）→ 输出告警文本（**不判失败**）
//   3. 对照基线：同时给出与 tests/perf/baseline.json 基线 median 的相对变化（信息性）
//
// 门禁语义边界（重要）：
//   - 预算硬门禁（min > budget → fail）完全由 bench.js evaluate 决定，本模块不参与、不弱化；
//   - 本模块只产出告警文本，调用方不得据此改变退出码。
//
// 记录结构（schema=cb-perf-history/1）：
//   { schema, timestamp, pkgVersion, script, machine:{id,os,cpu,cpus,nodeMajor,memGB,label},
//     options:{only,skipReal,update}, benches:{ [name]: {min,median,p95,budget,baselineMedian,verdict,overBudget,n} }, skipped:[name] }
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 'cb-perf-history/1';
const HISTORY_KEEP = 500;       // 历史最多保留的运行条数（超出丢弃最旧）
const DEFAULT_WINDOW = 5;       // 「最近 N 次」默认窗口
const DEFAULT_THRESHOLD = 0.25; // median 相对参照的恶化阈值（25%）
const DEFAULT_MIN_ABS_MS = 3;   // 绝对增量下限，抑制亚毫秒基准的百分比噪声

/** 机器指纹：CPU 型号/核数 + 平台 + Node 主版本 → 相同指纹的历史才互相比较 */
function fingerprint(env = {}) {
  const platform = env.platform || `${process.platform}-${process.arch}`;
  const cpu = env.cpuModel || (os.cpus()[0] || {}).model || 'unknown';
  const cpus = env.cpus || os.cpus().length;
  const nodeMajor = String(env.node || process.version).replace(/^v/, '').split('.')[0] || '?';
  const memGB = Number.isFinite(env.totalMemGB) ? env.totalMemGB : Number((os.totalmem() / 1024 ** 3).toFixed(1));
  const id = crypto.createHash('sha1').update([platform, cpu, cpus, nodeMajor].join('|')).digest('hex').slice(0, 12);
  return { id, platform, cpu, cpus, nodeMajor, memGB, label: `${platform}/node${nodeMajor}/${cpus}core/${cpu}` };
}

/** 读取 JSONL 历史；坏行计入 malformed 并跳过（历史文件损坏不应让基准失败） */
function loadHistory(file) {
  if (!file || !fs.existsSync(file)) return { records: [], malformed: 0 };
  const records = [];
  let malformed = 0;
  for (const line of fs.readFileSync(file, 'utf-8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === 'object') records.push(rec);
      else malformed++;
    } catch { malformed++; }
  }
  return { records, malformed };
}

/** 追加一条记录（整文件重写以便裁剪；最多保留 keep 条） */
function appendHistory(file, record, { keep = HISTORY_KEEP } = {}) {
  const { records } = loadHistory(file);
  records.push(record);
  const trimmed = records.slice(-keep);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, trimmed.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  return { total: trimmed.length, dropped: records.length - trimmed.length };
}

/** 由本次运行结果构造历史记录（非有限 median 的项计入 skipped，避免 NaN 无法序列化） */
function buildRecord({ env, fingerprint: fp, results, baseline, options, pkgVersion, timestamp }) {
  const benches = {};
  const skipped = [];
  for (const r of results || []) {
    const median = r.result?.median;
    if (!Number.isFinite(median)) { skipped.push(r.name); continue; }
    const entry = baseline?.benches?.[r.name];
    benches[r.name] = {
      min: r.result.min,
      median,
      p95: r.result.p95,
      budget: Number.isFinite(r.verdict?.budget) ? r.verdict.budget : (Number.isFinite(entry?.budget) ? entry.budget : null),
      baselineMedian: Number.isFinite(entry?.median) ? entry.median : null,
      verdict: r.verdict?.status || 'unknown',
      overBudget: r.verdict?.status === 'fail',
      n: r.result.iterations,
    };
  }
  return {
    schema: SCHEMA,
    timestamp: timestamp || new Date().toISOString(),
    pkgVersion: pkgVersion || null,
    script: 'tests/perf/test-perf.js',
    machine: fp || fingerprint(env),
    options: options || {},
    benches,
    skipped,
  };
}

function medianOf(nums) {
  const s = nums.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return NaN;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function ratio(cur, ref) {
  if (!Number.isFinite(cur) || !Number.isFinite(ref) || ref <= 0) return null;
  return cur / ref - 1;
}

/** 恶化判定：相对超阈值 且 绝对增量超下限（两者同时满足才算回归） */
function regression(cur, ref, threshold = DEFAULT_THRESHOLD, minAbsMs = DEFAULT_MIN_ABS_MS) {
  if (!Number.isFinite(cur) || !Number.isFinite(ref) || ref <= 0) return false;
  return cur > ref * (1 + threshold) && cur - ref > minAbsMs;
}

function pct(r) {
  if (r === null || r === undefined || !Number.isFinite(r)) return '—';
  return `${r >= 0 ? '+' : ''}${(r * 100).toFixed(1)}%`;
}

/**
 * 对比本次结果与历史。
 * @param {Array} history loadHistory().records（按时间升序）
 * @param {Array<{name:string,median:number,baselineMedian?:number}>} current 本次各项结果
 * @param {{window?:number,threshold?:number,minAbsMs?:number,fingerprint?:object}} [opts]
 * @returns {{rows:Array,alerts:Array,meta:object}}
 */
function summarizeTrend(history, current, opts = {}) {
  const window = opts.window ?? DEFAULT_WINDOW;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const minAbsMs = opts.minAbsMs ?? DEFAULT_MIN_ABS_MS;
  const fp = typeof opts.fingerprint === 'string' ? { id: opts.fingerprint } : opts.fingerprint;

  const valid = (history || []).filter((r) => r && r.benches);
  // 仅同机历史参与比较；旧格式（无 machine.id）视为可比，避免升级后历史作废
  const same = fp ? valid.filter((r) => !r.machine?.id || r.machine.id === fp.id) : valid;
  const otherMachine = fp ? valid.filter((r) => r.machine?.id && r.machine.id !== fp.id) : [];
  const prevAny = valid.length ? valid[valid.length - 1] : null;

  const rows = [];
  const alerts = [];
  for (const c of current || []) {
    if (!Number.isFinite(c.median)) continue;
    const medianOfRec = (rec) => {
      const m = rec.benches?.[c.name]?.median;
      return Number.isFinite(m) ? m : null;
    };
    const prior = same.filter((r) => medianOfRec(r) !== null);
    const lastRec = prior.length ? prior[prior.length - 1] : null;
    const lastMedian = lastRec ? medianOfRec(lastRec) : null;
    const recent = prior.slice(-window);
    const recentMedians = recent.map(medianOfRec);
    const recentMedian = recentMedians.length ? Number(medianOf(recentMedians).toFixed(2)) : null;
    const baselineMedian = Number.isFinite(c.baselineMedian) ? c.baselineMedian : null;

    const vsLast = ratio(c.median, lastMedian);
    const vsRecent = ratio(c.median, recentMedian);
    const vsBaseline = ratio(c.median, baselineMedian);

    const reasons = [];
    if (regression(c.median, lastMedian, threshold, minAbsMs)) {
      reasons.push(`较上次 ${lastMedian}ms 恶化 ${pct(vsLast)}（+${(c.median - lastMedian).toFixed(2)}ms）`);
    }
    if (regression(c.median, recentMedian, threshold, minAbsMs)) {
      reasons.push(`较最近 ${recent.length} 次中位数 ${recentMedian}ms 恶化 ${pct(vsRecent)}（+${(c.median - recentMedian).toFixed(2)}ms）`);
    }

    const status = prior.length === 0 ? 'no-history' : reasons.length ? 'alert' : 'stable';
    const row = {
      name: c.name,
      median: c.median,
      lastMedian,
      lastAt: lastRec?.timestamp || null,
      vsLast,
      recentMedian,
      recentCount: recent.length,
      vsRecent,
      baselineMedian,
      vsBaseline,
      status,
      reason: status === 'no-history' ? '该基准在本机历史中首次出现' : reasons.join('；'),
    };
    rows.push(row);
    if (status === 'alert') alerts.push({ name: c.name, reason: row.reason, median: c.median, recentMedian, lastMedian });
  }

  return {
    rows,
    alerts,
    meta: {
      window,
      threshold,
      minAbsMs,
      historyTotal: valid.length,
      sameMachineRuns: same.length,
      otherMachineRuns: otherMachine.length,
      prevRunOtherMachine: !!(prevAny && fp && prevAny.machine?.id && prevAny.machine.id !== fp.id),
      prevRunAt: prevAny?.timestamp || null,
      firstRun: same.length === 0,
    },
  };
}

/** 供 CLI 与报告共用的 Markdown 表格（列为「相对上轮 / 近 N 轮」） */
function formatTrendTable(summary) {
  const { rows, meta } = summary;
  const lines = [];
  lines.push(`| 基准 | 本次 median | 上次 median | 较上次 | 近 ${meta.window} 次 median | 较近 ${meta.window} 次 | 基线 median | 较基线 | 趋势 |`);
  lines.push('|------|-------------|-------------|--------|------------------------|------------------------|-------------|--------|------|');
  for (const r of rows) {
    const icon = r.status === 'alert' ? '⚠️ 恶化' : r.status === 'no-history' ? '— 无历史' : '✅ 稳定';
    const recentCell = r.recentMedian === null ? '—' : `${r.recentMedian}ms（n=${r.recentCount}）`;
    lines.push(`| ${r.name} | ${r.median}ms | ${r.lastMedian ?? '—'}ms | ${pct(r.vsLast)} | ${recentCell} | ${pct(r.vsRecent)} | ${r.baselineMedian ?? '—'}ms | ${pct(r.vsBaseline)} | ${icon} |`);
  }
  return lines;
}

/** 告警文本行（始终打印，不判失败） */
function formatAlerts(summary) {
  return summary.alerts.map((a) => `⚠️ 趋势告警 ${a.name}: median ${a.median}ms ${a.reason}（阈值 ${(summary.meta.threshold * 100).toFixed(0)}% 且 +${summary.meta.minAbsMs}ms，仅告警不失败）`);
}

/** 一行式元信息（历史规模 / 参照） */
function formatMeta(summary) {
  const m = summary.meta;
  const other = m.otherMachineRuns ? `；另有 ${m.otherMachineRuns} 次来自其它机器，已排除` : '';
  const skipped = m.prevRunOtherMachine ? `；注意：上次运行来自不同机器指纹（${m.prevRunAt || '?'}），不参与对比` : '';
  return `同机可比历史 ${m.sameMachineRuns} 次${other}${skipped}；参照=上次运行 + 最近 ${m.window} 次中位数；阈值=median 恶化 > ${(m.threshold * 100).toFixed(0)}% 且 > ${m.minAbsMs}ms`;
}

module.exports = {
  SCHEMA,
  HISTORY_KEEP,
  DEFAULT_WINDOW,
  DEFAULT_THRESHOLD,
  DEFAULT_MIN_ABS_MS,
  fingerprint,
  loadHistory,
  appendHistory,
  buildRecord,
  medianOf,
  ratio,
  regression,
  summarizeTrend,
  formatTrendTable,
  formatAlerts,
  formatMeta,
  pct,
};
