// 视觉基线「跨机假失败来源」实测探针（只测量，不改基线、不改判定）
//
// 目的：用同一台机器上的可控参数变化，量化“换机器会假失败”的各来源，为可移植策略提供证据：
//   control         默认参数重跑            → 应为 0px（本机确定性基线，非环境噪声下限）
//   dsf125          缩放 1.25（模拟 DPI 不同）→ 截图像素尺寸 ×1.25；按最近邻缩放回基线尺寸后量化像素差
//   no-lcd-text     关闭 LCD 文本次像素渲染  → 模拟另一台机器的字体栅格化设置
//   no-subpixel     关闭字体次像素定位      → 模拟另一台机器的文本排版
//   font-subst      强制替换字体栈          → 模拟目标机缺少基线字体（字体集不同）
//
// 用法：
//   node tests/visual/probe-portability.js [--theme dark] [--surfaces props-files,keybindings] [--variants control,dsf125,...]
//
// 产物：.cb-tools/visual-probe/probe-<时间戳>.{json,md}（临时证据，按需删除）
// 说明：本探针不改 tests/visual/baselines/**，也不参与 CI 门禁；跨机复现请在不同机器上运行同一命令。
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const OUT_DIR = path.join(root, '.cb-tools', 'visual-probe');
const BASELINE_DIR = path.join(__dirname, 'baselines');

const args = process.argv.slice(2);
const argOf = (name, def) => {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) return eq.split('=').slice(1).join('=');
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const theme = argOf('--theme', 'dark');
const surfacesSel = argOf('--surfaces', 'props-files,compiler-options,keybindings').split(',').map((s) => s.trim()).filter(Boolean);
const variantsSel = argOf('--variants', '').split(',').map((s) => s.trim()).filter(Boolean);

const THRESHOLD = 0.1;        // 与严格判定同口径
const STRICT_RATIO = 0.005;   // 严格判定阈值 0.5%

const FONT_SUBST_CSS = `
  :root {
    --vscode-font-family: "Times New Roman", "SimSun", serif !important;
    --vscode-editor-font-family: "Courier New", monospace !important;
    --vscode-font-size: 14px;
  }
`;

const VARIANTS = [
  { id: 'control', note: '默认参数重跑（同机确定性下限）', args: [], dsf: 1 },
  { id: 'dsf125', note: '缩放 1.25（模拟 DPI/系统缩放不同）', args: ['--force-device-scale-factor=1.25'], dsf: 1.25 },
  { id: 'no-lcd-text', note: '关闭 LCD 文本次像素渲染（模拟栅格化设置不同）', args: ['--disable-lcd-text'], dsf: 1 },
  { id: 'no-subpixel', note: '关闭字体次像素定位（模拟文本排版不同）', args: ['--disable-font-subpixel-positioning'], dsf: 1 },
  { id: 'font-subst', note: '强制替换字体栈（模拟目标机缺字体）', args: [], dsf: 1, css: FONT_SUBST_CSS },
];

function nearestResize(png, w, h) {
  const out = new PNGLike(w, h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(png.height - 1, Math.floor((y * png.height) / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(png.width - 1, Math.floor((x * png.width) / w));
      out.data[(w * y + x) * 4] = png.data[(png.width * sy + sx) * 4];
      out.data[(w * y + x) * 4 + 1] = png.data[(png.width * sy + sx) * 4 + 1];
      out.data[(w * y + x) * 4 + 2] = png.data[(png.width * sy + sx) * 4 + 2];
      out.data[(w * y + x) * 4 + 3] = png.data[(png.width * sy + sx) * 4 + 3];
    }
  }
  return out;
}
class PNGLike {
  constructor(width, height) { this.width = width; this.height = height; this.data = Buffer.alloc(width * height * 4); }
}

async function main() {
  const playwright = (() => { try { return require('playwright'); } catch { return null; } })();
  if (!playwright) { console.log('SKIP 未安装 playwright'); process.exit(0); }
  const pixelmatchMod = require('pixelmatch');
  const pixelmatch = typeof pixelmatchMod === 'function' ? pixelmatchMod : pixelmatchMod.default;
  const { PNG } = require('pngjs');

  const { installVscodeMock } = require('../_harness/vscodeMock');
  const { prepareHtml } = require('./themes');
  const { buildSurfaces } = require('./surfaces');
  const { currentFingerprint } = require('./fingerprint');

  const mock = installVscodeMock();
  let surfaces;
  try { surfaces = buildSurfaces(); } finally { mock.restore(); }
  const selected = surfaces.filter((s) => surfacesSel.some((n) => s.id === n));
  if (!selected.length) { console.log(`--surfaces 未匹配任何面（可用：${surfaces.map((s) => s.id).join(', ')}）`); process.exit(2); }

  const variants = variantsSel.length ? VARIANTS.filter((v) => variantsSel.includes(v.id)) : VARIANTS;
  const rows = [];
  let browserInfo = null;

  for (const v of variants) {
    const b = await playwright.chromium.launch({ channel: process.env.CB_VISUAL_BROWSER || 'msedge', headless: true, args: [...v.args, '--hide-scrollbars'] });
    if (!browserInfo) browserInfo = { version: b.version(), channel: process.env.CB_VISUAL_BROWSER || 'msedge', fingerprint: currentFingerprint({ channel: process.env.CB_VISUAL_BROWSER || 'msedge', browserVersion: b.version(), scale: 1 }) };
    for (const s of selected) {
      const page = await b.newPage({ viewport: { width: s.width, height: s.height }, deviceScaleFactor: v.dsf });
      try {
        await page.setContent(prepareHtml(s.html, theme), { waitUntil: 'load' });
        if (v.css) await page.addStyleTag({ content: v.css });
        for (const action of s.actions) {
          if (action.type === 'click') await page.click(action.selector);
          else if (action.type === 'postMessage') { await page.evaluate((p) => window.postMessage(p, '*'), action.payload); await page.waitForTimeout(60); }
          else if (action.type === 'wait') await page.waitForTimeout(action.ms || 50);
        }
        await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
        const shot = await page.screenshot({ fullPage: true });
        const actualRaw = PNG.sync.read(shot);
        const basePath = path.join(BASELINE_DIR, theme, `${s.id}.png`);
        if (!fs.existsSync(basePath)) { rows.push({ variant: v.id, surface: s.id, note: '基线不存在，跳过' }); continue; }
        const expected = PNG.sync.read(fs.readFileSync(basePath));
        const sizeChanged = expected.width !== actualRaw.width || expected.height !== actualRaw.height;
        const actual = sizeChanged ? nearestResize(actualRaw, expected.width, expected.height) : actualRaw;
        const diff = new PNG({ width: expected.width, height: expected.height });
        const diffPixels = pixelmatch(expected.data, actual.data, diff.data, expected.width, expected.height, { threshold: THRESHOLD });
        const ratio = diffPixels / (expected.width * expected.height);
        rows.push({
          variant: v.id, variantNote: v.note, surface: s.id,
          expected: `${expected.width}x${expected.height}`,
          actual: `${actualRaw.width}x${actualRaw.height}`,
          sizeChanged, diffPixels, ratio: Number((ratio * 100).toFixed(3)),
          strictWouldFail: sizeChanged || ratio > STRICT_RATIO,
        });
      } finally { await page.close(); }
    }
    await b.close();
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const payload = { generatedAt: new Date().toISOString(), theme, browser: browserInfo, thresholds: { pixelmatch: THRESHOLD, strictRatio: STRICT_RATIO }, rows };
  fs.writeFileSync(path.join(OUT_DIR, `probe-${stamp}.json`), JSON.stringify(payload, null, 2), 'utf-8');

  const lines = [];
  lines.push(`# 视觉基线跨机假失败来源实测（theme=${theme}，browser=${browserInfo?.channel} ${browserInfo?.version}，指纹=${browserInfo?.fingerprint?.id}）`);
  lines.push('');
  lines.push('| 变体 | 面 | 尺寸（基线→实际） | 差异像素 | 差异占比 | 严格判定(≤0.5%) |');
  lines.push('|------|----|-------------------|----------|----------|-----------------|');
  for (const r of rows) {
    if (!r.diffPixels && r.diffPixels !== 0) { lines.push(`| ${r.variant} | ${r.surface} | — | — | — | ${r.note} |`); continue; }
    lines.push(`| ${r.variant} | ${r.surface} | ${r.expected} → ${r.actual}${r.sizeChanged ? ' ⚠尺寸变化' : ''} | ${r.diffPixels} | ${r.ratio}% | ${r.strictWouldFail ? '假失败 ❌' : '通过'} |`);
  }
  const byVariant = new Map();
  for (const r of rows) {
    if (!byVariant.has(r.variant)) byVariant.set(r.variant, []);
    if (typeof r.ratio === 'number') byVariant.get(r.variant).push(r.ratio);
  }
  lines.push('');
  lines.push('## 变体汇总（各面差异占比的最大值）');
  lines.push('');
  for (const [id, ratios] of byVariant) {
    const max = Math.max(...ratios);
    const v = VARIANTS.find((x) => x.id === id);
    lines.push(`- ${id}：max ${max}%${v ? `（${v.note}）` : ''}${max > STRICT_RATIO * 100 ? ' → 严格阈值下必然假失败' : ''}`);
  }
  const md = lines.join('\n') + '\n';
  fs.writeFileSync(path.join(OUT_DIR, `probe-${stamp}.md`), md, 'utf-8');
  console.log(md);
  console.log(`产物: ${path.relative(root, path.join(OUT_DIR, `probe-${stamp}.md`))} / probe-${stamp}.json`);
}

main().catch((err) => { console.error('probe 异常: ' + (err && err.stack ? err.stack : err)); process.exit(1); });
