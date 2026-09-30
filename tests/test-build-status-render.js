// P5 回归：构建状态栏按需渲染状态机（nextBuildSpinRender）+ extension 接线静态断言
const fs = require('fs');
const path = require('path');
const { nextBuildSpinRender } = require(path.resolve(__dirname, '../dist/ui/buildStatusRender.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

// ---- 状态迁移矩阵 ----
check('A1 首次渲染（prev=undefined）强制输出', nextBuildSpinRender(undefined, false, 0) === 'idle', nextBuildSpinRender(undefined, false, 0));
check('A2 空闲 → 空闲：跳过渲染（undefined）', nextBuildSpinRender('idle', false, 0) === undefined, nextBuildSpinRender('idle', false, 0));
check('A3 空闲 → 构建 0s：渲染 0', nextBuildSpinRender('idle', true, 0) === 0, nextBuildSpinRender('idle', true, 0));
check('A4 构建 0s → 构建 0.9s：跳过（同秒）', nextBuildSpinRender(0, true, 0.9) === undefined, nextBuildSpinRender(0, true, 0.9));
check('A5 构建 0s → 构建 1.0s：渲染 1', nextBuildSpinRender(0, true, 1.0) === 1, nextBuildSpinRender(0, true, 1.0));
check('A6 构建 3s → 结束：渲染 idle', nextBuildSpinRender(3, false, 0) === 'idle', nextBuildSpinRender(3, false, 0));
check('A7 构建 2.7s（首次）：floor 到 2', nextBuildSpinRender(undefined, true, 2.7) === 2, nextBuildSpinRender(undefined, true, 2.7));
check('A8 负数耗时钳制为 0', nextBuildSpinRender(undefined, true, -5) === 0, nextBuildSpinRender(undefined, true, -5));
check('A9 构建 5s → 构建 5s：跳过', nextBuildSpinRender(5, true, 5.4) === undefined, nextBuildSpinRender(5, true, 5.4));
check('A10 idle 渲染后再次 idle：跳过', nextBuildSpinRender('idle', false, 0) === undefined, undefined);

// ---- extension 接线静态断言 ----
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('B1 dist 使用 nextBuildSpinRender', ext.includes('nextBuildSpinRender'), null);
check('B2 dist 状态机变量 spinRendered 已接入', ext.includes('spinRendered'), null);
check('B3 dist 未删除 spinTimer 清理（dispose clearInterval）', ext.includes('clearInterval(spinTimer)'), null);
check('B4 dist 空闲分支仍设置 Build 菜单命令（状态迁移时）', ext.includes("'codeblocks.build.menu'"), null);

console.log(`\nbuild-status-render: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
