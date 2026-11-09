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
check('HTML：历史区位于结果区之后、页脚之前', html.indexOf('id="historySection"') > html.indexOf('id="empty"')
  && html.indexOf('id="historySection"') < html.indexOf('class="footer"'),
  { history: html.indexOf('id="historySection"'), empty: html.indexOf('id="empty"'), footer: html.indexOf('class="footer"') });
check('HTML：无顶部工具条/搜索框下方历史', !html.includes('class="topbar"') && !html.includes('id="historyPanel"'));
check('HTML：历史区默认折叠 + 开关/清空在头部', html.includes('id="historySection"') && html.includes('role="region"')
  && html.includes('id="historyToggle"') && html.includes('aria-expanded="false"') && html.includes('aria-controls="historyBody"')
  && html.indexOf('id="historySwitch"') > html.indexOf('id="historySection"')
  && html.indexOf('id="clearHistory"') > html.indexOf('id="historySection"'));
check('HTML：清空历史使用原生模态（无内联确认条）', !html.includes('historyConfirm') && script.includes("'requestClearHistory'"));
check('HTML：保留历史为可视化 switch', html.includes('id="historySwitch"') && html.includes('role="switch"') && html.includes('aria-checked="true"'));
check('HTML：模式/范围/选项/状态/结果/空态', ['modeFiles', 'modeText', 'scope', 'caseToggle', 'wholeWordToggle', 'regexToggle', 'status', 'results', 'empty', 'data-load-more']
  .every((id) => html.includes(`id="${id}"`) || html.includes(id)));
check('HTML：无障碍语义', html.includes('role="listbox"') && html.includes('aria-live="polite"') && html.includes('aria-label="搜索历史"'));
check('HTML：主题变量', ['--vscode-input-background', '--vscode-list-activeSelectionBackground', '--vscode-icon-foreground', '--vscode-progressBar-background']
  .every((v) => html.includes(v)));
check('HTML：匹配高亮足够可见（不依赖主题 findMatch 变量）', html.includes('rgba(234, 92, 0, .42)') && !html.includes('var(--vscode-editor-findMatchHighlightBackground)'));
check('HTML：无 innerHTML', !/\.innerHTML\s*=/.test(html), (html.match(/innerHTML/g) || []).length);
check('HTML：不使用模板字符串 ${}', !script.includes('${'), (script.match(/\$\{/g) || []).length);
check('HTML：脚本可编译', (() => { try { new Function(script); return true; } catch (e) { console.log(e.message); return false; } })());
check('HTML：动态渲染用 textContent/createElement', script.includes('textContent') && script.includes('createElement') && script.includes('appendChild'));
check('HTML：消息协议完整', ['searchFiles', 'searchText', 'cancel', 'openFile', 'openMatch', 'revealFile', 'setScope', 'stateChanged', 'runHistory', 'clearHistory', 'setKeepHistory']
  .every((t) => script.includes(`'${t}'`)));
check('HTML：窄栏适配', html.includes('@media (max-width: 240px)') && html.includes('.history-label'));
check('HTML：对齐 VS Code 字体与行高', ['--vscode-font-size', '--vscode-editor-font-family', '--vscode-editor-font-size', 'line-height: 22px']
  .every((v) => html.includes(v)), html.slice(0, 80));
check('HTML：内联 SVG codicon 图标集', ['i-search', 'i-chevron-right', 'i-chevron-down', 'i-refresh', 'i-expand-all', 'i-collapse-all', 'i-project', 'i-reveal']
  .every((id) => html.includes(`id="${id}"`)) && html.includes('class="codicon"'));
check('HTML：搜索框内嵌选项按钮', html.indexOf('class="input-options"') > html.indexOf('id="query"')
  && html.indexOf('class="input-options"') < html.indexOf('id="modeText"'));
check('HTML：结果按工程分组 + 文件行徽标', ['project-head', 'file-row', 'badge', 'match-row', 'statusrow', 'data-project-group']
  .every((cls) => html.includes(cls)));
check('HTML：文件类型图标配色（C 蓝 / H 紫）', ['lang-c', 'lang-h', 'lang-cpp', 'lang-hpp', '#519aba', '#a074c4']
  .every((s) => html.includes(s)));
const fontHtml = buildProjectSearchViewHtml({ fontUri: 'vscode-webview://x/seti.woff', cspSource: 'vscode-webview://x' });
check('HTML：Seti 字体可选加载（font-src + @font-face）', fontHtml.includes('font-src vscode-webview://x') && fontHtml.includes("@font-face")
  && fontHtml.includes('seti.woff') && fontHtml.includes('seti-font'), fontHtml.slice(0, 200));
check('HTML：无 emoji 图标残留', !/[\u{1F300}-\u{1FAFF}\u21BB\u229E\u229F\u25B8\u25BE]/u.test(html),
  (html.match(/[\u{1F300}-\u{1FAFF}\u21BB\u229E\u229F\u25B8\u25BE]/gu) || []).join(''));

mock.restore();
console.log(`\n工程搜索 HTML: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
