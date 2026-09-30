// P1 回归：书签行漂移定位（locateBookmarkLineInDocument 按需取行）+ extension 接线静态断言
//  - 纯函数语义与旧 locateBookmarkLine（整行数组）一致
//  - LineSource 只按需读取：本测试用"访问计数"验证仅读取 ±radius 窗口内的行（不整文档拆分）
const fs = require('fs');
const path = require('path');
const { locateBookmarkLineInDocument, locateBookmarkLine } = require(path.resolve(__dirname, '../dist/tools/bookmarks.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

/** 构造带访问计数的 LineSource */
function makeSource(lines) {
  const accessed = [];
  return {
    accessed,
    lineCount: lines.length,
    lineAt(i) {
      if (i < 0 || i >= lines.length) throw new Error('out of range');
      accessed.push(i);
      return { text: lines[i] };
    },
  };
}

// ---- 1. 精确命中 ----
{
  const src = makeSource(['void a();', 'int main() {', '  return 0;', '}']);
  const bm = { file: 'x.c', line: 2, text: 'int main() {' };
  check('A1 精确行号命中', locateBookmarkLineInDocument(bm, src) === 2, 'n/a', 2);
}

// ---- 2. 行漂移：向上 ----
{
  const lines = ['a', 'b', 'TARGET', 'c', 'd', 'e'];
  const src = makeSource(lines);
  const bm = { file: 'x.c', line: 5, text: 'TARGET' }; // 原第 3 行，现记录为第 5 行
  check('A2 向上回找（-2 行）', locateBookmarkLineInDocument(bm, src) === 3, 'n/a', 3);
}

// ---- 3. 行漂移：向下 ----
{
  const lines = ['a', 'b', 'c', 'd', 'TARGET', 'e'];
  const src = makeSource(lines);
  const bm = { file: 'x.c', line: 2, text: 'TARGET' }; // 原第 5 行，记录为第 2 行
  check('A3 向下回找（+3 行）', locateBookmarkLineInDocument(bm, src) === 5, 'n/a', 5);
}

// ---- 4. 半径边界：+radius 命中 / +radius+1 不命中（回退原行） ----
{
  const lines = new Array(200).fill('x');
  lines[150] = 'TARGET';
  const src = makeSource(lines);
  const bmNear = { file: 'x.c', line: 101, text: 'TARGET' }; // 差 50（=radius）
  check('A4 半径边界内命中（±50）', locateBookmarkLineInDocument(bmNear, src) === 151, 'n/a', 151);
  const src2 = makeSource(lines);
  const bmFar = { file: 'x.c', line: 100, text: 'TARGET' }; // 差 51 → 不命中
  check('A5 半径外不命中 → 回退原行号', locateBookmarkLineInDocument(bmFar, src2) === 100, 'n/a', 100);
}

// ---- 5. 未找到 → clamp 回退 ----
{
  const lines = ['a', 'b', 'c'];
  check('A6 未找到 → 原行号（范围内）', locateBookmarkLineInDocument({ file: 'x', line: 2, text: 'zzz' }, makeSource(lines)) === 2);
  check('A7 行号越界 → clamp 到 lineCount',
    locateBookmarkLineInDocument({ file: 'x', line: 99, text: 'zzz' }, makeSource(lines)) === 3, 'n/a', 3);
  check('A8 空文档 → 返回 1',
    locateBookmarkLineInDocument({ file: 'x', line: 5, text: 'zzz' }, makeSource([])) === 1, 'n/a', 1);
}

// ---- 6. 只读窗口：访问行数 ≤ 2*radius+1（不整文档） ----
{
  const lines = new Array(5000).fill('x');
  lines[2500] = 'TARGET';
  const src = makeSource(lines);
  const bm = { file: 'x.c', line: 2501, text: 'TARGET' };
  locateBookmarkLineInDocument(bm, src);
  check('A9 5000 行文档只读 1 行（精确命中即停）', src.accessed.length === 1, src.accessed.length, 1);

  const src2 = makeSource(lines.map((l, i) => (i === 2600 ? 'OTHER' : 'x')));
  locateBookmarkLineInDocument({ file: 'x.c', line: 2501, text: 'OTHER' }, src2, 200);
  check('A10 未命中时访问行数 ≤ 2*radius+1（不整文档拆分）', src2.accessed.length <= 2 * 200 + 1, src2.accessed.length, '<=401');
}

// ---- 7. lineAt 抛异常的行按空文本处理（不中断） ----
{
  let calls = 0;
  const src = {
    lineCount: 5,
    lineAt(i) {
      calls++;
      if (i === 2) throw new Error('boom');
      return { text: i === 4 ? 'TARGET' : 'x' };
    },
  };
  const ln = locateBookmarkLineInDocument({ file: 'x', line: 3, text: 'TARGET' }, src, 10);
  check('A11 lineAt 异常行按空文本跳过，继续向下命中', ln === 5 && calls >= 4, { ln, calls }, 'ln=5');
}

// ---- 8. 旧 API（整行数组）与文档版语义一致 ----
{
  const lines = ['a', 'b', 'TARGET', 'd'];
  const bm = { file: 'x', line: 4, text: 'TARGET' };
  check('A12 旧 locateBookmarkLine 兼容（结果一致）',
    locateBookmarkLine(bm, [...lines]) === locateBookmarkLineInDocument(bm, makeSource(lines)),
    'n/a', 3);
}

// ---- 9. extension 接线静态断言（P1：热路径不再整文档 split） ----
const extPath = path.resolve(__dirname, '../dist/extension.js');
const ext = fs.readFileSync(extPath, 'utf8');
check('B1 dist 使用 locateBookmarkLineInDocument', ext.includes('locateBookmarkLineInDocument'), null);
check('B2 dist 无整文档 getText().split 热路径残留', !ext.includes('.getText().split(/\\r?\\n/)'), null);
check('B3 dist 含空书签早退标记（bookmarkDecoratedDocs WeakSet）', ext.includes('bookmarkDecoratedDocs'), null);

console.log(`\nbookmark-locate: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
