// 工程内搜索纯逻辑回归：条目构建/排序/签名、查询解析、逐行匹配、编码判定、字节预算缓存、并发映射。
const { Project } = require('../dist/model/types.js');
const {
  buildSearchEntries, buildSubtreeEntries, searchEntriesSignature, rankSearchEntries,
  parseTextQuery, findTextMatches, matchRanges, utf16Bom, looksBinary, ByteBudgetCache,
  mapWithConcurrency, escapeRegExp,
} = require('../dist/search/projectSearch.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}
function file(rel, abs) {
  return { relativeFilename: rel, absolutePath: abs || ('C:/ws/' + rel.replace(/\\/g, '/')) };
}
const p1 = {
  title: 'alpha', filename: 'C:/ws/alpha.cbp', basePath: 'C:/ws',
  files: [file('src/main.c'), file('src/util.c'), file('include/util.h')],
};
const p2 = {
  title: 'beta', filename: 'C:/ws/beta.cbp', basePath: 'C:/ws',
  files: [file('src/main.c'), file('lib/api.c'), file('src/betahelper.cpp')],
};

const entries = buildSearchEntries([p1, p2], p2.filename, 'openProjects');
check('条目：活动工程优先且跨工程去重', entries[0].projectTitle === 'beta' && entries.filter((e) => e.absolutePath.endsWith('/src/main.c')).length === 1,
  entries.map((e) => e.projectTitle + ':' + e.relativePath));
check('条目：activeProject 范围只含活动工程', buildSearchEntries([p1, p2], p2.filename, 'activeProject').every((e) => e.projectTitle === 'beta'),
  buildSearchEntries([p1, p2], p2.filename, 'activeProject').map((e) => e.projectTitle));

const dupA = {
  title: 'app', filename: 'C:/ws/earphone/app.cbp', basePath: 'C:/ws/earphone',
  files: [file('src/a.c', 'C:/ws/earphone/src/a.c')],
};
const dupB = {
  title: 'app', filename: 'C:/ws/esop8/app.cbp', basePath: 'C:/ws/esop8',
  files: [file('src/b.c', 'C:/ws/esop8/src/b.c')],
};
const dupTitles = buildSearchEntries([dupA, dupB], dupA.filename, 'openProjects').map((e) => e.projectTitle);
check('条目：同名工程用父目录名区分（earphone / esop8）', dupTitles.includes('earphone') && dupTitles.includes('esop8'),
  dupTitles);
check('条目：activeProject 范围仍用目录名（Text 模式同名工程）',
  buildSearchEntries([dupA, dupB], dupA.filename, 'activeProject').every((e) => e.projectTitle === 'earphone'),
  buildSearchEntries([dupA, dupB], dupA.filename, 'activeProject').map((e) => e.projectTitle));
check('条目：无重名时保持 .cbp title', buildSearchEntries([p1], undefined, 'openProjects').every((e) => e.projectTitle === 'alpha'));

const allHits = rankSearchEntries(entries, '', 100);
check('空查询返回全部（活动工程在前）', allHits.length === 5 && allHits[0].entry.isActive, allHits.map((h) => h.entry.relativePath));
const utilHits = rankSearchEntries(entries, 'util');
check('文件搜索：token 命中 basename/path', utilHits.length >= 2 && utilHits[0].entry.basename === 'util.c', utilHits.map((h) => h.entry.relativePath));
const andHits = rankSearchEntries(entries, 'src util');
check('文件搜索：多 token AND', andHits.length === 1 && andHits[0].entry.relativePath === 'src/util.c', andHits.map((h) => h.entry.relativePath));
const rangeHits = rankSearchEntries(entries, 'util');
check('文件搜索：basename 高亮范围', rangeHits.some((h) => h.ranges.length > 0), rangeHits.map((h) => h.ranges));
check('文件搜索：无匹配返回空', rankSearchEntries(entries, 'zzzz-not-found').length === 0);
check('子序列评分可用', rankSearchEntries(entries, 'mnc').some((h) => h.entry.basename === 'main.c'));

const sig1 = searchEntriesSignature([p1, p2], p2.filename, 'openProjects');
const sig2 = searchEntriesSignature([p1, p2], p2.filename, 'openProjects');
const sig3 = searchEntriesSignature([p1, p2], p1.filename, 'openProjects');
check('签名：稳定 + 活动工程变化', sig1 === sig2 && sig1 !== sig3, [sig1, sig3]);

const sub = buildSubtreeEntries(p1, [p1.files[0], p1.files[2]], true);
check('子树条目：按文件列表构建', sub.length === 2 && sub.every((e) => e.isActive), sub.map((e) => e.relativePath));

check('escapeRegExp 转义元字符', escapeRegExp('a.b*c') === 'a\\.b\\*c', escapeRegExp('a.b*c'));
const literal = parseTextQuery('Hello', false);
check('查询：字面量 + 默认忽略大小写', literal.kind === 'literal' && literal.regex.test('hello'), literal);
const regex = parseTextQuery('/h.llo/', true);
check('查询：/regex/ + 大小写敏感', regex.kind === 'regex' && regex.regex.test('hallo') && !regex.regex.test('Hallo'), regex);
const bad = parseTextQuery('/[/', false);
check('查询：非法正则返回 error', !!bad.error, bad);
check('查询：空查询 error', !!parseTextQuery('   ').error);

const wholeWord = parseTextQuery('if', false, true);
const wholeWordMatches = findTextMatches('if (cond) { diff = ifdef; }', wholeWord).matches;
check('查询：全字匹配只命中独立单词', wholeWordMatches.length === 1 && wholeWordMatches[0].column === 0,
  wholeWordMatches.map((m) => m.column));
const wholeWordPunct = parseTextQuery('foo(', false, true);
check('查询：全字匹配兼容非单词结尾', findTextMatches('foo(1) barfoo(', wholeWordPunct).matches.length === 1,
  findTextMatches('foo(1) barfoo(', wholeWordPunct).matches.map((m) => m.column));

const text = 'int main() {\n  printf("hello"); // hello\n  HELLO();\n}\n';
const found = findTextMatches(text, parseTextQuery('hello', false));
check('内容：0-based 行/列 + 大小写不敏感', found.matches.length === 3 && found.matches[0].line === 1 && found.matches[0].column === 10, found.matches);
const foundCase = findTextMatches(text, parseTextQuery('HELLO', true));
check('内容：大小写敏感', foundCase.matches.length === 1 && foundCase.matches[0].line === 2, foundCase.matches);
const foundRegex = findTextMatches(text, parseTextQuery('/h.llo/', false));
check('内容：正则匹配', foundRegex.matches.length === 3, foundRegex.matches.length);
const preview = found.matches[0];
check('内容：预览包含匹配且偏移正确', preview.preview.slice(preview.previewStart, preview.previewStart + preview.previewLength).toLowerCase() === 'hello',
  { preview: preview.preview, start: preview.previewStart, len: preview.previewLength });
const capped = findTextMatches('x'.repeat(20) + '\n' + 'hello\nhello\nhello', parseTextQuery('hello'), { maxFileMatches: 2 });
check('内容：单文件上限 + truncated', capped.matches.length === 2 && capped.truncated, capped);
const zero = findTextMatches('abc', parseTextQuery('/x*/', false));
check('内容：零宽匹配不挂起', zero.matches.length === 0, zero.matches);
const longLine = findTextMatches('a'.repeat(5000) + 'hello', parseTextQuery('/hello/', false), { maxRegexLineLength: 100 });
check('内容：正则超长行跳过', longLine.matches.length === 0, longLine.matches.length);

const utf8Bom = Buffer.from([0xef, 0xbb, 0xbf, 0x61]);
const utf16le = Buffer.from([0xff, 0xfe, 0x61, 0x00]);
const utf16be = Buffer.from([0xfe, 0xff, 0x00, 0x61]);
check('编码：UTF-16 BOM 优先于 NUL 判定', utf16Bom(utf16le) === 'le' && utf16Bom(utf16be) === 'be' && !looksBinary(utf16le) && !looksBinary(utf16be), [utf16Bom(utf16le), utf16Bom(utf16be)]);
check('编码：二进制 NUL', looksBinary(Buffer.from([0x61, 0x00, 0x62])) && !looksBinary(utf8Bom), true);

const cache = new ByteBudgetCache(10);
cache.set('a', '1234', 4); cache.set('b', '5678', 4);
check('缓存：命中计数 + 字节预算', cache.get('a') === '1234' && cache.sizeBytes === 8 && cache.hits === 1, { size: cache.sizeBytes, hits: cache.hits });
cache.set('c', '90', 4);
check('缓存：超预算淘汰最旧', cache.get('b') === undefined && cache.get('c') === '90', { size: cache.sizeBytes, entries: cache.size });
check('缓存：命中刷新 LRU', (() => { const c = new ByteBudgetCache(6); c.set('x', 1, 3); c.set('y', 2, 3); c.get('x'); c.set('z', 3, 3); return c.get('x') === 1 && c.get('y') === undefined; })(), true);
check('缓存：超大对象不写入', (() => { const c = new ByteBudgetCache(2); c.set('big', 1, 3); return c.size === 0; })(), true);

(async () => {
  let running = 0, maxRunning = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
    running++; maxRunning = Math.max(maxRunning, running);
    await new Promise((r) => setTimeout(r, 5));
    running--; return n * 2;
  });
  check('并发映射：顺序保持 + 并发受限', JSON.stringify(out) === JSON.stringify([2, 4, 6, 8, 10]) && maxRunning <= 2, { out, maxRunning });
  const controller = new AbortController();
  controller.abort();
  const aborted = await mapWithConcurrency([1, 2], 2, async (n) => n, controller.signal);
  check('并发映射：中止后不再执行', aborted[0] === undefined && aborted[1] === undefined, aborted);
  check('matchRanges：重叠合并', JSON.stringify(matchRanges('abcabc', ['abc', 'bca'])) === JSON.stringify([{ start: 0, length: 4 }]), matchRanges('abcabc', ['abc', 'bca']));
  console.log(`\n工程内搜索纯逻辑: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
