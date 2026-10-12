// 宿主集成共用工具（webview.tests.js / build.tests.js 复用）
//
// 约束：suite 会被启动器复制到无空格临时目录运行，无法解析仓库 node_modules，
// 因此这里只使用 node 内建模块 + vscode API。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const vscode = require('vscode');

const EXT_ID = 'robinmaomao.codeblocks-vscode';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** 轮询直到 fn() 返回真值（返回该值），超时返回 undefined */
async function waitFor(fn, ms = 30000, intervalMs = 150) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 >= ms) return undefined;
    await delay(intervalMs);
  }
}

/** 给可能永久 pending 的宿主操作套超时（避免整轮宿主测试挂死） */
async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`超时（${ms} ms）：${label}`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** 宿主工作区目录（启动器创建的临时目录） */
function workspaceDir() {
  const f = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return f ? f.uri.fsPath : undefined;
}

/** PATH 上查找可执行工具（where/which），缺失返回 undefined */
function findTool(name) {
  const w = spawnSync(process.platform === 'win32' ? 'where.exe' : 'which', [name], { encoding: 'utf-8', windowsHide: true });
  if (w.status !== 0) return undefined;
  const first = (w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
  return first && fs.existsSync(first) ? first : undefined;
}

/** 递归收集目录下的 .cbp/.workspace（判定「工作区是否已有工程」用） */
function findProjectFiles(root, out = [], depth = 0) {
  if (depth > 6) return out;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const p = path.join(root, e.name);
    if (e.isDirectory()) findProjectFiles(p, out, depth + 1);
    else if (/\.(cbp|workspace)$/i.test(e.name)) out.push(p);
  }
  return out;
}

/** 路径归一化（统一分隔符 + 小写，Windows 大小写不敏感比较） */
const norm = (p) => String(p || '').replace(/\\/g, '/').toLowerCase();

// ———— WebView 标签页观测 ————
// 宿主内实测（本机 VS Code，--extensionTestsPath 模式）：
//  - `vscode.window.tabGroups.all[].tabs` 查询**不可靠**：经常返回空数组或严重滞后（渲染进程→扩展宿主的状态推送不完整）；
//  - `vscode.window.tabGroups.onDidChangeTabs` 事件流**可靠**：opened/changed/closed 都携带完整 Tab
//    （label / isActive / input instanceof TabInputWebview），且能用于关闭标签页；
//  - 扩展 webview 的 API viewType 形如 `mainThreadWebview-<面板viewType>`（VS Code 内部前缀），需归一化后比较。
// 因此这里以「事件流登记表 + 查询结果」双源合并来观测 webview 标签页生命周期。

const tabRegistry = new Map(); // API viewType（含前缀）→ { label, tab }
let tabTracker;

/** webview viewType 归一化：剥掉 VS Code 的 mainThreadWebview- 前缀 */
function normalizeViewType(v) {
  return String(v || '').replace(/^mainThreadWebview-/, '');
}

function ensureTabTracker() {
  if (tabTracker) return;
  tabTracker = vscode.window.tabGroups.onDidChangeTabs((e) => {
    for (const t of [...e.opened, ...e.changed]) {
      const input = t.input;
      if (input instanceof vscode.TabInputWebview) tabRegistry.set(input.viewType, { label: t.label, tab: t });
    }
    for (const t of e.closed) {
      const input = t.input;
      if (input instanceof vscode.TabInputWebview) tabRegistry.delete(input.viewType);
    }
  });
}

/** 收集宿主内全部 WebView 标签页（事件流 + 查询，按归一化 viewType 去重） */
function webviewTabs() {
  ensureTabTracker();
  const out = new Map();
  for (const [viewType, v] of tabRegistry) out.set(viewType, { tab: v.tab, viewType, label: v.label });
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputWebview) {
        out.set(tab.input.viewType, { tab, viewType: tab.input.viewType, label: tab.label, viewColumn: group.viewColumn });
      }
    }
  }
  return [...out.values()];
}

function tabsOfViewType(viewType) {
  const want = normalizeViewType(viewType);
  return webviewTabs().filter((t) => normalizeViewType(t.viewType) === want);
}

async function waitForWebviewTab(viewType, ms = 15000) {
  return waitFor(() => tabsOfViewType(viewType)[0], ms);
}

/** 关闭指定 viewType 的全部 webview 标签页，并等待其从观测源消失；返回是否已消失 */
async function closeWebviewTab(viewType, ms = 8000) {
  for (const t of tabsOfViewType(viewType)) {
    try {
      await vscode.window.tabGroups.close(t.tab);
    } catch {
      // 已被扩展自身 dispose → 忽略
    }
  }
  return (await waitFor(() => tabsOfViewType(viewType).length === 0, ms)) !== undefined;
}

// ———— 工程夹具 ————

/** 仓库根（启动器通过 CB_REPO_ROOT 注入；suite 被复制后 __dirname 已不指向仓库） */
function repoRoot() {
  const ext = vscode.extensions.getExtension(EXT_ID);
  return process.env.CB_REPO_ROOT || (ext ? ext.extensionPath : '');
}

/** 把仓库 test-project 的 hello-cb 工程源码复制到目标目录（不含 bin/obj 产物）；titleOverride 可改工程标题便于日志唯一识别 */
function copyHelloProject(dstDir, titleOverride) {
  const src = path.join(repoRoot(), 'test-project');
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of ['hello-cb.cbp', 'main.c', 'util.c', 'util.h']) {
    fs.copyFileSync(path.join(src, f), path.join(dstDir, f));
  }
  const cbp = path.join(dstDir, 'hello-cb.cbp');
  if (titleOverride) {
    const xml = fs.readFileSync(cbp, 'utf-8').replace('<Option title="hello-cb" />', `<Option title="${titleOverride}" />`);
    fs.writeFileSync(cbp, xml, 'utf-8');
  }
  return cbp;
}

// ———— 扩展输出通道的落盘日志 ————
// 启动器在 <user-data>/User/settings.json 预置 codeblocks.build.persistLog=true →
// 扩展的「Code::Blocks」输出通道为 LogOutputChannel，内容实时写盘：
//   <user-data>/logs/<会话>/window<N>/exthost/robinmaomao.codeblocks-vscode/CodeBlocks.log
// 这是宿主内**唯一**可读的输出通道文本（vscode API 不暴露 OutputChannel 内容），
// 用于断言「构建成功」行 / 链接产物路径行 / 编译器诊断行。

function extensionLogPath() {
  const ud = process.env.CB_HOST_USER_DATA;
  if (!ud) return undefined;
  const hits = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'CodeBlocks.log' && p.includes('robinmaomao.codeblocks-vscode')) hits.push(p);
    }
  };
  walk(path.join(ud, 'logs'), 0);
  if (!hits.length) return undefined;
  hits.sort((a, b) => {
    try {
      return fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs;
    } catch {
      return 0;
    }
  });
  return hits[0];
}

/** 读取扩展输出通道日志全文（不存在时返回 ''） */
function readExtensionLog() {
  const p = extensionLogPath();
  if (!p) return '';
  try {
    return fs.readFileSync(p, 'utf-8');
  } catch {
    return '';
  }
}

function logOffset() {
  return readExtensionLog().length;
}

/**
 * 等待日志中（sinceLength 之后的新增内容里）出现 needle。
 * 注意：构建开始会调用 outputChannel.clear() → 文件被截断；此时 sinceLength 失效，自动退化为全文匹配。
 */
async function waitForLogLine(needle, sinceLength = 0, ms = 25000) {
  const matches = (text) => (typeof needle === 'string' ? text.includes(needle) : needle.test(text));
  let since = sinceLength;
  const t0 = Date.now();
  for (;;) {
    const text = readExtensionLog();
    if (text.length < since) since = 0;
    if (text && matches(text.slice(since))) return true;
    if (Date.now() - t0 >= ms) return false;
    await delay(200);
  }
}

// ———— 诊断观测 ————

/** 取指定文件的全部诊断（跨诊断集合；按 fsPath 归一化匹配，规避大小写/分隔符差异） */
function diagnosticsForFile(fsPath) {
  const want = norm(fsPath);
  const out = [];
  for (const [uri, diags] of vscode.languages.getDiagnostics()) {
    if (norm(uri.fsPath) === want) out.push(...diags);
  }
  return out;
}

/** 写 Global 设置（隔离 user-data-dir，安全） */
async function setConfig(key, value) {
  await vscode.workspace.getConfiguration('codeblocks').update(key, value, vscode.ConfigurationTarget.Global);
}

module.exports = {
  EXT_ID,
  delay,
  waitFor,
  withTimeout,
  workspaceDir,
  findTool,
  findProjectFiles,
  norm,
  normalizeViewType,
  webviewTabs,
  tabsOfViewType,
  waitForWebviewTab,
  closeWebviewTab,
  repoRoot,
  copyHelloProject,
  extensionLogPath,
  readExtensionLog,
  logOffset,
  waitForLogLine,
  diagnosticsForFile,
  setConfig,
};
