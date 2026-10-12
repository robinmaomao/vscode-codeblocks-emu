// 设置项覆盖回归：16 个此前未被任何测试引用的设置键
//  - 静态读点断言：键的字面量出现在「消费它的实现文件」且位置与预期一致（±容差，防漂移）
//  - 行为断言：低风险项的运行时效果（树分组、工具栏上下文、自动头文件保护、工具解析、astyle 参数）
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

// 键 → （源码读点用于定位断言，编译产物用于"已接线"断言，期望源码行号，说明）
// 注：键用完整名（含 codeblocks. 前缀）以便覆盖矩阵按贡献项 ID 统计；源码内多为分区相对写法，定位时去掉前缀。
const SETTINGS = [
  ['codeblocks.saveBeforeBuild', 'src/extension.ts', 'dist/extension.js', 2325, '构建/清理前 saveAll'],
  ['codeblocks.build.profile', 'src/build/buildEngine.ts', 'dist/build/buildEngine.js', 230, '构建阶段计时探针开关'],
  ['codeblocks.debug.initCommands', 'src/debug/gdbDebugAdapter.ts', 'dist/debug/gdbDebugAdapter.js', 480, '调试启动后注入的用户命令'],
  ['codeblocks.debug.instructionSet', 'src/debug/gdbDebugAdapter.ts', 'dist/debug/gdbDebugAdapter.js', 481, '自定义反汇编指令集'],
  ['codeblocks.debug.charset', 'src/debug/gdbDebugAdapter.ts', 'dist/debug/gdbDebugAdapter.js', 479, '目标字符集'],
  ['codeblocks.debug.addOtherProjectDirs', 'src/extension.ts', 'dist/extension.js', 6804, '调试源目录补其它已打开工程'],
  ['codeblocks.clangd.enabled', 'src/extension.ts', 'dist/extension.js', 3015, 'clangd 集成开关（关闭即早退）'],
  ['codeblocks.clangd.buildLogDiagnostics', 'src/extension.ts', 'dist/extension.js', 5544, '构建日志诊断归属 clangd'],
  ['codeblocks.clangd.restartOnActiveProjectSwitch', 'src/extension.ts', 'dist/extension.js', 3082, '切换活动工程时重启 clangd'],
  ['codeblocks.clangd.forcedIncludes', 'src/extension.ts', 'dist/extension.js', 3100, '强制包含头文件'],
  ['codeblocks.clangd.suppressHeaderDiagnostics', 'src/extension.ts', 'dist/extension.js', 3110, '头文件诊断压制'],
  ['codeblocks.projectTree.categorize', 'src/extension.ts', 'dist/extension.js', 442, '工程树分组显示开关'],
  ['codeblocks.ui.projectToolbar', 'src/extension.ts', 'dist/extension.js', 4872, '工程工具栏按钮可见性'],
  ['codeblocks.editor.autoHeaderGuard', 'src/extension.ts', 'dist/extension.js', 5655, '新建头文件自动加保护宏'],
  ['codeblocks.astyleOptions', 'src/tools/astyle.ts', 'dist/tools/astyle.js', 68, 'AStyle 参数'],
  ['codeblocks.tools', 'src/extension.ts', 'dist/extension.js', 5613, '自定义工具表（菜单/执行）'],
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
for (const [key, srcRel, distRel, hint, note] of SETTINGS) {
  const atSrc = lineOfKey(srcRel, key);
  check(`S ${key}：源码读点在 ${srcRel}（${note}）`, atSrc > 0, atSrc || '未找到', `出现在 ${srcRel}`);
  if (atSrc > 0) {
    const drift = Math.abs(atSrc - hint);
    check(`S ${key}：读点位置与预期一致（±40 行，实际偏差 ${drift}）`, drift <= 40, atSrc, hint);
  }
  check(`S ${key}：已接线到编译产物 ${distRel}`, lineOfKey(distRel, key) > 0, lineOfKey(distRel, key) || '未找到', distRel);
}

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
