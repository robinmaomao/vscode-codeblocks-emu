// 宿主集成：扩展激活、贡献面（命令/视图/设置/语言）、无工程时的优雅降级、隔离 keybindings 写入
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vscode = require('vscode');
const { suite } = require('./framework');

const EXT_ID = 'robinmaomao.codeblocks-vscode';
// suite 运行时被复制到临时目录，仓库根与隔离 user-data 由启动器通过 extensionTestsEnv 注入
const extForRoot = vscode.extensions.getExtension(EXT_ID);
const repoRoot = process.env.CB_REPO_ROOT || (extForRoot ? extForRoot.extensionPath : path.resolve(__dirname, '..', '..', '..'));
const userDataDir = process.env.CB_HOST_USER_DATA || '';
const userDir = userDataDir ? path.join(userDataDir, 'User') : '';
const userKeybindings = userDir ? path.join(userDir, 'keybindings.json') : '';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/** 触发可能弹出 QuickPick 的命令：不等待其 promise（等待 UI 会永久挂起），超时后强制关闭 UI */
async function fireUiCommand(command, { settleMs = 1200 } = {}) {
  let state = 'pending';
  const p = vscode.commands.executeCommand(command).then(
    () => { state = 'ok'; },
    (err) => { state = 'error:' + (err && err.message ? err.message : err); },
  );
  await delay(settleMs);
  await vscode.commands.executeCommand('workbench.action.closeQuickOpen').then(undefined, () => undefined);
  await delay(150);
  void p;
  return state;
}

const pkg = () => {
  const ext = vscode.extensions.getExtension(EXT_ID);
  assert.ok(ext, `未找到扩展 ${EXT_ID}`);
  return ext.packageJSON;
};

suite('宿主集成 · 激活与贡献面', (t) => {
  t.test('扩展已激活（isActive）', async () => {
    const ext = vscode.extensions.getExtension(EXT_ID);
    assert.ok(ext, '扩展未加载');
    if (!ext.isActive) await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  t.test('全部贡献命令均已注册', async () => {
    const contributed = (pkg().contributes.commands || []).map((c) => c.command);
    assert.ok(contributed.length >= 100, `贡献命令数异常：${contributed.length}`);
    const all = new Set(await vscode.commands.getCommands(true));
    const missing = contributed.filter((c) => !all.has(c));
    assert.deepStrictEqual(missing, [], `未注册命令：${missing.join(', ')}`);
  });

  t.test('运行时内部命令也存在（视图焦点/动态菜单入口）', async () => {
    const all = new Set(await vscode.commands.getCommands(true));
    for (const id of ['codeblocks.projectTree.focus', 'codeblocks.buildLog.focus', 'codeblocks.menu.show', 'codeblocks.setActiveProject']) {
      assert.ok(all.has(id), `缺少内部命令 ${id}`);
    }
  });

  t.test('5 个视图可通过 <viewId>.focus 命令聚焦', async () => {
    for (const viewId of ['codeblocks.projectTree', 'codeblocks.symbols', 'codeblocks.analysis', 'codeblocks.buildLog', 'codeblocks.debug.registers']) {
      await vscode.commands.executeCommand(`${viewId}.focus`);
    }
  });

  t.test('全部设置项可读且默认值已定义', () => {
    const cfg = vscode.workspace.getConfiguration('codeblocks');
    const blocks = pkg().contributes.configuration;
    const keys = Object.keys(Object.assign({}, ...blocks.map((b) => b.properties || {})));
    assert.ok(keys.length >= 55, `设置项数异常：${keys.length}`);
    const bad = keys.filter((k) => cfg.get(k.replace(/^codeblocks\./, '')) === undefined);
    assert.deepStrictEqual(bad, [], `以下设置项默认值缺失：${bad.join(', ')}`);
  });

  t.test('语言 ld/asm/xm 已注册且语法可关联', async () => {
    const langs = await vscode.languages.getLanguages();
    for (const id of ['ld', 'asm', 'xm']) assert.ok(langs.includes(id), `语言 ${id} 未注册`);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-host-syntax-'));
    try {
      const cases = [
        ['a.ld', 'ld', 'SECTIONS { }\n'],
        ['a.S', 'asm', '\t.text\n'],
        ['a.xm', 'xm', 'MODULE x\n'],
      ];
      for (const [name, lang, content] of cases) {
        const p = path.join(tmp, name);
        fs.writeFileSync(p, content, 'utf-8');
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(p));
        assert.strictEqual(doc.languageId, lang, `${name} 语言应为 ${lang}，实际 ${doc.languageId}`);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

suite('宿主集成 · 无工程时的优雅降级', (t) => {
  t.test('构建/运行类命令在无工程时不抛异常', async () => {
    for (const cmd of [
      'codeblocks.build', 'codeblocks.rebuild', 'codeblocks.clean', 'codeblocks.run',
      'codeblocks.buildWorkspace', 'codeblocks.cleanWorkspace', 'codeblocks.rebuildWorkspace',
      'codeblocks.selectTarget', 'codeblocks.selectProjectTarget',
    ]) {
      await vscode.commands.executeCommand(cmd);
    }
  });

  t.test('面板与工具类命令在无工程时不抛异常', async () => {
    for (const cmd of [
      'codeblocks.projectProperties', 'codeblocks.fileProperties', 'codeblocks.compilerOptions',
      'codeblocks.analysis.refresh', 'codeblocks.codeStats', 'codeblocks.todoList',
      'codeblocks.buildLog.clearOutput', 'codeblocks.buildLog.showAllMessages',
      'codeblocks.resetViewLayout', 'codeblocks.toggleCategorize',
      'codeblocks.showCompilerCommands', 'codeblocks.showGlobalVariables',
      'codeblocks.compileCurrentFile', 'codeblocks.clearErrors', 'codeblocks.nextError', 'codeblocks.prevError',
    ]) {
      await vscode.commands.executeCommand(cmd);
    }
  });

  t.test('调试辅助命令在无会话时不抛异常', async () => {
    for (const cmd of [
      'codeblocks.debug.refreshRegisters', 'codeblocks.debug.setNextStatement',
      'codeblocks.debug.infoFrame', 'codeblocks.debug.infoFiles',
    ]) {
      await vscode.commands.executeCommand(cmd);
    }
  });
});

suite('宿主集成 · keybindings 托管写入（隔离 user-data-dir）', (t) => {
  const overrides = () => vscode.workspace.getConfiguration('codeblocks').get('keybindings.overrides');
  const readFileEntries = () => {
    if (!userKeybindings || !fs.existsSync(userKeybindings)) return [];
    const parsed = JSON.parse(fs.readFileSync(userKeybindings, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  };

  t.test('冲突检测命令可执行（QuickPick 需 UI，触发后强制关闭）', async (ctx) => {
    if (!userDataDir) ctx.skip();
    const state = await fireUiCommand('codeblocks.keybindings.check');
    assert.ok(state === 'ok' || state === 'pending', `命令异常结束：${state}`);
  });

  t.test('应用覆盖：写入 <user-data>/User/keybindings.json 并生成托管条目', async (ctx) => {
    if (!userDataDir) ctx.skip();
    const cfg = vscode.workspace.getConfiguration('codeblocks');
    await cfg.update('keybindings.overrides', { build: 'ctrl+alt+f9' }, vscode.ConfigurationTarget.Global);
    try {
      await vscode.commands.executeCommand('codeblocks.keybindings.apply');
      assert.ok(fs.existsSync(userKeybindings), `未生成 ${userKeybindings}`);
      const entries = readFileEntries();
      const positive = entries.find((e) => e.command === 'codeblocks.build');
      assert.ok(positive, `缺少 codeblocks.build 条目：${JSON.stringify(entries)}`);
      assert.strictEqual(positive.key.toLowerCase(), 'ctrl+alt+f9');
      // 覆盖了默认键时，应对默认键生成移除规则
      const removal = entries.find((e) => e.command === '-codeblocks.build');
      assert.ok(removal, '缺少对默认键 ctrl+f9 的移除规则');
    } finally {
      await cfg.update('keybindings.overrides', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  t.test('重置：清除文件中的托管条目并清空覆盖设置', async (ctx) => {
    if (!userDataDir) ctx.skip();
    const cfg = vscode.workspace.getConfiguration('codeblocks');
    await cfg.update('keybindings.overrides', { run: 'ctrl+alt+f10' }, vscode.ConfigurationTarget.Global);
    await vscode.commands.executeCommand('codeblocks.keybindings.apply');
    assert.ok(readFileEntries().some((e) => e.command === 'codeblocks.run'), '前置写入失败');

    await vscode.commands.executeCommand('codeblocks.keybindings.reset');
    const managed = readFileEntries().filter((e) => String(e.command).includes('codeblocks.'));
    assert.deepStrictEqual(managed, [], `重置后仍残留托管条目：${JSON.stringify(managed)}`);
    const after = overrides();
    assert.ok(after === undefined || Object.keys(after).length === 0, `覆盖设置未清空：${JSON.stringify(after)}`);
  });
});

suite('宿主集成 · 仓库探针工程（工程打开依赖 UI 交互，此处做静态核对）', (t) => {
  t.test('test-project 结构完整（3 个 .cbp + 1 个 .workspace）', () => {
    const tp = path.join(repoRoot, 'test-project');
    for (const f of ['hello-cb.cbp', 'dep-lib/dep-lib.cbp', 'dep-app/dep-app.cbp', 'dep-test.workspace']) {
      assert.ok(fs.existsSync(path.join(tp, f)), `缺少 ${f}（repoRoot=${repoRoot}）`);
    }
  });

  t.test('调试目标可执行文件存在（宿主调试用例依赖）', () => {
    const exe = path.join(repoRoot, 'test-project', 'bin', 'Debug', 'hello.exe');
    assert.ok(fs.existsSync(exe), `缺少 ${exe}（先运行 npm run test:e2e）`);
  });
});
