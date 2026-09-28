// 第六轮 F1 回归：构建结束 Build Log 聚焦决策（纯模块）+ 接线静态断言
//  - normalizeBuildLogAutoFocusMode：4 合法值直通；非法/缺省 → 'errors'（对齐 CB 默认策略）
//  - shouldAutoFocusBuildLog / maybeAutoFocusBuildLog 矩阵（errors/errorsAndWarnings/always/never）
//  - 接线：dist/extension.js 读取三项新设置；首个错误跳转 gotoFirstError；失败 toast 受 quietFailure 门控
const fs = require('fs');
const path = require('path');
const {
  normalizeBuildLogAutoFocusMode,
  shouldAutoFocusBuildLog,
  maybeAutoFocusBuildLog,
  BUILD_LOG_AUTO_FOCUS_DEFAULT,
} = require(path.resolve(__dirname, '../dist/ui/buildLogFocus.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

check('默认常量 = errors（对齐 CB）', BUILD_LOG_AUTO_FOCUS_DEFAULT === 'errors', BUILD_LOG_AUTO_FOCUS_DEFAULT);

for (const v of ['errors', 'errorsAndWarnings', 'always', 'never']) {
  check('合法值直通: ' + v, normalizeBuildLogAutoFocusMode(v) === v, normalizeBuildLogAutoFocusMode(v));
}
for (const v of ['bogus', undefined, null, 123, true]) {
  check('非法值回退 errors: ' + String(v), normalizeBuildLogAutoFocusMode(v) === 'errors', normalizeBuildLogAutoFocusMode(v));
}

// should 判定矩阵
const cases = [
  ['errors', 0, 0, false], ['errors', 1, 0, true], ['errors', 0, 3, false],
  ['errorsAndWarnings', 0, 0, false], ['errorsAndWarnings', 0, 1, true], ['errorsAndWarnings', 1, 0, true],
  ['always', 0, 0, true], ['always', 2, 3, true],
  ['never', 5, 9, false],
];
for (const [mode, e, w, want] of cases) {
  check(`should(${mode}, e=${e}, w=${w}) = ${want}`, shouldAutoFocusBuildLog(mode, e, w) === want, shouldAutoFocusBuildLog(mode, e, w));
}

// maybe：注入回调的真实调用行为
let calls = 0;
const spy = () => { calls++; };
check('maybe 未命中：不回调且返回 false', maybeAutoFocusBuildLog('errors', 0, 0, spy) === false && calls === 0, { calls });
calls = 0;
check('maybe 命中：回调恰一次且返回 true', maybeAutoFocusBuildLog('errors', 1, 0, spy) === true && calls === 1, { calls });
calls = 0;
check('maybe never：不回调', maybeAutoFocusBuildLog('never', 3, 3, spy) === false && calls === 0, { calls });
calls = 0;
check('maybe always+warnings：回调', maybeAutoFocusBuildLog('always', 0, 2, spy) === true && calls === 1, { calls });

// 接线静态断言（dist 编译后形态）
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('接线：读取 ui.buildLogAutoFocus', ext.includes("'ui.buildLogAutoFocus'"), null);
check('接线：读取 ui.buildLogFocusFirstError', ext.includes("'ui.buildLogFocusFirstError'"), null);
check('接线：读取 ui.quietFailure', ext.includes("'ui.quietFailure'"), null);
check('接线：首个错误跳转调用 gotoFirstError', ext.includes('gotoFirstError'), null);
check('接线：失败 toast 受 quietFailure 门控', /if \(!quietFailure\(\)\)[\s\S]{0,200}showErrorMessage/.test(ext), null);
check('接线：finishBuildSummary 经 maybeAutoFocusBuildLog 聚焦', ext.includes('maybeAutoFocusBuildLog'), null);
const provider = fs.readFileSync(path.resolve(__dirname, '../dist/ui/buildLogTreeProvider.js'), 'utf8');
check('接线：provider 实现 gotoFirstError', provider.includes('gotoFirstError'), null);

console.log(`Build Log 聚焦回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
