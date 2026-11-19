// 新建工程 / 用户模板的覆盖保护（F-01）：
//  - .cbp 已存在且选择“保留现有” → 不写盘、不修改骨架文件
//  - 骨架文件已存在且选择“保留现有” → 只写 .cbp，保留旧文件
//  - 选择“覆盖” → 更新文件
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');
const { PROJECT_TEMPLATES } = require('../dist/project/newProject');
const { saveAsUserTemplate } = require('../dist/project/userTemplates');
const i18n = require('../dist/i18n');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-overwrite-'));
  const app = await activate({ tmpDir: tmp });
  const { records, mock } = app;
  const Uri = app.vscode.Uri;
  const base = path.join(tmp, 'projects');
  fs.mkdirSync(base, { recursive: true });
  const tpl = PROJECT_TEMPLATES.find((t) => t.id === 'console-c');

  async function runNewProject(name, warnings = []) {
    app.setQuickPick({ label: `$(file-code) ${tpl.label}`, template: tpl });
    app.setInputBox(name);
    app.setOpenDialog(Uri.file(base));
    app.setQuickPick('gcc');
    for (const w of warnings) app.setWarningButton(w);
    const before = mock.warnings.length;
    await app.invoke('codeblocks.newProject');
    return mock.warnings.slice(before);
  }

  // 1) .cbp 已存在，保留现有 → 全部不变
  const existing = path.join(base, 'demo');
  fs.mkdirSync(existing, { recursive: true });
  fs.writeFileSync(path.join(existing, 'demo.cbp'), 'SENTINEL-CBP\n', 'utf-8');
  fs.writeFileSync(path.join(existing, 'main.c'), 'SENTINEL-MAIN\n', 'utf-8');
  const w1 = await runNewProject('demo', [i18n.t('Keep Existing')]);
  check('新建工程：.cbp 冲突选择保留 → 不覆盖 .cbp', fs.readFileSync(path.join(existing, 'demo.cbp'), 'utf-8') === 'SENTINEL-CBP\n', fs.readFileSync(path.join(existing, 'demo.cbp'), 'utf-8'));
  check('新建工程：.cbp 冲突选择保留 → 不覆盖骨架', fs.readFileSync(path.join(existing, 'main.c'), 'utf-8') === 'SENTINEL-MAIN\n', fs.readFileSync(path.join(existing, 'main.c'), 'utf-8'));
  check('新建工程：出现覆盖确认', w1.length === 1 && w1[0].includes('已存在'), w1);

  // 2) 仅骨架文件冲突，保留现有 → 写 .cbp，保留旧 main.c
  const keepSkeleton = path.join(base, 'keep-skeleton');
  fs.mkdirSync(keepSkeleton, { recursive: true });
  fs.writeFileSync(path.join(keepSkeleton, 'main.c'), 'OLD-MAIN\n', 'utf-8');
  await runNewProject('keep-skeleton', [i18n.t('Keep Existing')]);
  check('新建工程：骨架冲突选择保留 → 旧文件不变', fs.readFileSync(path.join(keepSkeleton, 'main.c'), 'utf-8') === 'OLD-MAIN\n', fs.readFileSync(path.join(keepSkeleton, 'main.c'), 'utf-8'));
  check('新建工程：骨架冲突选择保留 → 仍写出 .cbp', fs.existsSync(path.join(keepSkeleton, 'keep-skeleton.cbp')), fs.existsSync(path.join(keepSkeleton, 'keep-skeleton.cbp')));

  // 3) 骨架冲突选择覆盖 → 更新
  const overwrite = path.join(base, 'overwrite');
  fs.mkdirSync(overwrite, { recursive: true });
  fs.writeFileSync(path.join(overwrite, 'main.c'), 'OLD-MAIN\n', 'utf-8');
  await runNewProject('overwrite', [i18n.t('Overwrite')]);
  check('新建工程：骨架冲突选择覆盖 → 新内容', fs.readFileSync(path.join(overwrite, 'main.c'), 'utf-8').includes('main()'), fs.readFileSync(path.join(overwrite, 'main.c'), 'utf-8'));

  // 4) 无冲突 → 正常创建
  await runNewProject('fresh');
  check('新建工程：无冲突 → 创建成功', fs.existsSync(path.join(base, 'fresh', 'fresh.cbp')) && fs.existsSync(path.join(base, 'fresh', 'main.c')), fs.existsSync(path.join(base, 'fresh')));

  // 5) 用户模板覆盖保护
  const srcDir = path.join(tmp, 'tpl-src');
  fs.mkdirSync(srcDir, { recursive: true });
  fs.writeFileSync(path.join(srcDir, 'main.c'), 'int main(){return 0;}\n', 'utf-8');
  fs.writeFileSync(path.join(srcDir, 'tpl.cbp'), '<?xml version="1.0" encoding="UTF-8"?><CodeBlocks_project_file><Project><Option title="tpl" /></Project></CodeBlocks_project_file>\n', 'utf-8');
  const tplRoot = path.join(tmp, 'User', 'globalStorage', 'robinmaomao.codeblocks-vscode', 'templates');
  const manifest = saveAsUserTemplate({ root: tplRoot, name: 'Demo', projectDir: srcDir, cbpPath: path.join(srcDir, 'tpl.cbp'), projectTitle: 'tpl', fileRels: ['main.c'] });
  const userOut = path.join(base, 'from-template');
  fs.mkdirSync(userOut, { recursive: true });
  fs.writeFileSync(path.join(userOut, `${manifest.id}.cbp`), 'USER-CBP\n', 'utf-8');
  fs.writeFileSync(path.join(userOut, 'main.c'), 'USER-MAIN\n', 'utf-8');
  app.setQuickPick({ label: manifest.name, templateId: manifest.id });
  app.setInputBox(manifest.id);
  app.setOpenDialog(Uri.file(base));
  app.setWarningButton(i18n.t('Keep Existing'));
  await app.invoke('codeblocks.newProject');
  check('用户模板：.cbp 冲突选择保留 → cbp 不变', fs.readFileSync(path.join(userOut, `${manifest.id}.cbp`), 'utf-8') === 'USER-CBP\n', fs.readFileSync(path.join(userOut, `${manifest.id}.cbp`), 'utf-8'));
  check('用户模板：.cbp 冲突选择保留 → 骨架不变', fs.readFileSync(path.join(userOut, 'main.c'), 'utf-8') === 'USER-MAIN\n', fs.readFileSync(path.join(userOut, 'main.c'), 'utf-8'));

  await app.deactivate();
  console.log(`新建工程覆盖保护: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
