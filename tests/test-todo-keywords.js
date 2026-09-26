// 验证第三轮 R12：TODO 关键字可配置（列表扫描 + Add TODO 类型选项同源）
const fs = require('fs');
const path = require('path');
const { parseBufferForTodos } = require('../dist/tools/todoScanner.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const buf = [
  '// TODO(alice): first',
  '// PERF: scan hot path',
  '// FIXME: later',
].join('\n');

const def = parseBufferForTodos(buf, 'x.c');
check('默认关键字：TODO/FIXME 命中', def.length === 2 && def.map((t) => t.type).sort().join(',') === 'FIXME,TODO', def.map((t) => t.type));

const custom = parseBufferForTodos(buf, 'x.c', { startStrings: ['PERF'], allowedTypes: ['PERF'] });
check('自定义关键字：仅 PERF', custom.length === 1 && custom[0].type === 'PERF' && custom[0].text.includes('scan hot path'), custom);

check('自定义关键字大小写敏感', parseBufferForTodos('// perf: x', 'x.c', { startStrings: ['PERF'], allowedTypes: ['PERF'] }).length === 0, true);

// package.json 默认关键字与扫描器默认一致
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const blocks = pkg.contributes.configuration;
const props = Array.isArray(blocks) ? Object.assign({}, ...blocks.map((b) => b.properties || {})) : blocks.properties;
const kw = props['codeblocks.todo.keywords'];
check('设置项存在且默认 5 关键字', Array.isArray(kw?.default) && kw.default.join(',') === 'TODO,FIXME,NOTE,HACK,XXX', kw && kw.default);

console.log(`TODO 关键字: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
