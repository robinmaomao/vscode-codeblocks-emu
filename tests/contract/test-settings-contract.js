// 设置契约测试（L-1 静态）：
//  - 9 个分区、键唯一、title/order 合法
//  - 每项设置的 type/default/enum/min/max/items/scope 自洽
//  - description / markdownDescription / enumDescriptions 的 nls 占位符在英文/中文 nls 都存在
//  - 英文 nls 不含中文；中文 nls 无缺失
//  - description 中 `#codeblocks.xxx#` 引用的设置键真实存在
//  - 设置文档 settings.md / settings.en.md 覆盖全部设置键
//  - 已移除的 clangd.queryDriver 不再声明
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8'));
const pkg = readJson('package.json');
const en = readJson('package.nls.json');
const zh = readJson('package.nls.zh-cn.json');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
const nlsOf = (v) => {
  if (typeof v !== 'string') return undefined;
  const m = /^%([A-Za-z0-9_.-]+)%$/.exec(v);
  return m ? m[1] : undefined;
};

const sections = pkg.contributes.configuration;
check('configuration 是数组且为 10 个分区', Array.isArray(sections) && sections.length === 10, sections.length);
check('分区 order 严格递增', sections.every((s, i) => i === 0 || sections[i - 1].order < s.order), sections.map((s) => s.order));
check('分区标题均为 nls 占位符', sections.every((s) => nlsOf(s.title)), sections.map((s) => s.title));

const keys = [];
const byKey = {};
for (const s of sections) {
  for (const [k, v] of Object.entries(s.properties || {})) {
    keys.push(k);
    byKey[k] = v;
  }
}
check('设置项总数 = 85', keys.length === 85, keys.length);
check('设置键唯一', new Set(keys).size === keys.length, keys.length - new Set(keys).size);
check('已移除 clangd.queryDriver', !Object.prototype.hasOwnProperty.call(byKey, 'codeblocks.clangd.queryDriver'), keys.filter((k) => /queryDriver$/.test(k)));

const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'array', 'object', 'null']);
const SCOPES = new Set(['application', 'machine', 'machine-overridable', 'window', 'resource', 'language-overridable']);
const defaultMatches = (type, value) => {
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') return typeof value === 'string';
  if (type === 'number' || type === 'integer') return typeof value === 'number' && Number.isFinite(value) && (type !== 'integer' || Number.isInteger(value));
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'null') return value === null;
  return true;
};

for (const key of keys) {
  const p = byKey[key];
  check(`${key}: 含 type`, TYPES.has(p.type), p.type);
  check(`${key}: 含默认值且与 type 一致`, Object.prototype.hasOwnProperty.call(p, 'default') && defaultMatches(p.type, p.default), { type: p.type, default: p.default });
  check(`${key}: 描述为 nls 占位符`, !!nlsOf(p.description) || !!nlsOf(p.markdownDescription), { description: p.description, markdownDescription: p.markdownDescription });
  if (p.scope !== undefined) check(`${key}: scope 合法`, SCOPES.has(p.scope), p.scope);
  if (p.enum) {
    check(`${key}: enum 为非空数组`, Array.isArray(p.enum) && p.enum.length > 0, p.enum);
    check(`${key}: default 在 enum 内`, p.enum.includes(p.default), { default: p.default, enum: p.enum });
    if (p.enumDescriptions) check(`${key}: enumDescriptions 与 enum 等长`, p.enumDescriptions.length === p.enum.length, { enum: p.enum.length, desc: p.enumDescriptions.length });
  }
  if (p.type === 'number' || p.type === 'integer') {
    if (p.minimum !== undefined) check(`${key}: default ≥ minimum`, p.default >= p.minimum, { default: p.default, minimum: p.minimum });
    if (p.maximum !== undefined) check(`${key}: default ≤ maximum`, p.default <= p.maximum, { default: p.default, maximum: p.maximum });
    if (p.minimum !== undefined && p.maximum !== undefined) check(`${key}: minimum ≤ maximum`, p.minimum <= p.maximum, { minimum: p.minimum, maximum: p.maximum });
  }
  if (p.type === 'array') check(`${key}: array 含 items`, p.items && typeof p.items === 'object', p.items);
  if (p.type === 'object' && p.properties) {
    for (const [prop, spec] of Object.entries(p.properties)) {
      check(`${key}.${prop}: 子属性含 type`, TYPES.has(spec.type), spec.type);
    }
  }
  const descKeys = [p.description, p.markdownDescription, ...(p.enumDescriptions || [])].map(nlsOf).filter(Boolean);
  for (const nk of descKeys) {
    check(`${key}: nls 键 ${nk} 在英文包存在`, typeof en[nk] === 'string' && en[nk].length > 0, en[nk]);
    check(`${key}: nls 键 ${nk} 在中文包存在`, typeof zh[nk] === 'string' && zh[nk].length > 0, zh[nk]);
    if (typeof en[nk] === 'string') check(`${key}: 英文 nls ${nk} 不含中文`, !/[\u4e00-\u9fff]/.test(en[nk]), en[nk]);
  }
  // markdownDescription 里的 #codeblocks.xxx# 引用必须真实存在
  const md = nlsOf(p.markdownDescription);
  if (md && typeof en[md] === 'string') {
    for (const m of en[md].matchAll(/#(codeblocks\.[A-Za-z0-9_.]+)#/g)) {
      check(`${key}: markdown 引用 ${m[1]} 已声明`, Object.prototype.hasOwnProperty.call(byKey, m[1]), m[1]);
    }
  }
}

// 分区标题 nls
for (const s of sections) {
  const nk = nlsOf(s.title);
  check(`分区 ${s.title}: 英文标题存在`, typeof en[nk] === 'string' && en[nk].length > 0, en[nk]);
  check(`分区 ${s.title}: 中文标题存在`, typeof zh[nk] === 'string' && zh[nk].length > 0, zh[nk]);
}

// configuration.* nls 无残留（package.json 未引用的配置文案）
const referenced = new Set();
for (const s of sections) {
  referenced.add(nlsOf(s.title));
  for (const p of Object.values(s.properties || {})) {
    for (const v of [p.description, p.markdownDescription, ...(p.enumDescriptions || [])]) {
      const nk = nlsOf(v);
      if (nk) referenced.add(nk);
    }
  }
}
const staleEn = Object.keys(en).filter((k) => k.startsWith('configuration.') && !referenced.has(k));
const staleZh = Object.keys(zh).filter((k) => k.startsWith('configuration.') && !referenced.has(k));
check('英文 nls 无失效 configuration.* 键', staleEn.length === 0, staleEn);
check('中文 nls 无失效 configuration.* 键', staleZh.length === 0, staleZh);

// 完整设置文档
for (const rel of ['docs/guide/settings.md', 'docs/guide/settings.en.md']) {
  const file = path.join(ROOT, rel);
  const exists = fs.existsSync(file);
  check(`${rel} 存在`, exists, exists);
  if (!exists) continue;
  const text = fs.readFileSync(file, 'utf-8');
  const missing = keys.filter((k) => !text.includes(k));
  check(`${rel} 覆盖全部设置键`, missing.length === 0, missing);
}

// parallelJobs 文案不再宣称 ×2
for (const [name, text] of [['en', en['configuration.codeblocks.parallelJobs.description']], ['zh', zh['configuration.codeblocks.parallelJobs.description']]]) {
  check(`parallelJobs ${name} 文案为逻辑核数且不再 ×2`,
    /logical core/i.test(text || '') || /逻辑核数/.test(text || ''),
    text);
  check(`parallelJobs ${name} 文案不再写 ×2`, !/×\s*2|x\s*2/i.test(text || ''), text);
}

console.log(`\n设置契约: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
process.exit(fail ? 1 : 0);
