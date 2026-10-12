// 语法（tmLanguage）冒烟回归：source.ld / source.asm / source.xm
//  - package.json 的 languages ↔ grammars 关联与语法文件存在性
//  - 语法 JSON 结构：scopeName 正确、patterns 非空、repository 引用可解析
//  - 模式可编译为 JS RegExp（Oniguruma 专有构造不强制编译，仅列出）
//  - 样例片段命中：每套语法至少若干条真实样例能匹配到 pattern（match 语义冒烟）
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else {
    fail++; failures.push(name);
    console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`);
  }
}

/** 目标语法与其样例片段（样例取自扩展自身文档与真实工程写法） */
const TARGETS = [
  {
    language: 'ld', scope: 'source.ld',
    samples: [
      ['SECTIONS', 'keyword.control.ld'],
      ['ENTRY(_start)', 'keyword.control.ld'],
      ['KEEP(*(.init))', 'support.function.ld'],
      ['// 行注释', 'comment.line.double-slash.ld'],
      ['/* 块注释 */', 'comment.block.ld'],
      ['#include "config.h"', 'keyword.control.directive.ld'],
      ['PROVIDE(__bss_start = .);', 'keyword.control.ld'],
    ],
  },
  {
    language: 'asm', scope: 'source.asm',
    samples: [
      ['.text', undefined],
      ['.globl main', undefined],
      ['main:', undefined],
      ['la a0, msg', undefined],
      ['ret', undefined],
      ['0x1234', undefined],
      ['# 行注释', undefined],
    ],
  },
  {
    language: 'xm', scope: 'source.xm',
    samples: [
      ['depend "app.elf"', 'keyword.control.xm'],
      ['config SUB "x"', 'keyword.control.xm'],
      ['makecfgfile "x.mk"', 'keyword.control.xm'],
      ['# 行注释', 'comment.line.number-sign.xm'],
      ['MAC 41:42:98:00:00:01', undefined],
    ],
  },
];

/** 收集语法中所有带 match 的规则（含 repository 与 include 引用展开） */
function collectMatchRules(grammar) {
  const rules = [];
  const repo = grammar.repository || {};
  const seen = new Set();
  const walk = (patterns, depth) => {
    if (!Array.isArray(patterns) || depth > 8) return;
    for (const p of patterns) {
      if (!p || typeof p !== 'object') continue;
      if (typeof p.match === 'string') rules.push({ name: p.name, pattern: p.match });
      if (typeof p.begin === 'string') rules.push({ name: p.name, pattern: p.begin });
      if (typeof p.include === 'string') {
        const key = p.include.replace(/^#/, '');
        if (repo[key] && !seen.has(key)) { seen.add(key); walk(repo[key].patterns, depth + 1); }
      }
      walk(p.patterns, depth + 1);
    }
  };
  walk(grammar.patterns, 0);
  for (const [k, v] of Object.entries(repo)) {
    if (!seen.has(k)) { seen.add(k); walk(v.patterns, 1); }
  }
  return rules;
}

for (const t of TARGETS) {
  const contrib = (pkg.contributes?.grammars || []).find((g) => g.language === t.language);
  check(`G ${t.language}: package.json 声明语法且 scopeName=${t.scope}`,
    !!contrib && contrib.scopeName === t.scope, contrib && contrib.scopeName, t.scope);
  if (!contrib) continue;

  const file = path.join(root, contrib.path);
  check(`G ${t.language}: 语法文件存在（${contrib.path}）`, fs.existsSync(file), contrib.path);
  if (!fs.existsSync(file)) continue;

  const grammar = JSON.parse(fs.readFileSync(file, 'utf-8'));
  check(`G ${t.language}: JSON 内 scopeName 与声明一致`, grammar.scopeName === t.scope, grammar.scopeName, t.scope);

  const rules = collectMatchRules(grammar);
  const compiled = [];
  const badRegex = [];
  for (const r of rules) {
    try { compiled.push({ name: r.name, re: new RegExp(r.pattern) }); }
    catch (e) { badRegex.push(`${r.pattern} (${e.message.slice(0, 40)})`); }
  }
  check(`G ${t.language}: match/begin 规则数 ≥5（实际 ${rules.length}）`, rules.length >= 5, rules.length, '≥5');
  check(`G ${t.language}: 模式可在 JS RegExp 下编译（失败 ${badRegex.length} 条）`,
    compiled.length >= rules.length * 0.8,
    badRegex.slice(0, 3), '≥80% 可编译');
  console.log(`      · ${t.language} 规则 ${rules.length} 条，可编译 ${compiled.length} 条${badRegex.length ? '，Oniguruma 专有 ' + badRegex.length + ' 条' : ''}`);

  const misses = [];
  for (const [line, expectScope] of t.samples) {
    const hit = compiled.find((c) => (expectScope ? c.name === expectScope : true) && c.re.test(line));
    if (!hit) misses.push(`${line}${expectScope ? ' ⇒ ' + expectScope : ''}`);
    else if (expectScope) check(`G ${t.language}: 样例命中 ${expectScope} ← ${JSON.stringify(line)}`, hit.name === expectScope, hit.name, expectScope);
  }
  check(`G ${t.language}: 样例片段全部可命中（${t.samples.length} 条）`, misses.length === 0, misses, '无未命中');
}

console.log(`\n语法冒烟回归: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
process.exit(fail ? 1 : 0);
