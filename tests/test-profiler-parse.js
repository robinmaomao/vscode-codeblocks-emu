// P2-1?gprof flat profile ???????
const { parseGprofFlatProfile, formatProfilerTable } = require('../dist/tools/profiler.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}
const sample = [
  'Flat profile:',
  '',
  'Each sample counts as 0.01 seconds.',
  '  %   cumulative   self              self     total',
  ' time   seconds   seconds    calls  ms/call  ms/call  name',
  ' 50.00      0.05     0.05        1    50.00    50.00  foo',
  ' 25.00      0.08     0.03       10     3.00     3.00  bar',
  '  0.00      0.08     0.00        -        -        -  baz',
  '',
].join('\n');
const rows = parseGprofFlatProfile(sample);
check('?? 3 ?', rows.length === 3, rows.length, 3);
check('???/??', rows[0].percent === 50 && rows[0].selfSeconds === 0.05, rows[0], 'foo');
check('calls ??', rows[1].calls === 10 && rows[1].name === 'bar', rows[1], 'bar');
check('- calls ??? null', rows[2].calls === null, rows[2].calls, null);
check('????????', parseGprofFlatProfile('').length === 0, parseGprofFlatProfile(''), []);
const table = formatProfilerTable(rows);
check('?????', table.includes('% time') && table.includes('name'), table.split('\n')[0], 'header');
check('??????', table.includes('foo') && table.includes('bar'), table, 'rows');
check('?????', formatProfilerTable([]).includes('no flat-profile'), formatProfilerTable([]), 'no rows');

console.log('profiler-parse: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
