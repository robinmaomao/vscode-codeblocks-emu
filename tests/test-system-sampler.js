// 系统 CPU 归属采样回归（src/build/systemSampler.ts）：
//  A. 进程名归一 / 归类（编译器含工具链前缀、编辑器、安全软件、其它）
//  B. 采样行解析（整机百分比 / 进程表 / 半行 / 非 S 前缀 / 异常数值）
//  C. 汇总口径（分组 = ΣCPU毫秒 / Σ(窗口毫秒 × 核数)；整机取计数器；other = 整机 − 三组）
//  D. PowerShell 脚本本体：编码往返 + 关键片段 + 真机采样（非 Windows 跳过）
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { normalizeProcessName, categorizeProcess, parseSampleLine, aggregateSamples, encodePowerShellCommand, SAMPLE_SCRIPT, SECURITY_PROCESS_NAMES, EDITOR_PROCESS_NAMES, SAMPLED_PROCESS_PATTERNS, SCANNER_PROCESS_NAMES } = require('../dist/build/systemSampler.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}`); }
}

// ---- A. 归一 + 归类（编辑器 / 安全软件 / 其它） ----
check('A1 归一：大小写 / .exe / 空格', normalizeProcessName('  QQPCMgr.EXE ') === 'qqpcmgr', normalizeProcessName('  QQPCMgr.EXE '));
check('A2 归类：VS Code 系列都是编辑器组（扩展宿主就在其中）',
  ['Code', 'code - insiders', 'Code.exe', 'VSCodium', 'Cursor'].every((n) => categorizeProcess(n) === 'editor'),
  ['Code', 'Cursor'].map(categorizeProcess));
check('A3 归类：腾讯电脑管家 / 360 / Defender / 火绒 是安全软件',
  ['QQPCMgr', 'QQPCTray', 'QQPCRTP', '360Tray', 'ZhuDongFangYu', 'MsMpEng', 'HipsTray', 'usysdiag']
    .every((n) => categorizeProcess(n) === 'security'),
  ['QQPCMgr', 'MsMpEng'].map(categorizeProcess));
check('A4 归类：编译器 / 浏览器 / node 都归「其它」（不再单独采样）',
  ['gcc', 'cc1', 'riscv32-elf-gcc', 'chrome', 'node', 'explorer', ''].every((n) => categorizeProcess(n) === 'other'),
  ['gcc', 'node'].map(categorizeProcess));
check('A5 采样名单 = 编辑器 + 安全软件 + 扫描器（不含编译器，避免 250 ms 高频开销）',
  SAMPLED_PROCESS_PATTERNS.length === EDITOR_PROCESS_NAMES.length + SECURITY_PROCESS_NAMES.length + SCANNER_PROCESS_NAMES.length
  && !SAMPLED_PROCESS_PATTERNS.includes('cc1'),
  SAMPLED_PROCESS_PATTERNS.length);
// 扫描器分组（rg + conhost）：构建写目标文件 → VS Code 全工作区枚举的直接证据
check('A5b rg / conhost 归类为 scanner',
  categorizeProcess('rg') === 'scanner' && categorizeProcess('rg.exe') === 'scanner'
  && categorizeProcess('RG') === 'scanner' && categorizeProcess('conhost') === 'scanner',
  [categorizeProcess('rg'), categorizeProcess('conhost')]);
check('A5c 扫描器名在采样名单内（否则永远采不到）',
  SAMPLED_PROCESS_PATTERNS.includes('rg') && SAMPLED_PROCESS_PATTERNS.includes('conhost'),
  SAMPLED_PROCESS_PATTERNS.length);
{
  // ????? rg+conhost ?? 5 s?8 ? × 10 s ?? = 80 s ???→ 6.25%
  const byName = new Map([['rg', 3000], ['conhost', 2000], ['code', 1000], ['__notslef', 0]]);
  const agg = aggregateSamples([{ cores: 8, elapsedMs: 10000, byName, totalPct: 100, selfMs: 1000 }]);
  check('A5d 扫描器 CPU 计入 scanner 分组而不是 other',
    Math.abs(agg.groupPct.scanner - 6.25) < 0.01 && Math.abs(agg.groupPct.editor - 1.25) < 0.01,
    [agg.groupPct.scanner, agg.groupPct.editor]);
  check('A5e other 已扣除编辑器/扫描器/采样器自身',
    Math.abs(agg.groupPct.other - (100 - 1.25 - 0 - 6.25 - 1.25)) < 0.01, agg.groupPct.other);
  check('A5f 扫描器进 top 榜单（归因可见）',
    agg.top.some((t) => t.name === 'rg') && agg.top[0].name === 'rg', agg.top);
}
check('A6 安全软件名单含电脑管家实时防护', SECURITY_PROCESS_NAMES.includes('qqpcrtp'), SECURITY_PROCESS_NAMES.length);

// ---- B. 采样行解析 ----
{
  const s = parseSampleLine('S;8;1000;97;qqpcmgr=900;Code=300');
  check('B1 合法行解析出核数 / 窗口 / 整机 / 进程表',
    !!s && s.cores === 8 && s.elapsedMs === 1000 && s.totalPct === 97 && s.byName.size === 2,
    s && [s.cores, s.elapsedMs, s.totalPct, s.byName.size]);
  check('B2 进程名归一为小写', !!s && s.byName.has('qqpcmgr'), s && [...s.byName.keys()]);
  check('B3 半行（无换行截断）也能解析', parseSampleLine('S;8;1000;42;gcc=42')?.byName.get('gcc') === 42);
  check('B4 整机 -1 = 计数器不可用（totalPct 为 undefined）', parseSampleLine('S;8;1000;-1;gcc=1')?.totalPct === undefined);
  check('B5 非 S 前缀返回 undefined', parseSampleLine('Get-Process : ...') === undefined && parseSampleLine('C;8;280;1;cc1=1') === undefined);
  check('B6 字段不足返回 undefined', parseSampleLine('S;8;1000') === undefined && parseSampleLine('S') === undefined);
  check('B7 核数 / 窗口异常返回 undefined', parseSampleLine('S;0;1000;5;a=1') === undefined && parseSampleLine('S;8;0;5;a=1') === undefined);
  check('B8 非法进程项跳过（不抛异常）', parseSampleLine('S;8;1000;5;=5;gcc=abc;cc1=7')?.byName.size === 1,
    parseSampleLine('S;8;1000;5;=5;gcc=abc;cc1=7')?.byName.size);
  check('B9 同名项累加（多个 Code 实例合并）', parseSampleLine('S;8;1000;5;Code=100;Code=200')?.byName.get('code') === 300);
  const withSelf = parseSampleLine('S;8;2000;50;__self=300;Code=100');
  check('B10 __self 单独计入 selfMs、不进进程表',
    withSelf?.selfMs === 300 && withSelf.byName.size === 1, withSelf && [withSelf.selfMs, withSelf.byName.size]);
}

// ---- C. 汇总口径 ----
{
  const samples = [
    { cores: 8, elapsedMs: 1000, totalPct: 96, byName: new Map([['qqpcmgr', 2000], ['code', 1000]]) },
    { cores: 8, elapsedMs: 1000, totalPct: 94, byName: new Map([['qqpcmgr', 1600], ['code', 800]]) },
  ];
  const sum = aggregateSamples(samples);
  // 分母 = (1000+1000)×8 = 16000
  check('C1 窗口计数与总耗时', sum.samples === 2 && sum.elapsedMs === 2000, [sum.samples, sum.elapsedMs]);
  check('C2 安全软件占比 = 3600/16000', Math.abs(sum.groupPct.security - 22.5) < 0.01, sum.groupPct.security);
  check('C3 编辑器占比 = 1800/16000', Math.abs(sum.groupPct.editor - 11.25) < 0.01, sum.groupPct.editor);
  check('C4 整机取计数器均值（95）', Math.abs(sum.totalPct - 95) < 0.01 && sum.totalFromCounter === true, sum.totalPct);
  check('C5 other = 整机 − 编辑器 − 安全软件（含工具链）',
    Math.abs(sum.groupPct.other - (95 - 22.5 - 11.25)) < 0.01, sum.groupPct.other);
  check('C6 top 按 CPU 降序', sum.top.map((t) => t.name).join(',') === 'qqpcmgr,code', sum.top);
  check('C7 security 只含安全软件', sum.security.length === 1 && Math.abs(sum.security[0].pct - 22.5) < 0.01, sum.security);
  check('C8 空采样返回全 0（不产生 NaN）',
    aggregateSamples([]).totalPct === 0 && aggregateSamples([]).samples === 0 && aggregateSamples([]).groupPct.other === 0,
    aggregateSamples([]).totalPct);
  check('C9 异常窗口被丢弃',
    aggregateSamples([{ cores: 0, elapsedMs: 1000, byName: new Map() }, { cores: 8, elapsedMs: 0, byName: new Map() }]).samples === 0);
  const noCounter = aggregateSamples([{ cores: 8, elapsedMs: 1000, byName: new Map([['Code', 8000]]) }]);
  check('C10 无计数器时整机 = 受关注进程之和且 other=0',
    noCounter.totalFromCounter === false && Math.abs(noCounter.totalPct - 100) < 0.01 && noCounter.groupPct.other === 0,
    [noCounter.totalPct, noCounter.groupPct.other]);
  const over = aggregateSamples([{ cores: 8, elapsedMs: 1000, totalPct: 10, byName: new Map([['Code', 8000]]) }]);
  check('C11 other 不为负', over.groupPct.other === 0, over.groupPct.other);
  const withSelf = aggregateSamples([{ cores: 8, elapsedMs: 2000, totalPct: 100, selfMs: 800, byName: new Map([['Code', 4000]]) }]);
  check('C12 采样器自身 CPU 从 other 中扣除（100-25-5=70）',
    Math.abs(withSelf.groupPct.other - 70) < 0.01, withSelf.groupPct.other);
}

// ---- D. PowerShell 脚本 ----
check('D1 脚本编码往返（UTF-16LE base64）',
  Buffer.from(encodePowerShellCommand(SAMPLE_SCRIPT), 'base64').toString('utf16le') === SAMPLE_SCRIPT);
check('D2 脚本关键片段（PerformanceCounter / 名字过滤 / S; 前缀）',
  SAMPLE_SCRIPT.includes('PerformanceCounter') && SAMPLE_SCRIPT.includes('Get-Process -Name $names')
  && SAMPLE_SCRIPT.includes("'S;'") && SAMPLE_SCRIPT.includes('Start-Sleep -Milliseconds 1000')
  && !SAMPLE_SCRIPT.includes("'cc1';"),
  SAMPLE_SCRIPT.slice(0, 120));

function finish() {
  console.log(`系统采样回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

if (process.platform !== 'win32' || !fs.existsSync(path.join(__dirname, '..', 'dist', 'build', 'systemSampler.js'))) {
  console.log('SKIP D3~D5 真机采样（非 Windows 或 dist 未编译）');
  finish();
} else {
  const enc = encodePowerShellCommand(SAMPLE_SCRIPT);
  const proc = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let buf = '';
  proc.stdout.setEncoding('utf8');
  // 采样脚本每 2 s 一个窗口；PerformanceCounter 首次初始化实测 1~6 s，
  // 收到 2 个窗口就结束（避免固定等待），上限 20 s 防卡死。
  let closed = false;
  const done = () => { if (closed) return; closed = true; try { proc.kill(); } catch { /* 已退出 */ } };
  const timer = setTimeout(done, 20000);
  proc.stdout.on('data', (d) => {
    buf += d;
    if (buf.split(/\r?\n/).filter((l) => l.trim().startsWith('S;')).length >= 2) done();
  });
  proc.on('error', () => { clearTimeout(timer); check('D3 采样进程可启动', false); finish(); });
  proc.on('close', () => {
    clearTimeout(timer);
    const lines = buf.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed = lines.map(parseSampleLine).filter(Boolean);
    check('D3 真机采样：至少 1 个可解析窗口', parsed.length >= 1, lines.slice(0, 2));
    check('D4 真机采样：至少一个窗口含真实进程名',
      parsed.some((x) => x.byName.size > 0), parsed.map((x) => x.byName.size).slice(0, 6));
    check('D5 真机采样：整机百分比可用且在 0~100',
      parsed.length > 0 && parsed.some((s) => typeof s.totalPct === 'number' && s.totalPct >= 0 && s.totalPct <= 100),
      parsed.map((s) => s.totalPct));
    const sum = aggregateSamples(parsed);
    check('D6 汇总口径健全（有限数值 / 非负）',
      Number.isFinite(sum.totalPct) && sum.totalPct >= 0 && sum.groupPct.editor >= 0
      && sum.groupPct.security >= 0 && sum.groupPct.other >= 0,
      [sum.totalPct, sum.groupPct]);
    finish();
  });
}
