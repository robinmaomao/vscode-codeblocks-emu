// L3 回归：AVR/MSP430/SDCC 编译器资源（options_*.xml 加载 + 探测接入）
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
const { detectAvr, detectMsp430, detectSdcc, detectAllCompilers } = require('../dist/compiler/detector.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const resDir = path.join(process.cwd(), 'resources', 'compilers');

// 1. 资源存在
check('options_avr-gcc.xml 存在', fs.existsSync(path.join(resDir, 'options_avr-gcc.xml')));
check('options_msp430-gcc.xml 存在', fs.existsSync(path.join(resDir, 'options_msp430-gcc.xml')));
check('options_sdcc.xml 存在', fs.existsSync(path.join(resDir, 'options_sdcc.xml')));
check('compiler_avr-gcc.xml 存在', fs.existsSync(path.join(resDir, 'compiler_avr-gcc.xml')));

// 2. 加载：程序名 / 命令模板 / 开关
const loader = new CompilerOptionsLoader(resDir);
const avr = loader.load('avr-gcc');
check('avr-gcc: C=avr-gcc.exe', avr.programs.C === 'avr-gcc.exe', avr.programs.C);
check('avr-gcc: 命令模板齐全', avr.commands.some((a) => Array.isArray(a) && a.length), avr.commands.length);
check('avr-gcc: includeDirs=-I', avr.switches.includeDirs === '-I', avr.switches.includeDirs);
check('avr-gcc: supportsPCH=false（CB 同）', avr.switches.supportsPCH === false, avr.switches.supportsPCH);
check('msp430-gcc: C=msp430-gcc.exe', loader.load('msp430-gcc').programs.C === 'msp430-gcc.exe');
check('sdcc: C=sdcc.exe', loader.load('sdcc').programs.C === 'sdcc.exe');

// 3. 探测：PATH 注入假工具链
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-avrdet-'));
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin', 'avr-gcc.exe'), '');
  const oldPath = process.env.PATH;
  process.env.PATH = path.join(dir, 'bin') + ';' + (oldPath ?? '');
  const found = detectAvr();
  process.env.PATH = oldPath;
  check('detectAvr：PATH 命中 avr-gcc', !!found && found.id === 'avr-gcc' && found.cCompilerPath.endsWith('avr-gcc.exe'), found);
  check('detectAvr：masterPath = bin 上一级', !!found && found.masterPath === dir, found && found.masterPath);
  fs.rmSync(dir, { recursive: true, force: true });
}

// 4. 全量探测包含新编译器探测（真实环境：无 AVR 工具链时返回 null 不报错）
{
  let list;
  try {
    list = detectAllCompilers(''); // 本机无 avr/msp430/sdcc，应正常返回不抛错
  } catch (e) {
    list = { error: String(e) };
  }
  check('detectAllCompilers 含新探测不抛错', Array.isArray(list), list);
  if (Array.isArray(list)) {
    const ids = new Set(list.map((c) => c.id));
    check('全量探测仍含 gcc', ids.has('gcc'), [...ids]);
  }
}

console.log(`avr-compiler: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
