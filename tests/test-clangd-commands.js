// clangd 新命令回归（可激活 mock 直调真实 handler）：
//  - codeblocks.cleanClangdConfig：扫描→预览→确认清理（失效片段 + 孤儿缓存目录）；无失效项时提示干净
//  - codeblocks.clangd.applyQueryDriver：推导 --query-driver 并与既有 clangd.arguments 合并去重；
//    写入位置三选一（工作区/用户/剪贴板）；取消时不写入任何设置
// 前置：tests/_harness/extensionActivation.js（补桩 + 假 context + 对话框脚本化）
// 安全：把 LOCALAPPDATA / XDG_CONFIG_HOME 指到临时目录，绝不触碰真实用户的 clangd 配置
const path = require('path');
const fs = require('fs');
const os = require('os');

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-clangd-cmd-'));
process.env.LOCALAPPDATA = path.join(tmpRoot, 'LocalAppData');
process.env.XDG_CONFIG_HOME = path.join(tmpRoot, 'config');

const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

/** 写一个最小可解析的 .cbp（编译器取默认 gcc，供 query-driver 推导） */
function writeCbp(dir, fileName, title) {
  fs.mkdirSync(dir, { recursive: true });
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>\n'
    + '<CodeBlocks_project_file>\n'
    + '\t<FileVersion major="1" minor="6" />\n'
    + '\t<Project>\n'
    + `\t\t<Option title="${title}" />\n`
    + '\t\t<Option compiler="gcc" />\n'
    + '\t\t<Build>\n'
    + '\t\t\t<Target title="Debug">\n'
    + '\t\t\t\t<Option type="1" />\n'
    + '\t\t\t\t<Option compiler="gcc" />\n'
    + `\t\t\t\t<Option output="bin/Debug/${title}" />\n`
    + '\t\t\t\t<Option object_output="obj/Debug/" />\n'
    + '\t\t\t</Target>\n'
    + '\t\t</Build>\n'
    + '\t\t<Unit filename="main.c" />\n'
    + '\t</Project>\n'
    + '</CodeBlocks_project_file>\n';
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, xml, 'utf-8');
  return p;
}

(async () => {
  const app = await activate({ tmpDir: tmpRoot, config: { 'clangd.arguments': ['--background-index'] } });
  const { records, mock, ctx } = app;
  const Uri = app.vscode.Uri;
  // 必须等 mock 装好后再 require（dist/tools/clangd.js 顶层 import 'vscode'）
  const { clangdUserConfigPath, updateClangdUserConfig, listManagedFragments } = require('../dist/tools/clangd.js');
  const cfgPath = clangdUserConfigPath();
  check('clangd 配置路径落在临时目录（不触碰真实用户配置）', cfgPath.startsWith(tmpRoot), cfgPath);

  // ---------- 夹具：一个已打开工程（供 query-driver 推导编译器） ----------
  const cbp = writeCbp(path.join(tmpRoot, 'proj'), 'app.cbp', 'app');
  app.setOpenDialog(Uri.file(cbp));
  await app.invoke('codeblocks.openProject');

  const cacheRoot = path.join(ctx.globalStorageUri.fsPath, 'clangd');
  fs.mkdirSync(cacheRoot, { recursive: true });
  const orphanDir = path.join(cacheRoot, 'deadbeef0001');

  // ---------- 1) cleanClangdConfig：无失效片段/无孤儿缓存时提示干净（不动文件） ----------
  fs.rmSync(cfgPath, { force: true });
  let infosBefore = mock.infos.length;
  await app.invoke('codeblocks.cleanClangdConfig');
  check('清理命令：无失效项时给出干净提示', mock.infos.slice(infosBefore).some((m) => /干净/.test(m)), mock.infos.slice(infosBefore));
  check('清理命令：无失效项时不动配置文件', !fs.existsSync(cfgPath), fs.existsSync(cfgPath));

  // ---------- 2) cleanClangdConfig：确认后清理失效片段 + 孤儿缓存目录 ----------
  fs.mkdirSync(orphanDir, { recursive: true });
  fs.writeFileSync(path.join(orphanDir, 'compile_commands.json'), '[]', 'utf-8');
  const liveDir = path.join(tmpRoot, 'live-scope');
  const goneDir = path.join(tmpRoot, 'gone-scope');
  fs.mkdirSync(liveDir, { recursive: true });
  fs.mkdirSync(goneDir, { recursive: true });
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  fs.writeFileSync(cfgPath, '# user own keep me\n', 'utf-8');
  updateClangdUserConfig([
    { dir: liveDir, databaseDir: liveDir },
    { dir: goneDir, databaseDir: liveDir },
  ]);
  fs.rmSync(goneDir, { recursive: true, force: true });
  const beforeClean = fs.readFileSync(cfgPath, 'utf-8');
  check('夹具：清理前 2 个扩展片段（其中 1 个失效）', listManagedFragments(beforeClean).length === 2, listManagedFragments(beforeClean).length);

  app.setWarningButton('清理');
  await app.invoke('codeblocks.cleanClangdConfig');
  const afterClean = fs.readFileSync(cfgPath, 'utf-8');
  const remaining = listManagedFragments(afterClean);
  check('清理命令：确认后失效片段被移除（只剩存活片段）', remaining.length === 1 && remaining[0].scopeDir.includes('live-scope'), remaining.map((f) => f.scopeDir));
  check('清理命令：用户自有内容保留', afterClean.includes('# user own keep me'), null);
  check('清理命令：孤儿缓存目录被删除', !fs.existsSync(orphanDir), fs.existsSync(orphanDir));
  check('清理命令：清理前打印明细到输出通道', (() => {
    const ch = mock.channels.find((c) => c.name === 'Code::Blocks');
    return !!ch && ch.lines.some((l) => /失效片段 [0-9a-f]{12} ←/.test(l)) && ch.lines.some((l) => /孤儿缓存/.test(l));
  })(), null);

  // ---------- 3) 取消确认：不清理 ----------
  fs.writeFileSync(cfgPath, beforeClean.replace(/\n+$/, '\n'), 'utf-8');
  const beforeCancel = fs.readFileSync(cfgPath, 'utf-8');
  app.setWarningButton(undefined); // 用户关闭对话框
  await app.invoke('codeblocks.cleanClangdConfig');
  check('清理命令：取消时不改动配置（用户可先看明细）', fs.readFileSync(cfgPath, 'utf-8') === beforeCancel, null);

  // ---------- 4) applyQueryDriver：取消选择 → 不写设置、不写剪贴板 ----------
  let clipBefore = records.clipboard.length;
  app.setQuickPick(undefined); // 无预置 ⇒ 模拟用户按 Esc
  await app.invoke('codeblocks.clangd.applyQueryDriver');
  check('query-driver：取消选择时不写剪贴板/设置', records.clipboard.length === clipBefore, records.clipboard.length - clipBefore);
  check('query-driver：给出三选一（工作区/用户/剪贴板）', (() => {
    const p = records.quickPickPrompts[records.quickPickPrompts.length - 1];
    return !!p && p.items.some((i) => /工作区/.test(i)) && p.items.some((i) => /用户/.test(i)) && p.items.some((i) => /剪贴板/.test(i));
  })(), records.quickPickPrompts.slice(-1));

  // ---------- 5) applyQueryDriver：仅复制到剪贴板 → 与既有 clangd.arguments 合并 ----------
  app.setQuickPick({ id: 'clipboard', label: '仅复制到剪贴板' });
  await app.invoke('codeblocks.clangd.applyQueryDriver');
  const clip = records.clipboard[records.clipboard.length - 1] || '';
  check('query-driver：剪贴板含 --query-driver 参数', /--query-driver=/.test(clip), clip);
  check('query-driver：合并保留既有 clangd.arguments（--background-index）', /--background-index/.test(clip), clip);
  check('query-driver：参数来自工程编译器目录', /"clangd\.arguments":\s*\[/.test(clip), clip);

  // ---------- 6) applyQueryDriver：已存在同一参数时不重复（去重） ----------
  const argMatch = clip.match(/--query-driver=[^"]*/);
  app.setConfig('clangd.arguments', ['--background-index', argMatch[0]]);
  app.setQuickPick({ id: 'clipboard', label: '仅复制到剪贴板' });
  await app.invoke('codeblocks.clangd.applyQueryDriver');
  const clip2 = records.clipboard[records.clipboard.length - 1] || '';
  const occurrences = (clip2.match(/--query-driver=/g) || []).length;
  check('query-driver：同一参数不重复写入（去重）', occurrences === 1, { occurrences, clip2 });

  // ---------- 7) applyQueryDriver：选择写入工作区设置 → 走配置 update（预览确认） ----------
  app.setQuickPick({ id: 'workspace', label: '写入工作区设置（推荐）' });
  app.setWarningButton('写入设置');
  const updates = [];
  const origUpdate = app.vscode.workspace.getConfiguration;
  app.vscode.workspace.getConfiguration = (section) => {
    const c = origUpdate(section);
    return { ...c, update: (k, v, target) => { updates.push({ section, k, v, target }); return Promise.resolve(); } };
  };
  await app.invoke('codeblocks.clangd.applyQueryDriver');
  app.vscode.workspace.getConfiguration = origUpdate;
  check('query-driver：确认后调用 clangd.arguments 的 update（工作区目标）',
    updates.some((u) => u.section === 'clangd' && u.k === 'arguments' && Array.isArray(u.v) && u.v.some((x) => /^--query-driver=/.test(x)) && u.target === app.vscode.ConfigurationTarget.Workspace),
    updates);

  // ---------- 8) 无活动工程：给出提示、不弹选择 ----------
  app.setWarningButton('Remove'); // removeProject 的确认对话框
  await app.invoke('codeblocks.removeProject', { project: { filename: cbp } });
  const promptsBefore = records.quickPickPrompts.length;
  const warnsBefore = mock.warnings.length;
  await app.invoke('codeblocks.clangd.applyQueryDriver');
  check('query-driver：无工程时提示且不进入选择流程',
    mock.warnings.length > warnsBefore && records.quickPickPrompts.length === promptsBefore,
    { warns: mock.warnings.length - warnsBefore, prompts: records.quickPickPrompts.length - promptsBefore });

  console.log(`clangd 命令回归: ${pass} pass, ${fail} fail${failures.length ? `  [${failures.join(', ')}]` : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('clangd 命令回归异常:', e); process.exit(1); });
