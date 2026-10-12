// 编译器程序路径设置的作用域回归（缺陷 D-20）
//  - `codeblocks.compilerPrograms` 支持「按编译器 id 分组」（新）与「扁平」（旧兼容）两种形态
//  - 旧扁平形态只属于「写入时的全局 compilerId」：否则用「探测编译器」选定交叉编译器后，
//    别的家族（如 `<Option compiler="gcc">`）的工程会被静默改用交叉工具链（本文件即该缺陷的单元回归）
const { isFlatProgramsMap, normalizeProgramsSetting, resolveProgramsForCompiler, setProgramsForCompiler } =
  require('../dist/compiler/compilerPrograms.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; failures.push(name); console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

// ---------- 形态判定 ----------
check('扁平形态识别（{C,…}）', isFlatProgramsMap({ C: 'gcc.exe' }) === true);
check('分组形态不是扁平（{gcc:{C}}）', isFlatProgramsMap({ gcc: { C: 'gcc.exe' } }) === false);
check('空对象不是扁平形态', isFlatProgramsMap({}) === false);
check('非对象/数组不是扁平形态', isFlatProgramsMap(null) === false && isFlatProgramsMap(['C']) === false);
check('含未知键不是扁平形态', isFlatProgramsMap({ C: 'gcc.exe', bogus: 'x' }) === false);

// ---------- 解析（核心：D-20） ----------
const nested = { 'avr-gcc': { C: 'avr-gcc.exe' }, gcc: { C: 'riscv-none-elf-gcc.exe' } };
check('分组形态：命中本家族', resolveProgramsForCompiler(nested, 'avr-gcc', 'gcc')?.C === 'avr-gcc.exe');
check('分组形态：其它家族不命中（防跨家族污染）', resolveProgramsForCompiler(nested, 'msp430-gcc', 'gcc') === undefined);
check('分组形态：全局 id 不影响命中判定', resolveProgramsForCompiler(nested, 'gcc', 'avr-gcc')?.C === 'riscv-none-elf-gcc.exe');

const flat = { C: 'avr-gcc.exe', CPP: 'avr-g++.exe' };
check('扁平形态：命中它所属的全局 compilerId', resolveProgramsForCompiler(flat, 'avr-gcc', 'avr-gcc')?.C === 'avr-gcc.exe');
check('扁平形态：不泄漏到别的家族（D-20 回归）', resolveProgramsForCompiler(flat, 'gcc', 'avr-gcc') === undefined);
check('空设置返回 undefined（回退 PATH 查找）',
  resolveProgramsForCompiler({}, 'gcc', 'gcc') === undefined && resolveProgramsForCompiler(undefined, 'gcc', 'gcc') === undefined);
check('分组形态值为字符串（脏数据）时忽略', resolveProgramsForCompiler({ gcc: 'not-an-object' }, 'gcc', 'gcc') === undefined);

// ---------- 迁移（旧 → 新） ----------
const migrated = normalizeProgramsSetting(flat, 'avr-gcc');
check('迁移：扁平归入全局 compilerId', JSON.stringify(migrated) === JSON.stringify({ 'avr-gcc': { C: 'avr-gcc.exe', CPP: 'avr-g++.exe' } }), migrated);
check('迁移：分组形态原样保留', JSON.stringify(normalizeProgramsSetting(nested, 'gcc')) === JSON.stringify(nested));
check('迁移：空值得到空对象', JSON.stringify(normalizeProgramsSetting({}, 'gcc')) === '{}');

// ---------- 写入 ----------
const w1 = setProgramsForCompiler(flat, 'riscv', { C: 'riscv-none-elf-gcc.exe' }, 'avr-gcc');
check('写入：先迁移扁平再新增 id', JSON.stringify(w1) === JSON.stringify({ 'avr-gcc': { C: 'avr-gcc.exe', CPP: 'avr-g++.exe' }, riscv: { C: 'riscv-none-elf-gcc.exe' } }), w1);
const w2 = setProgramsForCompiler(w1, 'riscv', undefined, 'avr-gcc');
check('写入：programs 为空则删除该 id 条目', w2.riscv === undefined && w2['avr-gcc'] !== undefined, w2);
const w3 = setProgramsForCompiler(nested, 'gcc', {}, 'gcc');
check('写入：空程序表等价于删除', w3.gcc === undefined, w3);

// ---------- 纯函数：不得修改入参 ----------
const snapshotFlat = JSON.stringify(flat);
const snapshotNested = JSON.stringify(nested);
resolveProgramsForCompiler(flat, 'avr-gcc', 'avr-gcc');
normalizeProgramsSetting(flat, 'avr-gcc');
setProgramsForCompiler(flat, 'riscv', { C: 'x' }, 'avr-gcc');
check('纯函数不修改入参', JSON.stringify(flat) === snapshotFlat && JSON.stringify(nested) === snapshotNested, { flat, nested });

console.log(`\ncompilerPrograms 作用域回归: ${pass} pass, ${fail} fail${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
process.exit(fail ? 1 : 0);
