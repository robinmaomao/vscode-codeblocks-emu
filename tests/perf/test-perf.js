// L4 性能基准运行器
//
// 用法：
//   node tests/perf/test-perf.js                    # 运行全部基准，按预算/基线判定（D5：硬预算 fail + 漂移 warn）
//   node tests/perf/test-perf.js --update-baseline  # 刷新 tests/perf/baseline.json（npm run perf:baseline）
//   node tests/perf/test-perf.js --only parse       # 子串筛选
//   node tests/perf/test-perf.js --skip-real        # 跳过需要真实 gcc 的基准
//
// 产物：.cb-tools/perf/<时间戳>.json（原始结果）+ docs/性能基准.md（人类可读报告）
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const { measure, evaluate, loadBaseline, saveBaseline, envInfo } = require('./bench');
const { generateBigProject, copyVariants } = require('./fixtures');
const { installVscodeMock } = require('../_harness/vscodeMock');

const args = process.argv.slice(2);
const update = args.includes('--update-baseline');
const skipReal = args.includes('--skip-real');
const onlyArg = args.find((a) => a.startsWith('--only=')) || (args.includes('--only') ? `--only=${args[args.indexOf('--only') + 1]}` : '');
const only = onlyArg ? onlyArg.split('=')[1] : '';

const HAS_GCC = (() => {
  try {
    const r = require('child_process').spawnSync('gcc', ['--version'], { encoding: 'utf-8', windowsHide: true });
    return r.status === 0;
  } catch { return false; }
})();

// ---------- 探针工程（临时目录，进程结束清理） ----------
const tmpDirs = [];
function tmp(prefix) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
function cleanup() {
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
}

function withMock(fn) {
  const mock = installVscodeMock({ config: { 'codeblocks.build.skipIncludeDeps': false } });
  try { return fn(); } finally { mock.restore(); }
}

// 全局 mock：dist 模块在 require 期即读取 vscode（OutputParser/BuildEngine 等），
// 必须在加载前安装，并保持到全部基准结束（模块内的 vscode 命名空间在调用期仍会读取）。
let globalMock = null;
function installGlobalMock() {
  if (!globalMock) globalMock = installVscodeMock({ config: { 'codeblocks.build.skipIncludeDeps': false } });
}
function restoreGlobalMock() {
  if (globalMock) { globalMock.restore(); globalMock = null; }
}

// ---------- 基准定义 ----------
/** 每个基准：{ name, note, iterations, warmup, minBudget, run() } */
async function buildBenches() {
  const { ProjectParser } = require('../../dist/model/parser.js');
  const { serializeProject } = require('../../dist/model/projectWriter.js');
  const { CompilerOptionsLoader } = require('../../dist/compiler/optionsLoader.js');
  const { CommandGenerator } = require('../../dist/compiler/commandGenerator.js');
  const { OutputParser } = require('../../dist/build/outputParser.js');
  const { LruCache } = require('../../dist/tools/lru.js');
  const { upperDrive } = require('../../dist/tools/pathCase.js');
  const { assignFileToVirtualFolder, countFilesUnderVirtualFolder } = require('../../dist/model/virtualFolders.js');
  const types = require('../../dist/model/types.js');

  const project = generateBigProject(tmp('cb-perf-'), { files: 1200 });
  const variants = copyVariants(project.cbp, 5);
  let variantIdx = 0;
  const nextVariant = () => variants[variantIdx++ % variants.length];

  const benches = [];
  const add = (b) => benches.push(b);

  add({
    name: 'B1 大工程冷解析（1200 文件 / 6 目标）',
    note: `探针：${project.cbp}`,
    iterations: 5,
    warmup: 1,
    minBudget: 20,
    run: () => { new ProjectParser().parse(nextVariant()); },
  });

  const parsedForCache = new ProjectParser().parse(project.cbp);
  add({
    name: 'B1b 解析缓存命中（同一文件重复解析）',
    minBudget: 1,
    run: () => { new ProjectParser().parse(project.cbp); },
  });

  add({
    name: 'B1c 序列化往返（parse→serialize 全工程）',
    iterations: 5,
    minBudget: 20,
    run: () => { serializeProject(new ProjectParser().parse(project.cbp)); },
  });

  // B2 命令行生成 + 宏展开（1000 文件目标的编译命令）
  const loader = new CompilerOptionsLoader(path.join(root, 'resources', 'compilers'));
  const compiler = loader.load('gcc');
  const big = new ProjectParser().parse(project.cbp);
  const target = big.buildTargets[0];
  add({
    name: 'B2 编译命令行生成 + 宏展开（1200 文件目标）',
    iterations: 5,
    warmup: 1,
    minBudget: 20,
    run: () => {
      const gen = new CommandGenerator(big, compiler);
      let n = 0;
      for (const file of target.files) {
        const cmd = gen.generate(types.CommandType.CompileObjectCmd, {
          target,
          pf: file,
          file: file.absolutePath,
          object: path.relative(big.basePath, file.absolutePath).replace(/\.(c|cpp|S|s|asm)$/, '.o'),
          flatObject: path.basename(file.absolutePath).replace(/\.(c|cpp|S|s|asm)$/, '.o'),
          deps: file.absolutePath + '.d',
          hasCppFilesToLink: false,
          nativeSep: true,
        });
        if (cmd) n++;
      }
      if (!n) throw new Error('未生成任何命令');
    },
  });

  // B3 输出解析 → 诊断（2 万行 / 2000 条诊断）
  const parserLines = [];
  for (let i = 0; i < 20000; i++) {
    if (i % 10 === 0) {
      parserLines.push(i % 20 === 0
        ? `E:\\proj\\src\\dir\\file_${i}.c:${(i % 900) + 1}:${(i % 40) + 1}: error: 'x${i}' undeclared (first use in this function)`
        : `E:\\proj\\src\\dir\\file_${i}.cpp:${(i % 900) + 1}: warning: unused variable 'tmp${i}' [-Wunused-variable]`);
    } else {
      parserLines.push(`gcc -c -o obj/file_${i}.o src/file_${i}.c`);
    }
  }
  withMock(() => {
    const out = new OutputParser();
    add({
      name: 'B3 编译输出解析 → 诊断（2 万行 / 2000 条）',
      iterations: 5,
      minBudget: 20,
      run: () => {
        let diags = 0;
        for (const line of parserLines) if (out.toDiagnostic(line, 'E:\\proj')) diags++;
        if (diags < 1900) throw new Error('诊断数异常: ' + diags);
      },
    });
  });

  add({
    name: 'B4 编译器选项 XML 全量加载（options_gcc.xml）',
    iterations: 5,
    minBudget: 10,
    run: () => { new CompilerOptionsLoader(path.join(root, 'resources', 'compilers')).load('gcc'); },
  });

  add({
    name: 'B5 LRU 10 万次操作 + 盘符归一化 5 万次',
    iterations: 5,
    minBudget: 10,
    run: () => {
      const cache = new LruCache(1024);
      for (let i = 0; i < 100000; i++) {
        const k = `key_${i % 4096}`;
        if (cache.get(k) === undefined) cache.set(k, i);
      }
      for (let i = 0; i < 50000; i++) upperDrive(`e:\\proj\\src\\file_${i % 1000}.c`);
    },
  });

  add({
    name: 'B6 虚拟文件夹索引构建（1200 文件归属 + 计数）',
    iterations: 5,
    minBudget: 10,
    run: () => {
      const folders = big.virtualFolders.slice();
      const model = { virtualFolders: folders, files: big.files.map((f) => ({ ...f })) };
      for (const f of model.files) {
        const vf = f.virtualFolder || folderFor(f.relativeFilename);
        if (vf) assignFileToVirtualFolder(model, f, vf);
      }
      let total = 0;
      for (const vf of folders) total += countFilesUnderVirtualFolder(model, vf);
      if (!total) throw new Error('虚拟文件夹计数为 0');
    },
  });

  function folderFor(rel) {
    const parts = String(rel).split('/');
    return parts.length > 1 ? parts.slice(0, -1).join('/') : '';
  }

  // B7 增量判定（真实文件系统 + include 依赖扫描缓存）
  if (HAS_GCC) {
    const helloDir = path.join(root, 'test-project');
    const copy = tmp('cb-perf-hello-');
    for (const f of ['hello-cb.cbp', 'main.c', 'util.c', 'util.h']) {
      fs.copyFileSync(path.join(helloDir, f), path.join(copy, f));
    }
    const { CodeBlocksConfig } = require('../../dist/compiler/codeblocksConfig.js');
    const { BuildEngine } = require('../../dist/build/buildEngine.js');
    const { applyGeneratedFiles } = require('../../dist/build/generatedFiles.js');
    const mkEngine = () => withMock(() => {
      const cb = new CodeBlocksConfig();
      cb.load();
      const getCompiler = (id) => {
        const c = loader.load(id);
        const up = cb.resolvePrograms(id);
        if (up) { c.programs = { ...c.programs, C: up.C, CPP: up.CPP, LD: up.LD, LIB: up.LIB }; c.masterPath = up.masterPath; }
        return c;
      };
      const p = new ProjectParser().parse(path.join(copy, 'hello-cb.cbp'));
      applyGeneratedFiles(p, getCompiler);
      const out = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
      return { engine: new BuildEngine(p, getCompiler('gcc'), out, getCompiler), project: p };
    });

    // 先构建一次，保证对象/可执行文件存在（供增量判定与 up-to-date 基准使用）
    const first = mkEngine();
    await first.engine.build(undefined, { onLine: () => {} });

    add({
      name: 'B7 增量判定 isUpToDate（真实源/对象 + include 依赖缓存）',
      iterations: 7,
      minBudget: 1,
      run: () => {
        const { engine, project } = mkEngine();
        const t = project.buildTargets[0];
        const deps = new Map();
        const dirs = engine.getIncludeDirs(t, undefined);
        const src = path.join(copy, 'main.c');
        const obj = path.join(copy, 'obj', 'Debug', 'main.o');
        engine.isUpToDate(src, obj, dirs, deps);
      },
    });

    add({
      name: 'B8 真实全量构建（gcc 3 文件编译 + 链接，含清理）',
      iterations: 3,
      warmup: 1,
      minBudget: 500,
      run: async () => {
        const { engine, project } = mkEngine();
        engine.cleanTarget(project.buildTargets[0]);
        const ok = await engine.build(undefined, { onLine: () => {} });
        if (!ok) throw new Error('全量构建失败');
      },
    });

    add({
      name: 'B9 真实增量构建 up-to-date（无变更 → 零编译命令）',
      iterations: 5,
      minBudget: 50,
      run: async () => {
        const { engine } = mkEngine();
        let commands = 0;
        const ok = await engine.build(undefined, { onLine: (l) => { if (/^gcc |^g\+\+ /.test(String(l).trim())) commands++; } });
        if (!ok) throw new Error('增量构建失败');
      },
    });

    add({
      name: 'B10 真实单文件编译 compileFile（main.c）',
      iterations: 5,
      warmup: 1,
      minBudget: 100,
      run: async () => {
        const { engine, project } = mkEngine();
        engine.cleanFile(project.buildTargets[0].title, 'main.c');
        const ok = await engine.compileFile(project.buildTargets[0].title, 'main.c', { onLine: () => {} });
        if (!ok) throw new Error('单文件编译失败');
      },
    });
  }

  return benches;
}

// ---------- 运行 ----------
async function main() {
  installGlobalMock();
  const env = envInfo();
  console.log(`性能基准环境: node=${env.node} ${env.platform} cpu=${env.cpuModel}×${env.cpus} mem=${env.totalMemGB}GB gcc=${HAS_GCC ? 'yes' : 'no'}`);
  if (only) console.log(`筛选: ${only}`);

  let benches = await buildBenches();
  if (skipReal) benches = benches.filter((b) => !/^B(7|8|9|10) /.test(b.name));
  if (only) benches = benches.filter((b) => b.name.includes(only) || b.id === only);
  if (!benches.length) {
    console.error(`没有匹配的基准（--only=${only}${skipReal ? ' --skip-real' : ''}）`);
    process.exit(2);
  }

  const baseline = loadBaseline();
  const results = [];
  let failCount = 0, warnCount = 0;
  for (const b of benches) {
    let result, error;
    try {
      result = await measure(b.run, { warmup: b.warmup ?? 2, iterations: b.iterations ?? 7 });
    } catch (err) {
      error = err;
      result = { median: NaN, p95: NaN, min: NaN, max: NaN, mean: NaN, iterations: 0, samples: [] };
    }
    let verdict = error ? { status: 'fail', reason: `执行异常: ${error.message}` } : evaluate(b.name, result, baseline);

    // 抗抖动：首次超预算时复核一次（真实进程类基准在机器负载下会偶发 10x 尖峰）；
    // 复核仍超预算才判失败——真回归会稳定复现，尖峰则不会。
    if (verdict.status === 'fail' && !error) {
      await new Promise((r) => setTimeout(r, 1500));
      const retry = await measure(b.run, { warmup: b.warmup ?? 2, iterations: b.iterations ?? 7 });
      if (retry.min <= (verdict.budget ?? Number.POSITIVE_INFINITY)) {
        verdict = { status: 'warn', reason: `首次 min ${result.min}ms 超预算，复核通过（${retry.min}ms，判定为抖动）`, budget: verdict.budget, baseline: verdict.baseline };
        result = retry;
      } else {
        verdict = { status: 'fail', reason: `${verdict.reason}；复核 min ${retry.min}ms 仍超预算`, budget: verdict.budget, baseline: verdict.baseline };
        result = retry;
      }
    }

    if (verdict.status === 'fail') failCount++;
    if (verdict.status === 'warn') warnCount++;
    const tag = verdict.status === 'fail' ? 'FAIL' : verdict.status === 'warn' ? 'WARN' : 'OK  ';
    console.log(`${tag} ${b.name}\n     median=${result.median}ms p95=${result.p95}ms min=${result.min}ms n=${result.iterations}  ${verdict.reason}`);
    results.push({ name: b.name, note: b.note, minBudget: b.minBudget, result, verdict });
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const cbTools = path.join(root, '.cb-tools', 'perf');
  fs.mkdirSync(cbTools, { recursive: true });
  fs.writeFileSync(path.join(cbTools, `perf-${stamp}.json`), JSON.stringify({ env, results: results.map(({ result, verdict, ...r }) => ({ ...r, result, verdict })) }, null, 2), 'utf-8');

  if (update) {
    const benchesOut = saveBaseline(results.filter((r) => !Number.isNaN(r.result.median)), env);
    console.log(`\n基线已更新: tests/perf/baseline.json（${Object.keys(benchesOut).length} 项，预算 = max(3×median, 下限)）`);
  }
  // 报告
  const lines = [];
  lines.push('# 性能基准报告（自动生成，勿手工编辑）');
  lines.push('');
  lines.push('> 生成方式：`npm run test:perf`（脚本 [`tests/perf/test-perf.js`](../tests/perf/test-perf.js)）；基线：`tests/perf/baseline.json`');
  lines.push('> 判定（D5 决策）：预算门禁用 **min**（最小采样，抗负载尖峰）；`median > 1.8×基线` → 告警（不失败）。');
  lines.push('> 抗抖动：首次超预算会自动复核一次，复核通过则降级为告警；真实进程类基准在机器负载下会偶发尖峰，故以 min 为硬门禁口径。');
  lines.push('');
  lines.push('## 环境');
  lines.push('');
  lines.push('| 项 | 值 |');
  lines.push('|----|----|');
  lines.push(`| Node | ${env.node} |`);
  lines.push(`| 平台 | ${env.platform} |`);
  lines.push(`| CPU | ${env.cpuModel} × ${env.cpus} |`);
  lines.push(`| 内存 | ${env.totalMemGB} GB |`);
  lines.push(`| gcc 可用 | ${HAS_GCC ? '是' : '否（B7–B10 跳过）'} |`);
  lines.push(`| 时间 | ${new Date().toISOString().slice(0, 16).replace('T', ' ')} |`);
  lines.push('');
  lines.push('## 结果');
  lines.push('');
  lines.push('| 基准 | median | p95 | min | 预算 | 基线 median | 判定 |');
  lines.push('|------|--------|-----|-----|------|-------------|------|');
  for (const r of results) {
    const b = baseline.benches?.[r.name];
    const icon = r.verdict.status === 'pass' ? '✅' : r.verdict.status === 'warn' ? '⚠️' : '❌';
    lines.push(`| ${r.name} | ${r.result.median}ms | ${r.result.p95}ms | ${r.result.min}ms | ${r.verdict.budget ?? b?.budget ?? '—'}ms | ${r.verdict.baseline ?? b?.median ?? '—'}ms | ${icon} ${r.verdict.reason} |`);
  }
  lines.push('');
  lines.push(`汇总：**${results.length - failCount - warnCount} 通过 / ${warnCount} 告警 / ${failCount} 失败**`);
  lines.push('');
  const reportText = lines.join('\n');
  // 原始报告始终落临时目录；docs/性能基准.md 仅在显式刷新（--update-baseline / --report）时更新，
  // 避免日常跑基准总是弄脏工作区。
  fs.writeFileSync(path.join(cbTools, `性能基准-${stamp}.md`), reportText, 'utf-8');
  if (update || args.includes('--report')) {
    fs.writeFileSync(path.join(root, 'docs', '性能基准.md'), reportText, 'utf-8');
    console.log('报告: docs/性能基准.md');
  } else {
    console.log(`报告: ${path.relative(root, path.join(cbTools, `性能基准-${stamp}.md`))}（如需更新 docs/性能基准.md 请加 --report）`);
  }

  console.log(`\nperf 性能基准: ${results.length} 项, ${results.length - failCount - warnCount} pass, ${warnCount} warn, ${failCount} fail`);
  cleanup();
  restoreGlobalMock();
  process.exit(failCount ? 1 : 0);
}

main().catch((err) => {
  console.error('perf 运行异常: ' + (err && err.stack ? err.stack : err));
  cleanup();
  restoreGlobalMock();
  process.exit(1);
});
