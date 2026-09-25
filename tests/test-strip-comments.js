// 验证 B4 include 依赖扫描改进：注释/字符串剥离后再匹配 #include
// 精确复刻 buildEngine.ts 的 stripCommentsAndStrings 逻辑（vscode 无关）
function stripStrings(line) {
  let out = '';
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '"' || c === "'") {
      const q = c;
      out += ' ';
      i++;
      while (i < line.length && line[i] !== q) {
        if (line[i] === '\\') i++; // 跳过转义字符
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function stripCommentsAndStrings(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const lines = noBlock.split('\n');
  const out = [];
  for (const rawLine of lines) {
    if (/^\s*#\s*include\b/.test(rawLine)) {
      out.push(rawLine.replace(/\/\/.*$/, ''));
      continue;
    }
    out.push(stripStrings(rawLine).replace(/\/\/.*$/, ''));
  }
  return out.join('\n');
}

function findIncludes(src) {
  const content = stripCommentsAndStrings(src);
  const re = /^\s*#\s*include\s*(?:"([^"]+)"|<([^>]+)>)/gm;
  const out = [];
  let m;
  while ((m = re.exec(content)) !== null) {
    out.push(m[1] ?? m[2]);
  }
  return out;
}

let pass = 0, fail = 0;
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log('OK  ' + name); }
  else { fail++; console.log('FAIL ' + name + ' -> actual=' + a + ' expected=' + e); }
}

// 正常 include
check('普通 include', findIncludes('#include "a.h"\n#include <b.h>\n'), ['a.h', 'b.h']);
// 行注释里的 include 不计
check('行注释 include', findIncludes('// #include "fake.h"\n#include "a.h"\n'), ['a.h']);
// 块注释里的 include 不计
check('块注释 include', findIncludes('/* #include "fake.h" */\n#include "a.h"\n'), ['a.h']);
// 跨行块注释
check('跨行块注释', findIncludes('/* line1\n#include "fake.h"\n*/ #include "a.h"\n'), ['a.h']);
// 字符串里的 #include 不计
check('字符串 include', findIncludes('const char *s = "#include <fake.h>";\n#include "a.h"\n'), ['a.h']);
// 字符常量引号不破坏后续解析
check('字符常量', findIncludes('char q = \'"\';\n#include "a.h"\n'), ['a.h']);
// 转义引号不提前结束字符串
check('转义引号', findIncludes('const char *s = "say \\"hi\\" #include <fake.h>";\n#include "a.h"\n'), ['a.h']);
// 缩进 include
check('缩进 include', findIncludes('  #include "a.h"\n'), ['a.h']);

console.log('汇总: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
