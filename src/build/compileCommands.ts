/**
 * compile_commands.json 导出 —— 供 clangd IntelliSense 使用（写到工作区外缓存）。
 *
 * 复用 BuildEngine 的编译命令生成（与 Code::Blocks 对齐的宏展开），
 * 并对每条命令做 clang 兼容化（剔除 clang 不认识的 GCC 专属/自定义 flag、
 * 追加 -isystem 系统 include 路径），供 clangd 的 clang 前端解析。
 * 文件写到扩展缓存目录，不污染工程、也不覆盖用户自有的 compile_commands.json。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Project } from '../model/types';
import { Compiler } from '../compiler/compiler';
import { BuildEngine } from './buildEngine';

export interface CompileCommandEntry {
  directory: string;
  command: string;
  file: string;
}

/** clang 无法解析的 GCC 专属 / 自定义 flag（从命令行中剔除） */
const CLANG_INCOMPATIBLE_FLAGS = [
  '-msave-restore',
  '-mjump-tables-in-text',
  '-mpure-code',
  '-mcmse',
  '-mlong-calls',
];

/** 按空白切分命令行，但保留引号内的路径（含空格） */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  // 裸 token 排除引号：形如 -I"path with space" 的粘连引号会被拆成 -I 与 "path with space" 两个 token，
  // 而非被 \S+ 贪婪匹配成 -I"path 这种坏 token
  const re = /"([^"]*)"|([^\s"]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command)) !== null) {
    tokens.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return tokens;
}

/** 含空白或 cmd 元字符则加引号 */
function quoteIfNeeded(t: string): string {
  return /[\s&|<>^()]/.test(t) ? `"${t}"` : t;
}

/** 对单条编译命令做 clang 兼容化：剔除不兼容 flag + 追加 -isystem */
function bakeCommand(command: string, systemIncludes: string[]): string {
  const tokens = tokenize(command).filter((t) => {
    if (t.startsWith('-march=')) return false;
    if (CLANG_INCOMPATIBLE_FLAGS.includes(t)) return false;
    return true;
  });
  for (const inc of systemIncludes) {
    tokens.push('-isystem', inc);
  }
  return tokens.map(quoteIfNeeded).join(' ');
}

/** 收集单个项目的编译单元（已做 clang 兼容化） */
export function collectClangdEntries(
  project: Project,
  compiler: Compiler,
  output: vscode.LogOutputChannel,
  systemIncludes: string[],
): CompileCommandEntry[] {
  const engine = new BuildEngine(project, compiler, output);
  return engine.collectCompileCommands().map((e) => ({
    directory: e.directory,
    file: e.file,
    command: bakeCommand(e.command, systemIncludes),
  }));
}

/** 把合并后的编译单元写入 compile_commands.json，返回路径与条数（内容未变则跳过写入） */
export function writeClangdDatabase(entries: CompileCommandEntry[], outDir: string): { outPath: string; count: number; skipped: boolean } {
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'compile_commands.json');
  const content = JSON.stringify(entries, null, 2) + '\n';

  // 内容未变则跳过写入，避免 clangd 无谓地重建索引
  try {
    if (fs.readFileSync(outPath, 'utf-8') === content) {
      return { outPath, count: entries.length, skipped: true };
    }
  } catch {
    // 文件不存在，正常写入
  }

  fs.writeFileSync(outPath, content, 'utf-8');
  return { outPath, count: entries.length, skipped: false };
}
