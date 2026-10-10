// 调试会话注册表 + 视图 provider 回归（此前无测试引用）：
//  - debug/debugRegistry：多会话路由（聚焦会话优先 → 最近注册 → 任一存活）、注销隔离、DAP 跟踪开关
//  - ui/symbolTreeProvider：按 函数/宏/类型/变量/其它 分组、组内排序、跳转命令
//  - ui/registersTreeProvider：设置门控、无会话提示、有会话时的寄存器列表与 TreeItem 映射
//  - ui/analysisTreeProvider：空态根节点、结果缓存与 refresh 失效
// 均经 tests/_harness/vscodeMock 提供 vscode API。
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

async function main() {
  const mock = installVscodeMock();
  try {
    // ---------- A. debugRegistry ----------
    const reg = require('../dist/debug/debugRegistry.js');
    const mk = (id, active = true) => ({ id, isActive: () => active });
    let fired = 0;
    const sub = reg.debugStateChanged.event(() => { fired++; });

    const a1 = mk('s1');
    const a2 = mk('s2');
    check('A1 无会话时 getActiveAdapter 为 null', reg.getActiveAdapter() === null, reg.getActiveAdapter());

    reg.registerAdapter('s1', a1);
    check('A2 注册后返回该适配器', reg.getActiveAdapter() === a1, !!reg.getActiveAdapter());
    check('A3 注册会触发 debugStateChanged 事件', fired === 1, fired, 1);

    reg.registerAdapter('s2', a2);
    check('A4 多会话无聚焦时返回最近注册', reg.getActiveAdapter() === a2, 'adapter2');

    mock.vscode.debug.activeDebugSession = { id: 's1' };
    check('A5 有聚焦会话时优先返回聚焦会话', reg.getActiveAdapter() === a1, 'adapter1');
    mock.vscode.debug.activeDebugSession = { id: 'unknown' };
    check('A6 聚焦会话未注册时回退最近注册', reg.getActiveAdapter() === a2, 'adapter2');
    mock.vscode.debug.activeDebugSession = undefined;

    reg.unregisterAdapter('s2', a2);
    check('A7 注销某会话不影响其它会话', reg.getActiveAdapter() === a1, !!reg.getActiveAdapter());

    const dead = mk('s3', false);
    reg.registerAdapter('s3', dead);
    check('A8 已结束会话（isActive=false）被过滤', reg.getActiveAdapter() === a1, 'adapter1');
    reg.unregisterAdapter('s3', dead);
    reg.unregisterAdapter('s1', a1);
    check('A9 全部注销后为 null', reg.getActiveAdapter() === null, reg.getActiveAdapter());

    const traced = [];
    reg.setDebugTraceSink((l) => traced.push(l));
    reg.setDebugTraceEnabled(false);
    reg.debugTrace('should-not-appear');
    check('A10 trace 关闭时不写 sink', traced.length === 0, traced);
    reg.setDebugTraceEnabled(true);
    reg.debugTrace('dap frame');
    check('A11 trace 开启时写 sink', traced.length === 1 && traced[0] === 'dap frame', traced);
    reg.setDebugTraceEnabled(false);
    check('A12 注销事件也触发 debugStateChanged', fired >= 5, fired, '≥5');
    sub.dispose();

    // ---------- B. SymbolTreeProvider ----------
    const { SymbolTreeProvider } = require('../dist/ui/symbolTreeProvider.js');
    const CIK = mock.vscode.CompletionItemKind;
    const sym = new SymbolTreeProvider();
    const empty = sym.getChildren();
    check('B1 未注入索引时返回空数组', Array.isArray(empty) && empty.length === 0, empty);

    sym.setIndex({
      allEntries: () => [
        { name: 'main', kind: CIK.Function, file: 'main.c', line: 3 },
        { name: 'util_add', kind: CIK.Function, file: 'util.c', line: 7 },
        { name: 'MAX_LEN', kind: CIK.Constant, file: 'util.h', line: 2 },
        { name: 'Point', kind: CIK.Struct, file: 'util.h', line: 9 },
        { name: 'g_count', kind: CIK.Variable, file: 'util.c', line: 1 },
        { name: 'mystery', kind: CIK.Text, file: 'x.c', line: 1 },
      ],
    });
    const groups = sym.getChildren();
    check('B2 分组齐备（函数/宏/类型/变量/其它 = 5 组）', groups.length === 5, groups.map((g) => String(g.label)), 5);
    const fnGroup = groups.find((g) => String(g.label).includes('函数'));
    check('B3 组标题带数量', !!fnGroup && /函数 \(2\)/.test(String(fnGroup.label)), fnGroup && String(fnGroup.label), '函数 (2)');
    check('B4 未识别 kind 落入「其它」组', groups.some((g) => /其它/.test(String(g.label))), groups.map((g) => String(g.label)));
    const fnChildren = sym.getChildren(fnGroup);
    check('B5 组内符号按名称排序', fnChildren.map((n) => String(n.label)).join(',') === 'main,util_add', fnChildren.map((n) => String(n.label)));
    const item = sym.getTreeItem(fnChildren[0]);
    check('B6 符号节点带跳转 command（vscode.open，2 个参数）',
      !!item.command && item.command.command === 'vscode.open' && item.command.arguments.length === 2, item.command);
    check('B7 符号节点 description 显示「文件:行」', /main\.c:3/.test(String(item.description)), item.description);

    // ---------- C. RegistersTreeProvider（设置门控 + 适配器数据） ----------
    const { RegistersTreeProvider } = require('../dist/ui/registersTreeProvider.js');
    const regs = new RegistersTreeProvider();
    const c1 = regs.getChildren();
    check('C1 默认（debug.registers 关闭）返回单条提示并指向设置项',
      c1.length === 1 && /debug\.registers/.test(String(c1[0].label)), c1.map((n) => String(n.label)));
    check('C2 提示节点为叶节点（不可展开）', c1[0].collapsibleState === 0, c1[0].collapsibleState, 0);

    mock.configStore['codeblocks.debug.registers'] = true;
    const c2 = regs.getChildren();
    check('C3 开启设置但无调试会话 → 提示未启动', c2.length === 1 && /未启动/.test(String(c2[0].label)), c2.map((n) => String(n.label)));

    reg.registerAdapter('s-reg', {
      isActive: () => true,
      isStopped: () => true,
      registerValues: async () => [{ name: 'eax', value: '0x1' }, { name: 'rip', value: '0x400000' }],
    });
    await regs.reload();
    const c3 = regs.getChildren();
    check('C4 有活动且停止的会话 → 返回寄存器值列表（2 项）', c3.length === 2, c3.length, 2);
    const regItem = regs.getTreeItem(c3[0]);
    check('C5 getTreeItem 映射 name/value/description/contextValue',
      regItem.description === '0x1' && regItem.contextValue === 'cbRegister', { description: regItem.description, contextValue: regItem.contextValue });
    mock.configStore['codeblocks.debug.registers'] = false;
    // 说明：真实读取全量寄存器在 MinGW GDB 8.1 会崩溃 GDB（见 tests/e2e/test-e2e-debug.js S1），
    // 因此上层默认关闭该设置；此处只验证门控与数据映射。

    // ---------- D. AnalysisTreeProvider（空态 + 缓存失效） ----------
    const { AnalysisTreeProvider } = require('../dist/ui/analysisTreeProvider.js');
    let computeCalls = 0;
    const payload = { generatedAt: Date.now(), projects: [] };
    const analysis = new AnalysisTreeProvider(mock.vscode.Uri.file(__dirname), () => { computeCalls++; return payload; });
    const d1 = analysis.getChildren();
    check('D1 未打开工程时：最近构建 + 空态提示（2 个根节点）', d1.length === 2, d1.map((n) => String(n.label)));
    check('D2 空态提示文案指向 .cbp/.workspace', /尚未打开工程/.test(String(d1[1].label)), String(d1[1].label));
    analysis.getChildren();
    check('D3 getData 结果被缓存（重复读取不重算）', computeCalls === 1, computeCalls, 1);
    analysis.refresh();
    analysis.getChildren();
    check('D4 refresh() 使缓存失效（重新计算）', computeCalls === 2, computeCalls, 2);
    check('D5 getTreeItem 原样返回节点对象', analysis.getTreeItem(d1[0]) === d1[0], true, true);
  } finally {
    mock.restore();
  }
  console.log(`\ndebug-registry-and-providers 回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('运行异常: ' + (err && err.stack ? err.stack : err));
  console.log(`\ndebug-registry-and-providers 回归: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
