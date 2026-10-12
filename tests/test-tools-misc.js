// 工具类模块回归（此前无测试引用）：compiler/posixRegex（wxRegEx → JS 正则转换）、
// tools/windowsPath（注册表 PATH 读取与缓存语义）、tools/codeStats（代码行统计）。
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

// ---------- A. convertPosixRegex ----------
const { convertPosixRegex } = require('../dist/compiler/posixRegex.js');
check('A1 [:blank:] → 空格/Tab', convertPosixRegex('a[:blank:]b') === 'a \\tb', convertPosixRegex('a[:blank:]b'));
check('A2 [:alnum:] → 拓宽到非 ASCII（CJK 路径不截断）',
  convertPosixRegex('[:alnum:]').includes('\\u0080-\\uFFFF') && convertPosixRegex('[:alnum:]').startsWith('A-Za-z0-9'),
  convertPosixRegex('[:alnum:]'));
check('A3 字符类开头的 ] 转义为 \\]（wxRegEx 语义）',
  convertPosixRegex('[]{}') === '[\\]{}', convertPosixRegex('[]{}'));
check('A4 普通正则原样返回', convertPosixRegex('^error: (.*)$') === '^error: (.*)$', convertPosixRegex('^error: (.*)$'));
check('A5 嵌套 POSIX 类（CB XML 用法 [[:alnum:]]）转换后可用且匹配中文文件名',
  (() => {
    const converted = convertPosixRegex('([[:alnum:]]+):([0-9]+):');
    if (!converted.startsWith('([A-Za-z0-9')) return false;
    return new RegExp(converted).test('中文文件名:12:');
  })(), (() => { const c = convertPosixRegex('([[:alnum:]]+):([0-9]+):'); return { converted: c, test: new RegExp(c).test('中文文件名:12:') }; })());
check('A6 复合字符类（CB options_common_re.xml 用法）转换后仍有方括号',
  /^\[.*\]\+$/.test(convertPosixRegex('[][{}() \\t#%$~[:alnum:]!&_:+/\\.]+')),
  convertPosixRegex('[][{}() \\t#%$~[:alnum:]!&_:+/\\.]+'));

// ---------- B. getWindowsSystemPath ----------
const { getWindowsSystemPath } = require('../dist/tools/windowsPath.js');
if (process.platform === 'win32') {
  const p1 = getWindowsSystemPath();
  const p2 = getWindowsSystemPath();
  check('B1 返回非空 PATH 字符串', typeof p1 === 'string' && p1.length > 0, typeof p1 === 'string' ? p1.length : p1, '>0 字符');
  check('B2 含系统目录（Windows 或 system32，大小写不敏感）', /windows|system32/i.test(p1), p1.slice(0, 80));
  check('B3 展开 %VAR%（结果不含 % 包裹的未展开变量）', !/%[A-Za-z_]+%/.test(p1), (p1.match(/%[A-Za-z_]+%/) || [])[0]);
  check('B4 二次调用走缓存（返回值一致）', p1 === p2, 'identical');
} else {
  console.log('SKIP B1–B4 非 Windows 平台');
}

// ---------- C. codeStats ----------
const { countFile, countFiles, isSourceFile } = require('../dist/tools/codeStats.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-stats-'));
try {
  fs.writeFileSync(path.join(dir, 'a.c'), [
    '#include <stdio.h>',   // 非注释代码
    '',
    '// 单行注释',
    'int main(void) {',
    '    /* 块注释',
    '       续行 */',
    '    printf("hi"); // 尾部注释',
    '    return 0;',
    '}',
    '',
  ].join('\n'), 'utf-8');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'plain text\nsecond\n', 'utf-8');
  fs.mkdirSync(path.join(dir, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'sub', 'c.cpp'), 'int x;\n', 'utf-8');

  check('C1 isSourceFile：.c/.cpp 为源文件', isSourceFile('a.c') && isSourceFile('sub/c.cpp'), [isSourceFile('a.c'), isSourceFile('sub/c.cpp')], [true, true]);
  check('C2 isSourceFile：.txt 不是源文件', !isSourceFile('b.txt'), isSourceFile('b.txt'), false);

  const one = countFile(path.join(dir, 'a.c'));
  // 字段语义（实际）：{ filename, total, code, comment, blank }
  check('C3 countFile：总行数 = 10', one.total === 10, one, { total: 10 });
  check('C4 countFile：代码 + 注释 + 空行 = 总行数',
    one.code + one.comment + one.blank === one.total, one, 'code+comment+blank=total');
  check('C5 countFile：注释行 = 3（单行注释 + 块注释两行）', one.comment === 3, one.comment, 3);
  check('C6 countFile：空行 = 2', one.blank === 2, one.blank, 2);
  check('C6b countFile：代码行 = 5（含尾部注释行与预处理行）', one.code === 5, one.code, 5);

  const agg = countFiles([path.join(dir, 'a.c'), path.join(dir, 'b.txt'), path.join(dir, 'sub', 'c.cpp')]);
  const perTotal = agg.perFile.reduce((s, f) => s + f.total, 0);
  check('C7 countFiles：聚合总数 = 各文件之和', agg.aggregate.total === perTotal, { agg: agg.aggregate.total, perTotal }, '相等');
  check('C8 countFiles：文件计数正确', agg.aggregate.files === 3, agg.aggregate.files, 3);
  check('C9 countFiles：perFile 每项带 filename', agg.perFile.every((f) => typeof f.filename === 'string' && f.filename), agg.perFile.map((f) => f.filename));
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\ntools-misc 回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
