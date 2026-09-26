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
