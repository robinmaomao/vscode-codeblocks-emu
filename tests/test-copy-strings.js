// P1-5?Copy strings ?????? CB copystrings.cpp?
const { extractStringLiterals } = require('../dist/tools/copyStrings.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
const src = [
  'const char *a = "hello";',
  'const char c = \'x\';',
  '// "comment" should be ignored',
  '/* "block comment" */',
  'const char *b = "hello";',
  'const char *esc = "a\\"b";',
  'const char *z = "zzz";',
].join('\n');
const got = extractStringLiterals(src);
check('???????? + ?? + ??', JSON.stringify(got) === JSON.stringify(['"a\\"b"', '"hello"', '"zzz"']), got, ['"a\\"b"', '"hello"', '"zzz"']);
check('???????', !got.some((s) => s.includes("'x'")), got, 'no single quote');
check('?????', !got.includes('"comment"'), got, 'no line comment');
check('?????', !got.includes('"block comment"'), got, 'no block comment');
check('????????', extractStringLiterals('').length === 0, extractStringLiterals(''), []);
check('?????????', extractStringLiterals('"unterminated').length === 0, extractStringLiterals('"unterminated'), []);

console.log('copy-strings: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
