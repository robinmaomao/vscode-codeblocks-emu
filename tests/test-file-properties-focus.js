// 批次一 M3 回归：文件节点「属性」直达工程属性面板的文件 tab 并定位该行
//  - ProjectPropertiesPanel.show 支持 (initialTab, focusFile)
//  - 注入的 focusFile 会写入脚本状态，并在 switchTab 之前选中 + 滚入可视区
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dist = fs.readFileSync(path.resolve(__dirname, '../dist/ui/projectPropertiesPanel.js'), 'utf-8');

// ---- 1. 面板 API ----
check('show 支持 focusFile 参数（构造 → show → 实例字段）',
  /static show\(project, extensionUri, onSave, initialTab, focusFile\)/.test(dist)
  && /this\.focusFile = focusFile;/.test(dist), 'focusFile 参数', '存在');
check('focusFile 注入模板变量 ${focusFileJs}',
  /const focusFileJs = JSON\.stringify\(this\.focusFile \?\? null\)/.test(dist) && /let focusFile = \$\{focusFileJs\};/.test(dist),
  'focusFileJs', '存在');

// ---- 2. 注入行为（提取模板并插值） ----
const startMarker = 'return `';
const s = dist.indexOf(startMarker);
const tplStart = s + startMarker.length;
const tplEnd = dist.indexOf('`;', tplStart);
const tpl = dist.slice(tplStart, tplEnd);

const render = (focusFile) => tpl
  .replace('${focusFileJs}', JSON.stringify(focusFile))
  .replace('${initialTabJs}', JSON.stringify(focusFile ? 'files' : 'targets'));

const withFile = render('src/main.c');
check('携带文件时脚本含定位块（选中 + scrollIntoView + files tab）',
  /let focusFile = "src\/main\.c";/.test(withFile)
  && /selectedFile = fi;/.test(withFile)
  && /scrollIntoView\(\{ block: 'center' \}\)/.test(withFile)
  && /switchTab\('files'\)/.test(withFile),
  'locate-block', '存在');
const withoutFile = render(null);
check('未携带文件时 focusFile = null（不执行定位）',
  /let focusFile = null;/.test(withoutFile) && withFile !== withoutFile, 'null', 'null');

// ---- 3. 定位顺序：先选中渲染，再切 tab（switchTab 内会再 renderFileForm） ----
const focusAt = withFile.indexOf("if (focusFile) {");
const switchAt = withFile.indexOf('switchTab(activeTab);');
check('定位块位于初始 switchTab 之前', focusAt > 0 && switchAt > focusAt, { focusAt, switchAt }, 'focus < switch');

// ---- 4. extension.ts 命令接线（dist 冒烟：命令注册 + focusFile 传递） ----
const extDist = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf-8');
check('codeblocks.fileProperties 命令注册且传 files + relativeFilename',
  /codeblocks\.fileProperties/.test(extDist) && /showProjectPropertiesPanel\(project, context\.extensionUri, 'files', file\.relativeFilename\)/.test(extDist),
  'wiring', '存在');
check('P1/P2 命令注册（findFile / addFilesRecursively）',
  /codeblocks\.findFile/.test(extDist) && /codeblocks\.addFilesRecursively/.test(extDist), 'commands', '存在');
check('P1 读取 ui.findFileOpen（默认 false，对齐 CB /find_file_open）',
  /get\('ui\.findFileOpen', false\)/.test(extDist), 'setting-read', '存在');

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const cmd = (id) => (pkg.contributes.commands || []).find((c) => c.command === id);
check('命令贡献：含 title/icon',
  cmd('codeblocks.findFile')?.title === 'Find File...' && cmd('codeblocks.addFilesRecursively')?.title === 'Add Files Recursively...'
  && cmd('codeblocks.fileProperties')?.title === 'Properties...',
  [cmd('codeblocks.findFile'), cmd('codeblocks.addFilesRecursively'), cmd('codeblocks.fileProperties')], 'ok');
const setting = (pkg.contributes.configuration || []).flatMap((b) => Object.entries(b.properties || {}))
  .find(([k]) => k === 'codeblocks.ui.findFileOpen');
check('设置 codeblocks.ui.findFileOpen 默认 false',
  setting && setting[1].type === 'boolean' && setting[1].default === false, setting && setting[1], 'false');

console.log(`文件属性直达回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
