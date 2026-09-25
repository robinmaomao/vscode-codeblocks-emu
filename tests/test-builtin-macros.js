// 验证第25轮 M2/M3：补齐内置宏（AMP/CMD_*/PLATFORM/TARGET_COMPILER_DIR/WORKSPACE_*/DATA-PATH）+ 函数式宏（TO_ABSOLUTE_PATH/TO_83_PATH/REMOVE_QUOTES）
const { cbBuiltinVars, replaceCbMacros, resetGlobalVariables } = require('../dist/compiler/cbMacros.js');
const { buildMacroVars } = require('../dist/build/scriptRunner.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

resetGlobalVariables();
const vars = cbBuiltinVars('C:\\proj', 'bin\\Debug\\app', 'Debug', 'obj\\Debug\\', 'proj', 'C:\\proj\\proj.cbp', 'E:\\gcc');
check('AMP', vars.AMP === '&', vars.AMP, '&');
check('PLATFORM', vars.PLATFORM === 'msw', vars.PLATFORM, 'msw');
check('CMD_CP', vars.CMD_CP === 'cmd /c copy', vars.CMD_CP, 'cmd /c copy');
check('CMD_NULL', vars.CMD_NULL === 'NUL', vars.CMD_NULL, 'NUL');
check('CMD_RMDIR', vars.CMD_RMDIR === 'cmd /c rd', vars.CMD_RMDIR, 'cmd /c rd');
check('DATA-PATH 变体', vars['DATA-PATH'] === vars.DATA_PATH && vars.DATAPATH === vars.DATA_PATH, vars.DATAPATH, vars.DATA_PATH);
check('TARGET_COMPILER_DIR', vars.TARGET_COMPILER_DIR === 'E:\\gcc\\', vars.TARGET_COMPILER_DIR, 'E:\\gcc\\');

const mv = buildMacroVars('C:\\proj', 'bin\\Debug\\app', 'Debug', 'obj\\Debug\\', 'proj', 'C:\\proj\\proj.cbp', 'E:\\gcc');
check('buildMacroVars AMP', mv.AMP === '&', mv.AMP, '&');
check('buildMacroVars CMD_CP', mv.CMD_CP === 'cmd /c copy', mv.CMD_CP, 'cmd /c copy');
check('buildMacroVars TARGET_COMPILER_DIR', mv.TARGET_COMPILER_DIR === 'E:\\gcc\\', mv.TARGET_COMPILER_DIR, 'E:\\gcc\\');

// M3 函数式宏
const opts = { vars, basePath: 'C:\\proj' };
check('TO_ABSOLUTE_PATH', replaceCbMacros('$TO_ABSOLUTE_PATH{src/x.c}', opts) === 'C:\\proj\\src\\x.c', replaceCbMacros('$TO_ABSOLUTE_PATH{src/x.c}', opts), 'C:\\proj\\src\\x.c');
check('REMOVE_QUOTES 剥引号', replaceCbMacros('$REMOVE_QUOTES{"a b"}', opts) === 'a b', replaceCbMacros('$REMOVE_QUOTES{"a b"}', opts), 'a b');
check('REMOVE_QUOTES 内宏展开', replaceCbMacros('$REMOVE_QUOTES{"$(AMP)x"}', opts) === '&x', replaceCbMacros('$REMOVE_QUOTES{"$(AMP)x"}', opts), '&x');

console.log(`内置宏 + 函数式宏: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
