// 并行任务数回归（codeblocks.parallelJobs）：
//  A. 有效值解析（resolveParallelJobs）：默认 8 / 显式值 / 0=自动 / 越界截断 / 非法值回退默认；
//  B. 「设置 → 实际并发」：stub child_process.spawn 记录并发峰值，验证默认 8、显式值、0=自动、1=串行。
// 说明：不依赖真实工具链（spawn 全部为假），因此可在任意 CI 机器上运行。
const Module = require('module');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

// ---- 假 spawn：编译命令（含 -c）按 COMPILE_DELAY_MS 延迟，统计并发峰值 ----
// 说明：引擎对编译/链接命令已改为「去 shell 直接派生」= spawn(program, args, opts)，
// 因此这里要把 program + args 拼回完整命令行再判定 -c/-o（与旧版 spawn(command, opts) 等价）。
const COMPILE_DELAY_MS = 80;
const probe = { active: 0, max: 0, compileSpawns: 0, commands: [] };
/** 模拟「直接派生 ENOENT」（PATH 上只有 gcc.cmd / Scoop shim 之类） */
let directEnoent = false;
let shellSpawns = 0;
function fakeSpawn(command, argsOrOpts) {
  const full = Array.isArray(argsOrOpts) ? `${command} ${argsOrOpts.join(' ')}` : String(command);
  const isCompile = /(^|\s)-c(\s|$)/.test(full);
  probe.commands.push(full);
  if (!Array.isArray(argsOrOpts)) shellSpawns++;
  if (directEnoent && Array.isArray(argsOrOpts)) {
    const failed = new EventEmitter();
    failed.stdout = new EventEmitter();
    failed.stderr = new EventEmitter();
    failed.pid = undefined;
    failed.kill = () => {};
    setImmediate(() => {
      failed.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
      // Node 在 spawn 失败后可能补发 close：引擎必须忽略（否则会提前判定失败/释放槽位）
      setImmediate(() => failed.emit('close', -1));
    });
    return failed;
  }
  if (isCompile) {
    probe.compileSpawns++;
    probe.active++;
    if (probe.active > probe.max) probe.max = probe.active;
  }
  const proc = new EventEmitter();
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.pid = 9000 + probe.compileSpawns;
  proc.kill = () => {};
  setTimeout(() => {
    if (isCompile) {
      probe.active--;
      // 每单元一行诊断输出（验证「每行只解析一次」：旧的 4 次解析路径会放大 4 倍正则开销）
      proc.stdout.emit('data', Buffer.from('u00.c:1:1: warning: unused variable\n'));
    }
    proc.emit('close', 0);
  }, isCompile ? COMPILE_DELAY_MS : 1);
  return proc;
}

// parallelJobs = undefined ⇒ 读设置默认值（模拟「未配置」）；configOverrides/configReads 供其它设置计数
let parallelJobs;
const configOverrides = {};
const configReads = {};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (k, d) => {
            configReads[k] = (configReads[k] || 0) + 1;
            if (k === 'parallelJobs') return parallelJobs === undefined ? d : parallelJobs;
            return k in configOverrides ? configOverrides[k] : d;
          },
        }),
      },
      window: { showWarningMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      Position: class { constructor(l, c) { this.line = l; this.character = c; } },
      Range: class { constructor(a, b, c, d) { this.start = [a, b]; this.end = [c, d]; } },
      Diagnostic: class { constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; } },
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      ConfigurationTarget: { Global: 1 },
      LogOutputChannel: class {},
      workspaceState: {},
      debug: { activeDebugSession: undefined },
    };
  }
  if (request === 'child_process') {
    const real = origLoad.apply(this, arguments);
    return Object.assign({}, real, { spawn: fakeSpawn });
  }
  return origLoad.apply(this, arguments);
};

const { ProjectParser } = require('../dist/model/parser.js');
const { BuildEngine, resolveParallelJobs, resolveJobBudget, processBudget, estimatePhysicalCores, DEFAULT_PARALLEL_JOBS, MAX_PARALLEL_JOBS } = require('../dist/build/buildEngine.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');

function makeProject(count) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-jobs-'));
  const units = [];
  for (let i = 0; i < count; i++) {
    const name = `u${String(i).padStart(2, '0')}.c`;
    fs.writeFileSync(path.join(dir, name), `int f${i}(void) { return ${i}; }\n`);
    units.push(`\t\t<Unit filename="${name}" />`);
  }
  fs.writeFileSync(path.join(dir, 'jobs.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="jobs" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/jobs" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
${units.join('\n')}
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  return dir;
}

async function buildWith(files, jobs, buildOptions, onEngine) {
  parallelJobs = jobs;
  probe.active = 0;
  probe.max = 0;
  probe.compileSpawns = 0;
  probe.commands = [];
  const dir = makeProject(files);
  const log = [];
  const out = {
    info: (s) => log.push(String(s)),
    warn: (s) => log.push(String(s)),
    error: (s) => log.push(String(s)),
    debug: () => {}, append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {},
  };
  const project = new ProjectParser().parse(path.join(dir, 'jobs.cbp'));
  const compiler = createGccCompiler('win32');
  const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
  if (onEngine) onEngine(engine);
  const ok = await engine.build('Debug', buildOptions ?? {});
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok, maxActive: probe.max, compileSpawns: probe.compileSpawns, log };
}

(async () => {
  // ---------- A. 有效值解析 ----------
  check('A0 DEFAULT_PARALLEL_JOBS = 8', DEFAULT_PARALLEL_JOBS === 8, DEFAULT_PARALLEL_JOBS);
  check('A1 未配置（undefined）→ 默认 8', resolveParallelJobs(undefined) === 8, resolveParallelJobs(undefined));
  check('A2 显式 12 → 12', resolveParallelJobs(12) === 12, resolveParallelJobs(12));
  check('A3 显式 1 → 串行', resolveParallelJobs(1) === 1, resolveParallelJobs(1));
  check('A4 0 → 自动 = min(逻辑核数 × 2, 32)（模拟 4 核 = 8）', resolveParallelJobs(0, 4) === 8, resolveParallelJobs(0, 4));
  check('A5 0 → 自动（模拟 20 核 = 32，受上限约束）', resolveParallelJobs(0, 20) === 32, resolveParallelJobs(0, 20));
  check('A6 旧版本遗留 64 → 截断为 32', resolveParallelJobs(64) === 32, resolveParallelJobs(64));
  check('A7 非法值（-1）→ 默认 8', resolveParallelJobs(-1) === 8, resolveParallelJobs(-1));
  check('A8 非法值（NaN）→ 默认 8', resolveParallelJobs(Number.NaN) === 8, resolveParallelJobs(Number.NaN));
  check('A9 小数 3.9 → 向下取整 3', resolveParallelJobs(3.9) === 3, resolveParallelJobs(3.9));
  check('A10 MAX_PARALLEL_JOBS = 32', MAX_PARALLEL_JOBS === 32, MAX_PARALLEL_JOBS);
  check('A11 null → 默认 8（不被当成 0 = 自动）', resolveParallelJobs(null) === 8, resolveParallelJobs(null));
  check('A12 数字字符串 "6" → 6', resolveParallelJobs('6') === 6, resolveParallelJobs('6'));
  check('A13 空字符串 → 默认 8', resolveParallelJobs('') === 8, resolveParallelJobs(''));

  // ---------- A2. 进程预算（processBudget / resolveJobBudget） ----------
  check('A14 进程预算不低于默认 8（模拟 2 核 → 8）', processBudget(2) === 8, processBudget(2));
  check('A15 进程预算 = 逻辑核数（模拟 16 核 → 16）', processBudget(16) === 16, processBudget(16));
  check('A16 默认 8 不受预算影响（模拟 16 核）', resolveJobBudget(undefined, 16) === 8, resolveJobBudget(undefined, 16));
  check('A17 0=自动 受预算收敛（模拟 16 核 → 16）', resolveJobBudget(0, 16) === 16, resolveJobBudget(0, 16));
  check('A18 0=自动 在低核机按核数自动（模拟 2 核 → 4，预算只是上限不是下限）', resolveJobBudget(0, 2) === 4, resolveJobBudget(0, 2));
  check('A19 显式 32 在高核机保留（模拟 64 核 → 32）', resolveJobBudget(32, 64) === 32, resolveJobBudget(32, 64));
  check('A20 显式 32 在低核机被收敛（模拟 4 核 → 8）', resolveJobBudget(32, 4) === 8, resolveJobBudget(32, 4));
  check('A21 显式 1 恒为串行（模拟 64 核）', resolveJobBudget(1, 64) === 1, resolveJobBudget(1, 64));

  // ---------- B. 设置 → 实际并发 ----------
  {
    const r = await buildWith(12, undefined); // 未配置 → 默认 8
    check('B1 未配置：构建成功', r.ok === true, r.ok);
    check('B1 未配置：并发峰值 = 8（默认值）', r.maxActive === 8, { maxActive: r.maxActive });
    check('B1 未配置：12 个单元各编译一次', r.compileSpawns === 12, r.compileSpawns);
  }
  {
    const r = await buildWith(10, 3);
    check('B2 显式 3：并发峰值 = 3', r.maxActive === 3, { maxActive: r.maxActive });
    check('B2 显式 3：10 个单元各编译一次', r.compileSpawns === 10, r.compileSpawns);
  }
  {
    const r = await buildWith(6, 1);
    check('B3 显式 1：串行（峰值 = 1）', r.maxActive === 1, { maxActive: r.maxActive });
  }
  {
    // 0 = 自动，但同时受「进程预算」（并发 ≤ max(默认 8, 逻辑核数)）收敛
    const cores = Math.max(1, os.cpus().length || 1);
    const budget = Math.max(DEFAULT_PARALLEL_JOBS, cores);
    const expectedAuto = Math.min(Math.min(cores * 2, MAX_PARALLEL_JOBS), budget);
    const units = expectedAuto + 8;
    const r = await buildWith(units, 0);
    check(`B4 显式 0：自动并发 = ${expectedAuto}（本机逻辑核 ${cores}，预算 ${budget}）`, r.maxActive === expectedAuto, {
      maxActive: r.maxActive, expectedAuto,
    });
  }
  {
    // 显式大值同样被进程预算收敛（32 只在核数 ≥32 的机器上才可能达到）
    const cores = Math.max(1, os.cpus().length || 1);
    const expected = Math.min(32, Math.max(DEFAULT_PARALLEL_JOBS, cores));
    const units = expected + 8;
    const r = await buildWith(units, 32);
    check(`B5 显式 32：按进程预算收敛到 ${expected}`, r.maxActive === expected, { maxActive: r.maxActive, expected });
  }

  // ---------- C. 每条输出只解析一次（CPU 收口回归） ----------
  {
    const lines = [];
    const diags = [];
    const structured = [];
    let parseCalls = 0;
    const r = await buildWith(3, 1, {
      onLine: (l, s) => lines.push([l, s]),
      onDiagnostic: (d) => diags.push(d),
      onStructuredDiagnostic: (d) => structured.push(d),
    }, (engine) => {
      // TS private 在运行时可直接访问：拦截解析器统计每行解析次数
      const p = engine.parser;
      const orig = p.parseLine.bind(p);
      p.parseLine = (l) => { parseCalls++; return orig(l); };
    });
    check('C1 构建成功（3 单元 / 每单元 1 行输出）', r.ok === true && r.compileSpawns === 3, { ok: r.ok, n: r.compileSpawns });
    check('C2 每行只解析一次：3 行 → 3 次 parseLine（旧实现为 4 次/行）', parseCalls === 3, parseCalls);
    check('C3 onLine 收到 3 行且 severity=warning', lines.length === 3 && lines.every((x) => x[1] === 'warning'), lines);
    check('C4 Problems 诊断仍发布 3 条', diags.length === 3, diags.length);
    check('C5 结构化诊断仍上报 3 条', structured.length === 3, structured.length);
  }

  // ---------- D. ccache 前缀：注入标准编译命令 + 每轮构建只读一次设置 ----------
  {
    const wrapper = path.join(os.tmpdir(), `cb-ccache-${process.pid}.exe`);
    fs.writeFileSync(wrapper, 'x');
    configOverrides['build.compilerCache'] = 'ccache';
    configOverrides['build.compilerCachePath'] = wrapper;
    for (const k of Object.keys(configReads)) delete configReads[k];
    const r = await buildWith(5, 1);
    const compileCmds = probe.commands.filter((c) => /(^|\s)-c(\s|$)/.test(c));
    check('D1 ccache 前缀注入每条标准编译命令', compileCmds.length === 5 && compileCmds.every((c) => c.includes(wrapper)), compileCmds);
    check('D2 链接等非编译命令不注入前缀',
      probe.commands.filter((c) => !/(^|\s)-c(\s|$)/.test(c)).some((c) => /(^|\s)-o(\s|$)/.test(c))
      && probe.commands.filter((c) => !/(^|\s)-c(\s|$)/.test(c)).every((c) => !c.includes(wrapper)), probe.commands);
    // 旧实现：每个编译单元 2 次 getConfiguration（kind + path）⇒ 5 单元 = 10 次
    check('D3 每单元不重复读设置（≤2 次：构建告警 + 生成器各一次）',
      (configReads['build.compilerCache'] || 0) <= 2 && (configReads['build.compilerCachePath'] || 0) <= 2, configReads);
    check('D4 ccache 启用时构建仍成功', r.ok === true, r.ok);
    delete configOverrides['build.compilerCache'];
    delete configOverrides['build.compilerCachePath'];
    fs.rmSync(wrapper, { force: true });
  }

    // ---------- E. 编译器子进程优先级（codeblocks.build.lowerCompilerPriority） ----------
  {
    check('E0 estimatePhysicalCores(8) = 4（超线程机型 4 物理核 / 8 逻辑核）',
      estimatePhysicalCores(8) === 4, estimatePhysicalCores(8));
    check('E1 estimatePhysicalCores(16) = 8', estimatePhysicalCores(16) === 8, estimatePhysicalCores(16));
    check('E2 estimatePhysicalCores(4) = 4（无超线程按原值）', estimatePhysicalCores(4) === 4, estimatePhysicalCores(4));
    check('E3 estimatePhysicalCores(2) = 2', estimatePhysicalCores(2) === 2, estimatePhysicalCores(2));
    check('E4 estimatePhysicalCores 下限 1', estimatePhysicalCores(1) === 1 && estimatePhysicalCores(0) === 1,
      [estimatePhysicalCores(1), estimatePhysicalCores(0)]);

    const PRIO = os.constants.priority.PRIORITY_BELOW_NORMAL;
    const calls = [];
    const origSetPriority = os.setPriority;
    os.setPriority = (pid, prio) => { calls.push([pid, prio]); };
    try {
      // 默认关闭（实测：降级会让 I/O 瓶颈型构建上的编译器饿死，反而更慢）
      const r1 = await buildWith(3, 2);
      check('E5 默认不降级（不调用 setPriority）', calls.length === 0 && r1.ok === true, calls.length);
      check('E6 不降级不影响构建结果', r1.ok === true, r1.ok);

      calls.length = 0;
      configOverrides['build.lowerCompilerPriority'] = true;
      const r2 = await buildWith(3, 2);
      check('E7 显式开启后每个子进程都降到 BELOW_NORMAL',
        calls.length === probe.commands.length && calls.length > 0 && calls.every((c) => c[1] === PRIO),
        { calls: calls.length, spawns: probe.commands.length });
      delete configOverrides['build.lowerCompilerPriority'];

      os.setPriority = () => { throw new Error('EPERM'); };
      const r3 = await buildWith(2, 1);
      check('E8 setPriority 抛错不影响构建（静默忽略）', r3.ok === true, r3.ok);
    } finally {
      os.setPriority = origSetPriority;
    }
  }

  // ---------- F. 直接派生失败 → 回退 shell 重试（Scoop shim / 只有 .cmd 的裸程序名） ----------
  {
    directEnoent = true;
    shellSpawns = 0;
    const r = await buildWith(2, 1);
    directEnoent = false;
    check('F1 直接派生 ENOENT 时回退 shell 重试并构建成功', r.ok === true, r.ok);
    check('F2 确实发生了 shell 回退派生', shellSpawns > 0, shellSpawns);
    check('F3 旧进程迟到的 close(-1) 未被误判为失败', r.log.filter((l) => /Failed to execute/.test(l)).length === 0, r.log);
  }

  console.log(`并行任务数回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
