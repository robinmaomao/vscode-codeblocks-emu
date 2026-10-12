// 视觉基线「渲染环境指纹」：决定同一渲染环境（严格判定）还是跨环境（容差判定）。
//
// 为什么需要：`tests/visual/baselines/**` 是本机 Edge 渲染产物——字体栅格化（DirectWrite/ClearType）、
// 字体可用集、Edge/Chromium 主版本、DPI 缩放都会改变像素。换机器上跑像素级对比会假失败，
// 因此把「渲染环境」显式指纹化：同指纹 → 严格判定（不放宽）；不同指纹 → 明确提示并降级为容差判定，
// 且绝不静默放宽（每条结果都标注判定口径）。
//
// 指纹组成（5 项，任一不同即视为跨环境）：
//   os      = `${process.platform}-${process.arch}`（如 win32-x64）
//   channel = 浏览器通道（msedge / chromium / CB_VISUAL_BROWSER 指定值）
//   browserMajor = 浏览器主版本（如 121）
//   scale   = 强制设备缩放因子（--force-device-scale-factor，默认 1）
//   font    = 文本度量探针哈希（面板字体栈 + 等宽字体栈渲染同串文本的宽度）——
//             用于识别「同 OS/同 Edge 版本但缺字体」的机器（字体集不同 → 文本排版不同）
//
// 可用环境变量覆盖（自测/跨机验证用，会写进指纹与提示，不会伪装成同指纹）：
//   CB_VISUAL_BROWSER       浏览器通道（默认 msedge）
//   CB_VISUAL_DSF           设备缩放因子（默认 1）
//   CB_VISUAL_FP_OS         覆盖 os 段（模拟另一 OS，如 linux-x64）
//   CB_VISUAL_FP_BROWSER_MAJOR  覆盖浏览器主版本（模拟 Edge 版本不同，如 999）
//   CB_VISUAL_FP_FONT       覆盖文本度量哈希（模拟目标机字体集不同，如 deadbeef）
//   CB_VISUAL_BASELINE_DIR  覆盖「入库基线」目录（探针/篡改测试用）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..', '..');
const CANONICAL_DIR = path.join(__dirname, 'baselines');
const CANONICAL_FINGERPRINT_FILE = path.join(CANONICAL_DIR, '.fingerprint.json');
const SCHEMA = 'cb-visual-fingerprint/1';

function osKey() {
  return process.env.CB_VISUAL_FP_OS || `${process.platform}-${process.arch}`;
}

/** 指纹 id：可读 + 可作目录名（跨平台安全：只含 [a-z0-9.-]） */
function fingerprintId({ os, channel, browserMajor, scale }) {
  return `${os}_${channel}-${browserMajor}_dsf${scale}`;
}

function currentFingerprint({ channel, browserVersion, scale, font }) {
  const os = osKey();
  const major = process.env.CB_VISUAL_FP_BROWSER_MAJOR
    || String(browserVersion || 'unknown').split('.')[0]
    || 'unknown';
  const parts = { os, channel: channel || 'unknown', browserMajor: String(major), scale: Number(scale) || 1, font: process.env.CB_VISUAL_FP_FONT || font || 'unknown' };
  return {
    schema: SCHEMA,
    ...parts,
    browserVersion: browserVersion || null,
    id: fingerprintId(parts),
    label: `${parts.os} / ${parts.channel} ${parts.browserMajor} / dsf=${parts.scale} / font=${parts.font}`,
  };
}

/** 只比较判定维度；版本补丁号、时间戳等不参与。font 仅在双方都有值时参与（兼容旧元数据） */
function matches(a, b) {
  if (!a || !b) return false;
  const base = String(a.os) === String(b.os)
    && String(a.channel) === String(b.channel)
    && String(a.browserMajor) === String(b.browserMajor)
    && Number(a.scale) === Number(b.scale);
  if (!base) return false;
  if (a.font && b.font && a.font !== 'unknown' && b.font !== 'unknown') return String(a.font) === String(b.font);
  return true;
}

const FONT_PROBE_HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body { margin: 0; }
  .probe { position: absolute; white-space: pre; }
</style></head><body>
  <span class="probe" style="font-family: 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif; font-size: 13px;">Hamburgefonstiv 汉字宽窄 Ww0123456789iiii</span>
  <span class="probe" style="font-family: Consolas, 'Courier New', monospace; font-size: 12px;">const x = 'AB챙한漢字한글'; // 0123456789</span>
</body></html>`;

/**
 * 文本度量探针：同一字体栈 + 同一字符串 → 宽度由「实际命中的字体」决定。
 * 缺字体（回退到别的字体）或栅格化差异会改变宽度 → 参与指纹。
 * @returns {Promise<string>} 8 位哈希（宽度取 0.01px 精度）
 */
async function probeFontMetrics(page) {
  await page.setContent(FONT_PROBE_HTML, { waitUntil: 'load' });
  const widths = await page.evaluate(async () => {
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch { /* ignore */ } }
    return Array.from(document.querySelectorAll('.probe')).map((el) => {
      const r = el.getBoundingClientRect();
      return `${r.width.toFixed(2)}x${r.height.toFixed(2)}`;
    });
  });
  return crypto.createHash('sha1').update(widths.join('|')).digest('hex').slice(0, 8);
}

/** 读取入库基线的指纹元数据（不存在/损坏 → null，由调用方提示并保持严格判定） */
function loadCanonical(file = CANONICAL_FINGERPRINT_FILE) {
  try {
    if (!fs.existsSync(file)) return null;
    const rec = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return rec && rec.fingerprint ? rec : null;
  } catch { return null; }
}

function saveCanonical(fp, extra = {}, file = CANONICAL_FINGERPRINT_FILE) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    schema: SCHEMA,
    fingerprint: { os: fp.os, channel: fp.channel, browserMajor: fp.browserMajor, browserVersion: fp.browserVersion, scale: fp.scale, font: fp.font, id: fp.id, label: fp.label },
    capturedAt: new Date().toISOString(),
    ...extra,
  }, null, 2) + '\n', 'utf-8');
}

/** 本机指纹基线目录（不入库，生成后本机即严格判定） */
function localBaselineDir(fpId) {
  return path.join(root, '.cb-tools', 'visual', fpId);
}

/** 基线目录搜索顺序：显式覆盖 > 本机指纹目录（严格）> 入库基线（同指纹严格 / 跨指纹容差） */
function baselineDirs({ fp, canonicalMatch, canonicalDir = CANONICAL_DIR, envDir = process.env.CB_VISUAL_BASELINE_DIR }) {
  const dirs = [];
  if (envDir) dirs.push({ dir: path.resolve(root, envDir), kind: 'env', strict: canonicalMatch !== false });
  dirs.push({ dir: localBaselineDir(fp.id), kind: 'local', strict: true });
  dirs.push({ dir: canonicalDir, kind: 'canonical', strict: canonicalMatch !== false });
  return dirs;
}

module.exports = {
  SCHEMA,
  CANONICAL_DIR,
  CANONICAL_FINGERPRINT_FILE,
  FONT_PROBE_HTML,
  osKey,
  currentFingerprint,
  fingerprintId,
  matches,
  probeFontMetrics,
  loadCanonical,
  saveCanonical,
  localBaselineDir,
  baselineDirs,
};
