// 响应文件修复回归：
//  A. linkRespBase：对象输出目录为空 → `.objs`（对齐 GetObjectOutput）；有值原样
//  B. cleanResponseFiles 开关（默认关）：开启时 cleanTarget 删除对象目录下 *.respFile（含嵌套）；关闭时保留；非响应文件不受影响
//  C. 接线：dist 读取 'build.cleanResponseFiles' 并使用 linkRespBase
const Module = require('module');
const origLoad = Module._load;
const settings = { parallelJobs: 1 };
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k in settings ? settings[k] : d) }) },
      window: { showWarningMessage: () => {}, showInformationMessage: () => {} },
      env: {},
      Uri: { file: (p) => ({ fsPath: p }) },
      Position: class { constructor(l, c) { this.line = l; this.character = c; } },
      Range: class { constructor(a, b) { this.start = a; this.end = b; } },
      Diagnostic: class {},
      DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
      ConfigurationTarget: { Global: 1 },
      LogOutputChannel: class {},
      workspaceState: {},
      debug: { activeDebugSession: undefined },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { linkRespBase } = require('../dist/build/commandLine.js');
const { ProjectParser } = require('../dist/model/parser.js');
const { BuildEngine } = require('../dist/build/buildEngine.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

// ---- A. linkRespBase（对齐 CB GetObjectOutput 的空值默认 .objs） ----
check('linkRespBase：objectOutput 为空 → .objs',
  linkRespBase('E:/proj', '', 'Debug') === path.join('E:/proj', '.objs', 'Debug_link'),
  linkRespBase('E:/proj', '', 'Debug'));
check('linkRespBase：有 objectOutput 时原样使用',
  linkRespBase('E:/proj', 'obj/Debug', 'Debug') === path.join('E:/proj', 'obj/Debug', 'Debug_link'),
  linkRespBase('E:/proj', 'obj/Debug', 'Debug'));

// ---- 搭最小项目（不带 object_output → 默认 .objs） ----
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-respfile-'));
fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void) { return 0; }\n');
fs.writeFileSync(path.join(dir, 'app.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="app" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/app" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');

const project = new ProjectParser().parse(path.join(dir, 'app.cbp'));
const compiler = createGccCompiler('win32');
const out = { info() {}, warn() {}, error() {}, debug() {}, append() {}, clear() {}, show() {}, hide() {}, dispose() {} };
const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));
const target = project.buildTargets[0];

const objDir = path.join(dir, '.objs');
const linkResp = path.join(objDir, 'Debug_link.respFile');
const nestedResp = path.join(objDir, 'sub', 'main.c.respFile');
const keepFile = path.join(objDir, 'keep.txt');
const mkStale = () => {
  fs.mkdirSync(path.join(objDir, 'sub'), { recursive: true });
  fs.writeFileSync(linkResp, 'Output\\obj\\a.o\n');
  fs.writeFileSync(nestedResp, 'x\n');
  fs.writeFileSync(keepFile, 'not a resp file\n');
};

// ---- B1. 默认关闭：cleanTarget 保留响应文件 ----
mkStale();
engine.cleanTarget(target);
check('默认关闭：链接响应文件保留', fs.existsSync(linkResp), { linkResp });
check('默认关闭：嵌套编译响应文件保留', fs.existsSync(nestedResp), null);
check('默认关闭：非响应文件不受影响', fs.existsSync(keepFile), null);

// ---- B2. 开启开关：cleanTarget 删除（含嵌套），非响应文件保留 ----
settings['build.cleanResponseFiles'] = true;
engine.cleanTarget(target);
check('开启后：链接响应文件删除', !fs.existsSync(linkResp), { linkResp });
check('开启后：嵌套编译响应文件删除', !fs.existsSync(nestedResp), null);
check('开启后：非响应文件仍保留', fs.existsSync(keepFile), null);

// ---- C. 接线（dist 静态断言） ----
const distEngine = fs.readFileSync(path.resolve(__dirname, '../dist/build/buildEngine.js'), 'utf-8');
check('dist：读取 build.cleanResponseFiles', distEngine.includes("'build.cleanResponseFiles'"), null);
check('dist：使用 linkRespBase（A 修复接线）', distEngine.includes('linkRespBase'), null);

console.log(`响应文件修复回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
