// 宿主集成：Agent 工程编辑 → 工作区历史快照 → 直接撤销（不经过 QuickPick/modal）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { suite } = require('./framework');
const U = require('./hostUtil');

const EXT_ID = 'robinmaomao.codeblocks-vscode';

async function callTool(name, input) {
  const result = await vscode.lm.invokeTool(name, { input }, undefined);
  const text = (result.content || [])
    .filter((part) => part instanceof vscode.LanguageModelTextPart)
    .map((part) => part.value)
    .join('');
  return JSON.parse(text);
}

suite('宿主集成 · Agent 变更历史', (t) => {
  t.test('project_edit 生成历史并可字节级撤销', async (ctx) => {
    const ws = U.workspaceDir();
    if (!ws) {
      console.log('SKIP Agent 历史：无工作区文件夹');
      ctx.skip();
    }
    const ext = vscode.extensions.getExtension(EXT_ID);
    const info = await vscode.commands.executeCommand('codeblocks.agent.historyInfo');
    if (!info || !info.available || !info.root) {
      console.log('SKIP Agent 历史：扩展存储不可用');
      ctx.skip();
    }

    const projDir = path.join(ws, 'cb-agent-history');
    fs.rmSync(projDir, { recursive: true, force: true });
    const cbp = U.copyHelloProject(projDir, 'hello-cb');
    const before = fs.readFileSync(cbp);
    await U.setConfig('agent.history.enabled', true);
    const { AgentHistoryStore } = require(path.join(ext.extensionPath, 'dist', 'agent', 'historyStore.js'));
    const store = new AgentHistoryStore({ rootDir: info.root, workspaceRoots: [ws] });
    await store.clear();
    try {
      const edit = await callTool('codeblocks_project_edit', {
        cbp,
        ops: [{ op: 'set', scope: 'project', field: 'title', value: 'history-host' }],
      });
      assert.strictEqual(edit.ok, true, JSON.stringify(edit));
      assert.strictEqual(edit.written, true, '编辑未写盘');

      const entries = store.list();
      assert.strictEqual(entries.length, 1, `历史条数=${entries.length}`);
      assert.strictEqual(entries[0].file, path.resolve(cbp));
      assert.strictEqual(entries[0].status, 'applied');
      assert.ok(fs.existsSync(path.join(store.root, entries[0].snapshot)), '快照不存在');
      assert.notStrictEqual(fs.readFileSync(cbp).toString('utf8'), before.toString('utf8'));

      const undone = await store.undo(entries[0].id);
      assert.strictEqual(undone.entry.id, entries[0].id);
      assert.ok(fs.readFileSync(cbp).equals(before), '撤销后字节不一致');
      assert.strictEqual(store.list()[0].status, 'undone');
    } finally {
      await store.clear().catch(() => undefined);
      fs.rmSync(projDir, { recursive: true, force: true });
    }
  });

  t.test('两个历史命令已注册', async () => {
    const ids = await vscode.commands.getCommands(true);
    assert.ok(ids.includes('codeblocks.agent.history'), '缺少 Agent Change History 命令');
    assert.ok(ids.includes('codeblocks.agent.undoLast'), '缺少 Undo Last Agent Change 命令');
  });
});
