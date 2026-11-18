// P1-3?Examine memory ? hex/ASCII ???
const { formatMemoryDump } = require('../dist/debug/memoryDump.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const buf = Buffer.from('Hello\0World!', 'ascii');
const out = formatMemoryDump(0x1000, buf, 8);
const lines = out.split('\n');
check('16 ????', lines.length === 1, lines.length, 1);
check('?? 8 ?????', lines[0].startsWith('00001000  '), lines[0].slice(0, 12), '00001000  ');
check('hex ??', lines[0].includes('48 65 6c 6c 6f 00 57 6f 72 6c 64 21'), lines[0], 'hex');
check('ASCII ??????? .?', lines[0].includes('Hello.World!'), lines[0], 'Hello.World!');

const multi = formatMemoryDump(0x20, Buffer.from(Array.from({length: 20}, (_, i) => i)), 8);
check('?? 16 ?????', multi.split('\n').length === 2, multi.split('\n').length, 2);
check('???????', multi.split('\n')[1].startsWith('00000030'), multi.split('\n')[1].slice(0, 8), '00000030');
check('???????', formatMemoryDump(0, Buffer.alloc(0), 8) === '', formatMemoryDump(0, Buffer.alloc(0), 8), '');

console.log('memory-dump: ' + pass + ' pass, ' + fail + ' fail');
process.exit(fail ? 1 : 0);
