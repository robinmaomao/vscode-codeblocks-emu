// L1 回归：PCH 头文件 include 前置（-iquote/-I/-I.）对齐 CompilerMINGWGenerator::SetupIncludeDirs
// 纯逻辑断言：pch_mode=1 + compile=1 头文件时，其它源文件的编译命令应前置
//   -iquote<对象目录> -I<对象目录> -I.（gcc>=4）；gcc<4 用 -I<dir> -I- -I<dir> -I.
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
      window: { showWarningMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
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

// 生成一个 pch 工程（pchMode 可变），返回 collectMakefileData 里 main.cpp 的命令
function mainCommand(pchMode, opts = {}) {
  const { version, flat, supportsPch } = { version: '8.1.0', flat: false, supportsPch: true, ...opts };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pchq-'));
  const cbpPath = path.join(dir, 'pch.cbp');
  const pchAttr = pchMode === 1 ? '' : ` pch_mode="${pchMode}"`;
  fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="pch"${pchAttr} />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/pch" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.cpp" />
\t\t<Unit filename="include/guard.h">
\t\t\t<Option compile="1" />
\t\t</Unit>
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  fs.mkdirSync(path.join(dir, 'include'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'obj', 'Debug', 'include'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'bin', 'Debug'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.cpp'), '#include "guard.h"\nint main(){return 0;}\n');
  fs.writeFileSync(path.join(dir, 'include', 'guard.h'), '#ifndef G\n#define G\n#endif\n');

  const project = new ProjectParser().parse(cbpPath);
  const compiler = createGccCompiler('win32');
  compiler.versionString = version;
  if (!supportsPch) compiler.switches.supportsPCH = false;
  if (flat) compiler.switches.useFlatObjects = true;
  const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
  const data = engine.collectMakefileData('Debug');
  const t = data[0];
  const cmd = (t.compile.find((c) => c.source.endsWith('main.cpp')) || {}).command || '';
  fs.rmSync(dir, { recursive: true, force: true });
  return cmd;
}

// 1. pch_mode=1（默认）+ gcc 8.1：前置 -iquote + -I + -I.
{
  const cmd = mainCommand(1);
  check('pch_mode=1：含 -iquoteobj/Debug/include', cmd.includes('-iquoteobj/Debug/include'), cmd);
  check('pch_mode=1：含 -Iobj/Debug/include', cmd.includes('-Iobj/Debug/include'), cmd);
  check('pch_mode=1：末尾含 -I. ', /-I\. /.test(cmd), cmd);
  // 前置顺序：-iquote 先于 -I，且都在 -c 之前
  const iq = cmd.indexOf('-iquote');
  const iI = cmd.indexOf('-Iobj/Debug/include');
  const iDot = cmd.indexOf('-I. ');
  const iC = cmd.indexOf(' -c ');
  check('pch_mode=1：-iquote < -I < -I. < -c 顺序', iq >= 0 && iq < iI && iI < iDot && iDot < iC, cmd);
}

// 2. pch_mode=0（pchSourceDir）：不前置
{
  const cmd = mainCommand(0);
  check('pch_mode=0：不含 -iquote', !cmd.includes('-iquote'), cmd);
  check('pch_mode=0：不含 -I. ', !/-I\. /.test(cmd), cmd);
}

// 3. pch_mode=2（pchSourceFile）：不前置
{
  const cmd = mainCommand(2);
  check('pch_mode=2：不含 -iquote', !cmd.includes('-iquote'), cmd);
}

// 4. gcc<4：用 -I <dir> + -I- + -I <dir> + -I.
{
  const cmd = mainCommand(1, { version: '3.4.5' });
  check('gcc<4：含 -I- ', cmd.includes('-I- '), cmd);
  check('gcc<4：不含 -iquote', !cmd.includes('-iquote'), cmd);
  check('gcc<4：含 -Iobj/Debug/include', cmd.includes('-Iobj/Debug/include'), cmd);
  check('gcc<4：末尾含 -I. ', /-I\. /.test(cmd), cmd);
}

// 5. 无 versionString：默认按 gcc>=4 → -iquote
{
  const cmd = mainCommand(1, { version: undefined });
  check('无版本：默认 -iquote', cmd.includes('-iquoteobj/Debug/include'), cmd);
}

// 6. supportsPCH=false：不前置
{
  const cmd = mainCommand(1, { supportsPch: false });
  check('supportsPCH=false：不含 -iquote', !cmd.includes('-iquote'), cmd);
}

// 7. UseFlatObjects：目录取扁平对象目录（obj/Debug），不含源层级
{
  const cmd = mainCommand(1, { flat: true });
  check('flat：含 -iquoteobj/Debug ', cmd.includes('-iquoteobj/Debug '), cmd);
  check('flat：不含 obj/Debug/include', !cmd.includes('obj/Debug/include'), cmd);
}

// 8. 无 compile=1 头文件：不前置（header 默认 compile=false）
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pchq2-'));
  const cbpPath = path.join(dir, 'pch.cbp');
  fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="pch" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/pch" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.cpp" />
\t\t<Unit filename="include/guard.h" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  fs.mkdirSync(path.join(dir, 'include'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'obj', 'Debug'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'main.cpp'), '#include "guard.h"\nint main(){return 0;}\n');
  fs.writeFileSync(path.join(dir, 'include', 'guard.h'), '#ifndef G\n#define G\n#endif\n');
  const project = new ProjectParser().parse(cbpPath);
  const compiler = createGccCompiler('win32');
  compiler.versionString = '8.1.0';
  const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
  const t = engine.collectMakefileData('Debug')[0];
  const cmd = (t.compile.find((c) => c.source.endsWith('main.cpp')) || {}).command || '';
  check('无 compile 头文件：不含 -iquote', !cmd.includes('-iquote'), cmd);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`pch-quote: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
