// 验证快捷键设置面板 buildHtml 生成的 WebView <script> 语法是否合法
// （与 test-html-syntax.js 同模式：从 dist 提取模板字面量 + 注入数据 + 中和其余插值 + new Function 语法检查）
const fs = require('fs');
const path = require('path');
const { extractTemplate, neutralizeInterpolations } = require('./_harness/panelTemplate');

const distPath = path.resolve(__dirname, '../dist/ui/keybindingPanel.js');
const dist = fs.readFileSync(distPath, 'utf-8');
const htmlTemplate = extractTemplate(dist);
if (!htmlTemplate) { console.error('未找到 return `…`; 模板'); process.exit(1); }

// 面板数据（构造覆盖三种分组 / 自定义 / 解绑 / 注解的 fixture）
const fixture = {
  rows: [
    { id: 'build', label: 'Build（构建活动工程）', command: 'codeblocks.build', when: 'editorTextFocus', group: 'builtin', status: 'custom', effective: 'ctrl+alt+b', defaultsLabel: 'ctrl+f9', ok: true, note: '与 VS Code 默认冲突：测试' },
    { id: 'run', label: 'Run（运行）', command: 'codeblocks.run', when: 'editorTextFocus', group: 'builtin', status: 'default', effective: 'ctrl+f10', defaultsLabel: 'ctrl+f10', ok: true },
    { id: 'aliasGotoFile', label: 'Goto File', command: 'workbench.action.quickOpen', group: 'alias', status: 'default', effective: 'alt+g', defaultsLabel: 'alt+g', ok: true },
    { id: 'cbQuit', label: '[CB] Quit（退出）', command: 'workbench.action.quit', when: 'config.codeblocks.keybindings.cbStyle', group: 'cbStyle', status: 'unbound', effective: '（已解绑）', defaultsLabel: 'ctrl+q', ok: false, note: '未写入 keybindings.json（点击「应用」同步）' },
  ],
  path: 'C:/Users/test/AppData/Roaming/Code/User/keybindings.json',
  cbStyle: false,
  notices: ['测试告警: 设置中含未知键名 xyz'],
};
const data = JSON.stringify(fixture).replace(/</g, '\\u003c');
let html = neutralizeInterpolations(htmlTemplate.replace('${data}', data));

const sm = html.match(/<script(?:\s+nonce="[^"]*")?>([\s\S]*?)<\/script>/);
if (!sm) { console.error('未找到 <script>'); process.exit(1); }
const script = sm[1];

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
try {
  new Function(script);
  check('keybindingPanel script 语法 OK', true);
  check('面板包含数据/路径/应用入口', html.includes('keybindings.json') && html.includes('Build') && /apply/i.test(script), { path: html.includes('keybindings.json'), label: html.includes('Build'), apply: /apply/i.test(script) });
  console.log(`keybindingPanel HTML: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
} catch (err) {
  console.error('script 语法错误:', err.message);
  const lines = script.split('\n');
  console.error('脚本前 30 行:');
  lines.slice(0, 30).forEach((l, i) => console.error(String(i + 1).padStart(3), JSON.stringify(l)));
  process.exit(1);
}
