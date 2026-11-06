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
  } finally {
    mock.restore();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* 忽略 */ }
  }
  console.log(`\n诊断定位回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
