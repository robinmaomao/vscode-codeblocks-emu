// 宿主集成：Agent 控制面（LM Tools 声明与注册、MCP provider 声明）
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { suite } = require('./framework');
const U = require('./hostUtil');

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

  // ---- Agent 全链路：改 .cbp → 构建 → 读构建状态（真实工具链） ----
  const callTool = async (name, input) => {
    const result = await vscode.lm.invokeTool(name, { input }, undefined);
    const text = (result.content || [])
      .filter((part) => part instanceof vscode.LanguageModelTextPart)
      .map((part) => part.value)
      .join('');
    return JSON.parse(text);
  };

  t.test('invokeTool 改 .cbp → 构建 → 构建状态（Agent 全链路）', async (ctx) => {
    if (!U.findTool('gcc')) {
      console.log('SKIP 宿主内 Agent 构建：未找到 gcc');
      ctx.skip();
    }
    const ws = U.workspaceDir();
    if (!ws) {
      console.log('SKIP 宿主内 Agent 构建：无工作区文件夹');
      ctx.skip();
    }
    const projDir = path.join(ws, 'cb-agent-build');
    fs.rmSync(projDir, { recursive: true, force: true });
    const cbp = U.copyHelloProject(projDir, 'hello-cb');
    const exePath = path.join(projDir, 'bin', 'Debug', 'hello.exe');
    await U.setConfig('clangd.enabled', false);
    try {
      const edit = await callTool('codeblocks_project_edit', {
        cbp,
        ops: [{ op: 'add', scope: 'target', target: 'Debug', field: 'compilerOptions', value: '-DAGENT_TOOL_PROBE' }],
      });
      assert.strictEqual(edit.ok, true, JSON.stringify(edit));
      assert.strictEqual(edit.written, true, '编辑未写盘');

      const read = await callTool('codeblocks_project_read', { cbp, section: 'targets', target: 'Debug' });
      assert.ok(read.targets[0].compilerOptions.includes('-DAGENT_TOOL_PROBE'), '编辑结果未读回');

      assert.ok(!fs.existsSync(exePath), '前置失败：产物已存在');
      const build = await U.withTimeout(
        callTool('codeblocks_build', { cbp, target: 'Debug' }),
        170000,
        'codeblocks_build',
      );
      assert.strictEqual(build.ok, true, `构建失败：${JSON.stringify(build.summary && build.summary.errorCount)}`);
      assert.strictEqual(build.target, 'Debug');
      const built = await U.waitFor(() => (fs.existsSync(exePath) ? exePath : undefined), 20000);
      assert.ok(built, `构建结束但产物不存在：${exePath}`);

      const status = await callTool('codeblocks_build_status', { cbp });
      assert.strictEqual(status.ok, true, JSON.stringify(status).slice(0, 200));
      assert.ok(Array.isArray(status.projects) && status.projects.length === 1, '构建状态缺少本项目摘要');
      assert.strictEqual(status.projects[0].success, true);
    } finally {
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  // ---- 调试桥：无会话时的状态语义（扩展侧 vscode.debug 接线） ----
  t.test('invokeTool codeblocks_debug：state=inactive / stop=not-running', async () => {
    const state = await callTool('codeblocks_debug', { action: 'state' });
    assert.strictEqual(state.active, false, `预期无活动会话：${JSON.stringify(state)}`);

    const stopped = await callTool('codeblocks_debug', { action: 'stop' });
    assert.strictEqual(stopped.ok, false, '无会话 stop 应返回错误');
    assert.strictEqual(stopped.error && stopped.error.code, 'not-running', JSON.stringify(stopped));
  });

  // ---- 总闸：关闭后调用被拒，重开恢复（无需重载窗口） ----
  // 注意：`vscode.lm.tools` 是宿主的快照，注销后可能滞后到重载窗口才刷新；
  // 用户可见语义以「能否调用」为准，故断言放在 invokeTool 上。
  t.test('开关 agent.enabled：关闭 → 调用被拒；重开 → 恢复', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const cbp = path.join(process.env.CB_REPO_ROOT || ext.extensionPath, 'test-project', 'hello-cb.cbp');
    const canRead = async () => {
      try {
        const r = await vscode.lm.invokeTool('codeblocks_project_read', { input: { cbp, section: 'summary' } }, undefined);
        const text = (r.content || [])
          .filter((p) => p instanceof vscode.LanguageModelTextPart)
          .map((p) => p.value)
          .join('');
        return JSON.parse(text).summary?.title === 'hello-cb';
      } catch {
        return false;
      }
    };
    assert.ok(await canRead(), '前置：工具应可调用');

    try {
      await U.setConfig('agent.enabled', false);
      const denied = await U.waitFor(async () => ((await canRead()) ? undefined : true), 15000);
      assert.ok(denied, '关闭后工具仍可调用（应报未知工具）');
    } finally {
      await U.setConfig('agent.enabled', true);
    }

    const back = await U.waitFor(canRead, 15000);
    assert.ok(back, '重新开启后工具未恢复');
    const snapshot = (vscode.lm.tools || []).filter((x) => EXPECTED.includes(x.name)).length;
    console.log(`[probe] 开关切换完成；lm.tools 快照=${snapshot}（快照可能滞后到重载窗口）`);
  });

  // ---- 只读模式：写/执行被拒且提示设置键，查询类仍可用 ----
  t.test('只读模式 agent.readOnly：build 返回 read-only，project_read 仍可用', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    const cbp = path.join(process.env.CB_REPO_ROOT || ext.extensionPath, 'test-project', 'hello-cb.cbp');
    try {
      await U.setConfig('agent.readOnly', true);
      const denied = await U.waitFor(async () => {
        const r = await callTool('codeblocks_build', { cbp, dryRun: true });
        return r && r.ok === false && r.error && r.error.code === 'read-only' ? r : undefined;
      }, 15000);
      assert.ok(denied, '只读模式下 build 未被拒绝');
      assert.ok(String(denied.error.details && denied.error.details.hint || '').includes('codeblocks.agent.readOnly'),
        '只读错误缺少解除提示');

      const read = await callTool('codeblocks_project_read', { cbp, section: 'summary' });
      assert.strictEqual(read.summary.title, 'hello-cb', '只读模式下 project_read 应仍可用');
    } finally {
      await U.setConfig('agent.readOnly', false);
    }

    const allowed = await U.waitFor(async () => {
      const r = await callTool('codeblocks_build', { cbp, dryRun: true });
      return r && r.ok === true && r.dryRun === true ? r : undefined;
    }, 15000);
    assert.ok(allowed, '关闭只读模式后 build 仍被拒绝');
  });
});
