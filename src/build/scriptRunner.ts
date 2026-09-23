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
import { decodeText } from '../tools/encoding';
import { getWindowsSystemPath } from '../tools/windowsPath';

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

/** 解码子进程输出：UTF-8 严格优先，失败回退 GBK（中文 Windows） */
function decodeOutput(buf: Buffer): string {
  return decodeText(buf);
}

/** 合并 PATH 段并去重（Windows 分号分隔，忽略大小写去重，保持顺序） */
function mergePath(...parts: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    for (const seg of part.split(';')) {
      const s = seg.trim();
      const key = s.toLowerCase();
      if (s && !seen.has(key)) {
        seen.add(key);
        out.push(s);
      }
    }
  }
  return out.join(';');
}

/** 执行单条脚本命令（可附加环境变量，如编译器 bin 目录加入 PATH） */
export function runScriptCommand(
  command: string,
  cwd: string,
  vars: Record<string, string>,
  extraPath?: string,
): Promise<ScriptResult> {
  return new Promise((resolve) => {
    const expanded = expandMacros(command, vars);
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    if (process.platform === 'win32') {
      // Windows：实时读取系统 PATH（注册表 Machine+User），宿主进程 PATH 快照可能过期
      env.PATH = mergePath(getWindowsSystemPath(), env.PATH ?? '');
    }
    if (extraPath) {
      const sep = process.platform === 'win32' ? ';' : ':';
      env.PATH = extraPath + sep + (env.PATH ?? '');
    }
    const proc = spawn(expanded, {
      cwd,
      shell: true,
      env,
    });
    let output = '';
    proc.stdout?.on('data', (d: Buffer) => (output += decodeOutput(d)));
    proc.stderr?.on('data', (d: Buffer) => (output += decodeOutput(d)));
    proc.on('close', (code) => {
      resolve({ success: code === 0, output });
    });
    proc.on('error', (err) => {
      resolve({ success: false, output: err.message });
    });
  });
}

/** 依次执行多条脚本命令（可附加编译器 bin 目录到 PATH） */
export async function runScriptCommands(
  commands: string[],
  cwd: string,
  vars: Record<string, string>,
  onLog?: (line: string) => void,
  extraPath?: string,
): Promise<boolean> {
  let ok = true;
  for (const cmd of commands) {
    if (onLog) onLog(`[script] ${cmd}`);
    const r = await runScriptCommand(cmd, cwd, vars, extraPath);
    if (r.output) {
      for (const line of r.output.split(/\r?\n/)) {
        if (line) onLog?.(line);
      }
    }
    if (!r.success) ok = false;
  }
  return ok;
}

/** 为构建目标构造宏变量（对应 Code::Blocks macrosmanager.cpp 的构建变量） */
export function buildMacroVars(
  basePath: string,
  outputFilename: string,
  targetTitle: string,
  objectOutput = 'obj/',
  projectTitle = targetTitle,
  projectFilename = outputFilename,
): Record<string, string> {
  const toUnix = (s: string) => s.replace(/\\/g, '/');
  const out = toUnix(outputFilename);
  // 去掉文件名，保留目录（含结尾斜杠）；无目录则为空
  const outDir = out.includes('/') ? out.slice(0, out.lastIndexOf('/') + 1) : '';
  const baseName = out.includes('/') ? out.slice(out.lastIndexOf('/') + 1) : out;
  const stem = baseName.replace(/\.[^.]+$/, '');

  return {
    // 目标相关（macrosmanager.cpp）
    TARGET_OUTPUT_FILE: out,
    TARGET_OUTPUT_FILENAME: baseName,
    TARGET_OUTPUT_BASENAME: stem,
    TARGET_OUTPUT_DIR: outDir,
    TARGET_NAME: targetTitle,
    TARGET_OBJECT_DIR: toUnix(objectOutput),
    // 项目相关（对齐 cbProject::GetTitle / GetFilename 语义）
    PROJECT_DIR: basePath,
    PROJECT_DIRECTORY: basePath,
    PROJECT_NAME: projectTitle,
    PROJECTNAME: projectTitle,
    PROJECT_FILENAME: projectFilename,
  };
}
