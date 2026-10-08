// A2 回归：仅对过期/强制单元生成编译命令（对齐 GetTargetCompileCommands:558
// 「force || IsObjectOutdated → GetCompileFileCommand」；up-to-date 文件不生成命令——原实现先生成后丢弃）。
// 行为探针：打桩 CommandGenerator.prototype.generate 记录调用（返回廉价 echo 命令避免真实编译）。
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: () => undefined }) },
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

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// 打桩：记录命令生成调用；返回廉价命令（不真实编译）
const genCalls = [];
const origGenerate = CommandGenerator.prototype.generate;
CommandGenerator.prototype.generate = function (commandType, params) {
  genCalls.push({ type: commandType, file: params && params.file });
  return 'echo lazy-gen-probe';
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-lazy-'));
const cbpPath = path.join(dir, 'lazy.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
	<FileVersion major="1" minor="6" />
	<Project>
		<Option title="lazy" />
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

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
const logs = [];
const out = {
  info: (l) => logs.push('i|' + l),
  warn: (l) => logs.push('w|' + l),
  error: (l) => logs.push('e|' + l),
  debug: (l) => logs.push('d|' + l),
  append() {}, clear() {}, show() {}, hide() {}, dispose() {},
};
const engine = new BuildEngine(project, compiler, out, (id) => compiler);

// 准备：源（旧）→ 对象（中）→ 输出（新）＝全部 up-to-date
const src = path.join(dir, 'main.c');
const objPath = path.join(dir, 'obj', 'Debug', 'main.o');
const outPath = path.join(dir, 'bin', 'Debug', 'app');
const now = Date.now();
fs.writeFileSync(src, 'int main(void){return 0;}\n');
fs.utimesSync(src, new Date(now - 60000), new Date(now - 60000));
fs.mkdirSync(path.dirname(objPath), { recursive: true });
fs.writeFileSync(objPath, 'obj');
fs.utimesSync(objPath, new Date(now - 30000), new Date(now - 30000));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, 'exe');
fs.utimesSync(outPath, new Date(now), new Date(now));

(async () => {
  // ---------- 阶段 1：全部 up-to-date → 不生成任何命令 ----------
  genCalls.length = 0;
  logs.length = 0;
  const ok1 = await engine.build('Debug', {});
  check('P1 全部 up-to-date：build 返回 true（跳过 + 链接最新）', ok1 === true, ok1, true);
  check('P1 未生成任何编译命令（A2 核心）', genCalls.length === 0, genCalls, []);
  check('P1 仍输出 [Skipping] (up to date) 日志（行为保留）',
    logs.includes('d|[Skipping] main.c (up to date)'), logs.filter((l) => l.includes('Skipping')), 'd|[Skipping] main.c (up to date)');

  // ---------- 阶段 2：源变新 → 恰好生成 1 条命令 ----------
  fs.writeFileSync(src, 'int main(void){return 1;}\n');
  fs.utimesSync(src, new Date(now + 5000), new Date(now + 5000));
  genCalls.length = 0;
  logs.length = 0;
  const ok2 = await engine.build('Debug', {});
  check('P2 源过期：build 返回 true（探针命令执行成功）', ok2 === true, ok2, true);
  const compiles2 = genCalls.filter((c) => c.file && /main\.c$/.test(String(c.file)));
  check('P2 恰好生成 1 条编译命令（仅过期文件）', compiles2.length === 1, compiles2, 1);
  check('P2 生成对象为 main.c', compiles2[0] && /main\.c$/.test(String(compiles2[0].file)), compiles2[0], '…main.c');
  // 条目计数强制重链（对齐 GetTargetCompileCommands:585）：编译阶段产生条目 → 链接命令被生成
  check('P2 编译条目触发链接命令生成（条目计数语义保留）', genCalls.some((c) => c.file === ''), genCalls, '至少 1 条链接生成');
  check('P2 不再输出 [Skipping] up to date 行', !logs.some((l) => l.includes('(up to date)')), logs.filter((l) => l.includes('Skipping')), '（无）');

  // ---------- 阶段 3：rebuild（强制）→ 生成命令（对象被 clean 后重建） ----------
  genCalls.length = 0;
  const ok3 = await engine.build('Debug', { rebuild: true });
  check('P3 rebuild：生成命令（≥1 条，强制路径保留）', ok3 === true && genCalls.length >= 1, { ok: ok3, calls: genCalls.length }, 'true, >=1');

  // ---------- 阶段 4：静态接线 ----------
  const engineJs = fs.readFileSync(path.join(__dirname, '..', 'dist', 'build', 'buildEngine.js'), 'utf-8');
  check('P4 isCompileCandidate 定义且用于分类与收集循环（≥2 处）',
    (engineJs.match(/isCompileCandidate\(target, file\)/g) || []).length >= 2,
    (engineJs.match(/isCompileCandidate\(target, file\)/g) || []).length, '>=2');

  CommandGenerator.prototype.generate = origGenerate;
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\nlazy-command-gen 回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})();
