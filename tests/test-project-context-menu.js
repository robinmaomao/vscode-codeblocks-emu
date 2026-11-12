// 静态校验：工程节点右键菜单（对齐 Code::Blocks projectmanager.cpp 的分组顺序）
// 覆盖：5 个新命令贡献/注册、Project Tree 子菜单、00_save→06_extra 分组顺序、
//       Expand All 的节点缓存重建/状态提升，以及使用文档是否同步。
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const root = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const nlsEn = JSON.parse(read('package.nls.json'));
const nlsZh = JSON.parse(read('package.nls.zh-cn.json'));

const newCommands = [
  'codeblocks.saveProject',
  'codeblocks.closeProject',
  'codeblocks.removeFiles',
  'codeblocks.projectTree.expandAll',
  'codeblocks.projectTree.collapseAll',
];
const contributed = new Map((pkg.contributes.commands || []).map((c) => [c.command, c]));
const missingCmds = newCommands.filter((id) => !contributed.has(id));
check('C1 工程右键 5 个新命令均已贡献到 package.json', missingCmds.length === 0, missingCmds, []);
check('C2 新命令均带图标', newCommands.every((id) => !!contributed.get(id).icon), newCommands.filter((id) => !contributed.get(id).icon), []);

const nlsKeyOf = (c) => (c.title || '').replace(/^%|%$/g, '');
const missingNls = newCommands.filter((id) => {
  const key = nlsKeyOf(contributed.get(id));
  return !nlsEn[key] || !nlsZh[key];
});
check('C3 新命令标题在中英 NLS 均有词条', missingNls.length === 0, missingNls, []);

const submenus = pkg.contributes.submenus || [];
const projectTreeMenu = submenus.find((s) => s.id === 'codeblocks.projectTree.menu');
check('C4 已贡献 codeblocks.projectTree.menu 子菜单', !!projectTreeMenu, submenus, 'codeblocks.projectTree.menu');
if (projectTreeMenu) {
  const key = nlsKeyOf({ title: projectTreeMenu.label });
  check('C5 子菜单标签中英词条齐备', !!nlsEn[key] && !!nlsZh[key], { key, en: nlsEn[key], zh: nlsZh[key] }, 'both');
}

const contextMenus = (pkg.contributes.menus || {})['view/item/context'] || [];
const subItems = (pkg.contributes.menus || {})['codeblocks.projectTree.menu'] || [];
check('C6 Expand All / Collapse All 位于 Project Tree 子菜单',
  subItems.some((m) => m.command === 'codeblocks.projectTree.expandAll') &&
  subItems.some((m) => m.command === 'codeblocks.projectTree.collapseAll'),
  subItems.map((m) => m.command), 'expandAll + collapseAll');

const projectWhen = 'view == codeblocks.projectTree && viewItem == project';
const projectMenus = contextMenus.filter((m) => m.when === projectWhen && m.group && !m.group.startsWith('inline'));
const orderedGroups = projectMenus.filter((m) => /^\d\d_/.test(m.group)).map((m) => m.group.split('@')[0]);
const groups = [...new Set(orderedGroups)];
const wantGroups = ['00_save', '01_files', '02_find', '03_tree', '04_build', '05_options', '06_extra'];
check('C7 工程右键分组顺序与 CB 一致', JSON.stringify(groups) === JSON.stringify(wantGroups), groups, wantGroups);

const groupOf = (command) => (projectMenus.find((m) => m.command === command) || {}).group || '';
check('C8 保存/关闭工程在 00_save', groupOf('codeblocks.saveProject').startsWith('00_save') && groupOf('codeblocks.closeProject').startsWith('00_save'),
  [groupOf('codeblocks.saveProject'), groupOf('codeblocks.closeProject')], ['00_save@*', '00_save@*']);
check('C9 移除文件在 01_files', groupOf('codeblocks.removeFiles').startsWith('01_files'), groupOf('codeblocks.removeFiles'), '01_files@*');
check('C10 Build options / Properties 在 05_options',
  groupOf('codeblocks.compilerOptions').startsWith('05_options') && groupOf('codeblocks.projectProperties').startsWith('05_options'),
  [groupOf('codeblocks.compilerOptions'), groupOf('codeblocks.projectProperties')], ['05_options@*', '05_options@*']);
check('C11 子菜单条目包含在 03_tree 分组中',
  projectMenus.some((m) => m.submenu === 'codeblocks.projectTree.menu' && m.group.startsWith('03_tree')),
  projectMenus.filter((m) => m.submenu).map((m) => m.group), '03_tree@*');

const ext = read('src/extension.ts');
const unregistered = newCommands.filter((id) => !ext.includes(`registerCommand('${id}'`));
check('C12 5 个新命令均在 extension.ts 注册', unregistered.length === 0, unregistered, []);

const tree = read('src/ui/projectTreeProvider.ts');
check('C13 setExpandAll 清空节点/目录缓存（重建元素实例）',
  /setExpandAll\(expand: boolean\): void \{[\s\S]{0,400}?this\.dirIndexCache\.clear\(\);[\s\S]{0,120}?this\.nodeCache\.clear\(\);/.test(tree), null);
check('C14 getTreeItem 将 Collapsed 提升为 Expanded',
  /expandAllRequested && element\.collapsibleState === vscode\.TreeItemCollapsibleState\.Collapsed/.test(tree), null);
check('C15 getProjectNode 暴露给命令层做 reveal 兜底',
  /getProjectNode\(filename: string\): TreeNode \| undefined/.test(tree), null);
// Expand All 只应影响当次刷新：工程重载/重新分组后不得再把用户折叠的节点顶开
check('C15b setProjects / setCategorize 重置 expandAllRequested（一次性）',
  /setProjects\(projects: Project\[\]\): void \{[\s\S]{0,200}?this\.expandAllRequested = false;/.test(tree) &&
  /setCategorize\(categorize: boolean\): void \{[\s\S]{0,300}?this\.expandAllRequested = false;/.test(tree), null);

for (const [rel, needles] of [
  ['docs/guide/usage.md', ['Save Project', 'Close Project', 'Expand All']],
  ['docs/guide/usage.en.md', ['Save Project', 'Close Project', 'Expand All']],
]) {
  const text = read(rel);
  const missing = needles.filter((n) => !text.includes(n));
  check(`C16 ${rel} 已同步工程右键菜单`, missing.length === 0, missing, []);
}

console.log(`工程右键菜单静态校验: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
