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

const srcAbs = path.join(process.cwd(), 'test-project', 'main.c'); // E: 卷
const srcVol = path.parse(srcAbs).root.replace(/[:\\/]/g, ''); // 'E'
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
const out = { info(){}, warn(){}, error(){}, debug(){}, append(){}, clear(){}, show(){}, hide(){}, dispose(){} };
const engine = new BuildEngine(p, c, out, (id) => (id === 'gcc' ? c : undefined));
const t = engine.collectMakefileData('Debug')[0];

const expectedRel = path.join('obj', 'Debug', srcVol, 'Work_Share', 'VSCode Workstation', 'codeblocks-power-by-vscode', 'test-project', 'main.o');
const expectedObjAbs = path.join(dir, expectedRel);

check('对象绝对路径在工程 obj 目录下（含卷名）', t.compile[0].object === expectedObjAbs, t.compile[0].object);
check('编译命令 -o 为 obj\Debug\E\… 相对路径（含空格加引号）', t.compile[0].command.includes(`"${expectedRel}"`), t.compile[0].command);
check('链接对象相对路径在命令中', !!t.link && t.link.command.includes(`"${expectedRel}"`), t.link && t.link.command);
check('链接对象绝对路径 = 工程 obj 目录下', !!t.link && t.link.objects.length === 1 && t.link.objects[0] === expectedObjAbs, t.link && t.link.objects);
check('对象路径无盘符拼接缺陷（无内嵌绝对路径）', !t.compile[0].object.includes(path.join(dir, srcAbs)), t.compile[0].object);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`cross-volume-object: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
