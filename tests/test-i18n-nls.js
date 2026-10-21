// 静态贡献 nls 覆盖回归（0.8.132-dev）：
//  - package.json 中所有**用户可见文案**必须为 %key% 占位符（命令标题 / 设置描述与枚举说明 /
//    视图名 / 视图容器标题 / 欢迎语 / 调试器片段描述 / displayName / description）
//  - 每个占位符在两个 nls 文件中都必须存在且非空（VS Code 只在「整个字符串恰为 %key%」时替换，
//    缺失键会把 %key% 原样显示在命令面板/设置界面 ⇒ 属可见缺陷）
//  - 英文值不含中文；中文值含中文（专名/纯技术名白名单豁免）；两文件键集合一致
//  - package.json 内**不得出现二级占位符**（值形如 %a% 而 nls 里又是 %b%）——会被原样显示
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

const ROOT = path.resolve(__dirname, '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf-8'));
const pkg = readJson('package.json');
const en = readJson('package.nls.json');
const zh = readJson('package.nls.zh-cn.json');

/** 无需翻译（产品名 / 专名）：中英文可相同或不需要中文 */
const NO_TRANSLATION = new Set(['extension.displayName', 'viewsContainer.codeblocks.title', 'configuration.intellisense.title']);
const PLACEHOLDER = /^%[A-Za-z0-9_.\-]+%$/;

// ---- 1. 收集「用户可见文案」的 jsonPath → 值 ----
const targets = []; // { path, key (无引号), value }
const push = (jsonPath, value, key) => targets.push({ path: jsonPath, value, key });

push('displayName', pkg.displayName, 'extension.displayName');
push('description', pkg.description, 'extension.description');
(pkg.contributes.commands || []).forEach((c, i) => push(`contributes.commands[${i}].title`, c.title, `command.${c.command}.title`));
for (const [container, list] of Object.entries(pkg.contributes.views || {})) {
  list.forEach((v, i) => push(`contributes.views.${container}[${i}].name`, v.name, `view.${v.id}.name`));
}
for (const [loc, list] of Object.entries(pkg.contributes.viewsContainers || {})) {
  list.forEach((v, i) => push(`contributes.viewsContainers.${loc}[${i}].title`, v.title, `viewsContainer.${v.id}.title`));
}
(pkg.contributes.viewsWelcome || []).forEach((w, i) => push(`contributes.viewsWelcome[${i}].contents`, w.contents, `viewsWelcome.${w.view}.contents`));
const cfgBlocks = Array.isArray(pkg.contributes.configuration) ? pkg.contributes.configuration : [pkg.contributes.configuration];
for (const block of cfgBlocks) {
  for (const [settingKey, def] of Object.entries(block.properties || {})) {
    for (const field of ['description', 'markdownDescription']) {
      if (def[field] !== undefined) push(`configuration.${settingKey}.${field}`, def[field], `configuration.${settingKey}.${field}`);
    }
    (def.enumDescriptions || []).forEach((d, i) => push(`configuration.${settingKey}.enumDescriptions[${i}]`, d, `configuration.${settingKey}.enumDescription.${i}`));
  }
  if (block.title !== undefined) push(`configuration.${block.order}.title`, block.title, null);
}
(pkg.contributes.debuggers || []).forEach((d, di) => {
  (d.configurationSnippets || []).forEach((s, si) => push(`contributes.debuggers[${di}].configurationSnippets[${si}].description`, s.description, `debugger.snippet.${si}.description`));
});

check('A1 收集到用户可见文案（>150 项）', targets.length > 150, targets.length);

// ---- 2. 全部为 %key% 占位符 ----
const notPlaceholder = targets.filter((t) => !PLACEHOLDER.test(String(t.value)));
check('A2 所有用户可见文案均为 %key% 占位符', notPlaceholder.length === 0, notPlaceholder.slice(0, 10).map((t) => `${t.path} = ${t.value}`));

// ---- 3. 占位符键在两份 nls 中都存在且非空 ----
const missingEn = [];
const missingZh = [];
const emptyEn = [];
const emptyZh = [];
for (const t of targets) {
  if (!PLACEHOLDER.test(String(t.value))) continue;
  const key = String(t.value).slice(1, -1);
  if (!(key in en)) missingEn.push(key);
  if (!(key in zh)) missingZh.push(key);
  if (key in en && !String(en[key]).trim()) emptyEn.push(key);
  if (key in zh && !String(zh[key]).trim()) emptyZh.push(key);
}
check('A3 英文 nls 覆盖全部占位符键', missingEn.length === 0, missingEn.slice(0, 10));
check('A4 中文 nls 覆盖全部占位符键', missingZh.length === 0, missingZh.slice(0, 10));
check('A5 英文 nls 值无空串（否则命令面板显示 %key%）', emptyEn.length === 0, emptyEn.slice(0, 10));
check('A6 中文 nls 值无空串', emptyZh.length === 0, emptyZh.slice(0, 10));

// ---- 4. 键集合一致（与 contract H1 同源，此处就近给定位） ----
const enKeys = Object.keys(en).sort();
const zhKeys = Object.keys(zh).sort();
check('B1 两 nls 文件键集合一致',
  JSON.stringify(enKeys) === JSON.stringify(zhKeys),
  { onlyEn: enKeys.filter((k) => !(k in zh)), onlyZh: zhKeys.filter((k) => !(k in en)) });

// ---- 5. 语言质量 ----
const enCjk = enKeys.filter((k) => /[\u4e00-\u9fff]/.test(String(en[k])));
check('B2 英文值不含中文', enCjk.length === 0, enCjk.slice(0, 10));
const zhNoCjk = zhKeys.filter((k) => !/[\u4e00-\u9fff]/.test(String(zh[k])) && !NO_TRANSLATION.has(k));
check('B3 中文值含中文（产品名/专名白名单豁免）', zhNoCjk.length === 0, zhNoCjk.slice(0, 10));
const sameAsEn = zhKeys.filter((k) => zh[k] === en[k] && !NO_TRANSLATION.has(k));
check('B4 中文值不得与英文完全相同（白名单豁免）', sameAsEn.length === 0, sameAsEn.slice(0, 10));

// ---- 6. 无二级占位符（nls 值本身又是一个 %key%） ----
const nested = enKeys.filter((k) => PLACEHOLDER.test(String(en[k])) || PLACEHOLDER.test(String(zh[k])));
check('B5 nls 值不得是二级占位符（会原样显示 %key%）', nested.length === 0, nested.slice(0, 10));

// ---- 7. 关键计数（防「悄悄回退成硬编码」） ----
check('C1 命令标题全部走 nls（命令数 == 占位符键数）',
  (pkg.contributes.commands || []).length === targets.filter((t) => /^command\./.test(t.key || '')).length,
  (pkg.contributes.commands || []).length);
const settingDescTargets = targets.filter((t) => /^configuration\./.test(String(t.key || '')) && !/\.title$/.test(String(t.key)));
check('C2 设置描述/枚举说明全部走 nls（>60 项）', settingDescTargets.length > 60, settingDescTargets.length);
check('C3 视图名与容器标题全部走 nls',
  targets.filter((t) => /^(view|viewsContainer)\./.test(String(t.key || ''))).length ===
    Object.values(pkg.contributes.views || {}).flat().length + Object.values(pkg.contributes.viewsContainers || {}).flat().length,
  targets.filter((t) => /^view/.test(String(t.key || ''))).length);

console.log(`\nnls 静态覆盖回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
