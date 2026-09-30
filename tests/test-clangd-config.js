// clangd 用户配置回归（跨界 typedef 冲突修复）：
//  - Diagnostics.Suppress 默认含 -Wunused-function 与 redefinition_different_typedef（SDK 头 vs 工具链系统头误报）
//  - 头文件子片段（Suppress:'*' + --target/-include/-isystem 回退）结构正确
//  - 幂等；保留用户自有内容；空作用域清理不留悬空 ---
//  - 设置默认值（package.json）与 extension 接线（dist）静态断言
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => d }) },
      window: { showInformationMessage: () => {}, showWarningMessage: () => {}, showErrorMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      commands: { executeCommand: async () => {} },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');

// clangdUserConfigPath()：win 用 LOCALAPPDATA，其它用 XDG_CONFIG_HOME —— 都指到临时目录，避免动真实用户配置
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-clangd-'));
process.env.LOCALAPPDATA = path.join(tmp, 'LocalAppData');
process.env.XDG_CONFIG_HOME = path.join(tmp, 'config');

const { updateClangdUserConfig, clangdUserConfigPath } = require('../dist/tools/clangd.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

const cfgPath = clangdUserConfigPath();
check('配置路径落在临时目录（不触碰真实用户配置）', cfgPath.startsWith(tmp), cfgPath);

// 预置用户自有内容
fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
fs.writeFileSync(cfgPath, '# user own\nDiagnostics:\n  UnusedIncludes: Strict\n', 'utf-8');

const projDir = path.join(tmp, 'proj');
const dbDir = path.join(tmp, 'cache', 'obj');
fs.mkdirSync(projDir, { recursive: true });
fs.mkdirSync(dbDir, { recursive: true });

const scope = {
  dir: projDir,
  databaseDir: dbDir,
  headerFlags: ['--target=riscv32-elf', '-I', 'X:/inc', '-include', 'global.h', '-isystem', 'X:/sys', '-ferror-limit=0'],
  suppressedWarnings: ['-Wunused-function', 'redefinition_different_typedef'],
  suppressHeaderDiagnostics: true,
};

updateClangdUserConfig([scope]);
const text = fs.readFileSync(cfgPath, 'utf-8');
const dbUnix = dbDir.replace(/\\/g, '/');

check('保留用户自有内容', text.includes('# user own'));
check('片段含 CompilationDatabase', text.includes(`CompilationDatabase: '${dbUnix}'`), null);
check('Suppress 列表含 -Wunused-function', text.includes('    - -Wunused-function'), null);
check('Suppress 列表含 redefinition_different_typedef', text.includes('    - redefinition_different_typedef'), null);
check('头文件子片段 Suppress:*', text.includes("  Suppress: '*'"), null);
check('头文件子片段含 --target 回退', text.includes('- --target=riscv32-elf'), null);
check('头文件子片段含 -include 基础头', text.includes('- -include'), null);
check('头文件子片段含 -isystem', text.includes('- -isystem'), null);
check('片段标记成对', text.includes('codeblocks-vscode') && /begin <<<[\s\S]*end <<</.test(text), null);

// 幂等：相同入参重复调用内容不变
updateClangdUserConfig([scope]);
const text2 = fs.readFileSync(cfgPath, 'utf-8');
check('重复调用幂等（内容不变）', text2 === text, null);

// 同作用域重写（生成参数变化时旧片段被替换，不重复堆积；配合 hash 标记的多工作区共存设计）
updateClangdUserConfig([{ ...scope, suppressedWarnings: [], suppressHeaderDiagnostics: false }]);
const text3 = fs.readFileSync(cfgPath, 'utf-8');
const beginCount = (text3.match(/codeblocks-vscode [0-9a-f]+ begin/g) || []).length;
check('同作用域重写后仅一个片段标记', beginCount === 1, beginCount);
check('Suppress 清空后不再输出旧压制项', !text3.includes('- -Wunused-function'), null);
check('suppressHeaderDiagnostics=false 时移除 Suppress:*', !text3.includes("  Suppress: '*'"), null);
check('重写后仍保留用户内容', text3.includes('# user own'), null);

// 空作用域调用（健壮性）：不报错、保留用户内容、不留悬空 ---
updateClangdUserConfig([]);
const text4 = fs.readFileSync(cfgPath, 'utf-8');
check('空作用域调用健壮（保留用户内容、无悬空 ---）', text4.includes('# user own') && !/---\s*$/.test(text4), JSON.stringify(text4).slice(0, 120));

// 设置默认值 / 接线
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8'));
let def;
for (const block of pkg.contributes.configuration) {
  const prop = block.properties && block.properties['codeblocks.clangd.suppressedWarnings'];
  if (prop) def = prop.default;
}
check('package.json 默认含 redefinition_different_typedef',
  Array.isArray(def) && def.includes('redefinition_different_typedef') && def.includes('-Wunused-function'), def);

const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf-8');
check('extension 默认数组已接线（dist 含 redefinition_different_typedef）', ext.includes('redefinition_different_typedef'), null);

console.log(`clangd 配置回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
