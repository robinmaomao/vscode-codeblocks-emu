// L5 回归：编译器 logging 开关解析（对齐 compiler.cpp:943-952；default → undefined 交由扩展设置）
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
const { CompilerOptionsLoader } = require('../dist/compiler/optionsLoader.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

// 临时资源目录：显式 full / none / default 三种
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l5t-'));
const write = (id, value) => fs.writeFileSync(path.join(dir, `options_${id}.xml`), `<?xml version="1.0"?>
<CodeBlocks_compiler_options>
    <Program name="C" value="gcc.exe"/>
    <Program name="CPP" value="g++.exe"/>
    <Switch name="logging" value="${value}"/>
</CodeBlocks_compiler_options>
`, 'utf-8');
write('fullx', 'full');
write('nonex', 'none');
write('defx', 'default');
const loader = new CompilerOptionsLoader(dir);

check('logging=full → full', loader.load('fullx').switches.logging === 'full', loader.load('fullx').switches.logging);
check('logging=none → none', loader.load('nonex').switches.logging === 'none', loader.load('nonex').switches.logging);
check('logging=default → undefined（扩展设置控制）', loader.load('defx').switches.logging === undefined, loader.load('defx').switches.logging);

// 真实资源：options_gcc.xml 声明 value="default" → undefined（保护性不强制 CB 的 clogFull 默认）
const real = new CompilerOptionsLoader(path.join(process.cwd(), 'resources', 'compilers'));
check('options_gcc.xml(default) → undefined', real.load('gcc').switches.logging === undefined, real.load('gcc').switches.logging);
check('avr/msp430 显式 default → undefined', real.load('avr-gcc').switches.logging === undefined, real.load('avr-gcc').switches.logging);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`logging-switch: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
