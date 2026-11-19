/**
 * Agent 工具注册表（无 vscode 依赖）——Language Model Tools / MCP / CLI 共用。
 *
 * 单一来源的好处：三端的参数校验、错误码、行为完全一致；
 * `package.json` 的 `contributes.languageModelTools` 由契约测试与本表逐项比对。
 */
import * as fs from 'fs';
import * as path from 'path';
import type { Project } from '../model/types';
import type { BuildCancelHandle } from '../build/cancelToken';
import type { BuildLogSummary } from '../build/buildSummary';
import { applyEdits, applyUnitOptionToText, isPreserveCapable } from './projectEdit';
import { projectSnapshot, QuerySection, workspaceSnapshot } from './projectQuery';
import { buildProject, BuildMode, BuildOutcome, BuildRequest, selectBuildTarget } from './buildService';
import { runProject, RunOutcome, RunRequest } from './runService';
import { exportProject, ExportKind, ExportOutcome } from './exportService';
import { captureSignature, loadWorkspace, readProjectText, requireCbpPath, signatureChanged, updateWorkspaceDependencies, writeTextAtomic } from './projectStore';
import type { CompilerProvider } from './compilerService';
import type { CompilerSettingsLike } from '../compiler/compilerFactory';
import type { CbOutput } from '../build/cbChannel';
import { ControlError, EditChange, EditOp, fail, WriteFormat } from './types';
import { isReadOnlyToolCall, READ_ONLY_HINT } from './agentPolicy';

export interface OpenProjectInfo {
  filename: string;
  title: string;
  active: boolean;
}

/** 调试桥（扩展内用 vscode.debug；CLI/MCP 用 debugService） */
export interface DebugBridge {
  start(req: { cbp?: string; target?: string; args?: string; stopOnEntry?: boolean; file?: string; lines?: number[] }): Promise<unknown>;
  stop(): Promise<unknown>;
  setBreakpoints(req: { cbp?: string; file: string; lines: number[] }): Promise<unknown>;
  state(): Promise<unknown>;
  stack(): Promise<unknown>;
  variables(req?: { frameId?: number }): Promise<unknown>;
  evaluate(req: { expression: string; frameId?: number }): Promise<unknown>;
  continue(): Promise<unknown>;
  step(req: { kind: 'next' | 'stepIn' | 'stepOut' }): Promise<unknown>;
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
  const explicit = typeof input.cbp === 'string' ? input.cbp : undefined;
  if (explicit) return requireCbpPath(explicit);
  const active = activeCbp(ctx);
  if (active) return active;
  fail('invalid-input', 'No project specified and no active Code::Blocks project', {
    hint: 'Pass "cbp" (absolute path) or open a .cbp in the editor first.',
  });
  return '';
}

async function loadForEdit(ctx: ToolContext, cbp: string): Promise<Project> {
  return ctx.loadProject(cbp);
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
      section: { type: 'string', enum: ['summary', 'targets', 'files', 'options', 'schema', 'all'], description: 'Which slice to return' },
      target: { type: 'string', description: 'Restrict targets/files/options to one target title' },
    },
  },
  async handler(ctx, input) {
    const section = (input.section as QuerySection) ?? 'all';
    if (section === 'schema') {
      return { schema: projectSnapshot({ buildTargets: [], files: [] } as unknown as Project, { section: 'schema' }).schema };
    }
    const cbp = resolveCbp(ctx, input);
    const target = typeof input.target === 'string' ? input.target : undefined;
    const project = await ctx.loadProject(cbp);
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
      format: { type: 'string', enum: ['canonical', 'preserve'], description: 'Write format (default canonical)' },
      allowScripts: { type: 'boolean', description: 'Required to edit build scripts / pre-post commands' },
      force: { type: 'boolean', description: 'Overwrite even if the file was modified externally' },
    },
    required: ['ops'],
  },
  async handler(ctx, input) {
    const cbp = resolveCbp(ctx, input);
    const ops = input.ops as EditOp[];
    const format = (input.format as WriteFormat) ?? 'canonical';
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
      return { ok: true, cbp, format, written: !dryRun && next !== text, changed, warnings: [] };
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
    const mode = (input.mode as BuildMode) ?? 'build';
    if (input.dryRun === true) {
      const project = await ctx.loadProject(cbp);
      const target = selectBuildTarget(project, typeof input.target === 'string' ? input.target : undefined);
      return { ok: true, dryRun: true, cbp, target, mode, targets: project.buildTargets.map((t) => t.title) };
    }
    if (ctx.isBuildInProgress?.()) fail('build-busy', 'A build is already running');
    const outcome = await ctx.build({
      cbp,
      target: typeof input.target === 'string' ? input.target : undefined,
      mode,
      timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
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
    if (!summary) fail('unsupported', 'No build has been run in this session yet');
    const severity = (input.severity as string) ?? 'all';
    const tail = typeof input.tail === 'number' && input.tail > 0 ? input.tail : 0;
    const cbp = typeof input.cbp === 'string' ? path.resolve(input.cbp) : undefined;
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
      cwd: { type: 'string', description: 'Override the working directory' },
      timeoutMs: { type: 'integer', description: 'Kill the program after this many milliseconds' },
    },
  },
  async handler(ctx, input): Promise<RunOutcome> {
    const cbp = resolveCbp(ctx, input);
    const req: RunRequest = {
      cbp,
      target: typeof input.target === 'string' ? input.target : undefined,
      args: typeof input.args === 'string' ? input.args : undefined,
      cwd: typeof input.cwd === 'string' ? input.cwd : undefined,
      timeoutMs: typeof input.timeoutMs === 'number' ? input.timeoutMs : undefined,
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
    },
    required: ['action'],
  },
  async handler(ctx, input) {
    if (!ctx.debug) fail('unsupported', 'Debug control is not available in this transport');
    const action = String(input.action);
    const bridge = ctx.debug!;
    switch (action) {
      case 'start':
        return bridge.start({
          cbp: resolveCbp(ctx, input),
          target: typeof input.target === 'string' ? input.target : undefined,
          args: typeof input.args === 'string' ? input.args : undefined,
          stopOnEntry: input.stopOnEntry === true,
        });
      case 'stop': return bridge.stop();
      case 'run': {
        const file = typeof input.file === 'string' ? input.file : undefined;
        const lines = Array.isArray(input.lines) ? (input.lines as number[]) : [];
        if (file && lines.length) await bridge.setBreakpoints({ file, lines });
        const started = await bridge.start({
          cbp: resolveCbp(ctx, input),
          target: typeof input.target === 'string' ? input.target : undefined,
          args: typeof input.args === 'string' ? input.args : undefined,
          stopOnEntry: input.stopOnEntry === true,
          file,
          lines,
        });
        const stack = input.includeStack === false ? undefined : await bridge.stack().catch(() => undefined);
        const variables = input.includeVariables === false ? undefined : await bridge.variables().catch(() => undefined);
        return { start: started, stack, variables };
      }
      case 'breakpoints':
        return bridge.setBreakpoints({
          cbp: typeof input.cbp === 'string' ? input.cbp : activeCbp(ctx),
          file: String(input.file ?? ''),
          lines: Array.isArray(input.lines) ? (input.lines as number[]) : [],
        });
      case 'state': return bridge.state();
      case 'stack': return bridge.stack();
      case 'variables': return bridge.variables({ frameId: typeof input.frameId === 'number' ? input.frameId : undefined });
      case 'evaluate':
        return bridge.evaluate({ expression: String(input.expression ?? ''), frameId: typeof input.frameId === 'number' ? input.frameId : undefined });
      case 'continue': return bridge.continue();
      case 'step': return bridge.step({ kind: (input.kind as 'next' | 'stepIn' | 'stepOut') ?? 'next' });
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
      const id = typeof input.compilerId === 'string' ? input.compilerId : ctx.settings.get<string>('compilerId', 'gcc');
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
      kind: { type: 'string', enum: ['makefile', 'compile_commands', 'commands'] },
      target: { type: 'string', description: 'Target title' },
      out: { type: 'string', description: 'Output file (makefile) or directory (compile_commands)' },
    },
    required: ['kind'],
  },
  async handler(ctx, input): Promise<ExportOutcome> {
    const cbp = resolveCbp(ctx, input);
    return exportProject({
      cbp,
      kind: input.kind as ExportKind,
      target: typeof input.target === 'string' ? input.target : undefined,
      out: typeof input.out === 'string' ? input.out : undefined,
    }, { compiler: ctx.compiler, output: ctx.output });
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
      project: { type: 'string', description: 'Project path the dependencies belong to (deps)' },
      cbp: { type: 'string', description: 'Project path (open/close/setActive)' },
      dependencies: { type: 'array', items: { type: 'string' }, description: 'Dependency project paths (deps)' },
    },
    required: ['action'],
  },
  async handler(ctx, input) {
    const action = String(input.action);
    if (action === 'list') return { projects: ctx.listOpenProjects?.() ?? [] };
    if (action === 'open' || action === 'close' || action === 'setActive') {
      if (!ctx.openProject && !ctx.setActiveProject) fail('unsupported', 'Project management is only available in the VS Code extension');
      const cbp = resolveCbp(ctx, input);
      if (action === 'open') { await ctx.openProject?.(cbp); return { ok: true, opened: cbp }; }
      if (action === 'close') { await ctx.closeProject?.(cbp); return { ok: true, closed: cbp }; }
      await ctx.setActiveProject?.(cbp);
      return { ok: true, active: cbp };
    }
    const wsPath = typeof input.workspace === 'string' ? input.workspace : undefined;
    if (!wsPath) fail('invalid-input', 'A .workspace path is required');
    if (action === 'info') return workspaceSnapshot(loadWorkspace(wsPath!));
    // deps
    const project = typeof input.project === 'string' ? input.project : undefined;
    if (!project) fail('invalid-input', 'A project path is required for deps');
    const deps = Array.isArray(input.dependencies) ? (input.dependencies as string[]) : [];
    const ok = updateWorkspaceDependencies(wsPath!, project!, deps);
    if (!ok) fail('invalid-input', `Project not found in the workspace: ${project}`);
    return { ok: true, workspace: path.resolve(wsPath!), project: path.resolve(project!), dependencies: deps };
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
  return tool!.handler(ctx, args);
}
