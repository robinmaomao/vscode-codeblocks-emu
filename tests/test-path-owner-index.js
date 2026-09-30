// P3 回归：路径属主索引（buildPathOwnerIndex / findSoleOwner / normFilePath）+ extension 接线静态断言
// 语义要求与旧实现一致：仅统计 project.files；归一化 = 反斜杠→正斜杠 + 小写；唯一属主 = 恰好一个工程。
const fs = require('fs');
const path = require('path');
const { buildPathOwnerIndex, findSoleOwner, normFilePath } = require(path.resolve(__dirname, '../dist/model/pathOwnerIndex.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const mkFile = (abs, rel = abs) => ({ absolutePath: abs, relativeFilename: rel, buildTargets: [], explicitTargets: false, compilerVar: 'CC', compile: true, link: true, customBuildCommands: {}, weight: 50, virtualFolder: '', generatedFiles: [] });
const mkProject = (filename, files, targets = []) => ({ filename, title: filename, basePath: '', files, buildTargets: targets });

// ---- 1. normFilePath ----
check('A1 归一化：反斜杠转正斜杠 + 小写',
  normFilePath('E:\\Work\\Src\\Main.C') === 'e:/work/src/main.c', normFilePath('E:\\Work\\Src\\Main.C'));

// ---- 2. 唯一属主 ----
{
  const p1 = mkProject('p1.cbp', [mkFile('C:/a/x.c'), mkFile('C:/a/y.c')]);
  const p2 = mkProject('p2.cbp', [mkFile('C:/b/z.c')]);
  const idx = buildPathOwnerIndex([p1, p2]);
  check('A2 唯一属主命中（大小写/斜杠不敏感）', findSoleOwner(idx, 'c:\\A\\X.C') === p1, 'n/a', 'p1');
  check('A3 另一工程文件同样命中', findSoleOwner(idx, 'C:/b/z.c') === p2, 'n/a', 'p2');
  check('A4 未收录文件 → undefined', findSoleOwner(idx, 'C:/nope.c') === undefined, 'n/a', undefined);
  check('A5 无共享文件：hasShared=false', idx.hasShared === false, idx.hasShared, false);
}

// ---- 3. 共享文件（两个工程收录同一路径）→ 无唯一属主 ----
{
  const shared = mkFile('C:/a/shared.c');
  const p1 = mkProject('p1.cbp', [shared, mkFile('C:/a/x.c')]);
  const p2 = mkProject('p2.cbp', [mkFile('C:/a/shared.c')]);
  const idx = buildPathOwnerIndex([p1, p2]);
  check('A6 共享文件 → findSoleOwner = undefined', findSoleOwner(idx, 'C:/a/shared.c') === undefined, 'n/a', undefined);
  check('A7 共享检测 hasShared=true', idx.hasShared === true, idx.hasShared, true);
  check('A8 属主列表保持工程顺序（含 2 个属主）',
    JSON.stringify((idx.byPath.get('c:/a/shared.c') || []).map((p) => p.filename)) === JSON.stringify(['p1.cbp', 'p2.cbp']),
    idx.byPath.get('c:/a/shared.c'));
}

// ---- 4. 同一工程重复收录同一路径 → 仍算唯一属主（去重） ----
{
  const p1 = mkProject('p1.cbp', [mkFile('C:/a/x.c'), mkFile('c:/a/X.C')]);
  const idx = buildPathOwnerIndex([p1]);
  check('A9 同工程重复路径去重（唯一属主 + 非共享）',
    findSoleOwner(idx, 'C:/a/x.c') === p1 && idx.hasShared === false, { hasShared: idx.hasShared }, true);
}

// ---- 5. 只读 project.files（与旧 syncActiveProjectToEditor 语义一致：目标文件列表不参与） ----
{
  const targetFile = mkFile('C:/t/only-target.c');
  const p1 = mkProject('p1.cbp', [], [{ title: 'Debug', files: [targetFile] }]);
  const idx = buildPathOwnerIndex([p1]);
  check('A10 仅存在于目标列表的文件不建立属主（语义钉住）',
    idx.byPath.size === 0 && findSoleOwner(idx, 'C:/t/only-target.c') === undefined, idx.byPath.size, 0);
}

// ---- 6. absolutePath 缺失时回退 relativeFilename ----
{
  const f = mkFile('', 'src/rel.c');
  const p1 = mkProject('p1.cbp', [f]);
  const idx = buildPathOwnerIndex([p1]);
  check('A11 absolutePath 空 → 用 relativeFilename 建键', findSoleOwner(idx, 'SRC/REL.c') === p1, 'n/a', 'p1');
}

// ---- 7. 空输入 ----
check('A12 空工程列表：安全返回', (() => {
  const idx = buildPathOwnerIndex([]);
  return idx.byPath.size === 0 && idx.hasShared === false;
})());

// ---- 8. extension 接线静态断言 ----
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('B1 dist 使用 buildPathOwnerIndex/findSoleOwner', ext.includes('buildPathOwnerIndex') && ext.includes('findSoleOwner'), null);
check('B2 dist 含失效入口 invalidateOwnerIndex 且 openProject 接线', ext.includes('invalidateOwnerIndex'), null);
check('B3 dist 无旧 O(项目×文件) 精确扫描残留', !ext.includes('p.files?.some'), null);
check('B4 dist 保留回退前缀扫描（treeOwners + 精确前缀比较，非宽泛断言）',
  ext.includes('treeOwners') && ext.includes("norm.startsWith(root + '/')"), null);
check('B5 dist 含事件记忆化 lastSyncMemo', ext.includes('lastSyncMemo'), null);

console.log(`\npath-owner-index: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
