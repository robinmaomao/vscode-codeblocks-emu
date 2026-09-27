// 批次一 P1 回归：工程树节点身份 / getParent / findFileNode / filesUnder
//  - 稳定节点实例（TreeView.reveal 要求：getParent 链 + getChildren 返回同一实例）
//  - findFileNode 的链条与 getChildren 懒加载链条一致（虚拟文件夹 / 分组 / 物理目录）
//  - filesUnder 作用域（项目 / 目录 / 虚拟文件夹 / 分组）对齐 ProjectManagerUI::ListNodes
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    class TreeItem {
      constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; }
    }
    class EventEmitter {
      constructor() { this.event = () => ({ dispose() {} }); }
      fire() {}
      dispose() {}
    }
    return {
      TreeItem,
      EventEmitter,
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      ThemeIcon: class { constructor(id) { this.id = id; } },
      Uri: {
        file: (p) => ({ fsPath: p, scheme: 'file' }),
        joinPath: (u, ...segs) => ({ fsPath: [u.fsPath, ...segs].join('/'), scheme: 'file' }),
      },
      DataTransfer: class {},
      DataTransferItem: class { constructor(v) { this.value = v; } },
    };
  }
  return origLoad(request, parent, isMain);
};

const os = require('os');
const path = require('path');
const { ProjectTreeProvider } = require('../dist/ui/projectTreeProvider.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const base = path.join(os.tmpdir(), 'cb-tree-fixture');
const mkFile = (rel, extra = {}) => ({
  relativeFilename: rel,
  relativeToCommonTopLevelPath: extra.relToCommon ?? rel,
  absolutePath: path.join(base, rel).replace(/\\/g, '/'),
  buildTargets: ['Debug', 'Release'],
  explicitTargets: false,
  compilerVar: rel.endsWith('.c') ? 'CC' : 'CPP',
  compile: true,
  link: true,
  customBuildCommands: {},
  weight: 50,
  virtualFolder: extra.vf ?? '',
  generatedFiles: [],
});

const project = {
  title: 'fixture',
  basePath: base,
  commonTopLevelPath: base,
  pchMode: 1,
  extendedObjNames: false,
  platforms: 0xff,
  filename: path.join(base, 'fixture.cbp'),
  compilerId: 'gcc',
  compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
  includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
  buildTargets: [{ title: 'Debug' }, { title: 'Release' }],
  virtualTargets: [],
  virtualFolders: ['Headers', 'Empty/VF'],
  commandsBeforeBuild: [], commandsAfterBuild: [], buildScripts: [],
  files: [
    mkFile('common/defs.h', { vf: 'Headers' }),
    mkFile('src/main.c'),
    mkFile('src/util.c'),
    mkFile('app.c'),
  ],
};

const provider = new ProjectTreeProvider();
provider.setProjects([project]);

// ---- 1. 根/项目节点身份 ----
const roots = provider.getChildren();
check('根节点 = 项目节点（id = .cbp 路径）', roots.length === 1 && roots[0].kind === 'project' && roots[0].id === project.filename,
  roots.map((r) => r.kind), 'project');
const root = roots[0];
check('项目节点实例稳定（重复 getChildren 返回同一对象）', provider.getChildren()[0] === root, 'identity', true);
check('项目节点无父（getParent = undefined）', provider.getParent(root) === undefined, 'n/a', undefined);

// ---- 2. 虚拟文件夹链条 ----
const fVf = project.files[0];
const rootKids = provider.getChildren(root);
const vfDir = rootKids.find((n) => n.kind === 'virtualFolder' && n.label === 'Headers');
check('虚拟文件夹目录节点存在且 contextValue=virtualFolder', !!vfDir && vfDir.contextValue === 'virtualFolder',
  vfDir && vfDir.contextValue, 'virtualFolder');
const vfKids = provider.getChildren(vfDir);
const vfFileNode = vfKids.find((n) => n.label === 'defs.h');
check('虚拟文件夹展开出文件节点（contextValue 以 file 开头）',
  !!vfFileNode && /^file/.test(vfFileNode.contextValue), vfFileNode && vfFileNode.contextValue, 'file*');
check('findFileNode(vf 文件) === 懒加载链条中的同一实例', provider.findFileNode(project, fVf) === vfFileNode, 'identity', true);
check('getParent 链条：file → vf 目录 → 项目',
  provider.getParent(vfFileNode) === vfDir && provider.getParent(vfDir) === root, 'ok', true);

// 空虚拟文件夹（Empty/VF）也应显示
const emptyDir = rootKids.find((n) => n.kind === 'virtualFolder' && n.label === 'Empty');
const emptyKids = provider.getChildren(emptyDir);
check('空虚拟文件夹链条显示（Empty → VF，均无文件）',
  !!emptyKids.find((n) => n.kind === 'virtualFolder' && n.label === 'VF') && provider.filesUnder(emptyDir).length === 0,
  emptyKids.map((n) => n.label), ['VF']);

// ---- 3. 分组（categorize=true 默认）链条 ----
const groupNode = rootKids.find((n) => n.kind === 'fileGroup' && n.label === 'Sources');
check('默认按文件类型分组（Sources 分组节点存在）', !!groupNode, rootKids.map((n) => `${n.kind}:${n.label}`), 'Sources');
const groupKids = provider.getChildren(groupNode);
const srcDir = groupKids.find((n) => n.kind === 'folder' && n.label === 'src');
const srcKids = provider.getChildren(srcDir);
const mainNode = srcKids.find((n) => n.label === 'main.c');
check('分组 → 目录 → 文件链条实例一致',
  mainNode === provider.findFileNode(project, project.files[1]), 'identity', true);
check('getParent 链条：file → 目录 → 分组 → 项目',
  provider.getParent(mainNode) === srcDir && provider.getParent(srcDir) === groupNode && provider.getParent(groupNode) === root, 'ok', true);

// ---- 4. filesUnder 作用域 ----
check('filesUnder(项目) = 全部文件', provider.filesUnder(root).length === 4, provider.filesUnder(root).length, 4);
check('filesUnder(分组 Sources) = 该分组文件（含根级 app.c）',
  JSON.stringify(provider.filesUnder(groupNode).map((f) => f.relativeFilename)) === JSON.stringify(['src/main.c', 'src/util.c', 'app.c']),
  provider.filesUnder(groupNode).map((f) => f.relativeFilename), ['src/main.c', 'src/util.c', 'app.c']);
check('filesUnder(目录 src) = 该目录及子目录文件',
  JSON.stringify(provider.filesUnder(srcDir).map((f) => f.relativeFilename)) === JSON.stringify(['src/main.c', 'src/util.c']),
  provider.filesUnder(srcDir).map((f) => f.relativeFilename), ['src/main.c', 'src/util.c']);
check('filesUnder(虚拟文件夹 Headers) = 归属该虚拟文件夹的文件',
  JSON.stringify(provider.filesUnder(vfDir).map((f) => f.relativeFilename)) === JSON.stringify(['common/defs.h']),
  provider.filesUnder(vfDir).map((f) => f.relativeFilename), ['common/defs.h']);
check('filesUnder(文件节点) = 仅该文件', provider.filesUnder(mainNode).length === 1, provider.filesUnder(mainNode).length, 1);

// ---- 5. categorize=false（物理目录）模式 ----
provider.setCategorize(false);
const plainRootKids = provider.getChildren(provider.getChildren()[0]);
const plainSrc = plainRootKids.find((n) => n.kind === 'folder' && n.label === 'src');
const plainMain = provider.getChildren(plainSrc).find((n) => n.label === 'main.c');
check('categorize=false：目录直接挂在项目下且 findFileNode 一致',
  !!plainSrc && provider.findFileNode(project, project.files[1]) === plainMain, 'identity', true);
check('categorize=false：项目下无分组节点', !plainRootKids.some((n) => n.kind === 'fileGroup'),
  plainRootKids.map((n) => n.kind), '无 fileGroup');

// ---- 6. setProjects 后缓存失效（旧节点不再复用） ----
provider.setProjects([project]);
const freshRoot = provider.getChildren()[0];
check('setProjects 清空节点缓存（返回新实例）', freshRoot !== root, 'invalidated', true);

console.log(`查找文件/节点身份回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
