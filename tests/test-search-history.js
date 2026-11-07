// 搜索历史纯逻辑回归：去重/置顶/每模式上限/上次结果/版本化解析/损坏回退。
const {
  emptyHistory, addHistoryEntry, updateLastResult, removeHistoryEntry, clearHistory,
  historyForMode, findHistoryEntry, historyId, parseHistory, SEARCH_HISTORY_VERSION,
} = require('../dist/search/searchHistory.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}
const base = { mode: 'files', scope: 'openProjects', caseSensitive: false, regex: false };

let h = emptyHistory();
h = addHistoryEntry(h, { ...base, query: 'main', now: 100 });
h = addHistoryEntry(h, { ...base, query: 'util', now: 200 });
h = addHistoryEntry(h, { ...base, query: 'main', now: 300 });
check('去重并置顶', h.entries.length === 2 && h.entries[0].query === 'main' && h.entries[0].updatedAt === 300, h.entries);
check('空查询不记录', addHistoryEntry(h, { ...base, query: '   ' }).entries.length === 2);
check('id 稳定', historyId('files', 'main') === historyId('files', 'main') && historyId('files', 'main') !== historyId('text', 'main'));

const mainEntry = h.entries.find((e) => e.query === 'main');
for (let i = 0; i < 25; i++) h = addHistoryEntry(h, { ...base, query: 'q' + i, now: 1000 + i });
check('每模式上限 20', historyForMode(h, 'files', 99).length === 20, historyForMode(h, 'files', 99).length);
check('旧条目被淘汰', !findHistoryEntry(h, 'files', 'main') && !!findHistoryEntry(h, 'files', 'q24'), historyForMode(h, 'files', 3).map((e) => e.query));
check('另一种模式独立计数', (() => {
  let x = h;
  for (let i = 0; i < 25; i++) x = addHistoryEntry(x, { ...base, mode: 'text', query: 't' + i, now: 2000 + i });
  return historyForMode(x, 'files', 99).length === 20 && historyForMode(x, 'text', 99).length === 20;
})(), true);

const recent = findHistoryEntry(h, 'files', 'q24');
h = updateLastResult(h, 'files', 'q24', { projectFilename: 'p.cbp', relativeFilename: 'src/q24.c', line: 4, column: 2, length: 3 }, 9999);
const updated = h.entries.find((e) => e.id === recent.id);
check('更新上次结果', updated.lastResult.line === 4 && updated.updatedAt === 9999, updated);
check('重复搜索保留上次结果', (() => {
  const again = addHistoryEntry(h, { ...base, query: 'q24', now: 10000 });
  const e = findHistoryEntry(again, 'files', 'q24');
  return e.updatedAt === 10000 && e.lastResult && e.lastResult.line === 4;
})(), true);
check('未知记录更新为空操作', updateLastResult(h, 'files', 'nope', { projectFilename: 'p', relativeFilename: 'x' }) === h);
check('按模式过滤 + 最近优先', historyForMode(h, 'files', 3).length === 3 && historyForMode(h, 'files', 3)[0].query === 'q24', historyForMode(h, 'files', 3).map((e) => e.query));
check('findHistoryEntry 精确匹配', findHistoryEntry(h, 'files', 'q24')?.query === 'q24' && !findHistoryEntry(h, 'text', 'q24'));
check('删除条目', removeHistoryEntry(h, recent.id).entries.length === h.entries.length - 1);
check('清空', clearHistory().entries.length === 0);

const parsed = parseHistory(JSON.parse(JSON.stringify({ version: SEARCH_HISTORY_VERSION, entries: h.entries })));
check('解析：合法数据保留', parsed.entries.length === h.entries.length, parsed.entries.length);
check('解析：损坏/版本不符回退空表', parseHistory({ version: 2, entries: [{ mode: 'files', query: 'x', scope: 'openProjects' }] }).entries.length === 0
  && parseHistory('nope').entries.length === 0 && parseHistory(undefined).entries.length === 0);
const mixed = parseHistory({
  version: 1,
  entries: [
    { mode: 'files', query: 'ok', scope: 'activeProject', caseSensitive: true, regex: true, updatedAt: 1 },
    { mode: 'files', query: 'ok', scope: 'openProjects', updatedAt: 2 },
    { mode: 'bogus', query: 'bad', scope: 'openProjects' },
    { mode: 'text', query: '', scope: 'openProjects' },
    { mode: 'text', query: 're', scope: 'openProjects', lastResult: { projectFilename: 'p', relativeFilename: 'a.c', line: 2, column: -1 } },
  ],
});
check('解析：去重/丢弃非法/清理负坐标', mixed.entries.length === 2 && mixed.entries[1].lastResult.line === 2 && mixed.entries[1].lastResult.column === undefined, mixed.entries);
check('解析：每模式裁剪', (() => {
  const entries = [];
  for (let i = 0; i < 30; i++) entries.push({ mode: 'files', query: 'q' + i, scope: 'openProjects', updatedAt: i });
  return parseHistory({ version: 1, entries }).entries.length === 20;
})(), true);

console.log(`\n搜索历史: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
