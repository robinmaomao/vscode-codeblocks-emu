// GDB 定位优先级回归（第五十轮 D9）：
//  - codeblocks.debug.gdbPath（文件 / 目录）> masterPath/bin > PATH
//  - 均不存在返回 undefined；POSIX 使用无扩展名 gdb
const path = require('path');
const { resolveGdbPath } = require('../dist/debug/gdbLocate.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const isWin = process.platform === 'win32';
const name = isWin ? 'gdb.exe' : 'gdb';
const existsOf = (set) => (p) => set.includes(p);

// 1) 显式设置指向文件本身 → 直用
const s1 = resolveGdbPath({ settingPath: 'D:\\Tools\\gdb.exe', exists: existsOf(['D:\\Tools\\gdb.exe']) });
check('gdbPath=文件 → 直用', s1 === 'D:\\Tools\\gdb.exe', s1, 'D:\\Tools\\gdb.exe');

// 2) 显式设置为目录 → 目录/bin/gdb
const s2 = resolveGdbPath({ settingPath: 'E:\\MinGW', exists: existsOf([path.join('E:\\MinGW', 'bin', name)]) });
check('gdbPath=目录 → 目录/bin/gdb', s2 === path.join('E:\\MinGW', 'bin', name), s2, path.join('E:\\MinGW', 'bin', name));

// 3) 仅 masterPath 存在 → masterPath/bin/gdb
const s3 = resolveGdbPath({ masterPath: 'D:\\Program Files\\mingw64', exists: existsOf([path.join('D:\\Program Files\\mingw64', 'bin', name)]) });
check('masterPath/bin 命中', s3 === path.join('D:\\Program Files\\mingw64', 'bin', name), s3, path.join('D:\\Program Files\\mingw64', 'bin', name));

// 4) 仅 PATH 存在 → PATH 首个命中
const p1 = path.join('C:\\a', name);
const p2 = path.join('C:\\b', name);
const s4 = resolveGdbPath({ pathEnv: 'C:\\a;C:\\b', exists: existsOf([p1, p2]) });
check('PATH 扫描取首个命中', s4 === p1, s4, p1);

// 5) 优先级：设置 > masterPath > PATH
const s5 = resolveGdbPath({
  settingPath: 'D:\\Tools\\gdb.exe',
  masterPath: 'D:\\mingw64',
  pathEnv: 'C:\\a',
  exists: existsOf(['D:\\Tools\\gdb.exe', path.join('D:\\mingw64', 'bin', name), p1]),
});
check('优先级：gdbPath 最优先', s5 === 'D:\\Tools\\gdb.exe', s5, 'D:\\Tools\\gdb.exe');

// 6) 全部不存在 → undefined
const s6 = resolveGdbPath({ settingPath: 'X:\\nope', masterPath: 'Y:\\nope', pathEnv: 'Z:\\nope', exists: () => false });
check('均不存在 → undefined', s6 === undefined, s6, undefined);

// 7) 设置为空串不产生候选（不把空路径当文件）
const s7 = resolveGdbPath({ settingPath: '  ', pathEnv: '', exists: () => true });
check('空设置串被忽略', s7 === undefined, s7, undefined);

console.log(`GDB 定位回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
