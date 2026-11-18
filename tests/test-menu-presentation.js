// 状态栏菜单展示模型回归（src/ui/menuPresentation.ts）
//  - 每项都有图标（且是 1.85 合法 codicon）
//  - 子菜单/动态下钻项只在 label 末尾追加 chevron，description 不再出现“子菜单”
//  - description 固定顺序：快捷键 · 不可用原因
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const { MENU_STRUCTURE, CHILD_ICONS, walkMenuItems } = require('../dist/ui/menuStructure.js');
const {
  presentMenuItem, presentBackItem, menuIcon, isDrillDown,
} = require('../dist/ui/menuPresentation.js');
const i18n = require('../dist/i18n');
const valid = new Set(JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixtures/codicons.json'), 'utf-8')));
const t = (s, ...args) => i18n.t(s, ...args);

const ctx = { hasProjects: false, hasWorkspace: false, hasDebugSession: false };
const all = walkMenuItems();

// ---- 1. 100% 图标覆盖 + 合法 ----
const badIcons = all.filter((it) => !CHILD_ICONS[it.label] || !valid.has(menuIcon(it))).map((it) => `${it.label} → ${menuIcon(it)}`);
check(`全部 ${all.length} 项都有合法图标`, badIcons.length === 0, badIcons.slice(0, 10), '无缺失');
const fallbacks = all.filter((it) => menuIcon(it) === 'circle-outline');
check('没有菜单项落到图标回落值', fallbacks.length === 0, fallbacks.map((it) => it.label), '无回落');

// ---- 2. 子菜单 chevron，description 无“子菜单” ----
const submenuItems = all.filter((it) => isDrillDown(it));
const chevronMissing = submenuItems.filter((it) => !presentMenuItem(it, ctx, t).label.endsWith('$(chevron-right)'));
check(`全部 ${submenuItems.length} 个子菜单/动态项以 chevron 结尾`, chevronMissing.length === 0, chevronMissing.map((it) => it.label), '全部');
const submenuText = all.map((it) => presentMenuItem(it, ctx, t)).filter((p) => /子菜单|submenu/i.test(String(p.description || '')));
check('description 不再出现“子菜单”文案', submenuText.length === 0, submenuText, '无');

// ---- 3. description 顺序：快捷键 → 不可用原因 ----
const build = all.find((it) => it.label === 'Build');
const buildP = presentMenuItem(build, ctx, t);
check('Build 无工程时 description = 快捷键 · 无工程',
  String(buildP.description).startsWith('Ctrl+F9') && String(buildP.description).includes(t('(no project)')), buildP.description);
const buildOk = presentMenuItem(build, { ...ctx, hasProjects: true }, t);
check('Build 有工程时 description 只保留快捷键', buildOk.description === 'Ctrl+F9', buildOk.description);

const deps = all.find((it) => it.label === 'Workspace Dependencies…');
const depsP = presentMenuItem(deps, { ...ctx, hasProjects: true, hasWorkspace: false }, t);
check('Workspace Dependencies 无 .workspace 时标注', String(depsP.description).includes(t('(no .workspace)')), depsP.description);
const depsOk = presentMenuItem(deps, { ...ctx, hasProjects: true, hasWorkspace: true }, t);
check('Workspace Dependencies 有 .workspace 时不标注', depsOk.description === undefined, depsOk.description);

const step = all.find((it) => it.label === 'Step Over');
const stepP = presentMenuItem(step, { ...ctx, hasProjects: true, hasDebugSession: false }, t);
check('Step Over 无调试会话时标注', String(stepP.description).includes(t('(no debug session)')), stepP.description);

const stepOk = presentMenuItem(step, { ...ctx, hasProjects: true, hasDebugSession: true }, t);
check('Step Over 有调试会话时不标注', stepOk.description === undefined, stepOk.description);

// ---- 4. 返回项 / 动态项 ----
const backP = presentBackItem('File', t);
check('返回项用 arrow-left 图标并显示父级', backP.icon === 'arrow-left' && String(backP.description).includes(t('File')), backP);

// ---- 5. 非下钻叶子项 label 不追加 chevron ----
const leafWithChevron = all.filter((it) => !isDrillDown(it) && presentMenuItem(it, ctx, t).label.includes('$(chevron-right)'));
check('叶子项 label 不追加 chevron', leafWithChevron.length === 0, leafWithChevron.map((it) => it.label), '无');

// ---- 6. 顶级菜单图标合法 ----
const badTop = MENU_STRUCTURE.filter((m) => !valid.has(m.icon));
check('顶级菜单图标均合法', badTop.length === 0, badTop.map((m) => `${m.label} → ${m.icon}`), '无');

console.log(`menu-presentation: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
