// 运行时词条漂移守卫（0.8.132-dev）：
//  - src/**/*.ts 中所有 `i18n.t('…')` 调用的**英文源串**必须在 src/i18n/strings.zh-cn.json 有词条（不准漏译）
//  - 词条值必须是非空中文（不得照抄英文、不得留占位符键名）
//  - 词条表无孤儿键（未被任何代码引用的词条，防删代码留词条）
//  - 源串与词条的占位符集合一致、序号自 {0} 起连续；消息模板不得内插 ${}（一律用 {N} + 独立实参）
// 实现：用 TypeScript 编译器 API 解析 AST 取调用点（正则/字符串/注释天然不干扰）。
//       早期自研词法器会被源码里的正则字面量（如 /["']/）截断，漏检 149 处调用 ⇒ 改为 AST。
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const DICT_REL = 'src/i18n/strings.zh-cn.json';
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, DICT_REL), 'utf-8'));

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) files.push(p);
  }
})(SRC);

/** 是否是 i18n.t(...) 调用 */
function isI18nCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const e = node.expression;
  return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'i18n' && e.name.text === 't';
}

/** 是否是 logT(...) 调用（构建日志文案；`log.english=true` 恒英文，否则跟随 ui.language） */
function isLogCall(node) {
  return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'logT';
}

const calls = [];
const dynamicTemplates = [];
for (const file of files) {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  if (rel === 'i18n/core.ts') continue; // 核心模块自身不做迁移
  const text = fs.readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if (isI18nCall(node) || isLogCall(node)) {
      const arg = node.arguments[0];
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      if (arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg))) {
        calls.push({ rel, line, source: arg.text });
      } else if (arg && ts.isTemplateExpression(arg)) {
        // 消息模板内插 ${} 无法与词条对齐（约定：用 {N} + 独立实参）
        dynamicTemplates.push({ rel, line, source: text.slice(arg.getStart(sf), arg.getEnd()) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

// ---- 1b. 间接源串（不走字面量 i18n.t('…')，而是运行时以变量取词条） ----
// menuStructure 的菜单标签（`i18n.t(label)`）+ WebView 面板反查表（中文原文为键）
const indirect = new Map(); // source → 出处
{
  const menuFile = path.join(SRC, 'ui/menuStructure.ts');
  const text = fs.readFileSync(menuFile, 'utf-8');
  const sf = ts.createSourceFile(menuFile, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'label'
      && ts.isStringLiteral(node.initializer) && node.initializer.text.trim()
    ) {
      indirect.set(node.initializer.text, 'ui/menuStructure.ts');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

check('S0 扫描到迁移点（>0，说明扫描器有效）', calls.length > 0, calls.length);

// ---- 2. 每个源串必须有词条 ----
const allSources = [...new Set([...calls.map((c) => c.source), ...indirect.keys()])];
const missing = allSources.filter((s) => !dict[s]);
check('S1 所有词条源串（字面量 + 菜单标签）都有 zh-cn 词条', missing.length === 0, missing.slice(0, 10));

// ---- 3. 词条质量 ----
const NO_CJK_OK = new Set(['Code::Blocks', 'GDB', 'clangd', 'GCC', 'G++', 'MSVC', 'LLVM', 'RISC-V', 'Makefile']);
const badValues = Object.entries(dict)
  .filter(([, v]) => typeof v !== 'string' || !v.trim())
  .map(([k]) => `${k} → 空值`);
check('S2 词条值均非空', badValues.length === 0, badValues.slice(0, 10));

const sameAsEnglish = Object.entries(dict)
  .filter(([k, v]) => k === v && !NO_CJK_OK.has(k))
  .map(([k]) => k);
check('S3 词条值不得与英文源串完全相同（专名白名单豁免）', sameAsEnglish.length === 0, sameAsEnglish.slice(0, 10));

const noCjk = Object.entries(dict)
  // 允许：专名白名单；或值里含中文标点（如「｜」「；」，纯分隔符词条本身无汉字）
  .filter(([k, v]) => !/[\u4e00-\u9fff]/.test(v) && !NO_CJK_OK.has(k) && !/[\u3000-\u303f\uff00-\uffef]/.test(v))
  .map(([k, v]) => `${k} → ${v}`);
check('S4 词条值应含中文（专名白名单与中文标点豁免）', noCjk.length === 0, noCjk.slice(0, 10));

// ---- 4. 孤儿键（词条未被任何调用点引用） ----
const used = new Set(allSources);
const orphans = Object.keys(dict).filter((k) => !used.has(k));
check('S5 词条表无孤儿键（都对应真实来源）', orphans.length === 0, orphans.slice(0, 20));

// ---- 5. 占位符规范 ----
const idxOf = (s) => [...new Set([...String(s).matchAll(/\{(\d+)\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
const holes = [];
for (const c of calls) {
  const idx = idxOf(c.source);
  if (idx.length && idx.some((v, i) => v !== i)) holes.push(`${c.rel}:${c.line}  "${c.source}"`);
}
check('S6 源串占位符序号自 {0} 起连续', holes.length === 0, holes.slice(0, 10));

const mismatch = [];
for (const [k, v] of Object.entries(dict)) {
  if (idxOf(k).join(',') !== idxOf(v).join(',')) mismatch.push(`${k}  →  ${v}`);
}
check('S7 词条占位符集合 == 英文源串占位符集合', mismatch.length === 0, mismatch.slice(0, 10));

// ---- 5b. 构建日志：build/** 不得再直接调用 msg(zh, en)（统一走 logT(英文源串)） ----
const msgLeft = [];
for (const file of files) {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  if (!rel.startsWith('build/') || rel === 'build/logLang.ts') continue;
  const text = fs.readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'msg') {
      msgLeft.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
check('S8b build/** 不再直接调用 msg()（改用 logT）', msgLeft.length === 0, msgLeft.slice(0, 10));

check('S8 消息模板不得内插 ${}（用 {N} 占位符 + 独立实参）', dynamicTemplates.length === 0,
  dynamicTemplates.map((d) => `${d.rel}:${d.line} ${d.source.slice(0, 40)}`).slice(0, 10));

// ---- 6. 工具提示 / 悬停 Markdown 构建器：整段函数体内不得残留中文（多行数组/模板无法靠行级规则覆盖） ----
const TOOLTIP_FN = /(Tooltip|Hover|Markdown)/;
const tooltipCjk = [];
for (const file of files) {
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  if (rel === 'i18n/core.ts') continue;
  const text = fs.readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
  const visitFn = (node) => {
    const name = node.name && ts.isIdentifier(node.name) ? node.name.text : '';
    if (name && TOOLTIP_FN.test(name)) {
      const body = node.body ? text.slice(node.body.getStart(sf), node.body.getEnd()) : '';
      for (const m of body.matchAll(/(['"`])((?:[^'"`\\]|\\.)*?)\1/g)) {
        if (/[\u4e00-\u9fff]/.test(m[2])) {
          tooltipCjk.push(`${rel}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1} ${name}() → ${m[2].slice(0, 40)}`);
        }
      }
    }
    ts.forEachChild(node, visitFn);
  };
  visitFn(sf);
}
const tooltipMisses = [...new Set(tooltipCjk)];
check('S9 *Tooltip*/*Hover*/*Markdown* 函数体内无中文字面量', tooltipMisses.length === 0, tooltipMisses.slice(0, 10));

console.log(`\ni18n 词条漂移守卫: ${pass} pass, ${fail} fail（迁移点 ${calls.length}，词条 ${Object.keys(dict).length}）`);
process.exit(fail ? 1 : 0);
