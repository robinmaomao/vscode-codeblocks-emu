// 验证第三轮 R10：书签纯逻辑（切换/排序/前后跳转/行漂移回找/清空）
const {
  toggleBookmark, sortedBookmarks, nextBookmark, prevBookmark, locateBookmarkLine, clearFileBookmarks, bmKey,
} = require('../dist/tools/bookmarks.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

let list = [];
let r = toggleBookmark(list, 'C:\\a\\one.c', 10, '  int x;  ');
list = r.list;
check('添加书签（文本 trim）', r.added === true && list.length === 1 && list[0].text === 'int x;', list);
r = toggleBookmark(list, 'C:\\A\\ONE.C', 10, 'int x;');
list = r.list;
check('同行（大小写不敏感）再次切换 → 移除', r.added === false && list.length === 0, list);

list = [
  { file: 'b.c', line: 2, text: '' },
  { file: 'a.c', line: 9, text: '' },
  { file: 'a.c', line: 3, text: '' },
];
const sorted = sortedBookmarks(list);
check('排序：文件→行', JSON.stringify(sorted.map((b) => b.file + ':' + b.line)) === JSON.stringify(['a.c:3', 'a.c:9', 'b.c:2']), sorted);

check('next：同文件向后', nextBookmark(list, 'a.c', 3).line === 9, nextBookmark(list, 'a.c', 3));
check('next：跨文件', nextBookmark(list, 'a.c', 9).file === 'b.c', nextBookmark(list, 'a.c', 9));
check('next：末尾回绕首项', nextBookmark(list, 'b.c', 2).file === 'a.c' && nextBookmark(list, 'b.c', 2).line === 3, nextBookmark(list, 'b.c', 2));
check('prev：同文件向前', prevBookmark(list, 'a.c', 9).line === 3, prevBookmark(list, 'a.c', 9));
check('prev：首项回绕末项', prevBookmark(list, 'a.c', 3).file === 'b.c' && prevBookmark(list, 'a.c', 3).line === 2, prevBookmark(list, 'a.c', 3));
check('空表 → undefined', nextBookmark([], 'a.c', 1) === undefined && prevBookmark([], 'a.c', 1) === undefined, true);

const lines = ['#include <a>', 'int main() {', '  return 0;', '}'];
check('行漂移：精确命中', locateBookmarkLine({ file: 'x', line: 3, text: 'return 0;' }, lines) === 3, locateBookmarkLine({ file: 'x', line: 3, text: 'return 0;' }, lines));
check('行漂移：下移回找', locateBookmarkLine({ file: 'x', line: 1, text: 'return 0;' }, lines) === 3, locateBookmarkLine({ file: 'x', line: 1, text: 'return 0;' }, lines));
check('行漂移：找不到 → 原行（限幅）', locateBookmarkLine({ file: 'x', line: 99, text: 'nope' }, lines) === 4, locateBookmarkLine({ file: 'x', line: 99, text: 'nope' }, lines));

const cleared = clearFileBookmarks(list, 'A.C');
check('清空单文件（大小写不敏感）', cleared.length === 1 && cleared[0].file === 'b.c', cleared);
check('bmKey 规范化', bmKey('C:\\X\\F.C', 5) === 'c:\\x\\f.c#5', bmKey('C:\\X\\F.C', 5));

console.log(`书签逻辑: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
