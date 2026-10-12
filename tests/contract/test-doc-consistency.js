// L-1 契约层：文档一致性巡检（B 任务）——用可机器判定的规则检查 docs/ 与仓库现实的漂移。
//
// 规则清单（逐条都能给出「文件:行 + 实际值 vs 期望值」）：
//   D1 覆盖矩阵：docs/测试覆盖矩阵.md（自动生成）的汇总行 / 明细表 / 覆盖项 ID 序列与
//      package.json 的贡献面 + 生成脚本 tests/contract/gen-coverage-matrix.js 的 DAP 清单一致；
//      含「总数 == 明细行数 == 产物数量」「未覆盖数 == ⚠ 行数 == 表尾『未覆盖 N 项』行」「覆盖率 == round(covered/total*100)%」
//      与「各层列计数 == 明细 ✔ 数」等文档内部自洽校验（防手工改一个数字）。
//   D1b 测试报告 §2「覆盖台账」== 覆盖矩阵汇总（docs/README.md 维护约定要求两者保持一致：
//      台账是覆盖矩阵的摘要表述；名称映射仅「设置项→设置」）。
//   D2 性能基准：docs/性能基准.md（自动生成）的结果表/趋势表基准清单 == tests/perf/baseline.json
//      的 benches 键序列；「汇总：N 通过 / M 告警 / K 失败」与判定列 ✅/⚠/❌ 计数一致。
//   D3 文档命令存在性：README.md 与 docs 顶层 *.md 中的 `node tests/xx.js` / `npm run xx` /
//      `npm test` 逐一校验脚本文件或 package.json scripts 存在。
//   D4 文档相对链接：docs/**/*.md（含 release/archive）+ README.md 的 `](...)` 相对链接目标存在
//      （忽略 http(s)/mailto/vscode/command/锚点）。
//   D5 版本标记：docs/测试报告-<ver>.md 文件名与标题、docs/测试覆盖矩阵.md『数据来源 v<ver>』、
//      docs/使用说明.md『版本：<ver>』与 VSIX 文件名、docs/开发进度.md『当前版本 <ver>』
//      均须等于 package.json version。
//
// 明确排除（避免误报，均给出理由）：
//   · 版本规则不扫 docs/archive/** 与 docs/release/**：历史盘点/逐版本发布说明，按其成文时间
//     引用旧版本号是文档本义；
//   · 版本规则不扫 docs/遗留问题决策清单.md / docs/未实现功能待办.md：其「基线版本 xx-dev」
//     是盘点时点的日期锚定记录（正文同句已注明复核时间），不是「当前版本」声明；
//   · 「运行快照类计数」不纳入硬规则：docs/测试报告-0.8.128.md 的「139 个脚本 / TOTAL=153」与
//     docs/开发进度.md 的「TOTAL=145」是某次实测的留档，新增任何测试都会使其漂移（本任务自身
//     也会 +2 个脚本），作为不变量校验会持续假红——现实漂移改由 D1/D2 覆盖「自动生成产物」，
//     快照文案差异按「文案建议」提交主流程处理（见汇报）。
//
// 白名单机制：LINK_WHITELIST / CMD_WHITELIST 当前均为空（实测 docs/** 与 README 全部可解析、
// 全部命令存在）。如需豁免，必须写「文件 -> 目标」+ 行内理由，禁止无理由放宽。
//
// 自证有效（--self-test）：用真实文档 + 内存篡改（不落盘）逐条验证规则会红，并验证未篡改时为绿。
// 用法：node tests/contract/test-doc-consistency.js [--self-test]
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
const readDoc = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8').replace(/^\uFEFF/, '');

/** 链接豁免：`文件 -> [目标…]`（当前为空；豁免须附理由） */
const LINK_WHITELIST = new Map([
  // 例：'docs/xxx.md': ['legacy/old.md'],  // 理由：……
]);
/** 命令豁免：`文件 -> [原样命令串…]`（当前为空；豁免须附理由） */
const CMD_WHITELIST = new Map([]);

const CHECK = '✔';
const DOT = '·';
const UNCOVERED = '未覆盖';

// ---------- D1 覆盖矩阵 ----------

/** 解析 docs/测试覆盖矩阵.md：版本行 / 汇总行 / 各节明细（ID 序列 + 层命中单元格 + 状态） */
function parseMatrixDoc(text) {
  const out = { version: null, summary: [], sections: [] };
  const vm = text.match(/数据来源：package\.json v([\d.]+)/);
  out.version = vm ? vm[1] : null;
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^##\s+(\d+)\.\s+(.+?)\s*$/);
    if (h) { cur = { num: Number(h[1]), title: h[2], rows: [], uncovered: null }; out.sections.push(cur); continue; }
    const u = cur && line.match(/^未覆盖\s+(\d+)\s*项(?:：(.*))?$/);
    if (u) {
      cur.uncovered = { count: Number(u[1]), ids: u[2] ? [...u[2].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [] };
      cur = null;
      continue;
    }
    const c = line.split('|').map((s) => s.trim());
    if (cur && c.length >= 12 && /^\d+$/.test(c[1])) {
      cur.rows.push({ line, id: c[2].replace(/`/g, ''), title: c[3], cells: c.slice(4, 10), status: c[10] });
      continue;
    }
    if (!cur && c.length >= 12 && c[1] && c[1] !== '契约项' && /^\d+$/.test(c[2])) {
      const n = (i) => Number(c[i]);   // 汇总行：| 名称 | 总数 | 6 层 | 未覆盖 | 覆盖率 |
      out.summary.push({ name: c[1], total: n(2), layers: [n(3), n(4), n(5), n(6), n(7), n(8)], uncovered: n(9), pct: c[10] });
    }
  }
  return out;
}

/** 生成脚本里的 DAP 能力清单（文档 §6 的数据源） */
function parseDapCaps(genSrc) {
  const block = (genSrc.match(/const DAP_CAPS = \[([\s\S]*?)\n\];/) || [])[1] || '';
  return [...block.matchAll(/^\s*\['([^']+)'/gm)].map((m) => m[1]);
}

/** D1 规则：返回违规列表（空 = 通过）。matrixText/genSrc/pkg 可注入（供 --self-test）。 */
function checkMatrixDoc(matrixText, genSrc, pkgJson) {
  const v = [];
  const doc = parseMatrixDoc(matrixText);
  const pkgVersion = pkgJson.version;
  if (doc.version !== pkgVersion) v.push(`docs/测试覆盖矩阵.md:7 数据来源版本 got=${doc.version} want=${pkgVersion}`);

  const c = pkgJson.contributes || {};
  const props = Array.isArray(c.configuration)
    ? Object.assign({}, ...c.configuration.map((b) => b.properties || {}))
    : (c.configuration?.properties || {});
  const expected = {
    1: { name: '命令', ids: (c.commands || []).map((x) => x.command) },
    2: { name: '视图', ids: Object.values(c.views || {}).flat().map((x) => x.id) },
    3: { name: '设置', ids: Object.keys(props) },
    4: { name: '快捷键', ids: (c.keybindings || []).map((b) => b.command), keys: (c.keybindings || []).map((b) => b.key) },
    5: { name: '语言/语法', ids: [...(c.languages || []).map((l) => l.id), ...(c.grammars || []).map((g) => g.scopeName)] },
    6: { name: 'DAP 能力', ids: parseDapCaps(genSrc) },
  };

  if (doc.sections.length !== 6) v.push(`docs/测试覆盖矩阵.md 明细表节数 got=${doc.sections.length} want=6`);
  if (doc.summary.length !== 6) v.push(`docs/测试覆盖矩阵.md 汇总行数 got=${doc.summary.length} want=6`);

  for (const num of [1, 2, 3, 4, 5, 6]) {
    const exp = expected[num];
    const sec = doc.sections.find((s) => s.num === num);
    if (!sec) { v.push(`docs/测试覆盖矩阵.md 缺少「## ${num}.」明细表（期望 ${exp.name}）`); continue; }
    const gotIds = sec.rows.map((r) => r.id);
    const n = Math.min(gotIds.length, exp.ids.length);
    const diffAt = [...Array(n).keys()].find((i) => gotIds[i] !== exp.ids[i]);
    if (diffAt !== undefined || gotIds.length !== exp.ids.length) {
      v.push(`docs/测试覆盖矩阵.md §${num} ${exp.name} ID 序列与 package.json 不一致` +
        `（第 ${diffAt === undefined ? n : diffAt + 1} 项 got=${diffAt === undefined ? '(缺行)' : gotIds[diffAt]} want=${exp.ids[diffAt] ?? '(应删行)'}；共 got=${gotIds.length} want=${exp.ids.length}）`);
    }
    if (num === 4) {
      const badKey = sec.rows.find((r, i) => exp.keys[i] !== undefined && r.title !== exp.keys[i]);
      if (badKey) v.push(`docs/测试覆盖矩阵.md §4 快捷键键位与 package.json 不一致（${badKey.id} got=${badKey.title} want=${exp.keys.find((k, i) => sec.rows[i] === badKey)}）`);
    }
    const sum = doc.summary.find((s) => s.name === exp.name);
    if (!sum) { v.push(`docs/测试覆盖矩阵.md 汇总缺少行「${exp.name}」`); continue; }
    if (sum.total !== exp.ids.length) v.push(`docs/测试覆盖矩阵.md 汇总「${exp.name}」总数 got=${sum.total} want=${exp.ids.length}（package.json）`);
    if (sum.total !== sec.rows.length) v.push(`docs/测试覆盖矩阵.md 汇总「${exp.name}」总数 got=${sum.total} want=${sec.rows.length}（明细行数）`);
    const uncoveredRows = sec.rows.filter((r) => r.status.includes(UNCOVERED));
    if (sum.uncovered !== uncoveredRows.length) {
      v.push(`docs/测试覆盖矩阵.md 汇总「${exp.name}」未覆盖 got=${sum.uncovered} want=${uncoveredRows.length}（明细 ⚠ 行数）`);
    }
    if (sec.uncovered && sec.uncovered.count !== uncoveredRows.length) {
      v.push(`docs/测试覆盖矩阵.md §${num} 表尾「未覆盖 N 项」 got=${sec.uncovered.count} want=${uncoveredRows.length}`);
    }
    if (sec.uncovered && JSON.stringify([...sec.uncovered.ids].sort()) !== JSON.stringify(uncoveredRows.map((r) => r.id).sort())) {
      v.push(`docs/测试覆盖矩阵.md §${num} 表尾未覆盖清单 got=${JSON.stringify(sec.uncovered.ids)} want=${JSON.stringify(uncoveredRows.map((r) => r.id))}`);
    }
    const covered = sum.total - sum.uncovered;
    const wantPct = `${sum.total ? Math.round((covered / sum.total) * 100) : 0}%`;
    if (sum.pct !== wantPct) v.push(`docs/测试覆盖矩阵.md 汇总「${exp.name}」覆盖率 got=${sum.pct} want=${wantPct}`);
    sum.layers.forEach((cnt, i) => {
      const actual = sec.rows.filter((r) => r.cells[i] === CHECK).length;
      if (cnt !== actual) v.push(`docs/测试覆盖矩阵.md 汇总「${exp.name}」第 ${i + 1} 层列计数 got=${cnt} want=${actual}（明细 ✔ 数）`);
    });
    const cellBad = sec.rows.find((r) => r.cells.some((x) => x !== CHECK && x !== DOT));
    if (cellBad) v.push(`docs/测试覆盖矩阵.md §${num} 命中层单元格取值非法（${cellBad.id}: ${JSON.stringify(cellBad.cells)}，仅允许 ${CHECK}/${DOT}）`);
  }
  return v;
}

/** D1b 规则：docs/测试报告-<ver>.md §2 覆盖台账 == docs/测试覆盖矩阵.md 汇总 */
function checkReportLedger(reportText, matrixText) {
  const v = [];
  const matrix = parseMatrixDoc(matrixText);
  const ledger = tableRowsOf(reportText, /^##\s+2\.\s+覆盖台账/);
  if (!ledger) { v.push('docs/测试报告-<ver>.md 缺少「## 2. 覆盖台账」小节'); return v; }
  const nameMap = { '设置': '设置项' };
  const ledgerNames = ledger.map((r) => r.name);
  const wantNames = matrix.summary.map((s) => nameMap[s.name] || s.name);
  if (JSON.stringify(ledgerNames) !== JSON.stringify(wantNames)) {
    v.push(`docs/测试报告-<ver>.md §2 台账条目 got=${JSON.stringify(ledgerNames)} want=${JSON.stringify(wantNames)}（覆盖矩阵汇总顺序）`);
    return v;
  }
  for (const sum of matrix.summary) {
    const row = ledger.find((r) => r.name === (nameMap[sum.name] || sum.name));
    const [total, covered, pct] = row.cells.map((x) => x.replace(/\*/g, ''));
    if (Number(total) !== sum.total) v.push(`docs/测试报告-<ver>.md §2 「${row.name}」总数 got=${total} want=${sum.total}（覆盖矩阵汇总）`);
    if (Number(covered) !== sum.total - sum.uncovered) v.push(`docs/测试报告-<ver>.md §2 「${row.name}」已覆盖 got=${covered} want=${sum.total - sum.uncovered}（覆盖矩阵汇总）`);
    if (pct !== sum.pct) v.push(`docs/测试报告-<ver>.md §2 「${row.name}」覆盖率 got=${pct} want=${sum.pct}（覆盖矩阵汇总）`);
  }
  return v;
}

// ---------- D2 性能基准 vs baseline.json ----------
/** 取某节（`## 标题` 起）内**第一张表**的数据行（跳过表头与分隔行） */
function tableRowsOf(text, headingRe) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => headingRe.test(l));
  if (start < 0) return null;
  const out = [];
  let inTable = false;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s/.test(line)) break;
    if (!/^\s*\|/.test(line)) { if (inTable) break; continue; }
    if (/^\|[\s:|-]+\|$/.test(line)) { inTable = true; continue; }   // 表头分隔行
    if (!inTable) continue;                                          // 表头行不计入
    const c = line.split('|').map((s) => s.trim());
    out.push({ line: i + 1, name: c[1], cells: c.slice(2, -1) });
  }
  return out;
}

function checkPerfDoc(perfText, baseline) {
  const v = [];
  const benchNames = Object.keys(baseline.benches || {});
  const resultRows = tableRowsOf(perfText, /^##\s+结果\s*$/);
  if (!resultRows) { v.push('docs/性能基准.md 缺少「## 结果」小节'); return v; }
  if (JSON.stringify(resultRows.map((r) => r.name)) !== JSON.stringify(benchNames)) {
    const gotSet = resultRows.map((r) => r.name);
    const missing = benchNames.filter((b) => !gotSet.includes(b));
    const extra = gotSet.filter((b) => !benchNames.includes(b));
    v.push(`docs/性能基准.md 结果表基准清单与 tests/perf/baseline.json 不一致（got=${gotSet.length} want=${benchNames.length}；缺失=${JSON.stringify(missing)} 多余=${JSON.stringify(extra)}）`);
  }
  const verdicts = resultRows.map((r) => r.cells[r.cells.length - 1] || '');
  const cnt = (ch) => verdicts.filter((x) => x.includes(ch)).length;
  const pass = cnt('✅'), warn = cnt('⚠'), fail_ = cnt('❌');
  const sumLine = perfText.match(/^汇总：\*\*(\d+) 通过 \/ (\d+) 告警 \/ (\d+) 失败\*\*/m);
  if (!sumLine) v.push('docs/性能基准.md 缺少「汇总：N 通过 / M 告警 / K 失败」行');
  else {
    const [, np, nw, nf] = sumLine.map(Number);
    if (np + nw + nf !== benchNames.length) v.push(`docs/性能基准.md 汇总总数 got=${np + nw + nf} want=${benchNames.length}（baseline.json）`);
    if (np !== pass || nw !== warn || nf !== fail_) v.push(`docs/性能基准.md 汇总与判定列不一致（汇总 ${np}/${nw}/${nf} vs 判定列 ✅${pass} ⚠${warn} ❌${fail_}）`);
  }
  const trendRows = tableRowsOf(perfText, /^##\s+趋势（/);
  if (trendRows && JSON.stringify(trendRows.map((r) => r.name)) !== JSON.stringify(benchNames)) {
    v.push(`docs/性能基准.md 趋势表基准清单与 baseline.json 不一致（got=${trendRows.length} want=${benchNames.length}）`);
  }
  return v;
}

// ---------- D3 文档命令存在性 ----------

/** 需要巡检命令的「主文档」：README.md + docs 顶层 *.md（archive/release 为历史留档，不纳入） */
function mainDocRels() {
  const out = ['README.md'];
  for (const f of fs.readdirSync(path.join(ROOT, 'docs'))) {
    if (f.endsWith('.md') && fs.statSync(path.join(ROOT, 'docs', f)).isFile()) out.push('docs/' + f);
  }
  return out;
}

function checkDocCommands(docs /* [{rel, text}] */, pkgJson, exists) {
  const v = [];
  const scripts = pkgJson.scripts || {};
  for (const { rel, text } of docs) {
    text.split(/\r?\n/).forEach((line, i) => {
      const where = `${rel}:${i + 1}`;
      // `node tests/xx.js`：必须是 .js 脚本且存在；`node tests/xx`（无扩展名）视为不合规引用
      for (const m of line.matchAll(/node\s+(tests\/[\w./-]+\.js)/g)) {
        if (!exists(m[1])) v.push(`${where} 「node ${m[1]}」脚本不存在`);
      }
      for (const m of line.matchAll(/node\s+(tests\/[\w./-]+)(?![.\w/-])/g)) {
        if (!m[1].endsWith('.js')) v.push(`${where} 「node ${m[1]}」未指向 .js 脚本`);
      }
      for (const m of line.matchAll(/npm(?:\.cmd)?\s+(run\s+)?([\w:.-]+)/g)) {
        const sub = m[2];
        if (!m[1]) {
          if (sub === 'test') { if (!scripts.test) v.push(`${where} 「npm test」但 package.json 无 scripts.test`); }
          continue;  // install / ci / i 等内建子命令无需 script
        }
        const exempt = (CMD_WHITELIST.get(rel) || []).includes(m[0]);
        if (!exempt && !Object.prototype.hasOwnProperty.call(scripts, sub)) {
          v.push(`${where} 「npm run ${sub}」不在 package.json scripts 中`);
        }
      }
    });
  }
  return v;
}

// ---------- D4 文档相对链接 ----------

function allDocRels() {
  const out = [];
  const walk = (absDir, relDir) => {
    for (const e of fs.readdirSync(absDir, { withFileTypes: true })) {
      const abs = path.join(absDir, e.name);
      if (e.isDirectory()) walk(abs, `${relDir}/${e.name}`);
      else if (e.name.endsWith('.md')) out.push(`${relDir}/${e.name}`);
    }
  };
  walk(path.join(ROOT, 'docs'), 'docs');
  out.push('README.md');
  return out;
}

function checkDocLinks(docs /* [{rel, text}] */, exists) {
  const v = [];
  for (const { rel, text } of docs) {
    text.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(/\]\(([^)]+)\)/g)) {
        let t = m[1].trim();
        if (/^(https?:|mailto:|vscode:|command:|#)/.test(t)) continue;
        t = t.replace(/^<|>$/g, '');
        const target = t.split('#')[0].trim();
        if (!target) continue;
        if ((LINK_WHITELIST.get(rel) || []).includes(target)) continue;
        if (!exists(rel, target)) v.push(`${rel}:${i + 1} 相对链接不可解析 -> ${target}`);
      }
    });
  }
  return v;
}

// ---------- D5 版本标记 ----------

function checkVersionMarkers(pkgVersion, docsByRel) {
  const v = [];
  const reports = fs.readdirSync(path.join(ROOT, 'docs'))
    .filter((f) => /^测试报告-\d+\.\d+\.\d+\.md$/.test(f));
  if (!reports.length) v.push('docs/ 缺少「测试报告-<版本>.md」');
  for (const f of reports) {
    const ver = f.match(/^测试报告-([\d.]+)\.md$/)[1];
    if (ver !== pkgVersion) v.push(`docs/${f} 文件名版本 got=${ver} want=${pkgVersion}`);
  }
  const report = docsByRel[`docs/测试报告-${pkgVersion}.md`];
  if (report) {
    const h1 = report.match(/^#\s+测试执行报告（([\d.]+)/m);
    if (!h1 || h1[1] !== pkgVersion) v.push(`docs/测试报告-${pkgVersion}.md:1 标题版本 got=${h1 ? h1[1] : '(未匹配)'} want=${pkgVersion}`);
  }
  const matrix = docsByRel['docs/测试覆盖矩阵.md'];
  if (matrix) {
    const ver = (matrix.match(/数据来源：package\.json v([\d.]+)/) || [])[1];
    if (ver !== pkgVersion) v.push(`docs/测试覆盖矩阵.md:7 数据来源版本 got=${ver} want=${pkgVersion}`);
  }
  const usage = docsByRel['docs/使用说明.md'];
  if (usage) {
    const ver = (usage.match(/^>\s*版本：([\d.]+)/m) || [])[1];
    if (ver !== pkgVersion) v.push(`docs/使用说明.md:3 「版本：」 got=${ver} want=${pkgVersion}`);
    for (const m of usage.matchAll(/codeblocks-vscode-([\d.]+)\.vsix/g)) {
      if (m[1] !== pkgVersion) v.push(`docs/使用说明.md VSIX 文件名版本 got=${m[1]} want=${pkgVersion}`);
    }
  }
  const progress = docsByRel['docs/开发进度.md'];
  if (progress) {
    const ver = (progress.match(/当前版本\s*\*\*([\d.]+)\*\*/) || [])[1];
    if (ver !== pkgVersion) v.push(`docs/开发进度.md 「当前版本」 got=${ver} want=${pkgVersion}`);
    for (const m of progress.matchAll(/codeblocks-vscode-([\d.]+)\.vsix/g)) {
      if (m[1] !== pkgVersion) v.push(`docs/开发进度.md VSIX 文件名版本 got=${m[1]} want=${pkgVersion}`);
    }
  }
  return v;
}

// ---------- 运行 ----------

const existsDoc = (rel) => fs.existsSync(path.join(ROOT, rel));
const linkExists = (rel, target) => {
  const abs = path.resolve(path.dirname(path.join(ROOT, rel)), target);
  return fs.existsSync(abs);
};

function runAll() {
  const docsByRel = {};
  for (const rel of allDocRels()) docsByRel[rel] = readDoc(rel);
  const mainDocs = mainDocRels().map((rel) => ({ rel, text: docsByRel[rel] !== undefined ? docsByRel[rel] : readDoc(rel) }));
  const linkDocs = allDocRels().map((rel) => ({ rel, text: docsByRel[rel] }));
  const reportRel = fs.readdirSync(path.join(ROOT, 'docs')).find((f) => /^测试报告-\d+\.\d+\.\d+\.md$/.test(f));
  const matrixText = readDoc('docs/测试覆盖矩阵.md');

  return [
    ['D1 覆盖矩阵 == package.json + 生成脚本数据源（含文档内部自洽）',
      checkMatrixDoc(matrixText, readDoc('tests/contract/gen-coverage-matrix.js'), pkg)],
    [`D1b 测试报告 §2 覆盖台账 == 覆盖矩阵汇总（${reportRel || '(缺少测试报告)'}）`,
      reportRel ? checkReportLedger(readDoc('docs/' + reportRel), matrixText) : ['docs/ 缺少「测试报告-<版本>.md」']],
    ['D2 性能基准条目 == tests/perf/baseline.json（含汇总/判定列一致）',
      checkPerfDoc(readDoc('docs/性能基准.md'), JSON.parse(readDoc('tests/perf/baseline.json')))],
    [`D3 主文档命令存在（${mainDocs.length} 份文档）`, checkDocCommands(mainDocs, pkg, existsDoc)],
    [`D4 文档相对链接可解析（${linkDocs.length} 份文档）`, checkDocLinks(linkDocs, linkExists)],
    ['D5 版本标记 == package.json version', checkVersionMarkers(pkg.version, docsByRel)],
  ];
}

if (process.argv.includes('--self-test')) {
  // 自证有效：真实文档 + 内存篡改（不落盘）——每条规则必须报红；未篡改必须为绿。
  const matrixText = readDoc('docs/测试覆盖矩阵.md');
  const genSrc = readDoc('tests/contract/gen-coverage-matrix.js');
  const perfText = readDoc('docs/性能基准.md');
  const baseline = JSON.parse(readDoc('tests/perf/baseline.json'));
  const readme = readDoc('README.md');
  const usage = readDoc('docs/使用说明.md');
  const progress = readDoc('docs/开发进度.md');
  const allText = allDocRels().map((rel) => ({ rel, text: readDoc(rel) }));
  void allText;

  let stPass = 0, stFail = 0;
  const expectViolation = (name, fn, needle) => {
    const v = fn();
    const ok = v.length > 0 && (!needle || v.some((x) => x.includes(needle)));
    if (ok) { stPass++; console.log(`SELFTEST OK   ${name}  → ${v[0]}`); }
    else { stFail++; console.log(`SELFTEST FAIL ${name}  未检出违规（needle=${needle}）`); }
  };
  const expectClean = (name, v) => {
    if (v.length === 0) { stPass++; console.log(`SELFTEST OK   ${name}（未篡改基线为绿）`); }
    else { stFail++; console.log(`SELFTEST FAIL ${name}  基线出现误报：${v[0]}`); }
  };

  expectClean('D1 基线', checkMatrixDoc(matrixText, genSrc, pkg));
  expectViolation('D1 篡改汇总总数（103→999）',
    () => checkMatrixDoc(matrixText.replace('| 命令 | 103 |', '| 命令 | 999 |'), genSrc, pkg), '总数');
  expectViolation('D1 篡改覆盖项 ID（newProject→zzz）',
    () => checkMatrixDoc(matrixText.replace('`codeblocks.newProject`', '`codeblocks.zzz`'), genSrc, pkg), 'ID 序列');
  expectViolation('D1 删除明细行（明细行数/未覆盖数变化）', () => {
    const lines = matrixText.split(/\r?\n/);
    const i = lines.findIndex((l) => /^\|\s*40\s*\|/.test(l) && l.includes('`codeblocks.openIncludeFile`'));
    if (i < 0) throw new Error('自证注入失败：未找到 openIncludeFile 明细行');
    return checkMatrixDoc(lines.filter((_, k) => k !== i).join('\n'), genSrc, pkg);
  }, '明细行数');
  expectViolation('D1 篡改数据来源版本',
    () => checkMatrixDoc(matrixText.replace('package.json v0.8.128', 'package.json v0.0.1'), genSrc, pkg), '数据来源版本');

  const reportText = readDoc('docs/测试报告-' + pkg.version + '.md');
  expectClean('D1b 基线', checkReportLedger(reportText, matrixText));
  expectViolation('D1b 篡改台账总数（103→999）',
    () => checkReportLedger(reportText.replace('| 命令 | 103 | 101 | 98% |', '| 命令 | 999 | 101 | 98% |'), matrixText), '总数');

  expectClean('D2 基线', checkPerfDoc(perfText, baseline));
  expectViolation('D2 删除一条基准行（汇总总数不符）',
    () => checkPerfDoc(perfText.replace(/^\| B10 真实单文件编译.*$\n/m, ''), baseline), '基准清单');

  const cleanCmds = checkDocCommands([{ rel: 'README.md', text: readme }], pkg, existsDoc);
  expectClean('D3 基线（README）', cleanCmds);
  expectViolation('D3 注入不存在的脚本命令',
    () => checkDocCommands([{ rel: 'README.md', text: readme + '\nnode tests/zzz-does-not-exist.js\n' }], pkg, existsDoc), '不存在');
  expectViolation('D3 注入不存在的 npm script',
    () => checkDocCommands([{ rel: 'README.md', text: readme + '\nnpm run zzz-no-such-script\n' }], pkg, existsDoc), 'scripts');

  expectClean('D4 基线（README）', checkDocLinks([{ rel: 'README.md', text: readme }], linkExists));
  expectViolation('D4 注入坏链接',
    () => checkDocLinks([{ rel: 'README.md', text: readme + '\n[坏链接](./zzz-no-such-file.md)\n' }], linkExists), '不可解析');

  expectClean('D5 基线', checkVersionMarkers(pkg.version, { 'docs/使用说明.md': usage, 'docs/开发进度.md': progress }));
  expectViolation('D5 篡改「版本：」标记',
    () => checkVersionMarkers(pkg.version, { 'docs/使用说明.md': usage.replace(/^>\s*版本：[\d.]+/m, '> 版本：0.0.1'), 'docs/开发进度.md': progress }), '版本');
  expectViolation('D5 篡改「当前版本」标记',
    () => checkVersionMarkers(pkg.version, { 'docs/使用说明.md': usage, 'docs/开发进度.md': progress.replace(/当前版本\s\*\*[\d.]+\*\*/, '当前版本 **0.0.1**') }), '当前版本');

  console.log(`\ndoc-consistency 自证: ${stPass} pass, ${stFail} fail`);
  process.exit(stFail ? 1 : 0);
}

let pass = 0, fail = 0;
for (const [name, violations] of runAll()) {
  if (violations.length === 0) { pass++; console.log('OK   ' + name); }
  else {
    fail++;
    console.log('FAIL ' + name);
    for (const x of violations.slice(0, 12)) console.log('     · ' + x);
    if (violations.length > 12) console.log(`     · …共 ${violations.length} 条`);
  }
}
console.log(`\ndoc-consistency 文档一致性: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
