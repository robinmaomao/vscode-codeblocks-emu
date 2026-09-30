// UI 核查 N1/N3 回归：
//  N1：Symbols 视图使用独立图标（不与 Project 视图共用）
//  N3：Build Log「只看错误」开/关两种状态由两条命令呈现（不同图标），
//      新命令从命令面板隐藏；dist 中两条命令注册同一处理器
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));

// ---- N1：Symbols 视图独立图标 ----
const views = (pkg.contributes.views && pkg.contributes.views.codeblocks) || [];
const symbols = views.find((v) => v.id === 'codeblocks.symbols');
const project = views.find((v) => v.id === 'codeblocks.projectTree');
check('N1① Symbols 与 Project 图标不再相同', symbols.icon !== project.icon, { symbols: symbols.icon, project: project.icon });
check('N1② Symbols 图标 = resources/symbols.svg', symbols.icon === 'resources/symbols.svg', symbols.icon);
check('N1③ symbols.svg 文件存在', fs.existsSync(path.resolve(__dirname, '../resources/symbols.svg')), null);

// ---- N3：两条命令 + 互补 when + 命令面板隐藏 ----
const cmds = new Map((pkg.contributes.commands || []).map((c) => [c.command, c]));
check('N3① showAllMessages 命令已贡献', cmds.has('codeblocks.buildLog.showAllMessages'), null);
const tIcon = cmds.get('codeblocks.buildLog.toggleErrorsOnly')?.icon;
const sIcon = cmds.get('codeblocks.buildLog.showAllMessages')?.icon;
check('N3② 两条命令图标不同（filter / filter-filled）', tIcon === '$(filter)' && sIcon === '$(filter-filled)', { tIcon, sIcon });

const vt = pkg.contributes.menus['view/title'] || [];
const toggleEntries = vt.filter((m) => m.command === 'codeblocks.buildLog.toggleErrorsOnly');
const showAllEntries = vt.filter((m) => m.command === 'codeblocks.buildLog.showAllMessages');
check('N3③ 未开启态 = toggleErrorsOnly（when !errorsOnly）',
  toggleEntries.length === 1 && /!codeblocks\.buildLog\.errorsOnly/.test(toggleEntries[0].when), toggleEntries);
check('N3④ 已开启态 = showAllMessages（when errorsOnly）',
  showAllEntries.length === 1 && /codeblocks\.buildLog\.errorsOnly/.test(showAllEntries[0].when), showAllEntries);

const cp = pkg.contributes.menus.commandPalette || [];
const cpEntry = cp.find((m) => m.command === 'codeblocks.buildLog.showAllMessages');
check('N3⑤ showAllMessages 从命令面板隐藏（when=false）', !!cpEntry && cpEntry.when === 'false', cpEntry);

const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('N3⑥ dist 注册两条命令', ext.includes("'codeblocks.buildLog.toggleErrorsOnly'") && ext.includes("'codeblocks.buildLog.showAllMessages'"), null);

console.log(`\nui-icons: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
