// 构建产物排除项回归（src/build/watcherExclude.ts）：
//  - 从工程配置推导对象目录 / 输出目录；
//  - 生成 watcher/search 需要的 glob（相对 → **/dir/**，绝对 → /abs/dir/**）；
//  - 合并时保留用户已有条目、只补缺失项（幂等）。
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const { collectOutputDirs, excludeGlobsFor, mergeExcludePatterns } = require('../dist/build/watcherExclude.js');
const { ProjectParser } = require('../dist/model/parser.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-excl-'));
const cbp = path.join(dir, 'app.cbp');
fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="app" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="Output/bin/app.rv32" prefix_auto="0" extension_auto="0" />
\t\t\t\t<Option object_output="Output/obj/" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
const project = new ProjectParser().parse(cbp);

// ---------- A. 目录推导 ----------
const dirs = collectOutputDirs([project]);
check('A1 推导出对象目录与输出目录', dirs.includes('Output/obj') && dirs.includes('Output/bin'), dirs);
check('A2 未出现工程根/上级目录', !dirs.includes('.') && dirs.every((d) => !d.startsWith('..')), dirs);
check('A3 去重（对象目录与输出目录不同层时各自保留）', new Set(dirs).size === dirs.length, dirs);
check('A4 尾斜杠被规范化掉', dirs.every((d) => !d.endsWith('/')), dirs);
check('A5 默认依赖目录 .deps 也被排除', dirs.includes('.deps'), dirs);

// 未配置 object_output 的工程：Code::Blocks 默认写 `.objs`，必须排除（否则每个 .o 都触发监视器）
{
  const cbpNoObj = path.join(dir, 'no-obj.cbp');
  fs.writeFileSync(cbpNoObj, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="no-obj" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/app" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  const pNoObj = new ProjectParser().parse(cbpNoObj);
  const dNoObj = collectOutputDirs([pNoObj]);
  check('A6 空 object_output → 补默认 .objs', dNoObj.includes('.objs'), dNoObj);
  check('A7 空 object_output 时仍保留输出目录', dNoObj.includes('bin/Debug'), dNoObj);
}

// 自定义 deps_output / 宏路径
{
  const cbp2 = path.join(dir, 'custom.cbp');
  fs.writeFileSync(cbp2, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="custom" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="$(PROJECT_DIR)/out/app" />
\t\t\t\t<Option object_output="$(PROJECT_DIR)/tmp/obj/" />
\t\t\t\t<Option deps_output="deps/custom/" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  const p2 = new ProjectParser().parse(cbp2);
  const d2 = collectOutputDirs([p2]).map((d) => d.replace(/\\/g, '/').toLowerCase());
  check('A8 object_output / output 中的 $(PROJECT_DIR) 被展开', d2.some((d) => d.endsWith('/tmp/obj')) && d2.some((d) => d.endsWith('/out')), d2);
  check('A9 自定义 deps_output 被排除', d2.includes('deps/custom'), d2);
  check('A10 宏未展开的占位符不会进入排除项', d2.every((d) => !d.includes('$(')), d2);
}

// ---------- B. glob 生成 ----------
check('B1 相对目录 → **/dir/**', JSON.stringify(excludeGlobsFor('Output/obj')) === JSON.stringify(['**/Output/obj/**']), excludeGlobsFor('Output/obj'));
check('B2 反斜杠被归一化', JSON.stringify(excludeGlobsFor('Output\\obj\\')) === JSON.stringify(['**/Output/obj/**']), excludeGlobsFor('Output\\obj\\'));
check('B3 绝对盘符目录 → /abs/dir/**', JSON.stringify(excludeGlobsFor('D:/sdk/out')) === JSON.stringify(['D:/sdk/out/**']), excludeGlobsFor('D:/sdk/out'));
check('B4 空串不产生 glob', excludeGlobsFor('').length === 0, excludeGlobsFor(''));

// ---------- C. 合并语义 ----------
{
  const existing = { '**/node_modules/**': true, '**/Output/**': false };
  const r = mergeExcludePatterns(existing, ['**/node_modules/**', '**/Output/obj/**']);
  check('C1 已有条目全部保留（含用户手动设为 false 的）', r.value['**/node_modules/**'] === true && r.value['**/Output/**'] === false, r.value);
  check('C2 只追加缺失项', JSON.stringify(r.added) === JSON.stringify(['**/Output/obj/**']), r.added);
  check('C3 新增项值为 true', r.value['**/Output/obj/**'] === true, r.value);
  check('C4 源对象未被修改（纯函数）', existing['**/Output/obj/**'] === undefined, existing);
}
{
  const r = mergeExcludePatterns(undefined, ['**/Output/**']);
  check('C5 无既有配置时新建对象', r.value['**/Output/**'] === true && r.added.length === 1, r);
  const again = mergeExcludePatterns(r.value, ['**/Output/**']);
  check('C6 重复调用幂等（第二次无新增）', again.added.length === 0, again.added);
}
// settings.json 手写损坏：字符串 / 数组等非对象值不得被展开写回（否则会把 {0:'…'} 塞进设置）
{
  const r1 = mergeExcludePatterns('**/keep/**', ['**/Output/**']);
  check('C7 字符串既有值按「无配置」处理（不产生 0/1/2 数字键）',
    JSON.stringify(r1.value) === JSON.stringify({ '**/Output/**': true }), r1.value);
  const r2 = mergeExcludePatterns(['**/keep/**'], ['**/Output/**']);
  check('C8 数组既有值按「无配置」处理', JSON.stringify(r2.value) === JSON.stringify({ '**/Output/**': true }), r2.value);
  const r3 = mergeExcludePatterns(null, ['**/Output/**']);
  check('C9 null 按「无配置」处理', JSON.stringify(r3.value) === JSON.stringify({ '**/Output/**': true }), r3.value);
}

// ---------- D. 无工程配置时的兜底 ----------
{
  const empty = { basePath: dir, buildTargets: [] };
  const fallback = collectOutputDirs([empty]);
  check('D1 无目标 → 兜底 Output/obj/bin/.objs/.deps',
    JSON.stringify(fallback) === JSON.stringify(['Output', 'obj', 'bin', '.objs', '.deps']), fallback);
}

// ---------- E. 命令接线（`codeblocks.excludeBuildOutputs` 一键写入排除项） ----------
{
  const extJs = fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension.js'), 'utf8');
  check('E1 命令 codeblocks.excludeBuildOutputs 已注册', extJs.includes('codeblocks.excludeBuildOutputs'), null);
  check('E2 接线到 mergeExcludePatterns / collectOutputDirs', extJs.includes('mergeExcludePatterns') && extJs.includes('collectOutputDirs'), null);
  check('E3 同时写 files.watcherExclude 与 search.exclude',
    extJs.includes('files.watcherExclude') && extJs.includes('search.exclude'), null);
  // 用户明确要求：排除项写入**用户设置**，不得再往工作区 `.vscode/settings.json`（公共区）里写
  check('E3a 排除项写入用户设置（ConfigurationTarget.Global）',
    /applyBuildOutputExcludes[\s\S]{0,2500}ConfigurationTarget\.Global/.test(extJs), null);
  check('E3b 迁移：清理工作区里旧版本写入的同名条目（ConfigurationTarget.Workspace 仅用于删除）',
    /Removed \{0\} build-output exclusion|workspaceValue/.test(extJs), null);
  check('E3c 不再把合并结果整体写回工作区', !/mergeExcludePatterns\(inspectObj\('files\.watcherExclude'\)\)[\s\S]{0,400}ConfigurationTarget\.Workspace/.test(extJs), null);
  // 构建前自动排除（build() 入口调用 autoExcludeBuildOutputs）：否则构建写出的目标文件
  // 会让 VS Code 反复全工作区枚举（实测 rg 峰值 281）
  check('E4 构建入口自动排除产物目录（autoExcludeBuildOutputs）',
    extJs.includes('autoExcludeBuildOutputs') && extJs.includes('build.autoExcludeOutputs'), null);
  check('E5 自动排除受设置开关控制（默认开启可关闭）',
    extJs.includes("get('build.autoExcludeOutputs', true)"), null);
  // 所有会写/删产物的入口都要先排除：Build / Build Workspace / Clean / Clean Workspace /
  // 单工程 Build（右键）/ 单文件编译 / Rebuild All。
  // 清理会批量删除产物，同样触发全工作区枚举；单工程/单文件路径不经过主 Build 命令，最容易漏。
  const calls = (extJs.match(/await autoExcludeBuildOutputs\(\)/g) || []).length;
  check('E6 全部构建/清理入口均调用（build/buildWorkspace/clean/cleanWorkspace/单工程/单文件/Rebuild All）', calls >= 7, calls, '>=7');
  // 打开工程时静默预排除：历史产物目录里的 .o 会在启动扫描/下次构建时触发枚举
  check('E7 打开工程即静默预排除（notify:false 分支）',
    /autoExcludeBuildOutputs\(\{ notify: false \}\)/.test(extJs) && extJs.includes('opts?.notify === false'), null);
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n构建产物排除项回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
