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
const { detectClangd, clearClangdDetectionCache } = require(path.resolve(__dirname, '../dist/tools/clangd.js'));

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

// ---- 6. clangd.js 静态断言（TTL 与负缓存结构在编译产物中） ----
const cj = fs.readFileSync(path.resolve(__dirname, '../dist/tools/clangd.js'), 'utf8');
check('B1 dist 含检测缓存变量 detectClangdCache', cj.includes('detectClangdCache'), null);
check('B2 dist 含 TTL 常量', cj.includes('DETECT_CLANGD_CACHE_TTL_MS'), null);
check('B3 dist 含无缓存探测函数 detectClangdUncached', cj.includes('detectClangdUncached'), null);
check('B4 dist 含清除入口 clearClangdDetectionCache', cj.includes('clearClangdDetectionCache'), null);

// ---- 7. extension 接线静态断言（clangd.path 变化清除缓存） ----
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('C1 dist 引入 clearClangdDetectionCache', ext.includes('clearClangdDetectionCache'), null);
check('C2 dist 监听 clangd.path 配置变化', ext.includes("affectsConfiguration('clangd.path')"), null);

console.log(`\nclangd-detect-cache: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
