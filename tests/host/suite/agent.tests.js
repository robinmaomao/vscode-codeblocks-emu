// 宿主集成：Agent 控制面（LM Tools 声明与注册、MCP provider 声明）
const assert = require('assert');
const vscode = require('vscode');
const { suite } = require('./framework');

const EXT_ID = 'robinmaomao.codeblocks-vscode';
const EXPECTED = [
  'codeblocks_project_read',
  'codeblocks_project_edit',
  'codeblocks_project_file',
  'codeblocks_project_target',
  'codeblocks_build',
  'codeblocks_build_status',
  'codeblocks_run',
  'codeblocks_debug',
  'codeblocks_compiler',
  'codeblocks_export',
  'codeblocks_workspace',
];

suite('宿主集成 · Agent 控制面', (t) => {
  t.test('清单声明 11 个 languageModelTools', () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, `未找到扩展 ${EXT_ID}`);
    const tools = ext.packageJSON.contributes?.languageModelTools || [];
    assert.strictEqual(tools.length, 11);
    assert.deepStrictEqual(tools.map((x) => x.name), EXPECTED);
    for (const tool of tools) {
      assert.match(tool.name, /^(?!copilot_|vscode_)[\w-]+$/);
      assert.ok(tool.modelDescription && tool.modelDescription.length > 20, `${tool.name} 缺少 modelDescription`);
      assert.strictEqual(tool.inputSchema?.type, 'object', `${tool.name} inputSchema 必须是 object`);
    }
  });

  t.test('vscode.lm.tools 已包含全部工具', () => {
    const names = new Set((vscode.lm.tools || []).map((x) => x.name));
    const missing = EXPECTED.filter((n) => !names.has(n));
    assert.deepStrictEqual(missing, [], `缺少工具：${missing.join(', ')}`);
  });

  t.test('清单声明 MCP provider 且 API 可用', () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const providers = ext.packageJSON.contributes?.mcpServerDefinitionProviders || [];
    assert.strictEqual(providers.length, 1);
    assert.strictEqual(providers[0].id, 'codeblocks');
    assert.strictEqual(typeof vscode.lm.registerMcpServerDefinitionProvider, 'function');
  });

  t.test('invokeTool 端到端可调用（project_read）', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const root = process.env.CB_REPO_ROOT || ext.extensionPath;
    const cbp = require('path').join(root, 'test-project', 'hello-cb.cbp');
    // 宿主内直接调用（token 在真实聊天中由 VS Code 注入；这里传 undefined 等价于无会话上下文）
    const result = await vscode.lm.invokeTool('codeblocks_project_read', { input: { cbp, section: 'summary' } }, undefined);
    const text = (result.content || [])
      .filter((part) => part instanceof vscode.LanguageModelTextPart)
      .map((part) => part.value)
      .join('');
    const data = JSON.parse(text);
    assert.strictEqual(data.summary.title, 'hello-cb');
    assert.strictEqual(data.summary.targetCount, 2);
  });
});
