// 输出路径解析回归（第四十九轮修复）：
//  - Windows 无扩展名可执行输出 → .exe 回退（对齐 MinGW 链接器实际行为）
//  - 仅 exe 类型（Console/Executable/Native）回退；非 Windows 不回退
//  - 运行/调试与链接时间戳检查共用同一解析（src/build/outputPath.ts）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executableCandidates, isExecutableTargetType, resolveExecutablePath } = require('../dist/build/outputPath.js');
const { TargetType } = require('../dist/model/types.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---- 1. 类型判定 ----
check('exe 类型判定（3 类为真，其余为假）',
  isExecutableTargetType(TargetType.ConsoleOnly) && isExecutableTargetType(TargetType.Executable) &&
  isExecutableTargetType(TargetType.Native) && !isExecutableTargetType(TargetType.StaticLib) &&
  !isExecutableTargetType(TargetType.DynamicLib) && !isExecutableTargetType(TargetType.CommandsOnly),
  'n/a', 'exe 三类');

// ---- 2. 候选路径 ----
const cand = executableCandidates('E:\\proj', 'bin/Debug/hello', 'win32', true);
check('win32 exe → 两个候选（含 .exe）', cand.length === 2 && cand[1].endsWith('hello.exe'), cand, '2 项');
check('非 Windows → 单候选', executableCandidates('/p', 'bin/hello', 'linux', true).length === 1, 'n/a', 1);
check('win32 非 exe 类型 → 单候选', executableCandidates('E:\\p', 'bin/dep_lib.a', 'win32', false).length === 1, 'n/a', 1);

// ---- 3. 真实文件解析（临时目录）----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cbout-'));
try {
  fs.writeFileSync(path.join(tmp, 'app.exe'), '');
  check('存在 .exe → 解析到 .exe', resolveExecutablePath(tmp, 'app', 'win32', true) === path.join(tmp, 'app.exe'), 'n/a', 'app.exe');
  check('均缺失 → 返回首个候选（原路径）', resolveExecutablePath(tmp, 'nope', 'win32', true) === path.join(tmp, 'nope'), 'n/a', 'nope');
  fs.writeFileSync(path.join(tmp, 'plain'), '');
  check('裸文件存在 → 优先裸路径', resolveExecutablePath(tmp, 'plain', 'win32', true) === path.join(tmp, 'plain'), 'n/a', 'plain');
  check('非 Windows 不回退 .exe', resolveExecutablePath(tmp, 'app', 'linux', true) === path.join(tmp, 'app'), 'n/a', 'app');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`输出路径解析回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
