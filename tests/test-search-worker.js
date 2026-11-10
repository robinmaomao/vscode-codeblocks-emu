// 真实 worker 运行时回归：bundle 前的 dist worker 能启动、搜索、复用缓存并返回 0-based 结果。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('node:worker_threads');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}
const workerPath = path.resolve(__dirname, '../dist/search/textSearchWorker.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-search-worker-'));
const a = path.join(dir, 'a.c');
const b = path.join(dir, 'b.c');
fs.writeFileSync(a, 'int main() {\n  printf("hello");\n}\n');
fs.writeFileSync(b, 'void hello() {}\n');

function fileInfo(p, title) {
  return { absolutePath: p, projectFilename: 'p.cbp', projectTitle: title, relativeFilename: path.basename(p) };
}
function run(worker, message, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker timeout')), timeoutMs);
    const onMessage = (m) => {
      if (m && m.type === 'result' && m.id === message.id) {
        clearTimeout(timer); worker.off('message', onMessage); resolve(m.result);
      } else if (m && m.type === 'error' && m.id === message.id) {
        clearTimeout(timer); worker.off('message', onMessage); reject(new Error(m.message));
      }
    };
    worker.on('message', onMessage);
    worker.postMessage(message);
  });
}

(async () => {
  const worker = new Worker(workerPath);
  const progress = [];
  worker.on('message', (m) => { if (m && m.type === 'progress') progress.push(m); });
  const files = [fileInfo(a, 'alpha'), fileInfo(b, 'beta')];
  const r1 = await run(worker, { type: 'search', id: 1, files, query: 'hello' });
  check('worker：返回结果', r1.matchCount === 2 && r1.files.length === 2, { count: r1.matchCount, files: r1.files.length });
  check('worker：0-based 行列', r1.files[0].matches[0].line === 1 && r1.files[0].matches[0].column === 10, r1.files[0].matches[0]);
  const r2 = await run(worker, { type: 'search', id: 2, files, query: '/h.llo/' });
  check('worker：同一实例可复用', r2.matchCount === 2, r2.matchCount);
  check('worker：进度消息', progress.length > 0, progress.length);
  const r3 = await run(worker, { type: 'search', id: 3, files, query: '/[/' });
  check('worker：非法正则返回 queryError', !!r3.queryError, r3.queryError);
  await worker.terminate();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n搜索 worker: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
  console.log(`\n搜索 worker: ${pass} pass, ${fail + 1} fail`);
  process.exit(1);
});
