// 绝对路径 Unit 回归（F5b，对齐 cbProject::AddFile cbproject.cpp:880-904）：
// 同盘绝对路径 → 相对化（MakeRelativeTo）；跨盘/UNC → 保留绝对，absolutePath 不再 base+绝对 拼接。
const Module = require('module');
const origLoad = Module._load;
const settings = { parallelJobs: 1 };
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }) },
      window: { showWarningMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      Position: class { constructor(l, c) { this.line = l; this.character = c; } },
      Range: class { constructor(a, b) { this.start = a; this.end = b; } },
      Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
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
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hasNothing = (log) => log.some((l) => l.includes('Nothing to be done'));
const hasWarn = (log) => log.some((l) => l.includes("Can't read file's timestamp"));
const compiledNames = (log) => log.filter((l) => l.includes('[Compiled]')).map((l) => l.match(/\d+-\d+\s+(\S+)\s/)?.[1] ?? l);

function makeOutput() {
  const log = [];
  return {
    log,
    out: {
      info: (s) => log.push(String(s)), warn: (s) => log.push(String(s)), error: (s) => log.push(String(s)),
      debug: () => {}, append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {},
    },
    reset() { log.length = 0; },
  };
}

function makeCbp(dir, absFile, name) {
  // XML 属性值中的反斜杠无需转义，原样写入即可（真实 .cbp 亦然）
  const cbpName = name || 'abs.cbp';
  fs.writeFileSync(path.join(dir, cbpName), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="abs" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/abs" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="${absFile}" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  return path.join(dir, cbpName);
}

(async () => {
  // ==== A. 同盘绝对路径 → 相对化 + 正常编译链接（此前：伪 WARNING + 永不编译 + 链接失败） ====
  const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-abs-proj-'));
  const absDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-abs-file-'));
  const absC = path.join(absDir, 'absmain.c');
  fs.writeFileSync(absC, 'int main(void) { return 0; }\n');
  makeCbp(projDir, absC);
  const project = new ProjectParser().parse(path.join(projDir, 'abs.cbp'));
  const f = project.files[0];
  check('A1 同盘绝对路径相对化（relativeFilename 非绝对）', !path.isAbsolute(f.relativeFilename), f.relativeFilename);
  check('A2 absolutePath 为真实路径（exists）', fs.existsSync(f.absolutePath), f.absolutePath);
  check('A3 relativeToCommonTopLevelPath 相对化', !path.isAbsolute(f.relativeToCommonTopLevelPath), f.relativeToCommonTopLevelPath);

  const sink = makeOutput();
  const compiler = createGccCompiler('win32');
  const engine = new BuildEngine(project, compiler, sink.out, (id) => (id === 'gcc' ? compiler : undefined));
  const r1 = await engine.build('Debug', {});
  check('A4 首次构建成功（编译 absmain.c + 链接）', r1 === true && compiledNames(sink.log).some((n) => n.includes('absmain.c')),
    { r1, compiled: compiledNames(sink.log) });
  await sleep(60);
  sink.reset();
  const r2 = await engine.build('Debug', {});
  check('A5 二次构建 Nothing to be done（无伪 WARNING、无强制重链）', r2 === true && hasNothing(sink.log) && !hasWarn(sink.log),
    { r2, log: sink.log.filter((l) => l.includes('Nothing') || l.includes("Can't read")) });

  // ==== B. 跨盘绝对路径（解析层，无盘可用 Z: 模拟）→ 保留绝对，absolutePath 不拼接 base ====
  const proj2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-abs2-'));
  const cbpB = makeCbp(proj2, 'Z:/share/ext.c', 'b.cbp');
  const p2 = new ProjectParser().parse(cbpB);
  const f2 = p2.files[0];
  check('B1 跨盘相对化保留绝对 relativeFilename', path.isAbsolute(f2.relativeFilename), f2.relativeFilename);
  check('B2 跨盘 absolutePath = 原路径（无 base 拼接）', f2.absolutePath === 'Z:/share/ext.c', f2.absolutePath);

  // ==== C. UNC 绝对路径 → 保留绝对 ====
  // 真实 .cbp 中 UNC 写作 <Unit filename="\\server\share\ext.c"/>（2 个反斜杠）
  const cbpC = makeCbp(proj2, '\\\\server\\share\\ext.c', 'c.cbp');
  const p3 = new ProjectParser().parse(cbpC);
  const f3 = p3.files[0];
  check('C1 UNC 保留绝对 relativeFilename', path.isAbsolute(f3.relativeFilename), f3.relativeFilename);
  check('C2 UNC absolutePath = 原路径（无 base 拼接）', f3.absolutePath === '//server/share/ext.c', f3.absolutePath);

  console.log(`绝对路径 Unit 回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
