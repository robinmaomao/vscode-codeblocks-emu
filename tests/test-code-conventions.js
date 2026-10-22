// 代码约定回归（审计 P3.5）：空 catch 必须带注释说明（或实际处理代码）；src 禁止 console.* / @ts-ignore
// 目的：把"空 catch 需注释说明为何可忽略"的既有惯例固化为自动检查，防止新增静默吞错。
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const SRC = path.resolve(__dirname, '../src');
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
})(SRC);

// ---- 1. 空 catch 检查：body 去掉注释后为空 && body 内无注释 → 违规 ----
const emptyCatch = [];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf-8');
  const re = /catch\s*(\([^)]*\))?\s*\{/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const braceAt = m.index + m[0].length - 1; // 指向 '{'
    let depth = 0, i = braceAt, body = '';
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === '{') { depth++; if (depth === 1) continue; }
      else if (ch === '}') { depth--; if (depth === 0) break; }
      body += ch;
    }
    const noComments = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const hasComment = /\/\/|\/\*/.test(body);
    if (noComments === '' && !hasComment) {
      const line = text.slice(0, m.index).split('\n').length;
      emptyCatch.push(f.replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/') + '/', '') + ':' + line);
    }
    re.lastIndex = i;
  }
}
check('空 catch 为 0（无注释的裸 catch 不允许；注释说明可豁免）', emptyCatch.length === 0, emptyCatch);

// ---- 2. src 禁止 console.*（统一走输出通道 / LogOutputChannel） ----
const consoleHits = [];
for (const f of files) {
  fs.readFileSync(f, 'utf-8').split(/\r?\n/).forEach((l, i) => {
    if (/\bconsole\.(log|error|warn|info)\s*\(/.test(l)) {
      consoleHits.push(f.replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/') + '/', '') + ':' + (i + 1));
    }
  });
}
check('src 无 console.* 调用', consoleHits.length === 0, consoleHits);

// ---- 3. src 禁止 @ts-ignore / @ts-expect-error（需要时先讨论） ----
const tsIgnore = [];
for (const f of files) {
  fs.readFileSync(f, 'utf-8').split(/\r?\n/).forEach((l, i) => {
    if (/@ts-(ignore|expect-error)/.test(l)) {
      tsIgnore.push(f.replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/') + '/', '') + ':' + (i + 1));
    }
  });
}
check('src 无 @ts-ignore / @ts-expect-error', tsIgnore.length === 0, tsIgnore);

// ---- 4. 已迁移 i18n 的文件：UI 语境行不得再出现中文字面量（防新代码绕过 i18n.t） ----
// 迁移范围与批次见 docs/国际化.md：文件迁移完成后加入白名单，此后新写的弹窗/QuickPick/状态栏文案
// 必须走 i18n.t('English source', …)，中文译义放 src/i18n/strings.zh-cn.json。
const I18N_MIGRATED_FILES = [
  'extension.ts',
  'ui/statusBarMenu.ts',
  'ui/projectPropertiesPanel.ts',
  'ui/keybindingPanel.ts',
  'ui/compilerOptionsPanel.ts',
];
/** 已完成「全量本地化」的文件：不得再出现任何中文字符串字面量 / 模板文本（AST 级，多行模板也覆盖） */
const I18N_DONE_FILES = [
  'extension.ts',
  'ui/projectPropertiesPanel.ts',
  'ui/keybindingPanel.ts',
  'ui/compilerOptionsPanel.ts',
  'ui/analysisTreeProvider.ts',
  'ui/buildLogTreeProvider.ts',
  'ui/projectTreeProvider.ts',
  'ui/symbolTreeProvider.ts',
  'ui/registersTreeProvider.ts',
  'debug/gdbDebugAdapter.ts',
  'debug/gdbMiSession.ts',
  'debug/debugConfigProvider.ts',
  'tools/keybindingConfig.ts',
  'tools/keybindingConflicts.ts',
  'tools/clangd.ts',
  'tools/astyle.ts',
  'tools/codeCompletion.ts',
  'tools/lru.ts',
  'project/newProject.ts',
  'project/userTemplates.ts',
  'project/exportTarget.ts',
  'project/projectImporter.ts',
  'model/virtualFolders.ts',
  'model/parser.ts',
  'build/buildEngine.ts',
  'build/buildProfiler.ts',
  'build/compilerCache.ts',
  'build/makefileExporter.ts',
  'build/scriptRunner.ts',
  'build/outputFileInfo.ts',
];
const UI_CONTEXT_PATTERNS = [
  /showInformationMessage/,
  /showWarningMessage/,
  /showErrorMessage/,
  /showQuickPick/,
  /showInputBox/,
  /setStatusBarMessage/,
  /placeHolder\s*:/,
  /validateInput/,
  /StatusBar\.(text|tooltip)\s*=/,
  /\.tooltip\s*=/, // 状态栏项 tooltip（如 item.tooltip = …）
];
const i18nViolations = [];
for (const f of files) {
  const rel = f.replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/') + '/', '');
  if (!I18N_MIGRATED_FILES.includes(rel)) continue;
  fs.readFileSync(f, 'utf-8').split(/\r?\n/).forEach((l, i) => {
    if (!/[\u4e00-\u9fff]/.test(l)) return;
    if (!UI_CONTEXT_PATTERNS.some((p) => p.test(l))) return;
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) return; // 纯注释行
    i18nViolations.push(`${rel}:${i + 1}  ${l.trim().slice(0, 80)}`);
  });
}
check('已迁移 i18n 的文件中，UI 语境行无中文字面量', i18nViolations.length === 0, i18nViolations.slice(0, 10));

// ---- 4b. 已完成本地化的文件：任何中文字符串字面量 / 模板文本都算违规（AST 级，含多行模板） ----
// 行级规则（第 4 项）会被「多行模板 + 续行文案」绕过；这里按 AST 逐节点检查，杜绝同类漏网。
const doneViolations = [];
for (const f of files) {
  const rel = f.replace(/\\/g, '/').replace(SRC.replace(/\\/g, '/') + '/', '');
  if (!I18N_DONE_FILES.includes(rel)) continue;
  const text = fs.readFileSync(f, 'utf-8');
  const sf = ts.createSourceFile(f, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const visit = (node) => {
    // 豁免：i18n.tr('中文原文') / i18n.t('…') 的第一个实参（中文即键，见 docs/国际化.md）
    const parent = node.parent;
    if (parent && ts.isCallExpression(parent) && parent.arguments[0] === node
      && ts.isPropertyAccessExpression(parent.expression)
      && ts.isIdentifier(parent.expression.expression) && parent.expression.expression.text === 'i18n'
      && (parent.expression.name.text === 'tr' || parent.expression.name.text === 't')) {
      return;
    }
    let cooked = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) cooked = node.text;
    else if (ts.isTemplateExpression(node)) {
      cooked = node.head.text + node.templateSpans.map((s, i) => `{${i}}` + s.literal.text).join('');
    }
    if (cooked) {
      // 模板里的 HTML/CSS/JS 注释不面向用户（不进词条表），检查前打码
      const visible = cooked
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '');
      if (/[\u4e00-\u9fff]/.test(visible)) {
        const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
        doneViolations.push(`${rel}:${line}  ${JSON.stringify(cooked.slice(0, 60))}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
check('已完成本地化的文件无中文字面量（i18n.tr / i18n.t 全覆盖）', doneViolations.length === 0, doneViolations.slice(0, 10));

// ---- 5. 样例自检：确认检测器本身能捕获"裸 catch" ----
{
  const sample = 'function f() { try { g(); } catch { } }';
  const re = /catch\s*(\([^)]*\))?\s*\{/g;
  const m = re.exec(sample);
  const braceAt = m.index + m[0].length - 1;
  let depth = 0, i = braceAt, body = '';
  for (; i < sample.length; i++) {
    const ch = sample[i];
    if (ch === '{') { depth++; if (depth === 1) continue; }
    else if (ch === '}') { depth--; if (depth === 0) break; }
    body += ch;
  }
  const noComments = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const hasComment = /\/\/|\/\*/.test(body);
  check('自检：裸 catch 会被检测器捕获', noComments === '' && !hasComment, body);
}

console.log(`代码约定回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
