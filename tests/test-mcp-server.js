// MCP server 协议回归：initialize → tools/list → tools/call（成功 + 错误分支）
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
})().then(() => {
  console.log(`\nMCP server: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}).catch((err) => {
  console.error('MCP server test failed:', err);
  process.exit(1);
});
