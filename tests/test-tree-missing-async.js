// P8 回归：工程树文件存在性异步检查（不再同步 fs.existsSync）
//  - 节点创建时零同步 stat；异步检查（50ms 去抖）后发现缺失 → description='缺失' + 局部 fire
//  - 检查结果缓存（同文件不重复 stat）；setProjects 清缓存后重新检查
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    class TreeItem {
      constructor(label, collapsibleState) { this.label = label; this.collapsibleState = collapsibleState; }
    }
    class EventEmitter {
      constructor() { this.listeners = []; }
      get event() {
        return (listener) => {
          this.listeners.push(listener);
          return { dispose: () => { /* noop */ } };
        };
      }
      fire(v) { for (const l of this.listeners) l(v); }
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

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectTreeProvider } = require(path.resolve(__dirname, '../dist/ui/projectTreeProvider.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 统计 fs.promises.access 调用（provider 在调用时按属性查找 → 可打桩）
const origAccess = fs.promises.access;
let accessCount = 0;
fs.promises.access = (...args) => { accessCount++; return origAccess.apply(fs.promises, args); };

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-tree-missing-'));
const existsAbs = path.join(base, 'exists.c');
fs.writeFileSync(existsAbs, 'int main(void) { return 0; }\n', 'utf-8');
const goneAbs = path.join(base, 'gone.c');   // 不创建 → 缺失
const partAbs = path.join(base, 'part.c');
fs.writeFileSync(partAbs, 'int x;\n', 'utf-8');

const mkFile = (abs, rel, targets) => ({
  relativeFilename: rel,
  relativeToCommonTopLevelPath: rel,
  absolutePath: abs,
  buildTargets: targets,
  explicitTargets: false,
  compilerVar: 'CC',
  compile: true,
  link: true,
  customBuildCommands: {},
  weight: 50,
  virtualFolder: '',
  generatedFiles: [],
});
const project = {
  title: 'fixture', basePath: base, commonTopLevelPath: base,
  pchMode: 0, extendedObjNames: false, platforms: 0xff,
  filename: path.join(base, 'fixture.cbp'), compilerId: 'gcc',
  compilerOptions: [], linkerOptions: [], resourceCompilerOptions: [],
  includeDirs: [], libDirs: [], resourceIncludeDirs: [], linkLibs: [],
  buildTargets: [{ title: 'Debug' }, { title: 'Release' }],
  virtualTargets: [], virtualFolders: [],
  commandsBeforeBuild: [], commandsAfterBuild: [], buildScripts: [],
  files: [
    mkFile(existsAbs, 'exists.c', ['Debug', 'Release']),
    mkFile(goneAbs, 'gone.c', ['Debug', 'Release']),
    mkFile(partAbs, 'part.c', ['Debug']),
  ],
};

(async () => {
  const provider = new ProjectTreeProvider();
  const emitted = [];
  provider.onDidChangeTreeData((n) => emitted.push(n));
  provider.setProjects([project]);

  const nodeExists = provider.findFileNode(project, project.files[0]);
  const nodeGone = provider.findFileNode(project, project.files[1]);
  const nodePart = provider.findFileNode(project, project.files[2]);

  // ---- 1. 同步阶段：零 stat，缺失文件暂按"存在"渲染 ----
  check('A1 节点创建零同步 stat（access 未调用）', accessCount === 0, accessCount, 0);
  check('A2 缺失文件初始不显示「缺失」（异步检查前）', nodeGone.description === undefined, nodeGone.description, undefined);
  check('A3 部分归属文件的初始描述正确', nodePart.description === 'Debug', nodePart.description, 'Debug');

  // ---- 2. 异步阶段：50ms 去抖后完成检查 ----
  await sleep(160);
  check('B1 缺失文件更新为「缺失」（含局部 fire）',
    nodeGone.description === '缺失' && emitted.includes(nodeGone), { desc: nodeGone.description, fired: emitted.includes(nodeGone) }, '缺失+fired');
  check('B2 存在文件保持原描述', nodeExists.description === undefined, nodeExists.description, undefined);
  check('B3 存在文件未被 fire（无变化不刷新）', !emitted.includes(nodeExists), emitted.length, 'not fired');
  check('B4 每个唯一文件只 stat 一次（3 个文件 → 3 次）', accessCount === 3, accessCount, 3);

  // ---- 3. 存在性缓存：重复取节点不重复 stat ----
  provider.findFileNode(project, project.files[0]);
  provider.findFileNode(project, project.files[1]);
  await sleep(80);
  check('C1 缓存命中不重复 stat', accessCount === 3, accessCount, 3);
  check('C2 missingCache 记录缺失状态（1 个缺失）',
    provider.missingCache.size === 3 && [...provider.missingCache.values()].filter(Boolean).length === 1,
    [...provider.missingCache.values()], '1 缺失');

  // ---- 4. setProjects 清缓存 → 重新异步检查 ----
  provider.setProjects([project]);
  check('C3 setProjects 清空存在性缓存', provider.missingCache.size === 0, provider.missingCache.size, 0);
  const nodeGone2 = provider.findFileNode(project, project.files[1]);
  await sleep(160);
  check('C4 重建节点后重新检查（缺失再次标记）', nodeGone2.description === '缺失', nodeGone2.description, '缺失');
  check('C5 重新检查增加 stat 次数（3+1=4）', accessCount === 4, accessCount, 4);

  // ---- 5. provider 源静态断言 ----
  const src = fs.readFileSync(path.resolve(__dirname, '../dist/ui/projectTreeProvider.js'), 'utf8');
  check('D1 文件节点不再同步 existsSync', !src.includes("fs.existsSync(f.absolutePath)"), null);
  check('D2 使用 fs.promises.access 异步检查', src.includes('fs.promises.access'), null);
  check('D3 分片常量 CHUNK=64', src.includes('CHUNK = 64'), null);

  console.log(`\ntree-missing-async: pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL 运行异常: ' + (e && e.stack || e));
  process.exit(1);
});
