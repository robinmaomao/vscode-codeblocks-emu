/**
 * CLI / MCP 的运行时装配：先安装 vscode 替身，再按需 require 构建链路。
 *
 * 顺序很关键：`build/buildEngine` 在模块顶层 `import * as vscode`，
 * 若在替身安装前被 require，会直接抛 MODULE_NOT_FOUND。
 */
import * as fs from 'fs';
import * as path from 'path';
import { installVscodeShim, ShimHandle } from './vscodeShim';
import { loadCodeblocksSettings, CodeblocksSettings } from '../api/settingsReader';
import type { ToolContext } from '../api/toolRegistry';
import type { BuildLogSummary } from '../build/buildSummary';
import type { BuildOutcome } from '../api/buildService';

export interface CliRuntime {
  context: ToolContext;
  settings: CodeblocksSettings;
  shim: ShimHandle;
  /** 最近一次构建摘要（同进程） */
  lastBuild(): BuildLogSummary | undefined;
}

interface CbOutputLike {
  info(line: string): void;
  warn(line: string): void;
  error(line: string): void;
  debug(line: string): void;
  trace(line: string): void;
  append(text: string): void;
  appendLine(line: string): void;
  clear(): void;
  show(preserveFocus?: boolean): void;
  hide(): void;
  dispose(): void;
  raw: unknown;
}

function createStderrOutput(writeLine: (line: string) => void): CbOutputLike {
  return {
    info: writeLine,
    warn: (l) => writeLine(`[warn] ${l}`),
    error: (l) => writeLine(`[error] ${l}`),
    debug: writeLine,
    trace: writeLine,
    append: (t) => writeLine(t),
    appendLine: writeLine,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
    raw: {},
  };
}

export interface CreateRuntimeOptions {
  /** 用于定位 .vscode/settings.json 的目标文件（.cbp/.workspace） */
  target?: string;
  /** false = 不写 stderr 构建日志（MCP 场景日志走 stderr，仍建议 true） */
  echoBuildLog?: boolean;
  /** 扩展安装根目录（用于 resources/compilers）；缺省按仓库布局推断 */
  extensionRoot?: string;
  defaultConfPath?: string;
}

/** 推断扩展根目录：dist/cli → 仓库根；bundle → 扩展根（以 resources/compilers 是否存在为准） */
export function defaultExtensionRoot(): string {
  const here = __dirname;
  const candidates = [path.resolve(here, '..'), path.resolve(here, '..', '..')];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, 'resources', 'compilers'))) return c;
  }
  // 兜底：dist/cli/runtime.js → 仓库根
  return path.resolve(here, '..', '..');
}

/** 创建 CLI/MCP 运行时 */
export function createRuntime(opts: CreateRuntimeOptions = {}): CliRuntime {
  const settings = loadCodeblocksSettings({ target: opts.target });
  const echo = opts.echoBuildLog !== false;
  const shim = installVscodeShim({
    settings,
    write: echo ? (line) => process.stderr.write(line + '\n') : () => undefined,
  });

  const extensionRoot = opts.extensionRoot ?? defaultExtensionRoot();
  const resourcesDir = path.join(extensionRoot, 'resources', 'compilers');

  // 替身装好之后才加载构建链路
  const { createCompilerProvider } = require('../api/compilerService') as typeof import('../api/compilerService');
  const { loadProject } = require('../api/projectStore') as typeof import('../api/projectStore');
  const { saveProject } = require('../api/projectStore') as typeof import('../api/projectStore');
  const { buildProject } = require('../api/buildService') as typeof import('../api/buildService');
  const { createHeadlessDebugger } = require('../api/debugService') as typeof import('../api/debugService');

  const output = createStderrOutput((line) => process.stderr.write(line + '\n')) as unknown as ToolContext['output'];
  const compiler = createCompilerProvider({ resourcesDir, settings, defaultConfPath: opts.defaultConfPath });
  const debuggerSession = createHeadlessDebugger({ compiler, settings });
  let last: BuildLogSummary | undefined;

  const asDebugRequest = (extra: Partial<import('../api/debugService').DebugRequest>, action: import('../api/debugService').DebugRequest['action']) => ({
    action,
    ...extra,
  });

  const context: ToolContext = {
    settings,
    compiler,
    output,
    loadProject: async (cbp: string) => loadProject(cbp),
    saveProject: async (project, saveOpts) => {
      saveProject(project, { force: saveOpts.force, isExternallyModified: saveOpts.isExternallyModified });
    },
    isExternallyModified: undefined,
    build: async (req): Promise<BuildOutcome> => {
      const outcome = await buildProject(req, { compiler, settings, output });
      last = outcome.summary;
      return outcome;
    },
    lastBuild: () => last,
    isBuildInProgress: () => false,
    debug: {
      start: async (req) => debuggerSession.start(asDebugRequest(req, 'start')),
      stop: async () => debuggerSession.stop(),
      setBreakpoints: async (req) => debuggerSession.setBreakpoints(asDebugRequest(req, 'breakpoints')),
      state: async () => debuggerSession.state(),
      stack: async () => debuggerSession.stack(),
      variables: async () => debuggerSession.variables(),
      evaluate: async (req) => debuggerSession.evaluate(asDebugRequest(req, 'evaluate')),
      continue: async () => debuggerSession.continue(),
      step: async (req) => debuggerSession.step(asDebugRequest(req, 'step')),
    },
  };

  return { context, settings, shim, lastBuild: () => last };
}
