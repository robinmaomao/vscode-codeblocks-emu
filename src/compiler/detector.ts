/**
 * 编译器自动探测 —— 对应 compilerMINGW.cpp / compilerMSVC.cpp 的 AutoDetectInstallationDir
 *
 * 移植自 codeblocks-src/src/plugins/compilergcc/compilerMINGW.cpp（GPL v3，逻辑独立重写）。
 * 探测顺序：已配置路径 → PATH 环境变量 → 常见安装目录。
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync, execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DetectedCompiler {
  id: string;
  name: string;
  masterPath: string;
  /** 编译器可执行（C）完整路径 */
  cCompilerPath: string;
  version?: string;
  /** 完整程序路径映射（交叉编译器如 RISC-V 时提供，标准编译器省略） */
  programs?: {
    C: string;
    CPP: string;
    LD: string;
    LIB: string;
    WINDRES: string;
    MAKE: string;
  };
}

/** 在 PATH 中查找可执行文件 */
function findInPath(execName: string, pathVar: string): string | null {
  const sep = process.platform === 'win32' ? ';' : ':';
  for (const dir of pathVar.split(sep)) {
    if (!dir) continue;
    const full = path.join(dir, execName);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

/** 探测 GCC/MinGW */
export function detectGcc(masterPath = ''): DetectedCompiler | null {
  const win = process.platform === 'win32';
  const cName = win ? 'gcc.exe' : 'gcc';
  const cppName = win ? 'g++.exe' : 'g++';

  // 1. 已配置的 masterPath
  if (masterPath) {
    const bin = path.join(masterPath, 'bin', cName);
    if (fs.existsSync(bin)) {
      return buildGccResult(masterPath, bin);
    }
  }

  // 2. PATH 环境变量
  const pathVar = process.env.PATH ?? '';
  const foundC = findInPath(cName, pathVar);
  if (foundC) {
    // masterPath = bin 的上一级目录
    const binDir = path.dirname(foundC);
    const master = path.dirname(binDir);
    return buildGccResult(master, foundC);
  }

  // 3. 常见安装目录（Windows）
  if (win) {
    const candidates = [
      'C:\\MinGW',
      'C:\\mingw64',
      'C:\\msys64\\mingw64',
      'C:\\Program Files\\mingw-w64',
      'C:\\TDM-GCC-64',
    ];
    for (const dir of candidates) {
      const bin = path.join(dir, 'bin', cName);
      if (fs.existsSync(bin)) return buildGccResult(dir, bin);
    }
    // 用 where 命令兜底
    const where = spawnSync('where', [cName], { encoding: 'utf8' });
    if (where.stdout) {
      const first = where.stdout.split(/\r?\n/)[0].trim();
      if (first && fs.existsSync(first)) {
        return buildGccResult(path.dirname(path.dirname(first)), first);
      }
    }
  } else {
    // Linux/macOS：which 命令
    const which = spawnSync('which', [cName], { encoding: 'utf8' });
    if (which.stdout) {
      const full = which.stdout.trim();
      if (full && fs.existsSync(full)) {
        return buildGccResult(path.dirname(path.dirname(full)), full);
      }
    }
  }

  return null;
}

function buildGccResult(masterPath: string, cPath: string): DetectedCompiler {
  const win = process.platform === 'win32';
  const version = spawnSync(cPath, ['--version'], { encoding: 'utf8' }).stdout?.split(/\r?\n/)[0]?.trim();
  return {
    id: 'gcc',
    name: 'GNU GCC Compiler',
    masterPath,
    cCompilerPath: cPath,
    version,
  };
}

/** 探测 Clang */
export function detectClang(): DetectedCompiler | null {
  const win = process.platform === 'win32';
  const clangName = win ? 'clang.exe' : 'clang';
  const pathVar = process.env.PATH ?? '';
  const found = findInPath(clangName, pathVar);
  if (!found) return null;

  const version = spawnSync(found, ['--version'], { encoding: 'utf8' }).stdout?.split(/\r?\n/)[0]?.trim();
  return {
    id: 'clang',
    name: 'LLVM Clang Compiler',
    masterPath: path.dirname(path.dirname(found)),
    cCompilerPath: found,
    version,
  };
}

/** 探测 MSVC（Windows：vswhere + cl.exe） */
export function detectMsvc(): DetectedCompiler | null {
  if (process.platform !== 'win32') return null;

  // 优先用 vswhere 定位 VS 安装
  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (fs.existsSync(vswhere)) {
    const r = spawnSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' });
    const installPath = r.stdout?.trim();
    if (installPath) {
      const cl = findClInVs(installPath);
      if (cl) {
        return {
          id: 'msvc',
          name: 'Microsoft Visual C++ Compiler',
          masterPath: installPath,
          cCompilerPath: cl,
        };
      }
    }
  }

  // 兜底：PATH 里找 cl.exe（需已在 VS 开发者环境）
  const cl = findInPath('cl.exe', process.env.PATH ?? '');
  if (cl) {
    return { id: 'msvc', name: 'Microsoft Visual C++ Compiler', masterPath: '', cCompilerPath: cl };
  }
  return null;
}

function findClInVs(vsPath: string): string | null {
  try {
    // 遍历 VC/Tools/MSVC/*/bin/Hostx64/x64/cl.exe
    const msvcRoot = path.join(vsPath, 'VC', 'Tools', 'MSVC');
    if (!fs.existsSync(msvcRoot)) return null;
    for (const ver of fs.readdirSync(msvcRoot)) {
      const binHosts = path.join(msvcRoot, ver, 'bin');
      if (!fs.existsSync(binHosts)) continue;
      for (const host of fs.readdirSync(binHosts)) {
        for (const arch of fs.readdirSync(path.join(binHosts, host))) {
          const cl = path.join(binHosts, host, arch, 'cl.exe');
          if (fs.existsSync(cl)) return cl;
        }
      }
    }
    return null;
  } catch {
    // 目录结构异常（权限/损坏安装）→ 回退到 PATH 找 cl.exe 的兜底分支
    return null;
  }
}

/** RISC-V 工具链前缀（gcc 交叉编译器） */
const RISCV_PREFIXES = [
  'riscv32-unknown-elf',
  'riscv64-unknown-elf',
  'riscv32-unknown-linux-gnu',
  'riscv64-unknown-linux-gnu',
  'riscv64-linux-gnu',
  'riscv32-none-elf',
  'riscv64-none-elf',
  'riscv-none-embed',
  'riscv-none-elf',
  'riscv32-elf',
  'riscv64-elf',
  'riscv32-esp-elf',   // ESP32-C2/C3
];

/** 在 PATH 中查找 RISC-V 交叉编译器（返回所有命中的前缀与 gcc 路径） */
function detectRiscvInPath(): { prefix: string; gccPath: string }[] {
  const win = process.platform === 'win32';
  const pathVar = process.env.PATH ?? '';
  const out: { prefix: string; gccPath: string }[] = [];
  const seen = new Set<string>();
  for (const prefix of RISCV_PREFIXES) {
    const gcc = findInPath(prefix + (win ? '-gcc.exe' : '-gcc'), pathVar);
    if (gcc && !seen.has(gcc)) {
      seen.add(gcc);
      out.push({ prefix, gccPath: gcc });
    }
  }
  return out;
}

/** 在常见安装目录递归扫描 RISC-V 工具链 bin（如 RV32-Toolchain / Espressif），返回所有命中 */
function scanRiscvDirs(): { prefix: string; gccPath: string }[] {
  const win = process.platform === 'win32';
  const gccSuffix = win ? '-gcc.exe' : '-gcc';
  const roots: string[] = [];
  // Windows 常见目录
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  roots.push(pf86, pf);
  const results: { prefix: string; gccPath: string }[] = [];
  const seen = new Set<string>();
  // 覆盖 RV32-Toolchain\RV32-V2\bin 这类结构
  const depth = 4;
  const visited = new Set<string>();
  const scan = (dir: string, level: number): void => {
    if (level > depth || visited.has(dir)) return;
    visited.add(dir);
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let isDir = false;
      try {
        isDir = fs.statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      if (entry.toLowerCase() === 'bin') {
        // 检查该 bin 下是否有 riscv 前缀的 gcc
        for (const found of findRiscvGccInDir(full, gccSuffix)) {
          if (!seen.has(found.gccPath)) {
            seen.add(found.gccPath);
            results.push(found);
          }
        }
      } else if (level < depth) {
        scan(full, level + 1);
      }
    }
  };
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    scan(root, 1);
  }
  return results;
}

function findRiscvGccInDir(binDir: string, gccSuffix: string): { prefix: string; gccPath: string }[] {
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(binDir);
  } catch {
    return [];
  }
  const out: { prefix: string; gccPath: string }[] = [];
  for (const entry of entries) {
    if (!entry.startsWith('riscv') || !entry.endsWith(gccSuffix)) continue;
    // 提取前缀：riscv32-elf-gcc.exe → riscv32-elf
    const prefix = entry.slice(0, entry.length - gccSuffix.length);
    out.push({ prefix, gccPath: path.join(binDir, entry) });
  }
  return out;
}

/** 构建 RISC-V 编译器结果（含完整程序路径映射） */
function buildRiscvResult(prefix: string, gccPath: string): DetectedCompiler {
  const win = process.platform === 'win32';
  const binDir = path.dirname(gccPath);
  const exe = (name: string) => (win ? name + '.exe' : name);
  const full = (name: string) => path.join(binDir, prefix + '-' + name + (win ? '.exe' : ''));
  const existsOr = (name: string, fallback: string) => {
    const p = full(name);
    return fs.existsSync(p) ? p : fallback;
  };
  const version = spawnSync(gccPath, ['--version'], { encoding: 'utf8' }).stdout?.split(/\r?\n/)[0]?.trim();

  // 纯 C 工具链可能没有 g++，此时 CPP/LD 回退到 gcc（支持纯 C 工程）
  const cpp = existsOr('g++', gccPath);
  const ld = existsOr('g++', cpp);
  const lib = existsOr('ar', '');
  const windres = existsOr('windres', '');

  // masterPath = bin 的上一级（保持与 GCC 探测一致的约定）
  const masterPath = path.dirname(binDir);

  // 从 version 提取版本号（如 "10.2.0"），便于同名工具链区分
  const verMatch = version?.match(/\b(\d+\.\d+(?:\.\d+)?)\b/);
  const shortVer = verMatch ? verMatch[1] : '';

  return {
    id: 'riscv',
    name: `RISC-V GCC (${prefix}${shortVer ? ' ' + shortVer : ''})`,
    masterPath,
    cCompilerPath: gccPath,
    version,
    programs: {
      C: gccPath,
      CPP: cpp,
      LD: ld,
      LIB: lib,
      WINDRES: windres,
      MAKE: win ? 'mingw32-make.exe' : 'make',
    },
  };
}

/** 探测 RISC-V 交叉编译器（返回所有命中的工具链） */
export function detectRiscv(): DetectedCompiler[] {
  const results: DetectedCompiler[] = [];
  const seen = new Set<string>();

  // 1. PATH 环境变量
  for (const item of detectRiscvInPath()) {
    if (!seen.has(item.gccPath)) {
      seen.add(item.gccPath);
      results.push(buildRiscvResult(item.prefix, item.gccPath));
    }
  }

  // 2. 常见安装目录扫描
  for (const item of scanRiscvDirs()) {
    if (!seen.has(item.gccPath)) {
      seen.add(item.gccPath);
      results.push(buildRiscvResult(item.prefix, item.gccPath));
    }
  }

  return results;
}

/** 统一探测所有可用编译器 */
export function detectAllCompilers(masterPath = ''): DetectedCompiler[] {
  const result: DetectedCompiler[] = [];
  const gcc = detectGcc(masterPath);
  if (gcc) result.push(gcc);
  const clang = detectClang();
  if (clang) result.push(clang);
  const msvc = detectMsvc();
  if (msvc) result.push(msvc);
  result.push(...detectRiscv());
  return result;
}

// ---------------------------------------------------------------------------
// 异步并行版本（detectAllCompilersAsync）—— 用于「选择编译器」弹窗后台探测：
// 四组探测并行、目录扫描/版本查询全部异步，避免阻塞 UI；同步版本保持不变。
// ---------------------------------------------------------------------------

/** 异步获取 `--version` 首行（替代 spawnSync，探测失败返回 undefined） */
async function queryVersionAsync(exe: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(exe, ['--version'], { encoding: 'utf8', timeout: 5000 });
    return stdout.split(/\r?\n/)[0]?.trim();
  } catch {
    return undefined;
  }
}

/** 探测 GCC/MinGW（异步版） */
async function detectGccAsync(masterPath = ''): Promise<DetectedCompiler | null> {
  const win = process.platform === 'win32';
  const cName = win ? 'gcc.exe' : 'gcc';
  let master = '';
  let cPath = '';

  // 1. 已配置的 masterPath
  if (masterPath) {
    const bin = path.join(masterPath, 'bin', cName);
    if (fs.existsSync(bin)) {
      master = masterPath;
      cPath = bin;
    }
  }
  // 2. PATH 环境变量
  if (!cPath) {
    const foundC = findInPath(cName, process.env.PATH ?? '');
    if (foundC) {
      cPath = foundC;
      master = path.dirname(path.dirname(foundC));
    }
  }
  // 3. 常见安装目录
  if (!cPath && win) {
    const candidates = [
      'C:\\MinGW',
      'C:\\mingw64',
      'C:\\msys64\\mingw64',
      'C:\\Program Files\\mingw-w64',
      'C:\\TDM-GCC-64',
    ];
    for (const dir of candidates) {
      const bin = path.join(dir, 'bin', cName);
      if (fs.existsSync(bin)) {
        master = dir;
        cPath = bin;
        break;
      }
    }
    // 用 where 命令兜底
    if (!cPath) {
      try {
        const { stdout } = await execFileAsync('where', [cName], { encoding: 'utf8', timeout: 5000 });
        const first = stdout.split(/\r?\n/)[0]?.trim();
        if (first && fs.existsSync(first)) {
          cPath = first;
          master = path.dirname(path.dirname(first));
        }
      } catch { /* 未命中 */ }
    }
  } else if (!cPath) {
    // Linux/macOS：which 命令
    try {
      const { stdout } = await execFileAsync('which', [cName], { encoding: 'utf8', timeout: 5000 });
      const full = stdout.trim();
      if (full && fs.existsSync(full)) {
        cPath = full;
        master = path.dirname(path.dirname(full));
      }
    } catch { /* 未命中 */ }
  }

  if (!cPath) return null;
  const version = await queryVersionAsync(cPath);
  return { id: 'gcc', name: 'GNU GCC Compiler', masterPath: master, cCompilerPath: cPath, version };
}

/** 探测 Clang（异步版） */
async function detectClangAsync(): Promise<DetectedCompiler | null> {
  const win = process.platform === 'win32';
  const found = findInPath(win ? 'clang.exe' : 'clang', process.env.PATH ?? '');
  if (!found) return null;
  const version = await queryVersionAsync(found);
  return {
    id: 'clang',
    name: 'LLVM Clang Compiler',
    masterPath: path.dirname(path.dirname(found)),
    cCompilerPath: found,
    version,
  };
}

/** 探测 MSVC（异步版：vswhere 异步查询 + cl.exe 目录遍历/兜底） */
async function detectMsvcAsync(): Promise<DetectedCompiler | null> {
  if (process.platform !== 'win32') return null;

  const vswhere = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe';
  if (fs.existsSync(vswhere)) {
    try {
      const { stdout } = await execFileAsync(
        vswhere,
        ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
        { encoding: 'utf8', timeout: 10000 },
      );
      const installPath = stdout.trim();
      if (installPath) {
        const cl = findClInVs(installPath);
        if (cl) {
          return { id: 'msvc', name: 'Microsoft Visual C++ Compiler', masterPath: installPath, cCompilerPath: cl };
        }
      }
    } catch { /* 回退 PATH */ }
  }

  const cl = findInPath('cl.exe', process.env.PATH ?? '');
  if (cl) {
    return { id: 'msvc', name: 'Microsoft Visual C++ Compiler', masterPath: '', cCompilerPath: cl };
  }
  return null;
}

/** 常见安装目录递归扫描（异步版；readdir withFileTypes 免逐项 stat） */
async function scanRiscvDirsAsync(): Promise<{ prefix: string; gccPath: string }[]> {
  const win = process.platform === 'win32';
  const gccSuffix = win ? '-gcc.exe' : '-gcc';
  const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const pf = process.env['ProgramFiles'] ?? 'C:\\Program Files';
  const roots = [pf86, pf];
  const results: { prefix: string; gccPath: string }[] = [];
  const seen = new Set<string>();
  const visited = new Set<string>();
  const depth = 4;
  const scan = async (dir: string, level: number): Promise<void> => {
    if (level > depth || visited.has(dir)) return;
    visited.add(dir);
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      let isDir = entry.isDirectory();
      if (!isDir && entry.isSymbolicLink()) {
        try {
          isDir = (await fs.promises.stat(full)).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (!isDir) continue;
      if (entry.name.toLowerCase() === 'bin') {
        // 检查该 bin 下是否有 riscv 前缀的 gcc
        for (const found of findRiscvGccInDir(full, gccSuffix)) {
          if (!seen.has(found.gccPath)) {
            seen.add(found.gccPath);
            results.push(found);
          }
        }
      } else if (level < depth) {
        await scan(full, level + 1);
      }
    }
  };
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
    } catch {
      continue;
    }
    await scan(root, 1);
  }
  return results;
}

/** 构建 RISC-V 编译器结果（异步版：版本查询异步） */
async function buildRiscvResultAsync(prefix: string, gccPath: string): Promise<DetectedCompiler> {
  const win = process.platform === 'win32';
  const binDir = path.dirname(gccPath);
  const full = (name: string) => path.join(binDir, prefix + '-' + name + (win ? '.exe' : ''));
  const existsOr = (name: string, fallback: string) => {
    const p = full(name);
    return fs.existsSync(p) ? p : fallback;
  };
  const version = await queryVersionAsync(gccPath);

  // 纯 C 工具链可能没有 g++，此时 CPP/LD 回退到 gcc（支持纯 C 工程）
  const cpp = existsOr('g++', gccPath);
  const ld = existsOr('g++', cpp);
  const lib = existsOr('ar', '');
  const windres = existsOr('windres', '');

  // masterPath = bin 的上一级（保持与 GCC 探测一致的约定）
  const masterPath = path.dirname(binDir);

  const verMatch = version?.match(/\b(\d+\.\d+(?:\.\d+)?)\b/);
  const shortVer = verMatch ? verMatch[1] : '';

  return {
    id: 'riscv',
    name: `RISC-V GCC (${prefix}${shortVer ? ' ' + shortVer : ''})`,
    masterPath,
    cCompilerPath: gccPath,
    version,
    programs: {
      C: gccPath,
      CPP: cpp,
      LD: ld,
      LIB: lib,
      WINDRES: windres,
      MAKE: win ? 'mingw32-make.exe' : 'make',
    },
  };
}

/** 探测 RISC-V 交叉编译器（异步版，多工具链版本查询并行） */
async function detectRiscvAsync(): Promise<DetectedCompiler[]> {
  // gccPath -> prefix（保持 PATH 优先、目录扫描补充的顺序语义）
  const hits = new Map<string, string>();
  for (const item of detectRiscvInPath()) hits.set(item.gccPath, item.prefix);
  for (const item of await scanRiscvDirsAsync()) {
    if (!hits.has(item.gccPath)) hits.set(item.gccPath, item.prefix);
  }
  return Promise.all([...hits.entries()].map(([gccPath, prefix]) => buildRiscvResultAsync(prefix, gccPath)));
}

/** 统一探测所有可用编译器（异步并行版；弹窗后台探测用，不阻塞 UI） */
export async function detectAllCompilersAsync(masterPath = ''): Promise<DetectedCompiler[]> {
  const [gcc, clang, msvc, riscv] = await Promise.all([
    detectGccAsync(masterPath),
    detectClangAsync(),
    detectMsvcAsync(),
    detectRiscvAsync(),
  ]);
  const result: DetectedCompiler[] = [];
  if (gcc) result.push(gcc);
  if (clang) result.push(clang);
  if (msvc) result.push(msvc);
  result.push(...riscv);
  return result;
}
