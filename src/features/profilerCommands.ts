/**
 * Profiler 命令 —— 从 extension.ts 拆出的 gprof 运行/导出编排。
 *
 * 依赖通过 `ProfilerCommandDeps` 注入：工程/目标选择、编译器、工作目录、命令行拆分与输出通道。
 * gprof 解析/格式化/CSV/HTML 等纯逻辑仍在 `tools/profiler.ts`。
 */
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { BuildTarget, Project } from '../model/types';
import { supportsCurrentPlatform } from '../model/types';
import { cbBuiltinVars, envVarMap, replaceCbMacros } from '../compiler/cbMacros';
import type { Compiler } from '../compiler/compiler';
import { isExecutableTargetType, resolveExecutablePath } from '../build/outputPath';
import {
  formatProfilerCallGraph,
  formatProfilerTable,
  isFreshGmon,
  parseGprofCallGraph,
  parseGprofFlatProfile,
  profilerReportHtml,
  profilerRowsToCsv,
  runCapture,
  type GprofCallGraphEntry,
  type GprofRow,
} from '../tools/profiler';
import * as i18n from '../i18n';

export interface ProfilerCommandDeps {
  getProject(): Project | undefined;
  getSelectedTarget(project: Project): string | undefined;
  getCompiler(compilerId?: string): Compiler | undefined;
  runWorkingDir(project: Project, target: BuildTarget, vars: Record<string, string>): string;
  splitCommandLine(command: string): string[];
  profilerChannel(): vscode.OutputChannel;
  annotatedChannel(): vscode.OutputChannel;
}

/** gprof 命令（设置 codeblocks.profiler.gprofPath，空 = PATH 中的 gprof） */
export function resolveGprofCommand(): string {
  return vscode.workspace.getConfiguration('codeblocks').get<string>('profiler.gprofPath', '').trim() || 'gprof';
}

/** 是否运行 `gprof -A` 并把注解源码写入输出通道（codeblocks.profiler.annotatedSource） */
export function annotatedSourceEnabled(): boolean {
  return vscode.workspace.getConfiguration('codeblocks').get<boolean>('profiler.annotatedSource', true);
}

/** Profile target（gprof）—— 对齐 CB Tools → Profiler（cbprofiler.cpp:83-255） */
export async function profileTarget(deps: ProfilerCommandDeps): Promise<void> {
  const project = deps.getProject();
  if (!project) return;
  const target = project.buildTargets.find((t) => t.title === deps.getSelectedTarget(project))
    ?? project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms) && isExecutableTargetType(t.targetType));
  if (!target) {
    vscode.window.showWarningMessage(i18n.t('No executable build target is available for profiling'));
    return;
  }
  if (!isExecutableTargetType(target.targetType)) {
    vscode.window.showWarningMessage(i18n.t('Only executable targets can be profiled'));
    return;
  }
  const vars = {
    ...envVarMap(project.envVars, target.envVars),
    ...cbBuiltinVars(project.basePath, target.outputFilename, target.title, target.objectOutput, project.title, project.filename, deps.getCompiler(target.compilerId || project.compilerId)?.masterPath ?? ''),
  };
  const expandedOut = replaceCbMacros(target.outputFilename, { vars, customVars: project.customVariables ?? {}, basePath: project.basePath });
  const exePath = resolveExecutablePath(project.basePath, expandedOut, process.platform, true);
  if (!fs.existsSync(exePath)) {
    vscode.window.showErrorMessage(i18n.t('The executable does not exist — build first ({0})', path.relative(project.basePath, exePath)));
    return;
  }
  const flags = [...(target.compilerOptions ?? []), ...(project.compilerOptions ?? []), ...(target.linkerOptions ?? []), ...(project.linkerOptions ?? [])].join(' ');
  if (!/(^|\s)-pg(\s|$)/.test(flags)) {
    const proceed = i18n.t('Profile Anyway');
    const answer = await vscode.window.showWarningMessage(
      i18n.t('The target does not appear to be built with -pg; gmon.out may not be produced. Continue?'),
      { modal: true },
      proceed,
    );
    if (answer !== proceed) return;
  }
  const cwd = deps.runWorkingDir(project, target, vars);
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  for (const ev of [...project.envVars, ...target.envVars]) env[ev.name] = ev.value;
  const args = deps.splitCommandLine(target.executionParameters ?? '');
  const gmonCandidates = [path.join(path.dirname(exePath), 'gmon.out'), path.join(cwd, 'gmon.out')];
  const gmonBefore = new Map<string, { mtimeMs: number; size: number }>();
  for (const candidate of gmonCandidates) {
    try {
      const st = fs.statSync(candidate);
      gmonBefore.set(candidate, { mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      // 不存在即为旧数据；运行后出现即视为本次生成
    }
  }
  const ch = deps.profilerChannel();
  ch.appendLine(i18n.t('Profiling target: {0}', target.title));
  ch.appendLine(`> "${exePath}" ${args.join(' ')}`);
  ch.show(true);

  const runResult = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: i18n.t('Running {0} for profiling…', target.title), cancellable: false },
    () => runCapture(exePath, args, { cwd, env, timeoutMs: 5 * 60 * 1000 }, (line) => ch.appendLine(line)),
  );
  if (runResult.code !== 0) {
    ch.appendLine(i18n.t('The profiled program exited with code {0}; profiling continues if gmon.out exists.', runResult.code ?? '?'));
  }

  const gmon = gmonCandidates.find((p) => {
    try {
      const st = fs.statSync(p);
      return isFreshGmon(gmonBefore.get(p), { mtimeMs: st.mtimeMs, size: st.size });
    } catch {
      return false;
    }
  });
  if (!gmon) {
    vscode.window.showErrorMessage(i18n.t('A fresh gmon.out was not found — rebuild the target with -pg and run it again'));
    return;
  }
  const gprof = resolveGprofCommand();
  ch.appendLine(i18n.t('Running gprof: {0} "{1}" "{2}"', gprof, exePath, gmon));
  try {
    const gprofResult = await runCapture(gprof, [exePath, gmon], { cwd: path.dirname(exePath), timeoutMs: 2 * 60 * 1000 }, (line, stream) => {
      if (stream === 'stderr') ch.appendLine(line);
    });
    if (gprofResult.code !== 0) {
      vscode.window.showErrorMessage(i18n.t('gprof failed (exit code {0}) — see the Code::Blocks Profiler output', gprofResult.code ?? '?'));
      return;
    }
    const rows = parseGprofFlatProfile(gprofResult.stdout);
    if (!rows.length) {
      vscode.window.showWarningMessage(i18n.t('gprof produced no flat-profile rows'));
      ch.appendLine(gprofResult.stdout);
      return;
    }
    const callGraph = parseGprofCallGraph(gprofResult.stdout);
    ch.appendLine('');
    ch.appendLine(formatProfilerTable(rows));
    ch.appendLine('');
    ch.appendLine(i18n.t('Flat profile: {0} function(s)', rows.length));
    if (callGraph.length) {
      ch.appendLine('');
      ch.appendLine(i18n.t('Call graph: {0} function(s)', callGraph.length));
      ch.appendLine(formatProfilerCallGraph(callGraph));
    }

    if (annotatedSourceEnabled()) {
      try {
        const annotatedDir = path.dirname(exePath);
        const annotatedBefore = new Set(fs.readdirSync(annotatedDir).filter((name) => name.endsWith('.annotated')));
        let annotated = await runCapture(gprof, ['-A', '-l', exePath, gmon], { cwd: annotatedDir, timeoutMs: 2 * 60 * 1000 });
        let annotatedText = annotated.stdout;
        if (annotated.code === 0 && !annotatedText.trim()) {
          const separate = await runCapture(gprof, ['-A', '-l', '--separate-files', exePath, gmon], { cwd: annotatedDir, timeoutMs: 2 * 60 * 1000 });
          const created = fs.readdirSync(annotatedDir).filter((name) => name.endsWith('.annotated') && !annotatedBefore.has(name));
          if (created.length) {
            annotatedText = created.map((name) => `--- ${name} ---\n${fs.readFileSync(path.join(annotatedDir, name), 'utf-8')}`).join('\n');
          } else if (separate.stdout.trim()) {
            annotatedText = separate.stdout;
          }
        }
        if (annotated.code === 0 && annotatedText.trim()) {
          const sourceChannel = deps.annotatedChannel();
          sourceChannel.appendLine(i18n.t('Annotated source for {0}', target.title));
          sourceChannel.appendLine(annotatedText);
          sourceChannel.show(true);
        } else if (annotated.stderr.trim()) {
          ch.appendLine(annotated.stderr);
        } else {
          ch.appendLine(i18n.t('gprof -A produced no annotated source (build with debug information and check the source paths)'));
        }
      } catch (err) {
        ch.appendLine(i18n.t('Failed to run gprof -A: {0}', (err as Error).message));
      }
    }

    const exportCsv = i18n.t('Export CSV…');
    const exportHtml = i18n.t('Export HTML…');
    const showCallGraph = i18n.t('Show Call Graph');
    const action = await vscode.window.showQuickPick(
      [showCallGraph, exportCsv, exportHtml],
      { placeHolder: i18n.t('Profiling finished: {0} function(s)', rows.length) },
    );
    if (action === showCallGraph) {
      if (!callGraph.length) {
        vscode.window.showWarningMessage(i18n.t('gprof produced no call-graph entries'));
      } else {
        ch.appendLine('');
        ch.appendLine(formatProfilerCallGraph(callGraph));
        ch.show(true);
      }
    } else if (action === exportCsv || action === exportHtml) {
      await exportProfilerReport(target.title, exePath, rows, callGraph, action === exportCsv ? 'csv' : 'html');
    }
  } catch (err) {
    vscode.window.showErrorMessage(i18n.t('Failed to run gprof: {0}', (err as Error).message));
  }
}

/** 导出 Profiler 报告（CSV / 自包含 HTML）。 */
export async function exportProfilerReport(
  targetName: string,
  exePath: string,
  rows: GprofRow[],
  callGraph: GprofCallGraphEntry[],
  format: 'csv' | 'html',
): Promise<void> {
  const safeName = targetName.replace(/[^\w.-]+/g, '-') || 'target';
  const baseDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(exePath);
  const defaultUri = vscode.Uri.file(path.join(baseDir, `gprof-${safeName}.${format}`));
  const picked = await vscode.window.showSaveDialog({
    defaultUri,
    filters: format === 'csv' ? { CSV: ['csv'] } : { HTML: ['html', 'htm'] },
  });
  if (!picked) return;
  const content = format === 'csv'
    ? profilerRowsToCsv(rows)
    : profilerReportHtml({ target: targetName, executable: exePath, rows, callGraph });
  try {
    const { writeFileAtomicSync } = await import('../model/atomicWrite');
    writeFileAtomicSync(picked.fsPath, content, 'utf-8');
    vscode.window.showInformationMessage(i18n.t('Profiler report saved: {0}', picked.fsPath));
  } catch (err) {
    vscode.window.showErrorMessage(i18n.t('Failed to save profiler report: {0}', (err as Error).message));
  }
}

export function registerProfilerCommands(context: vscode.ExtensionContext, deps: ProfilerCommandDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codeblocks.profileTarget', () => profileTarget(deps)),
  );
}
