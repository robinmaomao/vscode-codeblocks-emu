// 验证构建取消源 BuildCancelSource（编译随时停止的基石）
// 直接加载编译产物 dist/build/cancelToken.js（无 vscode 依赖）
const { BuildCancelSource } = require('../dist/build/cancelToken.js');

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('✓ ' + name); }
  else { fail++; console.log('✗ ' + name); }
}

// 1. 初始未取消
const src = new BuildCancelSource();
check('初始未取消', src.isCancelled() === false);

// 2. 注册/注销（pid 为 undefined 的假进程，避免真实 taskkill 派生）
const fakeA = { pid: undefined };
src.register(fakeA);
src.unregister(fakeA);
check('注册注销后仍未取消', src.isCancelled() === false);

// 3. cancel 置位 + 幂等（第二次 cancel 不抛异常）
src.cancel();
check('cancel 后置位', src.isCancelled() === true);
let idem = true;
try { src.cancel(); } catch { idem = false; }
check('cancel 幂等不抛异常', idem);

// 4. 取消后 register 的竞态防御：新进程立即走强杀路径（pid undefined 安全短路），不抛异常
const fakeB = { pid: undefined };
let late = true;
try { src.register(fakeB); } catch { late = false; }
check('取消后 register 不抛异常', late);
check('取消后 register 不改写取消态', src.isCancelled() === true);

// 5. 独立取消源互不影响
const src2 = new BuildCancelSource();
check('独立取消源互不影响', src2.isCancelled() === false);

// 6. 活动进程存在时 cancel 不抛异常（强杀路径 pid undefined 安全短路）
const src3 = new BuildCancelSource();
src3.register({ pid: undefined });
src3.register({ pid: undefined });
let killSafe = true;
try { src3.cancel(); } catch { killSafe = false; }
check('活动进程下 cancel 不抛异常', killSafe && src3.isCancelled() === true);

// 7. G2：deactivate() 接线——关闭/重载窗口时取消进行中的构建（静态断言）
{
  const fs = require('fs');
  const path = require('path');
  const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
  const start = ext.indexOf('function deactivate');
  check('G2-1 dist 含 deactivate 定义', start >= 0);
  const region = start >= 0 ? ext.slice(start, start + 800) : '';
  check('G2-2 deactivate 调用 currentBuildCancel?.cancel()', region.includes('currentBuildCancel?.cancel()'));
  const iCancel = region.indexOf('currentBuildCancel?.cancel()');
  const iDispose = region.indexOf('outputChannel.dispose()');
  check('G2-3 取消先于资源销毁（无构建时零副作用）', iCancel >= 0 && iDispose >= 0 && iCancel < iDispose);
  check('G2-4 deactivate 仍销毁输出通道与诊断集合（行为不回归）',
    region.includes('outputChannel.dispose()') && region.includes('diagnosticCollection.dispose()'));
}

console.log('汇总: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
