/**
 * 运行服务（无 vscode 依赖）：解析目标产物并 spawn，捕获输出与退出码。
 *
 * 与扩展 `run()` 的差异：扩展把命令丢进集成终端（交互式），这里必须在
 * 受控环境里拿到退出码，因此直接 spawn；交互式 stdin 程序不在本服务范围内。
 */
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { BuildTarget, Project, TargetType } from '../model/types';
import { cbBuiltinVars, envVarMap, replaceCbMacros } from '../compiler/cbMacros';
import { expandMacros } from '../build/scriptRunner';
import { isExecutableTargetType, requiresExecutableExtensionForLaunch, resolveExecutablePath } from '../build/outputPath';
import { killProcessTree } from '../build/cancelToken';
import { OutputLineDecoder } from '../tools/encoding';
import { loadProject } from './projectStore';
import { selectBuildTarget } from './buildService';
import type { CompilerProvider } from './compilerService';
import { fail } from './types';

export interface RunRequest {
  cbp: string;
  target?: string;
  /** 覆盖目标里配置的执行参数 */
  args?: string;
  /** 覆盖工作目录 */
  cwd?: string;
  timeoutMs?: number;
}

export interface RunServiceDeps {
  compiler: CompilerProvider;
}

export interface RunOutcome {
  ok: boolean;
  executable: string;
  args: string;
  cwd: string;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

/** 运行工作目录（对齐 GetWorkingDir：空 = 输出文件目录；仅控制台/可执行/动态库目标生效） */
export function resolveRunWorkingDir(project: Project, target: BuildTarget, vars: Record<string, string>): string {
  const tt = target.targetType;
  if (tt !== TargetType.ConsoleOnly && tt !== TargetType.Executable && tt !== TargetType.DynamicLib) {
    return project.basePath;
  }
  const wd = (target.workingDir ?? '').trim();
  if (wd) {
    const envExp = wd.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)/g, (_m, n: string) => process.env[n] ?? '');
    return path.resolve(project.basePath, envExp);
  }
  const expOut = replaceCbMacros(target.outputFilename, {
    vars,
    customVars: project.customVariables ?? {},
  }).replace(/\\/g, '/');
  const idx = expOut.lastIndexOf('/');
  if (idx < 0) return project.basePath;
  return path.resolve(project.basePath, expOut.slice(0, idx));
}

/** 解析运行计划（host 程序 / 可执行文件 / 参数 / 环境） */
export function resolveRunPlan(req: RunRequest, deps: RunServiceDeps): {
  project: Project;
  target: BuildTarget;
  executable: string;
  args: string;
  cwd: string;
  env: Record<string, string>;
  isHostApplication: boolean;
} {
  const project = loadProject(req.cbp);
  const targetTitle = selectBuildTarget(project, req.target);
  const target = project.buildTargets.find((t) => t.title === targetTitle)!;
  const masterPath = deps.compiler.getCompiler(target.compilerId || project.compilerId)?.masterPath ?? '';
  const vars = {
    ...envVarMap(project.envVars, target.envVars),
    ...cbBuiltinVars(project.basePath, target.outputFilename, target.title, target.objectOutput, project.title, project.filename, masterPath),
  };
  const env: Record<string, string> = {};
  for (const ev of [...project.envVars, ...target.envVars]) env[ev.name] = ev.value;
  const args = req.args !== undefined ? req.args : (target.executionParameters ? expandMacros(target.executionParameters, vars) : '');
  const cwd = req.cwd ? path.resolve(req.cwd) : resolveRunWorkingDir(project, target, vars);

  const tt = target.targetType;
  if (tt === TargetType.DynamicLib || tt === TargetType.StaticLib || tt === TargetType.CommandsOnly) {
    const host = target.hostApplication
      ? replaceCbMacros(target.hostApplication, { vars, customVars: project.customVariables ?? {} })
      : '';
    if (!host) fail('invalid-input', 'You must select a host application to run a library target');
    if (!fs.existsSync(host)) fail('invalid-input', `The host application does not exist: ${host}`);
    return { project, target, executable: host, args, cwd, env, isHostApplication: true };
  }

  const expandedOut = replaceCbMacros(target.outputFilename, { vars, customVars: project.customVariables ?? {}, basePath: project.basePath });
  const exePath = resolveExecutablePath(project.basePath, expandedOut, process.platform, isExecutableTargetType(target.targetType));
  if (!fs.existsSync(exePath)) {
    fail('invalid-input', `The executable does not exist — build first: ${exePath}`);
  }
  if (requiresExecutableExtensionForLaunch(exePath, process.platform)) {
    fail('invalid-input', `The output has no executable extension: ${path.basename(exePath)}`, {
      hint: 'Add an extension to the target output file name (e.g. .exe) or keep "automatic extension".',
    });
  }
  return { project, target, executable: exePath, args, cwd, env, isHostApplication: false };
}

/** 运行目标产物并捕获输出 */
export async function runProject(req: RunRequest, deps: RunServiceDeps): Promise<RunOutcome> {
  const plan = resolveRunPlan(req, deps);
  const timeoutMs = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 0;
  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];

  return new Promise<RunOutcome>((resolve) => {
    let done = false;
    let timedOut = false;
    const proc = spawn(plan.executable, plan.args ? splitArgs(plan.args) : [], {
      cwd: plan.cwd,
      env: { ...process.env, ...plan.env } as NodeJS.ProcessEnv,
      windowsHide: true,
    });
    const outDec = new OutputLineDecoder();
    const errDec = new OutputLineDecoder();
    proc.stdout?.on('data', (b: Buffer) => stdoutLines.push(...outDec.push(b).lines));
    proc.stderr?.on('data', (b: Buffer) => stderrLines.push(...errDec.push(b).lines));
    const finish = (exitCode: number | null): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      stdoutLines.push(...outDec.flush().lines);
      stderrLines.push(...errDec.flush().lines);
      resolve({
        ok: exitCode === 0 && !timedOut,
        executable: plan.executable,
        args: plan.args,
        cwd: plan.cwd,
        exitCode,
        timedOut,
        stdout: stdoutLines.join('\n'),
        stderr: stderrLines.join('\n'),
      });
    };
    const timer = timeoutMs
      ? setTimeout(() => { timedOut = true; try { killProcessTree(proc); } catch { /* 已退出 */ } }, timeoutMs)
      : undefined;
    proc.on('error', (err) => {
      stderrLines.push((err as Error).message);
      finish(null);
    });
    proc.on('close', (code) => finish(code));
  });
}

/** 参数串拆分（支持双引号；与 CB 的执行参数习惯一致） */
export function splitArgs(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | '' = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === quote) { quote = ''; continue; }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch as '"' | "'"; continue; }
    if (/\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ''; }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}
