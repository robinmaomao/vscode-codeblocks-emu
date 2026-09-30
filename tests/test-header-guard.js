// 头文件保护生成回归（第一波 D1）
const { headerGuardMacro, hasHeaderGuard, applyHeaderGuard } = require('../dist/tools/headerGuard.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

check('宏生成：常规文件名', headerGuardMacro('E:\\proj\\my_file.h') === '__MY_FILE_H__', headerGuardMacro('E:\\proj\\my_file.h'));
check('宏生成：短横/多点', headerGuardMacro('/x/my-file.test.hpp') === '__MY_FILE_TEST_H__', headerGuardMacro('/x/my-file.test.hpp'));
check('宏生成：数字开头', headerGuardMacro('a1b.c.h') === '__A1B_C_H__', headerGuardMacro('a1b.c.h'));

check('已有保护：#ifndef', hasHeaderGuard('#ifndef X\n#define X\n#endif') === true);
check('已有保护：#pragma once（缩进/大小写）', hasHeaderGuard('// c\n  #Pragma once\n') === true);
check('无保护', hasHeaderGuard('int x;\n') === false);

const wrapped = applyHeaderGuard('C:\\p\\util.h', 'int add(int a, int b);\n');
check('包装：顶部/底部完整', wrapped === '#ifndef __UTIL_H__\n#define __UTIL_H__\n\nint add(int a, int b);\n\n#endif // __UTIL_H__\n', wrapped);
check('幂等：已有保护返回 null', applyHeaderGuard('x.h', wrapped) === null, null);
check('空文件', applyHeaderGuard('a.h', '') === '#ifndef __A_H__\n#define __A_H__\n\n#endif // __A_H__\n', applyHeaderGuard('a.h', ''));
check('CRLF 跟随', applyHeaderGuard('b.h', 'int x;\r\n').includes('#ifndef __B_H__\r\n#define __B_H__\r\n\r\n'), true);

// pragma-once 风格（设置 editor.headerGuardStyle）
const po = applyHeaderGuard('C:\\p\\util.h', 'int x;\n', 'pragma-once');
check('pragma-once 风格', po === '#pragma once\n\nint x;\n', po);
check('pragma-once 空文件', applyHeaderGuard('a.h', '', 'pragma-once') === '#pragma once\n', null);
check('pragma-once 幂等（已有保护返回 null）', applyHeaderGuard('a.h', po, 'pragma-once') === null, null);

console.log(`头文件保护: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
