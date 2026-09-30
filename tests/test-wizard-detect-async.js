// P4 回归：新建工程向导编译器探测异步化（pickCompiler 使用 detectAllCompilersAsync + 跨会话缓存预填）
//  - dist 静态断言（同步 getDetectedCompilers / detectAllCompilers 调用已移除；异步 + 缓存路径已接线）
//  - detector 同步/异步 API 并存（异步用于向导与状态栏命令）
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');

// ---- 1. 同步探测路径已移除 ----
check('A1 dist 无 getDetectedCompilers（同步缓存包装已删）', !ext.includes('getDetectedCompilers'), null);
check('A2 dist 无同步 detectAllCompilers( 调用', !ext.includes('detectAllCompilers('), null);
check('A3 dist 无 cachedCompilers 变量残留', !ext.includes('cachedCompilers'), null);

// ---- 2. 异步 + 缓存预填已接线 ----
check('A4 dist 使用 detectAllCompilersAsync', ext.includes('detectAllCompilersAsync'), null);
const loadCalls = (ext.match(/loadDetectCache\(\)/g) || []).length;
check('A5 跨会话缓存读取 ≥2 处（状态栏命令 + 新建向导）', loadCalls >= 2, loadCalls, '>=2');
const saveCalls = (ext.match(/saveDetectCache\(/g) || []).length;
check('A6 探测结果落缓存 ≥2 处（状态栏命令 + 新建向导）', saveCalls >= 2, saveCalls, '>=2');
check('A7 向导路径含快速失败容错（catch 回退空列表，非恒真断言）', /catch\s*\{\s*detected = \[\]/.test(ext), null);

// ---- 3. pickCompiler 源码区段内无同步探测 ----
{
  const start = ext.indexOf('async function pickCompiler');
  check('B1 pickCompiler 存在', start >= 0, start);
  const next = ext.indexOf('\nasync function ', start + 10);
  const region = ext.slice(start, next > 0 ? next : start + 4000);
  check('B2 pickCompiler 区段含 detectAllCompilersAsync', region.includes('detectAllCompilersAsync'), null);
  check('B3 pickCompiler 区段含 loadDetectCache 预填', region.includes('loadDetectCache'), null);
  check('B4 pickCompiler 区段无同步 detectAllCompilers 调用', !region.includes('detectAllCompilers('), null);
  check('B5 pickCompiler 区段含后台刷新（.then(saveDetectCache 链路）', /\.then\(/.test(region) && region.includes('saveDetectCache'), null);
}

// ---- 4. detector 模块 API 兼容（同步保留、异步导出） ----
{
  const det = fs.readFileSync(path.resolve(__dirname, '../dist/compiler/detector.js'), 'utf8');
  check('C1 detector 保留同步 detectAllCompilers（其他调用/测试兼容）', det.includes('function detectAllCompilers'), null);
  check('C2 detector 导出异步 detectAllCompilersAsync', det.includes('function detectAllCompilersAsync'), null);
}

console.log(`\nwizard-detect-async: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
