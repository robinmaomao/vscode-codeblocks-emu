// 工程属性面板交互回归（真实 DOM，Playwright + 系统 Edge）：
//  - P1-10：编辑字段后不失焦直接点另一个目标，第一次点击即切换（change 重渲染不再吞点击）
//  - P1-4：目标类型切换按 CB OnProjectTypeChanged 改写扩展名/前缀并清空 Import/Definition
//  - P1-9：新增/复制/重命名目标走名称询问 + ValidateTargetName 校验
//  - P1-11：自定义 Makefile 下 Selected file properties 仍可用
//  - P2-2：类型 0 文案 = GUI application
const path = require('path');

const root = path.join(__dirname, '..');
const { installVscodeMock } = require('./_harness/vscodeMock');
const { prepareHtml } = require('./visual/themes');

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const mock = installVscodeMock({ config: { 'codeblocks.ui.language': 'en' } });
const { ProjectParser } = require('../dist/model/parser.js');
const { ProjectPropertiesPanel } = require('../dist/ui/projectPropertiesPanel.js');

const project = new ProjectParser().parse(path.join(root, 'tests/visual/fixtures/rich.cbp'));
const runtime = {
  compilers: [{ id: 'gcc', name: 'GNU GCC Compiler' }],
  compilerCatalogs: { gcc: [] },
  compilerBaseCatalogs: { gcc: [] },
  compilerFlags: { gcc: { cOnly: [], cppOnly: [] } },
  defineSwitch: '-D',
  libExtension: 'a',
  libPrefix: 'lib',
  exeExtension: 'exe',
  dynamicLibExtension: 'dll',
  nativeExtension: 'sys',
  supportsPch: true,
};
new ProjectPropertiesPanel(project, mock.vscode.Uri.file(root), () => undefined, 'targets', null, runtime);
const html = mock.webviews[mock.webviews.length - 1].webview.html;

async function withPage(fn) {
  const { chromium } = require('playwright');
  const channel = process.env.CB_VISUAL_BROWSER || 'msedge';
  const browser = await chromium.launch({ channel, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => { fail++; console.log('FAIL page error: ' + e.message); });
    await page.setContent(prepareHtml(html, 'dark'), { waitUntil: 'load' });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

(async () => {
  await withPage(async (page) => {
    check('类型 0 文案 = GUI application', (await page.locator('#f-type option[value="0"]').textContent()).trim() === 'GUI application', await page.locator('#f-type option[value="0"]').textContent());
    check('导入库/定义文件空值用 placeholder 显示默认宏（CB 为空）',
      (await page.getAttribute('#f-implib', 'placeholder')) === '$(TARGET_OUTPUT_DIR)$(TARGET_OUTPUT_BASENAME)'
      && (await page.inputValue('#f-implib')) === ''
      && (await page.inputValue('#f-deffile')) === '', await page.inputValue('#f-implib'));

    // ---- P1-10：编辑后直接点另一个目标 ----
    await page.click('#list .item[data-i="0"]');
    await page.fill('#f-output', 'bin/EDITED/app');
    await page.click('#list .item[data-i="1"]');
    let selected = await page.evaluate(() => {
      const el = document.querySelector('#list .item.selected');
      return el ? el.getAttribute('data-i') : null;
    });
    check('编辑后单击另一个目标立即切换', selected === '1', selected);
    await page.click('#list .item[data-i="0"]');
    check('切回后编辑值保留', (await page.inputValue('#f-output')) === 'bin/EDITED/app', await page.inputValue('#f-output'));

    // ---- P1-4：类型切换改写扩展名/前缀 ----
    await page.uncheck('#f-ext');
    await page.uncheck('#f-prefix');
    await page.selectOption('#f-type', '3');
    await page.check('#f-staticchk');
    await page.check('#f-defchk');
    await page.fill('#f-output', 'bin/app');
    // 导入库/定义文件此刻可用，但为验证切换时的改写，先切回 GUI（会清空二者）再重新置值
    await page.selectOption('#f-type', '0');
    await page.fill('#f-output', 'bin/app');
    await page.evaluate(() => {
      document.getElementById('f-implib').value = 'bin/imp';
      document.getElementById('f-deffile').value = 'bin/exp';
      document.getElementById('f-staticchk').checked = true;
      document.getElementById('f-defchk').checked = true;
    });
    await page.selectOption('#f-type', '3');
    check('Dynamic：输出改 .dll', (await page.inputValue('#f-output')) === 'bin/app.dll', await page.inputValue('#f-output'));
    check('Dynamic：导入库改 .a', (await page.inputValue('#f-implib')) === 'bin/imp.a', await page.inputValue('#f-implib'));
    check('Dynamic：定义文件改 .def', (await page.inputValue('#f-deffile')) === 'bin/exp.def', await page.inputValue('#f-deffile'));
    await page.selectOption('#f-type', '2');
    check('Static：输出改 .a 且补 lib 前缀', (await page.inputValue('#f-output')) === 'bin/libapp.a', await page.inputValue('#f-output'));
    check('Static：清空导入库', (await page.inputValue('#f-implib')) === '', await page.inputValue('#f-implib'));
    check('Static：清空定义文件', (await page.inputValue('#f-deffile')) === '', await page.inputValue('#f-deffile'));
    await page.selectOption('#f-type', '0');
    check('GUI：输出改 .exe 且剥 lib 前缀', (await page.inputValue('#f-output')) === 'bin/app.exe', await page.inputValue('#f-output'));

    // 自动生成前缀/扩展名勾选时同样改写（CB OnProjectTypeChanged 不看这两个复选框）
    await page.check('#f-ext');
    await page.check('#f-prefix');
    await page.fill('#f-output', 'bin/auto');
    await page.selectOption('#f-type', '2');
    check('自动扩展名/前缀勾选时 Static 仍补 lib 前缀与 .a', (await page.inputValue('#f-output')) === 'bin/libauto.a', await page.inputValue('#f-output'));
    await page.selectOption('#f-type', '0');
    check('自动扩展名/前缀勾选时 GUI 仍剥前缀并改 .exe', (await page.inputValue('#f-output')) === 'bin/auto.exe', await page.inputValue('#f-output'));

    // 宏名也按 CB 的 wxFileName::SetExt 处理：末尾追加扩展名
    await page.fill('#f-output', '$(TARGET_OUTPUT_DIR)$(TARGET_OUTPUT_BASENAME)');
    await page.selectOption('#f-type', '3');
    check('宏文件名也会追加目标扩展名', (await page.inputValue('#f-output')) === '$(TARGET_OUTPUT_DIR)$(TARGET_OUTPUT_BASENAME).dll', await page.inputValue('#f-output'));
    await page.selectOption('#f-type', '4');
    check('Commands only：清空输出与目录', (await page.inputValue('#f-output')) === '', await page.inputValue('#f-output'));

    // ---- P1-9：目标命名询问 + 校验 ----
    await page.click('#tabbtn-targets');
    const firstTitle = (await page.locator('#list .item[data-i="0"] .item-label').textContent()).trim();
    await page.click('#add');
    check('新增目标弹出名称询问', (await page.locator('#ask-text-input').count()) === 1, null);
    await page.fill('#ask-text-input', firstTitle);
    await page.click('#ask-ok');
    check('重名被拒绝并提示', await page.isVisible('#ask-text-error'), null);
    await page.fill('#ask-text-input', 'Bad;Name');
    await page.click('#ask-ok');
    const errText = await page.locator('#ask-text-error').textContent();
    check('非法字符被拒绝并提示', errText.includes(';'), errText);
    await page.fill('#ask-text-input', 'FreshTarget');
    await page.click('#ask-ok');
    const titles = await page.locator('#list .item .item-label').allTextContents();
    check('合法名称新增成功', titles.some((t) => t.trim() === 'FreshTarget'), titles);

    // 复制：默认名 = Copy of <title>
    await page.click('#copy');
    check('复制默认名 = Copy of <title>', (await page.inputValue('#ask-text-input')) === 'Copy of FreshTarget', await page.inputValue('#ask-text-input'));
    await page.click('#ask-cancel');

    // ---- P1-11：自定义 Makefile 下文件属性仍可用 ----
    await page.click('#tabbtn-settings');
    await page.check('#set-mkcustom');
    await page.click('#tabbtn-targets');
    check('自定义 Makefile 下 Selected file properties 可用', (await page.isDisabled('#fileProps')) === false, null);
    // ---- 构建脚本校验展示（对齐 CB DoCheckScripts 文案，保留多行） ----
    await page.click('#tabbtn-scripts');
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
      data: {
        type: 'scriptValidation',
        results: [
          { scope: 'Debug', file: 'a.script', ok: false, line: 3, column: 2, message: 'boom' },
          { scope: 'Release', file: 'b.script', ok: false, line: 1, column: 1, message: 'bang' },
        ],
      },
    })));
    const valText = await page.locator('#scr-status').textContent();
    const whiteSpace = await page.evaluate(() => getComputedStyle(document.getElementById('scr-status')).whiteSpace);
    check('校验失败按 CB 三行文案（Invalid build script / First seen in / Error）',
      valText.includes('Invalid build script: a.script') && valText.includes('First seen in: Debug') && valText.includes('Error:'),
      valText);
    check('校验结果保留换行', whiteSpace === 'pre-line', whiteSpace);
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'scriptValidation', results: [{ scope: 'Debug', file: 'a.script', ok: true, line: 0, column: 0, message: '' }] },
    })));
    check('全部通过显示 CB 文案', (await page.locator('#scr-status').textContent()).trim() === 'All scripts seem to be valid!', null);
  });

  console.log(`\nproperties-interactions: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('properties-interactions crashed:', err && err.message);
  process.exit(1);
});
