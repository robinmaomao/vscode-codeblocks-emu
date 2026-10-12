// 输出路径解析回归（第四十九轮修复 + D-13）：
//  - Windows 无扩展名可执行输出 → .exe 回退（对齐 MinGW 链接器实际行为）
//  - 仅 exe 类型（Console/Executable/Native）回退；非 Windows 不回退
//  - D-13：`extension_auto`（平台默认扩展名）补全 —— TCC 等「-o 不补扩展名」的工具链也产出可启动文件；
//    以及启动前的「无扩展名 ⇒ 无法启动」判定（供 Run/Debug 给出可读提示）
//  - 运行/调试与链接时间戳检查共用同一解析（src/build/outputPath.ts）
const fs = require('fs');
const os = require('os');
const path = require('path');
const { executableCandidates, isExecutableTargetType, resolveExecutablePath, withPlatformExtension, requiresExecutableExtensionForLaunch } = require('../dist/build/outputPath.js');
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

// ---- 4. 平台默认扩展名补全（D-13：TCC 等「-o 不补扩展名」的工具链） ----
check('win32 + exe 类 + extension_auto + 无扩展名 → 补 .exe',
  withPlatformExtension('bin/Debug/prog', 'win32', true, true) === 'bin/Debug/prog.exe', 'n/a', 'bin/Debug/prog.exe');
check('已有扩展名（.elf）→ 不动',
  withPlatformExtension('bin/Debug/prog.elf', 'win32', true, true) === 'bin/Debug/prog.elf', 'n/a', 'prog.elf');
check('带点目录不影响判定',
  withPlatformExtension('bin.v2/Debug/prog', 'win32', true, true) === 'bin.v2/Debug/prog.exe', 'n/a', 'bin.v2/Debug/prog.exe');
check('extension_auto 关闭 → 不补',
  withPlatformExtension('bin/Debug/prog', 'win32', true, false) === 'bin/Debug/prog', 'n/a', 'prog');
check('非 exe 类型（静态库/动态库）→ 不补',
  withPlatformExtension('bin/Debug/libx.a', 'win32', false, true) === 'bin/Debug/libx.a', 'n/a', 'libx.a');
check('非 Windows → 不补',
  withPlatformExtension('bin/prog', 'linux', true, true) === 'bin/prog', 'n/a', 'prog');
check('空输出 → 不补', withPlatformExtension('', 'win32', true, true) === '', 'n/a', '空');

// ---- 5. 启动前扩展名判定（Run/Debug 可读提示；D-13） ----
check('无扩展名产物 → 需要提示（win32）', requiresExecutableExtensionForLaunch('E:\\p\\bin\\prog', 'win32') === true);
check('.exe 产物 → 不提示', requiresExecutableExtensionForLaunch('E:\\p\\bin\\prog.exe', 'win32') === false);
check('非 Windows → 不提示', requiresExecutableExtensionForLaunch('/p/bin/prog', 'linux') === false);

console.log(`输出路径解析回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
