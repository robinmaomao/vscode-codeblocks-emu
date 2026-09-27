// L18 回归：Clean 对「编译器存在但 masterPath 无效」的目标仍删除对象（对齐 GetTargetCleanCommands）
// 编译器未注册（nullptr）时才跳过对象删除。
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

const out = { info(){}, warn(){}, error(){}, debug(){}, append(){}, clear(){}, show(){}, hide(){}, dispose(){} };

// A) masterPath 无效但编译器已注册：仍删除对象（L18 对齐）
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l18a-'));
  fs.writeFileSync(path.join(dir, 'l18.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l18" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  fs.mkdirSync(path.join(dir, 'obj', 'Debug'), { recursive: true });
  const objAbs = path.join(dir, 'obj', 'Debug', 'main.o');
  fs.writeFileSync(objAbs, 'dummy');
  const p = new ProjectParser().parse(path.join(dir, 'l18.cbp'));
  const c = createGccCompiler('win32');
  c.masterPath = 'Z:\\no-such-toolchain';
  const engine = new BuildEngine(p, c, out, (id) => (id === 'gcc' ? c : undefined));
  engine.cleanTarget(p.buildTargets[0]);
  check('A: masterPath 无效仍删除对象（L18）', !fs.existsSync(objAbs), objAbs);
  fs.rmSync(dir, { recursive: true, force: true });
}

// B) 编译器未注册：跳过对象删除（CB compiler==nullptr 语义）
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l18b-'));
  fs.writeFileSync(path.join(dir, 'l18.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="l18" />
\t\t<Option compiler="unknown-cc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="unknown-cc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  fs.mkdirSync(path.join(dir, 'obj', 'Debug'), { recursive: true });
  const objAbs = path.join(dir, 'obj', 'Debug', 'main.o');
  fs.writeFileSync(objAbs, 'dummy');
  const p = new ProjectParser().parse(path.join(dir, 'l18.cbp'));
  const engine = new BuildEngine(p, createGccCompiler('win32'), out, () => undefined); // 未注册
  engine.cleanTarget(p.buildTargets[0]);
  check('B: 编译器未注册跳过对象删除', fs.existsSync(objAbs), objAbs);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`clean-invalid-compiler: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
