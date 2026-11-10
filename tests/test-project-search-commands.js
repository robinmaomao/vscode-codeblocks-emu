// 工程搜索命令注册回归：两个命令 ID、工程树子树入口、dispose 清理。
const path = require('path');
const { installVscodeMock, Disposable } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}
const ROOT = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const mock = installVscodeMock({ config: { 'codeblocks.ui.language': 'zh-cn' } });
const { registerProjectSearch } = require('../dist/ui/projectSearchView.js');

const project = {
  title: 'demo', filename: path.join(ROOT, 'demo.cbp'), basePath: ROOT,
  files: [
    { relativeFilename: 'src/main.c', absolutePath: path.join(ROOT, 'src/main.c') },
    { relativeFilename: 'src/util.c', absolutePath: path.join(ROOT, 'src/util.c') },
  ],
};
const state = new Map();
const context = {
  extensionPath: ROOT,
  extensionUri: mock.vscode.Uri.file(ROOT),
  subscriptions: [],
  workspaceState: { get: (k, d) => (state.has(k) ? state.get(k) : d), update: (k, v) => { state.set(k, v); return Promise.resolve(); } },
};
const host = {
  getProjects: () => [project],
  getActiveProject: () => project,
  filesUnder: (node) => (node && node.files) || project.files,
  revealFile: async () => undefined,
  openLocation: async () => true,
};

(async () => {
  const registration = registerProjectSearch(context, host);
  check('onView activation registered', (pkg.activationEvents || []).includes('onView:codeblocks.search'), pkg.activationEvents);
  const searchView = pkg.contributes.views.codeblocks.find((v) => v.id === 'codeblocks.search');
  check('search view declared as webview', searchView && searchView.type === 'webview', searchView);
  check('命令已注册：codeblocks.searchProjectFiles', mock.commandHandlers.has('codeblocks.searchProjectFiles'), [...mock.commandHandlers.keys()].filter((k) => k.includes('search')));
  check('命令已注册：codeblocks.searchInProjectFiles', mock.commandHandlers.has('codeblocks.searchInProjectFiles'), [...mock.commandHandlers.keys()].filter((k) => k.includes('search')));
  check('命令进入 context.subscriptions', context.subscriptions.length >= 3, context.subscriptions.length);

  const filesHandler = mock.commandHandlers.get('codeblocks.searchProjectFiles')[0];
  await filesHandler();
  check('文件命令可调用（视图未解析时不抛错）', true);

  const textHandler = mock.commandHandlers.get('codeblocks.searchInProjectFiles')[0];
  await textHandler({ project, kind: 'folder', dirKey: 'src', files: project.files });
  check('内容命令可从工程树节点限定子树', !!context.workspaceState.get('codeblocks.search.subtree'), context.workspaceState.get('codeblocks.search.subtree'));

  registration.dispose();
  check('dispose 幂等', (() => { try { registration.provider.dispose(); return true; } catch (e) { return false; } })());
  mock.restore();
  console.log(`\n工程搜索命令: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  mock.restore();
  console.log(`\n工程搜索命令: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
