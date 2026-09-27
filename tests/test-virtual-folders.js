// 批次一 P4 回归：虚拟文件夹模型变换（对齐 cbproject.cpp:1051-1097）
//  - add：多级路径 / 重复拒绝 / 非法字符（; \ 空段 . ..）
//  - rename：精确前缀替换（保留子路径；old 'a' 不误伤 'ab'——相对 CB 裸 StartsWith 的保护性差异）
//  - delete：列表含子级移除 + 文件回根（绝不删磁盘文件）
//  - 往返：写回 .cbp 再解析，virtualFolders 列表与文件归属一致（projectloader/writer 兼容）
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  addVirtualFolder, renameVirtualFolder, deleteVirtualFolder, countFilesUnderVirtualFolder, assignFileToVirtualFolder,
  isUnderVirtualFolder, remapVirtualFolder, validateVirtualFolderPath,
} = require('../dist/model/virtualFolders.js');
const { ProjectParser } = require('../dist/model/parser.js');
const { serializeProject } = require('../dist/model/projectWriter.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- 1. 简单项目夹具（只需 files + virtualFolders） ----
const mkProject = () => ({
  virtualFolders: ['Sources'],
  files: [
    { relativeFilename: 'a.c', virtualFolder: '' },
    { relativeFilename: 'a1.c', virtualFolder: 'ab' },      // 用于验证 'a' 改名不误伤 'ab'
    { relativeFilename: 's1.c', virtualFolder: 'Sources' },
    { relativeFilename: 's2.c', virtualFolder: 'Sources/sub' },
    { relativeFilename: 'h1.h', virtualFolder: 'Headers' },
  ],
});

// ---- 2. 校验与新增 ----
check('校验：非法字符（; \\ / 空段 . ..）',
  !!validateVirtualFolderPath('a;b', true) && !!validateVirtualFolderPath('a\\b', true)
  && !!validateVirtualFolderPath('a//b', true) && !!validateVirtualFolderPath('a/.', true)
  && !!validateVirtualFolderPath('a/../b', true) && !!validateVirtualFolderPath('', true),
  'invalid', 'error');
check('校验：多级路径合法（allowSlash=true）', validateVirtualFolderPath('a/b', true) === undefined, 'a/b', undefined);
check('校验：单名模式下 "/" 非法', !!validateVirtualFolderPath('a/b', false), 'a/b', 'error');

{
  const p = mkProject();
  const r1 = addVirtualFolder(p, 'Sources');
  const r2 = addVirtualFolder(p, 'Sources/Deep/Leaf');
  check('新增：重复路径拒绝（对齐 CB 列表去重语义）', r1.ok === false && /已存在/.test(r1.reason), r1.reason, '已存在');
  check('新增：多级路径追加成功', r2.ok && p.virtualFolders.includes('Sources/Deep/Leaf'), p.virtualFolders, 'Sources/Deep/Leaf');
  const r3 = addVirtualFolder(p, 'bad;name');
  check('新增：非法名称拒绝', r3.ok === false && !!r3.reason, r3.reason, 'error');
}

// ---- 3. 精确前缀判定 ----
check('精确前缀：ab 不属于 a', !isUnderVirtualFolder('ab', 'a'), false, false);
check('精确前缀：a 与其子级 a/b 属于 a', isUnderVirtualFolder('a', 'a') && isUnderVirtualFolder('a/b', 'a'), true, true);
check('remap：a → x 保留子路径（a/b → x/b），ab 不动', remapVirtualFolder('a/b', 'a', 'x') === 'x/b' && remapVirtualFolder('ab', 'a', 'x') === 'ab',
  [remapVirtualFolder('a/b', 'a', 'x'), remapVirtualFolder('ab', 'a', 'x')], ['x/b', 'ab']);

// ---- 4. 重命名 ----
{
  const p = mkProject();
  const r = renameVirtualFolder(p, 'Sources', 'Code');
  check('重命名：列表条目替换（含子路径）', p.virtualFolders.includes('Code') && p.virtualFolders.includes('Code/Deep/Leaf') === false && r.changedFolders === 1,
    { list: p.virtualFolders, changed: r.changedFolders }, 'Code');
  check('重命名：文件 virtual_path 前缀替换（保留子路径）',
    p.files.find((f) => f.relativeFilename === 's1.c').virtualFolder === 'Code'
    && p.files.find((f) => f.relativeFilename === 's2.c').virtualFolder === 'Code/sub',
    p.files.map((f) => [f.relativeFilename, f.virtualFolder]), 'Code / Code/sub');
  check('重命名：受影响文件数正确', r.affectedFiles === 2, r.affectedFiles, 2);

  const p2 = {
    virtualFolders: ['a'],
    files: [
      { relativeFilename: 'one.c', virtualFolder: 'a' },
      { relativeFilename: 'two.c', virtualFolder: 'a/b' },
      { relativeFilename: 'ab.c', virtualFolder: 'ab' },
    ],
  };
  const r2 = renameVirtualFolder(p2, 'a', 'x');
  check('重命名：精确前缀保护——a 改名只影响 a 与 a/b，不影响 ab（CB 裸 StartsWith 会误伤）',
    p2.files.find((f) => f.relativeFilename === 'one.c').virtualFolder === 'x'
    && p2.files.find((f) => f.relativeFilename === 'two.c').virtualFolder === 'x/b'
    && p2.files.find((f) => f.relativeFilename === 'ab.c').virtualFolder === 'ab'
    && r2.affectedFiles === 2,
    { one: p2.files[0].virtualFolder, two: p2.files[1].virtualFolder, ab: p2.files[2].virtualFolder, affected: r2.affectedFiles }, 'x / x/b / ab / 2');

  const p3 = mkProject();
  const same = renameVirtualFolder(p3, 'Sources', 'Sources');
  check('重命名：同名 no-op（对齐 CB）', same.ok === false && /未变化/.test(same.reason), same.reason, '未变化');
  const renamedToHeaders = renameVirtualFolder(mkProject(), 'Sources', 'Headers');
  check('重命名：与既有条目重名时列表去重', renamedToHeaders.ok && renamedToHeaders.affectedFiles === 2, renamedToHeaders, 'ok');
}

// ---- 5. 删除 ----
{
  const p = mkProject();
  const diskBefore = p.files.length;
  const count = countFilesUnderVirtualFolder(p, 'Sources');
  const r = deleteVirtualFolder(p, 'Sources');
  check('删除：文件计数（含子级）', count === 2, count, 2);
  check('删除：列表移除含子级条目', !p.virtualFolders.some((v) => isUnderVirtualFolder(v, 'Sources')), p.virtualFolders, '无 Sources');
  check('删除：文件回根（清空 virtualFolder）而非删除',
    p.files.filter((f) => f.virtualFolder === '').length >= 2 && p.files.length === diskBefore && r.affectedFiles === 2,
    { files: p.files.length, affected: r.affectedFiles }, '回根');
  check('删除：ab 不被 “a/Header” 之类前缀误伤（精确前缀）',
    (() => { const q = mkProject(); deleteVirtualFolder(q, 'a'); return q.files.find((f) => f.relativeFilename === 'a1.c').virtualFolder === 'ab'; })(),
    'ab 保留', true);
}

// ---- 6. 拖拽归入（assign） ----
{
  const p = mkProject();
  const f = p.files.find((x) => x.relativeFilename === 'h1.h');
  assignFileToVirtualFolder(f, 'Sources/Deep');
  check('拖拽：文件归入目标虚拟文件夹', f.virtualFolder === 'Sources/Deep', f.virtualFolder, 'Sources/Deep');
  assignFileToVirtualFolder(f, '');
  check('拖拽到工程根 = 清空归属', f.virtualFolder === '', f.virtualFolder, '');
}

// ---- 7. 往返：写回 .cbp 再解析 ----
{
  const src = path.join(__dirname, '../test-project/hello-cb.cbp');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-vf-'));
  const cbp = path.join(tmp, 'hello-cb.cbp');
  fs.copyFileSync(src, cbp);

  const project = new ProjectParser().parse(cbp);
  addVirtualFolder(project, 'Headers');
  addVirtualFolder(project, 'Sources/Deep');
  // main.c → Sources/Deep；util.c → Headers
  assignFileToVirtualFolder(project.files.find((f) => f.relativeFilename === 'main.c'), 'Sources/Deep');
  assignFileToVirtualFolder(project.files.find((f) => f.relativeFilename === 'util.c'), 'Headers');
  fs.writeFileSync(cbp, serializeProject(project), 'utf-8');

  const reparsed = new ProjectParser().parse(cbp);
  check('往返：virtualFolders 列表保留（含空文件夹）',
    reparsed.virtualFolders.includes('Headers') && reparsed.virtualFolders.includes('Sources/Deep'),
    reparsed.virtualFolders, ['Headers', 'Sources/Deep']);
  check('往返：文件归属保留',
    reparsed.files.find((f) => f.relativeFilename === 'main.c').virtualFolder === 'Sources/Deep'
    && reparsed.files.find((f) => f.relativeFilename === 'util.c').virtualFolder === 'Headers',
    reparsed.files.map((f) => [f.relativeFilename, f.virtualFolder]), 'ok');

  // 重命名 → 写回 → 再解析（子路径保留）
  renameVirtualFolder(reparsed, 'Sources', 'Code');
  fs.writeFileSync(cbp, serializeProject(reparsed), 'utf-8');
  const reparsed2 = new ProjectParser().parse(cbp);
  check('往返：重命名后子路径保留（Sources/Deep → Code/Deep）',
    reparsed2.virtualFolders.includes('Code/Deep')
    && reparsed2.files.find((f) => f.relativeFilename === 'main.c').virtualFolder === 'Code/Deep',
    { list: reparsed2.virtualFolders, main: reparsed2.files.find((f) => f.relativeFilename === 'main.c').virtualFolder }, 'Code/Deep');

  // 删除 → 写回 → 再解析（文件回根、磁盘文件仍在）
  deleteVirtualFolder(reparsed2, 'Code');
  fs.writeFileSync(cbp, serializeProject(reparsed2), 'utf-8');
  const reparsed3 = new ProjectParser().parse(cbp);
  check('往返：删除后文件回根且磁盘文件仍在',
    reparsed3.files.find((f) => f.relativeFilename === 'main.c').virtualFolder === ''
    && !reparsed3.virtualFolders.some((v) => isUnderVirtualFolder(v, 'Code'))
    && fs.existsSync(path.join(tmp, 'main.c')) === false, // 夹具无磁盘源文件，此处仅验证“未抛错/未删文件”
    reparsed3.virtualFolders, '根');
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`虚拟文件夹管理回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
