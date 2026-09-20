/**
 * 编译器自动探测 —— 对应 compilerMINGW.cpp / compilerMSVC.cpp 的 AutoDetectInstallationDir
 *
 * 移植自 codeblocks-src/src/plugins/compilergcc/compilerMINGW.cpp（GPL v3，逻辑独立重写）。
 * 探测顺序：已配置路径 → PATH 环境变量 → 常见安装目录。
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

export interface DetectedCompiler {
  id: string;
  name: string;
  masterPath: string;
  /** 编译器可执行（C）完整路径 */
  cCompilerPath: string;
  version?: string;
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
  return result;
}
