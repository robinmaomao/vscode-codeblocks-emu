/**
 * 无 VS Code 宿主下的 `vscode` 模块替身（CLI / MCP 专用）。
 *
 * 只覆盖构建链路真正用到的 API：`workspace.getConfiguration`、`window.*`、`Uri`、`Diagnostic*`。
 * 其余成员用「可 new + 可调用」的兜底桩，避免 dist 在 import 阶段就崩溃。
 *
 * 必须在 require 任何 `src/build/*`、`src/compiler/*` 之前安装。
 */
// 注意：不能用 `import * as Module from 'module'`——esModuleInterop 会生成属性副本，
// 改写副本上的 _load 不会影响真正的模块加载器。
const nodeModule = require('module') as { _load: (...args: unknown[]) => unknown };

type SettingsLike = { get<T>(key: string, defaultValue: T): T };

export interface ShimOptions {
  /** `codeblocks.*` 设置读取 */
  settings: SettingsLike;
  /** 日志落点（默认 process.stderr） */
  write?: (line: string) => void;
}

export interface ShimHandle {
  restore(): void;
  /** 输出通道收到的行（排障/测试用） */
  lines: string[];
}

const stubs = new Map<string, unknown>();

function stub(name: string): unknown {
  if (!stubs.has(name)) {
    const fn = function (this: Record<string, unknown>) { this.__args = [...arguments]; };
    (fn as unknown as { prototype: Record<string, unknown> }).prototype.dispose = () => undefined;
    stubs.set(name, fn);
  }
  return stubs.get(name);
}

class Disposable {
  dispose(): void { /* no-op */ }
  static from(): Disposable { return new Disposable(); }
}

class Position {
  constructor(public line: number, public character: number) {}
}

class Range {
  start: Position;
  end: Position;
  constructor(a: number | Position, b: number | Position, c?: number, d?: number) {
    if (typeof a === 'number') {
      this.start = new Position(a, b as number);
      this.end = new Position(c ?? a, d ?? (b as number));
    } else {
      this.start = a;
      this.end = b as Position;
    }
  }
}

class Diagnostic {
  constructor(public range: Range, public message: string, public severity?: number) {}
}

class Uri {
  scheme: string;
  fsPath: string;
  path: string;
  constructor(scheme: string, fsPath: string) {
    this.scheme = scheme;
    this.fsPath = fsPath;
    this.path = String(fsPath).replace(/\\/g, '/');
  }
  toString(): string { return `${this.scheme}:${this.path}`; }
  static file(p: string): Uri { return new Uri('file', p); }
  static parse(s: string): Uri { return new Uri('file', String(s).replace(/^file:\/?/, '')); }
  static joinPath(base: Uri, ...parts: string[]): Uri {
    const sep = base.fsPath.includes('\\') ? '\\' : '/';
    return new Uri(base.scheme, [base.fsPath.replace(/[\\/]$/, ''), ...parts].join(sep));
  }
}

class EventEmitter<T> {
  private listeners: Array<(v: T) => void> = [];
  get event(): (listener: (v: T) => void) => Disposable {
    return (listener) => { this.listeners.push(listener); return new Disposable(); };
  }
  fire(v: T): void { for (const l of [...this.listeners]) l(v); }
  dispose(): void { this.listeners = []; }
}

/** 安装替身，返回句柄（restore 供测试使用） */
export function installVscodeShim(opts: ShimOptions): ShimHandle {
  const lines: string[] = [];
  const write = opts.write ?? ((line: string) => process.stderr.write(line + '\n'));
  const log = (line: string): void => { lines.push(line); write(line); };

  const outputChannel = {
    info: (l: string) => log(l),
    warn: (l: string) => log(`[warn] ${l}`),
    error: (l: string) => log(`[error] ${l}`),
    debug: (l: string) => log(l),
    trace: (l: string) => log(l),
    append: (t: string) => { lines.push(t); },
    appendLine: (l: string) => log(l),
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
    raw: { info: log, warn: log, error: log, debug: log, trace: log, append: () => undefined, appendLine: log, clear: () => undefined, show: () => undefined, hide: () => undefined, dispose: () => undefined },
  };

  const configuration = {
    get: <T>(key: string, defaultValue: T): T => opts.settings.get<T>(key.replace(/^codeblocks\./, ''), defaultValue),
    has: (key: string): boolean => opts.settings.get<unknown>(key.replace(/^codeblocks\./, ''), undefined) !== undefined,
    inspect: () => undefined,
    update: async () => undefined,
  };

  const shim: Record<string, unknown> = {
    version: '1.102.0',
    Disposable,
    Position,
    Range,
    Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    Uri,
    EventEmitter,
    TreeItem: class { constructor(public label?: unknown, public collapsibleState?: unknown) {} },
    ThemeIcon: class { constructor(public id: string) {} },
    ThemeColor: class { constructor(public id: string) {} },
    MarkdownString: class {
      value = '';
      constructor(v = '') { this.value = v; }
      appendText(t: string): this { this.value += t; return this; }
      appendMarkdown(t: string): this { this.value += t; return this; }
    },
    Location: class { constructor(public uri: unknown, public range: unknown) {} },
    env: { language: process.env.CB_UI_LANGUAGE ?? 'en', appName: 'Code::Blocks CLI', appRoot: process.cwd() },
    workspace: {
      getConfiguration: () => configuration,
      workspaceFolders: undefined,
      onDidChangeConfiguration: () => new Disposable(),
      onDidChangeWorkspaceFolders: () => new Disposable(),
      createFileSystemWatcher: () => ({ onDidChange: () => new Disposable(), onDidCreate: () => new Disposable(), onDidDelete: () => new Disposable(), dispose: () => undefined }),
      findFiles: async () => [],
      openTextDocument: async (p: unknown) => ({ uri: p, getText: async () => '' }),
      fs: { readFile: async () => new Uint8Array(), writeFile: async () => undefined, stat: async () => ({}) },
      saveAll: async () => true,
      asRelativePath: (p: string) => p,
    },
    window: {
      showInformationMessage: async (m: string) => { log(String(m)); return undefined; },
      showWarningMessage: async (m: string) => { log(`[warn] ${m}`); return undefined; },
      showErrorMessage: async (m: string) => { log(`[error] ${m}`); return undefined; },
      showQuickPick: async () => undefined,
      showInputBox: async () => undefined,
      createOutputChannel: () => outputChannel,
      withProgress: async (_o: unknown, task: (p: unknown, t: unknown) => unknown) => task({ report: () => undefined }, { isCancellationRequested: false, onCancellationRequested: () => new Disposable() }),
      activeTextEditor: undefined,
      createStatusBarItem: () => ({ text: '', tooltip: '', command: '', show: () => undefined, hide: () => undefined, dispose: () => undefined }),
      createTerminal: () => { throw new Error('Interactive terminals are not available in this transport'); },
      onDidChangeWindowState: () => new Disposable(),
    },
    debug: {
      activeDebugSession: undefined,
      startDebugging: async () => false,
      stopDebugging: async () => undefined,
      addBreakpoints: () => undefined,
      removeBreakpoints: () => undefined,
      onDidTerminateDebugSession: () => new Disposable(),
    },
    commands: { registerCommand: () => new Disposable(), executeCommand: async () => undefined },
    languages: { getDiagnostics: () => [] },
  };

  const proxy = new Proxy(shim, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof typeof target];
      return stub(prop);
    },
    has: () => true,
  });

  const moduleAny = nodeModule;
  const original = moduleAny._load;
  moduleAny._load = function (request: unknown, parent: unknown, isMain: unknown): unknown {
    if (request === 'vscode') return proxy;
    return original.call(this, request, parent, isMain);
  };

  return {
    lines,
    restore(): void { moduleAny._load = original; },
  };
}
