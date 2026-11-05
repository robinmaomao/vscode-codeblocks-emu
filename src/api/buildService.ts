/**
 * 构建服务（无 vscode 依赖）：CLI / MCP 的构建入口，复用扩展同一份构建内核。
 */
import { supportsCurrentPlatform } from '../model/types';
import { applyGeneratedFiles } from '../build/generatedFiles';
import { buildProjectTarget, cleanProjectTarget, BuildProjectDeps } from '../build/buildProject';
import { BuildCancelSource } from '../build/cancelToken';
import type { BuildCancelHandle } from '../build/cancelToken';
import type { BuildDiagnosticsBudget, BuildLogProject, BuildLogSummary } from '../build/buildSummary';
import { loadProject } from './projectStore';
import type { CompilerProvider } from './compilerService';
import type { CompilerSettingsLike } from '../compiler/compilerFactory';
import { fail } from './types';

export type BuildMode = 'build' | 'rebuild' | 'clean';

export interface BuildRequest {
  cbp: string;
  /** 目标标题；缺省 = 第一个支持当前平台的目标 */
  target?: string;
  mode?: BuildMode;
  /** 超时（毫秒）；到时取消并返回 timeout 错误 */
  timeoutMs?: number;
}

export interface BuildServiceDeps {
  compiler: CompilerProvider;
  settings: CompilerSettingsLike;
  /** 输出通道（CLI 传 stderr sink） */
  output: BuildProjectDeps['output'];
  cancel?: BuildCancelHandle;
  onDiagnostic?: BuildProjectDeps['onDiagnostic'];
  collectDiagnostics?: boolean;
}

export interface BuildOutcome {
  ok: boolean;
  target: string;
  summary: BuildLogSummary;
  timedOut: boolean;
}

/** 解析目标：显式指定优先，否则第一个支持当前平台的物理目标 */
export function selectBuildTarget(project: ReturnType<typeof loadProject>, requested?: string): string {
  if (requested) {
    const vt = project.virtualTargets.find((v) => v.title === requested);
    if (vt) return requested;
    const exact = project.buildTargets.find((t) => t.title === requested);
    if (exact) return exact.title;
    fail('invalid-input', `Target not found: ${requested}`, { targets: project.buildTargets.map((t) => t.title) });
  }
  const fallback = project.buildTargets.find((t) => supportsCurrentPlatform(t.platforms));
  if (!fallback) fail('unsupported', 'The project has no build target usable on the current platform');
  return fallback!.title;
}

/** 构建 / 重建 / 清理单个工程 */
export async function buildProject(req: BuildRequest, deps: BuildServiceDeps): Promise<BuildOutcome> {
  const project = loadProject(req.cbp);
  const target = selectBuildTarget(project, req.target);
  const mode: BuildMode = req.mode ?? 'build';

  // 与 UI 一致：生成文件先并入模型（编译器 XML 的 gen 属性）
  applyGeneratedFiles(project, (id) => deps.compiler.getCompiler(id));

  const budget: BuildDiagnosticsBudget = { errorCount: 0, truncated: false };
  const timeoutMs = req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : 0;
  const cancelSource = new BuildCancelSource();
  const cancel: BuildCancelHandle = deps.cancel ?? cancelSource;
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      cancelSource.cancel();
    }, timeoutMs);
  }

  const coreDeps: BuildProjectDeps = {
    output: deps.output,
    getCompiler: (id) => deps.compiler.getCompiler(id),
    resolveCompiler: (id) => deps.compiler.resolveTargetCompiler(id),
    budget,
    maxErrors: deps.settings.get<number>('maxReportedErrors', 50),
    collectDiagnostics: deps.collectDiagnostics,
    onDiagnostic: deps.onDiagnostic,
    cancel,
  };

  try {
    const result = mode === 'clean'
      ? await cleanProjectTarget(project, target, coreDeps)
      : await buildProjectTarget(project, target, mode === 'rebuild', coreDeps);

    const projectEntry: BuildLogProject = result.summary;
    const errorCount = projectEntry.diagnostics.filter((d) => d.severity === 'error').length;
    const warningCount = projectEntry.diagnostics.filter((d) => d.severity === 'warning').length;
    const summary: BuildLogSummary = {
      success: result.ok,
      durationMs: projectEntry.durationMs,
      startTime: projectEntry.startTime,
      projects: [projectEntry],
      errorCount,
      warningCount,
      truncated: budget.truncated,
    };
    return { ok: result.ok, target, summary, timedOut };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
