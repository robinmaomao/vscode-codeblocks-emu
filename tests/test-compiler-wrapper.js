// R4 编译缓存命令注入回归（行为 + 静态接线）：
//  - 默认 none：编译命令与基线逐字节一致（零影响）
//  - 启用 + wrapper 存在：前缀注入在 $compiler 展开点（引号/尾随空格），链接命令不注入
//  - noCompilerCache=true（clangd/脚本/自定义命令路径）：不注入
//  - 显式路径无效：静默回退基线命令
//  - buildEngine：已启用未找到 → 每引擎一次告警（输出通道）
const Module = require('module');
const settings = {};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }) },
      window: { showWarningMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      ConfigurationTarget: { Global: 1 },
      LogOutputChannel: class {},
      workspaceState: {},
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ProjectParser } = require('../dist/model/parser.js');
const { BuildEngine } = require('../dist/build/buildEngine.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');
const { CommandGenerator } = require('../dist/compiler/commandGenerator.js');
const { CommandType } = require('../dist/model/types.js');
const { clearCompilerCacheResolveCache } = require('../dist/build/compilerCache.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-ccwrap-'));
const cbpPath = path.join(dir, 'ccwrap.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="ccwrap" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
				<Option object_output="obj/Debug/" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');
fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void){return 0;}\n');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
const target = project.buildTargets[0];
const generator = new CommandGenerator(project, compiler);
const params = {
  target,
  pf: project.files[0],
  file: path.join(dir, 'main.c'),
  object: 'obj/Debug/main.o',
  flatObject: 'obj/Debug/main.o',
  deps: 'obj/Debug/main.d',
};

// ---- 1. 默认 none：零影响 ----
for (const k of Object.keys(settings)) delete settings[k];
clearCompilerCacheResolveCache();
const baseline = generator.generate(CommandType.CompileObjectCmd, params);
check('基线命令非空且不含 ccache/sccache', baseline.length > 0 && !baseline.includes('ccache') && !baseline.includes('sccache'), baseline);
clearCompilerCacheResolveCache();
const baselineAgain = generator.generate(CommandType.CompileObjectCmd, params);
check('默认 none 零影响：重复生成逐字节一致', baselineAgain === baseline, null);

// ---- 2. 启用 + wrapper 存在（路径含空格 → 引号） ----
const wrapDir = path.join(dir, 'cc dir');
fs.mkdirSync(wrapDir, { recursive: true });
const wrapper = path.join(wrapDir, 'fake ccache.cmd');
fs.writeFileSync(wrapper, '@echo off\n');
settings['build.compilerCache'] = 'ccache';
settings['build.compilerCachePath'] = wrapper;
clearCompilerCacheResolveCache();
const withPrefix = generator.generate(CommandType.CompileObjectCmd, params);
const prefix = withPrefix.slice(0, withPrefix.length - baseline.length);
check('启用后：基线命令不变，仅前置 wrapper', withPrefix !== baseline && withPrefix.endsWith(baseline), withPrefix);
check('前缀 = 引号包裹的 wrapper 路径 + 空格', prefix.startsWith('"') && prefix.endsWith('" ') && prefix.includes('fake ccache.cmd'), prefix);
const withPrefix2 = generator.generate(CommandType.CompileObjectCmd, params);
check('解析缓存命中：多次生成同结果', withPrefix2 === withPrefix, null);
const noCacheParam = generator.generate(CommandType.CompileObjectCmd, { ...params, noCompilerCache: true });
check('noCompilerCache=true（clangd/脚本/自定义命令）不注入', noCacheParam === baseline, noCacheParam);
const linkCmd = generator.generate(CommandType.LinkExeCmd, params);
check('链接命令生成成功（前置条件）', linkCmd.length > 0, linkCmd);
check('链接命令不注入缓存前缀（$linker 展开点）', linkCmd.length > 0 && !linkCmd.includes('fake ccache'), linkCmd);

// ---- 3. 显式路径无效 → 静默回退 ----
settings['build.compilerCachePath'] = path.join(dir, 'no-such-dir', 'ccache.exe');
clearCompilerCacheResolveCache();
const fallback = generator.generate(CommandType.CompileObjectCmd, params);
check('wrapper 路径无效 → 回退基线命令（不静默用 PATH）', fallback === baseline, fallback);
settings['build.compilerCache'] = 'sccache';
clearCompilerCacheResolveCache();
check('sccache 同样回退', generator.generate(CommandType.CompileObjectCmd, params) === baseline, null);

// ---- 4. buildEngine 告警（每引擎一次） ----
function makeOut(logs) {
  return { info: (l) => logs.push('i|' + l), warn: (l) => logs.push('w|' + l), error: (l) => logs.push('e|' + l), debug: (l) => logs.push('d|' + l), append() {}, clear() {}, show() {}, hide() {}, dispose() {} };
}
settings['build.compilerCache'] = 'ccache';
settings['build.compilerCachePath'] = path.join(dir, 'no-such-dir', 'ccache.exe');
clearCompilerCacheResolveCache();
const logs1 = [];
const engine1 = new BuildEngine(project, compiler, makeOut(logs1), (id) => compiler);
engine1.warnCompilerCacheMissing();
engine1.warnCompilerCacheMissing();
const warns1 = logs1.filter((l) => l.startsWith('w|'));
check('已启用未找到 → 告警恰好一次', warns1.length === 1 && warns1[0].includes('未找到可执行文件') && warns1[0].includes('回退使用原编译器'), warns1);
const logs1b = [];
const engine1b = new BuildEngine(project, compiler, makeOut(logs1b), (id) => compiler);
engine1b.warnCompilerCacheMissing();
check('跨引擎告警去抖：工作区构建（每项目一引擎）同一配置不重复告警', logs1b.filter((l) => l.startsWith('w|')).length === 0, logs1b);
settings['build.compilerCache'] = 'none';
clearCompilerCacheResolveCache();
const logs2 = [];
const engine2 = new BuildEngine(project, compiler, makeOut(logs2), (id) => compiler);
engine2.warnCompilerCacheMissing();
check('none 时无告警（零影响）', logs2.filter((l) => l.startsWith('w|')).length === 0, logs2);

// 每构建重探：运行中补齐工具（不改设置）→ 下一个构建即为「找到」
settings['build.compilerCache'] = 'ccache';
settings['build.compilerCachePath'] = path.join(dir, 'no-such-dir', 'ccache.exe');
fs.mkdirSync(path.dirname(settings['build.compilerCachePath']), { recursive: true });
fs.writeFileSync(settings['build.compilerCachePath'], 'x');
const realNow = Date.now;
Date.now = () => realNow() + 11_000;
const logs1c = [];
const engine1c = new BuildEngine(project, compiler, makeOut(logs1c), (id) => compiler);
engine1c.warnCompilerCacheMissing();
Date.now = realNow;
check('每构建重探：补齐工具后下一构建无告警（无需重载/重新检测）', logs1c.filter((l) => l.startsWith('w|')).length === 0, logs1c);
check('每构建重探：生成命令立即前置（下一个构建即生效）',
  generator.generate(CommandType.CompileObjectCmd, params) === path.resolve(settings['build.compilerCachePath']) + ' ' + baseline, null);

// ---- 5. 静态接线（dist 源码断言） ----
const beText = fs.readFileSync(path.resolve(__dirname, '../dist/build/buildEngine.js'), 'utf-8');
check('buildEngine：noCompilerCache 四处调用点（clangd/两处脚本/自定义命令）', (beText.match(/noCompilerCache/g) || []).length >= 4, (beText.match(/noCompilerCache/g) || []).length);
check('buildEngine：build() 调用缺失告警', beText.includes('warnCompilerCacheMissing'), null);
const cgText = fs.readFileSync(path.resolve(__dirname, '../dist/compiler/commandGenerator.js'), 'utf-8');
check('commandGenerator：前缀方法 + 两项设置键读取', cgText.includes('compilerCachePrefix') && cgText.includes("'build.compilerCache'") && cgText.includes("'build.compilerCachePath'"), null);

console.log(`编译缓存命令注入回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
