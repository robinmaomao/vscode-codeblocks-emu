// Y1 回归：esbuild 单文件打包（main → bundle/extension.js；dist 与 node_modules 不再入包）。
// 配置断言始终执行；产物断言在 bundle 已构建时执行（npm run bundle / npm run package / vsce package 之后）。
// A3/A3b：构建入口改由 `vscode:prepublish` 钩子承担（vsce package/publish 前自动 compile+bundle），
//         防止直接跑 `vsce publish` 时打进过期或缺失的 bundle/extension.js。
const fs = require('fs');
const path = require('path');
const pkg = require('../package.json');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const root = path.join(__dirname, '..');

// ---------- A. 打包配置 ----------
check('A1 main 指向 bundle/extension.js', pkg.main === './bundle/extension.js', pkg.main, './bundle/extension.js');
const bundleScript = pkg.scripts?.bundle || '';
check('A2 bundle 脚本：esbuild + --bundle + --external:vscode + 输出 bundle/extension.js',
  bundleScript.includes('esbuild') && bundleScript.includes('--bundle') && bundleScript.includes('--external:vscode') && bundleScript.includes('--outfile=bundle/extension.js'),
  bundleScript, 'esbuild … --bundle … --external:vscode … --outfile=bundle/extension.js');
check('A3 package 脚本直接调用 vsce package（构建交由 vscode:prepublish 钩子）',
  /(^|\s)vsce package\s*$/.test((pkg.scripts?.package || '').trim()),
  pkg.scripts?.package, 'vsce package');
check('A3b vscode:prepublish 钩子按序 compile → bundle（vsce package/publish 前自动构建入口）',
  (() => {
    const s = pkg.scripts?.['vscode:prepublish'] || '';
    return s.includes('npm run compile') && s.includes('npm run bundle') && s.indexOf('npm run compile') < s.indexOf('npm run bundle');
  })(),
  pkg.scripts?.['vscode:prepublish'], 'npm run compile && npm run bundle');
check('A4 esbuild 为 devDependency，运行时无 dependencies（fast-xml-parser 已内联）',
  !!pkg.devDependencies?.esbuild && !pkg.dependencies, { esbuild: pkg.devDependencies?.esbuild, dependencies: pkg.dependencies }, { esbuild: '…', dependencies: undefined });

const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8');
check('A5 .vscodeignore 排除 dist/** 与 node_modules/**（防未内联内容误入包）',
  /^dist\/\*\*$/m.test(ignore) && /^node_modules\/\*\*$/m.test(ignore), { dist: /^dist\/\*\*$/m.test(ignore), nm: /^node_modules\/\*\*$/m.test(ignore) }, { dist: true, nm: true });
check('A6 地图文件仍被排除（**/*.map）', /\*\*\/\*\.map/.test(ignore), undefined, '**/*.map');
check('A7 THIRD-PARTY-NOTICES.md 存在且含 fast-xml-parser（MIT 归属）',
  fs.existsSync(path.join(root, 'THIRD-PARTY-NOTICES.md')) && fs.readFileSync(path.join(root, 'THIRD-PARTY-NOTICES.md'), 'utf8').includes('fast-xml-parser'),
  undefined, 'exists + fast-xml-parser');

// ---------- B. 产物断言（bundle 存在时） ----------
const bundlePath = path.join(root, 'bundle', 'extension.js');
if (!fs.existsSync(bundlePath)) {
  console.log('（bundle 未构建：仅校验配置；npm run bundle 后重跑以校验产物）');
} else {
  const text = fs.readFileSync(bundlePath, 'utf8');
  check('B1 vscode 保持 external（require("vscode")）', /require\("vscode"\)/.test(text), undefined, 'require("vscode")');
  check('B2 fast-xml-parser 已内联（XMLParser 标记）', text.includes('XMLParser'), undefined, 'XMLParser');
  check('B3 无相对 require 残留（模块已全部内联）', !/require\("\.[^"]*"\)/.test(text), undefined, '无');
  check('B4 CJS 导出块含 activate/deactivate', /module\.exports = __toCommonJS\(extension_exports\)/.test(text) && /activate: \(\) => activate/.test(text) && /deactivate: \(\) => deactivate/.test(text), undefined, 'toCommonJS + activate/deactivate');

  // B5 加载冒烟：mock vscode（含类桩/命名空间兜底）后 require bundle，确认导出的 activate/deactivate 为函数
  const Module = require('module');
  const origLoad = Module._load;
  const noop = () => undefined;
  class Stub { dispose() {} }
  class EventEmitterStub {
    constructor() { this.listeners = []; }
    get event() { return (l) => { this.listeners.push(l); return new Stub(); }; }
    fire(v) { for (const l of this.listeners) l(v); }
  }
  const ns = (obj) => new Proxy(obj, { get(t, k) { if (k in t) return t[k]; if (typeof k === 'string' && /^[a-z]/.test(k)) return noop; return undefined; } });
  const known = {
    TreeItem: class { constructor(l) { this.label = l; } },
    ThemeIcon: class { constructor(id) { this.id = id; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    EventEmitter: EventEmitterStub,
    Disposable: Stub,
    Uri: { file: (p) => ({ fsPath: p, scheme: 'file' }), joinPath: (...a) => ({ fsPath: a.map((x) => (x && x.fsPath) || x).join('/') }) },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    StatusBarAlignment: { Left: 1, Right: 2 },
    commands: ns({ registerCommand: () => new Stub() }),
    window: ns({ createStatusBarItem: () => new Stub(), createOutputChannel: () => new Stub(), createTreeView: () => new Stub(), createWebviewPanel: () => new Stub(), createTerminal: () => new Stub(), createTextEditorDecorationType: () => new Stub() }),
    workspace: ns({ getConfiguration: () => ({ get: () => undefined, inspect: () => undefined, update: noop }) }),
    languages: ns({}),
    debug: ns({}),
  };
  // esbuild __toESM 仅复制 own keys：预扫描 bundle 中的 vscodeNN.Xxx 类名建桩
  for (const m of text.matchAll(/\bvscode\d*\.([A-Z][A-Za-z0-9]*)/g)) { const n = m[1]; if (!(n in known)) known[n] = class { constructor(...a) { this.__args = a; } }; }
  let loaded = null, loadErr = null;
  Module._load = function (request, parent, isMain) { if (request === 'vscode') return known; return origLoad(request, parent, isMain); };
  try { loaded = require(bundlePath); } catch (e) { loadErr = e; } finally { Module._load = origLoad; }
  check('B5 bundle 可加载且导出 activate/deactivate 函数',
    !!loaded && !loadErr && typeof loaded.activate === 'function' && typeof loaded.deactivate === 'function',
    loadErr ? String(loadErr.message) : { activate: typeof loaded?.activate, deactivate: typeof loaded?.deactivate },
    { activate: 'function', deactivate: 'function' });
}

console.log(`\nbundle-packaging 回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
