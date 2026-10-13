// clangd 用户配置回归（跨界 typedef 冲突修复）：
//  - Diagnostics.Suppress 默认含 -Wunused-function 与 redefinition_different_typedef（SDK 头 vs 工具链系统头误报）
//  - Completion.HeaderInsertion: Never（补全不自动插入 #include；clangd 默认 IWYU）
//  - 头文件子片段（Suppress:'*' + --target/-include/-isystem 回退）结构正确
//  - 幂等；保留用户自有内容；空作用域清理不留悬空 ---
//  - 设置默认值（package.json）与 extension 接线（dist）静态断言
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
      window: { showInformationMessage: () => {}, showWarningMessage: () => {}, showErrorMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      commands: { executeCommand: async () => {} },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');

// clangdUserConfigPath()：win 用 LOCALAPPDATA，其它用 XDG_CONFIG_HOME —— 都指到临时目录，避免动真实用户配置
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-clangd-'));
process.env.LOCALAPPDATA = path.join(tmp, 'LocalAppData');
process.env.XDG_CONFIG_HOME = path.join(tmp, 'config');

const { updateClangdUserConfig, clangdUserConfigPath, listManagedFragments, findStaleClangdFragments, staleReasonOf, cleanStaleClangdFragments, readClangdUserConfigText, extraConfigWarnings } = require('../dist/tools/clangd.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const cfgPath = clangdUserConfigPath();
check('配置路径落在临时目录（不触碰真实用户配置）', cfgPath.startsWith(tmp), cfgPath);

// 预置用户自有内容
fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, '# user own\nDiagnostics:\n  UnusedIncludes: Strict\n', 'utf-8');

const projDir = path.join(tmp, 'proj');
const dbDir = path.join(tmp, 'cache', 'obj');
fs.mkdirSync(projDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });

const scope = {
  dir: projDir,
  databaseDir: dbDir,
  headerFlags: ['--target=riscv32-elf', '-I', 'X:/inc', '-include', 'global.h', '-isystem', 'X:/sys', '-ferror-limit=0'],
  suppressedWarnings: ['-Wunused-function', 'redefinition_different_typedef'],
  suppressHeaderDiagnostics: true,
  // 默认值（= 设置项默认，与历史硬编码产物一致）
  unusedIncludes: 'None',
  headerInsertion: 'Never',
};

updateClangdUserConfig([scope]);
const text = fs.readFileSync(cfgPath, 'utf-8');
const dbUnix = dbDir.replace(/\\/g, '/');
const projUnix = projDir.replace(/\\/g, '/');
/** 与 src/tools/clangd.ts 的 escapeRegex 一致（用于按字面量断言生成的 PathMatch 正则） */
const escapeRegexTxt = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

check('保留用户自有内容', text.includes('# user own'));
check('片段含 CompilationDatabase', text.includes(`CompilationDatabase: '${dbUnix}'`), null);
check('Suppress 列表含 -Wunused-function', text.includes('    - -Wunused-function'), null);
check('Suppress 列表含 redefinition_different_typedef', text.includes('    - redefinition_different_typedef'), null);
check('头文件子片段 Suppress:*', text.includes("  Suppress: '*'"), null);
check('头文件子片段含 --target 回退', text.includes('- --target=riscv32-elf'), null);
check('头文件子片段含 -include 基础头', text.includes('- -include'), null);
check('头文件子片段含 -isystem', text.includes('- -isystem'), null);
check('片段标记成对', text.includes('codeblocks-vscode') && /begin <<<[\s\S]*end <<</.test(text), null);

// 补全不自动插入头文件（clangd 默认 IWYU ⇒ 接受补全时插入 #include）
check('主片段含 Completion 块', text.includes('Completion:'), null);
check('Completion.HeaderInsertion 为 Never', text.includes('  HeaderInsertion: Never'), null);
{
  // 必须在扩展标记之间（避免污染用户自有内容 / 落到标记外）
  const beginIdx = text.indexOf('# >>> codeblocks-vscode');
  const endIdx = text.indexOf('# <<< codeblocks-vscode');
  const cmpIdx = text.indexOf('  HeaderInsertion: Never');
  check('HeaderInsertion 位于扩展片段标记之间', beginIdx >= 0 && endIdx > beginIdx && cmpIdx > beginIdx && cmpIdx < endIdx,
    { beginIdx, cmpIdx, endIdx });
  // 只出现一次（头文件子片段不重复声明，避免冗余）
  const n = (text.match(/HeaderInsertion:/g) || []).length;
  check('HeaderInsertion 仅声明一次（头文件共用主片段）', n === 1, n);
  // YAML 缩进结构：Completion 顶格、HeaderInsertion 两空格缩进
  check('Completion/HeaderInsertion 缩进层级正确', /\nCompletion:\n  HeaderInsertion: Never\n/.test(text), null);
}

// 幂等：相同入参重复调用内容不变
updateClangdUserConfig([scope]);
const text2 = fs.readFileSync(cfgPath, 'utf-8');
check('重复调用幂等（内容不变）', text2 === text, null);

// 同作用域重写（生成参数变化时旧片段被替换，不重复堆积；配合 hash 标记的多工作区共存设计）
updateClangdUserConfig([{ ...scope, suppressedWarnings: [], suppressHeaderDiagnostics: false }]);
const text3 = fs.readFileSync(cfgPath, 'utf-8');
const beginCount = (text3.match(/codeblocks-vscode [0-9a-f]+ begin/g) || []).length;
check('同作用域重写后仅一个片段标记', beginCount === 1, beginCount);
check('Suppress 清空后不再输出旧压制项', !text3.includes('- -Wunused-function'), null);
check('suppressHeaderDiagnostics=false 时移除 Suppress:*', !text3.includes("  Suppress: '*'"), null);
check('重写后仍保留 HeaderInsertion: Never', text3.includes('  HeaderInsertion: Never'), null);
check('重写后仍保留用户内容', text3.includes('# user own'), null);

// 空作用域调用（健壮性）：不报错、保留用户内容、不留悬空 ---
updateClangdUserConfig([]);
const text4 = fs.readFileSync(cfgPath, 'utf-8');
check('空作用域调用健壮（保留用户内容、无悬空 ---）', text4.includes('# user own') && !/---\s*$/.test(text4), JSON.stringify(text4).slice(0, 120));
// 空作用域调用按传入作用域的 hash 定位旧块 ⇒ 无作用域信息时不会清理既有片段（既有语义，非本次回归）
check('空作用域调用不误删既有片段', text4.includes('HeaderInsertion: Never'), null);

// ---------- 新增键（设置项驱动；只写「有值」的键） ----------
{
  const full = {
    ...scope,
    builtinHeaders: 'QueryDriver',
    indexStandardLibrary: false,
    indexBackground: 'Skip',
    clangTidyOff: true,
    completionAllScopes: false,
    inlayHintsEnabled: true,
    documentationCommentFormat: 'Doxygen',
    excludeDirs: ['obj', 'bin'],
  };
  updateClangdUserConfig([full]);
  const t = fs.readFileSync(cfgPath, 'utf-8');
  check('BuiltinHeaders: QueryDriver 写入', t.includes('  BuiltinHeaders: QueryDriver'), null);
  check('Index 段（Background/StandardLibrary）写入', /\nIndex:\n  Background: Skip\n  StandardLibrary: false\n/.test(t), null);
  check('ClangTidy.Remove 通配写入', t.includes("    Remove: ['*']"), null);
  check('Completion.AllScopes: No 写入', /  HeaderInsertion: Never\n  AllScopes: No\n/.test(t), null);
  check('InlayHints.Enabled: true 写入', /\nInlayHints:\n  Enabled: true\n/.test(t), null);
  check('Documentation.CommentFormat: Doxygen 写入', /\nDocumentation:\n  CommentFormat: Doxygen\n/.test(t), null);
  check('If.PathExclude 由 excludeDirs 生成', new RegExp(`PathExclude: '${escapeRegexTxt(projUnix)}/\\(obj\\|bin\\)/\\.\\*'`).test(t), null);
  check('PathExclude 位于 PathMatch 之后（同一 If 块内）', t.indexOf('PathMatch:') < t.indexOf('PathExclude:'), null);

  // omit / default：该键不写入（交给 clangd 默认值或用户自有配置）
  updateClangdUserConfig([{
    ...scope,
    unusedIncludes: undefined,
    headerInsertion: undefined,
    clangTidyOff: false,
    excludeDirs: [],
  }]);
  const omitText = fs.readFileSync(cfgPath, 'utf-8');
  const omitBlock = listManagedFragments(omitText).map((f) => f.block).join('\n');
  check('unusedIncludes=omit ⇒ 不写 UnusedIncludes', !omitBlock.includes('UnusedIncludes'), omitBlock.slice(0, 120));
  check('headerInsertion=omit ⇒ 不写 Completion 块', !omitBlock.includes('Completion:'), null);
  check('default 值不写 Index/InlayHints/Documentation', !/^Index:/m.test(omitBlock) && !/^InlayHints:/m.test(omitBlock) && !/^Documentation:/m.test(omitBlock), null);
  check('excludeDirs 为空 ⇒ 不写 PathExclude', !omitBlock.includes('PathExclude:'), null);
  check('omit 状态下用户内容仍在', omitText.includes('# user own'), null);

  // 默认参数产物 = 历史格式（回归保护：旧版本写死的键顺序与内容）
  updateClangdUserConfig([scope]);
  const defText = fs.readFileSync(cfgPath, 'utf-8');
  const expectBlock = [
    'If:',
    `  PathMatch: '${escapeRegexTxt(projUnix)}/.*'`,
    'CompileFlags:',
    `  CompilationDatabase: '${dbUnix}'`,
    'Diagnostics:',
    '  UnusedIncludes: None',
    '  Suppress:',
    '    - -Wunused-function',
    '    - redefinition_different_typedef',
    'Completion:',
    '  HeaderInsertion: Never',
  ].join('\n');
  check('默认参数产物与历史格式逐字一致', defText.includes(expectBlock), defText.slice(0, 200));
}

// ---------- extraConfig：同作用域后置片段（可覆盖扩展键） ----------
{
  const extra = 'Diagnostics:\n  MissingIncludes: Strict\nCompletion:\n  AllScopes: No';
  updateClangdUserConfig([{ ...scope, extraConfig: extra }]);
  const t = fs.readFileSync(cfgPath, 'utf-8');
  const begin = t.indexOf('# >>> codeblocks-vscode');
  const end = t.indexOf('# <<< codeblocks-vscode');
  const extraIdx = t.indexOf('MissingIncludes: Strict');
  check('extraConfig 注入在扩展标记之间', extraIdx > begin && extraIdx < end, { begin, extraIdx, end });
  check('extraConfig 自动冠以本作用域 If', new RegExp(`---\\nIf:\\n  PathMatch: '${escapeRegexTxt(projUnix)}/\\.\\*'\\nDiagnostics:\\n  MissingIncludes: Strict`).test(t), null);
  check('extraConfig 作为后置片段（排在扩展主片段之后，可覆盖）',
    t.indexOf('CompilationDatabase:') < extraIdx && t.indexOf('HeaderInsertion: Never') < extraIdx, null);
  check('extraConfig 为空 ⇒ 不注入空片段', (() => {
    updateClangdUserConfig([{ ...scope, extraConfig: '' }]);
    return !fs.readFileSync(cfgPath, 'utf-8').includes('MissingIncludes');
  })(), null);
  // 轻量校验（仅提示，不阻断写入）
  check('extraConfigWarnings：制表符提示', extraConfigWarnings('Diagnostics:\n\tUnusedIncludes: None').length === 1, extraConfigWarnings('\tX: 1'));
  check('extraConfigWarnings：--- 提示', extraConfigWarnings('A: 1\n---\nB: 2').length === 1, null);
  check('extraConfigWarnings：顶层 If 提示', extraConfigWarnings('If:\n  PathMatch: x').length === 1, null);
  check('extraConfigWarnings：空/正常内容无提示', extraConfigWarnings('').length === 0 && extraConfigWarnings('Diagnostics:\n  UnusedIncludes: None').length === 0, null);
}

// ---------- 失效片段清理（FIX-C1） ----------
{
  const mk = (name) => {
    const d = path.join(tmp, name);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const liveDir = mk('prune-live.v2');
  const liveDb = mk('prune-live-db');
  const goneDir = path.join(tmp, 'prune-gone');
  const goneDb = path.join(tmp, 'prune-gone-db');
  fs.mkdirSync(goneDir, { recursive: true });
  fs.mkdirSync(goneDb, { recursive: true });
  const orphanDbDir = mk('prune-orphandb');
  const orphanDbScope = mk('prune-orphandb-scope');
  const unmountedDir = 'Q:/cb-prune-volume/proj';
  const uncDir = '//srv/share/cb-prune';
  const unchangedDir = mk('prune-unchanged');

  fs.writeFileSync(cfgPath, '# user own\nDiagnostics:\n  UnusedIncludes: Strict\n', 'utf-8');
  updateClangdUserConfig([
    { dir: liveDir, databaseDir: liveDb },
    { dir: goneDir, databaseDir: goneDb },
    { dir: orphanDbScope, databaseDir: orphanDbDir },
    { dir: unmountedDir, databaseDir: path.join(tmp, 'x') },
    { dir: uncDir, databaseDir: path.join(tmp, 'x') },
  ]);
  // 制造失效：删除作用域目录 / 删除编译数据库目录
  fs.rmSync(goneDir, { recursive: true, force: true });
  fs.rmSync(orphanDbDir, { recursive: true, force: true });

  const before = fs.readFileSync(cfgPath, 'utf-8');
  const frags = listManagedFragments(before);
  check('listManagedFragments：解析出 5 个片段', frags.length === 5, frags.length);
  const liveFrag = frags.find((f) => f.databaseDir.endsWith('prune-live-db'));
  check('listManagedFragments：反解作用域路径（含正则转义的 . 恢复）',
    !!liveFrag && liveFrag.scopeDir.endsWith('prune-live.v2'), liveFrag && liveFrag.scopeDir);
  check('listManagedFragments：解析 CompilationDatabase', !!liveFrag && liveFrag.databaseDir.includes('/prune-live-db'), liveFrag && liveFrag.databaseDir);

  const stale = findStaleClangdFragments(before);
  check('失效扫描：恰好 2 个（作用域目录缺失 + 数据库目录缺失）', stale.length === 2, stale.map((s) => s.reason));
  check('失效原因：scope-missing / database-missing',
    stale.some((s) => s.reason === 'scope-missing') && stale.some((s) => s.reason === 'database-missing'), stale.map((s) => s.reason));
  check('失效扫描是只读的（未改文件）', fs.readFileSync(cfgPath, 'utf-8') === before, null);
  check('卷未挂载路径不判失效（win）/ 其它平台按普通缺失处理',
    process.platform === 'win32'
      ? !stale.some((s) => /^q:/i.test(s.scopeDir))
      : stale.some((s) => /^q:/i.test(s.scopeDir)), stale.map((s) => s.scopeDir));
  check('UNC 路径不判失效', !stale.some((s) => s.scopeDir.startsWith('//')), stale.map((s) => s.scopeDir));
  check('staleReasonOf：存活作用域返回空串', staleReasonOf(liveFrag) === '', staleReasonOf(liveFrag));

  const res = cleanStaleClangdFragments();
  const after = fs.readFileSync(cfgPath, 'utf-8');
  check('cleanStaleClangdFragments：返回清理明细 2 条', res.removed.length === 2 && res.written === true, { n: res.removed.length, written: res.written });
  const afterFrags = listManagedFragments(after).map((f) => f.scopeDir);
  check('清理后只剩 3 个片段（存活 / 卷未挂载 / UNC）', afterFrags.length === 3, afterFrags);
  check('清理后失效片段（作用域目录缺失）不再存在', !afterFrags.some((d) => d.includes('prune-gone')), afterFrags);
  check('清理后失效片段（数据库目录缺失）不再存在', !afterFrags.some((d) => d.includes('prune-orphandb-scope')), afterFrags);
  check('清理后存活片段保留', afterFrags.some((d) => d.includes('prune-live.v2')), afterFrags);
  check('清理后卷未挂载/UNC 片段保留', afterFrags.some((d) => /^q:/i.test(d)) && afterFrags.some((d) => d.startsWith('//')), afterFrags);
  check('清理后用户内容保留', after.includes('# user own'), null);
  check('清理后无悬空 --- 结尾', !/---\s*$/.test(after), JSON.stringify(after.slice(-60)));
  check('清理后再扫描为空（幂等）', findStaleClangdFragments(after).length === 0, findStaleClangdFragments(after).length);
  const again = cleanStaleClangdFragments();
  check('再次清理：零改动（不写文件）', again.removed.length === 0 && again.written === false, { n: again.removed.length, written: again.written });
  check('再次清理：文件内容不变', fs.readFileSync(cfgPath, 'utf-8') === after, null);

  // 自动路径：updateClangdUserConfig 也顺带清理失效片段（返回 removed）
  fs.writeFileSync(cfgPath, before, 'utf-8');
  const auto = updateClangdUserConfig([{ dir: unchangedDir, databaseDir: unchangedDir }]);
  const autoText = fs.readFileSync(cfgPath, 'utf-8');
  check('自动清理：updateClangdUserConfig 返回 removed=2', auto.removed.length === 2, auto.removed.length);
  check('自动清理：生效于文件', !autoText.includes('prune-gone'), null);
  check('自动清理：新作用域已写入', autoText.includes('prune-unchanged'), null);
  check('自动清理：用户内容保留', autoText.includes('# user own'), null);
}

// 设置默认值 / 接线
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
let def;
for (const block of pkg.contributes.configuration) {
  const prop = block.properties && block.properties['codeblocks.clangd.suppressedWarnings'];
  if (prop) def = prop.default;
}
check('package.json 默认含 redefinition_different_typedef',
  Array.isArray(def) && def.includes('redefinition_different_typedef') && def.includes('-Wunused-function'), def);

// 新增 12 项 clangd 设置：默认值必须等于「历史行为」（不改变现有产物）
const NEW_SETTINGS = {
  'codeblocks.clangd.unusedIncludes': ['none', 'strict', 'omit'],
  'codeblocks.clangd.headerInsertion': ['never', 'iwyu', 'omit'],
  'codeblocks.clangd.indexBackground': ['default', 'build', 'skip'],
  'codeblocks.clangd.indexStandardLibrary': ['default', 'true', 'false'],
  'codeblocks.clangd.clangTidy': ['default', 'off'],
  'codeblocks.clangd.completionAllScopes': ['default', 'yes', 'no'],
  'codeblocks.clangd.inlayHints': ['default', 'on', 'off'],
  'codeblocks.clangd.documentationCommentFormat': ['default', 'plaintext', 'markdown', 'doxygen'],
  'codeblocks.clangd.excludeDirs': undefined,
  'codeblocks.clangd.builtinHeaders': ['clangd', 'queryDriver'],
  'codeblocks.clangd.queryDriver': undefined,
  'codeblocks.clangd.extraConfig': undefined,
};
{
  const allProps = Object.assign({}, ...pkg.contributes.configuration.map((b) => b.properties || {}));
  for (const [key, enums] of Object.entries(NEW_SETTINGS)) {
    const p = allProps[key];
    if (!p) { check(`设置 ${key} 已声明`, false, '未声明'); continue; }
    if (enums) check(`设置 ${key} 枚举/默认值合法`, JSON.stringify(p.enum) === JSON.stringify(enums) && enums.includes(p.default), { enum: p.enum, def: p.default });
    else check(`设置 ${key} 有默认值`, p.default !== undefined, p.default);
  }
  check('默认值保持现状：unusedIncludes=none、headerInsertion=never、builtinHeaders=clangd',
    allProps['codeblocks.clangd.unusedIncludes'].default === 'none'
    && allProps['codeblocks.clangd.headerInsertion'].default === 'never'
    && allProps['codeblocks.clangd.builtinHeaders'].default === 'clangd', null);
}

const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf-8');
const clangdDist = fs.readFileSync(path.resolve(__dirname, '../dist/tools/clangd.js'), 'utf-8');
check('extension 默认数组已接线（dist 含 redefinition_different_typedef）', ext.includes('redefinition_different_typedef'), null);
for (const key of Object.keys(NEW_SETTINGS)) {
  check(`dist 已接线设置读取：${key}`, ext.includes(`'${key.replace('codeblocks.', '')}'`) || ext.includes(key), null);
}
check('dist 含清理命令实现（cleanClangdConfigInteractive）', ext.includes('cleanClangdConfigInteractive') && ext.includes('codeblocks.cleanClangdConfig'), null);
check('dist 含 query-driver 命令实现', ext.includes('applyClangdQueryDriverInteractive') && ext.includes('--query-driver='), null);
check('dist 含 CompileFlags.BuiltinHeaders 写入分支', clangdDist.includes('BuiltinHeaders:'), null);
check('dist 含失效片段清理实现', clangdDist.includes('pruneStaleClangdFragments') && clangdDist.includes('scope-missing') && clangdDist.includes('database-missing'), null);
check('dist 含 Index/InlayHints/Documentation/ClangTidy 写入分支',
  ['Index:', 'InlayHints:', 'Documentation:', 'ClangTidy'].every((k) => clangdDist.includes(k)), null);

console.log(`clangd 配置回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
