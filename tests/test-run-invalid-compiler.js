// Run 前编译器校验（对齐 CompilerGCC::Run:1963-1986 "Run aborted..."）：
// 动态：纯模块 invalidCompiler（消息渲染 / 尝试路径 / 可用性）；静态：dist/extension.js run() 段接线断言。
const fs = require('fs');
const os = require('os');
const path = require('path');
const m = require('../dist/build/invalidCompiler.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want)); }
}

// 1) renderInvalidCompilerMessage：无名称 → 单空格 + 扩展适配文案 + 末尾换行（结构对齐 CB）
const expectedNull =
  'Project/Target: "hifi5 - Debug":\n' +
  "  The compiler's setup is invalid, so Code::Blocks for VS Code cannot find/run the compiler.\n" +
  '  Probably the toolchain path within the compiler settings is not setup correctly?!\n' +
  '  Do you have a compiler installed?\n' +
  'Check the "codeblocks.masterPath" / "codeblocks.compilerPrograms" settings, or run "Code::Blocks: Detect Compilers" to fix the compiler\'s setup.\n';
const msgNull = m.renderInvalidCompilerMessage('hifi5 - Debug', null);
check('null 名称：5 行 + 末尾换行（扩展适配文案）', msgNull === expectedNull, msgNull, expectedNull);

// 2) 名称/ID 显示：已注册 → 名称；未注册 → ID
const msgNamed = m.renderInvalidCompilerMessage('p - D', 'GNU GCC Compiler');
check('已注册名称：(名称) 显示', msgNamed.includes('(GNU GCC Compiler) is invalid'), msgNamed, undefined);
const msgId = m.renderInvalidCompilerMessage('p - D', 'hifi5');
check('未注册 ID：(hifi5) 显示', msgId.includes('(hifi5) is invalid'), msgId, undefined);

// 3) triedCompilerPaths：bin → 根目录 → extra_paths 完整列出（保护性修正）
const binP = path.join('Z:\\no-such-toolchain', 'bin', 'gcc.exe');
const rootP = path.join('Z:\\no-such-toolchain', 'gcc.exe');
const extraP = path.join('E:\\extra', 'gcc.exe');
const tried = m.triedCompilerPaths({ programs: { C: 'gcc.exe' }, masterPath: 'Z:\\no-such-toolchain', extraPaths: ['E:\\extra'] });
check('tried 顺序 bin/根目录/extra_paths',
  JSON.stringify(tried) === JSON.stringify([binP, rootP, extraP]), tried, [binP, rootP, extraP]);
check('C 程序为空 → []',
  m.triedCompilerPaths({ programs: { C: '' }, masterPath: 'Z:\\x', extraPaths: [] }).length === 0,
  m.triedCompilerPaths({ programs: { C: '' }, masterPath: 'Z:\\x', extraPaths: [] }), []);
check('绝对路径 → 单一',
  JSON.stringify(m.triedCompilerPaths({ programs: { C: 'C:\\abs\\gcc.exe' }, masterPath: 'Z:\\x', extraPaths: [] })) === JSON.stringify(['C:\\abs\\gcc.exe']),
  m.triedCompilerPaths({ programs: { C: 'C:\\abs\\gcc.exe' }, masterPath: 'Z:\\x', extraPaths: [] }), ['C:\\abs\\gcc.exe']);

// 4) renderTriedCompilerPaths：空 → 空串；非空 → 逐行 + 末尾换行
check('空路径 → 空串', m.renderTriedCompilerPaths([]) === '', m.renderTriedCompilerPaths([]), '');
const rt = m.renderTriedCompilerPaths(['A', 'B']);
check('非空 → 逐行 + 末尾换行',
  rt === "Tried to run compiler executable 'A', but failed!\nTried to run compiler executable 'B', but failed!\n",
  rt, undefined);

// 5) isCompilerUsable：真实目录实验（bin → 根目录 → extra_paths → PATH）
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cvu-'));
fs.mkdirSync(path.join(dir, 'bin'));
fs.writeFileSync(path.join(dir, 'bin', 'gcc.exe'), 'x');
const u1 = m.isCompilerUsable({ programs: { C: 'gcc.exe' }, masterPath: dir, extraPaths: [] });
check('masterPath/bin 存在 → 可用', u1 === true, u1, true);
const u2 = m.isCompilerUsable({ programs: { C: 'gcc.exe' }, masterPath: 'Z:\\no-such-toolchain', extraPaths: [] });
check('masterPath 缺失 → 不可用', u2 === false, u2, false);
fs.rmSync(path.join(dir, 'bin'), { recursive: true });
fs.writeFileSync(path.join(dir, 'gcc.exe'), 'x');
const u3 = m.isCompilerUsable({ programs: { C: 'gcc.exe' }, masterPath: dir, extraPaths: [] });
check('根目录回退 → 可用', u3 === true, u3, true);
fs.rmSync(path.join(dir, 'gcc.exe'));
const extraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-cvu-e-'));
fs.writeFileSync(path.join(extraDir, 'gcc.exe'), 'x');
const u4 = m.isCompilerUsable({ programs: { C: 'gcc.exe' }, masterPath: dir, extraPaths: [extraDir] });
check('extra_paths 回退 → 可用', u4 === true, u4, true);
const u5 = m.isCompilerUsable({ programs: { C: 'gcc.exe' }, masterPath: '', extraPaths: [] });
check('masterPath 空 → 视为 PATH 查找（true）', u5 === true, u5, true);
fs.rmSync(dir, { recursive: true, force: true });
fs.rmSync(extraDir, { recursive: true, force: true });

// 6) 静态接线：dist/extension.js run() 段（编译器检查先于 exe 检查、例外与共享渲染）
const ext = fs.readFileSync(path.join(__dirname, '..', 'dist', 'extension.js'), 'utf8');
const runIdx = ext.indexOf('async function run()');
const debugIdx = ext.indexOf('async function debug()');
const seg = runIdx >= 0 && debugIdx > runIdx ? ext.slice(runIdx, debugIdx) : '';
check('定位 run() 段', seg.length > 0, seg.length, '>0');
check('run() 输出 Run aborted...', seg.includes('Run aborted...'), seg.length, undefined);
check('run() 复用共享渲染模块', seg.includes('invalidCompiler_1.renderInvalidCompilerMessage'), seg.length, undefined);
check('run() 使用 resolveTargetCompiler + isCompilerUsable',
  seg.includes('resolveTargetCompiler') && seg.includes('isCompilerUsable'), seg.length, undefined);
check('例外：CommandsOnly 与 null 编译器', seg.includes('CommandsOnly') && seg.includes("'null'"), seg.length, undefined);
check('顺序：先编译器检查后 exe 存在性检查',
  seg.indexOf('Run aborted...') >= 0 && seg.indexOf('Run aborted...') < seg.indexOf('可执行文件不存在'),
  seg.indexOf('Run aborted...'), '<' + seg.indexOf('可执行文件不存在'));

console.log(`run-invalid-compiler: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
