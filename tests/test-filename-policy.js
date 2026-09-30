// 验证 Q1：库输出文件名生成对齐 SetupOutputFilenames（compilercommandgenerator.cpp:648）
// 覆盖 prefix_auto / extension_auto 策略、Windows 大小写不敏感、multi-dot 全名追加
const path = require('path');
const { computeLibOutput, computeStaticOutput } = require('../dist/compiler/commandGenerator.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const win = process.platform === 'win32';

// 1. 默认策略：无前缀无扩展 → lib 前缀 + .a
check('default prefix+ext', computeLibOutput('bin/foo', 'lib', 'a') === 'bin' + path.sep + 'libfoo.a');
// 2. 已有 lib 前缀不重复加
check('existing prefix', computeLibOutput('bin/libfoo', 'lib', 'a') === 'bin' + path.sep + 'libfoo.a');
// 3. prefix_auto=0：不加 lib 前缀，扩展仍追加
check('prefix off', computeLibOutput('bin/foo', 'lib', 'a', false, true) === 'bin' + path.sep + 'foo.a');
// 4. extension_auto=0：扩展不动（已有 .a 保留，无扩展就不加）
check('ext off (has .a)', computeLibOutput('bin/libfoo.a', 'lib', 'a', true, false) === 'bin' + path.sep + 'libfoo.a');
check('ext off (no ext)', computeLibOutput('bin/libfoo', 'lib', 'a', true, false) === 'bin' + path.sep + 'libfoo');
// 5. multi-dot：foo.d → libfoo.d.a（对齐 CB SetFullName 追加，不丢中间扩展名）
check('multi-dot append', computeLibOutput('bin/foo.d', 'lib', 'a') === 'bin' + path.sep + 'libfoo.d.a');
// 6. 扩展名大小写：Windows 不敏感（.A 不追加），Linux 敏感（追加 .a）
const caseOut = computeLibOutput('bin/libfoo.A', 'lib', 'a');
check('ext case', win ? caseOut === 'bin' + path.sep + 'libfoo.A' : caseOut === 'bin' + path.sep + 'libfoo.A.a');
// 7. computeStaticOutput 透传策略
check('static passthrough', computeStaticOutput('bin/foo', { libPrefix: 'lib', libExtension: 'a' }, false, false) === 'bin' + path.sep + 'foo');

console.log(`test-filename-policy: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
