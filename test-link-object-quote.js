// 验证 R1：链接对象逐对象加引号（对齐 pfDetails::Update:579-583 QuoteStringIfNeeded）
// 直接驱动 dist 的 quoteIfNeeded + 拼接语义
const { quoteIfNeeded } = require('./dist/compiler/commandGenerator.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// 1. 无空格/元字符：不加引号
check('plain', quoteIfNeeded('obj/Debug/main.o') === 'obj/Debug/main.o');
// 2. 含空格：加双引号
check('space', quoteIfNeeded('obj/Debug/a b.o') === '"obj/Debug/a b.o"');
// 3. cmd 元字符：加引号（shell 二次解析防护）
check('metachar', quoteIfNeeded('obj/Debug/a&b.o') === '"obj/Debug/a&b.o"');
// 4. 链接对象组装语义：逐对象 quote 后 objectSeparator（空格）拼接
const parts = ['obj/Debug/a b.o', 'obj/Debug/c.o'].map((p) => quoteIfNeeded(p)).join(' ');
check('join', parts === '"obj/Debug/a b.o" obj/Debug/c.o');
// 5. 已带引号不重复加
check('already quoted', quoteIfNeeded('"obj/x.o"') === '"obj/x.o"');

console.log(`test-link-object-quote: ${pass} pass, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
