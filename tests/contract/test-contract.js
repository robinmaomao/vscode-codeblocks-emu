// L0 契约层（静态、不依赖 VS Code 宿主）：把 package.json 的贡献面与 src/ 实现、磁盘资源、
// docs/CHANGELOG/NLS 交叉校验，防止「贡献了但没注册」「注册了但没贡献」「引用了不存在的资源/设置/视图」
// 以及版本与文档漂移。与既有 test-menu-structure / test-settings-structure / test-ui-icons /
// test-bundle-packaging 互补：本脚本只覆盖它们没有覆盖的交叉契约（激活事件、循环注册命令、视图容器、
// 语言与语法文件、调试器 schema、资源存在性、版本一致性、文档链接、NLS 键集合）。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const root = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));
const c = pkg.contributes || {};

// src 下全部 .ts 源码拼接文本（用于「贡献命令是否有实现」扫描）
function readSrcAll() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name)) out.push(fs.readFileSync(p, 'utf-8'));
    }
  };
  walk(path.join(root, 'src'));
  return out.join('\n');
}
const srcText = readSrcAll();

/** 运行期注册但**不**进贡献点的内部命令白名单（视图焦点 / 动态菜单 / 二级列表入口等） */
const INTERNAL_RUNTIME_COMMANDS = new Set([
  'codeblocks.projectTree.focus',
  'codeblocks.buildLog.focus',
  'codeblocks.setActiveProject',
  'codeblocks.build.menu',
  'codeblocks.menu.show',
  'codeblocks.openDetectedProject',
  'codeblocks.projectManager',
]);

/** 在 src 中检索命令字面量（覆盖循环注册：['codeblocks.x', ...] 也含字面量） */
function srcHasCommandLiteral(id) {
  return srcText.includes(`'${id}'`) || srcText.includes(`"${id}"`);
}

// ---------- A. 入口与激活事件 ----------
check('A1 engines.vscode 已声明', /^\^\d+\.\d+\.\d+$/.test(pkg.engines?.vscode || ''), pkg.engines?.vscode, '^x.y.z');
check('A2 main 指向 bundle/extension.js', pkg.main === './bundle/extension.js', pkg.main, './bundle/extension.js');
check('A3 dist/extension.js 已编译（npm run compile 产物）', fs.existsSync(path.join(root, 'dist', 'extension.js')), null, 'dist/extension.js');

const events = pkg.activationEvents || [];
const REQUIRED_EVENTS = [
  'onLanguage:c',
  'onLanguage:cpp',
  'workspaceContains:**/*.cbp',
  'workspaceContains:**/*.workspace',
  'onDebug',
];
check('A4 激活事件含必需项（语言/工程文件/调试）', REQUIRED_EVENTS.every((e) => events.includes(e)), events, REQUIRED_EVENTS);
check('A5 无通配激活事件（* / onStartupFinished，避免无谓常驻）', !events.some((e) => e === '*' || e === 'onStartupFinished'), events);
const debuggerType = (c.debuggers || [])[0]?.type;
check('A6 onDebugResolve/onDebugDynamicConfigurations 指向已贡献的调试器类型',
  events.filter((e) => /^onDebug(Resolve|DynamicConfigurations):/.test(e)).every((e) => e.endsWith(':' + debuggerType)),
  { events: events.filter((e) => /^onDebug(Resolve|DynamicConfigurations):/.test(e)), debuggerType });
const declaredLanguages = new Set((c.languages || []).map((l) => l.id));
check('A7 激活事件中的自定义语言都已在 contributes.languages 声明',
  events.filter((e) => e.startsWith('onLanguage:')).map((e) => e.slice('onLanguage:'.length))
    .every((id) => id === 'c' || id === 'cpp' || declaredLanguages.has(id)),
  events.filter((e) => e.startsWith('onLanguage:')), [...declaredLanguages]);

// ---------- B. 命令契约 ----------
const commands = c.commands || [];
const ids = commands.map((x) => x.command);
check('B1 命令 ID 唯一', new Set(ids).size === ids.length, ids.length - new Set(ids).size);
check('B2 命令 ID 均以 codeblocks. 前缀且标题非空',
  commands.every((x) => x.command.startsWith('codeblocks.') && typeof x.title === 'string' && x.title.trim().length > 0),
  commands.filter((x) => !x.command.startsWith('codeblocks.') || !x.title).map((x) => x.command));

const missingImpl = ids.filter((id) => !srcHasCommandLiteral(id));
check('B3 每个贡献命令在 src 中有注册实现（含循环注册）', missingImpl.length === 0, missingImpl, []);

const registered = [...srcText.matchAll(/registerCommand\(\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
const literalIds = new Set(ids);
const registeredNotContributed = [...new Set(registered.filter((r) => !literalIds.has(r)))].sort();
check('B4 运行期注册但未贡献的命令与白名单完全一致（防内部命令外泄/遗漏贡献）',
  JSON.stringify(registeredNotContributed) === JSON.stringify([...INTERNAL_RUNTIME_COMMANDS].sort()),
  registeredNotContributed, [...INTERNAL_RUNTIME_COMMANDS].sort());

const menus = c.menus || {};
const contributedSet = new Set(ids);
const menuCmds = new Set();
for (const list of Object.values(menus)) for (const it of list) if (it.command) menuCmds.add(it.command);
check('B5 菜单引用的命令均已贡献', [...menuCmds].every((x) => contributedSet.has(x)), [...menuCmds].filter((x) => !contributedSet.has(x)));
check('B6 菜单 when 子句非空', Object.values(menus).every((list) => list.every((it) => typeof it.when === 'string' && it.when.trim())),
  Object.values(menus).flat().filter((it) => !it.when).map((it) => it.command));
check('B7 view/title 与 view/item/context 的 group 语法合法（name@order）',
  ['view/title', 'view/item/context'].every((k) => (menus[k] || []).every((it) => /^[\w.-]+@\d+$/.test(it.group || ''))),
  Object.values(menus).flat().filter((it) => it.group && !/^[\w.-]+@\d+$/.test(it.group)).map((it) => [it.command, it.group]));

const hiddenInPalette = (menus.commandPalette || []).filter((it) => it.when === 'false').map((it) => it.command);
check('B8 commandPalette 隐藏项都是已贡献命令（隐藏而非死链）', hiddenInPalette.every((x) => contributedSet.has(x)), hiddenInPalette);

// ---------- C. 视图与容器 ----------
const viewIds = new Set();
const allViews = Object.values(c.views || {}).flat();
for (const v of allViews) viewIds.add(v.id);
const containerIds = new Set(Object.values(c.viewsContainers || {}).flat().map((v) => v.id));
check('C1 视图 ID 唯一', viewIds.size === allViews.length, { ids: viewIds.size, views: allViews.length });
check('C2 视图容器 ID 唯一', containerIds.size === Object.values(c.viewsContainers || {}).flat().length, [...containerIds]);
check('C3 视图 visibility 枚举合法', allViews.every((v) => v.visibility === undefined || ['visible', 'hidden', 'collapsed'].includes(v.visibility)),
  allViews.filter((v) => v.visibility && !['visible', 'hidden', 'collapsed'].includes(v.visibility)).map((v) => [v.id, v.visibility]));

const propsOf = Array.isArray(c.configuration)
  ? Object.assign({}, ...c.configuration.map((b) => b.properties || {}))
  : (c.configuration?.properties || {});
const configSettingIds = new Set(Object.keys(propsOf).map((k) => 'config.' + k));
const whenConfigRefs = new Set();
for (const v of allViews) {
  for (const m of (v.when || '').matchAll(/(?:^|[^\w])(config\.[A-Za-z0-9_.]+)/g)) whenConfigRefs.add(m[1]);
}
check('C4 视图 when 引用的设置项都存在', [...whenConfigRefs].every((k) => configSettingIds.has(k)),
  [...whenConfigRefs].filter((k) => !configSettingIds.has(k)), []);

const menuViewRefs = new Set();
for (const list of Object.values(menus)) for (const it of list) {
  for (const m of (it.when || '').matchAll(/view\s*==\s*([A-Za-z0-9_.]+)/g)) menuViewRefs.add(m[1]);
}
check('C5 菜单 when 引用的视图 ID 都已声明', [...menuViewRefs].every((v) => viewIds.has(v)),
  [...menuViewRefs].filter((v) => !viewIds.has(v)), [...viewIds]);

// ---------- D. 语言 / 语法 / 语言配置 ----------
const languages = c.languages || [];
const grammars = c.grammars || [];
check('D1 语言 ID 唯一且含扩展名与语言配置', languages.every((l) => l.id && Array.isArray(l.extensions) && l.extensions.length > 0 && l.configuration),
  languages.filter((l) => !l.extensions?.length || !l.configuration).map((l) => l.id));
check('D2 每个语法的语言都已声明', grammars.every((g) => declaredLanguages.has(g.language)), grammars.map((g) => g.language), [...declaredLanguages]);
check('D3 语法文件存在、JSON 可解析、scopeName 与贡献一致', grammars.every((g) => {
  const p = path.join(root, g.path.replace(/^\.\//, ''));
  if (!fs.existsSync(p)) return false;
  try { const j = JSON.parse(fs.readFileSync(p, 'utf-8')); return !!(j.scopeName && j.scopeName === g.scopeName && j.patterns); } catch { return false; }
}), grammars.map((g) => g.path));
check('D4 语言配置文件存在且 JSON 可解析', languages.every((l) => {
  const p = path.join(root, String(l.configuration).replace(/^\.\//, ''));
  if (!fs.existsSync(p)) return false;
  try { const j = JSON.parse(fs.readFileSync(p, 'utf-8')); return Object.keys(j).length > 0; } catch { return false; }
}), languages.map((l) => l.configuration));

const syntaxFiles = fs.readdirSync(path.join(root, 'syntaxes')).filter((f) => f.endsWith('.json')).map((f) => './syntaxes/' + f).sort();
const langCfgFiles = fs.readdirSync(path.join(root, 'language-configurations')).filter((f) => f.endsWith('.json')).map((f) => './language-configurations/' + f).sort();
check('D5 syntaxes/ 无孤儿语法文件（贡献与实际一致）',
  JSON.stringify(syntaxFiles) === JSON.stringify(grammars.map((g) => g.path).sort()), syntaxFiles, grammars.map((g) => g.path).sort());
check('D6 language-configurations/ 无孤儿配置文件',
  JSON.stringify(langCfgFiles) === JSON.stringify(languages.map((l) => l.configuration).sort()), langCfgFiles, languages.map((l) => l.configuration).sort());

// ---------- E. 调试器契约 ----------
const dbg = (c.debuggers || [])[0] || {};
check('E1 调试器 type/label/语言齐备', dbg.type === 'codeblocks' && typeof dbg.label === 'string' && (dbg.languages || []).includes('c') && (dbg.languages || []).includes('cpp'),
  { type: dbg.type, label: dbg.label, languages: dbg.languages }, { type: 'codeblocks', languages: ['c', 'cpp'] });
const attrs = dbg.configurationAttributes || {};
check('E2 launch 与 attach 均声明 configurationAttributes', !!attrs.launch && !!attrs.attach, Object.keys(attrs), ['launch', 'attach']);
const reqOf = (a) => (a.required || []).map((r) => (Array.isArray(r) ? r[0] : r));
check('E3 launch 必需字段包含 program（与 debugConfigProvider 推导一致）', reqOf(attrs.launch || {}).includes('program'), reqOf(attrs.launch || {}), '包含 program');
check('E4 attach 必需字段为 pid 或 processId', reqOf(attrs.attach || {}).some((r) => r === 'pid' || r === 'processId'), reqOf(attrs.attach || {}), 'pid|processId');
check('E5 configurationAttributes 属性均为合法 schema 类型',
  [attrs.launch, attrs.attach].every((a) => Object.values(a?.properties || {}).every((p) => p && typeof p.type === 'string')),
  [attrs.launch, attrs.attach].map((a) => Object.entries(a?.properties || {}).filter(([, p]) => !p?.type).map(([k]) => k)));

// ---------- F. 资源存在性 ----------
const resourceRefs = new Set();
const collectRefs = (node) => {
  if (Array.isArray(node)) return node.forEach(collectRefs);
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (['icon', 'dark', 'light', 'path', 'configuration'].includes(k) && typeof v === 'string') resourceRefs.add(v);
      else collectRefs(v);
    }
  }
};
collectRefs(c);
if (typeof pkg.icon === 'string') resourceRefs.add(pkg.icon);
const missingResources = [...resourceRefs]
  .filter((r) => !r.startsWith('%') && /\.(svg|png|json|md)$/.test(r))
  .filter((r) => !fs.existsSync(path.join(root, r.replace(/^\.\//, ''))));
check('F1 contributes 引用的资源文件全部存在', missingResources.length === 0, missingResources, []);

const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf-8');
check('F2 .vscodeignore 排除测试与探针工程（tests/ 与 test-project/ 不入 VSIX）',
  /^tests\/\*\*$/m.test(ignore) && /^test-project\/\*\*$/m.test(ignore), ignore.split(/\r?\n/).filter((l) => /tests|test-project/.test(l)), ['tests/**', 'test-project/**']);
check('F3 .vscodeignore 排除源码与 docs（只发布 bundle + 资源）',
  /^src\/\*\*$/m.test(ignore) && /^docs\/\*\*$/m.test(ignore) && /^dist\/\*\*$/m.test(ignore),
  ignore.split(/\r?\n/).filter((l) => /src|docs|dist/.test(l)), ['src/**', 'docs/**', 'dist/**']);
check('F4 LICENSE / README / CHANGELOG / THIRD-PARTY-NOTICES 齐备',
  ['LICENSE.md', 'README.md', 'CHANGELOG.md', 'THIRD-PARTY-NOTICES.md'].every((f) => fs.existsSync(path.join(root, f))), null, '4 个文件');
check('F5 bundle/extension.js 存在（宿主与 VSIX 均依赖）', fs.existsSync(path.join(root, 'bundle', 'extension.js')), null, 'bundle/extension.js');

// ---------- G. 版本与文档一致性 ----------
const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf-8');
const changelogTop = (changelog.match(/^##\s+(\d+\.\d+\.\d+)/m) || [])[1];
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf-8');
const readmeVer = (readme.match(/版本\*\*[：:]\s*([0-9.]+)/) || readme.match(/\*\*版本\*\*[^\d]*([0-9.]+)/) || [])[1];
check('G1 CHANGELOG 顶部版本 == package.json version', changelogTop === pkg.version, changelogTop, pkg.version);
check('G2 README 标注版本 == package.json version', readmeVer === pkg.version, readmeVer, pkg.version);

const vsix = fs.readdirSync(root).filter((f) => /^codeblocks-vscode-.*\.vsix$/.test(f));
check('G3 根目录 VSIX 文件名版本与 package.json 一致（存在时）',
  vsix.every((f) => f.includes(pkg.version)), { vsix, version: pkg.version }, '版本一致');

const mdLinks = [];
for (const rel of ['README.md', 'docs/使用说明.md', 'docs/对齐对照.md', 'docs/开发进度.md']) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) { mdLinks.push({ file: rel, target: '(文件缺失)', resolved: false }); continue; }
  const text = fs.readFileSync(abs, 'utf-8');
  for (const m of text.matchAll(/\]\(([^)#]+?)(?:#[^)]*)?\)/g)) {
    let target = m[1].trim();
    if (/^(https?:|mailto:)/.test(target)) continue;
    target = target.replace(/^<|>$/g, '');
    if (!target || target.startsWith('#')) continue;
    const resolved = fs.existsSync(target.startsWith('/') ? path.join(root, target) : path.resolve(path.dirname(abs), target));
    mdLinks.push({ file: rel, target, resolved });
  }
}
const brokenLinks = mdLinks.filter((l) => !l.resolved);
check('G4 文档相对链接与图片全部可解析（README + 三份主文档）', brokenLinks.length === 0, brokenLinks.slice(0, 10), []);

// ---------- H. i18n ----------
const nlsEn = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf-8'));
const nlsZh = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh-cn.json'), 'utf-8'));
const enKeys = Object.keys(nlsEn).sort(), zhKeys = Object.keys(nlsZh).sort();
check('H1 两个 NLS 文件键集合一致', JSON.stringify(enKeys) === JSON.stringify(zhKeys),
  { en: enKeys.length, zh: zhKeys.length, diff: enKeys.filter((k) => !nlsZh[k]).concat(zhKeys.filter((k) => !nlsEn[k])) });
const pkgText = fs.readFileSync(path.join(root, 'package.json'), 'utf-8');
const orphanNls = enKeys.filter((k) => !pkgText.includes(`%${k}%`));
check('H2 NLS 无孤儿键（都在 package.json 中以 %key% 被引用）', orphanNls.length === 0, orphanNls, []);
check('H3 英文 NLS 不含中文', enKeys.every((k) => !/[\u4e00-\u9fff]/.test(nlsEn[k])), enKeys.filter((k) => /[\u4e00-\u9fff]/.test(nlsEn[k])));
check('H4 中文 NLS 值非空', zhKeys.every((k) => typeof nlsZh[k] === 'string' && nlsZh[k].trim().length > 0), zhKeys.filter((k) => !nlsZh[k]?.trim()));

console.log(`\ncontract 契约回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
