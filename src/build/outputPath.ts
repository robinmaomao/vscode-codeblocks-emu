/**
 * 目标输出路径解析（构建/清理/运行/调试共用）
 *
 * 对齐 Code::Blocks 的扩展名策略（extension_auto / tgfpPlatformDefault）与 MinGW 链接器行为：
 * Windows 下 `-o bin/Debug/hello`（无扩展名）会实际产出 `hello.exe`，
 * 因此解析真实输出文件时必须做 `.exe` 回退——运行/调试的存在性检查与链接时间戳检查共用同一规则。
 */
import * as fs from 'fs';
import * as path from 'path';
import { TargetType } from '../model/types';

/** exe 类目标（ttConsoleOnly / ttExecutable / ttNative；Windows 无扩展名输出会被追加 .exe） */
export function isExecutableTargetType(t: TargetType): boolean {
  return t === TargetType.ConsoleOnly || t === TargetType.Executable || t === TargetType.Native;
}

/**
 * 候选路径（按存在性解析顺序）：原路径 → Windows exe 类型追加 `.exe`。
 * @param platform 便于测试注入（默认 process.platform）
 */
export function executableCandidates(basePath: string, expandedOutput: string, platform: string = process.platform, isExeType = true): string[] {
  const out = path.join(basePath, expandedOutput);
  const list = [out];
  if (platform === 'win32' && isExeType) list.push(out + '.exe');
  return list;
}

/** 解析真实输出文件路径：返回第一个存在的候选，均不存在时返回首个候选（保持原语义） */
export function resolveExecutablePath(basePath: string, expandedOutput: string, platform: string = process.platform, isExeType = true): string {
  const candidates = executableCandidates(basePath, expandedOutput, platform, isExeType);
  return candidates.find((c) => fs.existsSync(c)) ?? candidates[0];
}

/**
 * Windows 可执行类目标的「平台默认扩展名」补全（对齐 Code::Blocks 目标属性 `extension_auto` / `tgfpPlatformDefault`）。
 *
 * 必要性（D-13）：MinGW gcc 会自己把 `-o prog` 追加成 `prog.exe`，但 TCC 等工具链**不会** ⇒ 产物是无扩展名文件，
 * 而 Windows 下 `cmd.exe` / `CreateProcess` 都要求可执行扩展名 ⇒ Run/Debug 无法启动。
 * 这里在「win32 + 可执行类目标 + extension_auto 开启 + 输出无扩展名」时显式补 `.exe`，
 * 使任意工具链的产物都是可直接启动的文件（已有扩展名如 `.elf`/`.hex` 一律不动）。
 */
export function withPlatformExtension(
  expandedOutput: string,
  platform: string = process.platform,
  isExeType = true,
  extensionAuto = true,
): string {
  if (platform !== 'win32' || !isExeType || !extensionAuto) return expandedOutput;
  const out = expandedOutput ?? '';
  if (!out.trim()) return expandedOutput;
  if (path.extname(out)) return expandedOutput;
  return out + '.exe';
}

/** Windows 下「产物无扩展名 ⇒ 无法启动」的判定（供 Run/Debug 给出可读提示；D-13） */
export function requiresExecutableExtensionForLaunch(resolvedPath: string, platform: string = process.platform): boolean {
  return platform === 'win32' && resolvedPath.trim() !== '' && path.extname(resolvedPath) === '';
}
