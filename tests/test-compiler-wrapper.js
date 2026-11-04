// R4 编译缓存命令注入回归（行为 + 静态接线）：
//  - 默认 none：编译命令与基线逐字节一致（零影响）
//  - 启用 + wrapper 存在：前缀注入在 $compiler 展开点（引号/尾随空格），链接命令不注入
//  - noCompilerCache=true（clangd/脚本/自定义命令路径）：不注入
//  - 显式路径无效：静默回退基线命令
//  - buildEngine：已启用未找到 → 每引擎一次告警（输出通道）
const Module = require('module');
const settings = {};
const cfgReads = {};
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (k, d) => {
            cfgReads[k] = (cfgReads[k] || 0) + 1;
            return k in settings ? settings[k] : d;
          },
        }),
      },
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
// 新构建 = 新 CommandGenerator 实例（前缀按实例记忆化；设置变更由下一次构建生效）
const generatorCc = new CommandGenerator(project, compiler);
const withPrefix = generatorCc.generate(CommandType.CompileObjectCmd, params);
const prefix = withPrefix.slice(0, withPrefix.length - baseline.length);
check('启用后：基线命令不变，仅前置 wrapper', withPrefix !== baseline && withPrefix.endsWith(baseline), withPrefix);
check('前缀 = 引号包裹的 wrapper 路径 + 空格', prefix.startsWith('"') && prefix.endsWith('" ') && prefix.includes('fake ccache.cmd'), prefix);
const withPrefix2 = generatorCc.generate(CommandType.CompileObjectCmd, params);
check('解析缓存命中：多次生成同结果', withPrefix2 === withPrefix, null);
const noCacheParam = generatorCc.generate(CommandType.CompileObjectCmd, { ...params, noCompilerCache: true });
check('noCompilerCache=true（clangd/脚本/自定义命令）不注入', noCacheParam === baseline, noCacheParam);
const linkCmd = generatorCc.generate(CommandType.LinkExeCmd, params);
check('链接命令生成成功（前置条件）', linkCmd.length > 0, linkCmd);
check('链接命令不注入缓存前缀（$linker 展开点）', linkCmd.length > 0 && !linkCmd.includes('fake ccache'), linkCmd);

// 记忆化：同一实例内只解析一次设置（千文件工程避免每单元 2 次 getConfiguration）
for (const k of Object.keys(cfgReads)) delete cfgReads[k];
const genMemo = new CommandGenerator(project, compiler);
genMemo.generate(CommandType.CompileObjectCmd, params);
genMemo.generate(CommandType.CompileObjectCmd, params);
genMemo.generate(CommandType.CompileObjectCmd, params);
check('记忆化：同一实例 3 次生成只读 1 次 kind / 1 次 path',
  cfgReads['build.compilerCache'] === 1 && cfgReads['build.compilerCachePath'] === 1, cfgReads);

// ---- 3. 显式路径无效 → 静默回退 ----
settings['build.compilerCachePath'] = path.join(dir, 'no-such-dir', 'ccache.exe');
clearCompilerCacheResolveCache();
const fallback = new CommandGenerator(project, compiler).generate(CommandType.CompileObjectCmd, params);
check('wrapper 路径无效 → 回退基线命令（不静默用 PATH）', fallback === baseline, fallback);
settings['build.compilerCache'] = 'sccache';
clearCompilerCacheResolveCache();
check('sccache 同样回退', new CommandGenerator(project, compiler).generate(CommandType.CompileObjectCmd, params) === baseline, null);

// ---- 3.5 ccache + 非 ASCII 工程路径 → 追加 -fno-working-directory ----
// ccache 只接受 UTF-8 预处理输出；`-g` 隐式 -fworking-directory 会把（ANSI/GBK 编码的）
// 绝对 cwd 写进 `# 1 "<cwd>//"`，中文路径因此每次编译都被判 Uncacheable → 缓存永不命中。
const cjkDir = path.join(dir, '中文 工程');
fs.mkdirSync(cjkDir, { recursive: true });
const cjkCbp = path.join(cjkDir, 'ccwrap.cbp');
fs.copyFileSync(cbpPath, cjkCbp);
fs.copyFileSync(path.join(dir, 'main.c'), path.join(cjkDir, 'main.c'));
const cjkProject = new ProjectParser().parse(cjkCbp);
const cjkParams = { ...params, target: cjkProject.buildTargets[0], pf: cjkProject.files[0] };
settings['build.compilerCache'] = 'ccache';
settings['build.compilerCachePath'] = wrapper;
clearCompilerCacheResolveCache();
const cjkCmd = new CommandGenerator(cjkProject, compiler).generate(CommandType.CompileObjectCmd, cjkParams);
check('非 ASCII 工程 + ccache → 追加 -fno-working-directory', cjkCmd.endsWith(' -fno-working-directory'), cjkCmd);
check('非 ASCII 工程 + ccache → 缓存前缀仍在', cjkCmd.includes('fake ccache.cmd'), cjkCmd);
check('非 ASCII 工程 + ccache → 命令其余部分与基线一致',
  cjkCmd.slice(0, cjkCmd.length - (' -fno-working-directory').length).endsWith(baseline), cjkCmd);
clearCompilerCacheResolveCache();
const asciiCmd = new CommandGenerator(project, compiler).generate(CommandType.CompileObjectCmd, params);
check('ASCII 工程 → 不追加该开关（命令与基线逐字节一致）', asciiCmd === withPrefix, asciiCmd);
const cjkLinkCmd = new CommandGenerator(cjkProject, compiler).generate(CommandType.LinkExeCmd, cjkParams);
check('链接命令不追加该开关', !cjkLinkCmd.includes('-fno-working-directory'), cjkLinkCmd);
const cjkNoCacheCmd = new CommandGenerator(cjkProject, compiler).generate(CommandType.CompileObjectCmd, { ...cjkParams, noCompilerCache: true });
check('noCompilerCache（clangd/脚本）不追加该开关', !cjkNoCacheCmd.includes('-fno-working-directory'), cjkNoCacheCmd);
settings['build.compilerCache'] = 'sccache';
clearCompilerCacheResolveCache();
const cjkSccacheCmd = new CommandGenerator(cjkProject, compiler).generate(CommandType.CompileObjectCmd, cjkParams);
check('sccache 无该限制 → 不追加', !cjkSccacheCmd.includes('-fno-working-directory'), cjkSccacheCmd);
const msvcCompiler = {
  ...compiler,
  id: 'msvc10',
  programs: { ...compiler.programs, C: 'cl.exe', CPP: 'cl.exe' },
};
settings['build.compilerCache'] = 'ccache';
clearCompilerCacheResolveCache();
const cjkMsvcCmd = new CommandGenerator(cjkProject, msvcCompiler).generate(CommandType.CompileObjectCmd, cjkParams);
check('MSVC（cl.exe 不认该开关）→ 不追加', !cjkMsvcCmd.includes('-fno-working-directory'), cjkMsvcCmd);
settings['build.compilerCache'] = 'none';
clearCompilerCacheResolveCache();
const cjkNoneCmd = new CommandGenerator(cjkProject, compiler).generate(CommandType.CompileObjectCmd, cjkParams);
check('cache=none → 不追加（零影响）', !cjkNoneCmd.includes('-fno-working-directory'), cjkNoneCmd);

// 源路径：非 ASCII 工程 + ccache → 编译单元改用工程相对路径（绝对路径会把 GBK 字节带进
// `# 1 "<源文件>"`，ccache 因此拒绝缓存；相对路径 + 抑制开关才是全 ASCII）
settings['build.compilerCache'] = 'ccache';
settings['build.compilerCachePath'] = wrapper;
clearCompilerCacheResolveCache();
const cjkUnits = new BuildEngine(cjkProject, compiler, makeOut([]), (id) => compiler).collectMakefileData();
const cjkCompile = cjkUnits[0].compile.find((c) => c.source.endsWith('main.c'));
check('非 ASCII 工程 + ccache → 编译命令用相对源路径',
  cjkCompile && cjkCompile.command.includes(' -c main.c ') && cjkCompile.command.endsWith(' -fno-working-directory'), cjkCompile && cjkCompile.command);
const asciiUnits = new BuildEngine(project, compiler, makeOut([]), (id) => compiler).collectMakefileData();
const asciiCompile = asciiUnits[0].compile.find((c) => c.source.endsWith('main.c'));
check('ASCII 工程 + ccache → 仍用绝对源路径（CB 保真：UseFullSourcePaths）',
  asciiCompile && asciiCompile.command.includes(path.join(dir, 'main.c')) && !asciiCompile.command.includes('-fno-working-directory'),
  asciiCompile && asciiCompile.command);
settings['build.compilerCache'] = 'none';
clearCompilerCacheResolveCache();
const cjkUnitsNone = new BuildEngine(cjkProject, compiler, makeOut([]), (id) => compiler).collectMakefileData();
check('cache=none → 非 ASCII 工程仍用绝对源路径（零影响）',
  cjkUnitsNone[0].compile[0].command.includes(path.join(cjkDir, 'main.c')), cjkUnitsNone[0].compile[0].command);

// 资源文件（windres）不前置缓存程序、也不加抑制开关 → 维持 CB 的绝对路径语义
const resDir = path.join(dir, '中文 资源');
fs.mkdirSync(resDir, { recursive: true });
fs.writeFileSync(path.join(resDir, 'res.rc'), '1 VERSIONINFO\n');
const resCbp = path.join(resDir, 'ccres.cbp');
fs.writeFileSync(resCbp, fs.readFileSync(cbpPath, 'utf-8').replace('main.c', 'res.rc'), 'utf-8');
const resProject = new ProjectParser().parse(resCbp);
settings['build.compilerCache'] = 'ccache';
settings['build.compilerCachePath'] = wrapper;
clearCompilerCacheResolveCache();
const resUnits = new BuildEngine(resProject, compiler, makeOut([]), (id) => compiler).collectMakefileData();
const resCompile = resUnits[0].compile[0];
check('资源文件（windres）不受规避影响：绝对路径 + 无抑制开关',
  resCompile && resCompile.command.includes(path.join(resDir, 'res.rc'))
    && !resCompile.command.includes('-fno-working-directory') && !resCompile.command.includes('fake ccache'),
  resCompile && resCompile.command);

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
  new CommandGenerator(project, compiler).generate(CommandType.CompileObjectCmd, params)
    === path.resolve(settings['build.compilerCachePath']) + ' ' + baseline, null);

// ---- 4.5 buildEngine：非 ASCII 路径说明/告警 ----
settings['build.compilerCache'] = 'ccache';
settings['build.compilerCachePath'] = wrapper;
clearCompilerCacheResolveCache();
const logsCjk = [];
const engineCjk = new BuildEngine(cjkProject, compiler, makeOut(logsCjk), (id) => compiler);
engineCjk.warnCompilerCacheMissing();
engineCjk.warnCompilerCacheMissing();
const infosCjk = logsCjk.filter((l) => l.startsWith('i|'));
check('非 ASCII 工程路径 → info 说明已追加 -fno-working-directory（恰好一次）',
  infosCjk.length === 1 && infosCjk[0].includes('-fno-working-directory'), logsCjk);
const logsCjk2 = [];
const engineCjk2 = new BuildEngine(cjkProject, compiler, makeOut(logsCjk2), (id) => compiler);
engineCjk2.warnCompilerCacheMissing();
check('跨引擎去抖：同一非 ASCII 工程不重复说明', logsCjk2.length === 0, logsCjk2);

// 源文件名非 ASCII（工程根 ASCII）：该开关救不了 → 告警
const srcDir = path.join(dir, 'cjk-src');
fs.mkdirSync(srcDir, { recursive: true });
const srcCbp = path.join(srcDir, 'ccwrap.cbp');
fs.writeFileSync(srcCbp, fs.readFileSync(cbpPath, 'utf-8').replace('main.c', '主程序.c'), 'utf-8');
fs.writeFileSync(path.join(srcDir, '主程序.c'), 'int main(void){return 0;}\n', 'utf-8');
const srcProject = new ProjectParser().parse(srcCbp);
const logsSrc = [];
const engineSrc = new BuildEngine(srcProject, compiler, makeOut(logsSrc), (id) => compiler);
engineSrc.warnCompilerCacheMissing();
check('源文件名非 ASCII → 告警（含文件名 + 出路）',
  logsSrc.some((l) => l.startsWith('w|') && l.includes('主程序.c') && l.includes('ASCII')), logsSrc);
const logsSrcGen = [];
const engineSrcGen = new BuildEngine(srcProject, compiler, makeOut(logsSrcGen), (id) => compiler);
engineSrcGen.warnCompilerCacheMissing();
check('工程根 ASCII → 不追加该开关（源码名问题只能告警）',
  !new CommandGenerator(srcProject, compiler).generate(CommandType.CompileObjectCmd, {
    ...params, target: srcProject.buildTargets[0], pf: srcProject.files[0], file: '主程序.c',
  }).includes('-fno-working-directory'), null);

// sccache：无该限制 → 非 ASCII 路径不产生任何提示
settings['build.compilerCache'] = 'sccache';
clearCompilerCacheResolveCache();
const logsSc = [];
const engineSc = new BuildEngine(cjkProject, compiler, makeOut(logsSc), (id) => compiler);
engineSc.warnCompilerCacheMissing();
check('sccache 非 ASCII 路径 → 无提示（保持原行为）', logsSc.length === 0, logsSc);

// ---- 5. 静态接线（dist 源码断言） ----
const beText = fs.readFileSync(path.resolve(__dirname, '../dist/build/buildEngine.js'), 'utf-8');
check('buildEngine：noCompilerCache 四处调用点（clangd/两处脚本/自定义命令）', (beText.match(/noCompilerCache/g) || []).length >= 4, (beText.match(/noCompilerCache/g) || []).length);
check('buildEngine：build() 调用缺失告警', beText.includes('warnCompilerCacheMissing'), null);
const cgText = fs.readFileSync(path.resolve(__dirname, '../dist/compiler/commandGenerator.js'), 'utf-8');
check('commandGenerator：前缀方法 + 两项设置键读取', cgText.includes('compilerCachePrefix') && cgText.includes("'build.compilerCache'") && cgText.includes("'build.compilerCachePath'"), null);

console.log(`编译缓存命令注入回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
