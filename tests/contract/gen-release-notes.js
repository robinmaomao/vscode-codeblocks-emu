// GitHub Release 页面正文的生成与格式守卫（对齐 0.8.127–0.8.131 的发布页格式）。
//
// 目录约定：
//   docs/release/pages/<tag>.md   —— 发布页正文（提交入库，链接一律绝对 URL）
//   docs/release/<ver>.md         —— 里程碑发布说明（面向仓库读者，相对链接）
//
// 用法：
//   node tests/contract/gen-release-notes.js --check          # 校验全部发布页格式（CI/契约用）
//   node tests/contract/gen-release-notes.js --emit <tag>     # 输出单条正文到 .cb-tools/release-body/<tag>.md
//   node tests/contract/gen-release-notes.js --all            # 批量输出全部正文
//   node tests/contract/gen-release-notes.js --check --stdout # 仅校验并把正文打到 stdout（不落盘）
//
// 发布页格式（与 0.8.127–0.8.131 一致）：
//   # Code::Blocks for VS Code <ver>
//   （空行）
//   > 发布日期：YYYY-MM-DD ｜ 正式版（<上一版> → <ver> 里程碑汇总）
//   （空行）
//   ## 概述  …（要点列表）
//   ## <emoji> 主题分节 …
//   ## ✅ 验证
//   ## ⚠️ 行为变化与升级提示
//   ## 📦 安装（含 codeblocks-vscode-<ver>.vsix）
//   ## 📬 完整变更（里程碑说明 + 提交对比，链接绝对）
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const PAGES_DIR = path.join(ROOT, 'docs', 'release', 'pages');
const OUT_DIR = path.join(ROOT, '.cb-tools', 'release-body');

/** 文件名 → 展示版本（去掉 v 前缀与 -stable 后缀） */
function versionOf(file) {
  const base = path.basename(file, '.md');
  return base.replace(/^v/, '').replace(/-stable$/, '');
}

/** 校验单个发布页；返回违规描述数组（空 = 合规） */
function checkPage(file, text) {
  const name = path.basename(file);
  const ver = versionOf(file);
  const v = [];
  const lines = text.split(/\r?\n/);

  if (!text.endsWith('\n')) v.push('文件末尾缺少换行');
  if (/\r/.test(text)) v.push('含 CRLF（发布页统一 LF）');
  if (/[ \t]+$/m.test(text)) v.push('存在行尾空白');

  // 1) H1
  const h1 = lines[0] || '';
  const wantH1 = `# Code::Blocks for VS Code ${ver}`;
  if (h1.trim() !== wantH1) v.push(`H1 got=${JSON.stringify(h1)} want=${JSON.stringify(wantH1)}`);

  // 2) 发布日期行（H1 之后第一个非空行）
  const dateLine = lines.find((l, i) => i > 0 && l.trim() !== '') || '';
  if (!/^> 发布日期：\d{4}-\d{2}-\d{2}/.test(dateLine.trim())) {
    v.push(`缺少「> 发布日期：YYYY-MM-DD」行（got=${JSON.stringify(dateLine.slice(0, 60))}）`);
  }

  // 3) 必备章节
  const required = ['## 概述', '## ✅ 验证', '## ⚠️ 行为变化与升级提示', '## 📦 安装', '## 📬 完整变更'];
  for (const sec of required) {
    if (!lines.some((l) => l.trim() === sec)) v.push(`缺少章节 ${sec}`);
  }

  // 4) 安装章节含本版 VSIX 名
  const vsix = `codeblocks-vscode-${ver}.vsix`;
  if (!text.includes(vsix)) v.push(`正文未出现附件名 ${vsix}`);

  // 5) 链接必须绝对（相对链接在 GitHub Release 页面会 404）
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    v.push(`相对链接不可用于 Release 页面：${target}`);
  }

  // 6) 章节顺序（概述 → 验证 → 行为变化 → 安装 → 完整变更，中间允许主题分节）
  const order = ['## 概述', '## ✅ 验证', '## ⚠️ 行为变化与升级提示', '## 📦 安装', '## 📬 完整变更'];
  const idx = order.map((s) => lines.findIndex((l) => l.trim() === s));
  for (let i = 1; i < idx.length; i++) {
    if (idx[i - 1] >= 0 && idx[i] >= 0 && idx[i] < idx[i - 1]) {
      v.push(`章节顺序错误：${order[i]} 出现在 ${order[i - 1]} 之前`);
    }
  }

  // 7) 文件名必须是 tag 形态
  if (!/^(v?\d+\.\d+\.\d+(-stable)?)\.md$/.test(name)) v.push(`文件名不是 tag 形态：${name}`);

  return v;
}

function loadPages() {
  if (!fs.existsSync(PAGES_DIR)) return [];
  return fs.readdirSync(PAGES_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ file: path.join(PAGES_DIR, f), tag: path.basename(f, '.md'), text: fs.readFileSync(path.join(PAGES_DIR, f), 'utf8') }));
}

function emit(pages, only) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const out = [];
  for (const p of pages) {
    if (only && p.tag !== only) continue;
    const file = path.join(OUT_DIR, `${p.tag}.md`);
    fs.writeFileSync(file, p.text, 'utf8');
    out.push(file);
  }
  return out;
}

function main(argv) {
  const pages = loadPages();
  if (!pages.length) {
    console.error(`未找到发布页：${path.relative(ROOT, PAGES_DIR)}/`);
    process.exit(2);
  }

  const emitIdx = argv.indexOf('--emit');
  const only = emitIdx >= 0 ? argv[emitIdx + 1] : undefined;
  const all = argv.includes('--all');
  const check = argv.includes('--check');

  if (all || only) {
    if (only && !pages.some((p) => p.tag === only)) {
      console.error(`发布页不存在：${only}（可选：${pages.map((p) => p.tag).join(' / ')}）`);
      process.exit(2);
    }
    for (const f of emit(pages, only)) console.log(`emitted ${path.relative(ROOT, f)}`);
    if (!check) return;
  }

  let fail = 0;
  for (const p of pages) {
    const v = checkPage(p.file, p.text);
    if (!v.length) {
      console.log(`OK   ${p.tag}`);
    } else {
      fail++;
      console.log(`FAIL ${p.tag}`);
      for (const item of v) console.log(`     · ${item}`);
    }
  }
  console.log(`\n发布页格式：${pages.length - fail} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main(process.argv.slice(2));
