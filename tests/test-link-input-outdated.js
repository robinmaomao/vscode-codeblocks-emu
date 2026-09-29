// 链接输入新鲜度回归（第七十三轮，保护性增强）：工程内 .ld 等非编译文件改动 → 重链接/重新打包
// 覆盖：默认白名单生效（早退分支 + 链接块路径）、非白名单不触发、设置 [] 关闭、恢复默认、
//       external_deps 回归（B5）、静态库目标重新打包、无改动仍 Nothing to be done
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
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeOutput() {
  let log = [];
  return {
    log,
    out: {
      info: (s) => log.push(String(s)), warn: (s) => log.push(String(s)), error: (s) => log.push(String(s)),
      debug: () => {}, append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {},
    },
    reset() { log = this.log = []; },
  };
}

function makeEngine(project, sink) {
  const compiler = createGccCompiler('win32');
  return new BuildEngine(project, compiler, sink.out, (id) => (id === 'gcc' ? compiler : undefined));
}

const compiledNames = (log) => log.filter((l) => l.includes('[Compiled]')).map((l) => l.match(/\d+-\d+\s+(\S+)\s/)?.[1] ?? l);
const hasNothing = (log) => log.some((l) => l.includes('Nothing to be done'));
const hasLinked = (log) => log.some((l) => l.includes('Linking'));
const hasRelinkMsg = (log) => log.some((l) => /Re-linking because|重新链接/.test(l));
const hasRearkMsg = (log) => log.some((l) => /Re-archiving because|重新打包/.test(l));
const hasArchived = (log) => log.some((l) => l.includes('[Archived]'));

// ---------- 可执行目标工程 ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-li-exe-'));
fs.writeFileSync(path.join(dir, 'main.c'), 'int asm_helper(void);\nint main(void) { return asm_helper(); }\n');
fs.writeFileSync(path.join(dir, 'start.S'), '#include "defs.h"\n    .text\n    .globl asm_helper\nasm_helper:\n    movl $VALUE, %eax\n    ret\n');
fs.writeFileSync(path.join(dir, 'defs.h'), '#define VALUE 42\n');
fs.writeFileSync(path.join(dir, 'ram.ld'), '/* linker script placeholder */\n');
fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a build input\n');
fs.writeFileSync(path.join(dir, 'app.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="li" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/li" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Unit filename="start.S" />
\t\t<Unit filename="ram.ld" />
\t\t<Unit filename="notes.txt" />
\t\t<Unit filename="defs.h" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(path.join(dir, 'app.cbp'));
const sink = makeOutput();
const engine = makeEngine(project, sink);

async function build() {
  sink.reset();
  const ok = await engine.build('Debug', {});
  return { ok, log: sink.log };
}

// ---------- 静态库目标工程 ----------
const libDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-li-lib-'));
fs.writeFileSync(path.join(libDir, 'lib.c'), 'int lib_value(void) { return 7; }\n');
fs.writeFileSync(path.join(libDir, 'ram.ld'), '/* linker script placeholder */\n');
fs.writeFileSync(path.join(libDir, 'mylib.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="mylib" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/mylib" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="2" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="lib.c" />
\t\t<Unit filename="ram.ld" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const libProject = new ProjectParser().parse(path.join(libDir, 'mylib.cbp'));
const libSink = makeOutput();
const libEngine = makeEngine(libProject, libSink);

async function libBuild() {
  libSink.reset();
  const ok = await libEngine.build('Debug', {});
  return { ok, log: libSink.log };
}

// ---------- 用户工程原样（compile=1 + 自定义空命令）→ CB 条目计数强制（directcommands.cpp:585） ----------
const uDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-li-custom-'));
fs.writeFileSync(path.join(uDir, 'main.c'), 'int main(void) { return 0; }\n');
fs.writeFileSync(path.join(uDir, 'ram.ld'), '/* linker script placeholder */\n');
fs.writeFileSync(path.join(uDir, 'custom.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="custom" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/custom" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Unit filename="ram.ld">
\t\t\t<Option compile="1" />
\t\t\t<Option compiler="gcc" use="1" buildCommand=" " />
\t\t</Unit>
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const uProject = new ProjectParser().parse(path.join(uDir, 'custom.cbp'));
const uSink = makeOutput();
const uEngine = makeEngine(uProject, uSink);
const hasStaleForce = (log) => log.some((l) => /强制链接|Forcing link|强制重新打包|Forcing archive/.test(l));

async function uBuild() {
  uSink.reset();
  const ok = await uEngine.build('Debug', {});
  return { ok, log: uSink.log };
}

(async () => {
  // C1 首次构建
  const c1 = await build();
  check('C1 首次构建：编译 main.c + start.S 并链接',
    c1.ok && compiledNames(c1.log).includes('main.c') && compiledNames(c1.log).includes('start.S') && hasLinked(c1.log),
    { ok: c1.ok, compiled: compiledNames(c1.log), linked: hasLinked(c1.log) });

  // C2 改 ram.ld（编译单元为空 → 早退分支路径）
  await sleep(30);
  fs.appendFileSync(path.join(dir, 'ram.ld'), '/* touch1 */\n');
  const c2 = await build();
  check('C2 改 ram.ld（早退分支）→ 重链接 + Re-linking 日志 + 不重编译',
    c2.ok && hasLinked(c2.log) && hasRelinkMsg(c2.log) && compiledNames(c2.log).length === 0 && !hasNothing(c2.log),
    { linked: hasLinked(c2.log), relinkMsg: hasRelinkMsg(c2.log), compiled: compiledNames(c2.log) });

  // C3 同时改 start.S + ram.ld（链接块路径）
  await sleep(30);
  fs.appendFileSync(path.join(dir, 'start.S'), '/* touch2 */\n');
  fs.appendFileSync(path.join(dir, 'ram.ld'), '/* touch3 */\n');
  const c3 = await build();
  check('C3 改 start.S + ram.ld → 编译 start.S 且重链接',
    c3.ok && compiledNames(c3.log).includes('start.S') && hasLinked(c3.log) && hasRelinkMsg(c3.log),
    { compiled: compiledNames(c3.log), linked: hasLinked(c3.log) });

  // C4 无改动 → Nothing to be done
  const c4 = await build();
  check('C4 无改动 → Nothing to be done（无回归）', c4.ok && hasNothing(c4.log), { linked: hasLinked(c4.log) });

  // C5 非白名单文件（notes.txt）改动 → 不触发
  await sleep(30);
  fs.appendFileSync(path.join(dir, 'notes.txt'), 'more text\n');
  const c5 = await build();
  check('C5 非白名单 notes.txt 改动 → Nothing to be done', c5.ok && hasNothing(c5.log), { linked: hasLinked(c5.log) });

  // C6 设置 linkInputExtensions=[] → 改 ram.ld 不触发（增强关闭）
  settings['build.linkInputExtensions'] = [];
  await sleep(30);
  fs.appendFileSync(path.join(dir, 'ram.ld'), '/* touch4 */\n');
  const c6 = await build();
  check('C6 设置 [] 关闭 → 改 ram.ld 仍 Nothing to be done',
    c6.ok && hasNothing(c6.log) && !hasRelinkMsg(c6.log), { linked: hasLinked(c6.log) });

  // C7 恢复默认设置 → 改 ram.ld 再次触发
  delete settings['build.linkInputExtensions'];
  await sleep(30);
  fs.appendFileSync(path.join(dir, 'ram.ld'), '/* touch5 */\n');
  const c7 = await build();
  check('C7 恢复默认 → 改 ram.ld 再次重链接', c7.ok && hasLinked(c7.log) && hasRelinkMsg(c7.log), { linked: hasLinked(c7.log) });

  // C8 external_deps 回归（原 B5 场景）
  project.buildTargets[0].externalDeps = ['ram.ld'];
  await sleep(30);
  fs.appendFileSync(path.join(dir, 'ram.ld'), '/* touch6 */\n');
  const c8 = await build();
  check('C8 external_deps 回归 → 改 ram.ld 重链接', c8.ok && hasLinked(c8.log), { linked: hasLinked(c8.log) });

  // C9 静态库目标：改 ram.ld → 重新打包
  const c9a = await libBuild();
  check('C9a 静态库首次构建 → 打包 [Archived]', c9a.ok && hasArchived(c9a.log), { log: c9a.log.filter((l) => l.includes('Archived') || l.includes('Nothing')) });
  await sleep(30);
  fs.appendFileSync(path.join(libDir, 'ram.ld'), '/* lib touch1 */\n');
  const c9b = await libBuild();
  check('C9b 静态库改 ram.ld → 重新打包 + Re-archiving 日志',
    c9b.ok && hasArchived(c9b.log) && hasRearkMsg(c9b.log), { archived: hasArchived(c9b.log), msg: hasRearkMsg(c9b.log) });

  // C10 静态库无改动 → Nothing to be done
  const c10 = await libBuild();
  check('C10 静态库无改动 → Nothing to be done', c10.ok && hasNothing(c10.log), { log: c10.log.filter((l) => l.includes('Nothing') || l.includes('Archived')) });

  // ==== 用户工程原样：compile=1 + 自定义空命令 → CB 条目计数强制（对象永不产生，每次构建都重链接） ====
  const c11 = await uBuild();
  check('C11 用户工程原样首次构建 → 链接', c11.ok && hasLinked(c11.log), { linked: hasLinked(c11.log) });
  await sleep(30);
  const c12 = await uBuild();
  check('C12 无任何修改再构建 → 仍重链接 + 强制日志（CB 条目计数）',
    c12.ok && hasLinked(c12.log) && hasStaleForce(c12.log) && !hasNothing(c12.log),
    { linked: hasLinked(c12.log), force: hasStaleForce(c12.log), nothing: hasNothing(c12.log) });
  await sleep(30);
  fs.appendFileSync(path.join(uDir, 'ram.ld'), '/* custom touch */\n');
  const c13 = await uBuild();
  check('C13 改 ram.ld → 仍重链接（CB 语义：每次构建都重链）',
    c13.ok && hasLinked(c13.log) && hasStaleForce(c13.log), { linked: hasLinked(c13.log) });
  // 去掉自定义命令（compile=1 不可编译）→ CB 产生 "Skipping file" 条目，同样强制
  uProject.buildTargets[0].files.find((f) => f.relativeFilename === 'ram.ld').customBuildCommands = {};
  const c14 = await uBuild();
  check('C14 无自定义命令（compile=1 不可编译）→ 仍强制重链接（Skipping 条目对齐）',
    c14.ok && hasLinked(c14.log) && hasStaleForce(c14.log), { linked: hasLinked(c14.log) });
  // 静态库目标：条目计数强制 → 无修改也重新打包
  const libLd = libProject.buildTargets[0].files.find((f) => f.relativeFilename === 'ram.ld');
  libLd.compile = true;
  libLd.customBuildCommands = { gcc: { command: ' ', use: true } };
  const c15 = await libBuild();
  check('C15 静态库 compile=1 自定义空命令 → 无修改也重新打包（CB 条目计数）',
    c15.ok && hasArchived(c15.log) && hasStaleForce(c15.log), { archived: hasArchived(c15.log) });

  console.log(`链接输入新鲜度回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
