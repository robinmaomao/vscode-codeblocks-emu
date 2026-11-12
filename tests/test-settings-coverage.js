// 设置项覆盖回归：16 个此前未被任何测试引用的设置键
//  - 静态读点断言：键的字面量出现在「消费它的实现文件」，且该行是一次真实的配置读取（.get(...) 或封装读取器 readStringArraySetting(...)）
//  - 行为断言：低风险项的运行时效果（树分组、工具栏上下文、自动头文件保护、工具解析、astyle 参数）
//
// 位置断言刻意不比对绝对行号：对无关代码的增删不应报错（历史：gdbDebugAdapter.ts 增行 44 行后
// ±40 行容差误判，main CI 变红）。而「键被删/改名/挪到别的文件」由前两条断言拦截，
// 「键退化为普通字符串、不再取值」由 .get(...)/readStringArraySetting(...) 断言拦截。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

// 键 → （源码读点文件，编译产物，说明（含消费它的函数/入口，便于定位））
// 注：键用完整名（含 codeblocks. 前缀）以便覆盖矩阵按贡献项 ID 统计；源码内多为分区相对写法，定位时去掉前缀。
const SETTINGS = [
  ['codeblocks.saveBeforeBuild', 'src/extension.ts', 'dist/extension.js', '构建/清理前 saveAll（saveAllBeforeBuild）'],
  ['codeblocks.build.profile', 'src/build/buildEngine.ts', 'dist/build/buildEngine.js', '构建阶段计时探针开关（BuildEngine.build）'],
  ['codeblocks.build.traceProcesses', 'src/build/buildEngine.ts', 'dist/build/buildEngine.js', '构建子进程统计开关（BuildEngine.traceProcessSummary）'],
  ['codeblocks.build.lowerCompilerPriority', 'src/build/buildEngine.ts', 'dist/build/buildEngine.js', '编译子进程降级开关（BuildEngine.demoteChild）'],
  ['codeblocks.build.sampleSystem', 'src/build/buildEngine.ts', 'dist/build/buildEngine.js', '系统 CPU 归属采样开关（BuildEngine.sampleSystemEnabled）'],
  ['codeblocks.build.autoExcludeOutputs', 'src/extension.ts', 'dist/extension.js', '构建前自动排除产物目录（autoExcludeBuildOutputs）'],
  ['codeblocks.debug.initCommands', 'src/debug/gdbDebugAdapter.ts', 'dist/debug/gdbDebugAdapter.js', '调试启动后注入的用户命令（applyDebugSettings）'],
  ['codeblocks.debug.instructionSet', 'src/debug/gdbDebugAdapter.ts', 'dist/debug/gdbDebugAdapter.js', '自定义反汇编指令集（applyDebugSettings）'],
  ['codeblocks.debug.charset', 'src/debug/gdbDebugAdapter.ts', 'dist/debug/gdbDebugAdapter.js', '目标字符集（applyDebugSettings）'],
  ['codeblocks.debug.addOtherProjectDirs', 'src/extension.ts', 'dist/extension.js', '调试源目录补其它已打开工程（debugSearchDirs）'],
  ['codeblocks.clangd.enabled', 'src/extension.ts', 'dist/extension.js', 'clangd 集成开关（关闭即早退，generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.buildLogDiagnostics', 'src/extension.ts', 'dist/extension.js', '构建日志诊断归属 clangd（buildLogUsesClangdDiagnostics）'],
  ['codeblocks.clangd.restartOnActiveProjectSwitch', 'src/extension.ts', 'dist/extension.js', '切换活动工程时重启 clangd（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.forcedIncludes', 'src/extension.ts', 'dist/extension.js', '强制包含头文件（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.suppressHeaderDiagnostics', 'src/extension.ts', 'dist/extension.js', '头文件诊断压制（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.unusedIncludes', 'src/extension.ts', 'dist/extension.js', '片段 Diagnostics.UnusedIncludes（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.headerInsertion', 'src/extension.ts', 'dist/extension.js', '片段 Completion.HeaderInsertion（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.indexBackground', 'src/extension.ts', 'dist/extension.js', '片段 Index.Background（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.indexStandardLibrary', 'src/extension.ts', 'dist/extension.js', '片段 Index.StandardLibrary（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.clangTidy', 'src/extension.ts', 'dist/extension.js', '片段 Diagnostics.ClangTidy.Remove（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.completionAllScopes', 'src/extension.ts', 'dist/extension.js', '片段 Completion.AllScopes（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.inlayHints', 'src/extension.ts', 'dist/extension.js', '片段 InlayHints.Enabled（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.documentationCommentFormat', 'src/extension.ts', 'dist/extension.js', '片段 Documentation.CommentFormat（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.excludeDirs', 'src/extension.ts', 'dist/extension.js', '片段 If.PathExclude（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.builtinHeaders', 'src/extension.ts', 'dist/extension.js', '片段 CompileFlags.BuiltinHeaders（generateClangdForWorkspaceInternal）'],
  ['codeblocks.clangd.extraConfig', 'src/extension.ts', 'dist/extension.js', '自由 YAML 注入 + 轻量校验提示（generateClangdForWorkspaceInternal）'],
  ['codeblocks.projectTree.categorize', 'src/extension.ts', 'dist/extension.js', '工程树分组显示开关（activate 内注册视图处）'],
  ['codeblocks.ui.projectToolbar', 'src/extension.ts', 'dist/extension.js', '工程工具栏按钮可见性（applyProjectToolbarContext）'],
  ['codeblocks.editor.autoHeaderGuard', 'src/extension.ts', 'dist/extension.js', '新建头文件自动加保护宏（autoInsertHeaderGuards）'],
  ['codeblocks.astyleOptions', 'src/tools/astyle.ts', 'dist/tools/astyle.js', 'AStyle 参数（formatActiveDocument）'],
  ['codeblocks.tools', 'src/extension.ts', 'dist/extension.js', '自定义工具表（菜单/执行，getMenuDynamicData）'],
];

// ---------- 静态读点 ----------
const fileCache = new Map();
const fileOf = (rel) => {
  if (!fileCache.has(rel)) fileCache.set(rel, read(rel));
  return fileCache.get(rel);
};
const lineOfKey = (rel, key) => {
  const bare = key.replace(/^codeblocks\./, '');
  const needle = new RegExp(`['"\`]${bare.replace(/\./g, '\\.')}['"\`]`);
  return fileOf(rel).split(/\r?\n/).findIndex((l) => needle.test(l)) + 1;
};
// 一行内是否是一次真实的配置取值调用（get / get<T>，或封装读取器 readStringArraySetting）
const isConfigRead = (line) => /\.get\s*(<[^>]*>)?\s*\(/.test(line) || /readStringArraySetting\s*\(/.test(line);
for (const [key, srcRel, distRel, note] of SETTINGS) {
  const atSrc = lineOfKey(srcRel, key);
  check(`S ${key}：源码读点在 ${srcRel}（${note}）`, atSrc > 0, atSrc || '未找到', `出现在 ${srcRel}`);
  if (atSrc > 0) {
    // 该键必须**在某处**被真实取值（.get(...)）；不要求是文件里的第一次出现——
    // 同一键也可能先出现在 .update(...)（例如命令写入设置）里，按「存在真实读点」判定更贴合意图
    const bare = key.replace(/^codeblocks\./, '');
    const needle = new RegExp(`['"\`]${bare.replace(/\./g, '\\.')}['"\`]`);
    const readLine = fileOf(srcRel).split(/\r?\n/).find((l) => needle.test(l) && isConfigRead(l));
    check(`S ${key}：读点是一次配置取值（非仅字符串出现）`, !!readLine, readLine ? readLine.trim() : '未找到 .get(...)/readStringArraySetting(...) 行', '.get(...) 调用');
  }
  check(`S ${key}：已接线到编译产物 ${distRel}`, lineOfKey(distRel, key) > 0, lineOfKey(distRel, key) || '未找到', distRel);
}

// ---------- 全覆盖断言：package.json 中的每个设置键都必须在源码中存在真实读取点 ----------
// 例外：
//  - ui.language 通过 i18n.LANGUAGE_SETTING 常量读取（src/i18n/index.ts）
//  - editor.asmHashComment 通过 ASM_HASH_COMMENT_SETTING 常量读取（src/tools/asmCommentConfig.ts）
//  - ui.symbolsView 仅由 package.json 视图 when 子句使用，不在代码中读取
const pkg = JSON.parse(read('package.json'));
const declaredKeys = pkg.contributes.configuration.flatMap((b) => Object.keys(b.properties || {}));
const srcFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.ts')) srcFiles.push(p);
  }
})(path.join(ROOT, 'src'));
const srcTexts = srcFiles.map((f) => fs.readFileSync(f, 'utf-8'));
// `const X_SETTING = 'compiler.customFlags'` + `.get(X_SETTING, ...)` 是推荐写法：
// 把常量名解析回键，避免「用常量读取」的设置被误判为无读点。
const settingConsts = new Map(); // 常量名 -> 设置键（去掉 codeblocks. 前缀）
for (const t of srcTexts) {
  for (const l of t.split(/\r?\n/)) {
    const m = l.match(/\bconst\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*string\s*)?=\s*['"`]([^'"`]+)['"`]/);
    if (m && m[2].includes('.')) settingConsts.set(m[1], m[2]);
  }
}
const readByLiteral = (bare) => {
  const needle = new RegExp(`['"\`]${bare.replace(/\./g, '\\.')}['"\`]`);
  const names = [...settingConsts].filter(([, v]) => v === bare).map(([k]) => k);
  const viaConst = names.length
    ? new RegExp(`\\.get\\s*(<[^>]*>)?\\s*\\(\\s*(?:${names.join('|')})\\b`)
    : null;
  return srcTexts.some((t) => t.split(/\r?\n/).some((l) =>
    (needle.test(l) && isConfigRead(l)) || (viaConst ? viaConst.test(l) : false)));
};
// 例外：ui.symbolsView 仅由 package.json 视图 when 子句使用，不在代码中读取
const readExceptions = new Set(['codeblocks.ui.symbolsView']);
const missingReads = declaredKeys.filter((k) => {
  if (readExceptions.has(k)) return false;
  return !readByLiteral(k.replace(/^codeblocks\./, ''));
});
check('全部设置键都有真实源码读取点（常量读取已解析；ui.symbolsView 仅 when 子句除外）',
  missingReads.length === 0, missingReads);
check('覆盖清单未引用已删除设置', !SETTINGS.some(([k]) => k === 'codeblocks.clangd.queryDriver'),
  SETTINGS.filter(([k]) => k === 'codeblocks.clangd.queryDriver'));

// ---------- 行为断言 ----------
(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-set-'));

  // 1) projectTree.categorize + tools + astyleOptions：模块直调（需先装 mock，避免模块加载期 require('vscode')）
  const { installVscodeMock } = require('./_harness/vscodeMock');
  const mock1 = installVscodeMock({ config: { 'codeblocks.projectTree.categorize': false } });
  const { ProjectTreeProvider } = require('../dist/ui/projectTreeProvider.js');
  const { ProjectParser } = require('../dist/model/parser.js');
  const { parseToolsSetting, buildToolInvocation } = require('../dist/tools/toolRunner.js');
  const astyle = require('../dist/tools/astyle.js');

  const cbpPath = path.join(tmp, 'demo.cbp');
  fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="demo" />
		<Option compiler="gcc" />
		<Build>
			<Target title="Debug">
				<Option output="bin/Debug/demo" prefix_auto="1" extension_auto="1" />
				<Option type="1" />
				<Option compiler="gcc" />
			</Target>
		</Build>
		<Unit filename="main.c" />
		<Unit filename="util.c" />
		<Extensions />
	</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  fs.writeFileSync(path.join(tmp, 'main.c'), 'int main(void){return 0;}\n', 'utf-8');
  fs.writeFileSync(path.join(tmp, 'util.c'), 'int add(int a,int b){return a+b;}\n', 'utf-8');
  const project = new ProjectParser().parse(cbpPath);
  const provider = new ProjectTreeProvider();
  provider.setProjects([project]);
  provider.setActiveProject(project);
  const labels = (nodes) => (nodes || []).map((n) => String(n.label && n.label.label ? n.label.label : n.label));
  const rootNodes = provider.getChildren(undefined) || [];
  const projectNode = rootNodes.find((n) => n.kind === 'project' || /demo/.test(labels([n])[0] || '')) || rootNodes[0];
  provider.setCategorize(false);
  const flat = labels(provider.getChildren(projectNode));
  provider.setCategorize(true);
  const grouped = labels(provider.getChildren(projectNode));
  check('S projectTree.categorize：切换后子节点结构变化（平铺 vs 分组）',
    flat.length > 0 && JSON.stringify(flat) !== JSON.stringify(grouped),
    { root: labels(rootNodes), flat, grouped }, '平铺 ≠ 分组');

  const parsed = parseToolsSetting([
    { name: 'size', command: 'size', arguments: '"${file}"', save: 'current' },
    { name: 'nm', command: 'nm', arguments: '-C', save: 'none' },
  ]);
  check('S tools：设置解析为工具表（≥2 项且名称匹配）',
    Array.isArray(parsed) && parsed.length === 2 && parsed[0].name === 'size' && parsed[1].command === 'nm',
    parsed && parsed.map((p) => [p.name, p.command]), '[size, nm]');
  const inv = buildToolInvocation(parsed[0], { file: 'C:\\tmp\\a.c', fileDir: 'C:\\tmp', projectDir: 'C:\\tmp', projectName: 'demo', vars: {}, customVars: {} });
  check('S tools：工具调用展开 ${file} 别名', JSON.stringify(inv).includes('a.c'), inv, '含 a.c');
  check('S astyleOptions：astyle 模块导出格式化入口', typeof astyle.formatActiveDocument === 'function', Object.keys(astyle).slice(0, 6), 'formatActiveDocument');

  // 4) ui.projectToolbar + editor.autoHeaderGuard + clangd.enabled：激活后行为
  const app = await activate({
    tmpDir: tmp,
    config: {
      'codeblocks.ui.projectToolbar': ['build', 'run', 'codeStats'],
      'codeblocks.editor.autoHeaderGuard': true,
      'codeblocks.clangd.enabled': false,
    },
  });
  const tb = app.records.setContext.filter((a) => /^codeblocks\.tb\./.test(String(a[0])));
  check('S ui.projectToolbar：激活时写入工具栏上下文（setContext codeblocks.tb.*）',
    tb.length >= 3, tb.slice(0, 5), '≥3 条');
  check('S ui.projectToolbar：上下文值随配置解析为布尔',
    tb.every((a) => typeof a[1] === 'boolean'), tb.slice(0, 3), 'boolean');

  const hdr = path.join(tmp, 'guard.h');
  fs.writeFileSync(hdr, '', 'utf-8');   // 仅「新建的空头文件」会插入保护宏
  app.events.createFiles.fire({ files: [{ scheme: 'file', fsPath: hdr }] });
  await new Promise((r) => setTimeout(r, 300));
  const guardEdit = JSON.stringify(app.records.appliedEdits);
  check('S editor.autoHeaderGuard：新建空头文件触发保护宏编辑（#ifndef/#pragma once）',
    /#ifndef|#pragma once/.test(guardEdit), guardEdit.slice(0, 160), '#ifndef/#pragma once');
  const nonHdr = path.join(tmp, 'guard.c');
  fs.writeFileSync(nonHdr, '', 'utf-8');
  const before = app.records.appliedEdits.length;
  app.events.createFiles.fire({ files: [{ scheme: 'file', fsPath: nonHdr }] });
  await new Promise((r) => setTimeout(r, 200));
  check('S editor.autoHeaderGuard：非头文件不插入', app.records.appliedEdits.length === before, app.records.appliedEdits.length, before);

  check('S clangd.enabled：关闭时不产生 clangd 用户配置写入（零副作用）',
    !app.records.executeCommand.some((c) => /clangd/.test(c.id)), app.records.executeCommand.length, '无 clangd 命令');
  await app.deactivate().catch(() => undefined);

  console.log(`\n设置项覆盖回归: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('设置项覆盖回归异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
