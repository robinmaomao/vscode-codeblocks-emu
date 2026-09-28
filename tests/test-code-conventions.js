// 代码约定回归（审计 P3.5）：空 catch 必须带注释说明（或实际处理代码）；src 禁止 console.* / @ts-ignore
// 目的：把"空 catch 需注释说明为何可忽略"的既有惯例固化为自动检查，防止新增静默吞错。
const fs = require('fs');
const path = require('path');

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

// ---- 4. 样例自检：确认检测器本身能捕获"裸 catch" ----
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
