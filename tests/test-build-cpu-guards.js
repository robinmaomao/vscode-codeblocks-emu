// 构建期 CPU 收口回归（接线静态断言）
//  - clangd 重启延迟到构建结束：避免 clangd 整库重索引与编译进程抢 CPU（构建期 CPU 100% 的叠加因素）
//  - clangd 编译器探测的同步子进程带超时：避免挂起时冻结扩展宿主
//  - ccache：前缀按生成器实例记忆化（每单元不再两次 getConfiguration）+ 解析缓存命中时校验路径
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}`); }
}

const read = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

// ---- A. clangd 重启延迟（extension） ----
const ext = read('dist/extension.js');
check('A1 dist 含 pendingClangdRestart 状态与 schedule/flush 两个入口',
  ext.includes('pendingClangdRestart') && ext.includes('scheduleClangdRestart') && ext.includes('flushPendingClangdRestart'), null);
check('A2 构建包装 finally 均补执行 flush（≥5 处：工作区/单项目/单文件/make/rebuild 分离）',
  (ext.match(/flushPendingClangdRestart\(\)/g) || []).length >= 5,
  (ext.match(/flushPendingClangdRestart\(\)/g) || []).length);
check('A3 schedule 在构建中只登记：检查 buildInProgress',
  /function scheduleClangdRestart\(\)\s*\{\s*if \(buildInProgress\)/.test(ext), null);
check('A4 直接重启仅剩两个入口（schedule 立即路径 + flush）',
  (ext.match(/void restartClangd\(\)/g) || []).length === 2,
  (ext.match(/void restartClangd\(\)/g) || []).length);

// ---- B. clangd 探测同步子进程超时（tools/clangd） ----
const clangdTool = read('dist/tools/clangd.js');
check('B1 编译器 include/三元组探测带 5s 超时（≥2 处）',
  (clangdTool.match(/timeout:\s*5000/g) || []).length >= 2,
  (clangdTool.match(/timeout:\s*5000/g) || []).length);
check('B2 where/which 探测带 3s 超时', /timeout:\s*3000/.test(clangdTool), null);
check('B3 全部探测派生隐藏窗口（windowsHide: true）', clangdTool.includes('windowsHide: true'), null);

// ---- C. ccache：前缀记忆化 + 解析缓存命中校验 ----
const gen = read('dist/compiler/commandGenerator.js');
check('C1 编译缓存前缀按生成器实例记忆化', gen.includes('cachePrefixMemo') && /cachePrefixMemo !== undefined/.test(gen), null);
const cc = read('dist/build/compilerCache.js');
check('C2 解析缓存命中时校验路径存在性（失效则重扫）', /isRunnableFile\(resolveCacheVal[,)]/.test(cc), null);
const engine = read('dist/build/buildEngine.js');
check('C3 未找到时才清空解析缓存（不再每构建全盘扫描）',
  !/clearCompilerCacheResolveCache\(\);\s*\n\s*if \(resolveCompilerCachePathCached/.test(engine), null);

console.log(`build-cpu-guards: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
