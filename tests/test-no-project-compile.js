// P0-2：无工程单文件编译命令 + GBK/UTF-8 逐行解码
const path = require('path');
const iconv = require('iconv-lite');
const { buildNoProjectCompilePlan } = require('../dist/build/noProjectCompile.js');
const { OutputLineDecoder } = require('../dist/tools/encoding.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const file = path.join('C:', 'work', '中文 目录', 'main.c');
const plan = buildNoProjectCompilePlan(file, 'gcc');
check('使用默认编译器程序', plan.program === 'gcc', plan.program, 'gcc');
check('保留源文件路径（含空格/中文）', plan.args.includes(file), plan.args, file);
check('包含调试与警告选项', plan.args.includes('-g') && plan.args.includes('-Wall'), plan.args, ['-g', '-Wall']);
check('产物在源文件目录', path.dirname(plan.output) === path.dirname(file), path.dirname(plan.output), path.dirname(file));
check('Windows 产物带 .exe', process.platform !== 'win32' || plan.output.endsWith('.exe'), plan.output, '*.exe');
check('cwd = 源文件目录', plan.cwd === path.dirname(file), plan.cwd, path.dirname(file));

// 逐行解码：GBK 行、UTF-8 行、跨块拆分的多字节字符
const decoder = new OutputLineDecoder();
const gbk = iconv.encode('错误：找不到 main.c\r\n', 'gbk');
const utf8 = Buffer.from('warning: unused variable\n', 'utf8');
let lines = [];
lines.push(...decoder.push(gbk).lines);
lines.push(...decoder.push(utf8).lines);
check('GBK 行解码为中文', lines[0].includes('错误：找不到 main.c'), lines[0], '错误：找不到 main.c');
check('UTF-8 行正常', lines[1].includes('unused variable'), lines[1], 'unused variable');

// 多字节字符跨块：拆开 GBK 的「中」字节
const one = iconv.encode('中文', 'gbk');
const d2 = new OutputLineDecoder();
const a = d2.push(Buffer.from([one[0]]));
const b = d2.push(Buffer.concat([one.subarray(1), Buffer.from('\n')]));
check('跨块 GBK 字节不产生乱码', a.lines.length === 0 && b.lines[0] === '中文', { a, b }, '中文');
const d3 = new OutputLineDecoder();
d3.push(Buffer.from('last'));
check('flush 取出无换行结尾的最后一行', d3.flush().lines[0] === 'last', d3.flush().lines, 'last');

console.log('no-project-compile: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
