// L3 像素级 UI 视觉回归（仅 WebView HTML 面）
//
// 流程：dist 真实代码生成 HTML → 注入确定性主题变量/样式 → 系统 Edge（Playwright channel=msedge）渲染
//      → 截图 → 与基线 PNG 做像素对比。
//
// 用法：
//   node tests/visual/test-visual.js                 # 对比基线（同环境严格判定）
//   node tests/visual/test-visual.js --update        # 生成/刷新基线（npm run visual:baseline）
//   node tests/visual/test-visual.js --only props-files --theme dark
//   node tests/visual/test-visual.js --fingerprint   # 打印渲染环境指纹（当前 / 入库基线 / 目录）后退出
//   node tests/visual/test-visual.js --portable      # 强制容差判定（跨环境筛查用，忽略指纹匹配；不改变 --update 写入目标）
//   node tests/visual/test-visual.js --update --canonical   # 指纹不匹配时仍写入库基线（谨慎，会改入库目录）
//   node tests/visual/test-visual.js --record-fingerprint   # 把当前指纹记录为入库基线的渲染环境（先确认严格判定 0 差异）
//
// 判定（D4 决策，默认未被放宽）：
//   - 同环境（指纹匹配；或基线取自本机指纹目录）→ 严格：pixelmatch threshold=0.1，差异像素占比 ≤ 0.5%
//   - 跨环境（指纹不匹配：OS / 浏览器主版本 / DPI 缩放任一不同）→ 明确提示后降级为容差：threshold=0.2，≤ 2%
//     结果一律标注为「容差判定」（OK(P)）；容差仍超限 → 失败，并在信息中区分
//     「渲染环境不同」与「疑似真实界面变化」。绝不静默放宽。
//
// 基线解析顺序（逐文件，取第一个存在的）：
//   CB_VISUAL_BASELINE_DIR > .cb-tools/visual/<指纹>/（本机指纹基线，严格）> tests/visual/baselines/（入库基线）
// --update 写入目标：指纹匹配（或 --canonical）→ 入库基线（同时刷新 .fingerprint.json 元数据）；
//                    指纹不匹配 → .cb-tools/visual/<指纹>/（不入库，本机自校准），不触碰入库基线。
// 失败产物：.cb-tools/visual-diff/<指纹>/<theme>/<surface>.{expected,actual,diff}.png
//
// 环境覆盖（自测/跨机验证）：CB_VISUAL_BROWSER（通道）、CB_VISUAL_DSF（缩放）、
//   CB_VISUAL_FP_OS / CB_VISUAL_FP_BROWSER_MAJOR / CB_VISUAL_FP_FONT（模拟指纹不匹配）、CB_VISUAL_BASELINE_DIR（替换基线目录）。
// 环境缺失（playwright / 浏览器）→ SKIP（exit 0），不伪装成失败。
const fs = require('fs');
const path = require('path');

const fpmeta = require('./fingerprint');

const root = path.resolve(__dirname, '..', '..');
const THEMES_TO_RUN = ['dark', 'light'];
const THRESHOLD = 0.1;           // 严格判定：pixelmatch 感知色差阈值
const MAX_DIFF_RATIO = 0.005;    // 严格判定：差异像素占比上限 0.5%
const TOLERANT_THRESHOLD = 0.2;  // 跨环境容差：感知色差阈值
const TOLERANT_MAX_RATIO = 0.02; // 跨环境容差：差异像素占比上限 2%

const args = process.argv.slice(2);
const update = args.includes('--update');
const portable = args.includes('--portable');
const printFingerprint = args.includes('--fingerprint');
const forceCanonical = args.includes('--canonical');
const recordFingerprint = args.includes('--record-fingerprint');
const onlyArg = args.find((a) => a.startsWith('--only=')) || (args.includes('--only') ? `--only=${args[args.indexOf('--only') + 1]}` : '');
const only = onlyArg ? onlyArg.split('=')[1] : '';
const themeArg = args.find((a) => a.startsWith('--theme=')) || (args.includes('--theme') ? `--theme=${args[args.indexOf('--theme') + 1]}` : '');
const themes = themeArg ? [themeArg.split('=')[1]] : THEMES_TO_RUN;
const dsf = Number(process.env.CB_VISUAL_DSF || 1) || 1;

let pass = 0, fail = 0, skip = 0, tolerantPass = 0, tolerantJudgments = 0, strictJudgments = 0;
function report(name, state, detail) {
  if (state === 'ok') { pass++; console.log('OK   ' + name + (detail ? '  ' + detail : '')); }
  else if (state === 'ok-tolerant') { pass++; tolerantPass++; console.log('OK(P) ' + name + '  ' + (detail || '')); }
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

function writeDiff(dir, id, expectedPng, shot, diff) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.expected.png`), expectedPng);
  fs.writeFileSync(path.join(dir, `${id}.actual.png`), shot);
  if (diff) fs.writeFileSync(path.join(dir, `${id}.diff.png`), diff);
}

async function main() {
  const playwright = loadPlaywright();
  if (!playwright) {
    report('visual[环境]', 'skip', '未安装 playwright（npm i -D playwright）');
    console.log(`\nvisual 视觉回归: ${pass} pass, ${fail} fail, ${skip} skip`);
    process.exit(0);
  }

  const channel = process.env.CB_VISUAL_BROWSER || 'msedge';
  const envBaselineDir = process.env.CB_VISUAL_BASELINE_DIR ? path.resolve(root, process.env.CB_VISUAL_BASELINE_DIR) : '';
  const canonicalDir = envBaselineDir || fpmeta.CANONICAL_DIR;
  const sidecarPath = path.join(canonicalDir, '.fingerprint.json');

  let browser;
  try {
    browser = await playwright.chromium.launch({ channel, headless: true, args: [`--force-device-scale-factor=${dsf}`, '--hide-scrollbars'] });
  } catch (err) {
    if (printFingerprint) {
      console.log(JSON.stringify({ error: '浏览器无法启动', channel, detail: String(err.message || err).split('\n')[0] }, null, 2));
      process.exit(0);
    }
    const msg = String(err.message || err).split('\n')[0];
    if (msg.includes('Executable doesn') || msg.includes('channel')) {
      report('visual[环境]', 'skip', `无法启动浏览器 channel=${channel}：${msg}（可设 CB_VISUAL_BROWSER=chromium 并执行 npx playwright install chromium）`);
      console.log(`\nvisual 视觉回归: ${pass} pass, ${fail} fail, ${skip} skip`);
      process.exit(0);
    }
    throw err;
  }

  // ---- 渲染环境指纹与判定口径 ----
  const probePage = await browser.newPage({ deviceScaleFactor: dsf });
  let fontHash = 'unknown';
  try { fontHash = await fpmeta.probeFontMetrics(probePage); } finally { await probePage.close(); }
  const current = fpmeta.currentFingerprint({ channel, browserVersion: browser.version(), scale: dsf, font: fontHash });
  const canonicalMeta = fpmeta.loadCanonical(sidecarPath);
  const canonicalMatch = canonicalMeta ? fpmeta.matches(current, canonicalMeta.fingerprint) : null;
  const dirs = fpmeta.baselineDirs({ fp: current, canonicalMatch, canonicalDir, envDir: envBaselineDir });

  if (printFingerprint) {
    console.log(JSON.stringify({
      schema: fpmeta.SCHEMA,
      current,
      canonical: canonicalMeta ? { ...canonicalMeta.fingerprint, capturedAt: canonicalMeta.capturedAt } : null,
      match: canonicalMatch,
      dirs: {
        canonical: path.relative(root, canonicalDir),
        canonicalFingerprintFile: fs.existsSync(sidecarPath) ? path.relative(root, sidecarPath) : null,
        local: path.relative(root, fpmeta.localBaselineDir(current.id)),
      },
      strictWhenMatched: `pixelmatch threshold ${THRESHOLD} / ratio ${MAX_DIFF_RATIO}`,
      tolerantWhenMismatch: `pixelmatch threshold ${TOLERANT_THRESHOLD} / ratio ${TOLERANT_MAX_RATIO}`,
    }, null, 2));
    await browser.close();
    process.exit(0);
  }

  console.log(`渲染指纹: ${current.label}（${current.id}，browser ${current.browserVersion}）`);
  if (!canonicalMeta) {
    console.log(`基线指纹: 未记录（${path.relative(root, sidecarPath)} 不存在）→ 本次按严格判定；--record-fingerprint / --update 可记录元数据`);
  } else if (canonicalMatch) {
    console.log(`基线指纹: ${canonicalMeta.fingerprint.label} ✓ 同环境 → 严格判定（threshold ${THRESHOLD} / ≤${(MAX_DIFF_RATIO * 100).toFixed(1)}%）`);
  } else {
    console.log(`⚠️  渲染环境与入库基线不同：当前 ${current.label} ≠ 基线 ${canonicalMeta.fingerprint.label}`);
    console.log(`    → 本次降级为「容差判定」（threshold ${TOLERANT_THRESHOLD} / ≤${(TOLERANT_MAX_RATIO * 100).toFixed(1)}%），结果标注 OK(P)；入库门禁未改变，非静默放宽`);
    console.log(`    → 如需本机严格判定：执行 --update（基线写入 ${path.relative(root, fpmeta.localBaselineDir(current.id))}/，不触碰入库基线）`);
  }
  if (portable) console.log(`--portable：强制容差判定（threshold ${TOLERANT_THRESHOLD} / ≤${(TOLERANT_MAX_RATIO * 100).toFixed(1)}%），忽略指纹匹配`);
  console.log(`基线解析顺序：${dirs.map((d) => `${path.relative(root, d.dir)}[${d.kind}${d.strict === false ? '→容差' : ''}]`).join(' > ')}`);

  const { installVscodeMock } = require('../_harness/vscodeMock');
  const { prepareHtml } = require('./themes');
  const { buildSurfaces } = require('./surfaces');
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

  const resolveBaseline = (themeName, id) => {
    for (const d of dirs) {
      const p = path.join(d.dir, themeName, `${id}.png`);
      if (fs.existsSync(p)) return { path: p, dir: d.dir, kind: d.kind, strict: portable ? false : d.strict };
    }
    return null;
  };
  const writeTarget = () => {
    if (envBaselineDir) return { dir: envBaselineDir, kind: 'env' };
    if (canonicalMatch === false && !forceCanonical) return { dir: fpmeta.localBaselineDir(current.id), kind: 'local' };
    return { dir: canonicalDir, kind: 'canonical' };
  };
  const diffDirFor = (themeName) => path.join(root, '.cb-tools', 'visual-diff', current.id, themeName);

  const pixelmatchMod = require('pixelmatch');
  const pixelmatch = typeof pixelmatchMod === 'function' ? pixelmatchMod : pixelmatchMod.default;
  const { PNG } = require('pngjs');

  try {
    for (const theme of themes) {
      for (const surface of selected) {
        const name = `${theme}/${surface.id}`;
        const page = await browser.newPage({ viewport: { width: surface.width, height: surface.height }, deviceScaleFactor: dsf });
        try {
          await page.setContent(prepareHtml(surface.html, theme), { waitUntil: 'load' });
          for (const action of surface.actions) await runAction(page, action);
          await settle(page);
          const shot = await page.screenshot({ fullPage: true });

          const found = resolveBaseline(theme, surface.id);
          if (update || !found) {
            const target = writeTarget();
            const out = path.join(target.dir, theme, `${surface.id}.png`);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, shot);
            report(name, 'ok', `${update ? '已更新基线' : '首次生成基线'} → ${path.relative(root, out)}`);
            continue;
          }

          const expected = PNG.sync.read(fs.readFileSync(found.path));
          const actual = PNG.sync.read(shot);
          if (found.strict) strictJudgments++; else tolerantJudgments++;
          const thr = found.strict ? THRESHOLD : TOLERANT_THRESHOLD;
          const maxRatio = found.strict ? MAX_DIFF_RATIO : TOLERANT_MAX_RATIO;
          const modeDesc = found.strict
            ? `严格判定（基线 ${path.relative(root, found.path)}）`
            : `容差判定（基线来自 ${found.kind}，跨环境）`;

          if (expected.width !== actual.width || expected.height !== actual.height) {
            const dir = diffDirFor(theme);
            writeDiff(dir, surface.id, fs.readFileSync(found.path), shot);
            const why = found.strict
              ? '尺寸变化与渲染环境无关（视口/布局变化）'
              : '跨环境尺寸不同：DPI/缩放会改变截图像素尺寸，属渲染环境差异';
            report(name, 'fail', `尺寸变化 expected=${expected.width}x${expected.height} actual=${actual.width}x${actual.height}（${modeDesc}）→ ${why}；产物 ${path.relative(root, dir)}`);
            continue;
          }

          const diff = new PNG({ width: expected.width, height: expected.height });
          const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: thr });
          const ratio = diffPixels / (expected.width * expected.height);
          const ratioPct = (ratio * 100).toFixed(3);
          if (ratio > maxRatio) {
            const dir = diffDirFor(theme);
            writeDiff(dir, surface.id, fs.readFileSync(found.path), shot, PNG.sync.write(diff));
            const why = found.strict
              ? `严格判定失败且渲染环境与基线一致（${current.label}）→ 界面变化或本机渲染漂移${ratio > 0.05 ? '；差异较大，若本机渲染环境实际与基线机器不同（如缺字体），可用 --portable 复核或 --update 生成本机指纹基线' : ''}`
              : `跨环境容差仍超限（当前 ${current.label} ≠ 基线 ${canonicalMeta?.fingerprint?.label || '未记录'}）→ 疑似真实界面变化，而非渲染环境差异`;
            report(name, 'fail', `差异像素 ${diffPixels}（${ratioPct}% > 上限 ${(maxRatio * 100).toFixed(1)}%）→ ${why}；产物 ${path.relative(root, dir)}`);
          } else if (!found.strict) {
            const strictNote = ratio > MAX_DIFF_RATIO
              ? `严格阈值 ${(MAX_DIFF_RATIO * 100).toFixed(1)}% 会失败，容差内`
              : '严格阈值内';
            report(name, 'ok-tolerant', `差异 ${diffPixels}px（${ratioPct}%；${strictNote}）`);
          } else {
            report(name, 'ok', `差异 ${diffPixels}px（${ratioPct}%）`);
          }
        } finally {
          await page.close();
        }
      }
    }
  } finally {
    await browser.close();
  }

  // 基线写入后的渲染环境元数据（入库基线 → 仓库侧 .fingerprint.json；本机指纹目录 → 目录内 fingerprint.json）
  if (update || recordFingerprint) {
    if (recordFingerprint && !update) {
      console.log(`\n--record-fingerprint：把当前指纹记录为入库基线的渲染环境（${path.relative(root, sidecarPath)}）`);
      console.log('  注意：仅当入库基线确由本机渲染生成（同环境严格判定 0 差异）时才应执行。');
      fpmeta.saveCanonical(current, { note: '--record-fingerprint 记录（未重生成像素基线）', surfaces: selected.length * themes.length }, sidecarPath);
    } else if (writeTarget().kind === 'local') {
      const dir = fpmeta.localBaselineDir(current.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'fingerprint.json'), JSON.stringify({ schema: fpmeta.SCHEMA, fingerprint: current, capturedAt: new Date().toISOString() }, null, 2) + '\n', 'utf-8');
      console.log(`\n基线写入本机指纹目录（不入库）：${path.relative(root, dir)}/ —— 指纹不匹配入库基线 ${canonicalMeta?.fingerprint?.label || '（未记录）'}，故不改动 tests/visual/baselines/`);
    } else {
      fpmeta.saveCanonical(current, { note: '入库基线由本机渲染生成（--update）；跨机运行会降级为容差判定并提示', surfaces: selected.length * themes.length }, sidecarPath);
      console.log(`\n基线指纹元数据已写入：${path.relative(root, sidecarPath)}（${current.label}）`);
    }
  }

  const judgmentDesc = tolerantJudgments
    ? `容差判定×${tolerantJudgments}${strictJudgments ? ` + 严格判定×${strictJudgments}` : ''}${portable ? '（--portable）' : canonicalMatch === false ? '（跨环境）' : ''}`
    : strictJudgments ? '严格判定' : (canonicalMatch === false ? '未比较（跨环境）' : '未比较');
  const modeDesc = `指纹=${current.id}, ${judgmentDesc}`;
  console.log(`\nvisual 视觉回归（theme=${themes.join(',')}, ${modeDesc}${only ? ', only=' + only : ''}${update ? ', update' : ''}）: ${pass} pass${tolerantPass ? `（其中 ${tolerantPass} 为容差判定）` : ''}, ${fail} fail, ${skip} skip`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('visual 运行异常: ' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
