// 编译输出解析回归（build/outputParser —— 此前无测试引用）
//
// 两条路径分别验证：
//  A. 编译器 XML 正则路径（`new OutputParser(compiler.regexes)`）——正常编译器（gcc/clang/msvc/…）实际使用；
//  B. 内置回退正则路径（`new OutputParser()` = getDefaultRegexes()）——仅当编译器无 options_<id>.xml 时使用
//     （如 default.conf 里的用户自定义交叉编译器）。
//
// ⚠ 历史缺陷 D-01（已修复，见 docs/测试报告-0.8.128.md）：回退表原第 2 条 "Preprocessor error" 为 catch-all（lt=error），
//    排在 "Compiler warning" 之前，导致该路径下 warning/note 被归类为 Error，且不支持 `file:line:` 无列号格式。
//    修复：关键字特异条目（warning/note，含无列号变体）前移到 catch-all 之前；B 组断言随之改为期望行为。
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const mock = installVscodeMock();
try {
  const { OutputParser } = require('../dist/build/outputParser.js');
  const { CompilerOptionsLoader } = require('../dist/compiler/optionsLoader.js');
  const types = require('../dist/model/types.js');
  const LT = types.CompilerLineType;

  const loader = new CompilerOptionsLoader(path.resolve(__dirname, '..', 'resources', 'compilers'));
  const gcc = loader.load('gcc');
  check('gcc 编译器 XML 提供正则表（>10 条）', gcc.regexes.length > 10, gcc.regexes.length, '>10');
  const p = new OutputParser(gcc.regexes);

  // ---------- A. XML 路径（产品实际路径） ----------
  const e1 = p.parseLine('E:\\proj\\src\\main.c:12:5: error: expected \';\' before \'}\' token');
  check('A1 error 行：类型 Error', !!e1 && e1.type === LT.Error, e1 && e1.type, LT.Error);
  check('A1 error 行：文件/行/列', !!e1 && e1.file === 'E:\\proj\\src\\main.c' && e1.line === 12 && e1.column === 5, e1);
  check('A1 error 行：message 保留关键字与细节', !!e1 && /expected ';'/.test(e1.message), e1 && e1.message);

  const w1 = p.parseLine('/home/u/src/util.c:42:9: warning: unused variable \'tmp\' [-Wunused-variable]');
  check('A2 warning 行：类型 Warning（不得归为 Error）', !!w1 && w1.type === LT.Warning, w1 && w1.type, LT.Warning);

  const n1 = p.parseLine('src/a.c:5:1: note: expected int but argument is char');
  check('A3 note 行：类型 Info', !!n1 && n1.type === LT.Info, n1 && n1.type, LT.Info);

  const nc = p.parseLine('E:\\proj\\src\\render.cpp:17: error: use of undeclared identifier');
  check('A4 无列号 error 行：仍解析出文件与行号', !!nc && nc.file === 'E:\\proj\\src\\render.cpp' && nc.line === 17, nc);

  const sp = p.parseLine('C:\\Users\\demo user\\My Projects\\src\\a b.c:3:1: error: expected declaration');
  check('A5 含空格路径可解析', !!sp && sp.file === 'C:\\Users\\demo user\\My Projects\\src\\a b.c' && sp.line === 3, sp);

  const undef = p.parseLine('obj/main.o:main.c:(.text+0x1a): undefined reference to `foo\'');
  check('A6 链接 undefined reference 可识别', !!undef && undef.type === LT.Error, undef);

  for (const [name, line] of [
    ['编译命令行', 'gcc -Wall -c src/main.c -o obj/main.o'],
    ['普通输出', 'Build finished with 0 errors'],
    ['空行', ''],
    ['链接成功提示', 'Linking console executable: bin/Debug/demo'],
  ]) {
    check(`A7 非诊断行返回 null（${name}）`, p.parseLine(line) === null, p.parseLine(line));
  }

  // ---------- A. toDiagnostic / resolveFileUri（经 vscode mock） ----------
  const dErr = p.toDiagnostic('E:\\p\\a.c:7:3: error: boom', 'E:\\p');
  const dWarn = p.toDiagnostic('E:\\p\\a.c:8:1: warning: careful', 'E:\\p');
  check('A8 toDiagnostic：error → DiagnosticSeverity.Error', !!dErr && dErr.severity === 0, dErr && dErr.severity, 0);
  check('A8 toDiagnostic：warning → DiagnosticSeverity.Warning', !!dWarn && dWarn.severity === 1, dWarn && dWarn.severity, 1);
  check('A9 toDiagnostic：source 标记 Code::Blocks', !!dErr && dErr.source === 'Code::Blocks', dErr && dErr.source);
  check('A10 toDiagnostic：行/列 1 基 → 0 基', !!dErr && dErr.range.start.line === 6 && dErr.range.start.character === 2, dErr && dErr.range.start, { line: 6, character: 2 });
  check('A11 toDiagnostic：非诊断行 null', p.toDiagnostic('plain text', 'E:\\p') === null, null);

  const uRel = p.resolveFileUri('src/sub/a.c:3:1: error: x', 'E:\\proj');
  const uAbs = p.resolveFileUri('E:\\abs\\b.c:3:1: error: x', 'E:\\proj');
  check('A12 resolveFileUri：相对路径拼工程根', !!uRel && /[\\/]proj[\\/]src[\\/]sub[\\/]a\.c$/.test(uRel.fsPath), uRel && uRel.fsPath);
  check('A12 resolveFileUri：绝对路径原样', !!uAbs && uAbs.fsPath.toLowerCase() === 'e:\\abs\\b.c', uAbs && uAbs.fsPath);
  check('A12 resolveFileUri：非诊断行 undefined', p.resolveFileUri('plain', 'E:\\p') === undefined, undefined);

  // ---------- B. 回退路径（D-01 修复后：warning/note 不再被 catch-all 吞成 error） ----------
  const pf = new OutputParser();
  const fw = pf.parseLine('/home/u/src/util.c:42:9: warning: unused variable \'tmp\' [-Wunused-variable]');
  check('B1 回退路径 warning → Warning（不再归为 Error）', !!fw && fw.type === LT.Warning, fw && fw.type, LT.Warning);
  check('B1 回退路径 warning 保留文件/行/列', !!fw && fw.file === '/home/u/src/util.c' && fw.line === 42 && fw.column === 9, fw);
  const fn = pf.parseLine('src/a.c:5:1: note: expected int but argument is char');
  check('B1b 回退路径 note → Info（不再归为 Error）', !!fn && fn.type === LT.Info, fn && fn.type, LT.Info);
  const fe = pf.parseLine('E:\\proj\\src\\main.c:12:5: error: expected \';\'');
  check('B2 回退路径 error 行照常识别', !!fe && fe.type === LT.Error && fe.line === 12, fe);
  check('B2b 回退路径 error 行保留文件', !!fe && fe.file === 'E:\\proj\\src\\main.c', fe && fe.file, 'E:\\proj\\src\\main.c');
  check('B3 回退路径非诊断行仍返回 null', pf.parseLine('gcc -c a.c') === null, null);
  const fnoCol = pf.parseLine('src/render.cpp:17: error: no column');
  check('B4 回退路径支持无列号 error（解析出 file/line）', !!fnoCol && fnoCol.file === 'src/render.cpp' && fnoCol.line === 17 && fnoCol.type === LT.Error, fnoCol, { file: 'src/render.cpp', line: 17 });
  const fwNoCol = pf.parseLine('src/render.cpp:23: warning: no column warning');
  check('B4b 回退路径支持无列号 warning → Warning', !!fwNoCol && fwNoCol.type === LT.Warning && fwNoCol.file === 'src/render.cpp' && fwNoCol.line === 23, fwNoCol, { file: 'src/render.cpp', line: 23 });
  const flink = pf.parseLine('C:\\mingw\\bin\\ld.exe: cannot find -lnope');
  check('B5 回退路径 ld 找不到库 → Error', !!flink && flink.type === LT.Error && /cannot find -lnope/.test(flink.message), flink);
} finally {
  mock.restore();
}

console.log(`\noutput-parser 回归: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
