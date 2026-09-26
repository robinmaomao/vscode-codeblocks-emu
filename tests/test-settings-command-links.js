// 设置界面「可视化面板入口」回归：
//  - 递归扫描 contributes.configuration 全部 markdownDescription / markdownEnumDescriptions
//  - 每条 command: 链接必须指向已贡献命令（contributes.commands）或内置命令（workbench.* / vscode.*）
//  - 两项快捷键设置必须保留「可视化快捷键设置面板」入口链接（防止文档改版丢失入口）
//  - 链接 URI 不得含空白/中文/括号，避免 Markdown 解析截断
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const contributed = new Set((pkg.contributes.commands || []).map((c) => c.command));
const props = (pkg.contributes.configuration && pkg.contributes.configuration.properties) || {};

// ---- 1. 收集全部 markdown 文本（properties 可嵌套 object/array） ----
const markdowns = [];
function collect(key, node) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.markdownDescription === 'string') markdowns.push([key, node.markdownDescription]);
  if (Array.isArray(node.markdownEnumDescriptions)) {
    node.markdownEnumDescriptions.forEach((t, i) => {
      if (typeof t === 'string') markdowns.push([`${key}#enum${i}`, t]);
    });
  }
  if (node.properties) {
    for (const [k, v] of Object.entries(node.properties)) collect(`${key}.${k}`, v);
  }
  if (node.items && typeof node.items === 'object') collect(`${key}[]`, node.items);
}
for (const [k, v] of Object.entries(props)) collect(k, v);
check('设置 markdown 字段非空', markdowns.length > 0, markdowns.length, '>0');

// ---- 2. 链接目标有效性 ----
const found = [];
const bad = [];
for (const [key, text] of markdowns) {
  for (const m of text.matchAll(/\]\((command:[^)]*)\)/g)) {
    const id = m[1].slice('command:'.length);
    found.push(`${key} -> ${id}`);
    const ok = contributed.has(id) || /^workbench\./.test(id) || /^vscode\./.test(id);
    if (!ok) bad.push(`${key} -> ${id}`);
  }
}
check('全部 command: 链接指向已贡献或内置命令', bad.length === 0, bad, '无失效');
check('设置界面存在 command: 链接入口', found.length >= 2, found, '>=2');

// ---- 3. 快捷键设置必须带面板入口 ----
const panelLink = `command:${'codeblocks.keybindings.panel'}`;
const has = (key) => markdowns.some(([k, t]) => k === key && t.includes(panelLink));
check('overrides 描述含「可视化设置面板」入口', has('codeblocks.keybindings.overrides'), 'n/a', panelLink);
check('cbStyle 描述含「可视化设置面板」入口', has('codeblocks.keybindings.cbStyle'), 'n/a', panelLink);
check('overrides 描述不再推荐旧向导命令', !markdowns.some(([k, t]) => k === 'codeblocks.keybindings.overrides' && t.includes('Configure Keybindings')), 'n/a', '无');

// ---- 4. 链接 URI 形态（Markdown 解析安全） ----
const rawLinks = markdowns.flatMap(([, t]) => [...t.matchAll(/\]\((command:[^)]*)\)/g)].map((x) => x[1]));
check('链接 URI 无空白/中文/括号', rawLinks.every((u) => /^command:[\w.?#=&%+-]+$/.test(u)), rawLinks, '全部合法');

console.log(`设置界面命令链接回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
