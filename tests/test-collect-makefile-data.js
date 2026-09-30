// BuildEngine.collectMakefileData（Wave 3 B3/B4 数据源）回归
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

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-mkdata-'));
const cbpPath = path.join(dir, 'mkdata.cbp');
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="mkdata" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Win">
\t\t\t\t<Option output="bin/Win/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Win/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Unit filename="util.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void){return 0;}\n');
fs.writeFileSync(path.join(dir, 'util.c'), 'int u(void){return 1;}\n');

const project = new ProjectParser().parse(cbpPath);
const compiler = createGccCompiler('win32');
const out = { info() {}, warn() {}, error() {}, debug() {}, append() {}, clear() {}, show() {}, hide() {}, dispose() {} };
const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));

const data = engine.collectMakefileData();
check('目标数量 = 1', data.length === 1, data.length);
const t = data[0];
check('编译单元 = 2', t.compile.length === 2, t.compile.map((c) => path.basename(c.source)));
check('编译命令含 gcc.exe', t.compile[0].command.includes('gcc.exe'), t.compile[0].command);
check('对象路径在对象目录下', t.compile[0].object.includes(path.join('obj', 'Win')), t.compile[0].object);
check('链接命令存在', !!t.link && t.link.command.includes('gcc.exe'), t.link && t.link.command);
check('链接对象 = 2', !!t.link && t.link.objects.length === 2, t.link && t.link.objects);
check('输出为 bin/Win/app.exe', t.output.replace(/\\/g, '/').endsWith('bin/Win/app.exe'), t.output);

// 静态库目标：archive 命令用 ar
fs.writeFileSync(cbpPath, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="libdata" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Lib">
\t\t\t\t<Option output="bin/Lib/libdemo" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="2" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="util.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
const project2 = new ProjectParser().parse(cbpPath);
const engine2 = new BuildEngine(project2, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
const data2 = engine2.collectMakefileData();
check('静态库目标 archive 命令', data2.length === 1 && !!data2[0].link && data2[0].link.kind === 'archive', data2[0] && data2[0].link);
check('静态库输出 .a', data2[0].output.replace(/\\/g, '/').endsWith('.a'), data2[0].output);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`collectMakefileData: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
