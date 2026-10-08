// R4 编译缓存（ccache/sccache）纯模块回归：
//  - 设置值规范化 / 名称候选 / 常见目录 / 路径解析（显式路径 → PATH → 常见目录）
//  - 会话级解析缓存（未命中缓存 + 主动失效）
//  - 提示矩阵（四态 × 标记 × manual 绕过）
//  - 版本号提取 / 安装引导项（winget 可用性分支）
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeCompilerCacheKind,
  exeNameCandidates,
  commonInstallDirs,
  findToolInDir,
  resolveCompilerCachePath,
  resolveCompilerCachePathCached,
  clearCompilerCacheResolveCache,
  decideCompilerCachePrompt,
  parseToolVersion,
  buildInstallGuideItems,
  COMPILER_CACHE_INSTALL,
} = require('../dist/build/compilerCache.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- 1. 规范化 ----
check('normalize：合法值/大小写/空白', normalizeCompilerCacheKind(' ccache ') === 'ccache' && normalizeCompilerCacheKind('SCCACHE') === 'sccache', null);
check('normalize：none 与未知值回退 none', normalizeCompilerCacheKind('none') === 'none' && normalizeCompilerCacheKind('ccache2') === 'none' && normalizeCompilerCacheKind(undefined) === 'none' && normalizeCompilerCacheKind(123) === 'none', null);

// ---- 2. 名称候选 / 常见目录 ----
check('exeNameCandidates win32 含 .exe/.cmd/.bat', JSON.stringify(exeNameCandidates('ccache', 'win32')) === JSON.stringify(['ccache', 'ccache.exe', 'ccache.cmd', 'ccache.bat']), exeNameCandidates('ccache', 'win32'));
check('exeNameCandidates linux 仅原名', JSON.stringify(exeNameCandidates('ccache', 'linux')) === JSON.stringify(['ccache']), exeNameCandidates('ccache', 'linux'));
const dirs = commonInstallDirs({ LOCALAPPDATA: 'C:\\LA', USERPROFILE: 'C:\\U', ProgramData: 'C:\\PD', ProgramFiles: 'C:\\PF' }, 'win32');
check('commonInstallDirs 覆盖 WinGet/Scoop/cargo/Chocolatey/ProgramFiles', dirs.length === 7 && dirs[0].includes('WinGet') && dirs[1].includes('scoop') && dirs[2] === path.join('C:\\U', '.cargo', 'bin') && dirs[3].includes('chocolatey') && dirs[4] === path.join('C:\\PF', 'ccache') && dirs[5] === path.join('C:\\PF', 'sccache') && dirs[6] === path.join('C:\\PF', 'WinGet', 'Links'), dirs);
check('commonInstallDirs 非 win32 为空', commonInstallDirs({ LOCALAPPDATA: '/x' }, 'linux').length === 0, null);

// ---- 3. 路径解析（临时目录构造） ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ccdet-'));
const wrapper = path.join(tmp, 'explicit', 'my-ccache.exe');
fs.mkdirSync(path.dirname(wrapper), { recursive: true });
fs.writeFileSync(wrapper, 'x');
check('显式路径命中 → 解析为该路径', resolveCompilerCachePath('ccache', wrapper, 'win32', {}) === path.resolve(wrapper), resolveCompilerCachePath('ccache', wrapper, 'win32', {}));
const missing = path.join(tmp, 'nope', 'ccache.exe');
check('显式路径无效 → undefined（不静默回退 PATH）', resolveCompilerCachePath('ccache', missing, 'win32', { PATH: path.dirname(wrapper) }) === undefined, null);
check('显式路径生效时普通文件也可作 wrapper（不校验内容）', resolveCompilerCachePath('sccache', wrapper, 'win32', {}) === path.resolve(wrapper), null);
check('kind=none 恒 undefined', resolveCompilerCachePath('none', wrapper, 'win32', {}) === undefined, null);

const pathDir = path.join(tmp, 'onpath');
fs.mkdirSync(pathDir, { recursive: true });
fs.writeFileSync(path.join(pathDir, 'ccache.cmd'), '@echo off');
check('PATH 扫描命中 .cmd 变体', resolveCompilerCachePath('ccache', '', 'win32', { PATH: pathDir }) === path.resolve(path.join(pathDir, 'ccache.cmd')), null);
check('PATH 未命中其他工具 → undefined', resolveCompilerCachePath('sccache', '', 'win32', { PATH: pathDir }) === undefined, null);

const commonRoot = path.join(tmp, 'env');
const wingetLinks = path.join(commonRoot, 'Microsoft', 'WinGet', 'Links');
fs.mkdirSync(wingetLinks, { recursive: true });
fs.writeFileSync(path.join(wingetLinks, 'ccache.exe'), 'x');
check('PATH 未命中 → 常见目录兜底（WinGet Links）', resolveCompilerCachePath('ccache', '', 'win32', { PATH: '', LOCALAPPDATA: commonRoot }) === path.resolve(path.join(wingetLinks, 'ccache.exe')), null);
check('findToolInDir 未命中 → undefined', findToolInDir(pathDir, 'sccache', 'win32') === undefined, null);

// ---- 3b. WinGet Packages 便携布局（新式 winget：Links 为空、包目录直写用户 PATH） ----
const wgRoot = path.join(tmp, 'winget');
const pkgBase = path.join(wgRoot, 'Microsoft', 'WinGet', 'Packages');
const ccPkgDir = path.join(pkgBase, 'Ccache.Ccache_Microsoft.Winget.Source_8wekyb3d8bbwe', 'ccache-4.14.1-windows-x86_64');
fs.mkdirSync(ccPkgDir, { recursive: true });
fs.writeFileSync(path.join(ccPkgDir, 'ccache.exe'), 'x');
const scPkgDir = path.join(pkgBase, 'Mozilla.sccache_Microsoft.Winget.Source_8wekyb3d8bbwe', 'sccache-v0.18.0-x86_64-pc-windows-msvc');
fs.mkdirSync(scPkgDir, { recursive: true });
fs.writeFileSync(path.join(scPkgDir, 'sccache.exe'), 'x');
check('WinGet Packages 兜底：Links 为空时 ccache 命中包内 exe',
  resolveCompilerCachePath('ccache', '', 'win32', { PATH: '', LOCALAPPDATA: wgRoot }) === path.resolve(path.join(ccPkgDir, 'ccache.exe')), null);
check('包名段匹配区分 ccache/sccache（互不误配）',
  resolveCompilerCachePath('sccache', '', 'win32', { PATH: '', LOCALAPPDATA: wgRoot }) === path.resolve(path.join(scPkgDir, 'sccache.exe')), null);
const pfRoot = path.join(tmp, 'pf');
const pfPkgDir = path.join(pfRoot, 'WinGet', 'Packages', 'Ccache.Ccache_Machine_abc', 'ccache');
fs.mkdirSync(pfPkgDir, { recursive: true });
fs.writeFileSync(path.join(pfPkgDir, 'ccache.exe'), 'x');
check('机器作用域 Packages（ProgramFiles\\WinGet\\Packages）同样兜底',
  resolveCompilerCachePath('ccache', '', 'win32', { PATH: '', ProgramFiles: pfRoot }) === path.resolve(path.join(pfPkgDir, 'ccache.exe')), null);

// ---- 4. 会话缓存与失效 ----
const cacheDir = path.join(tmp, 'cache');
fs.mkdirSync(cacheDir, { recursive: true });
const envA = { PATH: cacheDir };
clearCompilerCacheResolveCache();
check('缓存：首次未命中 → undefined', resolveCompilerCachePathCached('ccache', '', 'win32', envA) === undefined, null);
fs.writeFileSync(path.join(cacheDir, 'ccache.exe'), 'x');
check('缓存：文件出现但键未变 → 仍返回缓存值（性能语义）', resolveCompilerCachePathCached('ccache', '', 'win32', envA) === undefined, null);
clearCompilerCacheResolveCache();
check('缓存：主动失效后重探 → 命中', resolveCompilerCachePathCached('ccache', '', 'win32', envA) === path.resolve(path.join(cacheDir, 'ccache.exe')), null);

// ---- 5. 提示矩阵 ----
const noFlags = { notFoundShown: false, enableShown: false, missingShown: false, dontAsk: false };
check('未启用+未检测到 → install-hint', decideCompilerCachePrompt('none', {}, noFlags).kind === 'install-hint', null);
check('未启用+未检测到（已提示过）→ none', decideCompilerCachePrompt('none', {}, { ...noFlags, notFoundShown: true }).kind === 'none', null);
check('未启用+未检测到（不再提示）→ none；manual 绕过', decideCompilerCachePrompt('none', {}, { ...noFlags, dontAsk: true }).kind === 'none'
  && decideCompilerCachePrompt('none', {}, { ...noFlags, dontAsk: true }, true).kind === 'install-hint', null);
const detOne = { ccache: { path: 'C:\\x\\ccache.exe', version: '4.8.3' } };
const detBoth = { ...detOne, sccache: { path: 'C:\\y\\sccache.exe' } };
const enableOne = decideCompilerCachePrompt('none', detOne, noFlags);
check('未启用+检测到 ccache → enable[ccache]', enableOne.kind === 'enable' && JSON.stringify(enableOne.tools) === JSON.stringify(['ccache']), enableOne);
check('未启用+检测到两者 → enable 顺序 ccache,sccache', JSON.stringify(decideCompilerCachePrompt('none', detBoth, noFlags).tools) === JSON.stringify(['ccache', 'sccache']), null);
check('未启用+检测到（已提示过）→ none', decideCompilerCachePrompt('none', detOne, { ...noFlags, enableShown: true }).kind === 'none', null);
check('已启用+已找到 → none', decideCompilerCachePrompt('ccache', detOne, noFlags).kind === 'none', null);
check('已启用+未找到 → missing[ccache]', (() => { const a = decideCompilerCachePrompt('ccache', {}, noFlags); return a.kind === 'missing' && a.tool === 'ccache'; })(), null);
check('已启用 sccache+仅检测到 ccache → missing[sccache]', (() => { const a = decideCompilerCachePrompt('sccache', detOne, noFlags); return a.kind === 'missing' && a.tool === 'sccache'; })(), null);
check('已启用+未找到（已提示过/不再提示）→ none；manual 绕过', decideCompilerCachePrompt('ccache', {}, { ...noFlags, missingShown: true }).kind === 'none'
  && decideCompilerCachePrompt('ccache', {}, { ...noFlags, dontAsk: true }).kind === 'none'
  && decideCompilerCachePrompt('ccache', {}, { ...noFlags, dontAsk: true }, true).kind === 'missing', null);

// ---- 6. 版本号与引导项 ----
check('parseToolVersion：ccache 格式', parseToolVersion('ccache version 4.8.3\nCopyright') === '4.8.3', parseToolVersion('ccache version 4.8.3'));
check('parseToolVersion：sccache 格式 / 空串', parseToolVersion('sccache 0.7.7') === '0.7.7' && parseToolVersion('') === undefined, null);
const itemsAll = buildInstallGuideItems('ccache', true);
check('引导项（winget 可用）：4 项且 redetect 末尾', itemsAll.length === 4 && itemsAll.map((i) => i.action).join(',') === 'winget-copy,winget-run,open-download,redetect', itemsAll.map((i) => i.action));
const itemsNoWinget = buildInstallGuideItems('ccache', false);
check('引导项（winget 不可用）：2 项（下载页+重新检测）', itemsNoWinget.length === 2 && itemsNoWinget.map((i) => i.action).join(',') === 'open-download,redetect', itemsNoWinget.map((i) => i.action));
check('引导项描述含 winget id', itemsAll[0].description.includes('Ccache.Ccache'), itemsAll[0].description);
check('安装信息：winget 命令/下载页/许可', COMPILER_CACHE_INSTALL.ccache.wingetCommand.includes('winget install --id Ccache.Ccache')
  && COMPILER_CACHE_INSTALL.sccache.wingetCommand.includes('winget install --id Mozilla.sccache')
  && COMPILER_CACHE_INSTALL.ccache.downloadUrl.startsWith('https://')
  && COMPILER_CACHE_INSTALL.sccache.downloadUrl.startsWith('https://')
  && COMPILER_CACHE_INSTALL.ccache.license === 'GPL-3.0-or-later'
  && COMPILER_CACHE_INSTALL.sccache.license === 'Apache-2.0', COMPILER_CACHE_INSTALL);

console.log(`编译缓存模块回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
