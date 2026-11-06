// MCP server 协议回归：initialize → tools/list → tools/call（成功 + 错误分支 + 开关/只读门控）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'dist', 'mcp', 'server.js');
const CBP = path.join(ROOT, 'test-project', 'hello-cb.cbp');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

(async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    stderr: 'pipe',
  });
  const client = new Client({ name: 'cb-mcp-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  const list = await client.listTools();
  const names = list.tools.map((t) => t.name);
  check('M1 握手并列出工具', names.length === 11, names);
  check('M2 关键工具存在', ['codeblocks_project_read', 'codeblocks_project_edit', 'codeblocks_build', 'codeblocks_debug'].every((n) => names.includes(n)), names);
  check('M3 工具带 JSON Schema', list.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));

  const ok = await client.callTool({ name: 'codeblocks_project_read', arguments: { cbp: CBP, section: 'summary' } });
  const text = ok.content?.[0]?.text ?? '';
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = undefined; }
  check('M4 调用成功且返回 JSON', ok.isError !== true && !!parsed && parsed.summary.title === 'hello-cb', text.slice(0, 160));

  const bad = await client.callTool({ name: 'codeblocks_project_read', arguments: { cbp: path.join(ROOT, 'nope.cbp') } });
  check('M5 错误以 isError 返回', bad.isError === true && /project-not-found/.test(bad.content?.[0]?.text ?? ''), (bad.content?.[0]?.text ?? '').slice(0, 160));

  const unknown = await client.callTool({ name: 'codeblocks_unknown', arguments: {} });
  check('M6 未知工具报错', unknown.isError === true && /Unknown tool/.test(unknown.content?.[0]?.text ?? ''));

  await client.close();

  /** 用给定工作区设置启动一个独立 server（cwd 指向临时工作区，隔离用户设置） */
  const startWith = async (settings) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mcp-off-'));
    fs.mkdirSync(path.join(dir, '.vscode'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.vscode', 'settings.json'), JSON.stringify(settings), 'utf-8');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER],
      cwd: dir,
      env: { ...process.env, APPDATA: dir },
      stderr: 'pipe',
    });
    const c = new Client({ name: 'cb-mcp-test', version: '1.0.0' }, { capabilities: {} });
    await c.connect(transport);
    return { c, dir };
  };

  const off = await startWith({ 'codeblocks.agent.enabled': false });
  try {
    const offList = await off.c.listTools();
    check('M7 总闸关闭 → tools/list 为空', offList.tools.length === 0, offList.tools.length);
    const denied = await off.c.callTool({ name: 'codeblocks_project_read', arguments: { cbp: CBP, section: 'summary' } });
    check('M8 总闸关闭 → 调用返回 disabled',
      denied.isError === true && /disabled/.test(denied.content?.[0]?.text ?? ''), (denied.content?.[0]?.text ?? '').slice(0, 160));
  } finally {
    await off.c.close();
    fs.rmSync(off.dir, { recursive: true, force: true });
  }

  const ro = await startWith({ 'codeblocks.agent.readOnly': true });
  try {
    const roRead = await ro.c.callTool({ name: 'codeblocks_project_read', arguments: { cbp: CBP, section: 'summary' } });
    check('M9 只读模式 → 查询仍可用', roRead.isError !== true, (roRead.content?.[0]?.text ?? '').slice(0, 120));
    const roEdit = await ro.c.callTool({
      name: 'codeblocks_project_edit',
      arguments: { cbp: CBP, ops: [{ op: 'set', scope: 'project', field: 'title', value: 'nope' }] },
    });
    check('M10 只读模式 → 写操作返回 read-only',
      roEdit.isError === true && /read-only/.test(roEdit.content?.[0]?.text ?? ''), (roEdit.content?.[0]?.text ?? '').slice(0, 160));
  } finally {
    await ro.c.close();
    fs.rmSync(ro.dir, { recursive: true, force: true });
  }
})().then(() => {
  console.log(`\nMCP server: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}).catch((err) => {
  console.error('MCP server test failed:', err);
  process.exit(1);
});
