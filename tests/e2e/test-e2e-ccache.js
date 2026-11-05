// L1 ccache 非 ASCII 路径 E2E（真实 ccache + MinGW GCC）
//
// 覆盖 0.8.138 的「两段式规避」：
//  - 工程根路径含非 ASCII + compilerCache=ccache → 编译命令前置 ccache、追加 -fno-working-directory、
//    源文件参数改为工程相对路径；真实 ccache 首次可缓存、二次构建命中。
//  - ASCII 工程 → 不追加开关、仍用绝对源路径（与 0.8.137 一致）。
//  - compilerCache=none → 零影响。
//
// 依赖：Windows（ANSI 代码页问题仅 Windows 复现）+ 可探测到 ccache；缺失时 SKIP（打印原因）。
// 用法：node tests/e2e/test-e2e-ccache.js
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./harness');

const T = { pass: 0, fail: 0, skip: 0 };
function check(name, cond, actual, expected) {
  if (cond) { T.pass++; console.log(`  OK   ${name}`); return true; }
  T.fail++;
  console.log(`  FAIL ${name}\n       实际: ${String(actual).slice(0, 300)}\n       期望: ${String(expected).slice(0, 300)}`);
  return false;
}
function skip(name, reason) { T.skip++; console.log(`  SKIP ${name}（${reason}）`); }

function runCcache(ccache, args, cacheDir) {
  return spawnSync(ccache, args, {
    encoding: 'utf-8',
    windowsHide: true,
    env: { ...process.env, CCACHE_DIR: cacheDir },
  });
}

/** ccache 统计（4.x 英文输出）：Cacheable calls / Hits / Uncacheable calls */
function readStats(ccache, cacheDir) {
  const r = runCcache(ccache, ['--show-stats'], cacheDir);
  const text = `${r.stdout || ''}\n${r.stderr || ''}`;
  const cacheable = /Cacheable calls:\s*(\d+)\s*\/\s*(\d+)([\s\S]*?)(?:Uncacheable calls|$)/.exec(text);
  const hits = /Hits:\s*(\d+)\s*\/\s*(\d+)/.exec(cacheable ? cacheable[3] : '');
  const uncacheable = /Uncacheable calls:\s*(\d+)\s*\/\s*(\d+)/.exec(text);
  return {
    text,
    cacheable: cacheable ? Number(cacheable[1]) : 0,
    total: cacheable ? Number(cacheable[2]) : 0,
    hits: hits ? Number(hits[1]) : 0,
    uncacheable: uncacheable ? Number(uncacheable[1]) : 0,
  };
}

const TP = ['hello-cb.cbp', 'main.c', 'util.c', 'util.h'];
const SUPPRESS = '-fno-working-directory';

/** 从输出行提取真实编译/链接命令（ccache 前缀后 gcc 不在行首，harness.commandLines 只匹配行首/路径前的 gcc） */
function commandLinesFrom(lines) {
  return lines
    .flatMap((l) => String(l.line).split(/\r?\n/))
    .map((s) => s.trim())
    .filter((s) => /(^|[\\/"\s])(gcc|g\+\+|clang)(\.exe)?"?\s+[^\n]*\s-(c|o)(\s|$)/.test(s));
}
function compileCommandsOf(lines) {
  return commandLinesFrom(lines).filter((c) => / -c(\s|$)/.test(c));
}
function linkCommandsOf(lines) {
  return commandLinesFrom(lines).filter((c) => !/ -c(\s|$)/.test(c) && / -o(\s|$)/.test(c));
}

(async () => {
  const isWin = process.platform === 'win32';
  const ccache = H.findExecutable('ccache');
  if (!isWin) skip('ccache 非 ASCII 路径', '仅 Windows 复现（POSIX 使用 UTF-8，无该限制）');
  else if (!ccache) skip('ccache 非 ASCII 路径', '未找到 ccache（可安装后重跑）');
  if (!isWin || !ccache) {
    console.log(`\nTOTAL=${T.pass + T.fail + T.skip} PASS=${T.pass} FAIL=${T.fail} SKIP=${T.skip}`);
    H.shutDown();
    process.exit(T.fail ? 1 : 0);
  }

  const cacheDir = H.mkTemp('cb-ccache-store-');
  process.env.CCACHE_DIR = cacheDir;
  try {
    H.boot({
      'codeblocks.build.compilerCache': 'ccache',
      'codeblocks.build.compilerCachePath': ccache,
    });

    // ---------- C. 中文工程路径：两段式规避 + 真实缓存 ----------
    const cjkDir = H.copyTestProject(TP, '中文 工程');
    const cjkCbp = path.join(cjkDir, 'hello-cb.cbp');
    const cjkExe = path.join(cjkDir, 'bin', 'Debug', 'hello.exe');
    runCcache(ccache, ['-z'], cacheDir);
    const cjkCtx = H.openProject(cjkCbp);
    const first = await H.build(cjkCtx, 'Debug');
    const compiles = compileCommandsOf(first.lines);
    const links = linkCommandsOf(first.lines);

    check('C1 中文路径 + ccache：构建成功', first.ok, first.ok, true);
    check('C1 产物 hello.exe 生成', fs.existsSync(cjkExe), cjkExe, '存在');
    check('C2 编译命令 ≥2（main.c + util.c）', compiles.length >= 2, compiles.length, '≥2');
    check('C2 每条编译命令前置 ccache', compiles.length > 0 && compiles.every((c) => c.includes(ccache)), compiles);
    check('C2 每条编译命令追加 -fno-working-directory', compiles.length > 0 && compiles.every((c) => c.trimEnd().endsWith(SUPPRESS)), compiles);
    check('C2 源文件改用工程相对路径（命令不含中文绝对目录）', compiles.length > 0 && compiles.every((c) => !c.includes(cjkDir)), compiles);
    check('C2 链接命令不加抑制开关', links.length > 0 && links.every((c) => !c.includes(SUPPRESS)), links);
    const notices = first.lines.filter((l) => l.sev === 'info' && l.line.includes(SUPPRESS) && /非 ASCII|non-ASCII/i.test(l.line));
    check('C3 构建开始 info 说明非 ASCII 规避（恰好一次）', notices.length === 1, first.lines.filter((l) => /非 ASCII|non-ASCII/i.test(l.line)));
    const warns = first.lines.filter((l) => l.sev === 'warning' && /无法缓存|cannot cache/i.test(l.line));
    check('C3 纯 ASCII 文件名 → 无「仍无法缓存」告警', warns.length === 0, warns);

    const s1 = readStats(ccache, cacheDir);
    check('C4 首次构建：ccache 有可缓存调用（Cacheable calls > 0）', s1.cacheable > 0, s1);
    check('C4 首次构建：无可缓存调用被判 Uncacheable（= 0）', s1.uncacheable === 0, s1);

    await new Promise((r) => setTimeout(r, 50));
    H.touch(path.join(cjkDir, 'main.c'), 1200);
    const second = await H.build(cjkCtx, 'Debug');
    const s2 = readStats(ccache, cacheDir);
    check('C4 二次构建成功（touch 后重编）', second.ok && compileCommandsOf(second.lines).length > 0, second.lines.filter((l) => / -c(\s|$)/.test(String(l.line))));
    check('C4 二次构建出现 ccache 命中（Hits > 0）', s2.hits > 0, s2);

    // ---------- A. ASCII 工程：命令与 0.8.137 一致（绝对源路径、不加开关） ----------
    const asciiDir = H.copyTestProject(TP, 'ascii-proj');
    const asciiCbp = path.join(asciiDir, 'hello-cb.cbp');
    H.setConfig({ 'codeblocks.build.compilerCache': 'ccache', 'codeblocks.build.compilerCachePath': ccache });
    const asciiCtx = H.openProject(asciiCbp);
    const asciiBuild = await H.build(asciiCtx, 'Debug');
    const asciiCompiles = compileCommandsOf(asciiBuild.lines);
    check('A1 ASCII 工程 + ccache：构建成功', asciiBuild.ok, asciiBuild.ok, true);
    check('A1 ASCII 工程：前置 ccache 仍生效', asciiCompiles.length > 0 && asciiCompiles.every((c) => c.includes(ccache)), asciiCompiles);
    check('A1 ASCII 工程：不追加 -fno-working-directory', asciiCompiles.length > 0 && asciiCompiles.every((c) => !c.includes(SUPPRESS)), asciiCompiles);
    check('A1 ASCII 工程：仍用绝对源路径（UseFullSourcePaths）',
      asciiCompiles.length > 0 && asciiCompiles.every((c) => c.includes(path.join(asciiDir, 'main.c')) || c.includes(path.join(asciiDir, 'util.c'))),
      asciiCompiles);

    // ---------- N. cache=none：零影响 ----------
    H.setConfig({ 'codeblocks.build.compilerCache': 'none' });
    H.touch(path.join(cjkDir, 'main.c'), 1200);
    const noneCtx = H.openProject(cjkCbp);
    const noneBuild = await H.build(noneCtx, 'Debug');
    const noneCompiles = compileCommandsOf(noneBuild.lines);
    check('N1 cache=none：构建成功', noneBuild.ok, noneBuild.ok, true);
    check('N1 cache=none：不前置 ccache', noneCompiles.length > 0 && noneCompiles.every((c) => !c.includes(ccache)), noneCompiles);
    check('N1 cache=none：不追加抑制开关', noneCompiles.length > 0 && noneCompiles.every((c) => !c.includes(SUPPRESS)), noneCompiles);
    check('N1 cache=none：中文工程仍用绝对源路径', noneCompiles.length > 0 && noneCompiles.every((c) => c.includes(path.join(cjkDir, 'main.c')) || c.includes(path.join(cjkDir, 'util.c'))), noneCompiles);
  } finally {
    delete process.env.CCACHE_DIR;
    H.shutDown();
  }

  console.log(`\nTOTAL=${T.pass + T.fail + T.skip} PASS=${T.pass} FAIL=${T.fail} SKIP=${T.skip}`);
  process.exit(T.fail ? 1 : 0);
})().catch((err) => {
  console.error('ccache E2E 异常: ' + (err && err.stack ? err.stack : err));
  H.shutDown();
  process.exit(1);
});
