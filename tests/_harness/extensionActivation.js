// 可激活扩展的测试辅助：在共享 vscodeMock 之上补齐 activate() 所需桩，并提供命令直调与对话框脚本化。
//
// 用法：
//   const h = require('./extensionActivation');
//   const app = await h.activate({ config: { 'codeblocks.clangd.enabled': false } });
//   await app.invoke('codeblocks.bookmarks.toggle');
//   app.records.executeCommand   // 记录 executeCommand 调用
//   app.setQuickPick('选项名')   // 预置下一次 showQuickPick 结果（FIFO）
//
// 设计要点：
//  - 只做「增量补桩」：mock 已有成员不动，缺什么补什么，避免影响其它测试。
//  - globalStorageUri 指向临时目录（settings/keybindings 落盘不碰真实用户目录）。
//  - 对话框（QuickPick/InputBox/OpenDialog/SaveDialog/警告按钮）全部脚本化并留痕。
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const { installVscodeMock, currentMock, Uri, Disposable: MockDisposable } = require('./vscodeMock');

const ROOT = path.resolve(__dirname, '..', '..');

class EventEmitter {
  constructor() { this.listeners = []; }
  get event() { return (l) => { this.listeners.push(l); return new MockDisposable(); }; }
  fire(v) { for (const l of [...this.listeners]) l(v); }
  dispose() { this.listeners = []; }
}

/** 造一个「像文档」的对象：uri/文件名/行数可读，支持 getText/lineAt */
function makeDoc(filePath, text, languageId = 'cpp') {
  const lines = String(text).split('\n');
  const uri = Uri.file(filePath);
  return {
    uri,
    fileName: filePath,
    languageId,
    isDirty: false,
    isClosed: false,
    lineCount: lines.length,
    getText: (range) => {
      if (!range) return lines.join('\n');
      const s = Math.max(0, range.start.line);
      const e = Math.min(lines.length - 1, range.end.line);
      return lines.slice(s, e + 1).join('\n');
    },
    lineAt: (i) => ({ text: lines[i] ?? '', range: { start: { line: i, character: 0 }, end: { line: i, character: (lines[i] ?? '').length } } }),
    positionAt: (offset) => ({ line: 0, character: Number(offset) || 0 }),
    offsetAt: (pos) => (pos && pos.character) || 0,
    getWordRangeAtPosition: () => undefined,
    validateRange: (r) => r,
    validatePosition: (p) => p,
    save: () => Promise.resolve(true),
  };
}

/** 造一个可编辑的 workspace 文档替身（applyEdit/WorkspaceEdit 用） */
function makeWorkspaceEdit() {
  const edits = [];
  return {
    edits,
    replace: (uri, range, newText) => edits.push({ kind: 'replace', uri, range, newText }),
    insert: (uri, pos, newText) => edits.push({ kind: 'insert', uri, pos, newText }),
    delete: (uri, range) => edits.push({ kind: 'delete', uri, range }),
    createFile: (uri, opts) => edits.push({ kind: 'createFile', uri, opts }),
    set: () => edits.push({ kind: 'set' }),
    get size() { return edits.length; },
    entries: () => edits.map((e) => [e.uri, [e]]),
  };
}

/**
 * 安装 mock 并激活扩展。
 * @param {object} [opts]
 * @param {object} [opts.config] 预置配置（`codeblocks.xxx` 扁平键）
 * @param {string} [opts.tmpDir] 工作目录（默认新建临时目录）
 * @param {object} [opts.workspaceFolders] 工作区文件夹（默认 tmpDir）
 * @param {string[]|Function} [opts.findFilesResult] mock 的 workspace.findFiles 返回（数组或 (include, exclude) => 数组）
 */
async function activate(opts = {}) {
  const tmpDir = opts.tmpDir || fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ext-'));
  const userDir = path.join(tmpDir, 'User');
  fs.mkdirSync(userDir, { recursive: true });

  const mock = installVscodeMock({
    config: { 'codeblocks.clangd.enabled': false, ...(opts.config || {}) },
    findFilesResult: opts.findFilesResult,
  });
  const vscode = mock.vscode;
  const records = {
    executeCommand: [], saveAll: 0, clipboard: [], tasks: [], setContext: [], openExternal: [], appliedEdits: [], decorations: [], shownDocuments: [],
    quickPickPrompts: [], inputBoxPrompts: [], warningButtons: [], openDialogs: [], saveDialogs: [], statusBarMessages: [], treeProviders: [],
  };
  const queues = { quickPick: [], inputBox: [], warning: [], openDialog: [], saveDialog: [] };
  const events = { createFiles: new EventEmitter(), saveDoc: new EventEmitter(), activeEditor: new EventEmitter() };

  // ---- 补齐 activate() 所需桩（仅缺失项） ----
  vscode.workspace.textDocuments = [];
  vscode.workspace.saveAll = () => { records.saveAll++; return Promise.resolve(true); };
  vscode.workspace.onDidCreateFiles = (l) => { events.createFiles.listeners.push(l); return new MockDisposable(); };
  vscode.workspace.onDidRenameFiles = () => new MockDisposable();
  vscode.workspace.onDidDeleteFiles = () => new MockDisposable();
  vscode.workspace.onDidSaveTextDocument = (l) => { events.saveDoc.listeners.push(l); return new MockDisposable(); };
  vscode.workspace.workspaceFolders = opts.workspaceFolders ?? [{ uri: Uri.file(tmpDir), name: path.basename(tmpDir), index: 0 }];
  vscode.workspace.getWorkspaceFolder = () => vscode.workspace.workspaceFolders[0];
  /** 造一个编辑器替身（showTextDocument / setActiveEditor 共用） */
  const makeEditor = (doc) => {
    const sel = () => ({ start: { line: 0, character: 0 }, end: { line: 0, character: 0 }, isEmpty: true, active: { line: 0, character: 0 }, anchor: { line: 0, character: 0 } });
    const editor = {
      document: doc,
      selection: sel(),
      selections: [sel()],
      revealRange: () => {},
      edit: (cb) => { const e = makeWorkspaceEdit(); cb(e); records.appliedEdits.push({ viaEditor: true, edit: e }); return Promise.resolve(true); },
      setDecorations: (type, ranges) => { records.decorations.push({ type, ranges }); },
      options: {},
      viewColumn: 1,
      __cbTag: 'editorActivation',
    };
    return editor;
  };
  vscode.workspace.openTextDocument = (p) => {
    const fp = typeof p === 'string' ? p : (p && p.fsPath) || String(p);
    const content = fs.existsSync(fp) && fs.statSync(fp).isFile() ? fs.readFileSync(fp, 'utf-8') : '';
    return Promise.resolve(makeDoc(fp, content));
  };
  vscode.window.showTextDocument = async (docOrUri) => {
    const doc = docOrUri && docOrUri.getText ? docOrUri : makeDoc(typeof docOrUri === 'string' ? docOrUri : docOrUri.fsPath, '');
    records.shownDocuments.push(doc.fileName);
    const ed = makeEditor(doc);
    vscode.window.activeTextEditor = ed;
    return ed;
  };
  vscode.workspace.applyEdit = (edit) => { records.appliedEdits.push(edit); return Promise.resolve(true); };
  vscode.window.registerTreeDataProvider = (id, provider) => { records.treeProviders.push({ id, provider }); return new MockDisposable(); };
  vscode.window.setStatusBarMessage = (m) => { records.statusBarMessages.push(m); return new MockDisposable(); };
  vscode.window.onDidChangeActiveTextEditor = (l) => { events.activeEditor.listeners.push(l); return new MockDisposable(); };
  vscode.window.showQuickPick = (items, o) => {
    records.quickPickPrompts.push({
      items: (items || []).map((i) => (typeof i === 'string' ? i : i.label)),
      raw: items || [],
      options: o,
    });
    return Promise.resolve(queues.quickPick.length ? queues.quickPick.shift() : undefined);
  };
  vscode.window.showInputBox = (o) => {
    records.inputBoxPrompts.push(o);
    return Promise.resolve(queues.inputBox.length ? queues.inputBox.shift() : undefined);
  };
  vscode.window.showWarningMessage = (m, ...buttons) => {
    records.warningButtons.push({ message: m, buttons: buttons.flat() });
    mock.warnings.push(m);
    return Promise.resolve(queues.warning.length ? queues.warning.shift() : undefined);
  };
  vscode.window.showOpenDialog = (o) => {
    records.openDialogs.push(o);
    const v = queues.openDialog.length ? queues.openDialog.shift() : undefined;
    return Promise.resolve(v === undefined ? undefined : (Array.isArray(v) ? v : [v]));
  };
  vscode.window.showSaveDialog = (o) => {
    records.saveDialogs.push(o);
    const v = queues.saveDialog.length ? queues.saveDialog.shift() : undefined;
    return Promise.resolve(v === undefined ? undefined : (v && v.fsPath ? v : Uri.file(v)));
  };
  vscode.commands.executeCommand = (id, ...args) => {
    records.executeCommand.push({ id, args });
    if (id === 'setContext') records.setContext.push(args);
    return Promise.resolve(undefined);
  };
  vscode.tasks = vscode.tasks || {};
  vscode.tasks.executeTask = (t) => { records.tasks.push(t); return Promise.resolve({ terminate: () => {}, onDidTerminate: () => new MockDisposable() }); };
  vscode.tasks.onDidEndTaskProcess = () => new MockDisposable();
  vscode.tasks.onDidStartTaskProcess = () => new MockDisposable();
  vscode.tasks.onDidEndTask = () => new MockDisposable();
  vscode.tasks.onDidStartTask = () => new MockDisposable();
  vscode.tasks.taskExecutions = [];
  vscode.env.clipboard = { writeText: (t) => { records.clipboard.push(t); return Promise.resolve(); } };
  vscode.env.openExternal = (u) => { records.openExternal.push(u); return Promise.resolve(true); };
  vscode.WorkspaceEdit = function WorkspaceEdit() { return makeWorkspaceEdit(); };
  vscode.WorkspaceEdit.prototype = makeWorkspaceEdit();
  // 几何/装饰类（activate 与命令处理器会用；mock 未提供 Selection / 装饰枚举 / Task 系列）
  // 注意：mock 的未知成员兜底会让 `!vscode.X` 恒为假，必须按「自身属性」判断是否缺省。
  const hasOwn = (name) => Object.prototype.hasOwnProperty.call(vscode, name);
  const defineIfAbsent = (name, value) => { if (!hasOwn(name)) vscode[name] = value; };
  defineIfAbsent('Selection', function Selection(a, b, c, d) {
    const start = typeof a === 'number' ? new vscode.Position(a, b) : a;
    const end = typeof a === 'number' ? new vscode.Position(c, d) : (c ?? a);
    this.start = start; this.end = end; this.active = end; this.anchor = start;
    this.isEmpty = start.line === end.line && start.character === end.character;
  });
  defineIfAbsent('ThemeColor', class ThemeColor { constructor(id) { this.id = id; } });
  defineIfAbsent('DecorationRangeBehavior', { OpenOpen: 0, ClosedClosed: 1, OpenClosed: 2, ClosedOpen: 3 });
  defineIfAbsent('OverviewRulerLane', { Left: 1, Center: 2, Right: 4, Full: 7 });
  defineIfAbsent('TextEditorRevealType', { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 });
  defineIfAbsent('TaskScope', { Global: 1, Workspace: 2, Folder: 3 });
  defineIfAbsent('TaskRevealKind', { Always: 1, Silent: 2, Never: 3 });
  defineIfAbsent('TaskPanelKind', { Shared: 1, Dedicated: 2, New: 3 });
  defineIfAbsent('ShellExecution', function ShellExecution(cmd, argsOrOpts) {
    this.command = cmd;
    if (Array.isArray(argsOrOpts)) { this.args = argsOrOpts; this.commandLine = `${cmd} ${argsOrOpts.join(' ')}`; }
    else { this.args = undefined; this.options = argsOrOpts; this.commandLine = String(cmd); }
  });
  defineIfAbsent('ProcessExecution', function ProcessExecution(proc, args, opts) { this.process = proc; this.args = args; this.options = opts; });
  defineIfAbsent('Task', function Task(definition, scope, name, source, execution) {
    this.definition = definition; this.scope = scope; this.name = name; this.source = source; this.execution = execution;
    this.isBackground = false; this.presentationOptions = {}; this.problemMatchers = [];
  });
  vscode.debug.onDidChangeActiveDebugSession = () => new MockDisposable();
  vscode.debug.onDidTerminateDebugSession = () => new MockDisposable();
  vscode.debug.registerDebugConfigurationProvider = () => new MockDisposable();
  vscode.debug.registerDebugAdapterDescriptorFactory = () => new MockDisposable();
  vscode.debug.onDidReceiveDebugSessionCustomEvent = () => new MockDisposable();
  // 自身扩展（版本号等）；其它 id 交给 mock 的安装表（clangd 扩展安装/卸载回归用）
  const selfExtension = { id: 'robinmaomao.codeblocks-vscode', extensionPath: ROOT, packageJSON: require(path.join(ROOT, 'package.json')), exports: undefined };
  const mockGetExtension = vscode.extensions.getExtension;
  vscode.extensions.getExtension = (id) => (id === selfExtension.id ? selfExtension : mockGetExtension(id));

  const ctx = {
    subscriptions: [],
    extensionPath: ROOT,
    extensionUri: Uri.file(ROOT),
    globalState: {
      _m: new Map(),
      get(k, d) { return this._m.has(k) ? this._m.get(k) : d; },
      update(k, v) { this._m.set(k, v); return Promise.resolve(); },
      keys: () => [...ctx.globalState._m.keys()],
      setKeysForSync: () => {},
    },
    workspaceState: {
      _m: new Map(),
      get(k, d) { return this._m.has(k) ? this._m.get(k) : d; },
      update(k, v) { this._m.set(k, v); return Promise.resolve(); },
      keys: () => [...ctx.workspaceState._m.keys()],
    },
    globalStorageUri: Uri.file(path.join(userDir, 'globalStorage', 'robinmaomao.codeblocks-vscode')),
    storageUri: Uri.file(path.join(tmpDir, 'wsStorage')),
    logUri: Uri.file(path.join(tmpDir, 'logs')),
    secrets: { get: () => Promise.resolve(undefined), store: () => Promise.resolve(), delete: () => Promise.resolve(), onDidChange: () => new MockDisposable() },
    extensionMode: 3,
    environmentVariableCollection: { replace: () => {}, append: () => {}, prepend: () => {}, clear: () => {}, forEach: () => {}, delete: () => {}, persistent: false },
    asAbsolutePath: (p) => path.join(ROOT, p),
    extension: { id: 'robinmaomao.codeblocks-vscode', extensionPath: ROOT, packageJSON: require(path.join(ROOT, 'package.json')) },
  };
  fs.mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });

  const ext = require(path.join(ROOT, 'dist', 'extension.js'));
  await ext.activate(ctx);

  const app = {
    mock, vscode, ctx, records, events, tmpDir, userDir, ext,
    /** 直调已注册的命令处理器（后注册者优先，取最后一个） */
    async invoke(id, ...args) {
      const handlers = mock.commandHandlers.get(id);
      if (!handlers || !handlers.length) throw new Error(`命令未注册: ${id}`);
      return handlers[handlers.length - 1](...args);
    },
    has: (id) => mock.commandHandlers.has(id),
    setConfig(key, value) { mock.configStore[key] = value; },
    setQuickPick(v) { queues.quickPick.push(v); },
    setInputBox(v) { queues.inputBox.push(v); },
    setWarningButton(v) { queues.warning.push(v); },
    setOpenDialog(v) { queues.openDialog.push(v); },
    setSaveDialog(v) { queues.saveDialog.push(v); },
    /** 设置活动编辑器（同时进 visibleTextEditors 与 textDocuments） */
    setActiveEditor(filePath, text, languageId) {
      const doc = makeDoc(filePath, text, languageId);
      vscode.workspace.textDocuments = [doc];
      const editor = makeEditor(doc);
      vscode.window.activeTextEditor = editor;
      vscode.window.visibleTextEditors = [editor];
      return { editor, doc };
    },
    async deactivate() { if (typeof ext.deactivate === 'function') await ext.deactivate(); mock.restore(); },
  };
  return app;
}

module.exports = { activate, makeDoc, makeWorkspaceEdit, createVscodeMock: require('./vscodeMock').createVscodeMock, currentMock };
