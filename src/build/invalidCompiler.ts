/**
 * 无效编译器检查与消息渲染 —— 纯模块（无 vscode 依赖），供构建引擎与运行入口共用。
 *
 * 对应 Code::Blocks：
 *  - `Compiler::IsValid`（compiler.cpp:191-231）：masterPath 设置时检查 C 程序存在性（bin/ → 根目录 → extra_paths），未设置视为 PATH 查找；
 *  - `Compiler::MakeInvalidCompilerMessages`（compiler.cpp:234-259）：逐条 "Tried to run compiler executable '…', but failed!"；
 *  - `CompilerGCC::PrintInvalidCompiler`（compilergcc.cpp:1756-1786）：5 行消息（末尾换行留下空行）+ finalMessage 独立条目
 *    —— Build/Clean/Rebuild 用 "Skipping..."（PreprocessJob:2762），Run 用 "Run aborted..."（Run():1981）。
 *
 * 消息结构对齐 CB；文案为扩展适配（UI 差异）：产品名 Code::Blocks for VS Code、修复指引指向扩展设置与命令
 * （CB 原文指向其 Settings 对话框，VS Code 无对应 UI）；未注册编译器在括号中显示其 ID。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Compiler } from '../compiler/compiler';

/** 编译器是否可用 —— 对齐 Compiler::IsValid（compiler.cpp:191-231）：masterPath 设置时检查 C 程序存在性，未设置视为 PATH 查找 */
export function isCompilerUsable(c: Compiler): boolean {
  if (!c.programs.C) return false;
  if (!c.masterPath) return true;
  if (path.isAbsolute(c.programs.C)) return fs.existsSync(c.programs.C);
  if (fs.existsSync(path.join(c.masterPath, 'bin', c.programs.C)) || fs.existsSync(path.join(c.masterPath, c.programs.C))) return true;
  // 对齐 Compiler::IsValid（compiler.cpp:218-229）：extra paths 也参与程序搜索
  for (const ep of c.extraPaths ?? []) {
    if (ep && fs.existsSync(path.join(ep, c.programs.C))) return true;
  }
  return false;
}

/**
 * IsValid 实际检查过的 C 程序路径（对齐 MakeInvalidCompilerMessages:234-259）。
 * 保护性修正：CB 原函数循环缺陷（masterPath 无 bin 路径仅在存在 extra_paths 时打印、最后一个 extra_path 永不打印）——
 * 此处按 IsValid 实际检查顺序完整列出（bin/ → 根目录 → 每个 extra_path）。
 */
export function triedCompilerPaths(c: Compiler): string[] {
  if (!c.programs.C) return [];
  if (path.isAbsolute(c.programs.C)) return [c.programs.C];
  const out: string[] = [];
  if (c.masterPath) {
    out.push(path.join(c.masterPath, 'bin', c.programs.C));
    out.push(path.join(c.masterPath, c.programs.C));
  }
  for (const ep of c.extraPaths ?? []) {
    if (ep) out.push(path.join(ep, c.programs.C));
  }
  return out;
}

/**
 * 主消息（5 行、末尾换行留下空行）—— 结构对齐 PrintInvalidCompiler，文案为扩展适配。
 * 名称显示：已注册编译器 → 其名称；未注册 → 传入其 ID（如 "my-compiler"，CB 原文此处为空名）；均以 "(…)" 附加，为空时省略。
 */
export function renderInvalidCompilerMessage(targetFullTitle: string, compilerName: string | null): string {
  const name = compilerName ? ` (${compilerName})` : '';
  return (
    `Project/Target: "${targetFullTitle}":\n` +
    `  The compiler's setup${name} is invalid, so Code::Blocks for VS Code cannot find/run the compiler.\n` +
    `  Probably the toolchain path within the compiler settings is not setup correctly?!\n` +
    `  Do you have a compiler installed?\n` +
    `Check the "codeblocks.masterPath" / "codeblocks.compilerPrograms" settings, or run "Code::Blocks: Detect Compilers" to fix the compiler's setup.\n`
  );
}

/** 尝试路径错误条目（每行一句 + 末尾换行，对齐 CB 单条 LogError）；无路径返回空串（调用方跳过输出） */
export function renderTriedCompilerPaths(paths: string[]): string {
  if (!paths.length) return '';
  return paths.map((p) => `Tried to run compiler executable '${p}', but failed!`).join('\n') + '\n';
}
