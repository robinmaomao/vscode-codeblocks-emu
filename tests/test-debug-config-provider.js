// R5 回归：F5 / launch.json 接入（DebugConfigurationProvider）
//  - F5 空配置（无 type/program）→ 按活动工程推导，且必须回填 type（否则 createSession 静默跳过）
//  - 推导失败 → 返回 undefined 且给出提示（不再静默）
//  - 用户显式 program → 尊重，不覆盖；attach → 不改动 pid / program
//  - 变量替换后 program 不存在 → 回退到活动工程目标输出（占位模板场景）
//  - 防漂移：package.json 调试激活事件 + extension.ts 注册 Initial/Dynamic 两个 trigger kind
const fs = require('fs');
const path = require('path');
const { createDebugConfigurationProviders, DEBUGGER_TYPE } = require('../dist/debug/debugConfigProvider.js');
const pkg = require('../package.json');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

const DERIVED = {
  type: 'codeblocks',
  name: 'Debug: Debug',
  request: 'launch',
  program: 'C:\\proj\\bin\\Debug\\hello.exe',
  cwd: 'C:\\proj\\bin\\Debug',
  gdbPath: 'D:\\mingw64\\bin\\gdb.exe',
  args: ['a', 'b'],
  environment: { FOO: '1' },
  searchDirs: ['C:\\proj'],
};

function makeHost(overrides = {}) {
  const calls = { errors: [], logs: [] };
  const host = {
    deriveLaunchConfig: async () => ({ config: { ...DERIVED } }),
    fallbackLaunchConfig: () => ({
      type: 'codeblocks',
      request: 'launch',
      name: 'Debug (Code::Blocks)',
      program: '${workspaceFolder}/bin/Debug/app',
      cwd: '${workspaceFolder}',
    }),
    showError: (m) => calls.errors.push(m),
    log: (m) => calls.logs.push(m),
    exists: () => false,
    ...overrides,
  };
  return { host, calls };
}

(async () => {
  // A. F5 空配置（VS Code 传入 Object.create(null)）→ 推导并回填 type/request
  {
    const { host, calls } = makeHost();
    const { initial } = createDebugConfigurationProviders(host);
    const empty = Object.create(null);
    const cfg = await initial.resolveDebugConfiguration(undefined, empty, undefined);
    check('A1 空配置 → 采纳推导的 program', cfg && cfg.program === DERIVED.program, cfg && cfg.program, DERIVED.program);
    check('A2 空配置 → 回填 type（否则 createSession 判据失败静默跳过）', cfg && cfg.type === DEBUGGER_TYPE, cfg && cfg.type, DEBUGGER_TYPE);
    check('A3 空配置 → request=launch 且沿用推导 name', cfg && cfg.request === 'launch' && cfg.name === DERIVED.name, cfg && [cfg.request, cfg.name], ['launch', DERIVED.name]);
    check('A4 空配置 → 未产生错误提示', calls.errors.length === 0, calls.errors, []);
  }

  // B. 推导失败 → 中止（undefined）并提示，不静默
  {
    const { host, calls } = makeHost({ deriveLaunchConfig: async () => ({ error: '可执行文件不存在，请先构建（bin/Debug/hello）' }) });
    const { initial } = createDebugConfigurationProviders(host);
    const cfg = await initial.resolveDebugConfiguration(undefined, {}, undefined);
    check('B1 推导失败 → 返回 undefined（中止启动）', cfg === undefined, cfg, undefined);
    check('B2 推导失败 → 已提示错误（不静默）', calls.errors.length === 1 && calls.errors[0].includes('请先构建'), calls.errors, ['可执行文件不存在…']);
  }

  // C. launch.json 显式 program → 尊重用户配置
  {
    const { host } = makeHost();
    const { initial } = createDebugConfigurationProviders(host);
    const user = { type: 'codeblocks', request: 'launch', name: 'My Config', program: 'C:\\other\\app.exe', cwd: 'C:\\other' };
    const cfg = await initial.resolveDebugConfiguration(undefined, user, undefined);
    check('C1 显式 program 不被覆盖', cfg.program === 'C:\\other\\app.exe', cfg.program, 'C:\\other\\app.exe');
    check('C2 显式 name/cwd 保留', cfg.name === 'My Config' && cfg.cwd === 'C:\\other', [cfg.name, cfg.cwd], ['My Config', 'C:\\other']);
  }

  // D. attach → 只补 type/name，不动 pid/program
  {
    const { host } = makeHost();
    const { initial } = createDebugConfigurationProviders(host);
    const cfg = await initial.resolveDebugConfiguration(undefined, { request: 'attach', pid: '1234' }, undefined);
    check('D1 attach 补 type', cfg.type === DEBUGGER_TYPE && cfg.request === 'attach', [cfg.type, cfg.request], [DEBUGGER_TYPE, 'attach']);
    check('D2 attach pid 原样保留', cfg.pid === '1234', cfg.pid, '1234');
    check('D3 attach 不注入 program', cfg.program === undefined, cfg.program, undefined);
  }

  // E. 变量替换后的存在性兜底
  {
    const { host, calls } = makeHost({ exists: () => false });
    const { initial } = createDebugConfigurationProviders(host);
    const stale = { type: 'codeblocks', request: 'launch', name: 'x', program: 'C:\\proj\\bin\\Debug\\gone.exe' };
    const cfg = await initial.resolveDebugConfigurationWithSubstitutedVariables(undefined, stale, undefined);
    check('E1 program 不存在 → 回退到工程目标输出', cfg.program === DERIVED.program, cfg.program, DERIVED.program);
    check('E2 回退动作写入输出通道', calls.logs.some((l) => l.includes('回退')), calls.logs, ['…回退到活动工程目标输出…']);
  }
  {
    const { host } = makeHost({ exists: (p) => p === 'C:\\proj\\bin\\Debug\\ok.exe' });
    const { initial } = createDebugConfigurationProviders(host);
    const ok = { type: 'codeblocks', request: 'launch', program: 'C:\\proj\\bin\\Debug\\ok.exe', cwd: 'C:\\custom' };
    const cfg = await initial.resolveDebugConfigurationWithSubstitutedVariables(undefined, ok, undefined);
    check('E3 program 存在 → 原样返回', cfg === ok, cfg.program, 'C:\\proj\\bin\\Debug\\ok.exe');
  }
  {
    const { host } = makeHost({ deriveLaunchConfig: async () => ({ error: '请先打开一个 Code::Blocks 项目 (.cbp)' }) });
    const { initial } = createDebugConfigurationProviders(host);
    const stale = { type: 'codeblocks', request: 'launch', program: 'C:\\gone.exe' };
    const cfg = await initial.resolveDebugConfigurationWithSubstitutedVariables(undefined, stale, undefined);
    check('E4 无法推导时保留用户配置（交由适配器报错）', cfg === stale, cfg.program, 'C:\\gone.exe');
  }

  // F. provideDebugConfigurations：创建 launch.json 用真实目标输出
  {
    const { host } = makeHost();
    const { initial, dynamic } = createDebugConfigurationProviders(host);
    const list = await initial.provideDebugConfigurations(undefined, undefined);
    check('F1 initial 提供工程目标配置', list.length === 1 && list[0].program === DERIVED.program, list.map((c) => c.program), [DERIVED.program]);
    const dyn = await dynamic.provideDebugConfigurations(undefined, undefined);
    check('F2 dynamic 同样提供工程目标配置（Select and Start Debugging）', dyn.length === 1 && dyn[0].program === DERIVED.program, dyn.map((c) => c.program), [DERIVED.program]);
  }
  {
    const { host } = makeHost({ deriveLaunchConfig: async () => ({ error: '请先打开一个 Code::Blocks 项目 (.cbp)' }) });
    const { initial } = createDebugConfigurationProviders(host);
    const list = await initial.provideDebugConfigurations(undefined, undefined);
    check('F3 无工程 → 回退占位模板（含 ${workspaceFolder}）', list.length === 1 && list[0].program.includes('${workspaceFolder}'), list.map((c) => c.program), ['${workspaceFolder}/bin/Debug/app']);
  }

  // G. 防漂移：激活事件与注册代码
  {
    const events = pkg.activationEvents || [];
    check('G1 声明 onDebug', events.includes('onDebug'), events, ['onDebug']);
    check('G2 声明 onDebugResolve:codeblocks', events.includes('onDebugResolve:codeblocks'), events, ['onDebugResolve:codeblocks']);
    check('G3 声明 onDebugInitialConfigurations', events.includes('onDebugInitialConfigurations'), events, ['onDebugInitialConfigurations']);
    check('G4 声明 onDebugDynamicConfigurations:codeblocks', events.includes('onDebugDynamicConfigurations:codeblocks'), events, ['onDebugDynamicConfigurations:codeblocks']);

    const ext = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf-8');
    check('G5 注册 Initial trigger kind', ext.includes('DebugConfigurationProviderTriggerKind.Initial'), ext.includes('…Initial'), true);
    check('G6 注册 Dynamic trigger kind', ext.includes('DebugConfigurationProviderTriggerKind.Dynamic'), ext.includes('…Dynamic'), true);
    check('G7 F8 路径复用同一推导（debug() 调 deriveDebugLaunchConfig）', /async function debug\(\)[\s\S]{0,600}deriveDebugLaunchConfig\(selectedTitle\)/.test(ext), 'debug() → deriveDebugLaunchConfig(selectedTitle)', true);
  }

  console.log(`\ndebug-config-provider 回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('FAIL 运行异常: ' + e.message);
  process.exit(1);
});
