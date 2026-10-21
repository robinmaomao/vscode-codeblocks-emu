// 界面语言切换回归（0.8.132-dev）：
//  - 命令 codeblocks.ui.switchLanguage：QuickPick 三态 → 写全局设置 codeblocks.ui.language
//  - 状态标记（当前模式）、取消不写、切换后提示 + 「重载窗口」按钮动作
//  - 设置变更即时生效：emitConfigChange 后运行时文案（含再次打开的 QuickPick 文案）切换语言
//  - 新设置与命令已进 package.json（枚举 / 默认值 / nls 占位符）
const fs = require('fs');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const cfgBlocks = Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration : [pkg.contributes.configuration];
const byKey = {};
for (const b of cfgBlocks) Object.assign(byKey, b.properties || {});

/** 拦截配置写入（mock 的 update 是 no-op；此处既记录也写回 configStore，模拟真实宿主） */
function spyConfigWrites(app) {
  const writes = [];
  const orig = app.vscode.workspace.getConfiguration;
  app.vscode.workspace.getConfiguration = (section) => {
    const real = orig(section);
    return {
      ...real,
      update: (key, value, target) => {
        writes.push({ section, key, value, target });
        app.mock.configStore[`${section}.${key}`] = value;
        return Promise.resolve();
      },
    };
  };
  return writes;
}

const COMMAND = 'codeblocks.ui.switchLanguage';

(async () => {
  // ---- A. package.json 贡献面 ----
  const setting = byKey['codeblocks.ui.language'];
  check('A1 设置存在（string，默认 auto）', setting?.type === 'string' && setting?.default === 'auto', setting?.default);
  check('A2 枚举三态', JSON.stringify(setting?.enum) === JSON.stringify(['auto', 'en', 'zh-cn']), setting?.enum);
  check('A3 scope = window（运行时界面偏好，不随工作区漂移）', setting?.scope === 'window', setting?.scope);
  check('A4 描述走 nls 占位符', /^%[A-Za-z0-9_.]+%$/.test(String(setting?.markdownDescription || '')), setting?.markdownDescription);
  check('A5 枚举说明走 nls 占位符（3 条）',
    Array.isArray(setting?.enumDescriptions) && setting.enumDescriptions.length === 3
    && setting.enumDescriptions.every((d) => /^%[A-Za-z0-9_.]+%$/.test(d)), setting?.enumDescriptions);
  const cmd = (pkg.contributes.commands || []).find((c) => c.command === COMMAND);
  check('A6 命令已贡献且标题走 nls 占位符', !!cmd && /^%[A-Za-z0-9_.]+%$/.test(cmd.title), cmd?.title);

  // ---- B. 中文态（默认 auto + mock 显示语言 zh-cn） ----
  let app = await activate({ config: { 'codeblocks.ui.language': 'auto', 'codeblocks.clangd.enabled': false } });
  const writes = spyConfigWrites(app);
  check('B1 命令已注册', app.has(COMMAND), [...app.mock.commandHandlers.keys()].filter((k) => k.startsWith('codeblocks.ui')).join(','));

  app.setQuickPick(undefined); // 取消
  await app.invoke(COMMAND);
  check('B2 取消不写设置', writes.length === 0, writes);
  check('B3 取消不弹提示', app.mock.infos.length === 0, app.mock.infos);
  const promptZh = app.records.quickPickPrompts[app.records.quickPickPrompts.length - 1];
  check('B4 QuickPick 标签为中文态，且第三项为原生语言名',
    JSON.stringify(promptZh.items) === JSON.stringify(['跟随 VS Code 显示语言', 'English', '中文（简体）']), promptZh.items);
  check('B5 当前模式带「当前」标记（auto 为默认值）',
    JSON.stringify(promptZh.raw.filter((i) => i.description === '当前').map((i) => i.value)) === JSON.stringify(['auto']),
    promptZh.raw.map((i) => [i.value, i.description]));
  check('B6 QuickPick 标题/占位为中文态',
    promptZh.options.title === '切换界面语言…' && promptZh.options.placeHolder === '运行时界面语言', promptZh.options);

  // ---- C. 写入 en + 提示文案 + 重载按钮 ----
  app.setQuickPick({ label: 'English', detail: 'x', value: 'en' });
  app.vscode.window.showInformationMessage = (m, ...buttons) => {
    app.mock.infos.push(m);
    app.records.infoButtons.push({ message: m, buttons: buttons.flat() });
    return Promise.resolve(buttons.flat()[0]); // 点第一个按钮 = 重载窗口
  };
  app.records.infoButtons = [];
  await app.invoke(COMMAND);
  check('C1 写入全局设置 codeblocks.ui.language = en（target=Global=1）',
    writes.length === 1 && writes[0].key === 'ui.language' && writes[0].value === 'en' && writes[0].target === 1, writes);
  check('C2 提示文案用**新语言**并说明命令标题/设置界面需重载（切换结果即时可见）',
    /UI language: English\./.test(app.mock.infos[0] || '') && /reload the window to apply them/.test(app.mock.infos[0] || ''), app.mock.infos);
  check('C3 提示按钮随新语言（Reload Window）', JSON.stringify(app.records.infoButtons[0]?.buttons) === JSON.stringify(['Reload Window']), app.records.infoButtons[0]);
  check('C4 点击按钮执行 workbench.action.reloadWindow',
    app.records.executeCommand.some((c) => c.id === 'workbench.action.reloadWindow'), app.records.executeCommand.map((c) => c.id));

  // ---- D. 设置变更即时生效（无需重载窗口） ----
  app.setConfig('codeblocks.ui.language', 'en');
  app.mock.emitConfigChange('codeblocks.ui.language');
  app.setQuickPick(undefined);
  await app.invoke(COMMAND);
  const promptEn = app.records.quickPickPrompts[app.records.quickPickPrompts.length - 1];
  check('D1 派发设置变更后 QuickPick 立即变英文（即时生效）',
    JSON.stringify(promptEn.items) === JSON.stringify(['Follow the VS Code display language', 'English', '中文（简体）']), promptEn.items);
  check('D2 当前模式标记随设置移动（en）',
    JSON.stringify(promptEn.raw.filter((i) => i.description === 'Current').map((i) => i.value)) === JSON.stringify(['en']),
    promptEn.raw.map((i) => [i.value, i.description]));
  check('D3 英文态标题/占位', promptEn.options.title === 'Switch UI Language…' && promptEn.options.placeHolder === 'Runtime UI language', promptEn.options);

  await app.deactivate();

  // ---- E. 静态断言：状态栏刷新与面板标题刷新已接线（语言切换后即时可见的部分） ----
  const ext = fs.readFileSync(path.join(ROOT, 'dist', 'extension.js'), 'utf-8');
  check('E1 设置监听：affectsConfiguration(codeblocks.ui.language) → refreshUiLanguage',
    /if \(!e\.affectsConfiguration\(i18n\.LANGUAGE_SETTING_FULL\)\)\s*return;\s*i18n\.refreshUiLanguage\(\);/.test(ext), null);
  check('E2 切换后刷新状态栏与已打开面板标题',
    /refreshStatusBars\(\);\s*refreshOpenPanelsForLanguage\(\);/.test(ext)
    && /ProjectPropertiesPanel\.refreshTitleIfOpen\(\)/.test(ext)
    && /KeybindingPanel\.refreshTitleIfOpen\(\)/.test(ext)
    && /CompilerOptionsPanel\.refreshTitleIfOpen\(\)/.test(ext), null);
  check('E3 状态栏文案不残留硬编码（面板标题走 i18n）',
    /projectPropertiesTitle\(/.test(fs.readFileSync(path.join(ROOT, 'dist', 'ui', 'projectPropertiesPanel.js'), 'utf-8')), null);

  console.log(`\ni18n 语言切换回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL 运行异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
