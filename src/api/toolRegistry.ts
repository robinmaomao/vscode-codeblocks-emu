/**
 * Agent 工具注册表（无 vscode 依赖）——Language Model Tools / MCP / CLI 共用。
 *
 * 单一来源的好处：三端的参数校验、错误码、行为完全一致；
 * `package.json` 的 `contributes.languageModelTools` 由契约测试与本表逐项比对。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Project } from '../model/types';
import type { Compiler } from '../compiler/compiler';
import type { BuildCancelHandle } from '../build/cancelToken';
import type { BuildLogSummary } from '../build/buildSummary';
import { applyEdits, applyUnitOptionToText, isPreserveCapable } from './projectEdit';
import { projectSnapshot, QUERY_SECTIONS, QuerySection, workspaceSnapshot } from './projectQuery';
import { buildProject, BuildMode, BuildOutcome, BuildRequest, selectBuildTarget } from './buildService';
import { runProject, RunOutcome, RunRequest, DEFAULT_RUN_TIMEOUT_MS } from './runService';
import { EXPORT_KINDS, exportProject, ExportKind, ExportOutcome } from './exportService';
import { captureSignature, loadWorkspace, readProjectText, requireCbpPath, signatureChanged, updateWorkspaceDependencies, writeTextAtomic } from './projectStore';
import type { CompilerProvider } from './compilerService';
import type { CompilerSettingsLike } from '../compiler/compilerFactory';
import type { CbOutput } from '../build/cbChannel';
import { ControlError, EditChange, EditOp, fail, requireWriteFormat, WRITE_FORMATS } from './types';
import { normalizeDebugResult } from './debugShapes';
import { isReadOnlyToolCall, READ_ONLY_HINT, SCRIPT_POLICY_HINT } from './agentPolicy';

export interface OpenProjectInfo {
  filename: string;
  title: string;
  active: boolean;
}

/** 调试桥（扩展内用 vscode.debug；CLI/MCP 用 debugService） */
export interface DebugBridge {
  start(req: { cbp?: string; target?: string; args?: string; stopOnEntry?: boolean; file?: string; lines?: number[]; timeoutMs?: number }): Promise<unknown>;
  stop(): Promise<unknown>;
  setBreakpoints(req: { cbp?: string; file: string; lines: number[] }): Promise<unknown>;
  state(): Promise<unknown>;
  stack(): Promise<unknown>;
  variables(req?: { frameId?: number }): Promise<unknown>;
  evaluate(req: { expression: string; frameId?: number }): Promise<unknown>;
  continue(req?: { timeoutMs?: number }): Promise<unknown>;
  step(req: { kind: 'next' | 'stepIn' | 'stepOut'; timeoutMs?: number }): Promise<unknown>;
}

/** 工具执行上下文 */
export interface ToolContext {
  settings: CompilerSettingsLike;
  compiler: CompilerProvider;
  output: CbOutput;
  /** 工程读取（扩展：已打开则用内存模型；CLI/MCP：磁盘） */
  loadProject: (cbp: string) => Promise<Project>;
  /** 工程写回（扩展：persistProjectAndReload；CLI/MCP：原子写） */
  saveProject: (project: Project, opts: { force?: boolean; isExternallyModified?: (f: string) => boolean }) => Promise<void>;
  /** 工程重新解析（preserve 定点写盘后刷新内存模型） */
  reloadProject?: (cbp: string) => Promise<void>;
  /** 扩展内是否已被外部修改 */
  isExternallyModified?: (file: string) => boolean;
  listOpenProjects?: () => OpenProjectInfo[];
  setActiveProject?: (cbp: string) => Promise<void>;
  openProject?: (cbp: string) => Promise<void>;
  closeProject?: (cbp: string) => Promise<void>;
  /** 构建（扩展：走 UI 可见路径；CLI/MCP：buildService） */
  build: (req: BuildRequest) => Promise<BuildOutcome>;
  /** 最近一次构建摘要 */
  lastBuild?: () => BuildLogSummary | undefined;
  /** 构建互斥状态（扩展） */
  isBuildInProgress?: () => boolean;
  cancelBuild?: BuildCancelHandle;
  debug?: DebugBridge;
  /** 只读模式（LM Tools / MCP 按设置注入；CLI 不注入 ⇒ 行为不变） */
  readOnly?: boolean;
  /** 全局脚本策略（LM Tools / MCP 注入；false = 禁止脚本字段，CLI 不注入） */
  allowScripts?: boolean;
  /**
   * 编译器系统 include 路径（可选；扩展用 `queryCompilerSystemIncludes` 提供）。
   * 导出 compile_commands 时补齐 `-isystem`，与 UI 的「生成 compile_commands」保持一致；
   * CLI/MCP 不提供时退化为旧行为（不补系统头）。
   */
  systemIncludes?: (project: Project, compiler: Compiler) => string[];
}

export interface ToolInputSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: ToolInputSchema;
  handler(ctx: ToolContext, input: Record<string, unknown>): Promise<unknown>;
}

function activeCbp(ctx: ToolContext): string | undefined {
  const open = ctx.listOpenProjects?.() ?? [];
  return open.find((p) => p.active)?.filename ?? open[0]?.filename;
}

/** 解析目标工程：显式 cbp > 活动工程 */
export function resolveCbp(ctx: ToolContext, input: Record<string, unknown>): string {
  const explicit = optionalText(input, 'cbp');
  if (explicit) return requireCbpPath(explicit);
  const active = activeCbp(ctx);
  if (active) return active;
  fail('invalid-input', 'No project specified and no active Code::Blocks project', {
    hint: 'Pass "cbp" (absolute path) or open a .cbp in the editor first.',
  });
  return '';
}

async function loadForEdit(ctx: ToolContext, cbp: string): Promise<Project> {
  // 编辑在**副本**上进行：applyEdits 是就地修改，若中途校验失败（如第 2 个 op 非法），
  // 宿主的已打开工程（ctx.loadProject 返回内存实例）会被写入一半的改动。
  const project = await ctx.loadProject(cbp);
  return JSON.parse(JSON.stringify(project)) as Project;
}

// ———— 运行期参数校验（schema enum 只在 LM 侧生效；CLI/MCP 必须由 handler 自己挡） ————

/** 可选字符串：显式给出时不允许空串（`--target ""` 不得静默按缺省处理） */
function optionalText(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !v.trim()) {
    fail('invalid-input', `${key} must be a non-empty string`, { got: v });
  }
  return v;
}

/** 可选有限数字：非数字 / NaN / Infinity / 越界一律报错 */
function optionalNumber(
  input: Record<string, unknown>,
  key: string,
  opts: { min?: number; integer?: boolean } = {},
): number | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    fail('invalid-input', `${key} must be a finite number`, { got: v });
  }
  if (opts.integer && !Number.isInteger(v)) {
    fail('invalid-input', `${key} must be an integer`, { got: v });
  }
  if (opts.min !== undefined && v < opts.min) {
    fail('invalid-input', `${key} must be >= ${opts.min}`, { got: v });
  }
  return v;
}

/** 可选字符串数组（允许空数组；元素必须是字符串） */
function optionalStringArray(input: Record<string, unknown>, key: string): string[] | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    fail('invalid-input', `${key} must be an array of strings`, { got: v });
  }
  return v as string[];
}

// ———— 工具实现 ————

const projectRead: ToolDefinition = {
  name: 'codeblocks_project_read',
  title: 'Code::Blocks: Read project',
  description: 'Read a Code::Blocks .cbp project model (summary, targets, files, options) or the editable field schema.',
  inputSchema: {
    type: 'object',
    properties: {
      cbp: { type: 'string', description: 'Absolute path to the .cbp (defaults to the active project)' },
      section: { type: 'string', enum: [...QUERY_SECTIONS], description: 'Which slice to return' },
      target: { type: 'string', description: 'Restrict targets/files/options to one target title' },
    },
  },
  async handler(ctx, input) {
    const rawSection = input.section;
    if (rawSection !== undefined && (typeof rawSection !== 'string' || !(QUERY_SECTIONS as readonly string[]).includes(rawSection))) {
      fail('invalid-input', `Unknown section: ${String(rawSection)}`, { allowed: [...QUERY_SECTIONS] });
    }
    const section = (rawSection as QuerySection | undefined) ?? 'all';
    if (section === 'schema') {
      return { schema: projectSnapshot({ buildTargets: [], files: [] } as unknown as Project, { section: 'schema' }).schema };
    }
    const cbp = resolveCbp(ctx, input);
    const target = optionalText(input, 'target');
    const project = await ctx.loadProject(cbp);
    // 未知 target 必须显式报错：返回 { ok:true, error } 会让只检查 ok 的 agent 误判成功
    if (target && !project.buildTargets.some((t) => t.title === target)) {
      fail('invalid-input', `Target not found: ${target}`, {
        targets: project.buildTargets.map((t) => t.title),
        hint: 'Use section=targets to list target titles; a virtual target cannot be used as a filter.',
      });
    }
    return { cbp, ...projectSnapshot(project, { section, target }) };
  },
};

const projectEdit: ToolDefinition = {
  name: 'codeblocks_project_edit',
  title: 'Code::Blocks: Edit project',
  description:
    'Apply structured edits to a .cbp (target/file/project fields, add/remove/rename targets and files). ' +
    'Returns before/after changes. Use dryRun to preview, format=preserve for compile/link only.',
  inputSchema: {
    type: 'object',
    properties: {
      cbp: { type: 'string', description: 'Absolute path to the .cbp (defaults to the active project)' },
      ops: { type: 'array', description: 'Edit operations (see section=schema)', items: { type: 'object' } },
      dryRun: { type: 'boolean', description: 'Validate and preview without writing' },
      format: { type: 'string', enum: [...WRITE_FORMATS], description: 'Write format (default canonical)' },
      allowScripts: { type: 'boolean', description: 'Required to edit build scripts / pre-post commands' },
      force: { type: 'boolean', description: 'Overwrite even if the file was modified externally' },
    },
    required: ['ops'],
  },
  async handler(ctx, input) {
    const cbp = resolveCbp(ctx, input);
    if (!Array.isArray(input.ops)) fail('invalid-input', 'ops must be an array of edit operations', { got: input.ops });
    const ops = input.ops as EditOp[];
    const format = requireWriteFormat(input.format);
    const dryRun = input.dryRun === true;

    // preserve：只有 compile/link 定点改写，直接对磁盘文本操作
    if (format === 'preserve' && isPreserveCapable(ops)) {
      const { text, encoding } = readProjectText(cbp);
      let next = text;
      const changed: EditChange[] = [];
      for (const op of ops) {
        if (op.op !== 'set' || op.scope !== 'file') continue;
        const rel = String(op.file ?? '').replace(/\\/g, '/');
        const result = applyUnitOptionToText(next, rel, op.field as 'compile' | 'link', op.value === true);
        if (result.changed) {
          changed.push({ path: `file[${rel}].${op.field}`, after: op.value });
          next = result.text;
        }
      }
      if (!dryRun && next !== text) {
        if (!input.force && ctx.isExternallyModified?.(cbp)) {
          fail('external-modified', `The project file was modified outside the editor: ${cbp}`, { hint: 'Pass force: true to overwrite.' });
        }
        writeTextAtomic(cbp, next, encoding);
        await ctx.reloadProject?.(cbp);
      }
      return { ok: true, cbp, format, written: !dryRun && next !== text, changed, warnings: [], ...(dryRun ? { preview: next } : {}) };
    }

    // 先取签名再读盘：读盘与写盘之间文件被外部改动 ⇒ signatureChanged 命中
    const guard = captureSignature(cbp);
    const project = await loadForEdit(ctx, cbp);
    const outcome = applyEdits(project, ops, { allowScripts: input.allowScripts === true });
    const warnings = [...outcome.warnings];
    if (format === 'preserve') warnings.push('preserve mode only supports file compile/link edits; falling back to canonical rewrite.');
    if (!dryRun && outcome.changed.length > 0) {
      if (!input.force && signatureChanged(cbp, guard)) {
        fail('external-modified', `The project file was modified while editing: ${cbp}`, { hint: 'Pass force: true to overwrite.' });
      }
      await ctx.saveProject(project, { force: input.force === true, isExternallyModified: ctx.isExternallyModified });
    }
    return {
      ok: true,
      cbp,
      format: format === 'preserve' ? 'canonical' : format,
      written: !dryRun && outcome.changed.length > 0,
      changed: outcome.changed,
      warnings,
    };
  },
};

function structuralTool(
  name: string,
  title: string,
  description: string,
  actionEnum: string[],
  toOp: (input: Record<string, unknown>) => EditOp,
): ToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema: {
      type: 'object',
      properties: {
        cbp: { type: 'string', description: 'Absolute path to the .cbp (defaults to the active project)' },
        action: { type: 'string', enum: actionEnum },
        title: { type: 'string', description: 'Target title (target actions)' },
        file: { type: 'string', description: 'Project-relative file path with / separators (file actions)' },
        to: { type: 'string', description: 'New name (rename actions)' },
        copyFrom: { type: 'string', description: 'Copy settings from this target (addTarget)' },
        targetType: { type: 'number', description: 'Target type for addTarget (0 exe, 1 console, 2 static, 3 dynamic)' },
        targets: { type: 'array', items: { type: 'string' }, description: 'Target membership (addFile)' },
        compile: { type: 'boolean' },
        link: { type: 'boolean' },
        force: { type: 'boolean' },
      },
      required: ['action'],
    },
    async handler(ctx, input) {
      if (typeof input.action !== 'string' || !actionEnum.includes(input.action)) {
        fail('invalid-input', `Unknown action: ${String(input.action)}`, { allowed: actionEnum });
      }
      const cbp = resolveCbp(ctx, input);
      const op = toOp(input);
      const guard = captureSignature(cbp);
      const project = await loadForEdit(ctx, cbp);
      const outcome = applyEdits(project, [op]);
      if (outcome.changed.length > 0) {
        if (input.force !== true && signatureChanged(cbp, guard)) {
          fail('external-modified', `The project file was modified while editing: ${cbp}`, { hint: 'Pass force: true to overwrite.' });
        }
        await ctx.saveProject(project, { force: input.force === true, isExternallyModified: ctx.isExternallyModified });
      }
      return { ok: true, cbp, written: outcome.changed.length > 0, changed: outcome.changed, warnings: outcome.warnings };
    },
  };
}

const projectFile = structuralTool(
  'codeblocks_project_file',
  'Code::Blocks: Project files',
  'Add, remove or rename a source file in a .cbp project (and its target membership).',
  ['add', 'remove', 'rename'],
  (input) => {
    const action = String(input.action);
    if (action === 'add') {
      return {
        op: 'addFile',
        file: String(input.file ?? ''),
        targets: Array.isArray(input.targets) ? (input.targets as string[]) : undefined,
        compile: input.compile !== false,
        link: input.link !== false,
      };
    }
    if (action === 'remove') return { op: 'removeFile', file: String(input.file ?? '') };
    return { op: 'renameFile', file: String(input.file ?? ''), to: String(input.to ?? '') };
  },
);

const projectTarget = structuralTool(
  'codeblocks_project_target',
  'Code::Blocks: Build targets',
  'Add, remove or rename a build target in a .cbp project.',
  ['add', 'remove', 'rename'],
  (input) => {
    const action = String(input.action);
    if (action === 'add') {
      return {
        op: 'addTarget',
        title: String(input.title ?? ''),
        copyFrom: typeof input.copyFrom === 'string' ? input.copyFrom : undefined,
        targetType: typeof input.targetType === 'number' ? input.targetType : undefined,
      };
    }
    if (action === 'remove') return { op: 'removeTarget', title: String(input.title ?? '') };
    return { op: 'renameTarget', title: String(input.title ?? ''), to: String(input.to ?? '') };
  },
);

const build: ToolDefinition = {
  name: 'codeblocks_build',
  title: 'Code::Blocks: Build',
  description: 'Build, rebuild or clean a Code::Blocks project target. Returns structured diagnostics (file/line/column/severity).',
  inputSchema: {
    type: 'object',
    properties: {
      cbp: { type: 'string', description: 'Absolute path to the .cbp (defaults to the active project)' },
      target: { type: 'string', description: 'Target title (defaults to the selected/first supported target)' },
      mode: { type: 'string', enum: ['build', 'rebuild', 'clean'], description: 'Default build' },
      timeoutMs: { type: 'integer', description: 'Cancel the build after this many milliseconds' },
      dryRun: { type: 'boolean', description: 'Only report what would be built' },
    },
  },
  async handler(ctx, input) {
    const cbp = resolveCbp(ctx, input);
    const rawMode = input.mode;
    if (rawMode !== undefined && !['build', 'rebuild', 'clean'].includes(String(rawMode))) {
      fail('invalid-input', `Unknown build mode: ${String(rawMode)}`, { allowed: ['build', 'rebuild', 'clean'] });
    }
    const mode = (rawMode as BuildMode | undefined) ?? 'build';
    const target = optionalText(input, 'target');
    const timeoutMs = optionalNumber(input, 'timeoutMs', { min: 0 });
    if (input.dryRun === true) {
      const project = await ctx.loadProject(cbp);
      const resolved = selectBuildTarget(project, target);
      return { ok: true, dryRun: true, cbp, target: resolved, mode, targets: project.buildTargets.map((t) => t.title) };
    }
    if (ctx.isBuildInProgress?.()) fail('build-busy', 'A build is already running');
    const outcome = await ctx.build({
      cbp,
      target,
      mode,
      timeoutMs,
    });
    return {
      ok: outcome.ok,
      cbp,
      target: outcome.target,
      mode,
      timedOut: outcome.timedOut,
      summary: outcome.summary,
    };
  },
};

const buildStatus: ToolDefinition = {
  name: 'codeblocks_build_status',
  title: 'Code::Blocks: Build status',
  description: 'Return the most recent build summary (per-project stats, structured diagnostics, executed commands).',
  inputSchema: {
    type: 'object',
    properties: {
      cbp: { type: 'string', description: 'Filter by project (defaults to all projects in the last build)' },
      severity: { type: 'string', enum: ['error', 'warning', 'all'], description: 'Filter diagnostics (default all)' },
      tail: { type: 'integer', description: 'Limit the number of diagnostics returned' },
    },
  },
  async handler(ctx, input) {
    const summary = ctx.lastBuild?.();
    if (!summary) fail('no-build', 'No build has been run in this session yet', { hint: 'Run codeblocks_build first.' });
    const rawSeverity = input.severity;
    if (rawSeverity !== undefined && !['error', 'warning', 'all'].includes(String(rawSeverity))) {
      fail('invalid-input', `Unknown severity: ${String(rawSeverity)}`, { allowed: ['error', 'warning', 'all'] });
    }
    const severity = (rawSeverity as string | undefined) ?? 'all';
    const tail = optionalNumber(input, 'tail', { min: 0, integer: true }) ?? 0;
    const cbpInput = optionalText(input, 'cbp');
    const cbp = cbpInput ? path.resolve(cbpInput) : undefined;
    const projects = summary!.projects
      .filter((p) => !cbp || p.projectName === path.basename(path.dirname(cbp)))
      .map((p) => ({
        ...p,
        diagnostics: p.diagnostics
          .filter((d) => severity === 'all' || d.severity === severity)
          .slice(0, tail || undefined),
      }));
    return { ok: summary!.success, durationMs: summary!.durationMs, errorCount: summary!.errorCount, warningCount: summary!.warningCount, truncated: summary!.truncated, projects };
  },
};

const run: ToolDefinition = {
  name: 'codeblocks_run',
  title: 'Code::Blocks: Run',
  description: 'Run a built target and return exit code plus captured stdout/stderr (non-interactive).',
  inputSchema: {
    type: 'object',
    properties: {
      cbp: { type: 'string', description: 'Absolute path to the .cbp (defaults to the active project)' },
      target: { type: 'string', description: 'Target title' },
      args: { type: 'string', description: 'Override the execution arguments' },
      cwd: { type: 'string', description: 'Override the working directory (relative paths resolve against the project directory)' },
      timeoutMs: { type: 'integer', description: 'Kill the program after this many milliseconds (default 120000; 0 = no limit)' },
    },
  },
  async handler(ctx, input): Promise<RunOutcome> {
    const cbp = resolveCbp(ctx, input);
    const req: RunRequest = {
      cbp,
      target: optionalText(input, 'target'),
      args: typeof input.args === 'string' ? input.args : undefined,
      cwd: optionalText(input, 'cwd'),
      // 未显式指定时用默认上限，避免死循环程序永久占住工具调用（显式 0 = 不限时）
      timeoutMs: optionalNumber(input, 'timeoutMs', { min: 0 }) ?? DEFAULT_RUN_TIMEOUT_MS,
    };
    return runProject(req, { compiler: ctx.compiler });
  },
};

const debug: ToolDefinition = {
  name: 'codeblocks_debug',
  title: 'Code::Blocks: Debug',
  description: 'Control a debug session: start/stop, set breakpoints, inspect stack/variables, evaluate expressions, continue/step.',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['start', 'stop', 'breakpoints', 'state', 'stack', 'variables', 'evaluate', 'continue', 'step', 'run'],
        description: 'run = start (optionally with breakpoints) and return stack/variables in one call',
      },
      cbp: { type: 'string', description: 'Absolute path to the .cbp (defaults to the active project)' },
      target: { type: 'string', description: 'Target title (start)' },
      args: { type: 'string', description: 'Program arguments (start)' },
      stopOnEntry: { type: 'boolean', description: 'Break at entry (start)' },
      file: { type: 'string', description: 'Absolute source file path (breakpoints)' },
      lines: { type: 'array', items: { type: 'integer' }, description: 'Breakpoint lines (breakpoints)' },
      frameId: { type: 'integer', description: 'Stack frame id (variables/evaluate)' },
      expression: { type: 'string', description: 'Expression to evaluate' },
      kind: { type: 'string', enum: ['next', 'stepIn', 'stepOut'], description: 'Step kind' },
      timeoutMs: { type: 'integer', description: 'start/run/continue/step: how long to wait for the program to stop (default 30000)' },
      includeStack: { type: 'boolean', description: 'run: also return the stack trace (default true)' },
      includeVariables: { type: 'boolean', description: 'run: also return the top-frame variables (default true)' },
    },
    required: ['action'],
  },
  async handler(ctx, input) {
    if (!ctx.debug) fail('unsupported', 'Debug control is not available in this transport');
    const action = String(input.action);
    const bridge = ctx.debug!;
    // 两种传输（DAP / gdb MI）形状不同 ⇒ 统一归一化后再返回（见 api/debugShapes.ts）
    const norm = (kind: string, value: unknown): unknown => normalizeDebugResult(kind, value);
    // 运行期参数校验：LM schema 的 enum/type 不会约束 CLI/MCP
    const target = optionalText(input, 'target');
    const args = typeof input.args === 'string' ? input.args : undefined;
    const timeoutMs = optionalNumber(input, 'timeoutMs', { min: 0 });
    const frameId = optionalNumber(input, 'frameId', { min: 0, integer: true });
    const linesInput = input.lines;
    if (linesInput !== undefined && (!Array.isArray(linesInput) || linesInput.some((n) => typeof n !== 'number' || !Number.isInteger(n) || n < 1))) {
      fail('invalid-input', 'lines must be an array of positive integers', { got: linesInput });
    }
    const lines = (linesInput as number[] | undefined) ?? [];
    if (input.kind !== undefined && !['next', 'stepIn', 'stepOut'].includes(String(input.kind))) {
      fail('invalid-input', `Unknown step kind: ${String(input.kind)}`, { allowed: ['next', 'stepIn', 'stepOut'] });
    }
    switch (action) {
      case 'start':
        return norm('start', await bridge.start({
          cbp: resolveCbp(ctx, input),
          target,
          args,
          stopOnEntry: input.stopOnEntry === true,
          timeoutMs,
        }));
      case 'stop': return norm('stop', await bridge.stop());
      case 'run': {
        const file = optionalText(input, 'file');
        // 断点统一由 start 应用：CLI/MCP 的调试桥在 start 之前没有会话，
        // 先 setBreakpoints 会直接报 not-running（宿主侧则会在 startDebugging 前预置）。
        const started = await bridge.start({
          cbp: resolveCbp(ctx, input),
          target,
          args,
          stopOnEntry: input.stopOnEntry === true,
          file,
          lines,
          timeoutMs,
        });
        const stack = input.includeStack === false ? undefined : await bridge.stack().catch(() => undefined);
        const variables = input.includeVariables === false ? undefined : await bridge.variables().catch(() => undefined);
        return {
          start: norm('start', started),
          stack: stack === undefined ? undefined : norm('stack', stack),
          variables: variables === undefined ? undefined : norm('variables', variables),
        };
      }
      case 'breakpoints': {
        const file = optionalText(input, 'file');
        if (!file) fail('invalid-input', 'file is required for breakpoints', { hint: 'Pass an absolute source file path.' });
        return norm('breakpoints', await bridge.setBreakpoints({
          cbp: optionalText(input, 'cbp') ?? activeCbp(ctx),
          file: file!,
          lines,
        }));
      }
      case 'state': return norm('state', await bridge.state());
      case 'stack': return norm('stack', await bridge.stack());
      case 'variables':
        return norm('variables', await bridge.variables({ frameId }));
      case 'evaluate': {
        const expression = typeof input.expression === 'string' ? input.expression : '';
        if (!expression.trim()) fail('invalid-input', 'expression is required for evaluate');
        return norm('evaluate', await bridge.evaluate({ expression, frameId }));
      }
      case 'continue': return norm('continue', await bridge.continue({ timeoutMs }));
      case 'step': return norm('step', await bridge.step({
        kind: (input.kind as 'next' | 'stepIn' | 'stepOut' | undefined) ?? 'next',
        timeoutMs,
      }));
      default: fail('invalid-input', `Unknown debug action: ${action}`);
    }
  },
};

const compiler: ToolDefinition = {
  name: 'codeblocks_compiler',
  title: 'Code::Blocks: Compiler',
  description: 'Inspect the resolved compiler (programs, master path, search dirs) and list available compiler ids.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'info', 'set'] },
      cbp: { type: 'string', description: 'Project path (used to resolve workspace settings)' },
      compilerId: { type: 'string', description: 'Compiler id (e.g. gcc, g++)' },
      masterPath: { type: 'string', description: 'Toolchain bin directory (set)' },
    },
    required: ['action'],
  },
  async handler(ctx, input) {
    const action = String(input.action);
    if (action !== 'list' && action !== 'info' && action !== 'set') {
      fail('invalid-input', `Unknown compiler action: ${action}`, { allowed: ['list', 'info', 'set'] });
    }
    if (action === 'list') {
      const dir = ctx.compiler.resourcesDir;
      let ids: string[] = [];
      try {
        ids = fs.readdirSync(dir)
          .filter((f) => /^options_.+\.xml$/i.test(f))
          .map((f) => f.replace(/^options_/i, '').replace(/\.xml$/i, ''))
          .filter((id) => !/^common[_-]/i.test(id))
          .sort();
      } catch {
        ids = [];
      }
      return { resourcesDir: dir, compilers: ids, configured: ctx.settings.get<string>('compilerId', 'gcc') };
    }
    if (action === 'info') {
      const id = optionalText(input, 'compilerId') ?? ctx.settings.get<string>('compilerId', 'gcc');
      // 未注册 id 必须报错：getCompiler 会用默认工具链合成一个实例，看起来「存在且版本正常」
      const registered = typeof ctx.compiler.isRegisteredCompiler === 'function' ? ctx.compiler.isRegisteredCompiler(id) : true;
      if (!registered) {
        fail('invalid-input', `Unknown compiler id: ${id} — use action=list to see available compiler ids, or set codeblocks.compilerId.`, {
          hint: 'Use action=list to see available compiler ids, or set codeblocks.compilerId.',
          configured: ctx.settings.get<string>('compilerId', 'gcc'),
        });
      }
      const c = ctx.compiler.getCompiler(id);
      return {
        compilerId: id,
        name: c.name,
        masterPath: c.masterPath,
        programs: c.programs,
        includeDirs: c.includeDirs,
        libDirs: c.libDirs,
        extraPaths: c.extraPaths,
        versionString: c.versionString,
      };
    }
    fail('unsupported', 'Changing compiler settings is only available in the VS Code extension (settings are not writable from CLI/MCP).', {
      hint: 'Set codeblocks.compilerId / codeblocks.masterPath in .vscode/settings.json or pass CB_COMPILER_ID / CB_MASTER_PATH.',
    });
  },
};

const exportTool: ToolDefinition = {
  name: 'codeblocks_export',
  title: 'Code::Blocks: Export',
  description: 'Export a Makefile, compile_commands.json, or the generated compiler command list.',
  inputSchema: {
    type: 'object',
    properties: {
      cbp: { type: 'string', description: 'Absolute path to the .cbp (defaults to the active project)' },
      kind: { type: 'string', enum: [...EXPORT_KINDS] },
      target: { type: 'string', description: 'Target title' },
      out: { type: 'string', description: 'Output file (makefile) or directory (compile_commands); must stay inside the project directory' },
    },
    required: ['kind'],
  },
  async handler(ctx, input): Promise<ExportOutcome> {
    const cbp = resolveCbp(ctx, input);
    return exportProject({
      cbp,
      kind: input.kind as ExportKind,
      target: optionalText(input, 'target'),
      out: optionalText(input, 'out'),
    }, { compiler: ctx.compiler, output: ctx.output, systemIncludes: ctx.systemIncludes });
  },
};

const workspace: ToolDefinition = {
  name: 'codeblocks_workspace',
  title: 'Code::Blocks: Workspace',
  description: 'Inspect or edit a .workspace (project list and inter-project build dependencies), and manage open projects.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['info', 'deps', 'open', 'close', 'setActive', 'list'] },
      workspace: { type: 'string', description: 'Absolute path to the .workspace (info/deps)' },
      project: { type: 'string', description: 'Project the dependencies belong to (absolute or workspace-relative path)' },
      cbp: { type: 'string', description: 'Project path (open/close/setActive)' },
      dependencies: { type: 'array', items: { type: 'string' }, description: 'Dependency project paths (absolute or workspace-relative; written back as relative)' },
    },
    required: ['action'],
  },
  async handler(ctx, input) {
    const action = String(input.action);
    if (!['info', 'deps', 'open', 'close', 'setActive', 'list'].includes(action)) {
      fail('invalid-input', `Unknown workspace action: ${action}`, { allowed: ['info', 'deps', 'open', 'close', 'setActive', 'list'] });
    }
    if (action === 'list') return { projects: ctx.listOpenProjects?.() ?? [] };
    if (action === 'open' || action === 'close' || action === 'setActive') {
      if (!ctx.openProject && !ctx.setActiveProject) fail('unsupported', 'Project management is only available in the VS Code extension');
      const cbp = resolveCbp(ctx, input);
      if (action === 'open') { await ctx.openProject?.(cbp); return { ok: true, opened: cbp }; }
      if (action === 'close') { await ctx.closeProject?.(cbp); return { ok: true, closed: cbp }; }
      await ctx.setActiveProject?.(cbp);
      return { ok: true, active: cbp };
    }
    const wsPath = optionalText(input, 'workspace');
    if (!wsPath) fail('invalid-input', 'A .workspace path is required');
    if (action === 'info') return workspaceSnapshot(loadWorkspace(wsPath!));
    // deps：project / dependencies 都接受绝对路径（相对路径按 workspace 目录解析），
    // 落盘统一写成 workspace 相对路径（Code::Blocks 的 <Project filename> 语义，跨机器可移植）。
    const project = optionalText(input, 'project');
    if (!project) fail('invalid-input', 'A project path is required for deps');
    const depsInput = optionalStringArray(input, 'dependencies');
    const ws = loadWorkspace(wsPath!);
    const normAbs = (p: string): string => path.resolve(p).replace(/\\/g, '/').toLowerCase();
    const relOf = (p: string): string | undefined => {
      const abs = path.isAbsolute(p) ? path.resolve(p) : path.resolve(ws.basePath, p);
      return ws.projectPaths.find((rel) => normAbs(path.join(ws.basePath, rel)) === normAbs(abs));
    };
    const targetRel = relOf(project!);
    if (!targetRel) {
      fail('invalid-input', `Project not found in the workspace: ${project}`, { projects: ws.projectPaths });
    }
    const deps = ((depsInput as string[] | undefined) ?? []).map((d) => {
      const rel = relOf(d);
      if (!rel) fail('invalid-input', `Dependency project is not part of the workspace: ${d}`, { projects: ws.projectPaths });
      return rel;
    });
    const ok = updateWorkspaceDependencies(wsPath!, targetRel!, deps);
    if (!ok) fail('invalid-input', `Project not found in the workspace: ${project}`);
    return { ok: true, workspace: path.resolve(wsPath!), project: targetRel, dependencies: deps };
  },
};

/** 全部工具（顺序与 package.json 声明一致） */
export const TOOL_DEFINITIONS: ToolDefinition[] = [
  projectRead,
  projectEdit,
  projectFile,
  projectTarget,
  build,
  buildStatus,
  run,
  debug,
  compiler,
  exportTool,
  workspace,
];

/** 按名称查找 */
export function findTool(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}

/** 统一执行入口（MCP / CLI / LM Tool 共用）：异常归一化为 { ok:false, error } */
export async function invokeTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<unknown> {
  const tool = findTool(name);
  if (!tool) throw new ControlError('invalid-input', `Unknown tool: ${name}`, { tools: TOOL_DEFINITIONS.map((t) => t.name) });
  const args = input ?? {};
  if (ctx.readOnly && !isReadOnlyToolCall(name, args)) {
    fail('read-only', `${name} is not allowed in read-only mode`, { hint: READ_ONLY_HINT, tool: name, action: args.action });
  }
  if (ctx.allowScripts === false && name === 'codeblocks_project_edit' && args.allowScripts === true) {
    fail('invalid-input', 'Script editing is disabled by the global agent policy', {
      hint: SCRIPT_POLICY_HINT,
      setting: 'codeblocks.agent.allowScripts',
    });
  }
  return tool!.handler(ctx, args);
}
