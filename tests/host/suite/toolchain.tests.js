// 宿主集成：跨工具链构建（真实 VS Code 内，非原生工具链 = AVR GCC / RISC-V GCC）
//
// 目标（阶段 4 待办 p4-host-toolchain）：在真实 VS Code 中打开一个使用**非原生工具链**的探针工程，
// 执行 `codeblocks.build`，断言 `.elf` 真实落地 + 构建成功 + ELF `e_machine` 与目标体系结构一致
// （AVR=83 / RISC-V=243）——即证明宿主内真的调用了交叉工具链，而不是被静默跳过 / 回退到原生 gcc。
//
// 与既有层的关系：
//  - L3（tests/e2e/test-e2e-toolchains.js S6/S9）已验证「工具链矩阵 + 链接级 .elf」的引擎内行为；
//    本用例是其**宿主级**对照：命令注册/设置读取/输出通道/产物落盘全走真实 VS Code。
//  - 宿主层既有 build.tests.js 覆盖原生 gcc 构建；本文件补「非原生工具链」缺口。
//
// 工具链探测（与产品相同的优先级：PATH 优先）：
//  1. PATH（where.exe）—— 产品 src/compiler/detector.ts 的 detectAvr 也是 PATH 优先；
//  2. CB_TOOLCHAIN_ROOT（分号分隔多根）—— 与 tests/e2e/harness.js 的探测约定一致；
//  3. <repo>/.cb-tools/toolchains/**/bin —— 本机解包位置（docs/测试方案.md §5.0，gitignored）。
//  探测不到 → SKIP，并打印「未安装 + 安装位置 + 方案 §5.0 指引」（CI runner 上通常缺失，不判失败）。
//
// 产品侧「非原生工具链」接线：交叉工具链的完整程序路径由设置 `codeblocks.compilerPrograms` 提供，
// **按编译器 id 作用域**（D-20：「探测编译器」写入 `{ "<id>": { C, CPP, … } }`；旧扁平形态只对写入时的全局
//  compilerId 生效，避免交叉工具链程序路径泄漏到别的家族）。
//  本用例把探测到的绝对路径写入该设置（宿主内不可交互驱动 QuickPick「探测编译器」，用设置的等价态），
//  结束后恢复原值。AVR 用随包注册家族 `avr-gcc`（resources/compilers/options_avr-gcc.xml）；
//  RISC-V 无随包 options_riscv*.xml 家族，沿用 E2E S9 的等价做法（`gcc` 家族 + 程序路径覆盖）。
//
// 宿主层观测手段（沿用 hostUtil / build.tests.js 结论）：
//  - 「构建成功」等输出通道文本只能经 `codeblocks.build.persistLog` 落盘读取
//    （<user-data>/logs/**/exthost/robinmaomao.codeblocks-vscode/CodeBlocks.log，启动器已预置该设置）；
//    注意 `outputChannel.clear()` **不截断**落盘日志 ⇒ 必须用「build 前 offset 切片 + 唯一标题/唯一产物名」
//    排除历史构建行的假阳性（不伪造断言）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vscode = require('vscode');
const { suite } = require('./framework');
const U = require('./hostUtil');

// ———— ELF 头解析（与 tests/e2e/test-e2e-toolchains.js readElf 同源；suite 被复制到无空格目录，
//      无法 require 仓库模块，故在本文件内自包含实现） ————
function readElf(file) {
  if (!fs.existsSync(file)) return undefined;
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) return undefined;
  const is64 = buf[4] === 2;
  const entry = is64 ? Number(buf.readBigUInt64LE(0x18)) : buf.readUInt32LE(0x18);
  return { magic: 'ELF', machine: buf.readUInt16LE(18), entry, is64 };
}
const ELF_MACHINE = { 83: 'AVR', 243: 'RISC-V' };

// ———— 工具链探测（PATH → CB_TOOLCHAIN_ROOT → <repo>/.cb-tools/toolchains/**/bin） ————
let binDirsCache;
function toolchainBinDirs() {
  if (binDirsCache) return binDirsCache;
  const roots = [];
  for (const r of String(process.env.CB_TOOLCHAIN_ROOT || '').split(';').map((s) => s.trim()).filter(Boolean)) roots.push(r);
  roots.push(path.join(U.repoRoot(), '.cb-tools', 'toolchains'));
  const dirs = [];
  const walk = (dir, depth) => {
    if (depth < 0) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === '_dl' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.name === 'bin') dirs.push(p);
      walk(p, depth - 1);
    }
  };
  for (const r of roots) if (fs.existsSync(r)) walk(r, 4);
  binDirsCache = dirs;
  return dirs;
}

/** 查找可执行文件（PATH 优先 → CB_TOOLCHAIN_ROOT/.cb-tools bin 目录）；返回 { path, source } 或 undefined */
function findToolchainExe(name) {
  const onPath = U.findTool(name);
  if (onPath) return { path: onPath, source: 'PATH' };
  for (const d of toolchainBinDirs()) {
    for (const candidate of [name, `${name}.exe`, `${name}.cmd`]) {
      const p = path.join(d, candidate);
      if (fs.existsSync(p)) return { path: p, source: `local:${d}` };
    }
  }
  return undefined;
}

/** 同一 bin 目录内的兄弟程序（优先与主程序同目录，保证同一套工具链；缺失回退 PATH 探测） */
function siblingExe(gccPath, name) {
  const local = path.join(path.dirname(gccPath), process.platform === 'win32' ? `${name}.exe` : name);
  if (fs.existsSync(local)) return local;
  const found = findToolchainExe(name);
  return found ? found.path : undefined;
}

/** AVR GCC 探针描述（编译器家族 avr-gcc，随包 options_avr-gcc.xml；-mmcu=atmega328p 对齐方案 §5.0 与本机实测） */
function probeAvr() {
  const gcc = findToolchainExe('avr-gcc');
  if (!gcc) return undefined;
  const cpp = siblingExe(gcc.path, 'avr-g++');
  const ar = siblingExe(gcc.path, 'avr-ar');
  return {
    family: 'AVR GCC',
    compilerId: 'avr-gcc',
    machine: 83,
    title: 'cb-host-tc-avr',
    elfName: 'cbhost_avr_probe.elf',
    srcName: 'main.c',
    compilerOptions: ['-mmcu=atmega328p'],
    linkerOptions: ['-mmcu=atmega328p'],
    gccPath: gcc.path,
    source: gcc.source,
    programs: { C: gcc.path, CPP: cpp || gcc.path, LD: cpp || gcc.path, LIB: ar || '' },
    objdump: siblingExe(gcc.path, 'avr-objdump'),
  };
}

/** RISC-V GCC 探针描述（无随包家族 → 沿用 E2E S9：gcc 家族 + 程序路径覆盖；该工具链默认 multilib 可直接链接） */
function probeRiscv() {
  const gcc = findToolchainExe('riscv-none-elf-gcc')
    || findToolchainExe('riscv64-unknown-elf-gcc')
    || findToolchainExe('riscv-none-embed-gcc');
  if (!gcc) return undefined;
  const prefix = path.basename(gcc.path).replace(/-gcc(\.exe)?$/, '');
  const cpp = siblingExe(gcc.path, `${prefix}-g++`);
  const ar = siblingExe(gcc.path, `${prefix}-ar`);
  return {
    family: 'RISC-V GCC',
    compilerId: 'gcc',
    machine: 243,
    title: 'cb-host-tc-riscv',
    elfName: 'cbhost_riscv_probe.elf',
    srcName: 'main.c',
    compilerOptions: [],
    linkerOptions: [],
    gccPath: gcc.path,
    source: gcc.source,
    programs: { C: gcc.path, CPP: cpp || gcc.path, LD: cpp || gcc.path, LIB: ar || '' },
    objdump: siblingExe(gcc.path, `${prefix}-objdump`),
  };
}

/** 探针源码：不依赖 libc 的最小链接单元（AVR/RISC-V 的 CRT 提供 main 入口） */
const PROBE_C = `/* 宿主跨工具链探针：不依赖 libc，仅验证交叉编译器后端 + 命令行生成 + 链接产物 */
int cb_host_tc_value = 7;
int main(void) { return cb_host_tc_value == 7 ? 0 : 1; }
`;

/** 现场生成探针工程（.cbp）：单个 <Compiler>/<Linker> 块内多个 <Add option>（对齐 Code::Blocks 工程格式） */
function writeProbeProject(projDir, tc) {
  fs.rmSync(projDir, { recursive: true, force: true });
  fs.mkdirSync(projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, tc.srcName), PROBE_C, 'utf-8');
  const compilerBlock = tc.compilerOptions.length
    ? `                <Compiler>\n${tc.compilerOptions.map((o) => `                    <Add option="${o}" />`).join('\n')}\n                </Compiler>\n`
    : '';
  const linkerBlock = tc.linkerOptions.length
    ? `                <Linker>\n${tc.linkerOptions.map((o) => `                    <Add option="${o}" />`).join('\n')}\n                </Linker>\n`
    : '';
  const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
    <FileVersion major="1" minor="6" />
    <Project>
        <Option title="${tc.title}" />
        <Option compiler="${tc.compilerId}" />
        <Build>
            <Target title="Debug">
                <Option type="1" />
                <Option compiler="${tc.compilerId}" />
                <Option output="bin/Debug/${tc.elfName}" />
                <Option object_output="obj/Debug/" />
${compilerBlock}${linkerBlock}            </Target>
        </Build>
        <Unit filename="${tc.srcName}" />
    </Project>
</CodeBlocks_project_file>
`;
  const cbpPath = path.join(projDir, `${tc.title}.cbp`);
  fs.writeFileSync(cbpPath, cbp, 'utf-8');
  return cbpPath;
}

/** 无工具链时的 SKIP 说明（不满足项 / 本机满足方式 / CI 预期） */
function skipNoToolchain(ctx) {
  const toolsRoot = path.join(U.repoRoot(), '.cb-tools', 'toolchains');
  console.log('SKIP 宿主集成 · 跨工具链构建：未探测到 avr-gcc（AVR GCC）与 riscv-none-elf-gcc（RISC-V GCC）任一交叉工具链');
  console.log(`     · 探测顺序（与产品一致：PATH 优先）：PATH → CB_TOOLCHAIN_ROOT（分号分隔多根）→ ${toolsRoot}\\**\\bin`);
  console.log(`     · 本机满足方式（无需改系统 PATH）：把工具链解包到 ${toolsRoot}\\<name>\\ 下任意深度（bin 目录自动命中）；`);
  console.log('       或把其 bin 目录加入 PATH；或设 CB_TOOLCHAIN_ROOT=<bin 目录或其上级>');
  console.log('     · 下载：AVR GCC → github.com/ZakKemble/avr-gcc-build releases（avr-gcc-*-x64-windows.zip）；');
  console.log('             RISC-V GCC → github.com/xpack-dev-tools/riscv-none-elf-gcc-xpack releases（*-win32-x64.zip）');
  console.log('     · 指引：docs/测试方案.md §5.0「工具链安装（W6，可选）」');
  console.log('     · CI runner 通常未安装交叉工具链 → 本用例按 SKIP 计（不判失败、不静默通过）');
  ctx.skip();
}

suite('宿主集成 · 跨工具链构建（非原生工具链：AVR / RISC-V GCC）', (t) => {
  t.test('打开交叉工具链探针工程 → codeblocks.build → .elf 落地 + 构建成功 + ELF e_machine 校验', async (ctx) => {
    const ws = U.workspaceDir();
    if (!ws) {
      console.log('SKIP 宿主跨工具链构建：无工作区文件夹');
      ctx.skip();
    }
    const tc = probeAvr() || probeRiscv();
    if (!tc) skipNoToolchain(ctx);

    // 前置：工程目录干净（无 bin/obj），产物必须由本次构建产出
    const projDir = path.join(ws, tc.title);
    const cbp = writeProbeProject(projDir, tc);
    const elfPath = path.join(projDir, 'bin', 'Debug', tc.elfName);
    const objPath = path.join(projDir, 'obj', 'Debug', tc.srcName.replace(/\.[^.]+$/, '.o'));
    assert.ok(!fs.existsSync(elfPath), `前置失败：产物已存在，无法证明本次构建产出（${elfPath}）`);

    // 交叉工具链程序路径写入产品设置（等价「探测编译器」对交叉工具链的持久化；宿主内不可交互驱动 QuickPick）
    // D-20：设置按编译器 id 作用域（`{ "<id>": { C, … } }`），避免交叉工具链程序路径泄漏到别的家族
    const prevPrograms = vscode.workspace.getConfiguration('codeblocks').get('compilerPrograms', {});
    await U.setConfig('compilerPrograms', { [tc.compilerId]: tc.programs });
    try {
      // 1) 打开工程（观测：输出通道落盘日志「已打开项目: <title>」；openProject 弹系统对话框，宿主内不可自动驾驶，
      //    改用 openRecentProject <abs path> —— 与 build.tests.js 同法）
      const off = U.logOffset();
      await vscode.commands.executeCommand('codeblocks.openRecentProject', cbp);
      await vscode.commands.executeCommand('codeblocks.setActiveProject', cbp);
      assert.ok(await U.waitForLogLine(`已打开项目: ${tc.title}`, off, 20000),
        `工程未打开（观测手段：输出通道落盘日志 ${U.extensionLogPath() || '未找到扩展日志'}）`);

      // 2) 构建（命令 resolve 即构建结束；外壳超时防宿主内挂死）
      const t0 = Date.now();
      await U.withTimeout(vscode.commands.executeCommand('codeblocks.build'), 170000, `codeblocks.build（${tc.family}）`);

      // 3) 产物落地（观测手段：文件系统）——交叉工具链真的跑了编译+链接
      const elf = await U.waitFor(() => (fs.existsSync(elfPath) ? elfPath : undefined), 20000);
      const logTail = () => U.readExtensionLog().split(/\r?\n/).filter((l) => l.includes(tc.title) || /构建|编译器程序|错误|Error|error/.test(l)).slice(-6).join(' | ');
      assert.ok(elf, `构建结束但 .elf 不存在：${elfPath}（日志尾部：${logTail()}）`);
      const stat = fs.statSync(elfPath);
      assert.ok(stat.size > 0, `.elf 为空文件：${elfPath}`);
      assert.ok(stat.mtimeMs >= t0 - 2000, `产物未在本次构建中更新（mtime=${new Date(stat.mtimeMs).toISOString()}）`);

      // 4) ELF 体系结构（非原生工具链的硬证据：e_machine 必须为目标架构，而非宿主 x86-64）
      const head = readElf(elfPath);
      assert.ok(head, `产物不是 ELF（前 4 字节应为 7f 45 4c 46）：${elfPath}`);
      assert.strictEqual(head.machine, tc.machine,
        `ELF e_machine 应为 ${tc.machine}（${ELF_MACHINE[tc.machine]}），实际 ${head.machine}（${ELF_MACHINE[head.machine] || '未知'}）`);

      // 5) 中间产物（对象文件落地）
      assert.ok(fs.existsSync(objPath), `缺少对象文件：${objPath}`);

      // 6) 构建成功 / 汇总 / 链接产物路径行（观测手段：输出通道落盘日志；clear() 不截断 ⇒ 以 off 切片归属本次构建，
      //    并以唯一工程标题排除历史构建的假阳性）
      const logText = U.readExtensionLog();
      const seg = logText.length >= off ? logText.slice(off) : logText; // 兜底：若落盘日志被截断则退化为全文
      assert.ok(await U.waitForLogLine('[Code::Blocks] 构建成功', off, 20000),
        `输出日志缺少构建成功行（日志尾部：${logTail()}）`);
      assert.ok(seg.includes(`构建完成: ${tc.title} (Debug)`), `输出日志缺少构建汇总行（工程/目标）：${logTail()}`);
      assert.ok(new RegExp(`链接成功[^\\n]*${tc.elfName}`).test(seg), `输出日志缺少链接产物行（${tc.elfName}）：${logTail()}`);
      // 7) 本次构建确实使用探测到的交叉编译器程序（Banner「编译器程序: <path>」；证明非原生工具链真实参与）
      const normSeg = seg.replace(/\\/g, '/').toLowerCase();
      assert.ok(normSeg.includes(tc.gccPath.replace(/\\/g, '/').toLowerCase()),
        `输出日志的编译器程序路径未指向探测到的工具链（${tc.gccPath}）：${logTail()}`);

      // 8) 工具链自带 objdump 交叉核对 .text 段非空（与 E2E S9 同判据；工具链自带则必查）
      let objdumpNote = 'objdump 不可用（跳过 .text 交叉核对）';
      if (tc.objdump) {
        const dump = spawnSync(tc.objdump, ['-h', elfPath], { encoding: 'utf-8', windowsHide: true, timeout: 30000 });
        const m = /^\s*\d+\s+\.text\s+([0-9a-fA-F]+)\s+/m.exec(String(dump.stdout || ''));
        const textSize = m ? parseInt(m[1], 16) : 0;
        objdumpNote = `${path.basename(tc.objdump)} -h: .text size=0x${textSize.toString(16)}（exit=${dump.status}）`;
        assert.ok(dump.status === 0 && textSize > 0, `工具链 objdump 校验失败：.text 段缺失或为空（${objdumpNote}）`);
      }

      console.log(`     · 观测：工具链=${tc.family}（探测来源=${tc.source}）；编译器程序=${tc.gccPath}；产物=${path.relative(projDir, elfPath).replace(/\\/g, '/')}（${stat.size}B）；e_machine=${head.machine}（${ELF_MACHINE[head.machine]}）；${objdumpNote}`);
    } finally {
      // 恢复设置原值（隔离 profile 内原值为默认 {}；非空时原样写回）
      await U.setConfig('compilerPrograms', prevPrograms);
    }
  });
});
