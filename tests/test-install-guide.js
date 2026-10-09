// R4 引导安装命令与宿主接线回归（extension/package 侧静态断言）：
//  - package.json：命令贡献（id/标题）+ 版本 + 两项设置存在性
//  - dist/extension.js：命令注册、提示矩阵/引导函数接线、globalState 标记键、设置变化监听
//  - 命令标题/设置描述中的 command: 链接目标已贡献（防死链；settings-command-links 另有全量扫描）
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf-8');
const mod = fs.readFileSync(path.resolve(__dirname, '../dist/build/compilerCache.js'), 'utf-8');

// ---- 1. package.json 贡献面 ----
check('版本 0.8.127', pkg.version === '0.8.127', pkg.version);
const cmd = (pkg.contributes.commands || []).find((c) => c.command === 'codeblocks.installCompilerCache');
check('命令 codeblocks.installCompilerCache 已贡献', !!cmd && /Compiler Cache/.test(cmd.title || ''), cmd);
const cfg = pkg.contributes.configuration;
const props = Array.isArray(cfg) ? Object.assign({}, ...cfg.map((b) => b.properties || {})) : (cfg.properties || {});
check('设置 build.compilerCache 存在（machine-overridable）', props['codeblocks.build.compilerCache']?.scope === 'machine-overridable', props['codeblocks.build.compilerCache']?.scope);
check('设置 build.compilerCachePath 存在（machine-overridable）', props['codeblocks.build.compilerCachePath']?.scope === 'machine-overridable', props['codeblocks.build.compilerCachePath']?.scope);
const md = props['codeblocks.build.compilerCache']?.markdownDescription || '';
check('设置描述含安装引导 command: 链接（目标已贡献）', md.includes('(command:codeblocks.installCompilerCache)') && (pkg.contributes.commands || []).some((c) => c.command === 'codeblocks.installCompilerCache'), null);

// ---- 2. dist/extension.js 接线 ----
const needles = [
  ["registerCommand('codeblocks.installCompilerCache')", /registerCommand\('codeblocks\.installCompilerCache'/],
  ['引导函数 installCompilerCacheGuide', /async function installCompilerCacheGuide/],
  ['提示函数 checkCompilerCachePrompt', /async function checkCompilerCachePrompt/],
  ['启动预热调用（setTimeout 4000）', /setTimeout\(\(\) => \{ void checkCompilerCachePrompt\(\); \}, 4000\)/],
  ['设置变化监听 compilerCache', /affectsConfiguration\('codeblocks\.build\.compilerCache'\)/],
  ['设置变化监听 compilerCachePath', /affectsConfiguration\('codeblocks\.build\.compilerCachePath'\)/],
  ['提示标记 missingPrompted', /codeblocks\.compilerCache\.missingPrompted/],
  ['提示标记 notFoundPrompted', /codeblocks\.compilerCache\.notFoundPrompted/],
  ['提示标记 dontAsk', /codeblocks\.compilerCache\.dontAsk/],
  ['解析缓存失效调用', /clearCompilerCacheResolveCache/],
  ['winget 可用性探测', /async function hasWinget/],
  ['启用提示按作用域写入（inspect）', /inspect\('build\.compilerCache'\)/],
  ['检测结果输出（版本+路径）', /\[Code::Blocks\] 编译缓存: 检测到/],
  ['启用询问含「不再提示」按钮', /\.\.\.labels, '不再提示'/],
];
for (const [name, re] of needles) check('extension：' + name, re.test(ext), null);
check('extension：安装提示按钮（如何安装/重新指定路径）', ext.includes('如何安装') && ext.includes('重新指定路径'), null);

// ---- 3. dist/build/compilerCache.js 数据 ----
check('模块：winget id 齐备', mod.includes('Ccache.Ccache') && mod.includes('Mozilla.sccache'), null);
check('模块：下载页 URL 齐备', mod.includes('ccache.dev/download.html') && mod.includes('github.com/mozilla/sccache/releases'), null);
check('模块：告警与提示矩阵函数存在', mod.includes('decideCompilerCachePrompt') && mod.includes('resolveCompilerCachePathCached'), null);

console.log(`引导安装命令与宿主接线回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
