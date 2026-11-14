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

// ============ 面板可用性 / 布局回归（0.8.136） ============
// 缺陷 1：doSave() 无条件收集所有 tab 的表单，而未访问过的 tab 元素不存在 ⇒ 抛 TypeError ⇒ 保存静默失效。
// 缺陷 2：.list-actions 无 flex-wrap + button 无 white-space:nowrap ⇒ 窄面板下中文按钮逐字换行成竖排单字。
/** 取 CSS 中某个选择器的声明体（选择器需出现在行首，避免匹配到 `.ops button` 之类） */
function ruleBody(css, selector) {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp('(?:^|\\n)[ \\t]*' + esc + '[ \\t]*\\{([^}]*)\\}'));
  return m ? m[1] : null;
}
/** 取内联脚本中某个函数的函数体（花括号配平；模板占位已中和为 0） */
function fnBody(script, name) {
  const start = script.indexOf('function ' + name + '(');
  if (start < 0) return null;
  const brace = script.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < script.length; i++) {
    if (script[i] === '{') depth++;
    else if (script[i] === '}') {
      depth--;
      if (depth === 0) return script.slice(brace, i + 1);
    }
  }
  return null;
}

{
  const propsDist = fs.readFileSync(path.resolve(__dirname, '../dist/ui/projectPropertiesPanel.js'), 'utf-8');
  const tpl = extractTemplate(propsDist, propsDist.indexOf('return `<!DOCTYPE html>') + 'return '.length);
  const html = neutralizePlaceholders(tpl);
  const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  const script = (html.match(/<script>([\s\S]*?)<\/script>/) || [, ''])[1];

  check('工程属性：按钮禁止逐字换行（button white-space: nowrap）',
    /white-space:\s*nowrap/.test(ruleBody(css, 'button') || ''), ruleBody(css, 'button'));
  check('工程属性：列表按钮行可换行（.list-actions flex-wrap）',
    /flex-wrap:\s*wrap/.test(ruleBody(css, '.list-actions') || ''), ruleBody(css, '.list-actions'));
  check('工程属性：顶栏可换行（.toolbar flex-wrap）',
    /flex-wrap:\s*wrap/.test(ruleBody(css, '.toolbar') || ''), ruleBody(css, '.toolbar'));
  const layout = ruleBody(css, '.layout') || '';
  check('工程属性：列表列有下限、表单列可收缩（minmax）',
    /minmax\(200px,\s*260px\)/.test(layout) && /minmax\(0,\s*1fr\)/.test(layout), layout);
  check('工程属性：窄面板改为上下堆叠（媒体查询）', /@media\s*\(max-width:\s*760px\)/.test(css), null);
  // C/C++ parser options 的 Add/Edit/Remove 必须左对齐（CB 按钮行紧跟列表左侧，不居中）
  check('工程属性：C/C++ parser 按钮行左对齐（.plain-actions.left）',
    /\.plain-actions\.left\s*\{[^}]*justify-content:\s*flex-start/.test(css) &&
    /<div class="plain-actions left">[\s\S]{0,200}?id="parser-add"/.test(html), ruleBody(css, '.plain-actions.left'));

  const save = fnBody(script, 'doSave') || '';
  check('工程属性：保存前收集异常不再逃逸（try/catch）', /try\s*\{/.test(save) && /catch\s*\(/.test(save), save.slice(0, 120));
  check('工程属性：收集异常时在状态栏可见', /setStatus\(/.test(save) && /return;/.test(save), save.slice(0, 200));
  const fBody = fnBody(script, 'collectFileForm') || '';
  const vBody = fnBody(script, 'collectVTForm') || '';
  const tBody = fnBody(script, 'collectTargetForm') || '';
  check('工程属性：文件表单未渲染时跳过收集（元素存在性守卫）',
    /document\.getElementById\('ff-var'\)/.test(fBody) && /if \(!\w+/.test(fBody), fBody.slice(0, 120));
  check('工程属性：虚拟目标表单未渲染时跳过收集',
    /document\.getElementById\('vt-alias'\)/.test(vBody) && /if \(!\w+/.test(vBody), vBody.slice(0, 120));
  check('工程属性：目标表单未渲染时跳过收集',
    /if \(!targets\.length \|\| !document\.getElementById\('f-type'\)\) return;/.test(tBody), tBody.slice(0, 150));
  // 目标被删除后各目标级 tab 的作用域索引可能失效：collect 必须能跳过而不是抛错（否则整次保存失败）
  for (const name of ['collectOptionsForm', 'collectDirsForm']) {
    const body = fnBody(script, name) || '';
    check(`工程属性：${name} 作用域失效时跳过（if (!cur) return）`, /if \(!cur\) return;/.test(body), body.slice(0, 200));
  }
  // 脚本 tab 不再有作用域表单（直接读写数组），因此只需保证它不依赖未渲染的 DOM 节点
  check('工程属性：collectScriptsForm 不依赖作用域 DOM',
    !/document\.getElementById\(/.test(fnBody(script, 'collectScriptsForm') || ''),
    fnBody(script, 'collectScriptsForm'));
  const dbgBody = fnBody(script, 'collectDebugForm') || '';
  check('工程属性：collectDebugForm 未渲染时跳过 remote 段（保留 search_path）',
    /if \(!document\.getElementById\('dbg-conn'\)\) return;/.test(dbgBody) && !/dbg\.searchPaths = optionsLines\(/.test(dbgBody), dbgBody.slice(0, 240));
  // 调试器远程配置按目标标题索引：改名/删除目标时必须同步，否则保存出孤儿 <remote_debugging target="…"> 节点
  check('工程属性：目标改名同步调试器远程配置',
    /dbg\.remote\.forEach\(r => \{ if \(r\.target === oldTitle\) r\.target = title; \}\)/.test(script), null);
  check('工程属性：目标删除清掉调试器远程配置',
    /dbg\.remote = dbg\.remote\.filter\(r => r\.target !== removedTitle\)/.test(script), null);
  // VS Code WebView 的 iframe 沙箱不含 allow-modals：window.prompt/confirm 静默失效，必须用面板内模态
  check('工程属性：WebView 内不使用 window.prompt / window.confirm',
    !/window\.prompt\s*\(/.test(script) && !/window\.confirm\s*\(/.test(script),
    (script.match(/window\.(prompt|confirm)\s*\(/) || [null])[0]);
  check('工程属性：输入/确认走面板内模态（askText / confirmBox）',
    /function askText\(/.test(script) && /function confirmBox\(/.test(script), null);
  check('工程属性：还原设置使用 confirmBox 确认',
    /confirmBox\('/.test(fnBody(script, 'restoreSettings') || ''), fnBody(script, 'restoreSettings'));
  // 对齐 CB project_options.xrc：两个页面都没有「高级（扩展）」分组，扩展字段改由 Build options 编辑
  check('工程属性：Project settings / Build targets 不再内嵌「高级（扩展）」',
    !/i18n\.tr\('高级（扩展）'\)/.test(script) && !/set-compiler|set-vfolders|set-vars|f-title|f-params|f-extdeps|f-addout|f-envvars/.test(script), null);
  check('工程属性：目标表单守卫改用 f-type（重命名改由左栏按钮）',
    /document\.getElementById\('f-type'\)\) return;/.test(fnBody(script, 'collectTargetForm') || ''), null);
  // CB 默认值：未配置时显示默认值，未改动则写回空串（不污染 .cbp）
  check('工程属性：CB 默认值常量（Makefile / 工作目录 / 导入库宏）',
    /DEFAULT_MAKEFILE = 'Makefile'/.test(script) && /DEFAULT_WORKDIR = '\.'/.test(script)
    && /DEFAULT_LIB_EXPR = '\$\(TARGET_OUTPUT_DIR\)\$\(TARGET_OUTPUT_BASENAME\)'/.test(script)
    && /DEFAULT_EXEC_DIR = data\.basePath/.test(script), null);
  check('工程属性：Makefile / 执行目录按默认值渲染',
    /projSettings\.makefile \|\| DEFAULT_MAKEFILE/.test(script) && /projSettings\.executionDir \|\| DEFAULT_EXEC_DIR/.test(script), null);
  check('工程属性：Makefile / 执行目录未改动时写回空串',
    /mk === DEFAULT_MAKEFILE \? '' : mk/.test(script) && /execDir === DEFAULT_EXEC_DIR \? '' : execDir/.test(script), null);
  check('工程属性：导入库 / 定义文件 / 工作目录按 CB 默认值渲染',
    /t\.impLib \|\| DEFAULT_LIB_EXPR/.test(script) && /t\.defFile \|\| DEFAULT_LIB_EXPR/.test(script)
    && /t\.workingDir \|\| DEFAULT_WORKDIR/.test(script), null);
  check('工程属性：导入库 / 定义文件 / 工作目录未改动时写回空串',
    /impLib === DEFAULT_LIB_EXPR \? '' : impLib/.test(script) && /defFile === DEFAULT_LIB_EXPR \? '' : defFile/.test(script)
    && /workdir === DEFAULT_WORKDIR \? '' : workdir/.test(script), null);
  check('工程属性：payload 带 basePath（执行目录默认值）', /basePath: this\.project\.basePath/.test(propsDist), null);
  // Debugger：CB notebook 页签 + 两列远程字段 + Baud 可编辑下拉
  check('工程属性：Debugger 使用 CB notebook 页签（.dbg-tabs/.dbg-page）',
    /class="dbg-tabs"/.test(script) && /class="dbg-page"/.test(script) && /\.dbg-tab\.active/.test(css), null);
  check('工程属性：Debugger 远程字段两列（.dbg-grid）+ 短字段（波特率/端口）',
    /class="dbg-grid"/.test(script) && /class="short"/.test(script)
    && /\.dbg-grid > label\.short > input \{ width: 120px/.test(css), null);
  check('工程属性：Baud 为可编辑下拉（datalist）',
    /list="dbg-baud-list"/.test(script) && /id="dbg-baud-list"/.test(script) && /<option value="115200">/.test(script), null);
  check('工程属性：Debugger 选择目标标签 + 窄列表',
    /dbg-scope-grid/.test(script) && /id="dbg-scope-list"/.test(script) && /\.dbg-scope-grid \{/.test(css), null);
  check('工程属性：目标文件列表限高、工具栏常驻',
    /#tflist \{ flex: 1 1 auto; min-height: 100px; max-height: 120px; \}/.test(css)
    && /\.targets-column > \.card:last-child \{ flex: 1;/.test(css), null);
  check('工程属性：Build targets 左列等高、创建工程按钮贴底',
    /\.targets-layout > \.card > \.card-body \{ flex: 1;/.test(css) && /btn-spacer/.test(html), null);
  check('工程属性：targets 页不再画分隔线（.cb-sep 已移除）', !/cb-sep/.test(script) && !/\.cb-sep/.test(css), null);
  check('工程属性：Auto-generate 位于 Execution working dir 之前',
    script.indexOf("id=\"f-prefix\"") < script.indexOf("id=\"f-workdir\"")
    && script.indexOf("id=\"f-deffile\"") < script.indexOf("id=\"f-prefix\""), null);
  check('工程属性：组标题不再显示计数徽标', !/id="target-count"/.test(script) && !/id="file-count"/.test(script), null);
}

// 编译选项（Build options）：共享视图 = CSS + HTML 片段 + 内联脚本（0.8.150 起重写为 Code::Blocks 对齐版）
{
  const dist = fs.readFileSync(path.resolve(__dirname, '../dist/ui/buildOptionsView.js'), 'utf-8');

  const cssIdx = dist.indexOf('function buildOptionsCss');
  const cssTpl = cssIdx >= 0 ? extractTemplate(dist, dist.indexOf('return `', cssIdx) + 'return '.length) : null;
  check('编译选项：CSS 模板提取成功', !!cssTpl, null);

  const pageIdx = dist.indexOf('function buildOptionsPage');
  const pageTpl = pageIdx >= 0 ? extractTemplate(dist, dist.indexOf('return `', pageIdx) + 'return '.length) : null;
  check('编译选项：页面模板提取成功', !!pageTpl && pageTpl.includes('</html>'), pageTpl === null ? 'extract failed' : undefined);
  if (pageTpl) {
    check('编译选项：含 CSP meta', pageTpl.includes('http-equiv="Content-Security-Policy"'), null);
    const html = neutralizePlaceholders(pageTpl);
    const sm = html.match(/<script>([\s\S]*?)<\/script>/);
    check('编译选项：提取到 <script> 块', !!sm, null);
    if (sm) {
      try {
        new Function(sm[1]);
        check('编译选项：<script> 语法合法', true, null);
      } catch (e) {
        check('编译选项：<script> 语法合法', false, e.message);
      }
    }
  }

  const scriptIdx = dist.indexOf('function buildOptionsScript');
  const jsTpl = scriptIdx >= 0 ? extractTemplate(dist, dist.indexOf('return `', scriptIdx) + 'return '.length) : null;
  check('编译选项：内联脚本模板提取成功', !!jsTpl, null);
  if (jsTpl) {
    try {
      new Function(neutralizePlaceholders(jsTpl));
      check('编译选项：内联脚本语法合法', true, null);
    } catch (e) {
      check('编译选项：内联脚本语法合法', false, e.message);
    }
  }

  if (cssTpl) {
    check('编译选项：按钮禁止逐字换行（white-space: nowrap）', /white-space:\s*nowrap/.test(cssTpl), null);
    check('编译选项：操作按钮可换行（.bo-actions flex-wrap）',
      /\.bo-actions \{[^}]*flex-wrap:\s*wrap/.test(cssTpl), null);
    check('编译选项：外层页签可横向滚动（.bo-tabs overflow-x）',
      /\.bo-tabs \{[^}]*overflow-x:\s*auto/.test(cssTpl), null);
    check('编译选项：只读派生输入有独立样式（.bo-derived-input）', /\.bo-derived-input\s*\{/.test(cssTpl), null);
  }

  // 扩展字段（原 Properties「高级（扩展）」）：目标作用域新增「扩展」页 + 项目自定义变量并入「自定义变量」页
  check('编译选项：扩展页仅在目标作用域出现（pageList）',
    /if \(!isProject\(\)\) pages\.push\(\['extension', L\.extensionTab\]\);/.test(dist), null);
  check('编译选项：扩展页渲染字段（deps 输出/宿主程序/外部依赖/附加输出）',
    /renderExtension\(el\)/.test(dist) && /bo-ext-depsout/.test(dist) && /bo-ext-host/.test(dist)
    && /bo-ext-extdeps/.test(dist) && /bo-ext-addout/.test(dist), null);
  check('编译选项：扩展页收集写回当前作用域',
    /page === 'extension' && !isProject\(\)/.test(dist) && /sc\.depsOutput = de\.value\.trim\(\)/.test(dist)
    && /sc\.externalDeps = lines\('ext-extdeps'\)/.test(dist), null);
  check('编译选项：切到工程作用域时扩展页回落到编译器设置',
    /function ensurePage\(\)/.test(dist)
    && /page = ids\.indexOf\('compiler'\) >= 0 \? 'compiler' : ids\[0\];/.test(dist), null);
  check('编译选项：自定义变量页含项目自定义变量（仅工程作用域）',
    /bo-customvars/.test(dist) && /isProject\(\) \? '<section class="bo-card">/.test(dist)
    && /DATA\.customVariables = cv\.value\.split/.test(dist), null);
}

{
  const kbDist = fs.readFileSync(path.resolve(__dirname, '../dist/ui/keybindingPanel.js'), 'utf-8');
  const tpl = extractTemplate(kbDist, kbDist.indexOf('return `<!DOCTYPE html>') + 'return '.length);
  const css = (neutralizePlaceholders(tpl).match(/<style>([\s\S]*?)<\/style>/) || [, ''])[1];
  check('快捷键：按钮禁止逐字换行（button white-space: nowrap）',
    /white-space:\s*nowrap/.test(ruleBody(css, 'button') || ''), ruleBody(css, 'button'));
  check('快捷键：工具栏行可换行（.top .row flex-wrap）',
    /flex-wrap:\s*wrap/.test(ruleBody(css, '.top .row') || ''), ruleBody(css, '.top .row'));
}

console.log(`WebView 面板回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
