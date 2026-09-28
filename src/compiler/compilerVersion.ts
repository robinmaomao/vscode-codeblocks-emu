/**
 * 编译器版本号查询 —— 对齐 CompilerMINGW::SetVersionString（compilerMINGW.cpp:240-318）。
 *
 * PCH include 前置需要 gcc 主版本号（`-iquote` 为 GCC≥4；更老版本用 `-I` + `-I-`）：
 * 这里运行 `<C 程序> --version` 取首行 x.y.z。
 *
 * 审计修复（原实现在 extension.ts 内联）：原逻辑每个新建 Compiler 实例都会同步 spawn 一次
 *（构建期 getCompiler() 多次调用 → 多次 30–100ms 阻塞；异常环境最长 8s）。
 * 现改用模块级缓存：key = exe 路径 + mtime（编译器升级/重建后自动失效，负结果同样缓存）。
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { Compiler } from './compiler';

/** 版本号缓存（key = `<exe>|<mtimeMs>`；stat 失败时 mtime 记 0，仅按路径缓存） */
const versionCache = new Map<string, string | undefined>();

/** 解析编译器 C 程序的实际路径（相对路径优先 masterPath/bin，其次 masterPath 根） */
export function resolveCompilerCExe(compiler: Compiler): string | undefined {
  const c = compiler.programs?.C;
  if (!c) return undefined;
  let exe = c;
  if (!path.isAbsolute(exe) && compiler.masterPath) {
    const inBin = path.join(compiler.masterPath, 'bin', c);
    exe = fs.existsSync(inBin) ? inBin : path.join(compiler.masterPath, c);
  }
  return exe;
}

/** 查询编译器版本字符串（`<C 程序> --version` 首行匹配 x.y.z；模块级缓存，见文件头注释） */
export function queryCompilerVersionString(compiler: Compiler): string | undefined {
  const exe = resolveCompilerCExe(compiler);
  if (!exe) return undefined;
  let mtime = 0;
  try {
    mtime = fs.statSync(exe).mtimeMs;
  } catch {
    // 不可 stat（PATH 查找或不存在）：仅按路径缓存
  }
  const key = `${exe}|${mtime}`;
  if (versionCache.has(key)) return versionCache.get(key);

  let version: string | undefined;
  try {
    const out = spawnSync(exe, ['--version'], { encoding: 'utf8', timeout: 8000 }).stdout ?? '';
    const first = out.split(/\r?\n/)[0] ?? '';
    const m = first.match(/\d+\.\d+\.\d+/);
    version = m ? m[0] : undefined;
  } catch {
    version = undefined;
  }
  versionCache.set(key, version);
  return version;
}

/** 清空版本缓存（测试用；编译器切换/重装需要强制刷新时亦可调用） */
export function clearCompilerVersionCache(): void {
  versionCache.clear();
}
