// WebView 面板双语渲染回归（0.8.132-dev 批次 2）：
//  - 三个面板（工程属性 / 快捷键 / 编译选项）模板文本经 `i18n.tr('中文原文')` 插桩
//  - 中文态：渲染结果含既有中文标签、`lang="zh-CN"`、无插桩泄漏
//  - 英文态：渲染结果含英文标签、`lang="en"`、除「工程数据」（如 .cbp 备注）外无中文残留
//  - 反查词条表：插桩单元 ↔ 词条一一对应（无漏译 / 无孤儿 / 值为英文）
// 实现：dist 真实代码 + tests/_harness/vscodeMock + tests/visual/fixtures/rich.cbp（与视觉层同一数据源）。
const fs = require('fs');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'visual', 'fixtures', 'rich.cbp');
const CJK = /[\u4e00-\u9fff]/;

/** 提取 HTML 里的中文片段（跳过注释：模板里的注释中文不进词条表） */
function cjkRuns(html) {
  const cleaned = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '');
  const out = [];
  for (const m of cleaned.matchAll(/[（【「《]?[\u4e00-\u9fff][^<>"'`&\n]*/g)) out.push(m[0].replace(/\s+$/, ''));
  return out;
}

async function main() {
  const mock = installVscodeMock({ config: { 'codeblocks.ui.language': 'auto' } });
  const i18n = require('../dist/i18n');
  const { ProjectParser } = require('../dist/model/parser.js');
  const { CompilerOptionsLoader } = require('../dist/compiler/optionsLoader.js');
  const { ProjectPropertiesPanel } = require('../dist/ui/projectPropertiesPanel.js');
  const { KeybindingPanel } = require('../dist/ui/keybindingPanel.js');
  const { CompilerOptionsPanel } = require('../dist/ui/compilerOptionsPanel.js');

  const project = new ProjectParser().parse(FIXTURE);
  const uri = mock.vscode.Uri.file(ROOT);
  const compiler = new CompilerOptionsLoader(path.join(ROOT, 'resources', 'compilers')).load('gcc');

  const hostStub = {
    getState: () => ({
      rows: [
        { id: 'codeblocks.build', label: 'Build', command: 'Build', group: 'builtin', status: 'default', defaultsLabel: 'f9', effective: 'f9', ok: true },
        { id: 'codeblocks.run', label: 'Run', command: 'Run', group: 'builtin', status: 'custom', defaultsLabel: 'f8', effective: 'ctrl+f8', ok: true },
        { id: 'codeblocks.rebuild', label: 'Rebuild', command: 'Rebuild', group: 'cbStyle', status: 'unbound', defaultsLabel: 'ctrl+f11', effective: '', ok: false },
      ],
      path: 'C:\\Users\\demo\\AppData\\Roaming\\Code\\User\\keybindings.json',
      cbStyle: true,
      notices: [],
    }),
    apply: async () => ({ ok: true, message: '' }),
    check: () => undefined,
    openFile: () => undefined,
    exportScheme: () => undefined,
    importScheme: () => undefined,
    validate: () => ({ ok: true, message: '' }),
    setOverride: async () => ({ ok: true, message: '' }),
    clearOverride: async () => ({ ok: true, message: '' }),
    resetAll: async () => ({ ok: true, message: '' }),
  };

  /** 渲染三个面板（language：zh-cn / en），返回 { props, keybindings, compilerOptions } */
  function render(language) {
    mock.configStore['codeblocks.ui.language'] = language;
    i18n.refreshUiLanguage();
    const out = {};
    // 直接用构造器（而非 ProjectPropertiesPanel.show）：避免同进程内 show 的 dispose 链
    new ProjectPropertiesPanel(project, uri, async () => undefined);
    out.props = mock.webviews[mock.webviews.length - 1].webview.html;
    new KeybindingPanel(uri, hostStub);
    out.keybindings = mock.webviews[mock.webviews.length - 1].webview.html;
    new CompilerOptionsPanel(compiler, project, project.buildTargets[0], uri);
    out.compilerOptions = mock.webviews[mock.webviews.length - 1].webview.html;
    return out;
  }

  // ---- 数据侧「非 UI 中文」基线：.cbp 自身内容（备注 / 标题）不参与本地化 ----
  const fixtureCjk = new Set(cjkRuns(fs.readFileSync(FIXTURE, 'utf-8')));
  const isData = (run) => [...fixtureCjk].some((d) => d.includes(run) || run.includes(d));

  const zh = render('zh-cn');
  const en = render('en');
  i18n.refreshUiLanguage();

  // ---- A. 中文态 ----
  check('A1 工程属性面板：中文态 lang=zh-CN', zh.props.includes('lang="zh-CN"'), zh.props.match(/lang="[^"]*"/)?.[0]);
  check('A2 工程属性面板：中文标签在位',
    ['构建目标', '虚拟目标', '构建选项', '搜索目录', '调试器', '保存并关闭'].every((s) => zh.props.includes(s)));
  check('A3 快捷键面板：中文标签在位',
    zh.keybindings.includes('快捷键') && zh.keybindings.includes('全部重置') && zh.keybindings.includes('检查冲突'));
  check('A4 编译选项面板：中文标签在位', zh.compilerOptions.includes('应用') && zh.compilerOptions.includes('重置'));

  // ---- B. 英文态 ----
  check('B1 工程属性面板：英文态 lang=en', en.props.includes('lang="en"'), en.props.match(/lang="[^"]*"/)?.[0]);
  check('B2 工程属性面板：英文标签在位',
    ['Build targets', 'Virtual targets', 'Build options', 'Search directories', 'Debugger', 'Save and Close'].every((s) => en.props.includes(s)));
  check('B3 快捷键面板：英文标签在位',
    en.keybindings.includes('Reset all') && en.keybindings.includes('Check conflicts') && en.keybindings.includes('Current keybinding'));
  check('B4 编译选项面板：英文标签在位', en.compilerOptions.includes('>Apply<') && en.compilerOptions.includes('>Reset<'));

  const leftovers = {};
  for (const [id, html] of Object.entries(en)) leftovers[id] = [...new Set(cjkRuns(html))];
  const unexpected = {};
  for (const [id, runs] of Object.entries(leftovers)) {
    const bad = runs.filter((r) => !isData(r));
    if (bad.length) unexpected[id] = bad;
  }
  check('B5 英文态渲染仅剩「工程数据」中文（备注等），无 UI 文案残留',
    Object.keys(unexpected).length === 0, unexpected);

  // ---- C. 结构一致性（防止插桩破坏标记） ----
  const tags = (s) => (s.match(/<[a-zA-Z][^>]*>/g) || []).length;
  check('C1 中英两态标签数量一致（无标记损失）',
    tags(zh.props) === tags(en.props) && tags(zh.keybindings) === tags(en.keybindings)
    && tags(zh.compilerOptions) === tags(en.compilerOptions),
    { zhProps: tags(zh.props), enProps: tags(en.props), zhKb: tags(zh.keybindings), enKb: tags(en.keybindings) });
  check('C2 输出无插桩泄漏（不含 i18n.tr( 源码片段）',
    ![...Object.values(zh), ...Object.values(en)].some((h) => h.includes('i18n.tr(')));
  check('C3 英文态无未替换的 ${} 模板残留', !en.props.includes('${') && !en.keybindings.includes('${'));

  // ---- D. 反查词条表 ↔ 插桩单元 ----
  const dictPath = path.join(ROOT, 'src', 'i18n', 'strings.zh-cn.webview.json');
  const dict = JSON.parse(fs.readFileSync(dictPath, 'utf-8'));
  const ts = require('typescript');
  const PANEL_FILES = ['src/ui/projectPropertiesPanel.ts', 'src/ui/keybindingPanel.ts', 'src/ui/compilerOptionsPanel.ts'];
  const units = new Set();
  const nonLiteral = [];
  for (const rel of PANEL_FILES) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'i18n'
        && node.expression.name.text === 'tr') {
        const arg = node.arguments[0];
        if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) units.add(arg.text);
        else nonLiteral.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  check('D0 插桩调用参数均为字面量（便于词条校验）', nonLiteral.length === 0, nonLiteral.slice(0, 10));
  check('D1 插桩单元数 > 0（扫描器有效）', units.size > 0, units.size);
  const noEntry = [...units].filter((u) => !dict[u]);
  check('D2 每个插桩单元都有英文源串', noEntry.length === 0, noEntry.slice(0, 10));
  const orphan = Object.keys(dict).filter((k) => !units.has(k));
  check('D3 反查表无孤儿键', orphan.length === 0, orphan.slice(0, 10));
  const badValue = Object.entries(dict).filter(([, v]) => typeof v !== 'string' || !v.trim() || CJK.test(v)).map(([k]) => k);
  check('D4 英文源串非空且不含中文', badValue.length === 0, badValue.slice(0, 10));
  const sameValue = Object.entries(dict).filter(([k, v]) => k === v).map(([k]) => k);
  check('D5 英文源串不得与中文原文相同', sameValue.length === 0, sameValue.slice(0, 10));

  mock.restore();
  console.log(`\ni18n WebView 双语渲染: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('运行异常: ' + (err && err.stack ? err.stack : err));
  console.log(`\ni18n WebView 双语渲染: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
