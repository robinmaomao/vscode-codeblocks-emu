// 共享 vscode 模块 mock：在无 VS Code 宿主环境下加载 dist 产物（面板渲染、provider 单测等）。
// 用法：
//   const { installVscodeMock } = require('./vscodeMock');
//   const mock = installVscodeMock();            // 之后 require('../../dist/...') 即可
//   ...new SomePanel(...); mock.lastWebviewHtml   // 捕获面板 HTML
//   mock.restore();
// 设计要点：
//  - 显式实现常用 API（Uri/EventEmitter/Disposable/TreeItem/WebviewPanel…），未知成员用 Proxy 兜底返回空函数/空类，
//    避免 dist 在 import 阶段就因缺接口崩溃（与 test-bundle-packaging 的 B5 兜底策略一致）。
//  - WebviewPanel 工厂可自定义（captureWebviews=false 时返回通用 stub）。
const Module = require('module');

const noop = () => undefined;

class Disposable {
  dispose() {}
  static from() { return new Disposable(); }
}

class EventEmitter {
  constructor() { this.listeners = []; }
  get event() { return (listener) => { this.listeners.push(listener); return new Disposable(); }; }
  fire(value) { for (const l of [...this.listeners]) l(value); }
  dispose() { this.listeners = []; }
}

class Uri {
  constructor(scheme, fsPath) { this.scheme = scheme; this.fsPath = fsPath; this.path = String(fsPath).replace(/\\/g, '/'); }
  toString() { return `${this.scheme}:${this.path}`; }
  static file(p) { return new Uri('file', p); }
  static parse(s) { return new Uri('file', String(s).replace(/^file:\/?/, '')); }
  static joinPath(base, ...parts) {
    const sep = base.fsPath.includes('\\') ? '\\' : '/';
    return new Uri(base.scheme, [base.fsPath.replace(/[\\/]$/, ''), ...parts].join(sep));
  }
}

class TreeItem {
  constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; }
}

class ThemeIcon { constructor(id) { this.id = id; } }
class ThemeColor { constructor(id) { this.id = id; } }
class MarkdownString { constructor(value) { this.value = value; } appendText(t) { this.value += t; return this; } appendMarkdown(t) { this.value += t; return this; } }

class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range { constructor(a, b, c, d) { Object.assign(this, typeof a === 'number' ? { start: new Position(a, b), end: new Position(c, d) } : { start: a, end: b }); } }
class Location { constructor(uri, range) { this.uri = uri; this.range = range; } }
class Diagnostic {
  constructor(range, message, severity) { this.range = range; this.message = message; this.severity = severity; }
}

const stubs = new Map();

/** 未显式实现的名字：返回「可 new、可调用」的兜底桩（缓存，保证同一名字恒等） */
function fallback(name) {
  if (!stubs.has(name)) {
    const fn = function (...args) { this.__args = args; };
    fn.prototype.dispose = () => undefined;
    stubs.set(name, fn);
  }
  return stubs.get(name);
}

function createVscodeMock(opts = {}) {
  const webviews = [];
  const channels = [];
  const warnings = [];
  const infos = [];
  const configStore = { ...(opts.config || {}) };
  const fileWatchers = [];
  /** 命令处理器注册表：commandId → 处理器数组（供测试直接调用） */
  const commandHandlers = new Map();

  const makeWebview = (kind, title, column, options) => {
    const msgListeners = [];
    const disposeListeners = [];
    const html = { value: '' };
    const webview = {
      options,
      asWebviewUri: (uri) => uri,
      cspSource: 'vscode-webview://mock',
      get html() { return html.value; },
      set html(v) { html.value = v; },
      postMessage: (m) => { webview.posted.push(m); return Promise.resolve(true); },
      posted: [],
      onDidReceiveMessage: (listener) => { msgListeners.push(listener); return new Disposable(); },
      __emit: (m) => msgListeners.forEach((l) => l(m)),
    };
    const panel = {
      kind, title, viewColumn: column, webview,
      visible: true, active: true,
      reveal() {}, hide() {},
      dispose() { disposeListeners.forEach((l) => l()); },
      onDidDispose: (listener) => { disposeListeners.push(listener); return new Disposable(); },
      onDidChangeViewState: () => new Disposable(),
      iconPath: undefined,
    };
    webviews.push(panel);
    return panel;
  };

  const vscode = {
    version: '1.85.0',
    Uri,
    Position,
    Range,
    Location,
    Diagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon,
    ThemeColor,
    MarkdownString,
    EventEmitter,
    Disposable,
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    // 符号/补全类别枚举（symbolTreeProvider 等按值分组，需与真实 API 数值一致）
    CompletionItemKind: {
      Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6, Interface: 7,
      Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13, Snippet: 14, Color: 15,
      File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20, Struct: 21, Event: 22,
      Operator: 23, TypeParameter: 24,
    },
    SymbolKind: {
      File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7,
      Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14,
      Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22,
      Event: 23, Operator: 24, TypeParameter: 25,
    },
    CompletionItem: class { constructor(label, kind) { this.label = label; this.kind = kind; } },
    CodeAction: class { constructor(title, kind) { this.title = title; this.kind = kind; } },
    CodeActionKind: { QuickFix: 'quickfix', Refactor: 'refactor' },
    ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3 },
    ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
    FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
    EndOfLine: { LF: 1, CRLF: 2 },
    ExtensionMode: { Production: 1, Development: 2, Test: 3 },
    extensions: {
      getExtension: () => undefined,
      all: [],
    },
    env: {
      appName: 'Visual Studio Code',
      appHost: 'desktop',
      language: 'zh-cn',
      machineId: 'mock-machine',
      sessionId: 'mock-session',
      clipboard: { writeText: () => Promise.resolve() },
      openExternal: () => Promise.resolve(true),
    },
    workspace: {
      name: 'mock-workspace',
      isTrusted: true,
      workspaceFolders: undefined,
      getConfiguration: (section) => ({
        get: (key, def) => {
          const full = section ? `${section}.${key}` : key;
          return full in configStore ? configStore[full] : def;
        },
        inspect: (key) => ({ key, defaultValue: configStore[section ? `${section}.${key}` : key] }),
        update: () => Promise.resolve(),
        has: (key) => (section ? `${section}.${key}` : key) in configStore,
      }),
      onDidChangeConfiguration: () => new Disposable(),
      onDidSaveTextDocument: () => new Disposable(),
      onDidOpenTextDocument: () => new Disposable(),
      onDidCloseTextDocument: () => new Disposable(),
      onDidChangeTextDocument: () => new Disposable(),
      onDidChangeWorkspaceFolders: () => new Disposable(),
      createFileSystemWatcher: () => {
        const w = { onDidChange: () => new Disposable(), onDidCreate: () => new Disposable(), onDidDelete: () => new Disposable(), dispose() {} };
        fileWatchers.push(w);
        return w;
      },
      openTextDocument: (p) => Promise.resolve({ uri: typeof p === 'string' ? Uri.file(p) : p, getText: () => '' }),
      applyEdit: () => Promise.resolve(true),
      asRelativePath: (p) => String(p && p.fsPath ? p.fsPath : p),
      findFiles: () => Promise.resolve([]),
      fs: {
        readFile: () => Promise.resolve(Buffer.from('')),
        writeFile: () => Promise.resolve(),
        stat: () => Promise.resolve({ type: 1, size: 0, mtime: 0 }),
        delete: () => Promise.resolve(),
        createDirectory: () => Promise.resolve(),
      },
    },
    window: {
      activeTextEditor: undefined,
      visibleTextEditors: [],
      createWebviewPanel: (kind, title, column, options) => (opts.captureWebviews === false ? fallback('WebviewPanel')() : makeWebview(kind, title, column, options)),
      createOutputChannel: (name) => {
        const ch = { name, lines: [], append: (t) => ch.lines.push(t), appendLine: (t) => ch.lines.push(t), replace: () => {}, clear: () => { ch.lines = []; }, show: () => {}, hide: () => {}, dispose: () => {}, log: noop, warn: noop, error: noop, debug: noop, trace: noop, info: noop };
        channels.push(ch);
        return ch;
      },
      createStatusBarItem: () => ({ text: '', tooltip: '', command: undefined, color: undefined, backgroundColor: undefined, shown: false, show() { this.shown = true; }, hide() { this.shown = false; }, dispose: noop }),
      createTreeView: () => ({ onDidChangeVisibility: () => new Disposable(), onDidChangeSelection: () => new Disposable(), reveal: () => Promise.resolve(), dispose: noop, badge: undefined }),
      createTerminal: () => ({ sendText: noop, show: noop, hide: noop, dispose: noop, processId: Promise.resolve(0) }),
      createTextEditorDecorationType: () => ({ dispose: noop, key: 'mock' }),
      createQuickPick: () => ({ items: [], selectedItems: [], value: '', placeholder: '', title: '', activeItems: [], ignoreFocusOut: false, onDidChangeValue: () => new Disposable(), onDidChangeSelection: () => new Disposable(), onDidAccept: () => new Disposable(), onDidHide: () => new Disposable(), show: noop, hide: noop, dispose: noop }),
      createInputBox: () => ({ value: '', placeholder: '', title: '', onDidChangeValue: () => new Disposable(), onDidAccept: () => new Disposable(), onDidHide: () => new Disposable(), show: noop, hide: noop, dispose: noop }),
      showInformationMessage: (m) => { infos.push(m); return Promise.resolve(undefined); },
      showWarningMessage: (m) => { warnings.push(m); return Promise.resolve(undefined); },
      showErrorMessage: (m) => { warnings.push(m); return Promise.resolve(undefined); },
      showQuickPick: () => Promise.resolve(undefined),
      showInputBox: () => Promise.resolve(undefined),
      showOpenDialog: () => Promise.resolve(undefined),
      showSaveDialog: () => Promise.resolve(undefined),
      showTextDocument: (doc) => Promise.resolve({ document: typeof doc === 'string' ? { uri: Uri.file(doc), getText: () => '' } : doc, revealRange: noop, selection: undefined }),
      withProgress: (_o, task) => Promise.resolve(task({ report: noop }, { isCancellationRequested: false, onCancellationRequested: () => new Disposable() })),
      onDidChangeActiveTextEditor: () => new Disposable(),
      onDidChangeVisibleTextEditors: () => new Disposable(),
      onDidChangeTextEditorSelection: () => new Disposable(),
      onDidChangeWindowState: () => new Disposable(),
      registerWebviewPanelSerializer: () => new Disposable(),
      registerWebviewViewProvider: () => new Disposable(),
      tabGroups: { all: [], close: () => Promise.resolve(true), onDidChangeTabs: () => new Disposable() },
      createWebviewPanelSerializer: () => new Disposable(),
    },
    commands: {
      registerCommand: (id, handler) => {
        if (!commandHandlers.has(id)) commandHandlers.set(id, []);
        commandHandlers.get(id).push(handler);
        return new Disposable();
      },
      registerTextEditorCommand: () => new Disposable(),
      executeCommand: () => Promise.resolve(undefined),
      getCommands: () => Promise.resolve([...commandHandlers.keys()]),
    },
    languages: {
      createDiagnosticCollection: (name) => { const c = { name, map: new Map(), set: (uri, diags) => c.map.set(uri, diags), delete: (uri) => c.map.delete(uri), clear: () => c.map.clear(), dispose: noop, forEach: (cb) => c.map.forEach(cb), get: (uri) => c.map.get(uri) }; return c; },
      registerCompletionItemProvider: () => new Disposable(),
      registerHoverProvider: () => new Disposable(),
      registerDefinitionProvider: () => new Disposable(),
      registerDocumentSymbolProvider: () => new Disposable(),
      registerCodeLensProvider: () => new Disposable(),
      onDidChangeDiagnostics: () => new Disposable(),
      getDiagnostics: () => [],
    },
    debug: {
      registerDebugAdapterDescriptorFactory: () => new Disposable(),
      registerDebugConfigurationProvider: () => new Disposable(),
      registerDebugAdapterTrackerFactory: () => new Disposable(),
      startDebugging: () => Promise.resolve(true),
      stopDebugging: () => Promise.resolve(),
      activeDebugSession: undefined,
      breakpoints: [],
      addBreakpoints: () => {}, removeBreakpoints: () => {}, onDidChangeBreakpoints: () => new Disposable(),
      onDidStartDebugSession: () => new Disposable(), onDidTerminateDebugSession: () => new Disposable(),
      onDidReceiveDebugSessionCustomEvent: () => new Disposable(),
    },
    tasks: { registerTaskProvider: () => new Disposable(), fetchTasks: () => Promise.resolve([]), executeTask: () => Promise.resolve({}) },
    extensions_: undefined,
    comments: { createCommentController: () => ({ dispose: noop, createCommentThread: () => ({ dispose: noop, replies: [] }), commentingRangeProvider: undefined, options: {} }) },
    notebooks: { registerNotebookSerializer: () => new Disposable() },
    authentication: { getSession: () => Promise.resolve(undefined) },
    l10n: { t: (s, ...args) => String(s).replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)] ?? '')) },
  };

  // 未知成员兜底（读取时返回空函数，避免 import 阶段 TypeError）
  const proxied = new Proxy(vscode, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === 'string') return fallback(prop);
      return undefined;
    },
  });

  return { vscode: proxied, webviews, channels, warnings, infos, configStore, fileWatchers, commandHandlers };
}

let installed = null;

/**
 * 装载 mock：拦截 require('vscode')。
 * @param {object} [opts] { config: {..}, captureWebviews: boolean }
 */
function installVscodeMock(opts = {}) {
  const mock = createVscodeMock(opts);
  const origLoad = Module._load;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return mock.vscode;
    return origLoad(request, parent, isMain);
  };
  mock.restore = () => { Module._load = origLoad; if (installed === mock) installed = null; };
  installed = mock;
  return mock;
}

function currentMock() { return installed; }

module.exports = { installVscodeMock, createVscodeMock, currentMock, Uri, EventEmitter, Disposable, TreeItem };
