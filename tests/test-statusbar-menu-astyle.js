// 状态栏 Menu 与 AStyle 格式化回归（此前无测试引用）
//  - ui/statusBarMenu：状态栏项注册（文本/命令/悬停菜单链接）、一级 QuickPick（仅 9 个顶级菜单）、
//    File 动态区（Recent Files / Recent Projects / Workspace Build Order）、面包屑/返回、
//    Tools 自定义工具顺序、可用性标注（无工程 / 无调试会话）
//  - tools/astyle：locateAstyle 在无 AStyle 可执行文件时的返回（不抛异常）、
//    formatWithAstyle 在缺失工具时的失败返回
// 均经 tests/_harness/vscodeMock。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

async function main() {
  const mock = installVscodeMock();
  try {
    const { registerStatusBarMenu } = require('../dist/ui/statusBarMenu.js');
    const { MENU_STRUCTURE } = require('../dist/ui/menuStructure.js');
    const i18n = require('../dist/i18n');
    // 菜单标签按当前生效语言渲染（i18n.t(label)）：期望值同样经 i18n 解析，避免语言耦合
    const topLabels = () => TOP_MENUS.map((n) => i18n.t(n));
    const menuLabels = () => MENU_STRUCTURE.map((m) => i18n.t(m.label));

    // ---------- A. 状态栏项与悬停菜单 ----------
    const statusItem = registerStatusBarMenu({ subscriptions: [] }, () => ({ recents: [], order: [], hasProjects: false, tools: [] }));
    check('A1 状态栏项文本为 $(menu) Menu', statusItem.text === '$(menu) Menu', statusItem.text);
    check('A2 状态栏项绑定 codeblocks.menu.show 命令', statusItem.command === 'codeblocks.menu.show', statusItem.command);
    check('A3 状态栏项已 show()', statusItem.shown === true, statusItem.shown, true);
    const md = statusItem.tooltip;
    check('A4 悬停菜单为受信 Markdown（isTrusted）', md && md.isTrusted === true, md && md.isTrusted);
    check('A5 悬停菜单含 command: 链接', md && md.value.includes('](command:codeblocks.'), (md && md.value || '').slice(0, 60));
    check('A6 悬停菜单标题为 Code::Blocks 菜单', md && md.value.startsWith('**Code::Blocks 菜单**'), (md && md.value || '').slice(0, 30));

    // ---------- B. 第一级 QuickPick 结构 ----------
    const picks = [];
    mock.vscode.window.showQuickPick = async (items) => { picks.push(items); return undefined; };
    const handlers = mock.commandHandlers.get('codeblocks.menu.show') || [];
    check('B2 命令处理器已注册（codeblocks.menu.show）', handlers.length >= 1, handlers.length, '≥1');
    if (handlers.length) {
      await handlers[0]();
      const first = picks[0] || [];
      const labels = first.map((i) => String(i.label));
      check('B3 第一级含全部顶级菜单项', topLabels().every((n) => labels.includes(n)),
        { missing: topLabels().filter((n) => !labels.includes(n)) }, []);
      check('B4 无工程时不含 Workspace 动态项', !labels.includes(i18n.t('Workspace')), labels);
      check('B5 顶级菜单顺序与 MENU_STRUCTURE 一致',
        labels.filter((l) => menuLabels().includes(l)).join('|') === menuLabels().join('|'),
        labels.filter((l) => menuLabels().includes(l)));
    }

    // ---------- C. 动态区（已移入 File）+ 工具顺序 + 返回导航 ----------
    const dyn = {
      recents: [{ label: 'hello-cb', file: 'E:\\p\\hello-cb.cbp', active: true }],
      order: [{ label: '1. dep-lib', file: 'E:\\p\\dep-lib.cbp', active: false }, { label: '2. dep-app', file: 'E:\\p\\dep-app.cbp', active: true }],
      hasProjects: true,
      hasWorkspace: true,
      hasDebugSession: false,
      categorize: true,
      tools: [{ label: 'MyTool', index: 0 }],
    };
    const byLabel = (label) => (items) => items.find((i) => i.label === i18n.t(label));
    const drill = (label) => (items) => items.find((i) => String(i.label).startsWith(i18n.t(label)));
    const back = (items) => items.find((i) => i.back === true);
    const runMenu = async (selectors, data = dyn) => {
      picks.length = 0;
      mock.vscode.window.showQuickPick = async (items) => {
        picks.push(items);
        const sel = selectors[picks.length - 1];
        if (!sel) return undefined;
        return typeof sel === 'function' ? sel(items) : undefined;
      };
      registerStatusBarMenu({ subscriptions: [] }, () => data);
      const hs = mock.commandHandlers.get('codeblocks.menu.show') || [];
      await hs[hs.length - 1]();
    };
    const rows = (items) => (items || []).filter((i) => i.label && i.kind !== mock.vscode.QuickPickItemKind.Separator);
    const iconsOk = (items) => rows(items).every((i) => !!i.iconPath && !!i.iconPath.id);
    const noSubmenuText = (items) => rows(items).every((i) => !String(i.description || '').includes(i18n.t('submenu ›')));

    await runMenu([byLabel('File'), undefined]);
    const first2 = picks[0] || [];
    const file2 = picks[1] || [];
    const labels2 = first2.map((i) => String(i.label));
    const fileLabels = file2.map((i) => String(i.label));
    check('C2 一级只有 9 个顶级菜单（Workspace/Recent 已移入 File）',
      labels2.length === MENU_STRUCTURE.length && !labels2.includes(i18n.t('Workspace')) && !labels2.includes(i18n.t('Recent Projects')), labels2);
    check('C3 File 动态区齐备（Recent Files / Recent Projects / Workspace Build Order）',
      ['Recent Files', 'Recent Projects', 'Workspace Build Order'].every((n) => fileLabels.some((l) => l === i18n.t(n) + ' $(chevron-right)')), fileLabels);
    check('C3b 一级与 File 层级每行都有图标', iconsOk(first2) && iconsOk(file2), { first: iconsOk(first2), file: iconsOk(file2) });
    check('C3c 子菜单用 chevron 表达，不在 description 写“子菜单”',
      noSubmenuText(first2) && noSubmenuText(file2)
      && fileLabels.includes(i18n.t('New') + ' $(chevron-right)'),
      { first: noSubmenuText(first2), file: noSubmenuText(file2) });

    // File → Recent Projects：Back / 活动工程 check / 清空入口均有图标
    await runMenu([byLabel('File'), drill('Recent Projects'), undefined, undefined]);
    const recentRows = picks[2] || [];
    check('C4 最近工程二级列表含返回与活动工程标记',
      !!back(recentRows) && rows(recentRows).some((i) => i.iconPath && i.iconPath.id === 'check'), recentRows.map((i) => [i.label, i.iconPath && i.iconPath.id]));
    check('C5 最近工程二级列表每行都有图标（含清空入口）', iconsOk(recentRows), rows(recentRows).map((i) => i.label));

    // Tools：自定义工具必须插在 Configure Tools… 之前（CB ToolsManager）
    await runMenu([byLabel('Tools'), undefined]);
    const toolLabels = (picks[1] || []).map((i) => String(i.label));
    check('C6 Tools 自定义工具在 Configure Tools… 之前',
      toolLabels.indexOf('MyTool') >= 0 && toolLabels.indexOf('MyTool') < toolLabels.indexOf(i18n.t('Configure Tools…')), toolLabels);
    check('C7 Tools 层级每行都有图标', iconsOk(picks[1]), rows(picks[1]).map((i) => i.label));

    // 返回导航：File → New → 返回 → 回到 File
    await runMenu([byLabel('File'), drill('New'), back, undefined]);
    const fileAgain = (picks[3] || []).map((i) => String(i.label));
    check('C8 子菜单“返回”回到上一级（File → New → 返回 → File）',
      fileAgain.includes(i18n.t('New') + ' $(chevron-right)') && fileAgain.includes(i18n.t('Save File')), fileAgain.slice(0, 8));

    // Categorize 是复选项：用 check / list-flat 图标表达当前状态
    await runMenu([byLabel('Project'), drill('Project Tree'), undefined], { ...dyn, categorize: true });
    const catOn = (picks[2] || []).find((i) => String(i.label).startsWith(i18n.t('Categorize by File Types')));
    check('C9 Categorize（已启用）显示 check 图标', catOn && catOn.iconPath && catOn.iconPath.id === 'check', catOn && catOn.iconPath && catOn.iconPath.id);
    await runMenu([byLabel('Project'), drill('Project Tree'), undefined], { ...dyn, categorize: false });
    const catOff = (picks[2] || []).find((i) => String(i.label).startsWith(i18n.t('Categorize by File Types')));
    check('C10 Categorize（已停用）显示 list-flat 图标', catOff && catOff.iconPath && catOff.iconPath.id === 'list-flat', catOff && catOff.iconPath && catOff.iconPath.id);

    // 可用性标注：无工程 / 无调试会话
    await runMenu([byLabel('Build'), undefined], { ...dyn, hasProjects: false });
    const buildRow = (picks[1] || []).find((i) => i.label === i18n.t('Build'));
    check('C11 无工程时 Build 标注（无工程）', buildRow && String(buildRow.description || '').includes(i18n.t('(no project)')), buildRow && buildRow.description);
    await runMenu([byLabel('Debug'), undefined], { ...dyn, hasDebugSession: false });
    const stepRow = (picks[1] || []).find((i) => i.label === i18n.t('Step Over'));
    check('C12 无调试会话时 Step Over 标注（无调试会话）', stepRow && String(stepRow.description || '').includes(i18n.t('(no debug session)')), stepRow && stepRow.description);

    // ---------- C2b. 语言切换：菜单标签随 ui.language 切换 ----------
    mock.configStore['codeblocks.ui.language'] = 'en';
    i18n.refreshUiLanguage();
    picks.length = 0;
    const handlersEn = mock.commandHandlers.get('codeblocks.menu.show') || [];
    await handlersEn[handlersEn.length - 1]();
    const labelsEn = (picks[0] || []).map((i) => String(i.label));
    check('C4 英文态第一级为英文顶级菜单', labelsEn.includes('File') && labelsEn.includes('Build'),
      labelsEn.slice(0, 12));
    check('C5 英文态无中文残留', !labelsEn.some((l) => /[\u4e00-\u9fff]/.test(l)), labelsEn);
    mock.configStore['codeblocks.ui.language'] = 'zh-cn';
    i18n.refreshUiLanguage();
    picks.length = 0;
    const handlersZh = mock.commandHandlers.get('codeblocks.menu.show') || [];
    await handlersZh[handlersZh.length - 1]();
    const labelsZh = (picks[0] || []).map((i) => String(i.label));
    check('C6 切回中文态恢复中文标签', labelsZh.includes('文件') && labelsZh.includes('构建'), labelsZh.slice(0, 12));

    // ---------- D. AStyle ----------
    const astyle = require('../dist/tools/astyle.js');
    const located = astyle.locateAstyle();
    check('D1 locateAstyle 返回 string|null（不抛异常）', located === null || typeof located === 'string', located, 'string|null');
    check('D2 未安装 AStyle 时 locateAstyle 为 null（本机预期）', located === null || typeof located === 'string', typeof located);

    const source = 'int main(void){return 0;}\n';
    const formatted = await astyle.formatWithAstyle(source, ['--style=allman', '--indent=spaces=4']);
    if (located === null) {
      check('D3 未安装 AStyle：formatWithAstyle 返回 null（调用方回退内置格式化）', formatted === null, formatted, null);
    } else {
      check('D3 已安装 AStyle：返回格式化文本（string）', typeof formatted === 'string', typeof formatted);
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-astyle-'));
    try {
      const f = path.join(tmp, 'a.c');
      fs.writeFileSync(f, source, 'utf-8');
      await astyle.formatWithAstyle(fs.readFileSync(f, 'utf-8'), []);
      check('D4 formatWithAstyle 不修改磁盘文件（纯函数式：返回文本）', fs.readFileSync(f, 'utf-8') === source, fs.readFileSync(f, 'utf-8'));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  } finally {
    mock.restore();
  }
  console.log(`\nstatusbar-menu-and-astyle 回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

// 顶级菜单名（与 menuStructure 的 MENU_STRUCTURE 顺序一致；Help 由运行时注册，不在此列）
const TOP_MENUS = ['File', 'Edit', 'View', 'Search', 'Project', 'Build', 'Debug', 'Tools', 'Settings'];

main().catch((err) => {
  console.error('运行异常: ' + (err && err.stack ? err.stack : err));
  console.log(`\nstatusbar-menu-and-astyle 回归: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
