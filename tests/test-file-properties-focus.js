// 批次一 M3 回归：文件节点「属性」直达工程属性面板并定位该行
//  - ProjectPropertiesPanel.show 支持 (initialTab, focusFile)（第 6 个参数为 Build options 运行时，可选）
//  - 注入的 focusFile 会写入脚本状态，选中该行 → 打开文件属性模态 → 滚入可视区 → 再切初始 tab
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
  /static show\(project, extensionUri, onSave, initialTab, focusFile(?:, \w+)?\)/.test(dist)
  && /this\.focusFile = focusFile;/.test(dist), 'focusFile 参数', '存在');
check('focusFile 以 JSON 注入模板（缺省为 null）',
  /const focusFileJs = JSON\.stringify\(this\.focusFile \?\? null\)/.test(dist)
  && /let focusFile = \$\{focusFileJs\};/.test(dist), 'focusFileJs', '存在');

// ---- 2. 注入行为：定位块（选中 → 打开文件属性模态） ----
const focusAt = dist.indexOf('if (focusFile) {');
const focusBlock = focusAt >= 0 ? dist.slice(focusAt, dist.indexOf('switchTab(activeTab);', focusAt)) : '';
check('携带文件时定位块选中该行并打开文件属性模态',
  focusBlock.includes('files.findIndex(f => f.relativeFilename === focusFile)')
  && focusBlock.includes('selectedFile = fi;')
  && focusBlock.includes('openFileModal(fi);'),
  focusBlock || '无定位块', 'selectedFile + openFileModal');
const modalAt = dist.indexOf('function openFileModal(index) {');
const modalBlock = modalAt >= 0 ? dist.slice(modalAt, dist.indexOf('\n    }', modalAt)) : '';
check('打开模态：快照 + 回到 General 页 + 渲染标题/表单',
  modalBlock.includes('fileSnapshot = JSON.stringify(files[selectedFile])')
  && modalBlock.includes("fileTab = 'general'")
  && modalBlock.includes('renderFileTabs(); renderFileForm();')
  && modalBlock.indexOf("style.display = 'flex'") > modalBlock.indexOf('renderFileForm()'),
  modalBlock || '无 openFileModal', '快照 + General');

// ---- 3. 定位顺序：先选中渲染，再切 tab（switchTab 内会再 renderFileForm） ----
const switchAt = dist.indexOf('switchTab(activeTab);');
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
const { cmdTitle, setLanguage } = require('./_harness/nls');
// 本文件的原断言为英文标题（package.nls.json 是默认语言）——显式按英文解析
setLanguage('en');
const cmd = (id) => (pkg.contributes.commands || []).find((c) => c.command === id);
check('命令贡献：含 title/icon',
  cmdTitle('codeblocks.findFile') === 'Find File...' && cmdTitle('codeblocks.addFilesRecursively') === 'Add Files Recursively...'
  && cmdTitle('codeblocks.fileProperties') === 'Properties...',
  [cmd('codeblocks.findFile'), cmd('codeblocks.addFilesRecursively'), cmd('codeblocks.fileProperties')], 'ok');
const setting = (pkg.contributes.configuration || []).flatMap((b) => Object.entries(b.properties || {}))
  .find(([k]) => k === 'codeblocks.ui.findFileOpen');
check('设置 codeblocks.ui.findFileOpen 默认 false',
  setting && setting[1].type === 'boolean' && setting[1].default === false, setting && setting[1], 'false');

console.log(`文件属性直达回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
