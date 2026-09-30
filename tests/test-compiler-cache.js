// P6 回归：编译器实例缓存工具（buildCompilerCacheKey / BoundedMap）+ extension 接线静态断言
const fs = require('fs');
const path = require('path');
const { buildCompilerCacheKey, BoundedMap } = require(path.resolve(__dirname, '../dist/compiler/compilerCache.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

// ---- 1. 缓存键 ----
{
  const base = buildCompilerCacheKey('gcc', 'D:/MinGW', { C: 'gcc.exe', CPP: 'g++.exe' });
  check('A1 同输入 → 同键（稳定）',
    base === buildCompilerCacheKey('gcc', 'D:/MinGW', { C: 'gcc.exe', CPP: 'g++.exe' }), 'n/a', base);
  check('A2 不同编译器 ID → 不同键', base !== buildCompilerCacheKey('clang', 'D:/MinGW', { C: 'gcc.exe' }), null);
  check('A3 不同 masterPath → 不同键', base !== buildCompilerCacheKey('gcc', 'E:/Other', { C: 'gcc.exe' }), null);
  check('A4 compilerPrograms 值变化 → 不同键',
    base !== buildCompilerCacheKey('gcc', 'D:/MinGW', { C: 'gcc-13.exe', CPP: 'g++.exe' }), null);
  check('A5 undefined 与 {} 视为同一档（空程序表）',
    buildCompilerCacheKey('gcc', '', undefined) === buildCompilerCacheKey('gcc', '', {}), null);
  check('A6 循环引用对象不抛异常（退化为空段）',
    (() => {
      const o = { C: 'gcc' };
      o.self = o;
      return typeof buildCompilerCacheKey('gcc', '', o) === 'string';
    })());
  check('A7 键含全部三段（id/masterPath/programs）', base.split('\u0000').length === 3, base.split('\u0000').length, 3);
}

// ---- 2. BoundedMap ----
{
  const m = new BoundedMap(3);
  m.set('a', 1); m.set('b', 2); m.set('c', 3);
  check('B1 get 命中', m.get('b') === 2, m.get('b'), 2);
  check('B2 达到上限不误删', m.size === 3, m.size, 3);
  m.set('d', 4); // 淘汰最旧 a
  check('B3 超限 FIFO 淘汰最旧键', m.get('a') === undefined && m.get('d') === 4 && m.size === 3, { a: m.get('a'), size: m.size }, 'evict a');
  m.set('d', 5); // 覆盖已有键不增长
  check('B4 覆盖已有键不增长', m.size === 3 && m.get('d') === 5, { size: m.size, d: m.get('d') }, 5);
  m.clear();
  check('B5 clear 清空', m.size === 0 && m.get('d') === undefined, m.size, 0);
  const tiny = new BoundedMap(0); // 钳制为 1
  tiny.set('x', 1); tiny.set('y', 2);
  check('B6 上限钳制（0 → 1）', tiny.size === 1 && tiny.get('x') === undefined && tiny.get('y') === 2, tiny.size, 1);
}

// ---- 3. extension 接线静态断言（getCompiler 走缓存） ----
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('C1 dist 使用 buildCompilerCacheKey', ext.includes('buildCompilerCacheKey'), null);
check('C2 dist 含 compilerResultCache 缓存实例', ext.includes('compilerResultCache'), null);
check('C3 dist 含无缓存构建函数 buildCompilerInstance', ext.includes('buildCompilerInstance'), null);
check('C4 dist 缓存命中早退（compilerResultCache.get）', /compilerResultCache\.get\(/.test(ext), null);
check('C5 dist 缓存键调用含 compilerPrograms（精确形态，非宽泛断言）',
  /buildCompilerCacheKey\)\(id, masterPath, cfg\.get\('compilerPrograms'/.test(ext), null);

console.log(`\ncompiler-cache: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
