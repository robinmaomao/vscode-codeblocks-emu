// 模拟 C3-B 懒加载逻辑（buildDirIndex + 逐层 childrenOfDir），验证与 test-vfolder-sim.js 旧逻辑树结构一致
const { ProjectParser } = require('./dist/model/parser');
const path = require('path');
const fs = require('fs');
const os = require('os');

const cbp = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="demo" />
		<Option virtualFolders="Headers;Sources;Sources/Generated" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/demo" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Unit filename="foo.h">
			<Option virtualFolder="Headers" />
		</Unit>
		<Unit filename="bar.c">
			<Option virtualFolder="Sources" />
		</Unit>
		<Unit filename="gen.c">
			<Option virtualFolder="Sources/Generated" />
		</Unit>
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`;

const tmp = path.join(os.tmpdir(), 'cb-tree-lazy.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const p = new ProjectParser().parse(tmp);

function cleanRelativePath(rel) {
  return rel.replace(/\\/g, '/').replace(/^(\.\.\/)+|^(\.\/)+/, '');
}

// ---- 复刻 buildDirIndex ----
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

function mergeEmptyVirtualFolders(project, index) {
  for (const vf of project.virtualFolders) {
    const segs = cleanRelativePath(vf).split('/').filter(Boolean);
    let parent = '';
    for (const seg of segs) {
      if (!index.subdirsByDir.has(parent)) index.subdirsByDir.set(parent, new Set());
      index.subdirsByDir.get(parent).add(seg);
      parent = parent ? `${parent}/${seg}` : seg;
    }
  }
}

function sortDirNodes(nodes) {
  nodes.sort((a, b) => {
    const aIsDir = (a.kind !== 'file') ? 0 : 1;
    const bIsDir = (b.kind !== 'file') ? 0 : 1;
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

// ---- 复刻 buildFileNodes（vf 作用域顶层）+ 逐层展开 ----
const vfEntries = p.files.filter((f) => f.virtualFolder)
  .map((f) => ({ file: f, rel: path.posix.join(f.virtualFolder, path.basename(f.relativeFilename)) }));
const vfIndex = buildDirIndex(vfEntries);
mergeEmptyVirtualFolders(p, vfIndex);
const top = childrenOfDir('', vfIndex, 'virtualFolder');

const lines = [];
function dump(nodes, indent) {
  for (const n of nodes) {
    lines.push(indent + `[${n.kind}] ${n.name}`);
    if (n.kind !== 'file') dump(childrenOfDir(n.dirKey, vfIndex, 'virtualFolder'), indent + '  ');
  }
}
dump(top, '');
fs.unlinkSync(tmp);

const expected = [
  '[virtualFolder] Headers',
  '  [file] foo.h',
  '[virtualFolder] Sources',
  '  [virtualFolder] Generated',
  '    [file] gen.c',
  '  [file] bar.c',
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
  console.log('PASS 懒加载树结构与旧逻辑一致（' + expected.length + ' 行）');
  process.exit(0);
} else {
  process.exit(1);
}
