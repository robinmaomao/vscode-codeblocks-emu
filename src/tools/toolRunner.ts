/**
 * 用户自定义工具（Configure tools… 移植，第一波 E1）
 *
 * 纯逻辑：设置解析 + 别名宏展开 + CB 宏展开（`$(VAR)` 等）+ 引号感知分词；
 * 执行侧在 extension.ts（终端 / 输出通道 / 静默三种输出模式）。
 */
import { replaceCbMacros } from '../compiler/cbMacros';

export interface ToolDef {
  name: string;
  command: string;
  arguments?: string;
  workingDirectory?: string;
  env?: Record<string, string>;
  output: 'output' | 'terminal' | 'silent';
}

export interface ToolContext {
  /** 活动编辑器文件（绝对路径） */
  file?: string;
  fileDir?: string;
  projectDir?: string;
  projectName?: string;
  workspaceFolder?: string;
  /** 内置宏变量表（可传 cbBuiltinVars 结果；缺省时 `$(...)` 回退环境变量） */
  vars?: Record<string, string>;
  /** 项目自定义变量（`$(#var)`） */
  customVars?: Record<string, string>;
}

/** 解析 codeblocks.tools 设置：过滤缺少 name/command 的非法项，output 枚举兜底 */
export function parseToolsSetting(raw: unknown): ToolDef[] {
  if (!Array.isArray(raw)) return [];
  const out: ToolDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const name = typeof o.name === 'string' ? o.name.trim() : '';
    const command = typeof o.command === 'string' ? o.command.trim() : '';
    if (!name || !command) continue;
    out.push({
      name,
      command,
      arguments: typeof o.arguments === 'string' ? o.arguments : undefined,
      workingDirectory: typeof o.workingDirectory === 'string' ? o.workingDirectory : undefined,
      env: o.env && typeof o.env === 'object' ? (o.env as Record<string, string>) : undefined,
      output: o.output === 'terminal' || o.output === 'silent' ? o.output : 'output',
    });
  }
  return out;
}

/** 引号感知分词（双引号/单引号/裸 token；与 DAP launch args 同规则） */
export function splitToolArguments(s: string): string[] {
  if (!s.trim()) return [];
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out.push(m[1] ?? m[2] ?? m[3]);
  }
  return out;
}

/** 展开自定义工具的别名宏（`${file}` 等；不含 `${env:...}`，未知原样保留） */
export function expandToolAliases(s: string, ctx: ToolContext): string {
  return s
    .replace(/\$\{file\}/g, ctx.file ?? '')
    .replace(/\$\{fileDir\}/g, ctx.fileDir ?? '')
    .replace(/\$\{projectDir\}/g, ctx.projectDir ?? '')
    .replace(/\$\{projectName\}/g, ctx.projectName ?? '')
    .replace(/\$\{workspaceFolder\}/g, ctx.workspaceFolder ?? '');
}

/** 组装最终调用（别名宏 → CB 宏 `$(...)`（未命中回退环境变量）→ 分词） */
export function buildToolInvocation(tool: ToolDef, ctx: ToolContext): { command: string; args: string[]; cwd?: string } {
  const expand = (s: string): string =>
    replaceCbMacros(expandToolAliases(s, ctx), {
      vars: ctx.vars ?? {},
      customVars: ctx.customVars ?? {},
      basePath: ctx.projectDir,
    });
  return {
    command: expand(tool.command),
    args: splitToolArguments(tool.arguments ? expand(tool.arguments) : ''),
    cwd: tool.workingDirectory ? expand(tool.workingDirectory) : undefined,
  };
}
