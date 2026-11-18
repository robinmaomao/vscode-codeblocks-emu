// P2-1?gprof flat profile ???????
const { parseGprofFlatProfile, formatProfilerTable, parseGprofCallGraph, formatProfilerCallGraph, profilerRowsToCsv, profilerReportHtml } = require('../dist/tools/profiler.js');

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

const graphSample = [
  'Call graph (explanation follows)',
  '',
  'index % time    self  children    called     name',
  '                0.00    0.05       1/1           main [1]',
  '[2]    100.0    0.00    0.05       1         foo [2]',
  '-----------------------------------------------',
  '                0.00    0.05       1/1           main [1]',
  '[1]    100.0    0.00    0.05                 main [1]',
  '',
].join('\n');
const graph = parseGprofCallGraph(graphSample);
check('call graph 2 entries', graph.length === 2, graph.length, 2);
check('call graph caller edge', graph[0].name === 'foo' && graph[0].callers.length === 1 && graph[0].callers[0].name === 'main', graph[0], 'foo<-main');
check('call graph root without called', graph[1].name === 'main' && graph[1].called === '-', graph[1], 'main');
check('call graph formatting', formatProfilerCallGraph(graph).includes('foo') && formatProfilerCallGraph(graph).includes('<- [1] main'), formatProfilerCallGraph(graph), 'foo');
check('empty call graph', parseGprofCallGraph('').length === 0 && formatProfilerCallGraph([]).includes('no call-graph'), formatProfilerCallGraph([]), 'empty');

const csv = profilerRowsToCsv(rows);
check('csv header', csv.startsWith('percent,cumulative_seconds,self_seconds,calls,self_ms_per_call,total_ms_per_call,name\r\n'), csv.split('\r\n')[0], 'header');
check('csv rows', csv.includes('50,0.05,0.05,1,50,50,foo'), csv, 'foo');
check('csv escaping', profilerRowsToCsv([{ percent: 1, cumulativeSeconds: 1, selfSeconds: 1, calls: null, selfMsPerCall: 1, totalMsPerCall: 1, name: 'a,"b"' }]).includes('"a,""b"""'), 'escape', 'quoted');
const html = profilerReportHtml({ target: 'demo<x>', executable: 'C:\\demo\\app.exe', rows, callGraph: graph });
check('html self-contained', html.startsWith('<!DOCTYPE html>') && html.includes('<style>'), html.slice(0, 30), 'html');
check('html escapes target and names', html.includes('demo&lt;x&gt;') && html.includes('<td>foo</td>'), html, 'escaped');
check('html includes call graph', html.includes('Call graph') && html.includes('main [1]'), html, 'graph');

console.log('profiler-parse: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
