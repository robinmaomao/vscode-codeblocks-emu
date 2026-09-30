// 编译器版本号模块级缓存回归（审计 P2.2）：
//  - 同 exe 重复查询只 spawn 一次（含负结果缓存）
//  - exe mtime 变化 → 新 key 重新查询（编译器升级自动失效）
//  - clearCompilerVersionCache() 强制刷新
//  - programs.C 缺失 → undefined 且不 spawn
const Module = require('module');
const origLoad = Module._load;
let spawnCalls = 0;
let throwFor = null;
Module._load = function (request, parent, isMain) {
  if (request === 'child_process') {
    return {
      spawnSync: (exe) => {
        spawnCalls++;
        if (throwFor && exe === throwFor) throw new Error('spawn failed');
        return { stdout: 'gcc (fake) 1.2.3\nsecond line\n' };
      },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const os = require('os');
const path = require('path');
const { queryCompilerVersionString, clearCompilerVersionCache } = require('../dist/compiler/compilerVersion.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + (extra !== undefined ? '  got=' + JSON.stringify(extra) : '')); }
}

// 1. 首次查询 → spawn 一次；结果解析
spawnCalls = 0;
const fakeCompiler = { programs: { C: 'gcc-fake' }, masterPath: '' };
let v = queryCompilerVersionString(fakeCompiler);
check('首次查询返回 x.y.z', v === '1.2.3', v);
check('首次查询 spawn 恰一次', spawnCalls === 1, spawnCalls);

// 2. 同 key 重复查询 → 命中缓存（不再 spawn）
v = queryCompilerVersionString(fakeCompiler);
check('重复查询命中缓存（spawn 仍 1 次）', v === '1.2.3' && spawnCalls === 1, { v, spawnCalls });

// 3. 负结果缓存：spawn 抛异常 → undefined，且第二次不再 spawn
spawnCalls = 0;
throwFor = 'gcc-throw';
const throwCompiler = { programs: { C: 'gcc-throw' }, masterPath: '' };
check('spawn 异常 → undefined', queryCompilerVersionString(throwCompiler) === undefined);
const callsAfterThrow = spawnCalls;
queryCompilerVersionString(throwCompiler);
check('负结果同样缓存（不重复 spawn）', spawnCalls === callsAfterThrow && callsAfterThrow === 1, { callsAfterThrow, spawnCalls });
throwFor = null;

// 4. mtime 变化 → 新 key 重新查询
spawnCalls = 0;
const tmpExe = path.join(os.tmpdir(), 'cb-fake-cc-' + process.pid + '.exe');
fs.writeFileSync(tmpExe, 'fake');
const mtimeCompiler = { programs: { C: tmpExe }, masterPath: '' };
queryCompilerVersionString(mtimeCompiler);
check('绝对路径首次查询 spawn 一次', spawnCalls === 1, spawnCalls);
queryCompilerVersionString(mtimeCompiler);
check('同 mtime 命中缓存', spawnCalls === 1, spawnCalls);
const future = new Date(Date.now() + 5000);
fs.utimesSync(tmpExe, future, future);
queryCompilerVersionString(mtimeCompiler);
check('mtime 变化 → 重新查询（spawn 2 次）', spawnCalls === 2, spawnCalls);
try { fs.unlinkSync(tmpExe); } catch { /* ignore */ }

// 5. clearCompilerVersionCache 强制刷新
spawnCalls = 0;
queryCompilerVersionString(fakeCompiler);
queryCompilerVersionString(fakeCompiler);
const beforeClear = spawnCalls;
clearCompilerVersionCache();
queryCompilerVersionString(fakeCompiler);
check('clear 后重新 spawn', spawnCalls === beforeClear + 1, { beforeClear, spawnCalls });

// 6. programs.C 缺失 → undefined 且不 spawn
spawnCalls = 0;
check('无 C 程序 → undefined', queryCompilerVersionString({ programs: {}, masterPath: '' }) === undefined);
check('无 C 程序不 spawn', spawnCalls === 0, spawnCalls);

console.log(`编译器版本缓存回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
