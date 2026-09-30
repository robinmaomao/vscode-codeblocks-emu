// WebView 面板加固回归（审计 P2.3 / P3.3）：
//  - 三个面板（项目属性 / 快捷键 / 编译选项）模板均含 CSP meta，开启脚本
//  - 从 dist 提取各面板 buildHtml 模板（处理 ${...} 插值与嵌套模板），替换插值占位后对其 <script> 做语法检查（new Function 只编译不执行）
//  - 快捷键面板已移除 retainContextWhenHidden（审计 P2.3）
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

/** 从模板字面量（idx 指向起始反引号）提取内容；处理 \x 转义、${...} 插值与其中嵌套的模板字面量 */
function extractTemplate(src, idx) {
  let i = idx + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') return src.slice(idx + 1, i);
    if (ch === '$' && src[i + 1] === '{') { i = skipInterp(src, i + 2); continue; }
    i++;
  }
  return null;
}
/** i 位于 '${' 之后，返回配平的 '}' 之后的位置（支持嵌套模板字面量） */
function skipInterp(src, i) {
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '{') { depth++; i++; continue; }
    if (ch === '}') { depth--; i++; continue; }
    if (ch === '`') { i = skipTemplate(src, i); continue; }
    i++;
  }
  return i;
}
/** idx 指向嵌套模板的起始反引号，返回其结束反引号之后的位置 */
function skipTemplate(src, idx) {
  let i = idx + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { i += 2; continue; }
    if (ch === '`') return i + 1;
    if (ch === '$' && src[i + 1] === '{') { i = skipInterp(src, i + 2); continue; }
    i++;
  }
  return i;
}
/** 把模板中未转义的 ${...} 插值替换为字面量 0（语法检查用；\${ 保持原样） */
function neutralizePlaceholders(tpl) {
  let out = '';
  let i = 0;
  while (i < tpl.length) {
    const ch = tpl[i];
    if (ch === '\\') { out += tpl.slice(i, i + 2); i += 2; continue; }
    if (ch === '$' && tpl[i + 1] === '{') { i = skipInterp(tpl, i + 2); out += '0'; continue; }
    out += ch;
    i++;
  }
  return out;
}

const PANELS = [
  { file: 'projectPropertiesPanel.js', name: '项目属性', escapePattern: /function esc\(/ },
  { file: 'keybindingPanel.js', name: '快捷键', escapePattern: /function esc\(/ },
  { file: 'compilerOptionsPanel.js', name: '编译选项', escapePattern: /escapeHtml\(/ },
];

for (const p of PANELS) {
  const distPath = path.resolve(__dirname, '../dist/ui', p.file);
  const dist = fs.readFileSync(distPath, 'utf-8');
  check(`${p.name}：开启脚本 enableScripts`, dist.includes('enableScripts: true'), null);

  const marker = dist.indexOf('return `<!DOCTYPE html>');
  let tpl = null;
  if (marker >= 0) tpl = extractTemplate(dist, marker + 'return '.length);
  check(`${p.name}：模板提取成功`, tpl !== null && tpl.includes('</html>'), tpl === null ? 'extract failed' : undefined);

  if (tpl) {
    check(`${p.name}：含 CSP meta`, tpl.includes('http-equiv="Content-Security-Policy"'), null);
    // 转义函数：项目属性/快捷键在模板内（客户端 esc）；编译选项在宿主侧（escapeHtml/escapeAttr 先构建再插值）
    check(`${p.name}：含转义函数`, p.escapePattern.test(tpl) || p.escapePattern.test(dist), null);

    const html = neutralizePlaceholders(tpl);
    const sm = html.match(/<script>([\s\S]*?)<\/script>/);
    check(`${p.name}：提取到 <script> 块`, !!sm, null);
    if (sm) {
      try {
        new Function(sm[1]);
        check(`${p.name}：<script> 语法合法`, true, null);
      } catch (e) {
        check(`${p.name}：<script> 语法合法`, false, e.message);
      }
    }
  }
}

// 快捷键面板：retainContextWhenHidden 已移除（其余两个面板不受影响）
{
  const kb = fs.readFileSync(path.resolve(__dirname, '../dist/ui/keybindingPanel.js'), 'utf-8');
  check('快捷键面板：已移除 retainContextWhenHidden', !kb.includes('retainContextWhenHidden'), null);
}

console.log(`WebView 面板回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
