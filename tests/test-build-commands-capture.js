// 第六轮 F8：BuildEngine.lastCommands 命令采集回归（HTML 构建日志 full_command_line 数据源）
// 真实 gcc + 扩展 dist 引擎直跑（stub vscode，parallelJobs=1 串行）：
//  - 采集：编译命令（-c/源文件）、链接命令（-o/输出名）、项目 pre-build 脚本命令（ExtraCommands）
//  - 顺序：pre 脚本 → 编译 → 链接
//  - 重置：连续第二次 build() 不累计上一轮命令（lastCommands 每轮清空）
const Module = require('module');
const origLoad = Module._load;
let parallelJobs = 1;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k === 'parallelJobs' ? parallelJobs : d) }) },
      window: { showWarningMessage: () => {} },
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
const { ProjectParser } = require('../dist/model/parser.js');
const { BuildEngine } = require('../dist/build/buildEngine.js');
const { createGccCompiler } = require('../dist/compiler/compiler.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cap-'));
  fs.writeFileSync(path.join(dir, 'captest.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="captest" />
\t\t<Option compiler="gcc" />
\t\t<ExtraCommands>
\t\t\t<Add before="echo PRE_BUILD" />
\t\t</ExtraCommands>
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option output="bin/Debug/captest" prefix_auto="1" extension_auto="1" />
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Extensions />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  fs.writeFileSync(path.join(dir, 'main.c'), 'int main(void) { return 0; }\n');
  return dir;
}

(async () => {
  const dir = makeProject();
  const log = [];
  const out = {
    info: (s) => log.push(String(s)),
    warn: (s) => log.push(String(s)),
    error: (s) => log.push(String(s)),
    debug: () => {},
    append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {},
  };
  const project = new ProjectParser().parse(path.join(dir, 'captest.cbp'));
  const compiler = createGccCompiler('win32');
  const engine = new BuildEngine(project, compiler, out, (id) => (id === 'gcc' ? compiler : undefined));

  const ok1 = await engine.build('Debug', {});
  const cmds1 = [...engine.lastCommands];
  check('A: 首次构建成功', ok1 === true, ok1);
  check('B: 采集到编译命令（-c + main.c）', cmds1.some((c) => c.includes('-c') && c.includes('main.c')), cmds1);
  check('C: 采集到链接命令（-o + 输出名 captest）', cmds1.some((c) => c.includes('-o') && c.includes('captest')), cmds1);
  check('D: 采集到项目 pre-build 脚本命令', cmds1.some((c) => c.includes('echo PRE_BUILD')), cmds1);
  const iPre = cmds1.findIndex((c) => c.includes('echo PRE_BUILD'));
  const iCompile = cmds1.findIndex((c) => c.includes('-c') && c.includes('main.c'));
  const iLink = cmds1.findIndex((c) => c.includes('-o') && c.includes('captest'));
  check('E: 顺序 pre → 编译 → 链接', iPre >= 0 && iPre < iCompile && iCompile < iLink, { iPre, iCompile, iLink });

  // 第二次构建：lastCommands 每轮重置（pre 命令只应出现一次）
  const ok2 = await engine.build('Debug', {});
  const preCount = engine.lastCommands.filter((c) => c.includes('echo PRE_BUILD')).length;
  check('F: 二次构建仍成功', ok2 === true, ok2);
  check('G: lastCommands 每轮重置（pre 命令不累计）', preCount === 1, { preCount, all: engine.lastCommands });

  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`构建命令采集回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
