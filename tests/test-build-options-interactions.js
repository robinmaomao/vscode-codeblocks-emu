// Build options 交互回归（真实 DOM，Playwright + 系统 Edge）：
//  - P1-1：Compiler Flags 勾选 → additionalLibs 整串写入 Other linker options（不是 Link libraries）；
//          取消勾选时弹「启用编译器参数?」，选 No 从 Other linker options 移除
//  - P1-2：工程/目标有构建脚本时显示 CB 的 lblBuildScriptsNote 红字提示
//  - P1-3：Linker executable 行只在目标作用域出现
//  - P1-6：Custom variables 走 EditPairDlg 式键值对话框（键名正则 + 含空格询问引号）
//  - P1-8：嵌入式覆盖层有「确定 / 取消」（取消不回写）
const path = require('path');
const fs = require('fs');

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
const { buildOptionsMarkup, buildOptionsPage, buildOptionsScript } = require('../dist/ui/buildOptionsView.js');

function scope(title, extra) {
  return Object.assign({
    title,
    compilerId: 'gcc',
    compilerOptions: [],
    resourceCompilerOptions: [],
    linkerOptions: [],
    linkLibs: [],
    linkerExecutable: 0,
    relations: { compiler: 3, linker: 3, include: 3, lib: 3, res: 3 },
    includeDirs: [],
    libDirs: [],
    resourceDirs: [],
    commandsBefore: [],
    commandsAfter: [],
    alwaysPost: false,
    envVars: [],
    makeCommands: {},
  }, extra || {});
}

function makeData() {
  return {
    projectTitle: 'demo',
    makefileIsCustom: false,
    hasBuildScripts: true,
    defineSwitch: '-D',
    project: scope('demo'),
    targets: [scope('Debug', { targetType: 0, linkerExecutable: 2 })],
    compilers: [{ id: 'gcc', name: 'GNU GCC Compiler' }],
    compilerCatalogs: {
      gcc: [
        { name: 'Debug', option: '-g', category: 'Debug' },
        { name: 'Profile', option: '-pg', additionalLibs: '-pg -lgmon', category: 'Profiling' },
      ],
    },
    compilerBaseCatalogs: { gcc: [] },
    compilerFlags: { gcc: { cOnly: [], cppOnly: [] } },
  };
}

async function withPage(html, fn) {
  const { chromium } = require('playwright');
  const channel = process.env.CB_VISUAL_BROWSER || 'msedge';
  const browser = await chromium.launch({ channel, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1180, height: 860 } });
    page.on('pageerror', (e) => { fail++; console.log('FAIL page error: ' + e.message); });
    await page.setContent(prepareHtml(html, 'dark'), { waitUntil: 'load' });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

(async () => {
  // ---- 独立面板：Linker executable 行 / 构建脚本提示 / additionalLibs / 变量对话框 ----
  const pageHtml = buildOptionsPage(makeData());
  await withPage(pageHtml, async (page) => {
    check('构建脚本提示可见（lblBuildScriptsNote）', await page.isVisible('#bo-scripts-note'), null);

    await page.click('[data-page="linker"]');
    check('工程作用域不显示 Linker executable 行', (await page.locator('#bo-linker-exe').count()) === 0, await page.locator('#bo-linker-exe').count());

    await page.click('[data-scope="0"]');
    await page.click('[data-page="linker"]');
    const exeCount = await page.locator('#bo-linker-exe').count();
    const exeLabels = await page.locator('#bo-linker-exe option').allTextContents();
    check('目标作用域显示 Linker executable 行', exeCount === 1, exeCount);
    check('Linker executable 文案对齐 CB', JSON.stringify(exeLabels) === JSON.stringify(['Auto detect', 'Use C compiler', 'Use C++ compiler', 'Use linker']), exeLabels);

    // 回工程作用域，勾选 Profile（additionalLibs = "-pg -lgmon"）
    await page.click('[data-scope="project"]');
    await page.click('[data-page="compiler"]');
    await page.check('input[data-flag="-pg"]');
    const collected = await page.evaluate(() => window.cbBuildOptions.read());
    check('additionalLibs 整串写入 Other linker options', collected.project.linkerOptions.includes('-pg -lgmon'), collected.project.linkerOptions);
    check('additionalLibs 不再拆进 Link libraries', collected.project.linkLibs.length === 0, collected.project.linkLibs);

    // 取消勾选 → CB 的「启用编译器参数?」询问；选 No 移除
    await page.uncheck('input[data-flag="-pg"]');
    const asked = await page.locator('.bo-modal').count();
    check('取消勾选时弹出冲突询问', asked > 0, asked);
    await page.click('.bo-modal [data-pick="1"]');
    const after = await page.evaluate(() => window.cbBuildOptions.read());
    check('冲突询问选 No：从 Other linker options 移除', after.project.linkerOptions.includes('-pg -lgmon') === false, after.project.linkerOptions);

    // ---- Custom variables：EditPairDlg 式键值对话框 ----
    await page.click('[data-page="vars"]');
    await page.click('.bo-actions [data-act="add"]');
    const okDisabled = await page.locator('.bo-modal [data-act="ok"]').isDisabled();
    check('变量对话框：键为空时 OK 禁用', okDisabled === true, okDisabled);
    await page.fill('#bo-pair-key', 'BAD KEY');
    check('变量对话框：键含空格仍禁用', await page.locator('.bo-modal [data-act="ok"]').isDisabled(), null);
    await page.fill('#bo-pair-key', 'MY_VAR');
    await page.fill('#bo-pair-value', 'C:\\Program Files\\tool');
    await page.click('.bo-modal [data-act="ok"]');
    const quotePrompt = await page.locator('.bo-modal [data-pick="0"]').count();
    check('值含空格时询问是否加引号', quotePrompt > 0, quotePrompt);
    await page.click('.bo-modal [data-pick="0"]');
    const vars = (await page.evaluate(() => window.cbBuildOptions.read())).project.envVars;
    check('变量写入并已加引号', vars.length === 1 && vars[0].name === 'MY_VAR' && vars[0].value === '"C:\\Program Files\\tool"', vars);
  });

  // ---- 嵌入式覆盖层：确定 / 取消 ----
  const embeddedHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>` +
    `<div id="bo-overlay" class="bo-overlay" style="display:none">${buildOptionsMarkup(true)}</div>` +
    `<script>window.__cbVscode = acquireVsCodeApi();</script>` +
    `<script>${buildOptionsScript(makeData(), true)}</script>` +
    `<script>window.cbBuildOptions.open(null, 'project');</script>` +
    `</body></html>`;
  await withPage(embeddedHtml, async (page) => {
    check('覆盖层有「确定」按钮', (await page.locator('#bo-ok').count()) === 1, null);
    check('覆盖层有「取消」按钮', (await page.locator('#bo-cancel').count()) === 1, null);
    await page.click('#bo-cancel');
    check('取消后覆盖层关闭', await page.evaluate(() => document.getElementById('bo-overlay').style.display === 'none'), null);
  });

  console.log(`\nbuild-options-interactions: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error('build-options-interactions crashed:', err && err.message);
  process.exit(1);
});
