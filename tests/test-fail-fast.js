// L2 回归：编译失败「失败即停」（对齐 CB OnJobEnd 清队列，compilergcc.cpp:4005-4017）
// 真实 gcc + 扩展 dist 引擎直跑（stub vscode，parallelJobs 可注入）：
//   A) 串行、首文件失败 → 后续同 weight 单元不派发；
//   B) 跨 weight 组：前组成功、中组失败 → 后组不派发；
//   C) 全部成功 → 计数/链接不受影响（回归）。
const Module = require('module');
const origLoad = Module._load;
let parallelJobs = 1;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k === 'parallelJobs' ? parallelJobs : d) }) },
      window: { showWarningMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      Position: class { constructor(l, c) { this.line = l; this.character = c; } },
      Range: class { constructor(a, b) { this.start = a; this.end = b; } },
      Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      ConfigurationTarget: { Global: 1 },
      LogOutputChannel: class {},
      workspaceState: {},
      debug: { activeDebugSession: undefined },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { BuildEngine } = require('../dist/build/buildEngine.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

function makeProject(files, weights) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ff-'));
  const entries = Object.entries(files);
  const unitXml = entries.map(([f]) => {
    if (weights && weights[f] !== undefined) {
      return `\t\t<Unit filename="${f}">\n\t\t\t<Option weight="${weights[f]}" />\n\t\t</Unit>`;
    }
    return `\t\t<Unit filename="${f}" />`;
  }).join('\n');
  fs.writeFileSync(path.join(dir, 'ff.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="ff" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/ff" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
${unitXml}
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  for (const [name, content] of entries) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

async function buildFixture(files, weights, jobs) {
  parallelJobs = jobs;
  const dir = makeProject(files, weights);
  const log = [];
  const out = {
    info: (s) => log.push(String(s)),
    warn: (s) => log.push(String(s)),
    error: (s) => log.push(String(s)),
    debug: () => {},
    append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {},
  };
  const project = new ProjectParser().parse(path.join(dir, 'ff.cbp'));
  const compiler = createGccCompiler('win32');
  const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
  const ok = await engine.build('Debug', {});
  const stats = engine.lastStats;
  fs.rmSync(dir, { recursive: true, force: true });
  return { ok, stats, log };
}

const compiledNames = (log) => log
  .filter((l) => l.includes('[Compiled]'))
  .map((l) => l.match(/\d+-\d+\s+(\S+)\s/)?.[1] ?? l);
const failedNames = (log) => log
  .filter((l) => l.includes('[Failed]'))
  .map((l) => l.match(/\d+-\d+\s+(\S+)\s/)?.[1] ?? l);

(async () => {
  // A) 串行、首文件失败：后续同 weight 单元不派发
  {
    const r = await buildFixture({
      'bad.c': 'int bad( { return 0; }\n',
      'middle.c': 'int middle(void) { return 1; }\n',
      'zeta.c': 'int zeta(void) { return 2; }\n',
    }, {}, 1);
    check('A: build 返回 false', r.ok === false, r.ok);
    check('A: bad.c 失败', failedNames(r.log).includes('bad.c'), failedNames(r.log));
    check('A: middle.c 未编译', !compiledNames(r.log).includes('middle.c'), compiledNames(r.log));
    check('A: zeta.c 未编译', !compiledNames(r.log).includes('zeta.c'), compiledNames(r.log));
    check('A: 统计 failedCount=1 compiledCount=0', r.stats.failedCount === 1 && r.stats.compiledCount === 0, r.stats);
    check('A: 未派发提示含 2', r.log.some((l) => l.includes('2') && l.includes('未派发')), null);
    check('A: 未尝试链接', !r.log.some((l) => l.includes('Linking') || l.includes('[Linked]')), null);
  }

  // B) 跨 weight 组：前组成功、中组失败 → 后组不派发
  {
    const r = await buildFixture({
      'good.c': 'int good(void) { return 0; }\n',
      'bad.c': 'int bad( { return 1; }\n',
      'tail.c': 'int tail(void) { return 2; }\n',
    }, { 'good.c': 10, 'bad.c': 20, 'tail.c': 30 }, 1);
    check('B: good.c 编译（1-3）', compiledNames(r.log).includes('good.c'), compiledNames(r.log));
    check('B: bad.c 失败（2-3）', failedNames(r.log).includes('bad.c'), failedNames(r.log));
    check('B: tail.c 未编译（跨组停止）', !compiledNames(r.log).includes('tail.c'), compiledNames(r.log));
    check('B: 统计 failedCount=1 compiledCount=1', r.stats.failedCount === 1 && r.stats.compiledCount === 1, r.stats);
  }

  // C) 全部成功：计数/链接回归
  {
    const r = await buildFixture({
      'main.c': 'int util(void); int extra(void); int main(void){ return util() + extra(); }\n',
      'util.c': 'int util(void) { return 1; }\n',
      'extra.c': 'int extra(void) { return 0; }\n',
    }, {}, 1);
    check('C: build 返回 true', r.ok === true, r.ok);
    check('C: 全部编译成功', r.stats.compiledCount === 3 && r.stats.failedCount === 0, r.stats);
    check('C: 链接成功', r.stats.linkSuccess === true && r.stats.success === true, r.stats);
  }

  console.log(`fail-fast: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
