// P2-2?nm ?????????
const { parseNmOutput, filterSymbols } = require('../dist/tools/symtab.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
const nm = [
  'libfoo.a:0000000000000000 T main',
  'libfoo.a:0000000000000010 T helper',
  'libbar.a:                 U printf',
  'libbar.a:0000000000000020 D global_value',
  'noise line',
].join('\n');
const rows = parseNmOutput(nm);
check('?? 4 ?????', rows.length === 4, rows.length, 4);
check('T ?????', rows[0].library === 'libfoo.a' && rows[0].type === 'T' && rows[0].name === 'main', rows[0], 'main');
check('U ?????', rows[2].type === 'U' && rows[2].address === '', rows[2], 'U');
check('D ??', rows[3].type === 'D' && rows[3].name === 'global_value', rows[3], 'D');

const noLib = parseNmOutput('0000000000000000 T solo', 'libsolo.a');
check('? -A ???? fallback ??', noLib.length === 1 && noLib[0].library === 'libsolo.a', noLib[0], 'libsolo.a');

check('????????', filterSymbols(rows, 'MAIN').length === 1, filterSymbols(rows, 'MAIN'), 1);
check('???????', filterSymbols(rows, '').length === 4, filterSymbols(rows, '').length, 4);
check('??????', filterSymbols(rows, 'zzz').length === 0, filterSymbols(rows, 'zzz'), []);
check('C++ ??????', parseNmOutput('libx.a:0000000000000000 T ns::func(int)', 'x').some((r) => r.name === 'ns::func(int)'), parseNmOutput('libx.a:0000000000000000 T ns::func(int)', 'x'), 'ns::func(int)');

console.log('symtab-parse: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
