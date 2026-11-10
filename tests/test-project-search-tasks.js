// 内容搜索任务回归：字面量/正则、UTF-16 BOM、二进制/大文件跳过、脏编辑器文本、缓存命中、取消、进度。
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  searchFileSet, decodeTextBuffer, defaultTextCache,
} = require('../dist/search/textSearchTasks.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-search-task-'));
function write(name, content) {
  const p = path.join(dir, name);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return p;
}
function info(file, projectTitle = 'demo', relativeFilename = file.split(path.sep).pop()) {
  return { absolutePath: file, projectFilename: 'demo.cbp', projectTitle, relativeFilename };
}

(async () => {
  const a = write('a.c', 'int main() {\n  printf("hello");\n}\n');
  const b = write('b.c', 'void hello() {}\n');
  const bin = write('bin.dat', Buffer.from([0x61, 0x00, 0x62, 0x63]));
  const utf16 = write('u16.c', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('// hello\n', 'utf16le')]));
  const big = write('big.c', 'x'.repeat(2048));

  check('解码：UTF-16LE BOM', decodeTextBuffer(fs.readFileSync(utf16)).includes('hello'), decodeTextBuffer(fs.readFileSync(utf16)));
  check('解码：二进制返回 undefined', decodeTextBuffer(Buffer.from([0x61, 0x00, 0x62])) === undefined);

  const cache = defaultTextCache();
  let progress = 0;
  const result = await searchFileSet([info(a, 'alpha'), info(b, 'beta'), info(bin)], {
    query: 'hello', cache, onProgress: () => { progress++; },
  });
  check('字面量：两个文件命中', result.matchCount === 2 && result.files.filter((f) => f.matches.length).length === 2, result.files.map((f) => [f.file.relativeFilename, f.matches.length]));
  check('字面量：0-based 行列', result.files[0].matches[0].line === 1 && result.files[0].matches[0].column === 10, result.files[0].matches[0]);
  check('二进制：跳过且计数', result.skipped.binary === 1 && result.files.find((f) => f.file.relativeFilename === 'bin.dat').skipped === 'binary', result.skipped);
  check('进度：至少一次', progress > 0, progress);

  const r2 = await searchFileSet([info(a, 'alpha')], { query: 'hello', cache });
  check('缓存：命中后仍返回内容', r2.matchCount === 1 && cache.hits >= 1, { hits: cache.hits, misses: cache.misses });

  const dirty = await searchFileSet([info(a, 'alpha')], { query: 'DIRTY', caseSensitive: true, dirtyText: undefined });
  check('脏文本：仅用于显式传入', dirty.matchCount === 0, dirty.matchCount);
  const dirty2 = await searchFileSet([{ ...info(a, 'alpha'), dirtyText: 'DIRTY hello' }], { query: 'DIRTY', caseSensitive: true });
  check('脏文本：优先于磁盘', dirty2.matchCount === 1 && dirty2.files[0].matches[0].column === 0, dirty2.files[0].matches);

  const utf16Result = await searchFileSet([info(utf16)], { query: 'hello' });
  check('UTF-16：内容搜索生效', utf16Result.matchCount === 1, utf16Result.files[0]);

  const regexResult = await searchFileSet([info(a), info(b)], { query: '/h.llo/', caseSensitive: false });
  check('正则：多文件命中', regexResult.matchCount === 2, regexResult.matchCount);
  const badRegex = await searchFileSet([info(a)], { query: '/[/' });
  check('正则：非法返回 queryError', !!badRegex.queryError && badRegex.matchCount === 0, badRegex.queryError);

  const bigResult = await searchFileSet([info(big)], { query: 'x', maxFileBytes: 1024 });
  check('大文件：按上限跳过', bigResult.skipped['too-large'] === 1 && bigResult.matchCount === 0, bigResult.skipped);

  const missing = await searchFileSet([{ ...info(path.join(dir, 'missing.c')) }], { query: 'x' });
  check('缺失文件：静默计数', missing.skipped.missing === 1 && missing.matchCount === 0, missing.skipped);

  const controller = new AbortController();
  controller.abort();
  const aborted = await searchFileSet([info(a), info(b)], { query: 'hello', signal: controller.signal });
  check('取消：aborted=true 且无新启动', aborted.aborted === true && aborted.scanned === 0, { aborted: aborted.aborted, scanned: aborted.scanned });

  const limited = await searchFileSet([info(a), info(b)], { query: 'hello', maxTotalMatches: 1 });
  check('全局上限：截断标记', limited.matchCount === 1 && limited.truncated === true, limited.matchCount);

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n内容搜索任务: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  console.log(`\n内容搜索任务: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
