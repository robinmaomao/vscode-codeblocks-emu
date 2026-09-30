// 验证快捷键设置面板 buildHtml 生成的 WebView <script> 语法是否合法
// （与 test-html-syntax.js 同模式：从 dist 提取模板字面量 + 替换 ${data} 占位符 + new Function 语法检查）
const fs = require('fs');
const path = require('path');

const distPath = path.resolve(__dirname, '../dist/ui/keybindingPanel.js');
const dist = fs.readFileSync(distPath, 'utf-8');
const startMarker = 'return `';
const s = dist.indexOf(startMarker);
if (s < 0) { console.error('未找到 return `'); process.exit(1); }
const tplStart = s + startMarker.length;
const endMarker = '`;';
const e = dist.indexOf(endMarker, tplStart);
if (e < 0) { console.error('未找到模板结尾'); process.exit(1); }
const htmlTemplate = dist.slice(tplStart, e);

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
let html = htmlTemplate.replace('${data}', data);

const sm = html.match(/<script>([\s\S]*?)<\/script>/);
if (!sm) { console.error('未找到 <script>'); process.exit(1); }
const script = sm[1];

try {
  new Function(script);
  console.log('keybindingPanel script 语法 OK');
  process.exit(0);
} catch (err) {
  console.error('script 语法错误:', err.message);
  const lines = script.split('\n');
  console.error('脚本前 30 行:');
  lines.slice(0, 30).forEach((l, i) => console.error(String(i + 1).padStart(3), JSON.stringify(l)));
  process.exit(1);
}
