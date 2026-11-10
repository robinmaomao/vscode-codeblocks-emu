// 工程搜索 Provider 回归：消息协议、文件/内容结果 DTO、打开跳转、历史记录/上次结果、保留历史关闭、子树。
const fs = require('fs');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}
const tick = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const ROOT = path.resolve(__dirname, '..');
const mock = installVscodeMock({ config: { 'codeblocks.ui.language': 'zh-cn' } });
const { ProjectSearchViewProvider, SEARCH_HISTORY_KEY } = require('../dist/ui/projectSearchView.js');
const { Disposable } = require('./_harness/vscodeMock');

const project = {
  title: 'demo', filename: path.join(ROOT, 'demo.cbp'), basePath: ROOT,
  files: [
    { relativeFilename: 'src/main.c', absolutePath: path.join(ROOT, 'src/main.c') },
    { relativeFilename: 'src/util.c', absolutePath: path.join(ROOT, 'src/util.c') },
    { relativeFilename: 'include/util.h', absolutePath: path.join(ROOT, 'include/util.h') },
  ],
};
const second = {
  title: 'lib', filename: path.join(ROOT, 'lib.cbp'), basePath: ROOT,
  files: [{ relativeFilename: 'lib/api.c', absolutePath: path.join(ROOT, 'lib/api.c') }],
};

function makeContext() {
  const state = new Map();
  return {
    extensionPath: ROOT,
    extensionUri: mock.vscode.Uri.file(ROOT),
    subscriptions: [],
    workspaceState: {
      get: (k, d) => (state.has(k) ? state.get(k) : d),
      update: (k, v) => { state.set(k, v); return Promise.resolve(); },
      keys: () => [...state.keys()],
      __state: state,
    },
  };
}
function makeView() {
  const listeners = {};
  const view = {
    visible: true,
    webview: {
      options: undefined,
      html: '',
      cspSource: 'vscode-webview://test',
      asWebviewUri: (uri) => uri,
      posted: [],
      onDidReceiveMessage: (fn) => { listeners.message = fn; return new Disposable(); },
      postMessage: (m) => { view.webview.posted.push(m); return Promise.resolve(true); },
    },
    onDidChangeVisibility: (fn) => { listeners.visibility = fn; return new Disposable(); },
    onDidDispose: (fn) => { listeners.dispose = fn; return new Disposable(); },
    show: () => { view.visible = true; },
    __emit: (m) => listeners.message && listeners.message(m),
    __visibility: (v) => { view.visible = v; listeners.visibility && listeners.visibility({ visible: v }); },
    __dispose: () => listeners.dispose && listeners.dispose(),
  };
  return view;
}
function fakeWorkerFactory(resultFor) {
  const created = [];
  const factory = () => {
    const listeners = { message: [], error: [], exit: [] };
    const worker = {
      on: (ev, fn) => { (listeners[ev] || (listeners[ev] = [])).push(fn); },
      postMessage: (msg) => {
        if (msg.type === 'search') {
          setTimeout(() => {
            const result = resultFor(msg);
            for (const fn of listeners.message) fn({ type: 'result', id: msg.id, result });
          }, 0);
        }
      },
      terminate: () => { worker.terminated = true; },
      listeners,
    };
    created.push(worker);
    return worker;
  };
  factory.created = created;
  return factory;
}

(async () => {
  const context = makeContext();
  const opened = [];
  const revealed = [];
  const workerFactory = fakeWorkerFactory((msg) => ({
    files: msg.files.slice(0, 2).map((f, i) => ({
      file: f,
      matches: i === 0 ? [{ line: 4, column: 2, length: 5, preview: 'hello world', previewStart: 0, previewLength: 5 }] : [],
    })).filter((f) => f.matches.length),
    truncated: false,
    aborted: false,
    total: msg.files.length,
    scanned: msg.files.length,
    matchCount: 1,
    skipped: {},
    durationMs: 1,
  }));
  const host = {
    getProjects: () => [project, second],
    getActiveProject: () => project,
    filesUnder: (node) => (node && node.files) || project.files,
    revealFile: async (p, f) => { revealed.push([p.title, f.relativeFilename]); },
    openLocation: async (file, line, column, length) => { opened.push({ file, line, column, length }); return true; },
    createTextSearchWorker: workerFactory,
  };
  const provider = new ProjectSearchViewProvider(context, host);
  const view = makeView();
  provider.resolveWebviewView(view);
  view.__emit({ type: 'ready' });
  await tick();
  const state = view.webview.posted.find((m) => m.type === 'state');
  check('Provider：ready 后下发状态', !!state && state.hasProjects === true && state.fileCount === 4, state);
  check('Provider：HTML 已设置且带 CSP', view.webview.html.includes('Content-Security-Policy') && view.webview.options.enableScripts === true);
  check('Provider：Seti 字体 URI + font-src CSP', view.webview.html.includes('seti.woff') && view.webview.html.includes('font-src vscode-webview://test'), view.webview.html.slice(0, 200));

  view.__emit({ type: 'searchFiles', query: 'util', requestId: 7 });
  await tick();
  const fileResults = view.webview.posted.filter((m) => m.type === 'fileResults' && m.query === 'util').pop();
  check('文件模式：只返回工程内文件', !!fileResults && fileResults.results.length === 2 && fileResults.results.every((r) => r.relativePath.includes('util')), fileResults && fileResults.results.map((r) => r.relativePath));
  check('文件模式：活动工程优先标记', fileResults.results[0].isActive === true, fileResults.results.map((r) => [r.projectTitle, r.isActive]));

  const resultsBeforeContext = view.webview.posted.filter((m) => m.type === 'fileResults').length;
  provider.notifyContextChanged();
  await tick(500);
  check('工程/活动工程变化不自动重排结果', view.webview.posted.filter((m) => m.type === 'fileResults').length === resultsBeforeContext,
    view.webview.posted.filter((m) => m.type === 'fileResults').length);

  const firstId = fileResults.results[0].id;
  view.__emit({ type: 'openFile', id: firstId });
  await tick();
  check('打开文件：调用 openLocation', opened.length === 1 && opened[0].file.endsWith('.c'), opened);
  const historyAfterOpen = context.workspaceState.get(SEARCH_HISTORY_KEY);
  check('文件历史：打开结果时才记录并写上次位置', historyAfterOpen && historyAfterOpen.entries.length === 1
    && historyAfterOpen.entries[0].mode === 'files' && historyAfterOpen.entries[0].lastResult.relativeFilename, historyAfterOpen);

  view.__emit({ type: 'searchText', query: 'util' });
  await tick(60);
  const textResults = view.webview.posted.find((m) => m.type === 'textResults');
  check('内容模式：结果 DTO + 匹配 id', !!textResults && textResults.files.length === 1 && textResults.files[0].matches.length === 1
    && textResults.files[0].matches[0].id, textResults);
  check('内容模式：活动工程标记（用于工程分组高亮）', textResults.files[0].isActive === true, textResults.files.map((f) => [f.projectTitle, f.isActive]));
  const matchId = textResults.files[0].matches[0].id;
  view.__emit({ type: 'openMatch', id: matchId });
  await tick();
  check('打开匹配：0-based 行列 + 长度', opened.length === 2 && opened[1].line === 4 && opened[1].column === 2 && opened[1].length === 5, opened);
  const historyAfterMatch = context.workspaceState.get(SEARCH_HISTORY_KEY);
  const textEntry = historyAfterMatch.entries.find((e) => e.mode === 'text');
  check('内容历史：搜索即记录 + 上次位置', !!textEntry && textEntry.lastResult.line === 4 && textEntry.lastResult.column === 2, textEntry);

  view.__emit({ type: 'getHistory', mode: 'all' });
  await tick();
  const historyMsg = view.webview.posted.filter((m) => m.type === 'history').pop();
  check('历史消息：按模式返回', !!historyMsg && historyMsg.entries.length === 2, historyMsg && historyMsg.entries.length);

  view.__emit({ type: 'runHistory', id: textEntry.id, action: 'jump' });
  await tick();
  check('历史点击：有效上次结果直接跳转', opened.length === 3 && opened[2].line === 4, opened);

  mock.configStore['codeblocks.search.keepHistory'] = false;
  view.__emit({ type: 'searchText', query: 'util' });
  await tick(60);
  const before = context.workspaceState.get(SEARCH_HISTORY_KEY).entries.length;
  check('保留历史关闭：不再写历史', before === 2, before);
  mock.configStore['codeblocks.search.keepHistory'] = true;

  view.__emit({ type: 'requestClearHistory' });
  await tick();
  check('清空历史：模态取消时保留', context.workspaceState.get(SEARCH_HISTORY_KEY).entries.length === 2,
    context.workspaceState.get(SEARCH_HISTORY_KEY).entries.length);

  const originalWarning = mock.vscode.window.showWarningMessage;
  mock.vscode.window.showWarningMessage = (_message, _options, ...items) => Promise.resolve(items[0]);
  view.__emit({ type: 'requestClearHistory' });
  await tick();
  check('清空历史：模态确认后清空', context.workspaceState.get(SEARCH_HISTORY_KEY).entries.length === 0);
  mock.vscode.window.showWarningMessage = originalWarning;

  view.__emit({ type: 'clearHistory' });
  await tick();
  check('清空历史：程序化清空仍可用', context.workspaceState.get(SEARCH_HISTORY_KEY).entries.length === 0);

  view.__emit({ type: 'stateChanged', mode: 'text', queries: { files: 'main', text: 'util' }, caseSensitive: true, wholeWord: true, regex: true });
  await tick();
  const persistedView = context.workspaceState.get('codeblocks.search.viewState');
  check('状态持久化：每模式查询/选项', persistedView && persistedView.mode === 'text' && persistedView.queries.files === 'main' && persistedView.caseSensitive === true && persistedView.wholeWord === true && persistedView.regex === true, persistedView);

  view.__emit({ type: 'commitHistory', mode: 'files', query: 'main' });
  await tick();
  const committed = context.workspaceState.get(SEARCH_HISTORY_KEY).entries;
  check('文件模式 Enter 提交搜索历史', committed.length === 1 && committed[0].mode === 'files' && committed[0].query === 'main', committed);

  provider.setSubtreeScope(project, { kind: 'folder', dirKey: 'src', project, files: [project.files[0]] });
  await tick();
  check('子树：chip 状态 + 只搜子树', view.webview.posted.some((m) => m.type === 'scopeOverride' && m.subtree && m.subtree.label.includes('demo')), context.workspaceState.get('codeblocks.search.subtree'));
  view.__emit({ type: 'searchFiles', query: '', requestId: 11 });
  await tick();
  const subtreeResults = view.webview.posted.filter((m) => m.type === 'fileResults').pop();
  check('子树：文件结果限制在子树', subtreeResults.results.length === 1 && subtreeResults.results[0].relativePath === 'src/main.c', subtreeResults.results.map((r) => r.relativePath));
  view.__emit({ type: 'clearSubtreeScope' });
  await tick();
  check('子树：清除后恢复', !context.workspaceState.get('codeblocks.search.subtree'));

  view.__emit({ type: 'revealFile', id: subtreeResults.results[0].id });
  await tick();
  check('在工程树中定位：调用 host.revealFile', revealed.length >= 1, revealed);

  provider.dispose();
  view.__dispose();
  mock.restore();
  console.log(`\n工程搜索 Provider: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  mock.restore();
  console.log(`\n工程搜索 Provider: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
