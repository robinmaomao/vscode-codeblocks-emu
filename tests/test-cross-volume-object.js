// L11 回归：跨卷源文件对象路径（objOut + 卷名 + 去卷路径，projectfile.cpp:474-492）
// 本机双盘：C: 工程（临时）+ E: 源文件（工作区 test-project/main.c）
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
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

const srcAbs = path.join(process.cwd(), 'test-project', 'main.c'); // 本地 E: 卷
const srcVol = path.parse(srcAbs).root.replace(/[:\\/]/g, ''); // 'E'
// 跨卷语义要求「工程在 C: 卷、源文件在其它卷」；CI runner 只有 C: 卷（仓库与临时目录同卷），据实跳过
if (srcVol === 'C') {
  console.log(`SKIP cross-volume-object：前置不满足（仓库位于 C: 卷，无法构造跨卷场景）src=${srcAbs}`);
  process.exit(0);
}
check('前置：源文件在异卷（E:）', srcVol !== 'C', srcAbs);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l11-'));
fs.writeFileSync(path.join(dir, 'l11.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l11" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="${srcAbs.replace(/\\/g, '/')}" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const p = new ProjectParser().parse(path.join(dir, 'l11.cbp'));
const c = createGccCompiler('win32');
const log = [];
const out = {
  info: (s) => log.push(String(s)), warn: (s) => log.push(String(s)), error: (s) => log.push(String(s)),
  debug: () => {}, append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {},
};
const engine = new BuildEngine(p, c, out, (id) => (id === 'gcc' ? c : undefined));
const t = engine.collectMakefileData('Debug')[0];

// 期望相对路径：由**当前机器**的源文件路径推导（obj/<target>/<卷名>/<去卷路径>），不写死本机目录层级
const srcRel = path.relative(path.parse(srcAbs).root, srcAbs); // Work_Share\...\test-project\main.c
const expectedRel = path.join('obj', 'Debug', srcVol, path.dirname(srcRel), 'main.o');
const expectedObjAbs = path.join(dir, expectedRel);
// 引号规则：仅当路径含空白才加引号（与引擎一致）⇒ 无空格环境（如 CI runner）下同样可比
const qrel = (p) => (/\s/.test(p) ? `"${p}"` : p);

check('对象绝对路径在工程 obj 目录下（含卷名）', t.compile[0].object === expectedObjAbs, t.compile[0].object);
check(`编译命令 -o 为 obj\\Debug\\${srcVol}\\… 相对路径（含空格加引号）`, t.compile[0].command.includes(qrel(expectedRel)), t.compile[0].command);
check('链接对象相对路径在命令中', !!t.link && t.link.command.includes(qrel(expectedRel)), t.link && t.link.command);
check('链接对象绝对路径 = 工程 obj 目录下', !!t.link && t.link.objects.length === 1 && t.link.objects[0] === expectedObjAbs, t.link && t.link.objects);
check('对象路径无盘符拼接缺陷（无内嵌绝对路径）', !t.compile[0].object.includes(path.join(dir, srcAbs)), t.compile[0].object);

// ==== UNC：卷拆 server/share 两段（保护性修正：CB 因 AfterFirst 双重拼接会重复 server/share 段） ====
fs.writeFileSync(path.join(dir, 'unc.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="unc" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/uncapp" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="//server/share/src/f.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
const pu = new ProjectParser().parse(path.join(dir, 'unc.cbp'));
const eu = new BuildEngine(pu, c, out, (id) => (id === 'gcc' ? c : undefined));
const tu = eu.collectMakefileData('Debug')[0];
const uncObjRel = path.join('obj', 'Debug', 'server', 'share', 'src', 'f.o');
const uncObjAbs = path.join(dir, uncObjRel);
check('U1 UNC 对象绝对路径 = obj 目录下 server/share 两段', tu.compile[0].object === uncObjAbs, tu.compile[0].object);
check('U2 UNC 编译命令 -o 含 server/share 两段', tu.compile[0].command.includes(uncObjRel), tu.compile[0].command);
check('U3 UNC 链接对象绝对路径同规则', !!tu.link && tu.link.objects.length === 1 && tu.link.objects[0] === uncObjAbs, tu.link && tu.link.objects);

// ==== 端到端：真实构建（C: 工程 + E: 源）→ 编译/链接/增量/单文件 Clean ====
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(path.join(process.cwd(), '.cb-tools'), { recursive: true });
  const xvolDir = fs.mkdtempSync(path.join(process.cwd(), '.cb-tools', 'xvol-'));
  const xmain = path.join(xvolDir, 'xmain.c');
  fs.writeFileSync(xmain, 'int main(void) { return 0; }\n');
  const xmainUnix = xmain.replace(/\\/g, '/');
  const xvol = path.parse(xmain).root.replace(/[:\\/]/g, '');
  fs.writeFileSync(path.join(dir, 'xvol.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="xvol" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/xvol" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="${xmainUnix}" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');

  const p2 = new ProjectParser().parse(path.join(dir, 'xvol.cbp'));
  const e2 = new BuildEngine(p2, c, out, (id) => (id === 'gcc' ? c : undefined));
  const xvolRel = xvolDir.replace(/\\/g, '/').replace(/^[A-Za-z]:\//, '');
  const xobjRel = path.join('obj', 'Debug', xvol, xvolRel, 'xmain.o');
  const xobjAbs = path.join(dir, xobjRel);

  const r1 = await e2.build('Debug', {});
  check('E1 首次构建成功（编译跨卷源 + 链接）', r1 === true && log.some((l) => l.includes('[Compiled]') && l.includes('xmain.c')), { r1 });
  check('E2 跨卷对象在工程 obj 目录（含卷名）', fs.existsSync(xobjAbs), xobjAbs);
  check('E3 输出 exe 生成', fs.existsSync(path.join(dir, 'bin', 'Debug', 'xvol.exe')));
  await sleep(60);
  log.length = 0;
  const r2 = await e2.build('Debug', {});
  check('E4 无修改再构建 → Nothing to be done（跨卷增量正确）', r2 === true && log.some((l) => l.includes('Nothing to be done')), { r2 });
  e2.cleanFile('Debug', xmainUnix);
  check('E5 Clean 删除跨卷对象文件', !fs.existsSync(xobjAbs), xobjAbs);

  fs.rmSync(xvolDir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`cross-volume-object: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
