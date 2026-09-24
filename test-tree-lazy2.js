// 验证 C3-B 懒加载在 categorize 分组 + 物理目录（含深层目录）场景下的树结构正确性
// 精确复刻 projectTreeProvider.ts 的 buildDirIndex + scopeEntries + childrenOfDir（vscode 无关）
const { ProjectParser } = require('./dist/model/parser');
const path = require('path');
const fs = require('fs');
const os = require('os');

const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="demo" />
		<Option virtualFolders="Headers" />
		<Option compiler="gcc" />
		<Build><Target title="Debug"><Option output="bin/Debug/demo" /><Option type="1" /><Option compiler="gcc" /></Target></Build>
		<Unit filename="main.c" />
		<Unit filename="src/util.c" />
		<Unit filename="src/deep/extra.c" />
		<Unit filename="foo.h"><Option virtualFolder="Headers" /></Unit>
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-tree-lazy2.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const p = new ProjectParser().parse(tmp);

function cleanRelativePath(rel) {
  return rel.replace(/\\/g, '/').replace(/^(\.\.\/)+|^(\.\/)+/, '');
}

const GROUPS = [
  { name: 'Sources', masks: ['*.c', '*.cpp', '*.cc', '*.cxx'] },
  { name: 'D Sources', masks: ['*.d'] },
  { name: 'Fortran Sources', masks: ['*.f', '*.f77', '*.for', '*.fpp', '*.f90', '*.f95', '*.f03', '*.f08'] },
  { name: 'Java Sources', masks: ['*.java'] },
  { name: 'Headers', masks: ['*.h', '*.hpp', '*.hh', '*.hxx'] },
  { name: 'ASM Sources', masks: ['*.asm', '*.s', '*.ss', '*.s62'] },
  { name: 'Resources', masks: ['*.res', '*.xrc', '*.rc', '*.wxs'] },
  { name: 'Scripts', masks: ['*.script'] },
];
const compiled = GROUPS.map((g) => ({
  name: g.name,
  re: g.masks.map((m) => new RegExp('^' + m.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')),
}));
function matchGroup(filename) {
  for (const g of compiled) for (const re of g.re) if (re.test(filename)) return g.name;
  return 'Others';
}
function groupOrder(name) {
  const idx = GROUPS.findIndex((g) => g.name === name);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

function buildDirIndex(entries) {
  const filesByDir = new Map();
  const subdirsByDir = new Map();
  for (const { file, rel } of entries) {
    const segs = cleanRelativePath(rel).split('/').filter(Boolean);
    if (segs.length <= 1) {
      if (!filesByDir.has('')) filesByDir.set('', []);
      filesByDir.get('').push(file);
      continue;
    }
    const dirKey = segs.slice(0, -1).join('/');
    if (!filesByDir.has(dirKey)) filesByDir.set(dirKey, []);
    filesByDir.get(dirKey).push(file);
    let parent = '';
    for (let i = 0; i < segs.length - 1; i++) {
      if (!subdirsByDir.has(parent)) subdirsByDir.set(parent, new Set());
      subdirsByDir.get(parent).add(segs[i]);
      parent = parent ? `${parent}/${segs[i]}` : segs[i];
    }
  }
  return { filesByDir, subdirsByDir };
}

function scopeEntries(project, scopeKey) {
  if (scopeKey === 'vf') {
    return project.files.filter((f) => f.virtualFolder)
      .map((f) => ({ file: f, rel: path.posix.join(f.virtualFolder, path.basename(f.relativeFilename)) }));
  }
  if (scopeKey.startsWith('group:')) {
    const name = scopeKey.slice('group:'.length);
    return project.files.filter((f) => !f.virtualFolder && matchGroup(path.basename(f.relativeFilename)) === name)
      .map((f) => ({ file: f, rel: f.relativeToCommonTopLevelPath || f.relativeFilename }));
  }
  return project.files.filter((f) => !f.virtualFolder)
    .map((f) => ({ file: f, rel: f.relativeToCommonTopLevelPath || f.relativeFilename }));
}

function sortDirNodes(nodes) {
  nodes.sort((a, b) => {
    const aIsDir = a.kind !== 'file' ? 0 : 1;
    const bIsDir = b.kind !== 'file' ? 0 : 1;
    if (aIsDir !== bIsDir) return aIsDir - bIsDir;
    return a.name.localeCompare(b.name);
  });
}

function childrenOfDir(dirKey, index, kind) {
  const nodes = [];
  for (const name of index.subdirsByDir.get(dirKey) ?? []) {
    const fullKey = dirKey ? `${dirKey}/${name}` : name;
    nodes.push({ name, kind, dirKey: fullKey });
  }
  for (const f of index.filesByDir.get(dirKey) ?? []) {
    nodes.push({ name: path.basename(f.relativeFilename), kind: 'file' });
  }
  sortDirNodes(nodes);
  return nodes;
}

// 顶层（categorize=true）：vf 顶层 + 分组节点
const vfIndex = buildDirIndex(scopeEntries(p, 'vf'));
const groupIndexes = new Map();
for (const name of new Set(p.files.filter((f) => !f.virtualFolder).map((f) => matchGroup(path.basename(f.relativeFilename))))) {
  groupIndexes.set(name, buildDirIndex(scopeEntries(p, 'group:' + name)));
}

const top = [...childrenOfDir('', vfIndex, 'virtualFolder')];
for (const name of [...groupIndexes.keys()].sort((a, b) => groupOrder(a) - groupOrder(b) || a.localeCompare(b))) {
  top.push({ name, kind: 'fileGroup', group: name });
}
sortDirNodes(top);

const lines = [];
function dumpAll(nodes, indent, groupIndex) {
  for (const n of nodes) {
    lines.push(indent + `[${n.kind}] ${n.name}`);
    if (n.kind === 'virtualFolder') {
      dumpAll(childrenOfDir(n.dirKey, vfIndex, 'virtualFolder'), indent + '  ', undefined);
    } else if (n.kind === 'fileGroup') {
      dumpAll(childrenOfDir('', groupIndexes.get(n.group), 'folder'), indent + '  ', n.group);
    } else if (n.kind === 'folder') {
      dumpAll(childrenOfDir(n.dirKey, groupIndexes.get(groupIndex), 'folder'), indent + '  ', groupIndex);
    }
  }
}
dumpAll(top, '', undefined);
fs.unlinkSync(tmp);

const expected = [
  '[virtualFolder] Headers',
  '  [file] foo.h',
  '[fileGroup] Sources',
  '  [folder] src',
  '    [folder] deep',
  '      [file] extra.c',
  '    [file] util.c',
  '  [file] main.c',
];

let fail = 0;
if (lines.length !== expected.length) {
  console.error(`FAIL 行数不一致: 期望 ${expected.length}, 实际 ${lines.length}`);
  fail++;
} else {
  for (let i = 0; i < expected.length; i++) {
    if (lines[i] !== expected[i]) {
      console.error(`FAIL 第 ${i} 行: 期望 "${expected[i]}", 实际 "${lines[i]}"`);
      fail++;
    }
  }
}
if (fail === 0) {
  console.log('PASS 懒加载树结构（vf + 分组 + 深层目录）与预期一致（' + expected.length + ' 行）');
  process.exit(0);
} else {
  console.error('实际展开树：');
  for (const l of lines) console.error('  ' + l);
  process.exit(1);
}
