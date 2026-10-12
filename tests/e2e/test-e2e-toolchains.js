// L3 工具链矩阵：编译器家族 × 真实调用
//
// 口径（与 docs/测试方案.md 一致）：
//  1. **清单**：扩展随包 `resources/compilers/options_<id>.xml` 即「支持的编译器家族」台账（静态核对）。
//  2. **探测**：PATH（where.exe）→ CB_TOOLCHAIN_ROOT（分号分隔）→ `.cb-tools/toolchains/**/bin`（本地解包，
//     gitignored；见 docs/测试方案.md「工具链安装」）。探测不到即 SKIP，并在末尾打印安装指引，绝不静默通过。
//  3. **实跑**：
//     · 原生工具链 → 全量构建（编译+链接）并**运行产物**校验输出；
//     · 交叉工具链 → 单文件编译为对象/目标文件，并按 ELF 魔数与 `e_machine` 校验体系结构（证明真的交叉了）；
//     · AVR / RISC-V 交叉工具链进一步做**链接级**（全量构建 → `.elf`）：校验 ELF 头 `e_machine`、入口地址语义
//       与 `.text` 段（工具链自带 `objdump -h`），并验证 `objcopy -O ihex` 可转烧写形态（S9）。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./harness');

const T = { pass: 0, fail: 0, skip: 0 };
function check(name, cond, actual, expected) {
  if (cond) { T.pass++; console.log(`  OK   ${name}`); return true; }
  T.fail++;
  console.log(`  FAIL ${name}\n       实际: ${String(actual).slice(0, 200)}\n       期望: ${String(expected).slice(0, 200)}`);
  return false;
}
function skip(name, reason) { T.skip++; console.log(`  SKIP ${name}（${reason}）`); }

/** ELF 头解析：返回 { magic, machine, entry, is64 } ；非 ELF 返回 undefined */
function readElf(file) {
  if (!fs.existsSync(file)) return undefined;
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) return undefined;
  // e_entry：ELF32/ELF64 均为文件偏移 0x18（32 位 4 字节 / 64 位 8 字节）；本矩阵的 AVR/RISC-V 目标均为小端
  const is64 = buf[4] === 2;
  const entry = is64 ? Number(buf.readBigUInt64LE(0x18)) : buf.readUInt32LE(0x18);
  return { magic: 'ELF', machine: buf.readUInt16LE(18), entry, is64 };
}
const ELF_MACHINE = { 62: 'x86-64', 83: 'AVR', 243: 'RISC-V', 105: 'MSP430', 3: 'i386', 40: 'ARM' };

const PROBE_C = `#include <stdio.h>
int main(void) { int a = 2, b = 3; printf("probe: sum=%d\\n", a + b); return 0; }
`;
const PROBE_C_FREESTANDING = `/* 交叉目标：不依赖 libc，仅验证编译器后端 + 命令行生成 */
int cb_probe_add(int a, int b) { return a + b; }
int cb_probe_global = 42;
`;
const PROBE_C_LINKMAIN = `/* 链接级探针：为交叉 CRT/crt0 提供 main（不依赖 stdio，避免引入 libc 变数） */
int cb_probe_link_value = 7;
int main(void) { return cb_probe_link_value == 7 ? 0 : 1; }
`;

/** 解析 `objdump -h` 段表（返回 { 段名: { size, vma } }，十六进制已转十进制；形如 `  1 .text  000000ac  00000000 …`） */
function parseObjdumpSections(stdout) {
  const out = {};
  for (const line of String(stdout).split(/\r?\n/)) {
    const m = /^\s*\d+\s+(\S+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+/.exec(line);
    if (m) out[m[1]] = { size: parseInt(m[2], 16), vma: parseInt(m[3], 16) };
  }
  return out;
}

/**
 * 生成单文件探针工程（可选：附加工程/编译/链接选项；files 指定参与构建的单元；output 指定目标输出名）
 */
function probeProject(name, extraProjectOptions = [], extraTargetOptions = [], extraLinkerOptions = [], files = ['main.c', 'cross.c'], output = name) {
  const dir = H.mkTemp(`cb-e2e-tc-${name}-`);
  H.writeFile(path.join(dir, 'main.c'), PROBE_C);
  H.writeFile(path.join(dir, 'cross.c'), PROBE_C_FREESTANDING);
  H.writeFile(path.join(dir, 'linkmain.c'), PROBE_C_LINKMAIN);
  const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="${name}" />
\t\t<Option compiler="gcc" />
${extraProjectOptions.map((o) => `\t\t<Option ${o} />`).join('\n')}
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option output="bin/Debug/${output}" />
\t\t\t\t<Option object_output="obj/Debug/" />
${extraTargetOptions.length ? `\t\t\t\t<Compiler>${extraTargetOptions.map((o) => `<Add option="${o}" />`).join('')}</Compiler>` : ''}
${extraLinkerOptions.length ? `\t\t\t\t<Linker>${extraLinkerOptions.map((o) => `<Add option="${o}" />`).join('')}</Linker>` : ''}
\t\t\t</Target>
\t\t</Build>
${files.map((f) => `\t\t<Unit filename="${f}" />`).join('\n')}
\t</Project>
</CodeBlocks_project_file>
`;
  H.writeFile(path.join(dir, `${name}.cbp`), cbp);
  return { dir, cbp: path.join(dir, `${name}.cbp`) };
}

/**
 * 全量构建 + 运行产物
 * @param output 目标输出名（默认 = name）：gcc 家族无扩展名输出会被 MinGW 追加 `.exe`；显式 `.exe`
 *        输出（如 TCC 的 `-o` 不补扩展名）则按原名落盘——两种形态都按工具链真实语义断言。
 */
async function buildAndRun(name, tool, programs, expectStdout, options = [], linkerOptions = [], output = name) {
  const exeName = /\.exe$/i.test(output) ? output : `${output}.exe`;
  const { dir, cbp } = probeProject(name, [], options, linkerOptions, ['main.c', 'cross.c'], output);
  const ctx = H.openProject(cbp, { programs });
  const res = await H.build(ctx, 'Debug');
  const exe = path.join(dir, 'bin', 'Debug', exeName);
  const built = check(`${name.toUpperCase()} 构建成功（${path.basename(tool)}）`, res.ok && fs.existsSync(exe), res.ok ? `产物缺失: ${exe}` : res.lines.slice(-3).map((l) => l.line).join(' | '), '产物存在且构建成功');
  if (!built) return;
  const run = spawnSync(exe, [], { encoding: 'utf-8', windowsHide: true, timeout: 20000 });
  check(`${name.toUpperCase()} 产物可运行且输出正确`, (run.stdout || '').includes(expectStdout), `exit=${run.status} out=${(run.stdout || '').trim()} err=${(run.stderr || '').trim()}`, expectStdout);
}

/** clang 编译后端清单（`--print-targets`）：官方 Windows 构建未含 avr/msp430 后端，需按清单跳过 */
function clangTargets(clang) {
  const r = spawnSync(clang, ['--print-targets'], { encoding: 'utf-8', windowsHide: true });
  return (r.stdout || '').toLowerCase();
}

/** 单文件编译到目标文件 + ELF 体系结构校验（cross） */
async function compileOnlyAndCheckElf(name, tool, programs, expectedMachine, options = []) {
  const { dir, cbp } = probeProject(name, [], options);
  const ctx = H.openProject(cbp, { programs });
  const res = await H.compileFile(ctx, 'Debug', 'cross.c');
  const objDir = path.join(dir, 'obj', 'Debug');
  const candidates = fs.existsSync(objDir) ? fs.readdirSync(objDir).filter((f) => f.startsWith('cross.')) : [];
  const obj = candidates.length ? path.join(objDir, candidates[0]) : '';
  if (!check(`${name.toUpperCase()} 交叉编译生成目标文件（${path.basename(tool)}）`, !!obj && fs.existsSync(obj), `目录内容: ${fs.existsSync(objDir) ? fs.readdirSync(objDir).join(',') : '(无 obj 目录)'} | ${res.commands.join(' ').slice(0, 160)}`, 'obj/Debug/cross.*')) return;
  const elf = readElf(obj);
  const head = obj && fs.existsSync(obj) ? `${fs.statSync(obj).size}B ${fs.readFileSync(obj).subarray(0, 4).toString('hex')}` : '(缺失)';
  const cmdLine = (res.lines || []).flatMap((l) => String(l.line).split(/\r?\n/)).filter((l) => /\s-[a-zA-Z]/.test(l)).slice(0, 2).join(' ;; ');
  if (!check(`${name.toUpperCase()} 产物为 ELF`, !!elf, elf ? elf.magic : `非 ELF（${head}）| ${cmdLine.slice(0, 240)}`, 'ELF 魔数')) return;
  check(`${name.toUpperCase()} 体系结构正确（e_machine=${expectedMachine}）`, elf.machine === expectedMachine,
    `e_machine=${elf.machine} (${ELF_MACHINE[elf.machine] || '未知'})`, `e_machine=${expectedMachine} (${ELF_MACHINE[expectedMachine]})`);
}

/**
 * 链接级（交叉工具链从对象级升级）：真实走扩展构建引擎做**全量构建（编译+链接）**产出 `.elf`，断言：
 *  ① `.elf` 存在且构建成功；② ELF 魔数；③ ELF 头 `e_machine`；
 *  ④ 入口地址语义（AVR 复位向量固定在地址 0，本机实测 e_entry=0x0；RISC-V 必须非 0）；
 *  ⑤ 入口地址落在 `.text` 段可执行区间 [VMA, VMA+Size)；⑥ 工具链自带 `objdump -h` 显示 `.text` 存在且非空；
 *  ⑦ 工具链自带 `objcopy -O ihex` 可把 `.elf` 转为 Intel HEX（嵌入式烧写形态）。
 * 链接步骤统一用 gcc 驱动作为 linker（自动带 CRT/运行时，等价 Code::Blocks AVR 模板的 avr-g++ 链接形态）。
 */
async function buildLinkAndCheckElf(desc) {
  const { name, programs, machine, options = [], linkerOptions = [], expectEntryZero, objdump, objcopy } = desc;
  const output = `${name}.elf`;
  const { dir, cbp } = probeProject(name, [], options, linkerOptions, ['linkmain.c'], output);
  const ctx = H.openProject(cbp, { programs });
  const res = await H.build(ctx, 'Debug');
  const elfPath = path.join(dir, 'bin', 'Debug', output);
  if (!check(`${name.toUpperCase()} 链接产物存在（.elf，全量构建）`, res.ok && fs.existsSync(elfPath), res.ok ? `产物缺失: ${elfPath}` : res.lines.slice(-3).map((l) => l.line).join(' | '), `${output} 存在且构建成功`)) return;
  const elf = readElf(elfPath);
  if (!check(`${name.toUpperCase()} 链接产物为 ELF`, !!elf, elf ? elf.magic : `非 ELF（${fs.statSync(elfPath).size}B）`, 'ELF 魔数')) return;
  check(`${name.toUpperCase()} 链接产物体系结构正确（e_machine=${machine}）`, elf.machine === machine,
    `e_machine=${elf.machine} (${ELF_MACHINE[elf.machine] || '未知'})`, `e_machine=${machine} (${ELF_MACHINE[machine]})`);
  check(`${name.toUpperCase()} 链接产物入口地址语义正确（${expectEntryZero ? 'AVR 复位向量 = 0x0' : 'e_entry ≠ 0'}）`,
    expectEntryZero ? elf.entry === 0 : elf.entry !== 0,
    `e_entry=0x${elf.entry.toString(16)}`, expectEntryZero ? 'e_entry=0x0（复位向量固定在地址 0）' : 'e_entry ≠ 0');
  if (!objdump) {
    skip(`${name.toUpperCase()} 链接产物 .text 段校验`, '未找到该工具链自带 objdump');
    return;
  }
  const dump = spawnSync(objdump, ['-h', elfPath], { encoding: 'utf-8', windowsHide: true });
  const sec = parseObjdumpSections(dump.stdout)['.text'];
  check(`${name.toUpperCase()} 链接产物 .text 段存在且非空（objdump -h）`, !!sec && sec.size > 0,
    sec ? `.text size=0x${sec.size.toString(16)}` : `objdump 输出无 .text（exit=${dump.status}）`, '.text size > 0');
  const range = sec ? `[0x${sec.vma.toString(16)},0x${(sec.vma + sec.size).toString(16)})` : '(无 .text)';
  check(`${name.toUpperCase()} 入口地址落在 .text 可执行区间`, !!sec && elf.entry >= sec.vma && elf.entry < sec.vma + sec.size,
    `e_entry=0x${elf.entry.toString(16)} .text=${range}`, 'e_entry 落在 .text 区间');
  if (!objcopy) {
    skip(`${name.toUpperCase()} 链接产物转 Intel HEX`, '未找到该工具链自带 objcopy');
    return;
  }
  const hexPath = path.join(dir, 'bin', 'Debug', `${name}.hex`);
  const conv = spawnSync(objcopy, ['-O', 'ihex', elfPath, hexPath], { encoding: 'utf-8', windowsHide: true });
  const hexOk = conv.status === 0 && fs.existsSync(hexPath) && fs.statSync(hexPath).size > 0 && fs.readFileSync(hexPath, 'utf-8').trimStart().startsWith(':');
  check(`${name.toUpperCase()} 链接产物可转 Intel HEX（objcopy -O ihex）`, hexOk,
    `exit=${conv.status} ${fs.existsSync(hexPath) ? fs.statSync(hexPath).size + 'B' : '(无 .hex)'}`, '生成以 ":" 记录开头的非空 .hex');
}

(async () => {
  const MODULES = H.boot();

  // ---------- S1 家族台账 ----------
  const compDir = path.join(H.root, 'resources', 'compilers');
  const families = fs.readdirSync(compDir).filter((f) => /^options_.+\.xml$/.test(f)).map((f) => f.replace(/^options_|\.xml$/g, ''));
  check('S1 编译器家族台账（随包 options_*.xml ≥ 15）', families.length >= 15, families.length, '>= 15');
  for (const id of ['gcc', 'clang', 'avr-gcc', 'msp430-gcc', 'sdcc']) {
    check(`S1 家族包含 ${id}`, families.includes(id), families.join(',').slice(0, 120), id);
  }
  check('S1 公共选项组齐备（common_warnings/common_codegen/common_optimization）',
    ['common_warnings', 'common_codegen', 'common_optimization'].every((id) => families.includes(id)), families.filter((f) => f.startsWith('common_')).join(','), '公共组存在');
  console.log(`  · 已支持家族(${families.length}): ${families.join(', ')}`);

  // ---------- 工具链探测 ----------
  const gcc = H.findExecutable('gcc');
  const gxx = H.findExecutable('g++');
  const ar = H.findExecutable('ar');
  const clang = H.findExecutable('clang');
  const clangxx = H.findExecutable('clang++');
  const llvmAr = H.findExecutable('llvm-ar') || ar;
  const avrGcc = H.findExecutable('avr-gcc');
  const avrAr = H.findExecutable('avr-ar');
  const avrLd = H.findExecutable('avr-ld');
  const riscvGcc = H.findExecutable('riscv-none-elf-gcc') || H.findExecutable('riscv64-unknown-elf-gcc') || H.findExecutable('riscv-none-embed-gcc');
  const riscvAr = H.findExecutable('riscv-none-elf-ar') || H.findExecutable('riscv64-unknown-elf-ar');
  const riscvLd = H.findExecutable('riscv-none-elf-ld') || H.findExecutable('riscv64-unknown-elf-ld');
  const msp430Gcc = H.findExecutable('msp430-gcc');
  const tcc = H.findExecutable('tcc');
  const sdcc = H.findExecutable('sdcc');
  const mingwPrefix = H.findExecutable('x86_64-w64-mingw32-gcc');
  const mingwAr = H.findExecutable('x86_64-w64-mingw32-ar');

  const inventory = [
    ['gcc（原生）', gcc], ['g++（原生）', gxx], ['MinGW 三元前缀 gcc', mingwPrefix], ['clang/LLVM', clang],
    ['AVR GCC', avrGcc], ['RISC-V GCC', riscvGcc], ['MSP430 GCC', msp430Gcc], ['SDCC', sdcc], ['TCC', tcc],
  ];
  console.log('\n[工具链探测]');
  for (const [label, p] of inventory) console.log(`  · ${label}: ${p || '(未安装)'}`);

  // ---------- S2 原生 gcc 全链路（对照基线） ----------
  console.log('\n[S2 原生 gcc 构建 + 运行]');
  if (gcc && gxx && ar) {
    await buildAndRun('tc-gcc', gcc, { C: gcc, CPP: gxx, LD: gxx, LIB: ar }, 'probe: sum=5');
  } else {
    skip('S2 原生 gcc', 'gcc/g++/ar 不可用');
  }

  // ---------- S3 MinGW 三元前缀工具链（Code::Blocks 常见交叉命名形态） ----------
  console.log('\n[S3 MinGW 三元前缀 gcc（x86_64-w64-mingw32-*）]');
  if (mingwPrefix) {
    await buildAndRun('tc-mingwtriple', mingwPrefix, { C: mingwPrefix, CPP: H.findExecutable('x86_64-w64-mingw32-g++') || mingwPrefix, LD: H.findExecutable('x86_64-w64-mingw32-g++') || mingwPrefix, LIB: mingwAr || ar }, 'probe: sum=5');
  } else {
    skip('S3 MinGW 三元前缀 gcc', '未找到 x86_64-w64-mingw32-gcc');
  }

  // ---------- S4 clang 原生（family=clang，options_clang.xml + MinGW 目标 ABI） ----------
  console.log('\n[S4 clang 构建 + 运行]');
  if (clang && clangxx) {
    // 官方 LLVM Windows 构建不带 C 运行时：编译与**链接**都指定 `--target=x86_64-w64-mingw32`
    // 以复用本机 MinGW 头文件/库（否则默认 msvc 目标会去找并不存在的 MSVC 运行库）
    await buildAndRun('tc-clang', clang, { C: clang, CPP: clangxx, LD: clangxx, LIB: llvmAr }, 'probe: sum=5',
      ['--target=x86_64-w64-mingw32'], ['--target=x86_64-w64-mingw32']);
  } else {
    skip('S4 clang 原生', '未找到 clang/clang++（见文末安装指引）');
  }

  // ---------- S5 clang 交叉目标（同一驱动，多体系结构后端） ----------
  console.log('\n[S5 clang 交叉目标（--target，无 libc 对象级）]');
  if (clang) {
    const targets = clangTargets(clang);
    const CROSS = [
      ['clang-riscv', 'riscv64-unknown-elf', 'riscv64', 243],
      ['clang-avr', 'avr-unknown-unknown', 'avr', 83],
      ['clang-msp430', 'msp430-unknown-unknown', 'msp430', 105],
    ];
    for (const [name, target, arch, machine] of CROSS) {
      if (!targets.includes(arch)) {
        skip(`S5 ${name}`, `本机 clang 未编译 ${arch} 后端（--print-targets 未列出）`);
        continue;
      }
      await compileOnlyAndCheckElf(name, clang, { C: clang, CPP: clangxx || clang, LD: clang, LIB: llvmAr }, machine, [`--target=${target}`, '-ffreestanding']);
    }
  } else {
    skip('S5 clang 交叉目标', '未找到 clang');
  }

  // ---------- S6 AVR GCC（真实交叉工具链） ----------
  console.log('\n[S6 AVR GCC 交叉编译]');
  if (avrGcc) {
    await compileOnlyAndCheckElf('tc-avr', avrGcc, { C: avrGcc, CPP: H.findExecutable('avr-g++') || avrGcc, LD: avrLd || avrGcc, LIB: avrAr || ar }, 83, ['-mmcu=atmega328p']);
  } else {
    skip('S6 AVR GCC', '未找到 avr-gcc（见文末安装指引）');
  }

  // ---------- S7 RISC-V GCC（真实交叉工具链） ----------
  console.log('\n[S7 RISC-V GCC 交叉编译]');
  if (riscvGcc) {
    await compileOnlyAndCheckElf('tc-riscv', riscvGcc, { C: riscvGcc, CPP: H.findExecutable('riscv-none-elf-g++') || riscvGcc, LD: riscvLd || riscvGcc, LIB: riscvAr || ar }, 243);
  } else {
    skip('S7 RISC-V GCC', '未找到 riscv-none-elf-gcc / riscv64-unknown-elf-gcc（见文末安装指引）');
  }

  // ---------- S8 MSP430 / SDCC / TCC（按安装情况） ----------
  console.log('\n[S8 MSP430 / SDCC / TCC]');
  if (msp430Gcc) {
    await compileOnlyAndCheckElf('tc-msp430', msp430Gcc, { C: msp430Gcc, CPP: msp430Gcc, LD: H.findExecutable('msp430-ld') || msp430Gcc, LIB: H.findExecutable('msp430-ar') || ar }, 105, ['-mmcu=msp430g2553']);
  } else {
    skip('S8 MSP430 GCC', '未找到 msp430-gcc（TI 官方包需登录/交互式下载，未纳入自动安装；如需覆盖请解包到 .cb-tools/toolchains/msp430）');
  }
  if (sdcc) {
    const { dir, cbp } = probeProject('tc-sdcc');
    const ctx = H.openProject(cbp, { programs: { C: sdcc, CPP: sdcc, LD: sdcc, LIB: sdcc } });
    const res = await H.compileFile(ctx, 'Debug', 'cross.c');
    const objDir = path.join(dir, 'obj', 'Debug');
    const produced = fs.existsSync(objDir) ? fs.readdirSync(objDir) : [];
    check('S8 SDCC 交叉编译（MCS51）', res.ok && produced.some((f) => /\.(rel|ihx|o)$/i.test(f)), produced.join(',') || res.commands.join(' ').slice(0, 160), '生成 .rel/.ihx/.o');
  } else {
    skip('S8 SDCC', '未找到 sdcc');
  }
  if (tcc) {
    // TCC 链接 `-o` 不补 `.exe`（与 MinGW 不同，实测产物为无扩展名文件，Windows 无法直接启动）→ 显式 `.exe` 输出
    await buildAndRun('tc-tcc', tcc, { C: tcc, CPP: tcc, LD: tcc, LIB: ar }, 'probe: sum=5', [], [], 'tc-tcc.exe');
  } else {
    skip('S8 TCC', '未找到 tcc（官方发布区见文末安装指引）');
  }

  // ---------- S9 AVR / RISC-V 链接级（全量构建 → .elf + 入口地址 + .text） ----------
  console.log('\n[S9 AVR / RISC-V 链接级产物（.elf）]');
  const avrObjdump = H.findExecutable('avr-objdump');
  const avrObjcopy = H.findExecutable('avr-objcopy');
  const riscvObjdump = H.findExecutable('riscv-none-elf-objdump') || H.findExecutable('riscv64-unknown-elf-objdump');
  const riscvObjcopy = H.findExecutable('riscv-none-elf-objcopy') || H.findExecutable('riscv64-unknown-elf-objcopy');
  if (avrGcc) {
    // 链接用 gcc 驱动（自动带 crt0/avr-libc，等价 Code::Blocks AVR 模板 linker=avr-g++）；入口语义按本机实测：e_entry=0x0（复位向量）
    await buildLinkAndCheckElf({
      name: 'tc-avr-link',
      programs: { C: avrGcc, CPP: H.findExecutable('avr-g++') || avrGcc, LD: avrGcc, LIB: avrAr || ar },
      machine: 83, options: ['-mmcu=atmega328p'], linkerOptions: ['-mmcu=atmega328p'],
      expectEntryZero: true, objdump: avrObjdump, objcopy: avrObjcopy,
    });
  } else {
    skip('S9 AVR 链接级', '未找到 avr-gcc（见文末安装指引）');
  }
  if (riscvGcc) {
    // 链接用 gcc 驱动（自动带 CRT/newlib）；入口语义按本机实测：e_entry 非 0 且落在 .text 区间
    await buildLinkAndCheckElf({
      name: 'tc-riscv-link',
      programs: { C: riscvGcc, CPP: H.findExecutable('riscv-none-elf-g++') || H.findExecutable('riscv64-unknown-elf-g++') || riscvGcc, LD: riscvGcc, LIB: riscvAr || ar },
      machine: 243, options: [], linkerOptions: [],
      expectEntryZero: false, objdump: riscvObjdump, objcopy: riscvObjcopy,
    });
  } else {
    skip('S9 RISC-V 链接级', '未找到 riscv-none-elf-gcc / riscv64-unknown-elf-gcc（见文末安装指引）');
  }

  // ---------- 安装指引（仅列出缺失项） ----------
  const GUIDES = {
    'clang/LLVM': 'https://github.com/llvm/llvm-project/releases → clang+llvm-*-x86_64-pc-windows-msvc.tar.zst（或清华镜像 mirrors.tuna.tsinghua.edu.cn/github-release/llvm/llvm-project/）',
    'AVR GCC': 'https://github.com/ZakKemble/avr-gcc-build/releases → avr-gcc-*-x64-windows.zip',
    'RISC-V GCC': 'https://github.com/xpack-dev-tools/riscv-none-elf-gcc-xpack/releases → *-win32-x64.zip',
    'MSP430 GCC': 'TI MSP430 GCC（需交互下载）',
    SDCC: 'https://sdcc.sourceforge.net（SourceForge：稳定版仅 `*-setup.exe` 安装器；nightly 快照有 ~38MB zip）',
    TCC: 'https://download.savannah.nongnu.org/releases/tinycc/ → tcc-0.9.27-win64-bin.zip（官方发布区；解包后把 tcc.exe/include/lib 放 <root>/tcc/bin/ 才能被自动探测）',
  };
  const missing = inventory.filter(([, p]) => !p).map(([label]) => label.replace(/（.*）/, ''));
  if (missing.length) {
    console.log('\n[缺失工具链安装指引]');
    for (const label of missing) {
      const key = Object.keys(GUIDES).find((k) => label.startsWith(k.split('（')[0]));
      if (key) console.log(`  · ${key}: ${GUIDES[key]}`);
    }
    console.log('  解包位置：<repo>/.cb-tools/toolchains/<name>/（或设 CB_TOOLCHAIN_ROOT=<dir>），其 bin 目录会被自动探测');
    console.log('  网络受限时：直连 GitHub 资产可能被限速，可用 ghfast.top 代理或国内镜像（见 docs/测试方案.md §5.0）');
  } else {
    console.log('\n[工具链清单] 全部已安装');
  }

  console.log(`\nTOTAL=${T.pass + T.fail + T.skip} PASS=${T.pass} FAIL=${T.fail} SKIP=${T.skip}`);
  H.shutDown();
  process.exit(T.fail ? 1 : 0);
})().catch((err) => {
  console.error('工具链矩阵异常: ' + (err && err.stack ? err.stack : err));
  H.shutDown();
  process.exit(1);
});
