// 性能基准 harness：warmup + N 次迭代，输出 median / p95 / min / max，
// 并提供「硬预算 fail + 基线漂移 warn」的判定（D5 决策）。
//
// 判定规则：
//   - median > budget            → fail（绝对预算，硬门禁）
//   - median > 1.8 × baseline    → warn（相对漂移，不失败）
//   - 无基线且非 --update-baseline → warn（提示先建立基线）
const fs = require('fs');
const path = require('path');

const DRIFT_FACTOR = 1.8;

/** 单次测量：warmup 次预热后 measure 次采样，返回统计量（毫秒） */
async function measure(fn, { warmup = 2, iterations = 7 } = {}) {
  for (let i = 0; i < warmup; i++) await fn();
  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  samples.sort((a, b) => a - b);
  const pick = (p) => samples[Math.min(samples.length - 1, Math.floor(p * samples.length))];
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    median: Number(pick(0.5).toFixed(2)),
    p95: Number((pick(0.95) ?? samples[samples.length - 1]).toFixed(2)),
    min: Number(samples[0].toFixed(2)),
    max: Number(samples[samples.length - 1].toFixed(2)),
    mean: Number((sum / samples.length).toFixed(2)),
    iterations: samples.length,
    samples: samples.map((s) => Number(s.toFixed(2))),
  };
}

/**
 * 判定单条结果。
 * 预算门禁用 **min**（最小采样）而非 median：共享/带杀毒扫描的 Windows 机器上，
 * 真实进程类基准的 median 会被负载尖峰抬高 10x，min 才是"真实成本"的稳健估计；
 * 而相对基线漂移仍用 median（趋势信号）。
 * @returns {{status:'pass'|'fail'|'warn', reason:string, budget?:number, baseline?:number}}
 */
function evaluate(name, result, baseline) {
  const entry = baseline?.benches?.[name];
  if (entry && Number.isFinite(entry.budget) && result.min > entry.budget) {
    return { status: 'fail', reason: `min ${result.min}ms > 预算 ${entry.budget}ms（median ${result.median}ms）`, budget: entry.budget, baseline: entry.median };
  }
  if (entry && Number.isFinite(entry.median) && result.median > entry.median * DRIFT_FACTOR) {
    return { status: 'warn', reason: `median ${result.median}ms > 基线 ${entry.median}ms 的 ${DRIFT_FACTOR}x（min ${result.min}ms 仍在预算内）`, budget: entry.budget, baseline: entry.median };
  }
  if (!entry) return { status: 'warn', reason: '无基线（先执行 npm run perf:baseline 建立基线）' };
  return { status: 'pass', reason: `min ${result.min}ms ≤ 预算 ${entry.budget}ms（median ${result.median}ms，基线 ${entry.median}ms）`, budget: entry.budget, baseline: entry.median };
}

function loadBaseline(file = path.join(__dirname, 'baseline.json')) {
  if (!fs.existsSync(file)) return { benches: {} };
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return { benches: {} }; }
}

function saveBaseline(results, env, file = path.join(__dirname, 'baseline.json')) {
  const prev = loadBaseline(file);
  const benches = {};
  for (const r of results) {
    const old = prev.benches?.[r.name];
    benches[r.name] = {
      // 预算首次固化：max(3×median, 原预算)，人工可在 baseline.json 中下调/上调后提交
      budget: old?.budget ?? Math.max(Number((r.result.median * 3).toFixed(2)), r.minBudget ?? 1),
      median: r.result.median,
      p95: r.result.p95,
      note: r.note || undefined,
    };
  }
  fs.writeFileSync(file, JSON.stringify({ updatedAt: new Date().toISOString(), env, benches }, null, 2) + '\n', 'utf-8');
  return benches;
}

/** 收集环境信息（写入报告，便于跨机对比时判断差异来源） */
function envInfo() {
  const os = require('os');
  return {
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpus: os.cpus().length,
    cpuModel: (os.cpus()[0] || {}).model || 'unknown',
    totalMemGB: Number((os.totalmem() / 1024 ** 3).toFixed(1)),
    date: new Date().toISOString().slice(0, 10),
  };
}

module.exports = { measure, evaluate, loadBaseline, saveBaseline, envInfo, DRIFT_FACTOR };
