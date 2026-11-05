/**
 * 单工程构建内核（无 vscode 依赖）—— 从 extension.ts 的 `buildOneProject` 抽出。
 *
 * 为什么不复制逻辑：UI 构建、Language Model Tools、CLI/MCP 必须产出完全一致的
 * 命令、诊断与摘要；任何一份实现漂移都会让 agent 看到的与用户看到的不是同一件事。
 *
 * 调用方负责：构建互斥、活动工程切换、工作区级拓扑顺序、日志可见性。
 */
import * as path from 'path';
import { spawn } from 'child_process';
import { BuildTarget, Project, supportsCurrentPlatform } from '../model/types';
import { Compiler } from '../compiler/compiler';
import { BuildEngine } from './buildEngine';
import type { BuildCancelHandle } from './cancelToken';
import type { CbOutput } from './cbChannel';
import { OutputLineDecoder } from '../tools/encoding';
import { cbBuiltinVars, envVarMap, replaceCbMacros } from '../compiler/cbMacros';
import { logT } from './logLang';
import type { BuildDiagnosticsBudget, BuildLogDiagnostic, BuildLogProject } from './buildSummary';

/** `$make` / `$makefile` / `$target` 宏使用的命令键 */
export type MakeCommandKey = 'build' | 'compileFile' | 'clean' | 'distClean' | 'askRebuildNeeded' | 'silentBuild';

export interface BuildProjectDeps {
  output: CbOutput;
  /** 取编译器实例（等价扩展的 getCompiler） */
  getCompiler: (compilerId?: string) => Compiler;
  /** 目标级编译器解析（等价扩展的 resolveTargetCompiler） */
  resolveCompiler: (compilerId: string) => Compiler | undefined;
  /** 跨项目累计的诊断预算（工作区构建的截断语义由此保持） */
  budget: BuildDiagnosticsBudget;
  /** codeblocks.maxReportedErrors；0 = 不限制 */
  maxErrors: number;
  /** false = 诊断由 clangd 接管，不收集（对齐 buildLogUsesClangdDiagnostics） */
  collectDiagnostics?: boolean;
  /** 发布到 Problems 面板（UI 专用；CLI/MCP 不传）。参数为 vscode.Diagnostic / vscode.Uri，保持调用方零转换 */
  onDiagnostic?: (diag: unknown, fileUri?: unknown) => void;
  cancel?: BuildCancelHandle;
  /** makefile 模式 askRebuildNeeded 超时（默认 30s） */
  askRebuildTimeoutMs?: number;
}

export interface BuildProjectResult {
  ok: boolean;
  /** 结构化摘要；makefile 模式也给出，便于 agent 读取 */
  summary: BuildLogProject;
  /** 是否应写入 Build Log 视图（保持既有 UI 行为：makefile 模式不写） */
  reportToUi: boolean;
}

/** makefile 模式：展开 `$makefile` / `$make` / `$target` + CB 宏（对齐 GetMakeCommandFor） */
export function getMakeCommand(
  project: Project,
  target: BuildTarget | undefined,
  key: MakeCommandKey,
  getCompiler: (compilerId?: string) => Compiler,
): string | undefined {
  const raw = (target?.makeCommands?.[key] ?? '') || project.makeCommands[key];
  if (!raw) return undefined;
  const compiler = getCompiler(target?.compilerId || project.compilerId);
  const cmd = raw
    .replace(/\$makefile/g, project.makefile || 'Makefile')
    .replace(/\$make/g, compiler.programs.MAKE || 'make')
    .replace(/\$target/g, target?.title ?? '');
  const vars = { ...envVarMap(project.envVars, target?.envVars), ...cbBuiltinVars(project.basePath, target?.outputFilename ?? '', target?.title ?? '', target?.objectOutput ?? '', project.title, project.filename, compiler.masterPath) };
  return replaceCbMacros(cmd, { vars, customVars: project.customVariables ?? {}, basePath: project.basePath });
}

/** 运行一条 shell 命令并把完整行写入输出通道（makefile 模式专用） */
function runShellCommand(
  command: string,
  cwd: string,
  output: CbOutput,
  cancel?: BuildCancelHandle,
  timeoutMs?: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (code: number | null): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(code);
    };
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, { cwd, shell: true, windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try { proc.kill(); } catch { /* 进程可能已退出 */ }
        finish(null);
      }, timeoutMs);
    }
    cancel?.register(proc);
    const outDec = new OutputLineDecoder();
    const errDec = new OutputLineDecoder();
    const emit = (lines: string[]): void => {
      for (const line of lines) if (line.trim()) output.info(line);
    };
    proc.stdout?.on('data', (b: Buffer) => emit(outDec.push(b).lines));
    proc.stderr?.on('data', (b: Buffer) => emit(errDec.push(b).lines));
    proc.on('error', () => finish(null));
    proc.on('close', (code) => {
      emit(outDec.flush().lines);
      emit(errDec.flush().lines);
      cancel?.unregister(proc);
      finish(code);
    });
  });
}

/** makefile 模式：askRebuildNeeded（0 = 已最新） */
async function runMakeAskRebuild(
  askCmd: string,
  cwd: string,
  output: CbOutput,
  cancel?: BuildCancelHandle,
  timeoutMs = 30000,
): Promise<number | null> {
  const code = await runShellCommand(askCmd, cwd, output, cancel, timeoutMs);
  if (code === null) {
    output.warn(logT('[Code::Blocks] make askRebuildNeeded timed out ({0}s), continuing as "rebuild needed"', Math.round(timeoutMs / 1000)));
  }
  return code;
}

function emptySummary(project: Project, targetTitle: string, compiler: Compiler, ok: boolean, startMs: number): BuildLogProject {
  return {
    projectName: path.basename(path.dirname(project.filename)),
    targetName: targetTitle,
    compilerPath: compiler.programs.C || compiler.name,
    success: ok,
    compiledCount: 0,
    skippedCount: 0,
    failedCount: ok ? 0 : 1,
    linkSuccess: ok,
    linkSkipped: true,
    diagnostics: [],
    commands: [],
    files: [],
    durationMs: Date.now() - startMs,
    startTime: startMs,
    projectTitle: project.title,
  };
}

/** makefile 模式：Clean（对齐 UseMake → DoCleanWithMake） */
export async function cleanProjectTarget(
  project: Project,
  targetTitle: string,
  deps: BuildProjectDeps,
): Promise<BuildProjectResult> {
  const startMs = Date.now();
  const vt = project.virtualTargets.find((v) => v.title === targetTitle);
  const titles: string[] = vt ? vt.targets : [targetTitle];
  const compiler = deps.getCompiler(project.compilerId);
  const summary = emptySummary(project, targetTitle, compiler, true, startMs);
  let ok = true;

  for (const title of titles) {
    const target = project.buildTargets.find((t) => t.title === title);
    if (!target) continue;
    if (project.makefileIsCustom) {
      const cleanCmd = getMakeCommand(project, target, 'clean', deps.getCompiler);
      if (cleanCmd) {
        const cwd = project.executionDir ? path.resolve(project.basePath, project.executionDir) : project.basePath;
        const code = await runShellCommand(cleanCmd, cwd, deps.output, deps.cancel);
        if (code !== null && (code < 0 || code > (deps.getCompiler(target.compilerId || project.compilerId).switches.statusSuccess ?? 0))) {
          ok = false;
        }
        continue;
      }
    }
    const targetCompiler = deps.getCompiler(target.compilerId || project.compilerId);
    new BuildEngine(project, targetCompiler, deps.output, (id) => deps.resolveCompiler(id)).cleanTarget(target);
  }

  return {
    ok,
    reportToUi: false,
    summary: { ...summary, success: ok, failedCount: ok ? 0 : 1, linkSuccess: ok, durationMs: Date.now() - startMs },
  };
}

/**
 * 构建单个项目的一个目标（支持虚拟目标展开）。
 *
 * 与既有 UI 行为逐项对齐：平台不支持 → 跳过并返回成功；makefile 模式走 make；
 * 否则走 BuildEngine，并按 maxReportedErrors 截断结构化诊断。
 */
export async function buildProjectTarget(
  project: Project,
  targetTitle: string,
  rebuild: boolean,
  deps: BuildProjectDeps,
): Promise<BuildProjectResult> {
  const startMs = Date.now();
  const vt = project.virtualTargets.find((v) => v.title === targetTitle);
  const targetTitles: string[] = vt ? vt.targets : [targetTitle];
  const target = vt
    ? project.buildTargets.find((t) => vt.targets.includes(t.title))
    : project.buildTargets.find((t) => t.title === targetTitle);

  if (!target || !supportsCurrentPlatform(target.platforms)) {
    deps.output.warn(logT('[Code::Blocks] Project "{0}" has no target "{1}" (or does not support the current platform), skipped', project.title, targetTitle));
    return {
      ok: true,
      summary: emptySummary(project, targetTitle, deps.getCompiler(project.compilerId), true, startMs),
      reportToUi: false,
    };
  }

  // makefile 项目模式（对齐 UseMake：Build/Rebuild 走 make 命令而非内部引擎）
  if (project.makefileIsCustom) {
    const mkCompiler = deps.getCompiler(target.compilerId || project.compilerId);
    const cwd = project.executionDir ? path.resolve(project.basePath, project.executionDir) : project.basePath;
    const summary = emptySummary(project, targetTitle, mkCompiler, true, startMs);
    if (rebuild) {
      const cleanCmd = getMakeCommand(project, target, 'clean', deps.getCompiler);
      if (cleanCmd && !(await runShellCommand(cleanCmd, cwd, deps.output, deps.cancel))) {
        return { ok: false, summary: { ...summary, success: false, failedCount: 1, linkSuccess: false }, reportToUi: false };
      }
    }
    const buildCmd = getMakeCommand(project, target, 'build', deps.getCompiler);
    if (!buildCmd) {
      deps.output.error(logT('[Code::Blocks] Makefile project "{0}" has no <MakeCommands><Build command=...> configured', project.title));
      return { ok: false, summary: { ...summary, success: false, failedCount: 1, linkSuccess: false }, reportToUi: false };
    }
    const askCmd = getMakeCommand(project, target, 'askRebuildNeeded', deps.getCompiler);
    if (askCmd) {
      if (mkCompiler.switches.logging === 'full') {
        deps.output.info(`[Code::Blocks] Checking if target is up-to-date: ${askCmd}`);
      }
      const askCode = await runMakeAskRebuild(askCmd, cwd, deps.output, deps.cancel, deps.askRebuildTimeoutMs);
      if (askCode === 0) {
        deps.output.info(`[Code::Blocks] Target '${targetTitle}' is up to date. Nothing to be done.`);
        return { ok: true, summary, reportToUi: false };
      }
    }
    let command = buildCmd;
    if (mkCompiler.switches.logging !== 'full') {
      const silentCmd = getMakeCommand(project, target, 'silentBuild', deps.getCompiler);
      if (silentCmd) command = silentCmd;
    }
    deps.output.info(`[Code::Blocks] Make: ${command}`);
    const code = await runShellCommand(command, cwd, deps.output, deps.cancel);
    const ok = code !== null && code >= 0 && code <= (mkCompiler.switches.statusSuccess ?? 0);
    if (!ok) deps.output.error(logT('[Code::Blocks] make failed (exit {0})', code));
    return {
      ok,
      summary: { ...summary, success: ok, failedCount: ok ? 0 : 1, linkSuccess: ok, durationMs: Date.now() - startMs },
      reportToUi: false,
    };
  }

  const compiler = deps.getCompiler(target.compilerId || project.compilerId);
  const diagnostics: BuildLogDiagnostic[] = [];
  const collectDiagnostics = deps.collectDiagnostics !== false;
  const engine = new BuildEngine(project, compiler, deps.output, (id) => deps.resolveCompiler(id));
  const ok = await engine.build(targetTitles, {
    rebuild,
    cancel: deps.cancel,
    onLine: (line, severity) => {
      if (severity === 'error') deps.output.error(line);
      else if (severity === 'warning') deps.output.warn(line);
      else deps.output.info(line);
    },
    onDiagnostic: deps.onDiagnostic
      ? (diag, fileUri) => deps.onDiagnostic!(diag, fileUri)
      : undefined,
    onStructuredDiagnostic: (d) => {
      if (!collectDiagnostics) return;
      if (d.severity === 'error') {
        if (deps.maxErrors > 0 && deps.budget.errorCount >= deps.maxErrors) {
          deps.budget.truncated = true;
          return;
        }
        deps.budget.errorCount++;
      }
      diagnostics.push(d);
    },
  });

  const durationMs = Date.now() - startMs;
  const stats = engine.lastStats ?? { success: ok, compiledCount: 0, skippedCount: 0, failedCount: 0, linkSuccess: ok, linkSkipped: true, hadCommands: false, outputFilename: undefined };
  const cancelled = !!stats.cancelled || !!deps.cancel?.isCancelled();
  const projectFiles = new Set<string>();
  for (const f of project.files) projectFiles.add(f.absolutePath);
  for (const t of project.buildTargets) {
    for (const f of t.files) projectFiles.add(f.absolutePath);
  }

  return {
    ok,
    reportToUi: true,
    summary: {
      projectName: path.basename(path.dirname(project.filename)),
      targetName: targetTitle,
      compilerPath: compiler.programs.C || compiler.name,
      success: ok,
      compiledCount: stats.compiledCount,
      skippedCount: stats.skippedCount,
      failedCount: stats.failedCount,
      linkSuccess: stats.linkSuccess,
      linkSkipped: stats.linkSkipped,
      outputFilename: stats.outputFilename,
      diagnostics,
      commands: [...engine.lastCommands],
      files: [...projectFiles],
      durationMs,
      startTime: startMs,
      cancelled,
      projectTitle: project.title,
      topTimings: [...engine.lastCompileTimings],
    },
  };
}
