// UI 核查 N2（方案 C）回归：createRunTerminal 先弃后建
//  - 纯函数注入 API：同名终端先 dispose 再 create，其余终端不动
//  - 选项透传：name/cwd/env 原样传给 create
//  - 接线静态断言：dist/extension.js 四处调用均经 createRunTerminal，不再直接 createTerminal
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    // 仅需解析 import；本模块测试全程注入 fake api，不触碰 vscode.window
    return { window: { terminals: [], createTerminal: () => { throw new Error('不应到达'); } } };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const path = require('path');
const { createRunTerminal } = require(path.resolve(__dirname, '../dist/ui/runTerminal.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

/** 构造带事件记录的假终端 API */
function makeApi(initial) {
  const events = [];
  const list = initial.map((t) => ({
    name: t.name,
    dispose: () => events.push(`dispose:${t.name}`),
  }));
  return {
    events,
    api: {
      existing: () => list,
      create: (o) => {
        events.push(`create:${o.name}`);
        return { options: o };
      },
    },
  };
}

// 1. 无同名终端：直接 create，不 dispose
{
  const { events, api } = makeApi([{ name: 'powershell' }]);
  const t = createRunTerminal('Run: Debug', { cwd: 'C:\\x', env: { A: '1' } }, api);
  check('A1 无同名：仅 create 不 dispose', events.join(',') === 'create:Run: Debug', events);
  check('A2 name 透传', t.options.name === 'Run: Debug', t.options.name);
  check('A3 cwd 透传', t.options.cwd === 'C:\\x', t.options.cwd);
  check('A4 env 透传', t.options.env.A === '1', t.options.env);
}

// 2. 有同名终端：先 dispose 后 create，其余不动
{
  const { events, api } = makeApi([
    { name: 'Run: Debug' },
    { name: 'powershell' },
    { name: 'CB Tool: nm' },
  ]);
  createRunTerminal('Run: Debug', {}, api);
  check('B1 先弃后建顺序', events.join(',') === 'dispose:Run: Debug,create:Run: Debug', events);
  check('B2 其它终端不受影响（0 次 dispose）', !events.some((e) => e === 'dispose:powershell' || e === 'dispose:CB Tool: nm'), events);
}

// 3. 多个同名终端全部 dispose
{
  const { events, api } = makeApi([
    { name: 'Run: Debug' },
    { name: 'Run: Debug' },
    { name: 'Run: Release' },
  ]);
  createRunTerminal('Run: Debug', {}, api);
  const disposes = events.filter((e) => e === 'dispose:Run: Debug').length;
  check('C1 两个同名终端全部 dispose', disposes === 2, disposes);
  check('C2 不同名（Release）不 dispose', !events.includes('dispose:Run: Release'), events);
  check('C3 create 恰一次', events.filter((e) => e === 'create:Run: Debug').length === 1, events);
}

// 4. 无同名时 dispose 零次 + create 恰一次
{
  const { events, api } = makeApi([{ name: 'git bash' }]);
  createRunTerminal('Run (no project)', { cwd: 'D:\\t' }, api);
  check('D1 无同名零 dispose', !events.some((e) => e.startsWith('dispose:')), events);
  check('D2 create 恰一次', events.filter((e) => e.startsWith('create:')).length === 1, events);
}

// 5. 名称精确匹配（前缀/子串不误杀）
{
  const { events, api } = makeApi([
    { name: 'Run: Debug extra' },
    { name: 'My Run: Debug' },
  ]);
  createRunTerminal('Run: Debug', {}, api);
  check('E1 前缀/子串同名不误杀', !events.some((e) => e.startsWith('dispose:')), events);
}

// 6. 接线静态断言（dist 编译后形态：(0, runTerminal_1.createRunTerminal)(...)）
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('接线① CB Tool 终端经 createRunTerminal', ext.includes('createRunTerminal)(`CB Tool: ${tool.name}`'), null);
check('接线② Run (no project) 经 createRunTerminal', ext.includes("createRunTerminal)('Run (no project)'"), null);
const runCreateCount = (ext.match(/createRunTerminal\)\(`Run: \$\{target\.title\}`/g) || []).length;
check('接线③ Run: 两分支（库+普通）均已接入', runCreateCount === 2, runCreateCount);
check('接线④ 不再为 Run/CB Tool 直接 createTerminal', !/createTerminal\(\{\s*name: `(Run|CB Tool)/.test(ext), null);

console.log(`\nrun-terminal: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
