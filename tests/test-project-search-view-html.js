// 工程搜索视图 HTML 结构回归：CSP、历史栏位于搜索栏顶部、switch 语义、无 innerHTML、脚本可编译。
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const mock = installVscodeMock({ config: { 'codeblocks.ui.language': 'zh-cn' } });
const i18n = require('../dist/i18n');
i18n.refreshUiLanguage();
const { buildProjectSearchViewHtml } = require('../dist/ui/projectSearchViewHtml.js');
const html = buildProjectSearchViewHtml();
const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [, ''])[1];

check('HTML：doctype + lang=zh-CN', /^<!DOCTYPE html>/.test(html) && html.includes('lang="zh-CN"'), html.slice(0, 80));
check('HTML：CSP 限制为内联脚本/样式', html.includes("default-src 'none'") && html.includes("script-src 'unsafe-inline'") && html.includes("style-src 'unsafe-inline'"));
check('HTML：历史栏位于搜索栏之前（顶部）', html.indexOf('id="historyPanel"') > -1 && html.indexOf('id="historyPanel"') < html.indexOf('class="searchbar"'),
  { history: html.indexOf('id="historyPanel"'), search: html.indexOf('class="searchbar"') });
check('HTML：保留历史为可视化 switch', html.includes('id="historySwitch"') && html.includes('role="switch"') && html.includes('aria-checked="true"'));
check('HTML：模式/范围/选项/状态/结果/空态', ['modeFiles', 'modeText', 'scope', 'caseToggle', 'regexToggle', 'status', 'results', 'empty', 'data-load-more']
  .every((id) => html.includes(`id="${id}"`) || html.includes(id)));
check('HTML：无障碍语义', html.includes('role="listbox"') && html.includes('aria-live="polite"') && html.includes('aria-label="搜索历史"'));
check('HTML：主题变量', ['--vscode-input-background', '--vscode-list-activeSelectionBackground', '--vscode-editor-findMatchHighlightBackground', '--vscode-progressBar-background']
  .every((v) => html.includes(v)));
check('HTML：无 innerHTML', !/\.innerHTML\s*=/.test(html), (html.match(/innerHTML/g) || []).length);
check('HTML：不使用模板字符串 ${}', !script.includes('${'), (script.match(/\$\{/g) || []).length);
check('HTML：脚本可编译', (() => { try { new Function(script); return true; } catch (e) { console.log(e.message); return false; } })());
check('HTML：动态渲染用 textContent/createElement', script.includes('textContent') && script.includes('createElement') && script.includes('appendChild'));
check('HTML：消息协议完整', ['searchFiles', 'searchText', 'cancel', 'openFile', 'openMatch', 'revealFile', 'setScope', 'stateChanged', 'runHistory', 'clearHistory', 'setKeepHistory']
  .every((t) => script.includes(`'${t}'`)));
check('HTML：窄栏适配', html.includes('@media (max-width: 240px)') && html.includes('.history-label'));

mock.restore();
console.log(`\n工程搜索 HTML: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
