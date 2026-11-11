// L1 真实链接期诊断定位（真实 gcc；探针工程在临时目录，测试后清理）
//
// 复现现场问题：`func_bt.c:(.text.func_bt_warning_discon+0x2e): undefined reference to 'x'`
//  - 解析器把 `func_bt.c:(.text…)` 整串当文件名、行号缺失；
//  - 链接命令 cwd 是工程执行目录，`func_bt.c` 在子目录 ⇒ 直接 join 出来不存在 ⇒ 点击不跳转。
// 本测试用真实 gcc 链接一个「调用未定义函数」的工程，断言注入 resolveFile 后：
//  - 结构化诊断的 file 指向真实源文件、line 落在调用所在函数；
//  - onDiagnostic 的 URI 也指向真实源文件（Problems 面板同样可跳）。
const fs = require('fs');
const path = require('path');
const H = require('./harness');

let pass = 0, fail = 0, skip = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`); }
}

const HAS_GCC = H.toolAvailable('gcc');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 路径比较（工程文件来自 .cbp 用正斜杠，resolver 输出可能混用分隔符） */
const samePath = (a, b) => String(a || '').replace(/\\/g, '/').toLowerCase() === String(b || '').replace(/\\/g, '/').toLowerCase();

/** 写一个最小 .cbp：单目标 + 一个源文件（源文件放在子目录，模拟链接命令 cwd 与源文件不同） */
function writeLinkErrorProject(dir) {
  const srcDir = path.join(dir, 'platform', 'app');
  fs.mkdirSync(srcDir, { recursive: true });
  const src = path.join(srcDir, 'link_err.c');
  fs.writeFileSync(src, [
    '/* 链接期诊断定位探针 */',
    'extern void cb_missing_symbol_xyz(void);',
    '',
    'static int cb_caller_helper(void)',
    '{',
    '    cb_missing_symbol_xyz();   /* 未定义符号：链接器在这里报 undefined reference */',
    '    return 0;',
    '}',
    '',
    'int main(void)',
    '{',
    '    return cb_caller_helper();',
    '}',
    '',
  ].join('\n'), 'utf-8');

  const cbp = path.join(dir, 'link-err.cbp');
  fs.writeFileSync(cbp, [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>',
    '<CodeBlocks_project_file>',
    '\t<FileVersion major="1" minor="6" />',
    '\t<Project>',
    '\t\t<Option title="link-err" />',
    '\t\t<Option compiler="gcc" />',
    '\t\t<Build>',
    '\t\t\t<Target title="Debug">',
    '\t\t\t\t<Option type="1" />',
    '\t\t\t\t<Option compiler="gcc" />',
    '\t\t\t\t<Option output="bin/Debug/link-err" />',
    '\t\t\t\t<Option object_output="obj/Debug/" />',
    '\t\t\t</Target>',
    '\t\t</Build>',
    '\t\t<Unit filename="platform/app/link_err.c" />',
    '\t</Project>',
    '</CodeBlocks_project_file>',
    '',
  ].join('\n'), 'utf-8');
  return { cbp, src };
}

async function scenarioLinkerDiagnostic() {
  const dir = H.mkTemp('cb-e2e-linkdiag-');
  const { cbp, src } = writeLinkErrorProject(dir);
  const ctx = H.openProject(cbp);
  const targetTitle = (ctx.project.buildTargets[0] || {}).title;
  const target = ctx.project.buildTargets[0];
  if (!targetTitle || !target) { skip++; console.log('SKIP 工程无构建目标'); return; }

  const { buildDiagnosticPathIndex, createDiagnosticResolver } = require('../../dist/build/diagnosticPath.js');
  const projectFiles = new Set();
  for (const f of ctx.project.files) projectFiles.add(f.absolutePath);
  for (const t of ctx.project.buildTargets) for (const f of t.files) projectFiles.add(f.absolutePath);
  const index = buildDiagnosticPathIndex([...projectFiles], ctx.project.basePath);
  const resolver = createDiagnosticResolver(index, {
    exists: (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } },
    readFile: (p) => { try { return fs.readFileSync(p, 'utf-8'); } catch { return undefined; } },
  });

  const diags = [];
  const uriFiles = [];
  const ok = await ctx.engine.build([targetTitle], {
    rebuild: true,
    resolveFile: (parsed, cwd) => resolver(parsed, cwd),
    onDiagnostic: (diag, uri) => { if (uri) uriFiles.push(uri.fsPath); },
    onStructuredDiagnostic: (d) => diags.push(d),
  });

  check('S1 真实工程链接失败（构建返回 false）', ok === false, ok);
  const errs = diags.filter((d) => d.severity === 'error');
  check('S2 收集到链接期错误诊断', errs.length >= 1, diags);
  const undef = errs.find((d) => /undefined reference/.test(d.message));
  check('S3 命中 undefined reference', !!undef, errs.map((d) => d.message));
  if (!undef) return;

  check('S4 诊断文件落到真实源文件（不再是 `x.c:(.text…)` 伪路径）',
    samePath(undef.file, src), { got: undef.file, want: src });
  check('S5 行号落在调用所在函数内（第 6 行调用了未定义符号）',
    undef.line === 6, undef.line);
  check('S6 Problems 面板 URI 同样指向真实源文件',
    uriFiles.some((f) => samePath(f, src)), uriFiles);

  const normalized = String(undef.file || '').replace(/\\/g, '/');
  check('S7 伪路径形态已消失（不含 `:(.text`）', !/:\(\.text/.test(normalized), normalized);

  // S8/S9：GNU ld 另一种常见形态 `<obj>:(.text+0x9)`（无调试信息时只给对象文件）。
  // 链接阶段 .o 必然存在，不能把它当成诊断文件（打开二进制 = 用户眼中的「点击不跳转」）。
  const findByName = (root, name) => {
    if (!fs.existsSync(root)) return undefined;
    for (const e of fs.readdirSync(root, { withFileTypes: true })) {
      const p = path.join(root, e.name);
      if (e.isDirectory()) {
        const hit = findByName(p, name);
        if (hit) return hit;
      } else if (e.name.toLowerCase() === name) {
        return p;
      }
    }
    return undefined;
  };
  const objFile = findByName(path.join(dir, 'obj'), 'link_err.o');
  if (objFile) {
    const objRel = path.relative(ctx.project.basePath, objFile).replace(/\\/g, '/');
    const objResolved = resolver({ file: `${objRel}:(.text+0x9)` }, ctx.project.basePath);
    check('S8 对象文件形态：不把 .o 当诊断文件，落回真实源码',
      !!objResolved && samePath(objResolved.file, src) && !/\.(o|obj)$/i.test(String(objResolved.file)), { objRel, resolved: objResolved });
    check('S9 对象文件形态：不残留 `:(.text` 伪路径',
      !!objResolved && !/:\(\.text/.test(String(objResolved.file).replace(/\\/g, '/')), objResolved);
  } else {
    skip++;
    console.log('SKIP 对象文件未生成（无法验证 .o 形态）');
  }
}

(async () => {
  try {
    if (!HAS_GCC) {
      skip++;
      console.log('SKIP 未找到 gcc（链接期诊断定位需要真实工具链）');
    } else {
      H.boot();
      await scenarioLinkerDiagnostic();
      await sleep(0);
    }
  } finally {
    H.shutDown();
  }
  console.log(`\nlinker-diagnostic: ${pass} pass, ${fail} fail, ${skip} skip`);
  process.exit(fail ? 1 : 0);
})();
