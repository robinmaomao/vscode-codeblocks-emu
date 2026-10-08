// X1 回归：缺 compiler 属性的工程/目标不再按「无效编译器」处理 ——
// 对齐 CB projectloader.cpp:396 缺省 "gcc"（无 <Option> 节点时 cbproject.cpp:69 构造默认）；
// 'gcc' 未注册时保护性回退设置 codeblocks.compilerId。纯模块 src/compiler/compilerRegistry.ts。
const fs = require('fs');
const path = require('path');
const { compilerIdCandidates, findRegisteredCompilerId, resolveEffectiveCompilerId } = require('../dist/compiler/compilerRegistry.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// ---------- A. 候选序列（对齐 compilerfactory.cpp:42-58：原样 → 小写 → 去 '-'） ----------
check('A1 大写候选：原样 + 小写（去重保序）', JSON.stringify(compilerIdCandidates('GCC')) === JSON.stringify(['GCC', 'gcc']), compilerIdCandidates('GCC'), ['GCC', 'gcc']);
check('A2 连字符候选：追加去 "-" 变体', JSON.stringify(compilerIdCandidates('riscv32-v3')) === JSON.stringify(['riscv32-v3', 'riscv32v3']), compilerIdCandidates('riscv32-v3'), ['riscv32-v3', 'riscv32v3']);
check('A3 全小写无连字符：仅一项', JSON.stringify(compilerIdCandidates('gcc')) === JSON.stringify(['gcc']), compilerIdCandidates('gcc'), ['gcc']);
check('A4 空串：无候选', compilerIdCandidates('').length === 0, compilerIdCandidates(''), []);

// ---------- B. 注册判定 ----------
const depsResource = {
  configuredId: () => 'gcc',
  isRegistered: () => false,
  hasResourceFile: (n) => n === 'options_gcc.xml',
};
check('B1 设置值命中（configured=gcc）', findRegisteredCompilerId('gcc', depsResource) === 'gcc', findRegisteredCompilerId('gcc', depsResource), 'gcc');
check('B2 大小写不敏感经资源文件物化（GCC → 候选 gcc 命中，返回原候选）', findRegisteredCompilerId('GCC', depsResource) === 'GCC', findRegisteredCompilerId('GCC', depsResource), 'GCC');
check('B3 未注册 ID 返回 undefined（保持无效编译器语义）', findRegisteredCompilerId('riscv32-v3', depsResource) === undefined, findRegisteredCompilerId('riscv32-v3', depsResource), undefined);

const depsUser = {
  configuredId: () => 'riscv32-v3',
  isRegistered: (id) => id === 'riscv32-v3',
  hasResourceFile: () => false,
};
check('B4 用户编译器命中（default.conf 用户集）', findRegisteredCompilerId('riscv32-v3', depsUser) === 'riscv32-v3', findRegisteredCompilerId('riscv32-v3', depsUser), 'riscv32-v3');
check('B5 空串无候选 → undefined', findRegisteredCompilerId('', depsUser) === undefined, findRegisteredCompilerId('', depsUser), undefined);

// ---------- C. 有效 ID 解析（空 ID 缺省链） ----------
check('C1 非空 ID 原样返回', resolveEffectiveCompilerId('OW', depsResource) === 'OW', resolveEffectiveCompilerId('OW', depsResource), 'OW');
check('C2 空 ID + gcc 已注册 → "gcc"（CB 加载器缺省）', resolveEffectiveCompilerId('', depsResource) === 'gcc', resolveEffectiveCompilerId('', depsResource), 'gcc');
check('C3 空 ID + gcc 未注册 → 回退设置值', resolveEffectiveCompilerId('', depsUser) === 'riscv32-v3', resolveEffectiveCompilerId('', depsUser), 'riscv32-v3');
const depsNone = { configuredId: () => 'gcc', isRegistered: () => false, hasResourceFile: () => false };
check('C4 空 ID + 全部未注册 → 保留设置值（极端环境按未注册处理）', resolveEffectiveCompilerId('', depsNone) === 'gcc', resolveEffectiveCompilerId('', depsNone), 'gcc');

// ---------- D. 静态接线（dist/extension.js） ----------
const extJs = fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension.js'), 'utf-8');
check('D1 resolveTargetCompiler 经 resolveEffectiveCompilerId + findRegisteredCompilerId 解析',
  /function resolveTargetCompiler\(compilerId\) \{\s*const deps = compilerRegistryDeps\(\);\s*const id = \(0, compilerRegistry_1\.findRegisteredCompilerId\)\(\(0, compilerRegistry_1\.resolveEffectiveCompilerId\)\(compilerId, deps\), deps\);/.test(extJs));
check('D2 空 ID 不再直接按无效返回（旧 immediate return undefined 已移除）',
  !/function resolveTargetCompiler\(compilerId\) \{\s*if \(!compilerId\) return undefined;/.test(extJs));
check('D3 宿主依赖接线：设置值 + 用户编译器 + 资源文件三源',
  /configuredId: \(\) => cfg\.get\('compilerId', 'gcc'\)/.test(extJs) && /isRegistered: \(id\) => !!codeBlocksConfig\?\.find\(id\)/.test(extJs) && /hasResourceFile: \(name\) => !!compilerResourcesDir && fs\.existsSync\(path\.join\(compilerResourcesDir, name\)\)/.test(extJs));

console.log(`\ncompiler-id-default 回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
