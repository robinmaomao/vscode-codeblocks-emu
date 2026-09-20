/**
 * pre/post build 脚本引擎 —— 对应 compilergcc 的 pre/post build steps
 *
 * 移植自 codeblocks-src/src/plugins/compilergcc（GPL v3，逻辑独立重写）。
 * 支持两类：
 *   1. 外部命令（直接 shell 执行）
 *   2. Squirrel 脚本（Code::Blocks 用 .script/.sc；此处简化为可执行脚本）
 *
 * Code::Blocks 的 pre/post build step 支持宏（如 $(TARGET_OUTPUT_FILE)），
 * 此处实现宏展开后交由 shell 执行。
 */
import * as vscode from 'vscode';
import { spawn } from 'child_process';

/** 展开命令中的宏（Code::Blocks 变量风格） */
export function expandMacros(cmd: string, vars: Record<string, string>): string {
  let out = cmd;
  for (const [key, value] of Object.entries(vars)) {
    // $(KEY) 风格
    out = out.replace(new RegExp('\\$\\(' + key + '\\)', 'g'), value);
    // $KEY 风格（仅当 KEY 后跟非字母数字）
    out = out.replace(new RegExp('\\$' + key + '(?![A-Za-z0-9_])', 'g'), value);
  }
  return out;
}

export interface ScriptResult {
  success: boolean;
  output: string;
}

/** 执行单条脚本命令 */
export function runScriptCommand(
  command: string,
  cwd: string,
  vars: Record<string, string>,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const expanded = expandMacros(command, vars);
    const proc = spawn(expanded, {
      cwd,
      shell: true,
    });
    let output = '';
    proc.stdout?.on('data', (d: Buffer) => (output += d.toString()));
    proc.stderr?.on('data', (d: Buffer) => (output += d.toString()));
    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });
    proc.on('error', (err) => {
      resolve({ success: false, output: err.message });
    });
  });
}

/** 依次执行多条脚本命令 */
export async function runScriptCommands(
  commands: string[],
  cwd: string,
  vars: Record<string, string>,
  onLog?: (line: string) => void,
): Promise<boolean> {
  let ok = true;
  for (const cmd of commands) {
    if (onLog) onLog(`[script] ${cmd}`);
    const r = await runScriptCommand(cmd, cwd, vars);
    if (r.output) {
      for (const line of r.output.split(/\r?\n/)) {
        if (line) onLog?.(line);
      }
    }
    if (!r.success) ok = false;
  }
  return ok;
}

/** 为构建目标构造宏变量（对应 Code::Blocks 构建变量） */
export function buildMacroVars(
  basePath: string,
  outputFilename: string,
  targetTitle: string,
): Record<string, string> {
  return {
    TARGET_OUTPUT_FILE: outputFilename,
    TARGET_OUTPUT_BASENAME: outputFilename.replace(/\.[^.]+$/, ''),
    TARGET_OUTPUT_DIR: outputFilename.replace(/[\\/][^\\/]*$/, ''),
    TARGET_NAME: targetTitle,
    PROJECT_DIR: basePath,
    PROJECTNAME: targetTitle,
  };
}
