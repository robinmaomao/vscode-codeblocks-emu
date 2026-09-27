// L9 回归：响应文件 cb 模式（codeblocks.build.responseFile=cb）
// 对齐 CB：阈值 32767、命名 main.respFile（SetExt 替换扩展名）、相对路径引用
const Module = require('module');
const origLoad = Module._load;
const cfgMap = {};
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      workspace: { getConfiguration: () => ({ get: (k, d) => (k in cfgMap ? cfgMap[k] : d) }) },
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
const { applyResponseFile, CB_MAX_CMD_LENGTH } = require('../dist/build/commandLine.js');

let pass = 0, fail = 0;
function check(name, cond, got) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got)); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-l9-'));
const mid = 'gcc.exe ' + Array.from({ length: 600 }, (_, i) => `-I0123456789/${i}`).join(' '); // ~10k
const long = 'gcc.exe ' + Array.from({ length: 2500 }, (_, i) => `-Ivery/long/include/dir/number/${i}`).join(' '); // >32767

// cb 模式
cfgMap['build.responseFile'] = 'cb';
{
  const r1 = applyResponseFile(mid, 'obj\\Debug\\main.c', dir);
  check('cb: 10097 字符不拆（阈值 32767）', r1.respFile === undefined, r1.command.length);
}
{
  const r2 = applyResponseFile(long, 'obj\\Debug\\main.c', dir);
  const wantName = path.join(dir, 'obj', 'Debug', 'main.respFile');
  check('cb: 超长拆分', r2.respFile === wantName, r2.respFile);
  check('cb: 命名 main.respFile（扩展名被替换）', !!r2.respFile && r2.respFile.endsWith('main.respFile'), r2.respFile);
  check('cb: 命令引用相对路径', r2.command.includes(' @"obj\\Debug\\main.respFile"'), r2.command);
  check('cb: 响应文件存在且内容为剩余参数', !!r2.respFile && fs.existsSync(r2.respFile) && fs.readFileSync(r2.respFile, 'utf8').startsWith('-Ivery'), r2.respFile && fs.existsSync(r2.respFile) ? fs.readFileSync(r2.respFile, 'utf8').slice(0, 80) : null);
  check('cb: 阈值常量 = 32767', CB_MAX_CMD_LENGTH === 32767, CB_MAX_CMD_LENGTH);
}
delete cfgMap['build.responseFile'];

// safe 默认回归（简短）：超长拆分 + 保留扩展名
{
  const r3 = applyResponseFile(long, 'obj\\Debug\\main.c', dir);
  check('safe: 命名 main.c.respFile（保留扩展名）', !!r3.respFile && r3.respFile.endsWith('main.c.respFile'), r3.respFile);
  check('safe: 引用绝对路径', r3.command.includes(`@"${r3.respFile}"`), r3.command.slice(-80));
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`resp-cb-mode: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
