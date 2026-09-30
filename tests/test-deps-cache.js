// 验证 C3-A include 依赖缓存算法：命中复用、mtime 失效、include 搜索目录（dirsKey）失效
// 精确复刻 buildEngine.ts 的 scanIncludes + resolveInclude 缓存逻辑（vscode 无关）
const path = require('path');
const fs = require('fs');
const os = require('os');

const depsIncludeCache = new Map(); // 复刻模块级缓存

function resolveInclude(inc, fromFile, includeDirs, angleBracket, basePath) {
  if (!angleBracket) {
    const cand = path.resolve(path.dirname(fromFile), inc);
    if (fs.existsSync(cand)) return cand;
  }
  for (const dir of includeDirs) {
    const base = path.isAbsolute(dir) ? dir : path.join(basePath, dir);
    const cand = path.resolve(base, inc);
    if (fs.existsSync(cand)) return cand;
  }
  return undefined;
}

function scanIncludes(fileAbs, includeDirs, basePath) {
  let srcMtimeMs = 0;
  try {
    srcMtimeMs = fs.statSync(fileAbs).mtimeMs;
  } catch {
    return [];
  }
  const norm = (d) => (process.platform === 'win32' ? d.toLowerCase() : d);
  const dirsKey = includeDirs
    .map((d) => (path.isAbsolute(d) ? path.normalize(d) : path.join(basePath, d)))
    .map(norm)
    .join('|');
  const entry = depsIncludeCache.get(fileAbs);
  if (entry && entry.srcMtimeMs === srcMtimeMs && entry.dirsKey === dirsKey) {
    return entry.includes;
  }
  const includes = [];
  try {
    const content = fs.readFileSync(fileAbs, 'utf-8');
    const re = /^\s*#\s*include\s*(?:"([^"]+)"|<([^>]+)>)/gm;
    let m;
    while ((m = re.exec(content)) !== null) {
      const quoted = m[1];
      const angled = m[2];
      const resolved = resolveInclude(quoted ?? angled, fileAbs, includeDirs, quoted === undefined, basePath);
      if (resolved) includes.push(resolved);
    }
  } catch {
    // 忽略读取失败
  }
  depsIncludeCache.set(fileAbs, { srcMtimeMs, dirsKey, includes });
  return includes;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-deps-cache-'));
const basePath = tmp;
const source = path.join(tmp, 'main.c');
const dep1 = path.join(tmp, 'dep1.h');
const dep2 = path.join(tmp, 'dep2.h');
const subDir = path.join(tmp, 'inc');
fs.mkdirSync(subDir);
const header = path.join(subDir, 'header.h');

fs.writeFileSync(dep1, 'int a;', 'utf-8');
fs.writeFileSync(dep2, 'int b;', 'utf-8');
fs.writeFileSync(header, 'int c;', 'utf-8');
fs.writeFileSync(source, '#include "dep1.h"\n', 'utf-8');

let fail = 0;
function check(name, cond) {
  if (cond) console.log('PASS ' + name);
  else { console.error('FAIL ' + name); fail++; }
}

// 1. 首次扫描：双引号相对源文件目录解析
const r1 = scanIncludes(source, [], basePath);
check('首次扫描解析出 dep1.h', r1.length === 1 && r1[0] === dep1);

// 2. 缓存命中：不变时复用同一 includes 数组引用
const r2 = scanIncludes(source, [], basePath);
check('缓存命中：返回同一数组引用', r1 === r2);

// 3. mtime 失效：改写源文件内容后重扫，结果更新（新增 dep2.h）
fs.writeFileSync(source, '#include "dep1.h"\n#include "dep2.h"\n', 'utf-8');
const r3 = scanIncludes(source, [], basePath);
check('mtime 失效：重扫后包含 dep2.h', r3.length === 2 && r3.includes(dep1) && r3.includes(dep2));
check('mtime 失效：返回新数组（非旧引用）', r3 !== r1);

// 4. dirsKey 失效：同一源文件，include 搜索目录变化 → 重扫
//    源改为尖括号 include，仅 inc 目录可解析
fs.writeFileSync(source, '#include <header.h>\n', 'utf-8');
const r4a = scanIncludes(source, [subDir], basePath);
check('dirsKey 变化后重扫：inc 目录下解析出 header.h', r4a.length === 1 && r4a[0] === header);

//    换空目录列表 → dirsKey 变 → 重扫 → 解析不到 header.h
const emptyDir = path.join(tmp, 'empty');
fs.mkdirSync(emptyDir);
const r4b = scanIncludes(source, [emptyDir], basePath);
check('dirsKey 变化后重扫：空目录解析不到 header.h', r4b.length === 0);

//    恢复 inc 目录（第三次不同 dirsKey）→ 再次解析到
const r4c = scanIncludes(source, [subDir], basePath);
check('dirsKey 恢复后重扫：再次解析出 header.h', r4c.length === 1 && r4c[0] === header);

// 清理
fs.rmSync(tmp, { recursive: true, force: true });

if (fail === 0) {
  console.log('全部通过');
  process.exit(0);
} else {
  process.exit(1);
}
