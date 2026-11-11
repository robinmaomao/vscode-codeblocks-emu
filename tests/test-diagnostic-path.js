// 链接期诊断定位回归（修复「Build Log 里 Errors 点击不跳转、Warnings 正常」）：
//  现象：`func_bt.c:(.text.func_bt_warning_discon+0x2e): undefined reference to 'x'`
//        —— 解析器把 `func_bt.c:(.text…)` 整串当文件名（行号为 undefined），
//        相对路径按链接命令的 cwd join 出来的文件不存在 ⇒ Problems / Build Log 都打不开。
//  修复：src/build/diagnosticPath.ts 在构建引擎的 resolveFile 钩子里
//        ① 按 basename 把文件落回工程源码（`.o` / `.obj` 回退同名源文件）；
//        ② 段名 `(.text.<函数>+0xNN)` 推出函数名，在该文件里定位到定义/调用行。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { installVscodeMock } = require('./_harness/vscodeMock');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const root = path.resolve(__dirname, '..');
const dist = (rel) => path.join(root, 'dist', rel);

async function main() {
  const mock = installVscodeMock();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-diagpath-'));
  try {
    const {
      splitDiagnosticFileToken,
      buildDiagnosticPathIndex,
      resolveDiagnosticLocation,
      createDiagnosticResolver,
      findIdentifierLine,
    } = require(dist('build/diagnosticPath.js'));

    // ---------- A. 文件名 token 拆解 ----------
    const t1 = splitDiagnosticFileToken('func_bt.c:(.text.func_bt_warning_discon+0x2e)');
    check('A1 `file:(section+off)` → file + section', t1.file === 'func_bt.c' && t1.section === '.text.func_bt_warning_discon+0x2e' && t1.line === undefined, t1);
    const t2 = splitDiagnosticFileToken('func_bt.c:12');
    check('A2 `file:line` → file + line（原先 `:12` 被吞进文件名）', t2.file === 'func_bt.c' && t2.line === 12, t2);
    const t3 = splitDiagnosticFileToken('"C:\\proj\\a b.c"');
    check('A3 去引号且不改内容', t3.file === 'C:\\proj\\a b.c', t3);
    const t4 = splitDiagnosticFileToken('obj/x.o:link_err.c:(.text+0x9)');
    check('A4 MinGW `obj:src:(section)` → file=源文件 + section', t4.file === 'link_err.c' && t4.section === '.text+0x9', t4);

    // ---------- B. 文件/行解析 ----------
    const src = path.join(tmp, 'platform', 'app', 'func_bt.c');
    fs.mkdirSync(path.dirname(src), { recursive: true });
    const body = [
      '/* header */',
      'static int helper(void) { return 1; }',
      '',
      'void func_bt_warning_discon(void)',
      '{',
      '    func_bt_tws_annel();   /* 这里引用了未定义符号 */',
      '}',
      '',
    ].join('\n');
    fs.writeFileSync(src, body, 'utf-8');
    const other = path.join(tmp, 'other', 'func_bt.c');
    fs.mkdirSync(path.dirname(other), { recursive: true });
    fs.writeFileSync(other, 'void x(void) {}\n', 'utf-8');

    const index = buildDiagnosticPathIndex([src, other], tmp);
    const io = {
      exists: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
      readFile: (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return undefined; } },
    };

    const r1 = resolveDiagnosticLocation({ file: 'func_bt.c:(.text.func_bt_warning_discon+0x2e)' }, path.join(tmp, 'Output'), index, io);
    check('B1 段名形式：文件落回工程源码', !!r1 && r1.file === src, r1);
    check('B2 段名形式：行号由函数名推出（定义行 4）', !!r1 && r1.line === 4, r1);

    const r2 = resolveDiagnosticLocation({ file: 'func_bt.o:(.text.func_bt_warning_discon+0x2e)' }, path.join(tmp, 'Output'), index, io);
    check('B3 `.o` 形式：回退同名源文件', !!r2 && r2.file === src, r2);

    const r3 = resolveDiagnosticLocation({ file: 'func_bt.c:12' }, tmp, index, io);
    check('B4 `file:line` 形式：保留行号 12', !!r3 && r3.file === src && r3.line === 12, r3);

    const r4 = resolveDiagnosticLocation({ file: 'not_in_project.c:(.text.main+0x1)' }, tmp, index, io);
    check('B5 工程外文件：不强行改写（返回 undefined）', r4 === undefined, r4);

    const r5 = resolveDiagnosticLocation({ file: src, line: 3, column: 7 }, tmp, index, io);
    check('B6 已正确（绝对路径 + 行号）：返回 undefined 保持原样', r5 === undefined, r5);

    const r6 = resolveDiagnosticLocation({ file: 'func_bt.c:(.text+0x2e)' }, tmp, index, io);
    check('B7 段名无函数（`.text+0x2e`）：仍落回文件，行号留空', !!r6 && r6.file === src && r6.line === undefined, r6);

    check('B8 findIdentifierLine 优先匹配「标识符 + (」', findIdentifierLine(body, 'func_bt_warning_discon') === 4, findIdentifierLine(body, 'func_bt_warning_discon'));

    // MinGW 形态：`obj:src:(.text+0x9)`（段名无函数）+ 消息里的未定义符号 → 定位到**调用语句**（跳过 extern 声明）
    const callSrc = path.join(tmp, 'platform', 'app', 'link_err.c');
    fs.writeFileSync(callSrc, [
      '/* 探针 */',
      'extern void cb_missing_symbol_xyz(void);',
      '',
      'static int cb_caller(void)',
      '{',
      '    cb_missing_symbol_xyz();',
      '    return 0;',
      '}',
      '',
    ].join('\n'), 'utf-8');
    const idx2 = buildDiagnosticPathIndex([callSrc], tmp);
    const r8 = resolveDiagnosticLocation({
      file: 'obj/Debug/link_err.o:link_err.c:(.text+0x9)',
      message: "undefined reference to `cb_missing_symbol_xyz'",
    }, path.join(tmp, 'Output'), idx2, io);
    check('B10 `obj:src` + 未定义符号 → 落到调用行（第 6 行，不是 extern 声明）',
      !!r8 && r8.file === callSrc && r8.line === 6, r8);

    // ---------- B11–B15：0.8.148 修复（段名残留 / 对象文件 / 同级源码 / 可导航判断） ----------
    // B11：剥掉 `:(section)` 后文件本来就对、但行号推不出来 —— 之前误判「无改善」返回 undefined，
    //      调用方回退到带 `:(.text+0x9)` 的原始路径 ⇒ 点击必然失败
    const direct = path.join(tmp, 'direct.c');
    fs.writeFileSync(direct, 'int main(void) { return 0; }\n', 'utf-8');
    const r11 = resolveDiagnosticLocation({ file: 'direct.c:(.text+0x9)' }, tmp, index, io);
    check('B11 段名残留 + 文件已正确：仍返回剥掉段名的真实文件（不能返回 undefined）',
      !!r11 && r11.file === direct && r11.line === undefined, r11);

    // B12：对象文件在链接阶段必然存在，不能把它当跳转目标（应回退同名源码）
    const objDir = path.join(tmp, 'obj', 'Debug');
    fs.mkdirSync(objDir, { recursive: true });
    const objFile = path.join(objDir, 'func_bt.o');
    fs.writeFileSync(objFile, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    const r12 = resolveDiagnosticLocation({ file: 'obj/Debug/func_bt.o:(.text+0x9)' }, tmp, index, io);
    check('B12 对象文件已存在：仍回退同名源码，不返回 .o',
      !!r12 && r12.file === src && r12.file !== objFile, r12);

    // B13：工程里没有同名源码 → 不能返回对象文件
    const r13 = resolveDiagnosticLocation({ file: 'obj/Debug/missing.o:(.text+0x9)' }, tmp, index, io);
    check('B13 对象文件无同名源码：返回 undefined（不把 .o 当位置）', r13 === undefined, r13);

    // B14：工程文件表没有（生成文件/外部对象）→ 试对象同目录的同名源码
    const genDir = path.join(tmp, 'gen');
    fs.mkdirSync(genDir, { recursive: true });
    fs.writeFileSync(path.join(genDir, 'gen.o'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(genDir, 'gen.c'), 'int gen(void) { return 0; }\n', 'utf-8');
    const r14 = resolveDiagnosticLocation({ file: 'gen/gen.o:(.text+0x9)' }, tmp, index, io);
    check('B14 工程外对象：回退同目录同名源码',
      !!r14 && r14.file === path.join(genDir, 'gen.c'), r14);

    const { isNavigableDiagnosticFile } = require(dist('build/diagnosticPath.js'));
    check('B15 可导航判断：源码/头文件/链接脚本可导航；伪文件/对象文件/残留段名不可导航',
      isNavigableDiagnosticFile(direct) === true
      && isNavigableDiagnosticFile(path.join(tmp, 'x.h')) === true
      && isNavigableDiagnosticFile(path.join(tmp, 'link.ld')) === true
      && isNavigableDiagnosticFile(path.join(tmp, 'ld.exe')) === false
      && isNavigableDiagnosticFile(path.join(tmp, 'windres.exe')) === false
      && isNavigableDiagnosticFile(objFile) === false
      && isNavigableDiagnosticFile('main.o:(.text+0x9)') === false
      && isNavigableDiagnosticFile('<stdin>') === false,
      { ld: isNavigableDiagnosticFile(path.join(tmp, 'ld.exe')), obj: isNavigableDiagnosticFile(objFile) });

    // 缓存解析器：同一文件只读一次
    let reads = 0;
    const resolver = createDiagnosticResolver(index, {
      exists: io.exists,
      readFile: (p) => { reads++; return io.readFile(p); },
    });
    resolver({ file: 'func_bt.c:(.text.func_bt_warning_discon+0x2e)' }, tmp);
    resolver({ file: 'func_bt.c:(.text.func_bt_warning_discon+0x2e)' }, tmp);
    check('B9 解析器缓存：同一文件只读一次', reads === 1, reads);

    // ---------- C. 与真实 OutputParser 串联 ----------
    const { OutputParser } = require(dist('build/outputParser.js'));
    const parser = new OutputParser();
    const raw = "func_bt.c:(.text.func_bt_warning_discon+0x2e): undefined reference to 'func_bt_tws_annel'";
    const parsed = parser.parseLine(raw);
    check('C1 解析器本身仍产出 error + 消息', !!parsed && parsed.type === 2 && /undefined reference/.test(parsed.message), parsed);
    const c = resolver(parsed, path.join(tmp, 'Output'));
    check('C2 经 resolver 后定位到真实源码与函数行', !!c && c.file === src && c.line === 4, c);

    const warn = parser.parseLine("func_bt.c:6:17: warning: implicit declaration of function 'func_bt_tws_annel'; did you mean 'func_bt_tws_set_channel'?");
    const cw = resolver(warn, path.join(tmp, 'build-cwd'));
    check('C3 相对路径的编译警告：按 basename 落回真实源码（行号保持 6）', !!cw && cw.file === src && cw.line === 6, cw);

    const absoluteWarn = parser.parseLine(`${src}:6:17: warning: implicit declaration of function 'x'`);
    const caw = resolver(absoluteWarn, tmp);
    check('C4 已是绝对路径 + 行号：不做改写（resolver 返回 undefined）', caw === undefined, caw);

    // C5–C7：ANSI 颜色输出（-fdiagnostics-color=always）——清理后必须能正常解析
    const enc = require(dist('tools/encoding.js'));
    const colored = '\u001b[01m\u001b[Ksrc/main.c:10:5:\u001b[m\u001b[K \u001b[01;31m\u001b[Kerror:\u001b[m\u001b[K ' + "'x' undeclared";
    const clean = enc.stripAnsi(colored);
    check('C5 stripAnsi 清理 CSI 颜色码', clean === "src/main.c:10:5: error: 'x' undeclared", clean);
    check('C6 无 ESC 的行原样返回（快路径）', enc.stripAnsi('src/main.c:10:5: error: x') === 'src/main.c:10:5: error: x', null);
    const coloredParsed = parser.parseLine(clean);
    check('C7 清理后的彩色错误行可被 OutputParser 解析（file/line/col）',
      !!coloredParsed && coloredParsed.file === 'src/main.c' && coloredParsed.line === 10 && coloredParsed.column === 5,
      coloredParsed);
  } finally {
    mock.restore();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
  console.log(`\n诊断定位回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
