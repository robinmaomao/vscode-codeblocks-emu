// 模拟 buildFileNodes 逻辑，验证虚拟文件夹树构建结果（不依赖 vscode）
const { ProjectParser } = require('../dist/model/parser');
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

const tmp = path.join(os.tmpdir(), 'cb-vfolder-sim.cbp');
fs.writeFileSync(tmp, cbp, 'utf-8');
const p = new ProjectParser().parse(tmp);

function cleanRelativePath(rel) {
  return rel.replace(/\\/g, '/').replace(/^(\.\.\/)+|^(\.\/)+/, '');
}

// 复刻 buildFileNodes 核心（不含 vscode 对象）
const dirNodes = new Map();
const rootDirs = [];
const rootFiles = [];

function ensureDirNodes(pathStr, kind) {
  const segs = cleanRelativePath(pathStr).split('/').filter(Boolean);
  let parentNode = undefined, parentKey = '', result;
  for (const seg of segs) {
    const key = parentKey ? `${parentKey}/${seg}` : seg;
    let node = dirNodes.get(key);
    if (!node) {
      node = { name: seg, kind, children: [] };
      dirNodes.set(key, node);
      if (parentNode) parentNode.children.push(node); else rootDirs.push(node);
    }
    parentNode = node; parentKey = key; result = node;
  }
  return result;
}

for (const vf of p.virtualFolders) ensureDirNodes(vf, 'virtualFolder');
for (const f of p.files) {
  const kind = f.virtualFolder ? 'virtualFolder' : 'folder';
  const rel = f.virtualFolder
    ? path.posix.join(f.virtualFolder, path.basename(f.relativeFilename))
    : (f.relativeToCommonTopLevelPath || f.relativeFilename);
  const segs = cleanRelativePath(rel).split('/').filter(Boolean);
  if (segs.length <= 1) { rootFiles.push({ name: segs[0] || path.basename(f.relativeFilename), kind: 'file', children: [] }); continue; }
  const parent = ensureDirNodes(segs.slice(0, -1).join('/'), kind);
  if (parent) parent.children.push({ name: segs[segs.length - 1], kind: 'file', children: [] });
  else rootFiles.push({ name: path.basename(f.relativeFilename), kind: 'file', children: [] });
}

function dump(nodes, indent) {
  for (const n of nodes) {
    console.log(indent + `[${n.kind}] ${n.name}`);
    if (n.children.length) dump(n.children, indent + '  ');
  }
}
console.log('=== 树结构 ===');
dump([...rootDirs, ...rootFiles], '');
fs.unlinkSync(tmp);

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
const headers = rootDirs.find((n) => n.name === 'Headers');
const sources = rootDirs.find((n) => n.name === 'Sources');
check('虚拟文件夹根节点', !!headers && !!sources && rootDirs.length === 2, rootDirs.map((n) => n.name));
check('Headers 下 foo.h', headers && headers.children.some((c) => c.name === 'foo.h' && c.kind === 'file'), headers && headers.children);
check('Sources 下 bar.c / Generated/gen.c', sources && sources.children.some((c) => c.name === 'bar.c') && sources.children.some((c) => c.name === 'Generated' && c.children.some((g) => g.name === 'gen.c')), sources && sources.children);
check('无虚拟文件夹的 main.c 留在根', rootFiles.some((f) => f.name === 'main.c'), rootFiles.map((f) => f.name));
console.log(`虚拟文件夹树: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
