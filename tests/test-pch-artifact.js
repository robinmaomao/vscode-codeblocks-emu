// PCH 旧产物删除时机回归（0.8.135）：
//  - 命令收集 / Makefile 导出（collectMakefileData）**不得**删除 .gch（无文件系统副作用）
//  - 真正派发编译（compileFile/build）前才删除旧 .gch（与旧 `cmd /c if exist … del …` 语义一致）
//  - 删除失败不阻塞编译
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
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const { ProjectParser } = require('../dist/model/parser.js');
const { BuildEngine } = require('../dist/build/buildEngine.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const out = { info(){}, warn(){}, error(){}, debug(){}, append(){}, clear(){}, show(){}, hide(){}, dispose(){} };

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pch-art-'));
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
  const gch = path.join(dir, 'obj', 'Debug', 'include', 'guard.h.gch');
  fs.writeFileSync(gch, 'STALE');
  const project = new ProjectParser().parse(cbpPath);
  const compiler = createGccCompiler('win32');
  compiler.versionString = '8.1.0';
  return { dir, project, compiler, gch };
}

/** 假 spawn：记录命令并异步以退出码 0 结束（覆盖编译 + 链接） */
function installFakeSpawn() {
  const calls = [];
  const orig = childProcess.spawn;
  childProcess.spawn = function (program, argsOrOpts) {
    calls.push(Array.isArray(argsOrOpts) ? `${program} ${argsOrOpts.join(' ')}` : String(program));
    const proc = new EventEmitter();
    proc.pid = 999999;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => {};
    setImmediate(() => proc.emit('close', 0));
    return proc;
  };
  return { calls, restore: () => { childProcess.spawn = orig; } };
}

(async () => {
  // ---- A. 收集阶段无副作用 ----
  {
    const { dir, project, compiler, gch } = makeProject();
    const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
    const data = engine.collectMakefileData('Debug');
    check('A1 collectMakefileData 返回编译单元', data.length === 1 && data[0].compile.length >= 1, data.length);
    check('A2 收集命令不得删除旧 .gch（导出 Makefile / 查看命令无副作用）', fs.existsSync(gch), fs.existsSync(gch));
    check('A3 收集阶段的命令里不含 `del`/`if exist`（删除不再拼进命令行）',
      !data[0].compile.some((c) => /\bdel\b|if exist/i.test(c.command)), data[0].compile.map((c) => c.command));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- B. 真正派发前删除 ----
  {
    const { dir, project, compiler, gch } = makeProject();
    const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
    const fake = installFakeSpawn();
    let ok = false;
    try {
      ok = await engine.compileFile('Debug', 'include/guard.h', { rebuild: true });
    } finally {
      fake.restore();
    }
    check('B1 compileFile 成功', ok === true, ok);
    check('B2 派发前删除了旧 .gch', !fs.existsSync(gch), fs.existsSync(gch));
    check('B3 确实派生了编译命令', fake.calls.length >= 1, fake.calls);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---- C. 删除失败不阻塞编译（文件被占用时 rmSync 抛错） ----
  {
    const { dir, project, compiler, gch } = makeProject();
    const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
    const fake = installFakeSpawn();
    const origRm = fs.rmSync;
    fs.rmSync = (p, o) => {
      if (String(p) === gch) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
      return origRm(p, o);
    };
    let ok = false;
    try {
      ok = await engine.compileFile('Debug', 'include/guard.h', { rebuild: true });
    } finally {
      fs.rmSync = origRm;
      fake.restore();
    }
    check('C1 旧 .gch 删除失败不影响编译结果', ok === true, ok);
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log(`PCH 产物删除时机回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
