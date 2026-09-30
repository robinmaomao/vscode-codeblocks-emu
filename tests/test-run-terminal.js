// UI 核查 N2 回归（方案 C + 方案 A + 方案 B1）：createRunTerminal 同名先弃后建
//  - 纯函数注入 API：同名且（本扩展创建〔WeakSet〕或名称曾用过〔注册表〕）→ dispose 后再 create
//  - 方案 A：用户/其它扩展同名终端不误杀（名称未在注册表时）
//  - 方案 B1：注册表（setRunTerminalRegistry 注入）命中 → 重载后旧标签回收；create 后登记名称
//  - 接线静态断言：dist/extension.js 四处调用均经 createRunTerminal、激活时注入 workspaceState 注册表
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
const { createRunTerminal, setRunTerminalRegistry } = require(path.resolve(__dirname, '../dist/ui/runTerminal.js'));
setRunTerminalRegistry(undefined); // 复位模块级注册表，防跨用例泄漏

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

/** 构造带事件记录的假终端 API（dispose 即从列表移除，模拟 vscode.window.terminals） */
function makeApi(initial) {
  const events = [];
  const list = [];
  const mk = (name, opts) => {
    const t = {
      name,
      options: opts,
      dispose: () => {
        events.push(`dispose:${name}`);
        const i = list.indexOf(t);
        if (i >= 0) list.splice(i, 1);
      },
    };
    return t;
  };
  for (const t of initial) list.push(mk(t.name));
  return {
    events,
    list,
    api: {
      existing: () => list,
      create: (o) => {
        events.push(`create:${o.name}`);
        const t = mk(o.name, o);
        list.push(t);
        return t;
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

// 2. 同名且本扩展创建：先 dispose 后 create（连续运行两次），其余终端不动
{
  const { events, list, api } = makeApi([
    { name: 'powershell' },
    { name: 'CB Tool: nm' },
  ]);
  createRunTerminal('Run: Debug', { cwd: 'C:\\x' }, api); // 第一次：创建（入 WeakSet + 列表）
  createRunTerminal('Run: Debug', { cwd: 'C:\\y' }, api); // 第二次：dispose 旧的 + 创建新的
  check('B1 先弃后建顺序（create→dispose→create）', events.join(',') === 'create:Run: Debug,dispose:Run: Debug,create:Run: Debug', events);
  check('B2 其它终端不受影响（0 次 dispose）', !events.some((e) => e === 'dispose:powershell' || e === 'dispose:CB Tool: nm'), events);
  check('B3 旧终端已从列表移除（同名仅剩 1 个）', list.filter((t) => t.name === 'Run: Debug').length === 1, list.map((t) => t.name));
  check('B4 新终端 cwd 每轮生效', list.find((t) => t.name === 'Run: Debug').options.cwd === 'C:\\y', list.find((t) => t.name === 'Run: Debug').options.cwd);
}

// 3. 方案 A：用户/其它扩展的同名终端不误杀
{
  const { events, list, api } = makeApi([{ name: 'Run: Debug' }]); // 用户手工创建（非本扩展，不在 WeakSet）
  createRunTerminal('Run: Debug', {}, api);
  check('C1 用户同名终端零 dispose', !events.some((e) => e.startsWith('dispose:')), events);
  check('C2 仍创建新终端', events.filter((e) => e === 'create:Run: Debug').length === 1, events);
  check('C3 用户终端保留 + 新增 1 个（同名并存=方案 A 取舍）', list.filter((t) => t.name === 'Run: Debug').length === 2, list.map((t) => t.name));
}

// 4. 方案 A：混合场景只处置本扩展创建的终端
{
  const { events, list, api } = makeApi([{ name: 'Run: Debug' }]); // 用户终端
  createRunTerminal('Run: Debug', {}, api); // 本扩展终端 #1
  createRunTerminal('Run: Debug', {}, api); // 只 dispose 本扩展 #1，用户终端保留
  check('M1 只 dispose 本扩展创建的终端（恰 1 次）', events.filter((e) => e === 'dispose:Run: Debug').length === 1, events);
  check('M2 用户终端保留 + 新终端（同名共 2 个）', list.filter((t) => t.name === 'Run: Debug').length === 2, list.map((t) => t.name));
}

// 5. 无同名时 dispose 零次 + create 恰一次
{
  const { events, api } = makeApi([{ name: 'git bash' }]);
  createRunTerminal('Run (no project)', { cwd: 'D:\\t' }, api);
  check('D1 无同名零 dispose', !events.some((e) => e.startsWith('dispose:')), events);
  check('D2 create 恰一次', events.filter((e) => e.startsWith('create:')).length === 1, events);
}

// 6. 名称精确匹配（前缀/子串不误杀）
{
  const { events, api } = makeApi([
    { name: 'Run: Debug extra' },
    { name: 'My Run: Debug' },
  ]);
  createRunTerminal('Run: Debug', {}, api);
  check('E1 前缀/子串同名不误杀', !events.some((e) => e.startsWith('dispose:')), events);
}

// 7. 方案 B1：跨重载名称注册表（setRunTerminalRegistry 注入；WeakSet 重载失效后靠注册表识别）
{
  // F1/F2：注册表命中 → 非本会话跟踪的同名终端（模拟重载后恢复的旧标签）被回收，回收后单一标签
  setRunTerminalRegistry({ has: (n) => n === 'Run: Debug', add: () => {} });
  const { events, list, api } = makeApi([{ name: 'Run: Debug' }]);
  createRunTerminal('Run: Debug', {}, api);
  check('F1 注册表命中：重载后旧同名标签被回收', events.join(',') === 'dispose:Run: Debug,create:Run: Debug', events);
  check('F2 回收后单一标签', list.filter((t) => t.name === 'Run: Debug').length === 1, list.map((t) => t.name));
  setRunTerminalRegistry(undefined);
}

{
  // F3：注册表未命中 → 同名终端不误杀（未用过的名称不受影响）
  setRunTerminalRegistry({ has: () => false, add: () => {} });
  const { events, api } = makeApi([{ name: 'Run: Debug' }]);
  createRunTerminal('Run: Debug', {}, api);
  check('F3 注册表未命中不误杀', !events.some((e) => e.startsWith('dispose:')), events);
  setRunTerminalRegistry(undefined);
}

{
  // F4：create 后登记名称（add 恰一次、名称透传）
  const added = [];
  setRunTerminalRegistry({ has: () => false, add: (n) => added.push(n) });
  const { api } = makeApi([]);
  createRunTerminal('Run: X', {}, api);
  check('F4 create 后登记名称', added.join(',') === 'Run: X', added);
  setRunTerminalRegistry(undefined);
}

// 8. 接线静态断言（dist 编译后形态：(0, runTerminal_1.createRunTerminal)(...)）
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('接线① CB Tool 终端经 createRunTerminal', ext.includes('createRunTerminal)(`CB Tool: ${tool.name}`'), null);
check('接线② Run (no project) 经 createRunTerminal', ext.includes("createRunTerminal)('Run (no project)'"), null);
const runCreateCount = (ext.match(/createRunTerminal\)\(`Run: \$\{target\.title\}`/g) || []).length;
check('接线③ Run: 两分支（库+普通）均已接入', runCreateCount === 2, runCreateCount);
check('接线④ 不再为 Run/CB Tool 直接 createTerminal', !/createTerminal\(\{\s*name: `(Run|CB Tool)/.test(ext), null);
check('接线⑤ 激活时注入 workspaceState 注册表', ext.includes('setRunTerminalRegistry') && ext.includes('createWorkspaceRunTerminalRegistry)(context.workspaceState)'), null);

console.log(`\nrun-terminal: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
