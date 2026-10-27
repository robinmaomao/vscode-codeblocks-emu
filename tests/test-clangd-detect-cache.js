// P7 回归：detectClangd 会话缓存（含清除入口）+ clangd.path 配置监听接线静态断言
const Module = require('module');
const origLoad = Module._load;
let clangdPathStub = '';
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key, def) => (key === 'path' ? clangdPathStub : def),
        }),
      },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { detectClangd, clearClangdDetectionCache, preferClangdSource } = require(path.resolve(__dirname, '../dist/tools/clangd.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-clangd-'));
const f1 = path.join(dir, 'clangd-f1.exe');
const f2 = path.join(dir, 'clangd-f2.exe');
fs.writeFileSync(f1, 'x');
fs.writeFileSync(f2, 'x');

// ---- 1. 首次探测读取配置 ----
clangdPathStub = f1;
clearClangdDetectionCache();
check('A1 首次探测命中配置路径', detectClangd() === f1, detectClangd(), f1);

// ---- 2. 缓存：换配置不重探（直到 clear） ----
clangdPathStub = f2;
check('A2 二次调用走缓存（换配置仍返回旧值）', detectClangd() === f1, detectClangd(), f1);

// ---- 3. 缓存独立于文件存在性（值为缓存时不再 stat） ----
fs.unlinkSync(f1);
check('A3 文件删除后仍返回缓存值（不重探）', detectClangd() === f1, detectClangd(), f1);

// ---- 4. 清除缓存后重探 ----
clearClangdDetectionCache();
check('A4 clear 后重探返回新配置值', detectClangd() === f2, detectClangd(), f2);

// ---- 5. clear 幂等 ----
clearClangdDetectionCache();
clearClangdDetectionCache();
check('A5 clear 幂等（多次调用不抛异常）', detectClangd() === f2, detectClangd(), f2);

// ---- 5b. 配置成目录 → 不能当作 clangd 可执行文件 ----
const asDir = path.join(dir, 'clangd-is-a-dir');
fs.mkdirSync(asDir, { recursive: true });
clangdPathStub = asDir;
clearClangdDetectionCache();
check('A6 配置成目录 → 不返回该目录', detectClangd() !== asDir, detectClangd(), asDir);

// ---- 5c. Build Log 的 clangd 诊断来源过滤 ----
const clangdMixed = preferClangdSource([
  { source: 'clang' }, { source: 'clang-tidy' }, { source: 'Code::Blocks' }, { source: 'C/C++' },
]);
check('D1 有 clangd 来源 → 只保留 clang / clang-tidy / clangd',
  JSON.stringify(clangdMixed.map((d) => d.source)) === JSON.stringify(['clang', 'clang-tidy']), clangdMixed.map((d) => d.source));
check('D2 无 clangd 来源 → 保留全部（避免 Build Log 变空）',
  preferClangdSource([{ source: 'C/C++' }, { source: 'Code::Blocks' }]).length === 2, null);
check('D3 source 缺失 → 保留全部（老版本 clangd 未设置 source）',
  preferClangdSource([{}, {}]).length === 2, null);

// ---- 5d. clangd 扩展下载目录：Code - Insiders / 远程 server 布局（旧实现硬编码 %APPDATA%\Code） ----
{
  const fakeHome = path.join(dir, 'home');
  const installRel = path.join('globalStorage', 'llvm-vs-code-extensions.vscode-clangd', 'install', '0.2.0', 'clangd_18.1.0', 'bin');
  let userRoot;
  if (process.platform === 'win32') {
    const appData = path.join(dir, 'AppData', 'Roaming');
    userRoot = path.join(appData, 'Code - Insiders', 'User');
    process.env.APPDATA = appData;
  } else if (process.platform === 'darwin') {
    userRoot = path.join(fakeHome, 'Library', 'Application Support', 'Code - Insiders', 'User');
    process.env.HOME = fakeHome;
  } else {
    const xdg = path.join(fakeHome, '.config');
    userRoot = path.join(xdg, 'Code - Insiders', 'User');
    process.env.XDG_CONFIG_HOME = xdg;
  }
  const binDir = path.join(userRoot, installRel);
  fs.mkdirSync(binDir, { recursive: true });
  const exe = path.join(binDir, process.platform === 'win32' ? 'clangd.exe' : 'clangd');
  fs.writeFileSync(exe, 'x');
  const savedPath = process.env.PATH;
  process.env.PATH = ''; // 排除 PATH 上的真实 clangd，确保走常见目录
  clangdPathStub = '';
  clearClangdDetectionCache();
  const found = detectClangd();
  check('A7 找到 Insiders 下 clangd 扩展下载的二进制（不硬编码 Code 目录）', found === exe, found, exe);
  process.env.PATH = savedPath;
}

// ---- 6. clangd.js 静态断言（TTL 与负缓存结构在编译产物中） ----
const cj = fs.readFileSync(path.resolve(__dirname, '../dist/tools/clangd.js'), 'utf8');
check('B1 dist 含检测缓存变量 detectClangdCache', cj.includes('detectClangdCache'), null);
check('B2 dist 含 TTL 常量', cj.includes('DETECT_CLANGD_CACHE_TTL_MS'), null);
check('B3 dist 含无缓存探测函数 detectClangdUncached', cj.includes('detectClangdUncached'), null);
check('B4 dist 含清除入口 clearClangdDetectionCache', cj.includes('clearClangdDetectionCache'), null);
check('B5 dist 含负结果短 TTL（安装后可更快检测到）', cj.includes('DETECT_CLANGD_NEGATIVE_TTL_MS'), null);
check('B6 dist 含原子写入口 writeFileAtomic', cj.includes('writeFileAtomic'), null);
check('B7 dist 含诊断来源过滤 preferClangdSource', cj.includes('preferClangdSource'), null);
check('B8 dist 覆盖 Insiders / VSCodium / 远程 server 的安装目录',
  cj.includes('Code - Insiders') && cj.includes('.vscode-server'), null);

// ---- 7. extension 接线静态断言（clangd.path 变化清除缓存） ----
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('C1 dist 引入 clearClangdDetectionCache', ext.includes('clearClangdDetectionCache'), null);
check('C2 dist 监听 clangd.path 配置变化', ext.includes("affectsConfiguration('clangd.path')"), null);
check('C3 dist 监听 clangd 扩展安装/启用状态变化',
  ext.includes('extensions.onDidChange') && ext.includes('CLANGD_EXTENSION_ID'), null);
check('C4 dist 仅生成相关键触发 clangd 重建（CLANGD_GENERATED_KEYS）', ext.includes('CLANGD_GENERATED_KEYS'), null);
check('C5 dist 手动生成时清除检测缓存', /if \(interactive\)[\s\S]{0,80}clearClangdDetectionCache/.test(ext), null);
check('C6 dist 原子写 compile_commands.json',
  fs.readFileSync(path.resolve(__dirname, '../dist/build/compileCommands.js'), 'utf8').includes('writeFileAtomic'), null);

console.log(`\nclangd-detect-cache: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
