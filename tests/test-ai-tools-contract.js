// 契约：package.json 的 LM Tools / MCP 声明 == 代码里的工具注册表
const fs = require('fs');
const path = require('path');
const { installVscodeShim } = require('../dist/cli/vscodeShim');

const ROOT = path.resolve(__dirname, '..');
installVscodeShim({ settings: { get: (_k, d) => d }, write: () => undefined });
const { TOOL_DEFINITIONS } = require('../dist/api/toolRegistry');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const manifest = pkg.contributes?.languageModelTools || [];
check('L1 声明了 11 个 LM Tools', manifest.length === 11, manifest.length);
check('L2 代码注册表同数', TOOL_DEFINITIONS.length === manifest.length, TOOL_DEFINITIONS.length);

const codeNames = TOOL_DEFINITIONS.map((t) => t.name);
const manifestNames = manifest.map((t) => t.name);
check('L3 名称与顺序一致', JSON.stringify(codeNames) === JSON.stringify(manifestNames), { codeNames, manifestNames });

const nameRe = /^(?!copilot_|vscode_)[\w-]+$/;
const badNames = codeNames.filter((n) => !nameRe.test(n));
check('L4 工具名符合 VS Code 规则（\\w 与 -，且不以 copilot_/vscode_ 开头）', badNames.length === 0, badNames);

const refRe = /^[\w-]+$/;
for (const tool of manifest) {
  const code = TOOL_DEFINITIONS.find((t) => t.name === tool.name);
  check(`L5 ${tool.name} inputSchema 与注册表一致`, !!code && JSON.stringify(code.inputSchema) === JSON.stringify(tool.inputSchema));
  check(`L6 ${tool.name} 必填字段完整`, typeof tool.displayName === 'string' && typeof tool.modelDescription === 'string' && tool.modelDescription.length > 20);
  check(`L7 ${tool.name} 可引用时必有 toolReferenceName`, !tool.canBeReferencedInPrompt || (typeof tool.toolReferenceName === 'string' && refRe.test(tool.toolReferenceName)), tool.toolReferenceName);
  check(`L8 ${tool.name} nls 占位符`, /^%[A-Za-z0-9_.-]+%$/.test(tool.displayName) && /^%[A-Za-z0-9_.-]+%$/.test(tool.userDescription));
}

const providers = pkg.contributes?.mcpServerDefinitionProviders || [];
check('M1 声明了 MCP provider', providers.length === 1 && providers[0].id === 'codeblocks', providers);
check('M2 provider label 走 nls', /^%[A-Za-z0-9_.-]+%$/.test(providers[0]?.label || ''), providers[0]?.label);

const { planMcpServer } = require('../dist/mcp/provider');
const planBase = { enabled: true, scriptExists: true, script: 'C:/x/bundle/cb-mcp.js', execPath: 'C:/x/Code.exe' };
const planWithCwd = planMcpServer({ ...planBase, cwd: 'C:/work' });
check('M3 planMcpServer 透传 cwd（工作区级设置锚点）', planWithCwd?.cwd === 'C:/work', planWithCwd);
check('M4 planMcpServer 未给工作区时 cwd 为空', planMcpServer({ ...planBase }).cwd === undefined, planMcpServer({ ...planBase }));
check('M5 planMcpServer 关闭时不暴露', planMcpServer({ ...planBase, enabled: false }) === undefined);

const capabilities = pkg.capabilities || {};
check('M6 声明 capabilities.untrustedWorkspaces.supported:false（Restricted Mode 整体不激活）',
  capabilities.untrustedWorkspaces?.supported === false, capabilities.untrustedWorkspaces);
const nlsEn = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.nls.json'), 'utf-8'));
check('M7 trust 说明走 nls 且非空',
  typeof nlsEn['capabilities.untrustedWorkspaces.description'] === 'string'
  && nlsEn['capabilities.untrustedWorkspaces.description'].trim().length > 0);

const scripts = pkg.scripts || {};
check('B1 bundle:cli 使用 --external:vscode', String(scripts['bundle:cli']).includes('--external:vscode') && String(scripts['bundle:cli']).includes('bundle/cb-cli.js'));
check('B2 bundle:mcp 使用 --external:vscode', String(scripts['bundle:mcp']).includes('--external:vscode') && String(scripts['bundle:mcp']).includes('bundle/cb-mcp.js'));
check('B3 prepublish 构建 agent bundle', String(scripts['vscode:prepublish']).includes('bundle:agent'));
check('B4 SDK 只在 devDependencies（运行时全部内联）', !!pkg.devDependencies['@modelcontextprotocol/sdk'] && pkg.dependencies === undefined, {
  sdk: pkg.devDependencies['@modelcontextprotocol/sdk'], dependencies: pkg.dependencies,
});

console.log(`\nAgent 工具契约: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
