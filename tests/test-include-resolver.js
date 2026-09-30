// 验证第三轮 R11：#include 指令解析与搜索顺序（当前文件目录 → include 目录）
const path = require('path');
const { parseIncludeDirective, resolveIncludePath } = require('../dist/tools/includeResolver.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

check('引号形式', JSON.stringify(parseIncludeDirective('  #include "util.h" // x')) === JSON.stringify({ name: 'util.h', quoted: true }), parseIncludeDirective('  #include "util.h" // x'));
check('尖括号形式', JSON.stringify(parseIncludeDirective('#include <sys/types.h>')) === JSON.stringify({ name: 'sys/types.h', quoted: false }), parseIncludeDirective('#include <sys/types.h>'));
check('# include 带空格', JSON.stringify(parseIncludeDirective('#  include   "a b.h"')) === JSON.stringify({ name: 'a b.h', quoted: true }), parseIncludeDirective('#  include   "a b.h"'));
check('非 include 行 → undefined', parseIncludeDirective('int x = 1;') === undefined, parseIncludeDirective('int x = 1;'));
check('空名 → undefined', parseIncludeDirective('#include <>') === undefined, parseIncludeDirective('#include <>'));

const F = path.resolve('/proj/src');
const I1 = path.resolve('/proj/inc');
const I2 = path.resolve('/libs');
const existing = new Set([
  path.resolve(I1, 'util.h'),
  path.resolve(I2, 'util.h'),
  path.resolve(F, 'sys.h'),
]);

// 引号：当前文件目录优先
let hit = resolveIncludePath({ name: 'sys.h', quoted: true }, F, [I1, I2], (p) => existing.has(p));
check('引号：当前目录命中', hit === path.resolve(F, 'sys.h'), hit);
// 引号：当前目录未命中 → include 目录（第一个命中）
hit = resolveIncludePath({ name: 'util.h', quoted: true }, F, [I1, I2], (p) => existing.has(p));
check('引号：回退 include 目录（首个命中）', hit === path.resolve(I1, 'util.h'), hit);
// 尖括号：跳过当前目录（即使存在同名——此处 sys.h 仅当前目录有 → 未找到）
hit = resolveIncludePath({ name: 'sys.h', quoted: false }, F, [I1, I2], (p) => existing.has(p));
check('尖括号：不查当前文件目录', hit === undefined, hit);
// 未找到
check('未找到 → undefined', resolveIncludePath({ name: 'nope.h', quoted: true }, F, [I1], (p) => existing.has(p)) === undefined, true);
// 相对路径名（含 /）归一
const only = new Set([path.resolve(I1, 'sub', 'deep.h')]);
check('名称含 / 归一', resolveIncludePath({ name: 'sub/deep.h', quoted: false }, F, [I1], (p) => only.has(p)) === path.resolve(I1, 'sub', 'deep.h'), true);
// 去重（同一目录重复出现只查一次）
let calls = 0;
resolveIncludePath({ name: 'x.h', quoted: true }, F, [I1, I1], () => { calls++; return false; });
check('目录去重（当前目录 + 重复目录 = 2 次探测）', calls === 2, calls);

console.log(`include 解析: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
