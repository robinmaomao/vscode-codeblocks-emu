// 构建服务回归（无宿主）：
//  - timeoutMs 真正取消构建（build 前脚本睡眠 → 到时取消，不等待脚本自然结束）
//  - clean 模式可用（不依赖编译器产物）
//  - 目标选择：显式目标优先、非法目标报 invalid-input、缺省取当前平台首个目标
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

const ROOT = path.resolve(__dirname, '..');
const TMP = path.join(ROOT, '.cb-tools', 'agent-control', 'tmp-build-service');
const SRC = path.join(ROOT, 'test-project');

// 隔离 Code::Blocks 用户配置，避免本机 default.conf 改写编译器程序路径
const isolatedAppData = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-buildsvc-'));
process.env.APPDATA = isolatedAppData;

const mock = installVscodeMock({});
const { loadCodeblocksSettings } = require(path.join(ROOT, 'dist', 'api', 'settingsReader.js'));
const { createCompilerProvider } = require(path.join(ROOT, 'dist', 'api', 'compilerService.js'));
const { buildProject, selectBuildTarget } = require(path.join(ROOT, 'dist', 'api', 'buildService.js'));
const { buildProjectTarget } = require(path.join(ROOT, 'dist', 'build', 'buildProject.js'));
const { applyEdits } = require(path.join(ROOT, 'dist', 'api', 'projectEdit.js'));
const store = require(path.join(ROOT, 'dist', 'api', 'projectStore.js'));

let pass = 0;
let fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (got !== undefined ? '  got=' + JSON.stringify(got) : '')); }
}

const noop = () => undefined;
const output = {
  info: noop, warn: noop, error: noop, debug: noop, trace: noop,
  append: noop, appendLine: noop, clear: noop, show: noop, hide: noop, dispose: noop,
};

function freshCopy(tag) {
  const dir = path.join(TMP, tag);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(SRC)) {
    const from = path.join(SRC, entry);
    if (fs.statSync(from).isFile()) fs.copyFileSync(from, path.join(dir, entry));
  }
  return path.join(dir, 'hello-cb.cbp');
}

function expectCode(label, code, fn) {
  try {
    fn();
    check(label, false, '(no error)');
  } catch (err) {
    check(label, err && err.code === code, err && { code: err.code, message: err.message });
  }
}

(async () => {
  const settings = loadCodeblocksSettings();
  const compiler = createCompilerProvider({
    resourcesDir: path.join(ROOT, 'resources', 'compilers'),
    settings,
    defaultConfPath: path.join(TMP, 'no-such-default.conf'),
  });

  // ---------- B1–B4 超时取消 ----------
  {
    const cbp = freshCopy('timeout');
    const project = store.loadProject(cbp);
    // 构建前脚本睡 20s：超时取消必须强杀进程树并立即返回
    applyEdits(project, [{
      op: 'set',
      scope: 'project',
      field: 'commandsBeforeBuild',
      value: ['node -e "setTimeout(()=>{},20000)"'],
    }], { allowScripts: true });
    store.saveProject(project, { force: true });

    const t0 = Date.now();
    const outcome = await buildProject(
      { cbp, target: 'Debug', timeoutMs: 1500 },
      { compiler, settings, output },
    );
    const elapsed = Date.now() - t0;

    check('B1 超时被标记', outcome.timedOut === true, outcome.timedOut);
    check('B2 构建结果非成功', outcome.ok === false, outcome.ok);
    check('B3 摘要标记 cancelled', !!outcome.summary.projects[0] && outcome.summary.projects[0].cancelled === true,
      outcome.summary.projects[0] && outcome.summary.projects[0].cancelled);
    check('B4 及时返回（不等脚本自然结束，< 15s）', elapsed < 15000, elapsed);
  }

  // ---------- B5 clean 模式 ----------
  {
    const cbp = freshCopy('clean');
    const outcome = await buildProject({ cbp, target: 'Debug', mode: 'clean' }, { compiler, settings, output });
    check('B5 clean 模式成功', outcome.ok === true && outcome.timedOut === false, { ok: outcome.ok, timedOut: outcome.timedOut });
    check('B6 clean 摘要目标正确', outcome.target === 'Debug' && outcome.summary.projects[0].projectTitle === 'hello-cb', outcome.summary.projects[0].projectTitle);
  }

  // ---------- B7–B9 目标选择 ----------
  {
    const cbp = freshCopy('target');
    const project = store.loadProject(cbp);
    check('B7 显式目标优先', selectBuildTarget(project, 'Debug') === 'Debug');
    expectCode('B8 非法目标 → invalid-input', 'invalid-input', () => selectBuildTarget(project, 'NoSuchTarget'));
    const fallback = selectBuildTarget(project);
    check('B9 缺省取当前平台可用目标', project.buildTargets.some((t) => t.title === fallback), fallback);
  }

  // ---------- B10–B12 makefile「已最新」不递增自动版本号（0.9.2 回归） ----------
  {
    const dir = path.join(TMP, 'makefile');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const cbp = path.join(dir, 'make-custom.cbp');
    fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="make-custom" />
		<Option compiler="gcc" />
		<Option makefile_is_custom="1" />
		<Build>
			<Target title="Debug">
				<Option output="bin/demo" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<MakeCommands>
			<Build command="node -e &quot;process.exit(0)&quot;" />
			<AskRebuildNeeded command="node -e &quot;process.exit(0)&quot;" />
		</MakeCommands>
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');
    const project = store.loadProject(cbp);
    let prepared = 0;
    let finished = 0;
    const result = await buildProjectTarget(project, 'Debug', false, {
      output,
      getCompiler: (id) => compiler.getCompiler(id),
      resolveCompiler: (id) => compiler.resolveTargetCompiler(id),
      budget: { errorCount: 0, truncated: false },
      maxErrors: 50,
      prepareBuild: async () => { prepared++; return 'token'; },
      finishBuild: async () => { finished++; },
      askRebuildTimeoutMs: 15000,
    });
    check('B10 已最新 → 构建成功', result.ok === true, result.ok);
    check('B11 构建前生成 version.h（prepareBuild 仍执行）', prepared === 1, prepared);
    check('B12 已最新 → 不递增版本号（finishBuild 未调用）', finished === 0, finished);
  }

  // ---------- B12a–B12b makefile Clean 保留命令日志 + 真实 ok ----------
  {
    const dir = path.join(TMP, 'makefile-clean');
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const cbp = path.join(dir, 'make-clean.cbp');
    fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="make-clean" />
		<Option compiler="gcc" />
		<Option makefile_is_custom="1" />
		<Build>
			<Target title="Debug">
				<Option output="bin/demo" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<MakeCommands>
			<Clean command="node -e &quot;process.exit(0)&quot;" />
		</MakeCommands>
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');
    const project = store.loadProject(cbp);
    const lines = [];
    const capture = { ...output, info: (line) => lines.push(String(line)), show: noop };
    const { cleanProjectTarget } = require(path.join(ROOT, 'dist', 'build', 'buildProject.js'));
    const result = await cleanProjectTarget(project, 'Debug', {
      output: capture,
      getCompiler: (id) => compiler.getCompiler(id),
      resolveCompiler: (id) => compiler.resolveTargetCompiler(id),
      budget: { errorCount: 0, truncated: false },
      maxErrors: 50,
    });
    check('B12a makefile Clean 成功', result.ok === true, result.ok);
    check('B12b makefile Clean 打印实际命令（Make: …）', lines.some((l) => /Make[:：]/.test(l) && l.includes('process.exit(0)')), lines.slice(0, 5));
  }

  // ---------- B27–B28 makefile Clean：spawn 失败 / 被取消都不能当成成功 ----------
  {
    const { cleanProjectTarget } = require(path.join(ROOT, 'dist', 'build', 'buildProject.js'));
    const { BuildCancelSource } = require(path.join(ROOT, 'dist', 'build', 'cancelToken.js'));
    const makeProject = (tag, extraOption, cleanCommand) => {
      const dir = path.join(TMP, tag);
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const cbp = path.join(dir, `${tag}.cbp`);
      fs.writeFileSync(cbp, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="${tag}" />
		<Option compiler="gcc" />
		<Option makefile_is_custom="1" />${extraOption}
		<Build>
			<Target title="Debug">
				<Option output="bin/demo" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<MakeCommands>
			<Clean command="${cleanCommand}" />
		</MakeCommands>
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');
      return store.loadProject(cbp);
    };
    const deps = {
      output,
      getCompiler: (id) => compiler.getCompiler(id),
      resolveCompiler: (id) => compiler.resolveTargetCompiler(id),
      budget: { errorCount: 0, truncated: false },
      maxErrors: 50,
    };

    // 执行目录不存在 → spawn 失败（code === null）
    const broken = makeProject('make-clean-spawn-error', '\n\t\t<Option execution_dir="no-such-dir" />', 'node -e &quot;process.exit(0)&quot;');
    const failed = await cleanProjectTarget(broken, 'Debug', deps);
    check('B27 Clean spawn 失败 → ok:false（不能静默成功）', failed.ok === false, failed.ok);

    // 取消先于注册 → 进程被立即杀掉（code === null）
    const cancelled = makeProject('make-clean-cancelled', '', 'node -e &quot;setTimeout(()=>{},5000)&quot;');
    const cancel = new BuildCancelSource();
    cancel.cancel();
    const t0 = Date.now();
    const cancelledResult = await cleanProjectTarget(cancelled, 'Debug', { ...deps, cancel });
    check('B28 Clean 被取消 → ok:false 且快速返回', cancelledResult.ok === false && Date.now() - t0 < 4000,
      { ok: cancelledResult.ok, elapsed: Date.now() - t0 });
  }

  // ---------- B13–B15 CLI/MCP 也应用「仅 C / 仅 C++」参数 ----------
  {
    const settingsFile = path.join(TMP, 'langflags-settings.json');
    fs.writeFileSync(settingsFile, JSON.stringify({
      'codeblocks.compiler.languageFlags': {
        gcc: { cOnly: ['-std=c99'], cppOnly: ['-std=c++20'] },
      },
    }), 'utf-8');
    const langSettings = loadCodeblocksSettings({ userSettings: [settingsFile], ignoreEnv: true });
    const langCompiler = createCompilerProvider({
      resourcesDir: path.join(ROOT, 'resources', 'compilers'),
      settings: langSettings,
      defaultConfPath: path.join(TMP, 'no-such-default.conf'),
    }).getCompiler('gcc');
    check('B13 仅 C 参数来自设置覆盖', JSON.stringify(langCompiler.cOnlyFlags) === JSON.stringify(['-std=c99']), langCompiler.cOnlyFlags);
    check('B14 仅 C++ 参数来自设置覆盖', JSON.stringify(langCompiler.cppOnlyFlags) === JSON.stringify(['-std=c++20']), langCompiler.cppOnlyFlags);
    const baseline = compiler.getCompiler('gcc');
    check('B15 未设置时回落到 XML <Sort> 基线（非覆盖值）', JSON.stringify(baseline.cOnlyFlags) !== JSON.stringify(['-std=c99']), baseline.cOnlyFlags);
  }

  // ---------- B16–B17 compile_commands 导出补齐系统头（与 UI 同源） ----------
  {
    const cbp = freshCopy('export');
    const outDir = path.join(path.dirname(cbp), 'compile_commands_out');
    fs.rmSync(outDir, { recursive: true, force: true });
    const { exportProject } = require(path.join(ROOT, 'dist', 'api', 'exportService.js'));
    exportProject({ cbp, kind: 'compile_commands', out: outDir }, {
      compiler,
      output,
      systemIncludes: () => ['C:/fake/sysinc'],
    });
    const withIncludes = fs.readFileSync(path.join(outDir, 'compile_commands.json'), 'utf-8');
    check('B16 systemIncludes 注入 -isystem', withIncludes.includes('-isystem') && withIncludes.includes('fake/sysinc'), withIncludes.slice(0, 200));

    fs.rmSync(outDir, { recursive: true, force: true });
    exportProject({ cbp, kind: 'compile_commands', out: outDir }, { compiler, output });
    const withoutIncludes = fs.readFileSync(path.join(outDir, 'compile_commands.json'), 'utf-8');
    check('B17 未提供 systemIncludes 时保持旧行为（无 -isystem）', !withoutIncludes.includes('-isystem'), withoutIncludes.slice(0, 200));
  }

  // ---------- B18–B20 export 默认不覆盖 Makefile + 相对 out 锚定工程目录 ----------
  {
    const cbp = freshCopy('export-default');
    const dir = path.dirname(cbp);
    const sentinel = '# user makefile, must not be touched\n';
    fs.writeFileSync(path.join(dir, 'Makefile'), sentinel, 'utf-8');
    const { exportProject } = require(path.join(ROOT, 'dist', 'api', 'exportService.js'));

    const out = exportProject({ cbp, kind: 'makefile' }, { compiler, output });
    const defaultFile = path.join(dir, 'Makefile.cb');
    check('B18 makefile 默认写 Makefile.cb', out.files[0] === defaultFile && fs.existsSync(defaultFile), out.files);
    check('B19 不覆盖工程里的 Makefile', fs.readFileSync(path.join(dir, 'Makefile'), 'utf-8') === sentinel,
      fs.readFileSync(path.join(dir, 'Makefile'), 'utf-8').slice(0, 40));

    const rel = exportProject({ cbp, kind: 'makefile', out: 'out/custom.mk' }, { compiler, output });
    const expected = path.join(dir, 'out', 'custom.mk');
    check('B20 相对 out 按工程目录解析', rel.files[0] === expected && fs.existsSync(expected), rel.files);
  }

  // ---------- B21–B26 平台判定：虚拟目标按成员并集（不能因首个成员不支持就整组跳过） ----------
  {
    const { targetPlatformSupported } = require(path.join(ROOT, 'dist', 'build', 'buildProject.js'));
    const current = process.platform === 'win32' ? 0x04 : process.platform === 'darwin' ? 0x01 : 0x02;
    const other = current === 0x04 ? 0x02 : 0x04;
    const project = {
      buildTargets: [
        { title: 'Current', platforms: current },
        { title: 'Other', platforms: other },
      ],
      virtualTargets: [
        { title: 'VTAll', targets: ['Other', 'Current'] },
        { title: 'VTNone', targets: ['Other'] },
        { title: 'VTEmpty', targets: [] },
      ],
    };
    check('B21 普通目标：支持当前平台', targetPlatformSupported(project, 'Current') === true);
    check('B22 普通目标：不支持当前平台', targetPlatformSupported(project, 'Other') === false);
    check('B23 未知目标 → false', targetPlatformSupported(project, 'Nope') === false);
    check('B24 虚拟目标：首个成员不支持但另一成员支持 → true', targetPlatformSupported(project, 'VTAll') === true);
    check('B25 虚拟目标：全部成员不支持 → false', targetPlatformSupported(project, 'VTNone') === false);
    check('B26 虚拟目标：空成员 → false', targetPlatformSupported(project, 'VTEmpty') === false);
  }

  fs.rmSync(TMP, { recursive: true, force: true });
  fs.rmSync(isolatedAppData, { recursive: true, force: true });
  mock.restore();
  console.log(`\n构建服务回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
