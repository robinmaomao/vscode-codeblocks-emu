// 视觉回归「面」定义：用 dist 真实代码生成每个 WebView HTML（不手写快照），
// 并声明渲染后需要执行的交互动作（切换 tab / 注入宿主消息）。
//
// 每个面返回 { id, html, width, height, actions[] }：
//   actions: { type: 'click', selector } | { type: 'postMessage', payload } | { type: 'wait', ms }
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const fixture = path.join(__dirname, 'fixtures', 'rich.cbp');

const PROPS_TABS = ['settings', 'targets', 'scripts', 'notes', 'parser', 'debugger'];

/** 快捷键面板的宿主状态（对齐 KeybindingPanelHost.getState 的形状：rows/notices/path/cbStyle） */
function keybindingState() {
  const rows = [
    { id: 'codeblocks.build', label: '构建当前工程', command: 'Build', group: 'builtin', status: 'default', defaultsLabel: 'f9', effective: 'f9', ok: true, when: 'view == codeblocks.projectTree' },
    { id: 'codeblocks.run', label: '运行', command: 'Run', group: 'builtin', status: 'custom', defaultsLabel: 'f8', effective: 'ctrl+f8', ok: true },
    { id: 'codeblocks.rebuild', label: '重新构建', command: 'Rebuild', group: 'builtin', status: 'default', defaultsLabel: 'ctrl+f11', effective: 'ctrl+f11', ok: true },
    { id: 'codeblocks.buildAndRun', label: '构建并运行', command: 'Build and run', group: 'builtin', status: 'unbound', defaultsLabel: 'f9', effective: '', ok: false, note: '与 VS Code 默认键冲突，已解绑' },
    { id: 'cbAlias.make', label: 'make（外部命令别名）', command: 'make', group: 'alias', status: 'custom', defaultsLabel: '-', effective: 'ctrl+shift+m', ok: true },
    { id: 'codeblocks.cbStyle.stopBuild', label: '停止构建（CB 保真）', command: 'Stop build', group: 'cbStyle', status: 'default', defaultsLabel: 'ctrl+break', effective: 'ctrl+break', ok: false, note: '待 VS Code 重启生效' },
  ];
  return {
    rows,
    path: 'C:\\Users\\demo\\AppData\\Roaming\\Code\\User\\keybindings.json',
    cbStyle: true,
    notices: ['检测到 1 处键位与 VS Code 默认冲突（已在列表中标注）'],
  };
}

/** 构建 HTML 构建日志（固定时间戳 → 确定性输出） */
function buildLogHtml() {
  const { renderHtmlBuildLog } = require('../../dist/build/htmlBuildLog.js');
  return renderHtmlBuildLog({
    title: 'rich-demo — Debug',
    startMs: Date.UTC(2026, 0, 2, 3, 4, 5),
    endMs: Date.UTC(2026, 0, 2, 3, 4, 39),
    fullCommandLine: true,
    projects: [
      {
        projectName: 'rich-demo',
        targetName: 'Debug',
        commands: ['gcc -Wall -g -o bin/Debug/rich-demo obj/Debug/src/main.o obj/Debug/src/util.o', 'gcc -o bin/Debug/rich-demo obj/Debug/src/main.o obj/Debug/src/util.o -lm'],
        diagnostics: [
          { severity: 'warning', file: 'src/util.c', line: 42, message: 'unused variable ‘tmp’ [-Wunused-variable]' },
          { severity: 'error', file: 'src/render.cpp', line: 17, message: 'expected ‘;’ before ‘}’ token' },
          { severity: 'error', file: 'src/render.cpp', line: 23, message: "'Renderer' was not declared in this scope" },
        ],
      },
      {
        projectName: 'rich-demo',
        targetName: 'libstatic',
        commands: ['ar rcs lib/librich-static.a obj/static/src/util.o'],
        diagnostics: [],
      },
    ],
  });
}

/**
 * 构建全部视觉面（在已安装 vscode mock 的情况下调用）。
 * @returns {Array<{id:string,html:string,width:number,height:number,actions:Array}>}
 */
function buildSurfaces() {
  const { currentMock } = require('../_harness/vscodeMock');
  const mock = currentMock();
  if (!mock) throw new Error('buildSurfaces 需先 installVscodeMock()');

  const { ProjectParser } = require('../../dist/model/parser.js');
  const { CompilerOptionsLoader } = require('../../dist/compiler/optionsLoader.js');
  const { ProjectPropertiesPanel } = require('../../dist/ui/projectPropertiesPanel.js');
  const { KeybindingPanel } = require('../../dist/ui/keybindingPanel.js');

  const project = new ProjectParser().parse(fixture);
  const fakeUri = mock.vscode.Uri.file(root);
  const surfaces = [];

  // ---- 工程属性面板（9 个 tab 各一张） ----
  new ProjectPropertiesPanel(project, fakeUri, () => undefined);
  const propsPanel = mock.webviews[mock.webviews.length - 1];
  const propsHtml = propsPanel.webview.html;
  if (!propsHtml || !propsHtml.includes('</html>')) throw new Error('工程属性面板 HTML 生成失败');
  for (const tab of PROPS_TABS) {
    surfaces.push({
      id: `props-${tab}`,
      html: propsHtml,
      width: 1280,
      height: 800,
      actions: [{ type: 'click', selector: `#tabbtn-${tab}` }],
    });
  }

  // ---- 快捷键面板（注入宿主 state） ----
  const hostStub = {
    getState: keybindingState,
    apply: async () => ({ ok: true, message: 'ok' }),
    check: () => undefined,
    openFile: () => undefined,
    exportScheme: () => undefined,
    importScheme: () => undefined,
    validate: () => ({ ok: true, message: '' }),
    setOverride: async () => ({ ok: true, message: 'ok' }),
    clearOverride: async () => ({ ok: true, message: 'ok' }),
    resetAll: async () => ({ ok: true, message: 'ok' }),
  };
  new KeybindingPanel(fakeUri, hostStub);
  const kbPanel = mock.webviews[mock.webviews.length - 1];
  const kbHtml = kbPanel.webview.html;
  if (!kbHtml || !kbHtml.includes('</html>')) throw new Error('快捷键面板 HTML 生成失败');
  surfaces.push({
    id: 'keybindings',
    html: kbHtml,
    width: 1280,
    height: 900,
    actions: [{ type: 'postMessage', payload: { type: 'state', state: keybindingState() } }],
  });

  // ---- Build options 面板（真实 options_gcc.xml 目录 + rich.cbp 工程/目标） ----
  const loader = new CompilerOptionsLoader(path.join(root, 'resources', 'compilers'));
  const compiler = loader.load('gcc');
  const { buildCompilerCatalog, readCompilerFlagStores, readLanguageFlags } = require('../../dist/compiler/compilerFlagSettings.js');
  const { OptionsRelationType } = require('../../dist/model/types.js');
  const { BuildOptionsPanel } = require('../../dist/ui/buildOptionsPanel.js');
  const stores = readCompilerFlagStores();
  const baseCatalog = compiler.options.map((o) => ({
    name: o.name,
    option: o.option,
    additionalLibs: o.additionalLibs,
    category: o.category,
  }));
  const boScope = (title, s, relations) => ({
    title,
    compilerId: s.compilerId,
    compilerOptions: [...s.compilerOptions],
    resourceCompilerOptions: [...(s.resourceCompilerOptions ?? [])],
    linkerOptions: [...s.linkerOptions],
    linkLibs: [...s.linkLibs],
    linkerExecutable: s.linkerExecutable ?? 0,
    relations,
    includeDirs: [...s.includeDirs],
    libDirs: [...s.libDirs],
    resourceDirs: [...s.resourceIncludeDirs],
    commandsBefore: [...s.commandsBeforeBuild],
    commandsAfter: [...s.commandsAfterBuild],
    alwaysPost: s.alwaysRunPostBuildSteps === true,
    envVars: (s.envVars ?? []).map((v) => ({ name: v.name, value: v.value })),
    makeCommands: { ...(s.makeCommands ?? {}) },
  });
  const allBoth = { compiler: 3, linker: 3, include: 3, lib: 3, res: 3 };
  const boData = {
    projectTitle: project.title,
    makefileIsCustom: project.makefileIsCustom === true,
    defineSwitch: compiler.switches.defines || '-D',
    project: boScope(project.title, project, allBoth),
    targets: project.buildTargets.map((t) => ({ ...boScope(t.title, t, {
      compiler: t.optionRelations[OptionsRelationType.CompilerOptions],
      linker: t.optionRelations[OptionsRelationType.LinkerOptions],
      include: t.optionRelations[OptionsRelationType.IncludeDirs],
      lib: t.optionRelations[OptionsRelationType.LibDirs],
      res: t.optionRelations[OptionsRelationType.ResDirs],
    }), targetType: t.targetType })),
    compilers: [{ id: 'gcc', name: 'GNU GCC Compiler' }],
    compilerCatalogs: { gcc: buildCompilerCatalog('gcc', baseCatalog, stores) },
    compilerBaseCatalogs: { gcc: baseCatalog },
    compilerFlags: { gcc: readLanguageFlags('gcc', { cOnly: compiler.cOnlyFlags ?? [], cppOnly: compiler.cppOnlyFlags ?? [] }, stores) },
    defaultCompilerId: 'gcc',
  };
  BuildOptionsPanel.show(project.title, project.filename, boData, fakeUri);
  const optPanel = mock.webviews[mock.webviews.length - 1];
  const optHtml = optPanel.webview.html;
  if (!optHtml || !optHtml.includes('</html>')) throw new Error('Build options 面板 HTML 生成失败');
  surfaces.push({ id: 'build-options', html: optHtml, width: 1180, height: 940, actions: [] });

  // ---- Set Programs' Arguments 对话框（对齐 CB SelectTargetDlg） ----
  const { runTargetsPage } = require('../../dist/ui/runTargetsPanel.js');
  surfaces.push({
    id: 'run-targets',
    html: runTargetsPage({
      projectTitle: project.title,
      commonTopLevelPath: project.commonTopLevelPath,
      defaultExecuteTarget: project.buildTargets[0]?.title ?? '',
      activeTarget: project.buildTargets[0]?.title ?? '',
      targets: project.buildTargets.map((t) => ({
        title: t.title,
        executionParameters: t.executionParameters ?? '',
        hostApplication: t.hostApplication ?? '',
        runHostApplicationInTerminal: t.runHostApplicationInTerminal === true,
      })),
    }),
    width: 720,
    height: 620,
    actions: [],
  });

  // ---- HTML 构建日志 ----
  surfaces.push({ id: 'buildlog-html', html: buildLogHtml(), width: 1000, height: 620, actions: [] });

  return surfaces;
}

module.exports = { buildSurfaces, PROPS_TABS, keybindingState, buildLogHtml };
