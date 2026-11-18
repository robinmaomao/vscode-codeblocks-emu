// Additional CB compiler resources: TCC, BCC, DMC, ARM ELF, PowerPC EABI.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CompilerOptionsLoader } = require('../dist/compiler/optionsLoader.js');
const { detectTcc, detectBcc, detectDmc, detectArmElf, detectPowerpcEabi, detectOw, detectGfortran, detectDmd, detectGdc, detectAllCompilers } = require('../dist/compiler/detector.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const resDir = path.join(process.cwd(), 'resources', 'compilers');
const loader = new CompilerOptionsLoader(resDir);
for (const [id, c] of [['tcc', 'tcc.exe'], ['bcc', 'bcc32.exe'], ['dmc', 'dmc.exe'], ['arm-elf-gcc', 'arm-elf-gcc.exe'], ['powerpc-eabi', 'powerpc-eabi-gcc.exe']]) {
  const file = path.join(resDir, `options_${id}.xml`);
  check(`${id}: options XML exists`, fs.existsSync(file), file, 'exists');
  const compiler = loader.load(id);
  check(`${id}: C program`, compiler.programs.C === c, compiler.programs.C, c);
  check(`${id}: command templates`, compiler.commands.some((cmd) => Array.isArray(cmd) && cmd.length), compiler.commands.length, '>0');
  check(`${id}: switches`, !!compiler.switches.includeDirs, compiler.switches.includeDirs, '-I');
  check(`${id}: metadata name`, compiler.name !== id || loader.metadataFor(id) === null, compiler.name, 'display name');
}

check('tcc: metadata display name', loader.load('tcc').name === 'Tiny C Compiler', loader.load('tcc').name, 'Tiny C Compiler');
check('tcc: metadata master paths', (loader.metadataFor('tcc')?.masterPaths ?? []).length > 0, loader.metadataFor('tcc'), 'paths');
check('tcc: C-only project has no CPP', loader.load('tcc').programs.CPP === '', loader.load('tcc').programs.CPP, '');
check('bcc: object extension obj', loader.load('bcc').switches.objectExtension === 'obj', loader.load('bcc').switches.objectExtension, 'obj');
check('dmc: object extension obj', loader.load('dmc').switches.objectExtension === 'obj', loader.load('dmc').switches.objectExtension, 'obj');
check('compiler_tcc.xml exists', fs.existsSync(path.join(resDir, 'compiler_tcc.xml')));
check('compiler_bcc.xml exists', fs.existsSync(path.join(resDir, 'compiler_bcc.xml')));
check('compiler_dmc.xml exists', fs.existsSync(path.join(resDir, 'compiler_dmc.xml')));
check('compiler_powerpc-eabi.xml exists', fs.existsSync(path.join(resDir, 'compiler_powerpc-eabi.xml')));

const optionsFiles = fs.readdirSync(resDir).filter((f) => /^options_.*\.xml$/.test(f) && !/^options_common/.test(f));
const badOptions = [];
for (const file of optionsFiles) {
  const id = file.replace(/^options_|\.xml$/g, '');
  try {
    const compiler = loader.load(id);
    if (!compiler.programs.C && !compiler.programs.CPP) badOptions.push(`${id}:no-program`);
    if (!compiler.commands.length) badOptions.push(`${id}:no-commands`);
  } catch (err) {
    badOptions.push(`${id}:${err.message}`);
  }
}
check('all compiler options load', badOptions.length === 0, badOptions, []);

const metadataFiles = fs.readdirSync(resDir).filter((f) => /^compiler_.*\.xml$/.test(f));
const badMetadata = metadataFiles.filter((f) => {
  const id = f.replace(/^compiler_|\.xml$/g, '');
  const meta = loader.metadataFor(id);
  return !meta || !meta.name || meta.name === id;
});
check('all compiler metadata has a display name', badMetadata.length === 0, badMetadata, []);

const oldPath = process.env.PATH;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-more-compilers-'));
try {
  const exe = (name) => path.join(dir, process.platform === 'win32' ? name + '.exe' : name);
  // TCC fallback directory contains the executable directly (not bin/).
  fs.writeFileSync(exe('tcc'), '');
  fs.writeFileSync(exe('wcl386'), '');
  fs.writeFileSync(exe('mingw32-gfortran'), '');
  fs.writeFileSync(exe('gfortran'), '');
  fs.writeFileSync(exe('dmd'), '');
  fs.writeFileSync(exe('gdc'), '');
  process.env.PATH = dir + (process.platform === 'win32' ? ';' : ':') + (oldPath ?? '');
  const tcc = detectTcc();
  check('detectTcc: PATH hit', !!tcc && tcc.id === 'tcc' && tcc.masterPath === dir, tcc);
  fs.writeFileSync(path.join(dir, process.platform === 'win32' ? 'arm-elf-gcc.exe' : 'arm-elf-gcc'), '');
  fs.writeFileSync(path.join(dir, process.platform === 'win32' ? 'powerpc-eabi-gcc.exe' : 'powerpc-eabi-gcc'), '');
  process.env.PATH = dir + (process.platform === 'win32' ? ';' : ':') + (oldPath ?? '');
  check('detectArmElf: PATH hit', detectArmElf()?.id === 'arm-elf-gcc', detectArmElf());
  check('detectPowerpcEabi: PATH hit', detectPowerpcEabi()?.id === 'powerpc-eabi', detectPowerpcEabi());
  check('detectOw: PATH hit', detectOw()?.id === 'ow', detectOw());
  check('detectGfortran: PATH hit', detectGfortran()?.id === 'gfortran', detectGfortran());
  check('detectDmd: PATH hit', detectDmd()?.id === 'dmd', detectDmd());
  check('detectGdc: PATH hit', detectGdc()?.id === 'gdc', detectGdc());
  if (process.platform === 'win32') {
    fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'bin', 'bcc32.exe'), '');
    fs.writeFileSync(path.join(dir, 'bin', 'dmc.exe'), '');
    process.env.PATH = dir + ';' + path.join(dir, 'bin') + ';' + (oldPath ?? '');
    check('detectBcc: PATH hit', detectBcc()?.id === 'bcc', detectBcc());
    check('detectDmc: PATH hit', detectDmc()?.id === 'dmc', detectDmc());
  }
  const list = detectAllCompilers('');
  check('detectAll includes new probes', Array.isArray(list) && list.some((c) => c.id === 'tcc'), list);
} finally {
  process.env.PATH = oldPath;
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('more-compilers: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
