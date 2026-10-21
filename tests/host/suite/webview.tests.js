// 宿主集成：WebView 面板（真实宿主内创建 + 可观测行为断言）
//
// 观测边界（为什么不做 DOM 断言 —— 实测结论，勿轻易改写）：
//  1. WebView 的 HTML/脚本运行在独立渲染进程的 iframe 内，扩展宿主 API **不提供**任何读取/注入通道：
//     - `vscode.window.tabGroups` 对 webview 只暴露 `TabInputWebview.viewType` 与标签标题；
//       且实测 `tabGroups.all[].tabs` 查询不可靠（常返回空/滞后），须以 `onDidChangeTabs` 事件流为主要观测源；
//     - 没有 API 能向 webview postMessage，或读取 webview → 宿主的消息；
//     - `workbench.action.webview.openDeveloperTools` 只弹出独立 DevTools 窗口，测试进程读不到其内容。
//     故本用例断言「标签页存在性 / viewType / 标签标题 / 单例行为 / 关闭-再打开 / 宿主状态未被破坏」；
//     webview 消息协议（ready/state/set/clear/apply…）仍由视觉层（tests/visual）与单元层（tests/test-*）覆盖。
//  2. 工程相关面板依赖「已打开工程」。宿主内**不能**用文件对话框打开工程
//     （codeblocks.openProject 会弹系统文件选择框，无法自动驾驶），改用
//     `codeblocks.openRecentProject <abs path>`：src/extension.ts 中该命令的处理器签名为 (filename?: string)。
//     打开结果的可观测代理 = 扩展输出通道落盘日志中的「已打开项目: <title>」行
//     （见 hostUtil.js 的 readExtensionLog；由启动器预置 codeblocks.build.persistLog=true）。
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { suite } = require('./framework');
const U = require('./hostUtil');

const KB_PANEL = 'codeblocks.keybindings';
const OPT_PANEL = 'codeblocks.compilerOptions';
const PROP_PANEL = 'codeblocks.projectProperties';
const WEBVIEW_PROJ_TITLE = 'cb-host-webview-proj'; // 唯一标题：便于从输出日志中无歧义识别本用例打开/构建的工程

suite('宿主集成 · WebView 面板（真实宿主内创建与消息协议边界）', (t) => {
  t.test('codeblocks.keybindings.panel → 创建 codeblocks.keybindings WebView 标签页（重复执行保持单例）', async () => {
    // 观测手段：tabGroups 的 onDidChangeTabs 事件流（TabInputWebview.viewType/label）+ tabGroups 查询（双源，详见 hostUtil.js）
    await vscode.commands.executeCommand('codeblocks.keybindings.panel');
    const tab = await U.waitForWebviewTab(KB_PANEL, 15000);
    assert.ok(tab, `未观察到 ${KB_PANEL} WebView 标签页（观测手段：tabGroups 事件流/查询中的 TabInputWebview）`);
    assert.strictEqual(tab.label, 'Code::Blocks 快捷键设置', `标签标题异常：${tab.label}`);

    // 单例：KeybindingPanel.show 复用既有实例（再次执行命令不应出现第二个同 viewType 标签页）
    await vscode.commands.executeCommand('codeblocks.keybindings.panel');
    await U.delay(800);
    assert.strictEqual(U.tabsOfViewType(KB_PANEL).length, 1, '重复打开产生了多个快捷键面板标签页（单例被破坏）');
  });

  t.test('面板可关闭再打开：关闭后标签页消失，重新执行命令后恢复（宿主 dispose → 重建）', async () => {
    const closed = await U.closeWebviewTab(KB_PANEL);
    assert.ok(closed, '快捷键面板标签页未能关闭（观测手段：tabGroups.close 后轮询事件流登记表/查询）');
    await vscode.commands.executeCommand('codeblocks.keybindings.panel');
    const tab = await U.waitForWebviewTab(KB_PANEL, 15000);
    assert.ok(tab, '关闭后重新打开未恢复标签页（面板重建路径异常）');
  });

  t.test('面板打开期间宿主设置往返：面板保持打开、扩展状态未被破坏、keybindings 托管写入仍生效', async (ctx) => {
    // 宿主内无法向 webview 注入消息（见文件头），因此用「宿主侧等价动作」验证同一批 Host 回调：
    // webview 的 set/apply 等消息最终落到 host.setOverride()/host.apply()（src/ui/keybindingPanel.ts），
    // 这里直接改设置 + 执行托管写入命令，断言面板存活（设置变更 → KeybindingPanel.refreshIfOpen() 的 host→webview postMessage 往返不破坏 webview）。
    if (!process.env.CB_HOST_USER_DATA) {
      console.log('SKIP keybindings 文件断言：未注入 CB_HOST_USER_DATA（隔离 user-data 缺失）');
      ctx.skip();
    }
    await vscode.commands.executeCommand('codeblocks.keybindings.panel');
    assert.ok(await U.waitForWebviewTab(KB_PANEL, 10000), '前置：快捷键面板应已打开');

    const userKeybindings = path.join(process.env.CB_HOST_USER_DATA, 'User', 'keybindings.json');
    try {
      await U.setConfig('keybindings.overrides', { build: 'ctrl+alt+f9' });
      await U.delay(1000); // 设置变更 → 扩展刷新面板（postMessage 往返窗口）
      await vscode.commands.executeCommand('codeblocks.keybindings.apply');

      assert.ok(fs.existsSync(userKeybindings), `托管写入未生成 ${userKeybindings}`);
      const entries = JSON.parse(fs.readFileSync(userKeybindings, 'utf-8'));
      assert.ok(Array.isArray(entries) && entries.some((e) => e.command === 'codeblocks.build' && String(e.key).toLowerCase() === 'ctrl+alt+f9'),
        `托管条目异常：${JSON.stringify(entries)}`);

      // 面板仍存活且仍是单例（webview 未被设置往返破坏）
      assert.strictEqual(U.tabsOfViewType(KB_PANEL).length, 1, '设置往返后快捷键面板标签页丢失（webview 被破坏）');
      await vscode.commands.executeCommand('codeblocks.keybindings.panel');
      await U.delay(500);
      assert.strictEqual(U.tabsOfViewType(KB_PANEL).length, 1, '可重复打开被破坏：出现多个快捷键面板');
    } finally {
      await vscode.commands.executeCommand('codeblocks.keybindings.reset').then(undefined, () => undefined);
      await U.setConfig('keybindings.overrides', undefined);
    }
  });

  t.test('无工程时工程面板不创建：codeblocks.projectProperties / codeblocks.compilerOptions 优雅降级', async (ctx) => {
    const ws = U.workspaceDir();
    if (!ws) ctx.skip();
    const existing = U.findProjectFiles(ws);
    if (existing.length) {
      console.log(`SKIP 无工程降级断言：工作区已存在工程 ${existing.join(', ')}（前置不满足）`);
      ctx.skip();
    }
    await vscode.commands.executeCommand('codeblocks.projectProperties');
    await vscode.commands.executeCommand('codeblocks.compilerOptions');
    await U.delay(1200);
    assert.strictEqual(U.tabsOfViewType(PROP_PANEL).length, 0, '无工程时仍创建了工程属性面板');
    assert.strictEqual(U.tabsOfViewType(OPT_PANEL).length, 0, '无工程时仍创建了编译选项面板');
  });

  t.test('打开工程后：compilerOptions 与 projectProperties 各创建 WebView 标签页（≥2 面板共存，可关闭再打开）', async (ctx) => {
    const ws = U.workspaceDir();
    if (!ws) ctx.skip();

    // 1) 打开仓库自带 hello-cb 工程（复制到临时工作区，避免污染仓库；标题改为唯一值便于日志断言）
    const projDir = path.join(ws, 'cb-host-webview-proj');
    fs.rmSync(projDir, { recursive: true, force: true });
    const cbp = U.copyHelloProject(projDir, WEBVIEW_PROJ_TITLE);
    const off = U.logOffset();
    await vscode.commands.executeCommand('codeblocks.openRecentProject', cbp);
    await vscode.commands.executeCommand('codeblocks.setActiveProject', cbp);
    const opened = await U.waitForLogLine(`已打开项目: ${WEBVIEW_PROJ_TITLE}`, off, 20000);
    assert.ok(opened, `工程未打开（观测手段：输出通道落盘日志 ${U.extensionLogPath() || '未找到扩展日志'}）`);

    // 2) 编译选项面板（依赖活动工程；工程仅一个目标时 selectTarget 不弹 QuickPick）
    await vscode.commands.executeCommand('codeblocks.compilerOptions');
    const optTab = await U.waitForWebviewTab(OPT_PANEL, 15000);
    assert.ok(optTab, `未创建 ${OPT_PANEL} WebView 标签页`);
    assert.ok(String(optTab.label).startsWith('编译选项:'), `标签标题异常：${optTab.label}`);

    // 3) 工程属性面板（右键入口以工程节点调用；宿主内传入等价节点对象 { project: { filename } }，
    //    与 src/extension.ts 的 resolveProjectFilename() 约定一致）
    await vscode.commands.executeCommand('codeblocks.projectProperties', { project: { filename: cbp } });
    const propTab = await U.waitForWebviewTab(PROP_PANEL, 15000);
    assert.ok(propTab, `未创建 ${PROP_PANEL} WebView 标签页`);
    assert.strictEqual(propTab.label, `工程属性: ${WEBVIEW_PROJ_TITLE}`, `标签标题异常：${propTab.label}`);

    // 3b) 界面语言切换（真实宿主）：codeblocks.ui.language=auto→en ⇒ 已打开面板标题立即变英文；
    //     切回 zh-cn 立即恢复中文（详见 docs/国际化.md：面板正文在下次打开时按新语言渲染，标题即时刷新）
    await U.setConfig('ui.language', 'en');
    const titleEn = await U.waitFor(async () => {
      const t = U.tabsOfViewType(PROP_PANEL)[0];
      return t && String(t.label).startsWith('Project Properties:') ? t.label : undefined;
    }, 10000);
    assert.strictEqual(titleEn, `Project Properties: ${WEBVIEW_PROJ_TITLE}`, `切英文后标题未刷新：${titleEn}`);
    await U.setConfig('ui.language', 'zh-cn');
    const titleZh = await U.waitFor(async () => {
      const t = U.tabsOfViewType(PROP_PANEL)[0];
      return t && String(t.label).startsWith('工程属性:') ? t.label : undefined;
    }, 10000);
    assert.strictEqual(titleZh, `工程属性: ${WEBVIEW_PROJ_TITLE}`, `切回中文后标题未恢复：${titleZh}`);

    // 4) ≥2 个 WebView 面板可同时存在（快捷键面板此时也已打开）；viewType 归一化后比较
    const all = U.webviewTabs().map((x) => U.normalizeViewType(x.viewType));
    assert.ok([KB_PANEL, OPT_PANEL, PROP_PANEL].every((v) => all.includes(v)),
      `期望 ≥2 个 WebView 面板共存，实际：${JSON.stringify(all)}`);

    // 5) 关闭再打开（DOM 不可观测，故以「标签页消失 → 命令重建后再次出现」作为面板生命周期观测点）
    assert.ok(await U.closeWebviewTab(OPT_PANEL), '编译选项面板未能关闭');
    await vscode.commands.executeCommand('codeblocks.compilerOptions');
    assert.ok(await U.waitForWebviewTab(OPT_PANEL, 15000), '编译选项面板关闭后无法重新打开');

    // 清理：关闭本用例打开的两个面板，避免影响后续用例
    await U.closeWebviewTab(OPT_PANEL);
    await U.closeWebviewTab(PROP_PANEL);
  });
});
