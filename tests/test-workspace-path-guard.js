// 工作区路径守卫回归（src/build/workspacePathGuard.ts）：
//  - 逐段复刻 VS Code `xgn()` 的 glob 元字符判定（* ? / 成对 [ ] / 成对 { } / 未闭合不算）；
//  - 复刻 `Eao('instructions', <ws>/.github/instructions)` 的搜索根截断（含 `[内部]` 时放大到祖先目录）；
//  - `countFilesCapped` 带上限与缺失目录语义；
//  - `mergePromptScanLocations` 幂等、保留其它键、必须写显式 false（`{}` 无法关闭默认位置）。
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const {
  globKindOfSegment,
  splitSegments,
  findGlobSegments,
  computeInstructionSearchRoot,
  analyzeWorkspacePath,
  countFilesCapped,
  mergePromptScanLocations,
  PROMPT_SCAN_LOCATIONS,
} = require('../dist/build/workspacePathGuard.js');

// ---------- A. 单段判定（对齐 xgn：成对才命中） ----------
check('A1 含 * 命中', globKindOfSegment('a*b') === 'star', globKindOfSegment('a*b'));
check('A2 含 ? 命中', globKindOfSegment('a?b') === 'star', globKindOfSegment('a?b'));
check('A3 成对 [ ] 命中', globKindOfSegment('[内部]5756C_lvd_reset') === 'bracket', globKindOfSegment('[内部]5756C_lvd_reset'));
check('A4 成对 { } 命中', globKindOfSegment('{a,b}') === 'brace', globKindOfSegment('{a,b}'));
check('A5 未闭合 [ 不算（与 xgn 一致）', globKindOfSegment('[abc') === undefined, globKindOfSegment('[abc'));
check('A6 只有右括号不算', globKindOfSegment('abc]') === undefined, globKindOfSegment('abc]'));
check('A7 普通目录名不命中', globKindOfSegment('SDK_AB575X_S687_VDDCORE_TEST_20261030') === undefined, globKindOfSegment('SDK_AB575X_S687_VDDCORE_TEST_20261030'));
check('A8 反斜杠转义后不命中', globKindOfSegment('a\\*b') === undefined, globKindOfSegment('a\\*b'));

// ---------- B. 分段 ----------
check('B1 盘符作为独立段', JSON.stringify(splitSegments('E:\\Work_Share\\2026\\10')) === JSON.stringify(['E:', 'Work_Share', '2026', '10']), splitSegments('E:\\Work_Share\\2026\\10'));
check('B2 混合分隔符与空段', JSON.stringify(splitSegments('E:/a//b\\c')) === JSON.stringify(['E:', 'a', 'b', 'c']), splitSegments('E:/a//b\\c'));

// ---------- C. 命中段定位 ----------
const bad = 'E:\\Work_Share\\2026\\10\\[内部]5756C_lvd_reset\\SDK_AB575X_S687_VDDCORE_TEST_20261030';
const hits = findGlobSegments(bad);
check('C1 坏路径只命中 1 段', hits.length === 1, hits);
check('C2 命中段是 [内部]…', hits[0] && hits[0].segment === '[内部]5756C_lvd_reset', hits[0] && hits[0].segment);
check('C3 命中类型为 bracket', hits[0] && hits[0].kind === 'bracket', hits[0] && hits[0].kind);
check('C4 干净路径无命中', findGlobSegments('E:\\SDKs\\SDK_X').length === 0, findGlobSegments('E:\\SDKs\\SDK_X'));

// ---------- D. 搜索根截断（复刻 Eao） ----------
const splitBad = computeInstructionSearchRoot(bad);
check('D1 坏路径搜索根放大到 2026\\10', splitBad.searchRoot.toLowerCase() === 'e:\\work_share\\2026\\10', splitBad.searchRoot);
check('D2 坏路径带 filePattern（会启动 rg）', splitBad.filePattern === '[内部]5756C_lvd_reset/SDK_AB575X_S687_VDDCORE_TEST_20261030/.github/instructions', splitBad.filePattern);
const splitGood = computeInstructionSearchRoot('E:\\SDKs\\SDK_X');
check('D3 干净路径搜索根就是 instructions 目录本身', splitGood.searchRoot.toLowerCase() === 'e:\\sdks\\sdk_x\\.github\\instructions', splitGood.searchRoot);
check('D4 干净路径无 filePattern（只 stat，不启动 rg）', splitGood.filePattern === undefined, splitGood.filePattern);
const splitCustom = computeInstructionSearchRoot(bad, '.claude/rules');
check('D5 自定义位置同样截断', splitCustom.filePattern === '[内部]5756C_lvd_reset/SDK_AB575X_S687_VDDCORE_TEST_20261030/.claude/rules', splitCustom.filePattern);
const splitUnc = computeInstructionSearchRoot('\\\\server\\share\\[x]proj');
check('D6 UNC 前缀在 searchRoot 中保留', splitUnc.searchRoot === '\\\\server\\share', splitUnc.searchRoot);
check('D7 UNC 命中段进入 filePattern', splitUnc.filePattern === '[x]proj/.github/instructions', splitUnc.filePattern);

// ---------- E. analyzeWorkspacePath ----------
const aBad = analyzeWorkspacePath(bad);
check('E1 坏路径 ok=false', aBad.ok === false, aBad.ok);
check('E2 坏路径 searchRootIsWorkspace=false（放大到祖先）', aBad.searchRootIsWorkspace === false, aBad.searchRootIsWorkspace);
const aGood = analyzeWorkspacePath('E:\\SDKs\\SDK_X');
check('E3 干净路径 ok=true', aGood.ok === true, aGood.ok);
check('E4 干净路径无 filePattern', aGood.filePattern === undefined, aGood.filePattern);

// ---------- F. countFilesCapped ----------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-pathguard-'));
fs.writeFileSync(path.join(dir, 'a.txt'), 'a');
fs.writeFileSync(path.join(dir, 'b.txt'), 'b');
fs.mkdirSync(path.join(dir, 'sub'));
fs.writeFileSync(path.join(dir, 'sub', 'c.txt'), 'c');
const counted = countFilesCapped(dir);
check('F1 递归统计文件数', counted.count === 3 && counted.capped === false, counted);
const capped = countFilesCapped(dir, 2);
check('F2 达到上限即停止并标记 capped', capped.count === 2 && capped.capped === true, capped);
const missing = countFilesCapped(path.join(dir, 'nope'));
check('F3 目录不存在时 missing=true', missing.missing === true && missing.count === 0, missing);
const driveRoot = countFilesCapped('E:\\');
check('F4 盘符根目录不遍历（直接 capped）', driveRoot.count === 0 && driveRoot.capped === true, driveRoot);
fs.rmSync(dir, { recursive: true, force: true });

// ---------- G. mergePromptScanLocations ----------
const g1 = mergePromptScanLocations(undefined);
check('G1 空输入 → 两项显式 false', g1.value['.github/instructions'] === false && g1.value['.claude/rules'] === false, g1.value);
check('G2 两项都记为变更', g1.changed.length === PROMPT_SCAN_LOCATIONS.length, g1.changed);
const g3 = mergePromptScanLocations({ '.custom/x': true, '.github/instructions': false });
check('G3 保留其它键', g3.value['.custom/x'] === true, g3.value);
check('G4 只补缺失项', g3.changed.length === 1 && g3.changed[0] === '.claude/rules', g3.changed);
const g5 = mergePromptScanLocations({ '.github/instructions': false, '.claude/rules': false, '.custom/x': true });
check('G5 已全部关闭 → 无变更（幂等）', g5.changed.length === 0, g5.changed);
const g6 = mergePromptScanLocations([]);
check('G6 数组按非法值忽略', g6.value['.github/instructions'] === false && g6.changed.length === 2, g6);
const g7 = mergePromptScanLocations({ '.github/instructions': true });
check('G7 已显式 true 会被改为 false（正是修复手段）', g7.value['.github/instructions'] === false, g7.value);

// ---------- H. 贡献面：设置与命令必须真的注册 ----------
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
const cfgGroups = Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration : [pkg.contributes.configuration];
const allProps = Object.assign({}, ...cfgGroups.map((g) => (g && g.properties) || {}));
const guard = allProps['codeblocks.workspace.pathGuard'];
check('H1 设置 codeblocks.workspace.pathGuard 已注册', !!guard, !!guard);
check('H2 默认值为 prompt', guard && guard.default === 'prompt', guard && guard.default);
check('H3 枚举为 off/prompt/auto', guard && JSON.stringify(guard.enum) === JSON.stringify(['off', 'prompt', 'auto']), guard && guard.enum);
check('H4 命令 codeblocks.checkWorkspacePath 已注册', (pkg.contributes.commands || []).some((c) => c.command === 'codeblocks.checkWorkspacePath'));

console.log(`\nworkspace-path-guard: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
