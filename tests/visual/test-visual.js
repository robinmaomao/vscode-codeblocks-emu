// L3 像素级 UI 视觉回归（仅 WebView HTML 面）
//
// 流程：dist 真实代码生成 HTML → 注入确定性主题变量/样式 → 系统 Edge（Playwright channel=msedge）渲染
//      → 截图 → 与 tests/visual/baselines/<theme>/<surface>.png 做像素对比。
//
// 用法：
//   node tests/visual/test-visual.js            # 对比基线（CI/回归）
//   node tests/visual/test-visual.js --update   # 生成/刷新基线（npm run visual:baseline）
//   node tests/visual/test-visual.js --only props-files --theme dark
//
// 判定：pixelmatch threshold=0.1；差异像素占比 ≤ 0.5% 通过（D4 决策）。
// 失败产物：.cb-tools/visual-diff/<theme>/<surface>.{expected,actual,diff}.png
// 环境缺失（playwright / 浏览器）→ SKIP（exit 0），不伪装成失败。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const BASELINE_DIR = path.join(__dirname, 'baselines');
const DIFF_DIR = path.join(root, '.cb-tools', 'visual-diff');
const THEMES_TO_RUN = ['dark', 'light'];
const THRESHOLD = 0.1;      // pixelmatch 感知色差阈值
const MAX_DIFF_RATIO = 0.005; // 差异像素占比上限 0.5%

const args = process.argv.slice(2);
const update = args.includes('--update');
const onlyArg = args.find((a) => a.startsWith('--only=')) || (args.includes('--only') ? `--only=${args[args.indexOf('--only') + 1]}` : '');
const only = onlyArg ? onlyArg.split('=')[1] : '';
const themeArg = args.find((a) => a.startsWith('--theme=')) || (args.includes('--theme') ? `--theme=${args[args.indexOf('--theme') + 1]}` : '');
const themes = themeArg ? [themeArg.split('=')[1]] : THEMES_TO_RUN;

let pass = 0, fail = 0, skip = 0;
function report(name, state, detail) {
  if (state === 'ok') { pass++; console.log('OK   ' + name + (detail ? '  ' + detail : '')); }
  else if (state === 'skip') { skip++; console.log('SKIP ' + name + '  ' + (detail || '')); }
  else { fail++; console.log('FAIL ' + name + '  ' + (detail || '')); }
}

function loadPlaywright() {
  try { return require('playwright'); } catch { return null; }
}

/** 确定性注入交给 themes.prepareHtml（setContent 不触发 addInitScript，故直接注入 HTML 头部） */

async function runAction(page, action) {
  if (action.type === 'click') await page.click(action.selector);
  else if (action.type === 'postMessage') {
    await page.evaluate((payload) => { window.postMessage(payload, '*'); }, action.payload);
    await page.waitForTimeout(60); // 宿主消息为异步任务，等待其被面板脚本消费
  } else if (action.type === 'wait') await page.waitForTimeout(action.ms || 50);
}

async function settle(page) {
  await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}

async function main() {
  const { installVscodeMock } = require('../_harness/vscodeMock');
  const { prepareHtml } = require('./themes');
  const { buildSurfaces } = require('./surfaces');

  const playwright = loadPlaywright();
  if (!playwright) {
    report('visual[环境]', 'skip', '未安装 playwright（npm i -D playwright）');
    console.log(`\nvisual 视觉回归: ${pass} pass, ${fail} fail, ${skip} skip`);
    process.exit(0);
  }

  const channel = process.env.CB_VISUAL_BROWSER || 'msedge';
  const mock = installVscodeMock();
  let surfaces;
  try {
    surfaces = buildSurfaces();
  } finally {
    mock.restore();
  }
  const selected = surfaces.filter((s) => !only || s.id.includes(only));
  if (!selected.length) {
    report('visual[选择]', 'fail', `--only=${only} 未匹配任何面（可用：${surfaces.map((s) => s.id).join(', ')}）`);
    console.log(`\nvisual 视觉回归: ${pass} pass, ${fail} fail, ${skip} skip`);
    process.exit(1);
  }

  let browser;
  try {
    browser = await playwright.chromium.launch({ channel, headless: true, args: ['--force-device-scale-factor=1', '--hide-scrollbars'] });
  } catch (err) {
    const msg = String(err.message || err).split('\n')[0];
    if (msg.includes('Executable doesn') || msg.includes('channel')) {
      report('visual[环境]', 'skip', `无法启动浏览器 channel=${channel}：${msg}（可设 CB_VISUAL_BROWSER=chromium 并执行 npx playwright install chromium）`);
      console.log(`\nvisual 视觉回归: ${pass} pass, ${fail} fail, ${skip} skip`);
      process.exit(0);
    }
    throw err;
  }

  const pixelmatchMod = require('pixelmatch');
  const pixelmatch = typeof pixelmatchMod === 'function' ? pixelmatchMod : pixelmatchMod.default;
  const { PNG } = require('pngjs');

  try {
    for (const theme of themes) {
      for (const surface of selected) {
        const name = `${theme}/${surface.id}`;
        const page = await browser.newPage({ viewport: { width: surface.width, height: surface.height }, deviceScaleFactor: 1 });
        try {
          await page.setContent(prepareHtml(surface.html, theme), { waitUntil: 'load' });
          for (const action of surface.actions) await runAction(page, action);
          await settle(page);
          const shot = await page.screenshot({ fullPage: true });

          const basePath = path.join(BASELINE_DIR, theme, `${surface.id}.png`);
          if (update || !fs.existsSync(basePath)) {
            fs.mkdirSync(path.dirname(basePath), { recursive: true });
            fs.writeFileSync(basePath, shot);
            report(name, 'ok', update ? '已更新基线' : '首次生成基线');
            continue;
          }

          const expected = PNG.sync.read(fs.readFileSync(basePath));
          const actual = PNG.sync.read(shot);
          if (expected.width !== actual.width || expected.height !== actual.height) {
            const dir = path.join(DIFF_DIR, theme);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${surface.id}.expected.png`), fs.readFileSync(basePath));
            fs.writeFileSync(path.join(dir, `${surface.id}.actual.png`), shot);
            report(name, 'fail', `尺寸变化 expected=${expected.width}x${expected.height} actual=${actual.width}x${actual.height}（产物 ${path.relative(root, dir)}）`);
            continue;
          }

          const diff = new PNG({ width: expected.width, height: expected.height });
          const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: THRESHOLD });
          const ratio = diffPixels / (expected.width * expected.height);
          if (ratio > MAX_DIFF_RATIO) {
            const dir = path.join(DIFF_DIR, theme);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, `${surface.id}.expected.png`), fs.readFileSync(basePath));
            fs.writeFileSync(path.join(dir, `${surface.id}.actual.png`), shot);
            fs.writeFileSync(path.join(dir, `${surface.id}.diff.png`), PNG.sync.write(diff));
            report(name, 'fail', `差异像素 ${diffPixels}（${(ratio * 100).toFixed(3)}% > ${(MAX_DIFF_RATIO * 100).toFixed(1)}%）→ ${path.relative(root, dir)}`);
          } else {
            report(name, 'ok', `差异 ${diffPixels}px（${(ratio * 100).toFixed(3)}%）`);
          }
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`\nvisual 视觉回归（theme=${themes.join(',')}${only ? ', only=' + only : ''}${update ? ', update' : ''}）: ${pass} pass, ${fail} fail, ${skip} skip`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('visual 运行异常: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
