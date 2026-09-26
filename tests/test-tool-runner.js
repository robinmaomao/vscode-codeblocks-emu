// 用户自定义工具（E1）纯逻辑回归
const { parseToolsSetting, splitToolArguments, expandToolAliases, buildToolInvocation } = require('../dist/tools/toolRunner.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// 1. 设置解析：非法项过滤 + output 兜底
const parsed = parseToolsSetting([
  { name: '烧写', command: 'flash.exe' },
  { name: 'bad' },
  { command: 'noName.exe' },
  null,
  'str',
  { name: 'term', command: 't.exe', output: 'terminal' },
  { name: 'unknown', command: 'u.exe', output: 'stdout' },
]);
check('解析：合法项数量', parsed.length === 3, parsed.length);
check('解析：output 枚举兜底', parsed[2].output === 'output', parsed[2].output);
check('解析：terminal 保留', parsed[1].output === 'terminal', parsed[1].output);
check('解析：非数组 → 空', parseToolsSetting('x').length === 0, parseToolsSetting('x').length);

// 2. 分词：引号感知
check('分词：双引号/单引号/裸 token', JSON.stringify(splitToolArguments('-a "b c" \'d e\' f')) === JSON.stringify(['-a', 'b c', 'd e', 'f']), splitToolArguments('-a "b c" \'d e\' f'));
check('分词：空串', splitToolArguments('  ').length === 0, splitToolArguments('  ').length);

// 3. 别名宏
check('别名宏展开', expandToolAliases('${fileDir}\\${projectName}', { fileDir: 'C:/p', projectName: 'app' }) === 'C:/p\\app', expandToolAliases('${fileDir}\\${projectName}', { fileDir: 'C:/p', projectName: 'app' }));
check('未知别名原样', expandToolAliases('${env:X}', {}) === '${env:X}', expandToolAliases('${env:X}', {}));

// 4. CB 宏 + 项目变量 + 分词组合（项目自定义变量语法：$(var)，无 #）
const inv = buildToolInvocation(
  { name: 't', command: 'run', arguments: '--ver $(ver) "${file}"', output: 'output' },
  { file: 'C:/a b/main.c', customVars: { ver: '1.2' } },
);
check('CB 宏 $(var) 展开', inv.command === 'run' && inv.args[0] === '--ver', { c: inv.command, a: inv.args });
check('args 变量展开+引号', inv.args[1] === '1.2' && inv.args[2] === 'C:/a b/main.c', inv.args);

// 5. 工作目录展开
const inv2 = buildToolInvocation(
  { name: 't', command: 'tool', workingDirectory: '${projectDir}/out', output: 'silent' },
  { projectDir: 'C:/proj' },
);
check('workingDirectory 展开', inv2.cwd === 'C:/proj/out', inv2.cwd);

console.log(`自定义工具: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
