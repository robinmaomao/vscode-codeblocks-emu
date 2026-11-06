// Agent 控制面开关回归（无宿主）：
//  - 设置声明：codeblocks.agent.enabled / readOnly（类型、默认值、分区、双语 nls、settings 文档覆盖）
//  - 策略真值表：isAgentEnabled / isAgentReadOnly / isReadOnlyToolCall（逐工具逐动作）
//  - invokeTool 只读拦截：放行白名单、拒绝写盘/构建并返回 read-only
//  - MCP 暴露计划：enabled / 脚本存在性组合
const fs = require('fs');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-agent-policy');
const SRC = path.join(ROOT, 'test-project');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const mock = installVscodeMock({});
const policy = require(path.join(ROOT, 'dist', 'api', 'agentPolicy.js'));
const registry = require(path.join(ROOT, 'dist', 'api', 'toolRegistry.js'));
const provider = require(path.join(ROOT, 'dist', 'mcp', 'provider.js'));

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.json'), 'utf-8'));
const zh = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.zh-cn.json'), 'utf-8'));
const props = Object.assign({}, ...pkg.contributes.configuration.map((s) => s.properties || {}));
const nlsOf = (v) => {
  const m = typeof v === 'string' ? /^%([A-Za-z0-9_.-]+)%$/.exec(v) : null;
  return m ? m[1] : undefined;
};
const getter = (map) => ({ get: (k, d) => (Object.prototype.hasOwnProperty.call(map, k) ? map[k] : d) });

// ---------- A. 设置声明 ----------
{
  const section = pkg.contributes.configuration.find((s) => s.title === '%configuration.agent.title%');
  check('A1 Agent 分区存在（order 100）', !!section && section.order === 100, section && section.order);
  check('A2 分区标题双语 nls 齐全',
    !!en[nlsOf(section && section.title)] && !!zh[nlsOf(section && section.title)], nlsOf(section && section.title));

  const enabled = props['codeblocks.agent.enabled'];
  const readOnly = props['codeblocks.agent.readOnly'];
  check('A3 agent.enabled 为 boolean 且默认 true', enabled && enabled.type === 'boolean' && enabled.default === true, enabled && [enabled.type, enabled.default]);
  check('A4 agent.readOnly 为 boolean 且默认 false', readOnly && readOnly.type === 'boolean' && readOnly.default === false, readOnly && [readOnly.type, readOnly.default]);

  const keys = ['agent.enabled', 'agent.readOnly'].flatMap((k) => {
    const p = props['codeblocks.' + k];
    return [nlsOf(p.description), nlsOf(p.markdownDescription)].filter(Boolean);
  });
  check('A5 设置描述为 nls 占位符（description + markdownDescription）', keys.length === 4, keys);
  check('A6 英文 nls 齐全且不含中文',
    keys.every((k) => typeof en[k] === 'string' && en[k].length > 0 && !/[\u4e00-\u9fff]/.test(en[k])),
    keys.filter((k) => !en[k] || /[\u4e00-\u9fff]/.test(en[k])));
  check('A7 中文 nls 齐全', keys.every((k) => typeof zh[k] === 'string' && zh[k].length > 0), keys.filter((k) => !zh[k]));

  for (const rel of ['docs/guide/settings.md', 'docs/guide/settings.en.md', 'docs/guide/agent-control.md', 'docs/guide/agent-control.en.md']) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    check(`A8 ${rel} 覆盖两个设置键`,
      text.includes('codeblocks.agent.enabled') && text.includes('codeblocks.agent.readOnly'), rel);
  }
}

// ---------- B. 策略真值表 ----------
{
  check('B1 enabled 缺省 → true（不因配置缺失锁死）', policy.isAgentEnabled(getter({})) === true);
  check('B2 enabled=true → true', policy.isAgentEnabled(getter({ 'agent.enabled': true })) === true);
  check('B3 enabled=false → false', policy.isAgentEnabled(getter({ 'agent.enabled': false })) === false);
  check('B4 enabled 非法值 → true（按开启处理）', policy.isAgentEnabled(getter({ 'agent.enabled': 'nope' })) === true);

  check('B5 readOnly 缺省 → false', policy.isAgentReadOnly(getter({})) === false);
  check('B6 readOnly=true → true', policy.isAgentReadOnly(getter({ 'agent.readOnly': true })) === true);
  check('B7 readOnly=false → false', policy.isAgentReadOnly(getter({ 'agent.readOnly': false })) === false);
  check('B8 readOnly 非法值 → false', policy.isAgentReadOnly(getter({ 'agent.readOnly': 'yes' })) === false);

  const allowed = [
    ['codeblocks_project_read', {}],
    ['codeblocks_build_status', {}],
    ['codeblocks_compiler', { action: 'list' }],
    ['codeblocks_compiler', { action: 'info' }],
    ['codeblocks_workspace', { action: 'info' }],
    ['codeblocks_workspace', { action: 'deps' }],
    ['codeblocks_workspace', { action: 'list' }],
    ['codeblocks_debug', { action: 'state' }],
  ];
  const denied = [
    ['codeblocks_project_edit', {}],
    ['codeblocks_project_file', { action: 'add' }],
    ['codeblocks_project_target', { action: 'add' }],
    ['codeblocks_build', {}],
    ['codeblocks_run', {}],
    ['codeblocks_export', { kind: 'makefile' }],
    ['codeblocks_compiler', { action: 'set' }],
    ['codeblocks_workspace', { action: 'open' }],
    ['codeblocks_workspace', { action: 'close' }],
    ['codeblocks_workspace', { action: 'setActive' }],
    ['codeblocks_debug', { action: 'start' }],
    ['codeblocks_debug', { action: 'breakpoints' }],
    ['codeblocks_debug', { action: 'evaluate' }],
  ];
  const allowedBad = allowed.filter(([n, i]) => !policy.isReadOnlyToolCall(n, i));
  const deniedBad = denied.filter(([n, i]) => policy.isReadOnlyToolCall(n, i));
  check('B9 只读白名单放行 8 种查询调用', allowedBad.length === 0, allowedBad);
  check('B10 只读模式拒绝 13 种写/执行调用', deniedBad.length === 0, deniedBad);
  check('B11 白名单外的工具默认拒绝', policy.isReadOnlyToolCall('codeblocks_unknown', {}) === false);
  check('B12 提示文案包含设置键',
    policy.READ_ONLY_HINT.includes('codeblocks.agent.readOnly') && policy.AGENT_DISABLED_HINT.includes('codeblocks.agent.enabled'),
    [policy.READ_ONLY_HINT, policy.AGENT_DISABLED_HINT]);
}

// ---------- C. invokeTool 只读拦截（真实 handler） ----------
function freshCopy(tag) {
  const dir = path.join(TMP, tag);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(SRC)) {
    const from = path.join(SRC, entry);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, entry));
  }
  return path.join(dir, 'hello-cb.cbp');
}

const noop = () => undefined;
const output = {
  info: noop, warn: noop, error: noop, debug: noop, trace: noop,
  append: noop, appendLine: noop, clear: noop, show: noop, hide: noop, dispose: noop,
};
const store = require(path.join(ROOT, 'dist', 'api', 'projectStore.js'));
const ctxBase = {
  settings: { get: (_k, d) => d },
  compiler: { resourcesDir: path.join(ROOT, 'resources', 'compilers'), getCompiler: () => { throw new Error('no compiler'); }, resolveTargetCompiler: () => undefined },
  output,
  loadProject: async (cbp) => store.loadProject(cbp),
  saveProject: async (project, opts) => store.saveProject(project, { force: opts.force }),
  build: async () => { throw new Error('build must not run in read-only tests'); },
};

async function expectCode(label, code, fn) {
  try {
    await fn();
    check(label, false, '(no error)');
  } catch (err) {
    check(label, err && err.code === code, err && { code: err.code, message: err.message });
  }
}

(async () => {
  const cbp = freshCopy('ro');
  const before = fs.readFileSync(cbp, 'utf-8');
  const ro = { ...ctxBase, readOnly: true };

  const read = await registry.invokeTool(ro, 'codeblocks_project_read', { cbp, section: 'summary' });
  check('C1 只读：project_read 放行', read && read.summary && read.summary.title === 'hello-cb', read && read.summary);

  const compilers = await registry.invokeTool(ro, 'codeblocks_compiler', { action: 'list' });
  check('C2 只读：compiler list 放行', compilers && Array.isArray(compilers.compilers) && compilers.compilers.length > 0, compilers && compilers.compilers && compilers.compilers.slice(0, 3));

  await expectCode('C3 只读：project_edit 被拒（read-only）', 'read-only', () => registry.invokeTool(
    ro,
    'codeblocks_project_edit',
    { cbp, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'nope' }] },
  ));
  await expectCode('C4 只读：build 被拒', 'read-only', () => registry.invokeTool(ro, 'codeblocks_build', { cbp }));
  await expectCode('C5 只读：compiler set 被拒', 'read-only', () => registry.invokeTool(ro, 'codeblocks_compiler', { action: 'set', compilerId: 'gcc' }));
  await expectCode('C6 只读：workspace open 被拒', 'read-only', () => registry.invokeTool(ro, 'codeblocks_workspace', { action: 'open', project: cbp }));

  const after = fs.readFileSync(cbp, 'utf-8');
  check('C7 只读期间工程文件字节不变', before === after);

  const rw = { ...ctxBase };
  const edited = await registry.invokeTool(rw, 'codeblocks_project_edit', {
    cbp,
    ops: [{ op: 'set', scope: 'project', field: 'title', value: 'allowed' }],
  });
  check('C8 非只读 ctx 仍可写（开关不误伤默认行为）', edited && edited.written === true && store.loadProject(cbp).title === 'allowed', edited);

  // ---------- D. MCP 暴露计划 ----------
  const plan = (enabled, scriptExists) => provider.planMcpServer({
    enabled, scriptExists, script: 'C:/ext/bundle/cb-mcp.js', execPath: 'node.exe', version: '0.0.0',
  });
  check('D1 enabled=false → 不暴露 MCP', plan(false, true) === undefined);
  check('D2 脚本缺失 → 不暴露 MCP', plan(true, false) === undefined);
  const ok = plan(true, true);
  check('D3 enabled=true 且有脚本 → 暴露（command/args 正确）',
    !!ok && ok.command === 'node.exe' && ok.args[0] === 'C:/ext/bundle/cb-mcp.js', ok);

  fs.rmSync(TMP, { recursive: true, force: true });
  mock.restore();
  console.log(`\nAgent 开关回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
