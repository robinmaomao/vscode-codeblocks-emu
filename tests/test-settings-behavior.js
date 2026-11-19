// D-11 设置行为回归：6 个「仅契约」设置必须有可观测的消费行为
//  compiler.customFlags / compiler.flagOverrides → 编译参数目录与写入
//  profiler.gprofPath / profiler.annotatedSource → profiler 命令参数
//  search.scope → 工程搜索默认范围
//  noProjectCompile.useTaskTerminal → 无工程编译走任务系统
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');
const { activate } = require('./_harness/extensionActivation');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const mock = installVscodeMock({ config: {} });
const flags = require('../dist/compiler/compilerFlagSettings.js');
const profiler = require('../dist/features/profilerCommands.js');
const search = require('../dist/ui/projectSearchView.js');
const noProject = require('../dist/features/noProjectCompileSettings.js');

const BASE = [
  { name: 'Enable warnings', option: '-Wall', category: 'Warnings' },
  { name: 'Debug info', option: '-g', category: 'Debugging' },
];

(async () => {
  // ---- compiler.customFlags：读取 + 合并 + 写入 ----
  mock.configStore['codeblocks.compiler.customFlags'] = { gcc: [{ name: 'Custom define', option: '-DFOO=1' }] };
  mock.configStore['codeblocks.compiler.flagOverrides'] = {};
  let stores = flags.readCompilerFlagStores();
  check('customFlags 被读取并规范化', stores.custom.gcc?.length === 1 && stores.custom.gcc[0].option === '-DFOO=1', stores.custom);
  let catalog = flags.buildCompilerCatalog('gcc', BASE);
  check('customFlags 追加到编译参数目录', catalog.some((c) => c.custom && c.option === '-DFOO=1'), catalog.map((c) => c.option));
  check('内置参数保持未修改', catalog.filter((c) => !c.custom).every((c) => !c.modified), catalog);

  mock.configUpdates.length = 0;
  let error = await flags.applyFlagAction(
    { type: 'flagAdd', compilerId: 'gcc', flag: { name: 'Stack protector', option: '-fstack-protector' } },
    BASE,
  );
  const customWrite = mock.configUpdates.find((u) => u.key === 'codeblocks.compiler.customFlags');
  check('customFlags 通过设置写入（flagAdd）', !error && !!customWrite, { error, updates: mock.configUpdates });
  check('customFlags 写入值包含新参数',
    !!customWrite && customWrite.value.gcc.some((f) => f.option === '-fstack-protector'),
    customWrite && customWrite.value);

  // ---- compiler.flagOverrides：删除/改名内置参数 ----
  mock.configStore['codeblocks.compiler.customFlags'] = {};
  mock.configStore['codeblocks.compiler.flagOverrides'] = { gcc: { modified: {}, removed: ['-Wall'] } };
  catalog = flags.buildCompilerCatalog('gcc', BASE);
  check('flagOverrides.removed 删除内置参数', !catalog.some((c) => c.option === '-Wall'), catalog.map((c) => c.option));

  mock.configStore['codeblocks.compiler.flagOverrides'] = {
    gcc: { modified: { '-g': { name: 'Debug info (g3)', option: '-g3' } }, removed: [] },
  };
  catalog = flags.buildCompilerCatalog('gcc', BASE);
  const modified = catalog.find((c) => c.option === '-g3');
  check('flagOverrides.modified 覆盖参数并保留基项', !!modified && modified.modified && modified.baseOption === '-g', modified);

  mock.configUpdates.length = 0;
  error = await flags.applyFlagAction(
    { type: 'flagDelete', compilerId: 'gcc', original: { option: '-Wall', baseOption: '-Wall', custom: false } },
    BASE,
  );
  const overrideWrite = mock.configUpdates.find((u) => u.key === 'codeblocks.compiler.flagOverrides');
  check('flagOverrides 通过设置写入（flagDelete 内置参数）',
    !error && !!overrideWrite && overrideWrite.value.gcc.removed.includes('-Wall'),
    { error, updates: mock.configUpdates });

  // ---- profiler.gprofPath / profiler.annotatedSource ----
  check('profiler.gprofPath 默认回落 gprof', profiler.resolveGprofCommand() === 'gprof', profiler.resolveGprofCommand());
  mock.configStore['codeblocks.profiler.gprofPath'] = '  C:\\tools\\gprof.exe  ';
  check('profiler.gprofPath 被读取并 trim', profiler.resolveGprofCommand() === 'C:\\tools\\gprof.exe', profiler.resolveGprofCommand());
  check('profiler.annotatedSource 默认开启', profiler.annotatedSourceEnabled() === true, profiler.annotatedSourceEnabled());
  mock.configStore['codeblocks.profiler.annotatedSource'] = false;
  check('profiler.annotatedSource=false 关闭 -A', profiler.annotatedSourceEnabled() === false, profiler.annotatedSourceEnabled());

  // ---- search.scope ----
  check('search.scope 默认 openProjects', search.configuredSearchScope() === 'openProjects', search.configuredSearchScope());
  mock.configStore['codeblocks.search.scope'] = 'activeProject';
  check('search.scope=activeProject 生效', search.configuredSearchScope() === 'activeProject', search.configuredSearchScope());
  mock.configStore['codeblocks.search.scope'] = 'bogus';
  check('search.scope 非法值回退 openProjects', search.configuredSearchScope() === 'openProjects', search.configuredSearchScope());

  // ---- noProjectCompile.useTaskTerminal：helper + 真实命令接线 ----
  check('noProjectCompile.useTaskTerminal 默认 false', noProject.useTaskTerminalForNoProjectCompile() === false, noProject.useTaskTerminalForNoProjectCompile());

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-d11-settings-'));
  const source = path.join(tmp, 'main.c');
  fs.writeFileSync(source, 'int main(void){return 0;}\n', 'utf-8');
  mock.configStore['codeblocks.noProjectCompile.useTaskTerminal'] = true;
  const app = await activate({ tmpDir: tmp, config: mock.configStore });
  app.setActiveEditor(source, 'int main(void){return 0;}\n', 'c');
  await app.invoke('codeblocks.compileFileWithoutProject');
  const task = app.records.tasks[app.records.tasks.length - 1];
  check('useTaskTerminal=true 走任务系统（注册 1 个编译任务）', app.records.tasks.length === 1, app.records.tasks.length);
  check('任务命令包含 -g -Wall 与源文件',
    !!task && /-g -Wall/.test(task.execution.command) && task.execution.command.includes(source),
    task && task.execution.command);
  check('任务标记为 Build 组', !!task && !!task.group, task && task.group);
  app.endTask(task, 0);
  await new Promise((r) => setTimeout(r, 20));
  check('任务成功结束 → 提示运行产物', app.mock.infos.some((m) => /Build succeeded|编译成功/.test(m)), app.mock.infos);

  await app.deactivate().catch(() => undefined);
  fs.rmSync(tmp, { recursive: true, force: true });
  mock.restore();
  console.log(`\nD-11 设置行为: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('D-11 设置行为异常: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
