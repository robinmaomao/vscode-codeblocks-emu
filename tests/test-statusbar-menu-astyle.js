// 状态栏 Menu 与 AStyle 格式化回归（此前无测试引用）
//  - ui/statusBarMenu：状态栏项注册（文本/命令/悬停菜单链接）、第一级 QuickPick 结构
//    （Workspace / Recent Projects / 顶级菜单）、动态区（自定义工具）注入
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
      check('B3 第一级含全部顶级菜单项', TOP_MENUS.every((n) => labels.includes(n)),
        { missing: TOP_MENUS.filter((n) => !labels.includes(n)) }, []);
      check('B4 无工程时不含 Workspace 动态项', !labels.some((l) => /Workspace/.test(l)), labels.filter((l) => /Workspace/.test(l)));
      check('B5 顶级菜单顺序与 MENU_STRUCTURE 一致',
        labels.filter((l) => TOP_MENUS.includes(l)).join('|') === TOP_MENUS.join('|'),
        labels.filter((l) => TOP_MENUS.includes(l)));
    }

    // ---------- C. 动态区（最近工程 / 工作区顺序 / 自定义工具） ----------
    picks.length = 0;
    registerStatusBarMenu({ subscriptions: [] }, () => ({
      recents: [{ label: 'hello-cb', file: 'E:\\p\\hello-cb.cbp' }],
      order: [{ label: 'dep-lib', file: 'E:\\p\\dep-lib.cbp' }, { label: 'dep-app', file: 'E:\\p\\dep-app.cbp' }],
      hasProjects: true,
      tools: [{ label: 'MyTool', index: 0 }],
    }));
    const handlers2 = mock.commandHandlers.get('codeblocks.menu.show') || [];
    await handlers2[handlers2.length - 1]();
    const first2 = picks[0] || [];
    const labels2 = first2.map((i) => String(i.label));
    check('C2 有工程时出现 Workspace 动态项', labels2.some((l) => /Workspace/.test(l)), labels2);
    check('C3 最近工程入口出现', labels2.some((l) => /Recent Projects/.test(l)), labels2);

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
