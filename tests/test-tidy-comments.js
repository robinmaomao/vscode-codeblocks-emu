// Tidy 注释回归（第一波 D3）
const { tidyCommentBlock } = require('../dist/tools/tidyComments.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// 1. 对齐 + 空格规范 + 闭合行（标准风格：`*` 与 `/*` 的星号同列 = 缩进+1）
const src1 = ['/*', '  *  hello', '* world', '  */'].join('\n');
check('对齐与空格规范', tidyCommentBlock(src1) === ['/*', ' * hello', ' * world', ' */'].join('\n'), tidyCommentBlock(src1));

// 2. 缩进块（`*` 列 = 首行缩进 + 1）
const src2 = ['  /*', '     *a', '       */'].join('\n');
check('缩进块对齐', tidyCommentBlock(src2) === ['  /*', '   * a', '   */'].join('\n'), tidyCommentBlock(src2));

// 3. 空 * 行归一
check('空 * 行归一', tidyCommentBlock('/*\n *   \n */') === '/*\n *\n */', tidyCommentBlock('/*\n *   \n */'));

// 4. ASCII 超宽换行（前缀 ` * `，宽度 80）
const longContent = Array.from({ length: 24 }, (_, i) => `word${i}`).join(' '); // 长 > 77
const wrapped = tidyCommentBlock(`/*\n * ${longContent}\n */`);
const bodyLines = wrapped.split('\n').filter((l) => /^\s*\* /.test(l));
const contentOf = (l) => l.replace(/^\s*\* ?/, '');
check('超宽换行：行数 > 1', bodyLines.length > 1, bodyLines.length);
check('超宽换行：每行 ≤ 80', wrapped.split('\n').every((l) => l.length <= 80), wrapped.split('\n').map((l) => l.length));
check('超宽换行：词序保持', bodyLines.map(contentOf).join(' ') === longContent, bodyLines.join('|'));

// 5. CJK 内容不换行
const cjk = '/*\n * ' + '中文字符测试'.repeat(12) + '\n */';
check('CJK 不换行', tidyCommentBlock(cjk).split('\n').length === 3, tidyCommentBlock(cjk).split('\n').length);

// 6. 非注释块原样
check('非注释原样返回', tidyCommentBlock('int x = 1;\nint y = 2;') === 'int x = 1;\nint y = 2;', tidyCommentBlock('int x = 1;\nint y = 2;'));

// 7. 幂等
const once = tidyCommentBlock(src1);
check('幂等', tidyCommentBlock(once) === once, tidyCommentBlock(once));
const once2 = tidyCommentBlock(`/*\n * ${longContent}\n */`);
check('幂等（换行后）', tidyCommentBlock(once2) === once2, 'n/a');

// 8. doc 风格 `/**` 对齐
check('doc 风格 /** 对齐', tidyCommentBlock('/**\n* doc\n*/') === '/**\n * doc\n */', tidyCommentBlock('/**\n* doc\n*/'));

// 9. 尾随换行保留
check('尾随换行保留', tidyCommentBlock('/*\n * a\n */\n').endsWith('\n'), true);

console.log(`Tidy 注释: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
