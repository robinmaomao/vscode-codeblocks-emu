// 工程检测性能/行为回归（对照"构建期进程暴增"修复）：
//  - .cbp 增删走**增量登记**，不再触发全工作区 findFiles（历史上每次事件 = 2 个 ripgrep 进程）
//  - 全量扫描合并为**一次** findFiles('**/*.{cbp,workspace}')，且 exclude 排除 Output/obj/bin/node_modules 等重目录
//  - 大工作区保护：未打开工程数超过 codeblocks.detect.autoOpenThreshold → 不自动弹多选
//  - codeblocks.detect.autoOpen=single/off 的行为
//  - 多选默认不再全选（仅勾选最近使用/活动工程）
//  - codeblocks.workspaceScanReport 诊断命令：强制扫描一次并输出报告
//
// 说明：扩展模块级状态绑定首次 require('vscode') 的 mock，故**每个配置场景单起一个子进程**（--case <name>）。
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 写一个最小可解析的 .cbp */
function writeCbp(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file,
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n\t<FileVersion major="1" minor="6" />\n\t<Project>\n'
    + `\t\t<Option title="${path.basename(file, '.cbp')}" />\n`
    + '\t\t<Build>\n\t\t\t<Target title="default">\n\t\t\t\t<Option type="1" />\n\t\t\t\t<Option compiler="gcc" />\n\t\t\t</Target>\n\t\t</Build>\n'
    + '\t\t<Unit filename="main.c" />\n\t</Project>\n</CodeBlocks_project_file>\n', 'utf-8');
}

const outText = (app) => (app.mock.channels || []).map((c) => (c.lines || []).join('\n')).join('\n');
const barTexts = (app) => (app.mock.statusBarItems || []).map((i) => String(i.text || '')).filter((t) => /Code::Blocks/.test(t));

function makeWorkspace(projectCount) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-detect-'));
  const list = [];
  for (let i = 0; i < projectCount; i++) {
    const file = path.join(tmp, `5756T_S${400 + i}`, `p${i}.cbp`);
    writeCbp(file);
    list.push(file);
  }
  return { tmp, list };
}

/** 场景 1：默认配置（3 工程 + Output 下的 .cbp） */
async function runDefaultCase(c) {
  const ws = makeWorkspace(3);
  const inOutput = path.join(ws.tmp, 'P_OutputLike', 'Output', 'bin', 'inside.cbp');
  writeCbp(inOutput);
  const app = await activate({ tmpDir: ws.tmp, findFilesResult: [...ws.list, inOutput] });
  const calls = app.mock.findFilesCalls;
  c.check('A1 激活期只做一次 findFiles（合并 .cbp/.workspace，历史上是两次）', calls.length === 1, calls.length, 1);
  c.check('A2 include 使用合并 glob', calls[0] && calls[0].include === '**/*.{cbp,workspace}', calls[0] && calls[0].include, '**/*.{cbp,workspace}');
  c.check('A3 exclude 排除重目录（Output/obj/bin/node_modules/.git）',
    /Output/.test(calls[0].exclude || '') && /obj/.test(calls[0].exclude || '') && /bin/.test(calls[0].exclude || '')
    && /node_modules/.test(calls[0].exclude || '') && /\.git/.test(calls[0].exclude || ''),
    calls[0].exclude, '含 Output/obj/bin/node_modules/.git');
  const prompt = app.records.quickPickPrompts[0];
  c.check('A4 检测到 3 个工程（Output 下的 .cbp 被排除）', prompt && prompt.items.length === 3, prompt && prompt.items.length, 3);
  c.check('A5 多选默认不全选（无最近使用时一个都不勾）',
    prompt && prompt.raw.every((i) => !i.picked), prompt && prompt.raw.map((i) => i.picked), '全 false');

  const before = app.mock.findFilesCalls.length;
  const created = path.join(ws.tmp, 'NEW_5756T_S999', 'new.cbp');
  writeCbp(created);
  app.mock.emitFileEvent('create', created);
  await sleep(60);
  c.check('B1 新建 .cbp 不触发 findFiles（增量登记）', app.mock.findFilesCalls.length === before, app.mock.findFilesCalls.length, before);
  c.check('B2 新建 .cbp 后状态栏出现待打开入口（工程数 +1）',
    barTexts(app).some((t) => /Code::Blocks 项目 \(4\)/.test(t)), barTexts(app), '含「Code::Blocks 项目 (4)」');

  fs.rmSync(created, { force: true });
  app.mock.emitFileEvent('delete', created);
  await sleep(60);
  c.check('B3 删除 .cbp 不触发 findFiles（增量移除）', app.mock.findFilesCalls.length === before, app.mock.findFilesCalls.length, before);
  c.check('B4 删除后状态栏恢复为 3 个待打开', barTexts(app).some((t) => /Code::Blocks 项目 \(3\)/.test(t)), barTexts(app), '含「Code::Blocks 项目 (3)」');

  const beforeScan = app.mock.findFilesCalls.length;
  await app.invoke('codeblocks.workspaceScanReport');
  c.check('B5 诊断命令已注册并可调用', app.has('codeblocks.workspaceScanReport'), app.has('codeblocks.workspaceScanReport'), true);
  c.check('B6 诊断命令强制扫描一次（忽略 30s 缓存）', app.mock.findFilesCalls.length === beforeScan + 1, app.mock.findFilesCalls.length, beforeScan + 1);
  const out = outText(app);
  c.check('B7 报告含耗时/工程目录数/ripgrep 并发/多工程父目录提示',
    /工作区扫描诊断报告/.test(out) && /本次全量扫描耗时/.test(out) && /ripgrep）进程数/.test(out) && /个工程分散在多个目录/.test(out),
    out.split('\n').filter((l) => /诊断报告|耗时|ripgrep|多个目录/.test(l)).slice(0, 4), '报告关键行');
  await app.deactivate().catch(() => undefined);
}

/** 场景 2：阈值保护（6 工程，阈值 2） */
async function runThresholdCase(c) {
  const ws = makeWorkspace(6);
  const app = await activate({ tmpDir: ws.tmp, findFilesResult: ws.list, config: { 'codeblocks.detect.autoOpenThreshold': 2 } });
  c.check('C1 超过阈值不弹多选', app.records.quickPickPrompts.length === 0, app.records.quickPickPrompts.length, 0);
  const out = outText(app);
  c.check('C2 输出通道提示「已跳过自动弹窗」并建议单工程工作区',
    /已跳过自动弹窗/.test(out) && /单个工程目录作为工作区/.test(out), out.split('\n').filter((l) => /跳过自动弹窗|单个工程目录/.test(l)).join(' | '), '提示行');
  c.check('C3 仍登记待打开入口（状态栏可手动打开）',
    barTexts(app).some((t) => /Code::Blocks 项目 \(6\)/.test(t)), barTexts(app), '含「Code::Blocks 项目 (6)」');
  await app.deactivate().catch(() => undefined);
}

/** 场景 3：autoOpen=single（3 工程 → 不自动打开） */
async function runSingleCase(c) {
  const ws = makeWorkspace(3);
  const app = await activate({ tmpDir: ws.tmp, findFilesResult: ws.list, config: { 'codeblocks.detect.autoOpen': 'single' } });
  c.check('D1 autoOpen=single：多工程时不弹多选', app.records.quickPickPrompts.length === 0, app.records.quickPickPrompts.length, 0);
  await app.deactivate().catch(() => undefined);
}

/** 场景 4：autoOpen=off（3 工程 → 不弹窗，但状态栏仍提供入口） */
async function runOffCase(c) {
  const ws = makeWorkspace(3);
  const app = await activate({ tmpDir: ws.tmp, findFilesResult: ws.list, config: { 'codeblocks.detect.autoOpen': 'off' } });
  c.check('E1 autoOpen=off：不弹多选', app.records.quickPickPrompts.length === 0, app.records.quickPickPrompts.length, 0);
  c.check('E2 autoOpen=off：状态栏仍提供入口',
    barTexts(app).some((t) => /Code::Blocks 项目 \(3\)/.test(t)), barTexts(app), '含「Code::Blocks 项目 (3)」');
  await app.deactivate().catch(() => undefined);
}

const CASES = {
  default: runDefaultCase,
  threshold: runThresholdCase,
  single: runSingleCase,
  off: runOffCase,
};

// ---------- 子进程：执行单个场景 ----------
if (process.argv[2] === '--case') {
  const name = process.argv[3];
  let pass = 0, fail = 0;
  const c = {
    check(label, cond, got, want) {
      if (cond) { pass++; console.log('OK   ' + label); }
      else { fail++; console.log(`FAIL ${label}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
    },
  };
  (async () => {
    try {
      await CASES[name](c);
    } catch (e) {
      fail++;
      console.log('FAIL ' + name + ' 运行异常: ' + (e && e.stack ? e.stack : e));
    }
    console.log(`[case=${name}] ${pass} pass, ${fail} fail`);
    process.exit(fail ? 1 : 0);
  })();
} else {
  // ---------- 父进程：逐场景起子进程并汇总 ----------
  let pass = 0, fail = 0;
  const failed = [];
  for (const name of Object.keys(CASES)) {
    const r = spawnSync(process.execPath, [__filename, '--case', name], { encoding: 'utf8', timeout: 120000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    process.stdout.write(out);
    const m = out.match(/\[case=[^\]]+\]\s*(\d+)\s*pass,\s*(\d+)\s*fail/);
    if (!m) { fail++; failed.push(`${name}:无摘要`); continue; }
    pass += Number(m[1]);
    fail += Number(m[2]);
    if (Number(m[2]) > 0) failed.push(name);
  }
  console.log(`\nproject-detect-scan: ${pass} pass, ${fail} fail${failed.length ? '  [' + failed.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
}
