// 工程类命令处理器回归（可激活 mock 直调真实 handler）
//  覆盖：openProject、moveProjectUp / moveProjectDown、removeProject、
//        buildProject（无工程静默早退 / 工程未找到 / 无构建目标 / 构建互斥）、
//        rebuildProject（确认取消）、cleanProject（确认取消）、exportTargetAsProject
// 前置：tests/_harness/extensionActivation.js（补桩 + 假 context + 对话框脚本化）
// 说明：
//  - mock 的 workspace.findFiles 返回空 → 激活时不会自动打开工程；所有工程都由测试显式打开（可控）。
//  - 全程不进入真实构建（BuildEngine / 外部 gcc）：构建类命令只驱动早退与互斥分支；
//    互斥分支用局部的 withProgress 打桩制造「构建进行中」，随后以 CancellationError 释放锁。
const path = require('path');
const fs = require('fs');
const os = require('os');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}
async function waitFor(cond, ms = 1500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 10));
  }
  return cond();
}

/** 写一个最小可解析的 .cbp（withTargets=false 时无任何 <Target>，用于「无构建目标」分支） */
function writeCbp(dir, fileName, title, withTargets = true) {
  fs.mkdirSync(dir, { recursive: true });
  const targets = withTargets
    ? `\t\t<Build>\n`
      + `\t\t\t<Target title="Debug">\n`
      + `\t\t\t\t<Option type="1" />\n`
      + `\t\t\t\t<Option compiler="gcc" />\n`
      + `\t\t\t\t<Option output="bin/Debug/${title}" />\n`
      + `\t\t\t\t<Option object_output="obj/Debug/" />\n`
      + `\t\t\t</Target>\n`
      + `\t\t\t<Target title="Release">\n`
      + `\t\t\t\t<Option type="1" />\n`
      + `\t\t\t\t<Option compiler="gcc" />\n`
      + `\t\t\t\t<Option output="bin/Release/${title}" />\n`
      + `\t\t\t\t<Option object_output="obj/Release/" />\n`
      + `\t\t\t</Target>\n`
      + `\t\t</Build>\n`
    : `\t\t<Build />\n`;
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n'
    + '\t<FileVersion major="1" minor="6" />\n'
    + '\t<Project>\n'
    + `\t\t<Option title="${title}" />\n`
    + '\t\t<Option compiler="gcc" />\n'
    + targets
    + '\t\t<Unit filename="main.c" />\n'
    + '\t\t<Unit filename="util.c" />\n'
    + '\t\t<Extensions />\n'
    + '\t</Project>\n'
    + '</CodeBlocks_project_file>\n';
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, xml, 'utf-8');
  return p;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cmd-project-'));
  const app = await activate({ tmpDir: tmp });
  const { records, mock } = app;
  const Uri = app.vscode.Uri;
  const channel = () => mock.channels.find((c) => c.name === 'Code::Blocks');
  const out = () => (channel() ? channel().lines.join('\n') : '');
  const countOut = (re) => (channel() ? channel().lines.filter((l) => re.test(l)).length : 0);
  const order = () => app.ctx.workspaceState.get('codeblocks.projectOrder');

  // ---------- buildProject：尚未打开任何工程时静默早退（不弹提示、不启动任务） ----------
  const w0 = mock.warnings.length, t0 = records.tasks.length;
  await app.invoke('codeblocks.buildProject');
  check('buildProject：无工程且无节点时静默早退（无提示 / 无任务 / 无构建输出）',
    mock.warnings.length === w0 && records.tasks.length === t0 && countOut(/开始构建/) === 0,
    { warnings: mock.warnings.length - w0, tasks: records.tasks.length - t0 }, '全部无变化');

  // ---------- 夹具：两个带目标的工程 + 一个无目标的工程 ----------
  const cbpA = writeCbp(path.join(tmp, 'proj-a'), 'app-a.cbp', 'app-a');
  const cbpB = writeCbp(path.join(tmp, 'proj-b'), 'app-b.cbp', 'app-b');
  const cbpC = writeCbp(path.join(tmp, 'proj-c'), 'empty.cbp', 'empty', false);

  // ---------- openProject：对话框选择 .cbp → 解析入列表 + 提示 + 持久化 ----------
  app.setOpenDialog(Uri.file(cbpA));
  await app.invoke('codeblocks.openProject');
  check('openProject：打开后弹出信息提示（含项目标题）',
    mock.infos.some((m) => /已打开 Code::Blocks 项目: app-a/.test(m)), mock.infos.slice(-1), '已打开 Code::Blocks 项目: app-a');
  check('openProject：输出通道记录项目与目标清单',
    /已打开项目: app-a/.test(out()) && /目标: Debug, Release/.test(out()), out().split('\n').slice(-3), '标题 + 目标');
  check('openProject：打开顺序持久化到 workspaceState',
    JSON.stringify(order()) === JSON.stringify([cbpA]), order(), [cbpA]);
  check('openProject：文件选择框限定 cbp / workspace 过滤器',
    records.openDialogs.some((o) => o.filters && o.filters['Code::Blocks 项目'] && o.filters['Code::Blocks 项目'].includes('cbp')),
    records.openDialogs.map((o) => o.filters), '含 cbp 过滤器');

  app.setOpenDialog([Uri.file(cbpB)]);
  await app.invoke('codeblocks.openProject');
  check('openProject：第二个工程追加到末尾（顺序 = 打开顺序）',
    JSON.stringify(order()) === JSON.stringify([cbpA, cbpB]), order(), [cbpA, cbpB]);

  // 重复打开同一工程：静默跳过（不重复入列表、不再提示）
  const infosBeforeReopen = mock.infos.length;
  app.setOpenDialog(Uri.file(cbpA));
  await app.invoke('codeblocks.openProject');
  check('openProject：重复打开同一工程不重复入列表（顺序不变、无重复提示）',
    JSON.stringify(order()) === JSON.stringify([cbpA, cbpB])
    && !mock.infos.slice(infosBeforeReopen).some((m) => /已打开 Code::Blocks 项目/.test(m)),
    { order: order(), newInfos: mock.infos.slice(infosBeforeReopen) }, '顺序不变 + 无新提示');

  // ---------- moveProjectUp / moveProjectDown：顺序真实变化 ----------
  await app.invoke('codeblocks.moveProjectUp', { project: { filename: cbpB } });
  check('moveProjectUp：B 上移到首位（持久化顺序变化）',
    JSON.stringify(order()) === JSON.stringify([cbpB, cbpA]), order(), [cbpB, cbpA]);
  await app.invoke('codeblocks.moveProjectDown', { project: { filename: cbpB } });
  check('moveProjectDown：B 下移回末位',
    JSON.stringify(order()) === JSON.stringify([cbpA, cbpB]), order(), [cbpA, cbpB]);
  await app.invoke('codeblocks.moveProjectUp', { project: { filename: cbpA } });
  check('moveProjectUp：已在首位时不越界（顺序不变）',
    JSON.stringify(order()) === JSON.stringify([cbpA, cbpB]), order(), [cbpA, cbpB]);
  await app.invoke('codeblocks.moveProjectDown'); // 无节点 → 回退活动工程（A）
  check('moveProjectDown：无节点时回退活动工程并下移',
    JSON.stringify(order()) === JSON.stringify([cbpB, cbpA]), order(), [cbpB, cbpA]);
  await app.invoke('codeblocks.moveProjectUp', { project: { filename: cbpA } });
  check('moveProjectUp：恢复原顺序（A 回到首位）',
    JSON.stringify(order()) === JSON.stringify([cbpA, cbpB]), order(), [cbpA, cbpB]);

  // ---------- removeProject：确认取消保留 / 确认后移除 ----------
  app.setWarningButton(undefined);
  await app.invoke('codeblocks.removeProject', { project: { filename: cbpB } });
  check('removeProject：确认框取消时工程保留（顺序不变、无移除日志）',
    JSON.stringify(order()) === JSON.stringify([cbpA, cbpB]) && countOut(/已移除项目/) === 0,
    { order: order(), removed: countOut(/已移除项目/) }, '保留');
  check('removeProject：弹出 modal 确认（消息含工程目录名 + Remove 按钮）',
    records.warningButtons.some((w) => /确定从侧边栏移除项目 "proj-b"/.test(w.message) && w.buttons.includes('Remove')),
    records.warningButtons.map((w) => w.buttons).slice(-2), "['Remove']");

  app.setWarningButton('Remove');
  await app.invoke('codeblocks.removeProject', { project: { filename: cbpB } });
  check('removeProject：确认后从打开列表移除（顺序只余 A）',
    JSON.stringify(order()) === JSON.stringify([cbpA]), order(), [cbpA]);
  check('removeProject：输出通道记录被移除的工程标题',
    /已移除项目: app-b/.test(out()), out().split('\n').slice(-1), '已移除项目: app-b');

  // 重新打开 B（后续 build 互斥 / 导出用 A、B 并存的状态）
  app.setOpenDialog([Uri.file(cbpB)]);
  await app.invoke('codeblocks.openProject');

  // ---------- buildProject：节点指向未打开的工程 → 「项目未找到」 ----------
  const tNotFound = records.tasks.length;
  await app.invoke('codeblocks.buildProject', { project: { filename: path.join(tmp, 'ghost.cbp') } });
  check('buildProject：工程未打开时提示「项目未找到」且不启动构建',
    mock.warnings.slice(-1).includes('项目未找到') && records.tasks.length === tNotFound && countOut(/开始构建/) === 0,
    mock.warnings.slice(-1), '项目未找到');

  // ---------- buildProject：工程无构建目标 → 「项目没有构建目标」 ----------
  app.setOpenDialog(Uri.file(cbpC));
  await app.invoke('codeblocks.openProject');
  const wNoTarget = mock.warnings.length;
  await app.invoke('codeblocks.buildProject', { project: { filename: cbpC } });
  check('buildProject：工程无构建目标时提示并不构建',
    mock.warnings.slice(wNoTarget).includes('项目没有构建目标') && countOut(/开始构建/) === 0,
    mock.warnings.slice(wNoTarget), '项目没有构建目标');

  // ---------- buildProject：构建互斥（局部打桩 withProgress 制造进行中；不进入真实编译） ----------
  await app.invoke('codeblocks.setActiveProject', cbpA);
  const origWithProgress = app.vscode.window.withProgress;
  let releaseFirstBuild;
  // 局部打桩：接管进度窗口，首个 buildProject 停在未决 Promise（buildInProgress=true），
  // 不由 mock 立即执行任务 → 不会调用 BuildEngine / 外部 gcc。
  app.vscode.window.withProgress = () => new Promise((resolve, reject) => {
    releaseFirstBuild = (err) => (err ? reject(err) : resolve(true));
  });
  const nodeA = { project: { filename: cbpA } };
  const firstBuild = app.invoke('codeblocks.buildProject', nodeA);
  const started = await waitFor(() => countOut(/开始构建/) === 1);
  check('buildProject：构建启动后输出「开始构建」', started && countOut(/开始构建/) === 1, countOut(/开始构建/), 1);

  const wMutex = mock.warnings.length;
  await app.invoke('codeblocks.buildProject', nodeA);
  check('buildProject：构建互斥时提示「已有构建正在进行」且不重复启动',
    mock.warnings.slice(wMutex).some((m) => /已有构建正在进行，请等待完成或先停止/.test(m)) && countOut(/开始构建/) === 1,
    mock.warnings.slice(wMutex), '互斥提示 + 仅 1 次启动');

  releaseFirstBuild(new app.vscode.CancellationError()); // 以用户取消结束首个构建 → 释放互斥锁
  await firstBuild.catch(() => undefined);
  app.vscode.window.withProgress = origWithProgress;
  const wAfterCancel = mock.warnings.length;
  await app.invoke('codeblocks.buildProject', { project: { filename: path.join(tmp, 'ghost.cbp') } });
  check('buildProject：取消后互斥锁释放（再次调用能进入构建流程）',
    mock.warnings.slice(wAfterCancel).includes('项目未找到'), mock.warnings.slice(wAfterCancel), '项目未找到');

  // ---------- rebuildProject：确认对话框取消 → 不构建 ----------
  app.setWarningButton(undefined);
  const buildsBeforeRebuild = countOut(/开始构建/);
  const tasksBeforeRebuild = records.tasks.length;
  await app.invoke('codeblocks.rebuildProject', { project: { filename: cbpA } });
  check('rebuildProject：确认框取消时不构建（无新构建输出 / 无任务）',
    records.warningButtons.some((w) => /重新构建将删除所有对象文件/.test(w.message) && w.buttons.includes('重新构建'))
    && countOut(/开始构建/) === buildsBeforeRebuild && records.tasks.length === tasksBeforeRebuild,
    { builds: countOut(/开始构建/), tasks: records.tasks.length },
    '确认提示 + 无构建');

  // ---------- cleanProject：确认对话框取消 → 不清理 ----------
  if (channel()) channel().clear();
  app.setWarningButton(undefined);
  const saveAllBeforeClean = records.saveAll;
  await app.invoke('codeblocks.cleanProject', { project: { filename: cbpA } });
  check('cleanProject：确认框取消时不清理（无清理输出 / 未触发构建前保存）',
    records.warningButtons.some((w) => /是否继续清理/.test(w.message) && w.buttons.includes('清理'))
    && !/清理完成/.test(out()) && records.saveAll === saveAllBeforeClean,
    { saveAllDelta: records.saveAll - saveAllBeforeClean, outHead: out().slice(0, 60) }, '取消后无清理');

  // ---------- exportTargetAsProject：QuickPick 选目标 + Export 确认 → 写出单目标 .cbp ----------
  await app.invoke('codeblocks.setActiveProject', cbpA);
  const saveAllBeforeExport = records.saveAll;
  app.setQuickPick({ label: 'Release', description: '输出: bin/Release/app-a' });
  app.setWarningButton('Export');
  const exported = path.join(tmp, 'exported-app-a.cbp');
  app.setSaveDialog(exported);
  await app.invoke('codeblocks.exportTargetAsProject');
  check('exportTargetAsProject：生成本地 .cbp 文件', fs.existsSync(exported), fs.existsSync(exported), true);
  const xml = fs.existsSync(exported) ? fs.readFileSync(exported, 'utf-8') : '';
  check('exportTargetAsProject：导出内容仅含所选目标 Release（Debug 目标未导出）',
    /title="Release"/.test(xml) && !/title="Debug"/.test(xml), (xml.match(/<Target[^>]*>/g) || []).slice(0, 3), '仅 Release');
  check('exportTargetAsProject：QuickPick 列出可导出目标 + 确认按钮为 Export',
    records.quickPickPrompts.some((q) => q.options && q.options.placeHolder === '选择要导出的构建目标' && q.items.includes('Release'))
    && records.warningButtons.some((w) => /把目标 "Release" 导出为独立工程/.test(w.message) && w.buttons.includes('Export')),
    records.quickPickPrompts.slice(-1), '目标选择 + Export');
  check('exportTargetAsProject：导出前保存全部文件',
    records.saveAll > saveAllBeforeExport, records.saveAll - saveAllBeforeExport, '≥1');
  check('exportTargetAsProject：完成后提示导出文件数',
    mock.infos.some((m) => /已导出工程（2 个文件）/.test(m)), mock.infos.slice(-2), '已导出工程（2 个文件）');
  check('exportTargetAsProject：输出通道留痕（目标与文件数）',
    /已从目标导出工程/.test(out()) && /目标 Release/.test(out()), out().split('\n').slice(-2), '导出留痕');

  await app.deactivate().catch(() => undefined);
  console.log(`\n工程类命令处理器回归: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('工程类命令处理器回归异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
