// L1 真实工程 E2E 构建矩阵（真实 gcc/g++/ar；探针工程在临时目录，测试后清理）
//
// 覆盖：全量构建 / 增量 up-to-date / 头文件依赖触发重编 / 单文件编译与清理 / 目标清理 /
//       对象目录自动创建 / 含空格路径 / 汇编源参与链接 / 链接脚本不参与 / 响应文件 /
//       pre-post 脚本 / 编译失败诊断 / compile_commands.json / 工作区依赖顺序 + 静态库
//
// 用法：node tests/e2e/test-e2e-build.js [--filter <子串>]
const fs = require('fs');
const path = require('path');
const H = require('./harness');

const args = process.argv.slice(2);
const filter = args.find((a) => a.startsWith('--filter='))?.split('=')[1]
  || (args.includes('--filter') ? args[args.indexOf('--filter') + 1] : '');

let pass = 0, fail = 0, skip = 0;
const failures = [];
function check(name, cond, got, want) {
  if (filter && !name.includes(filter)) return;
  if (cond) { pass++; console.log('OK   ' + name); }
  else {
    fail++;
    failures.push(name);
    console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`);
  }
}
function skipCheck(name, reason) {
  if (filter && !name.includes(filter)) return;
  skip++;
  console.log(`SKIP ${name}  ${reason}`);
}

const HAS_GCC = H.toolAvailable('gcc');
const HAS_GPP = H.toolAvailable('g++');
const HAS_AR = H.toolAvailable('ar');

const TP = ['hello-cb.cbp', 'main.c', 'util.c', 'util.h'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scenarioHelloCb() {
  const dir = H.copyTestProject(TP, '');
  const cbp = path.join(dir, 'hello-cb.cbp');
  const exe = path.join(dir, 'bin', 'Debug', 'hello.exe');

  const ctx = H.openProject(cbp);
  const target = 'Debug';

  // S1 全量构建 → 产物存在 + 编译命令数正确
  const full = await H.build(ctx, target);
  check('S1 全量构建成功', full.ok, full.ok, true);
  check('S1 产物 hello.exe 生成', fs.existsSync(exe), exe, '存在');
  check('S1 编译命令 ≥2（main.c + util.c）', full.commands.filter((c) => / -c /.test(c)).length >= 2, full.commands.length, '≥2');
  const objMain = path.join(dir, 'obj', 'Debug', 'main.o');
  const objUtil = path.join(dir, 'obj', 'Debug', 'util.o');
  check('S1 对象文件落 object_output 目录', fs.existsSync(objMain) && fs.existsSync(objUtil), [fs.existsSync(objMain), fs.existsSync(objUtil)], [true, true]);

  // S2 增量 up-to-date → 零编译命令
  const second = await H.build(ctx, target);
  check('S2 二次构建成功', second.ok, second.ok, true);
  check('S2 增量 up-to-date（零编译/链接命令）', second.commands.length === 0, second.commands, []);

  // S3 头文件变更 → 依赖它的源文件重编
  await sleep(1100); // 避免与上一次构建同毫秒（mtime 精度）
  H.touch(path.join(dir, 'util.h'));
  const third = await H.build(ctx, target);
  check('S3 头文件变更触发重编 + 重链', third.ok && third.commands.length >= 3, third.commands.length, '≥3');
  check('S3 重编包含 main.c 与 util.c', third.commands.some((c) => c.includes('main.c')) && third.commands.some((c) => c.includes('util.c')), third.commands, '两者');

  // S4 源文件变更 → 仅该文件重编
  await sleep(1100);
  H.touch(path.join(dir, 'util.c'));
  const fourth = await H.build(ctx, target);
  const compiled = fourth.commands.filter((c) => / -c /.test(c)).map((c) => c.replace(/\\/g, '/'));
  check('S4 仅重编 util.c', compiled.length === 1 && compiled[0].includes('util.c'), compiled, ['util.c']);

  // S5 Rebuild（clean + build）
  ctx.engine.cleanTarget(ctx.project.buildTargets.find((t) => t.title === target));
  check('S5 cleanTarget 删除 exe 与对象', !fs.existsSync(exe) && !fs.existsSync(objMain), [fs.existsSync(exe), fs.existsSync(objMain)], [false, false]);
  const rebuilt = await H.build(ctx, target);
  check('S5 Rebuild 后产物恢复', rebuilt.ok && fs.existsSync(exe), rebuilt.ok, true);

  // S6 单文件 compile / cleanFile
  ctx.engine.cleanFile(target, 'util.c');
  check('S6 cleanFile 删除对象', !fs.existsSync(objUtil), fs.existsSync(objUtil), false);
  const single = await H.compileFile(ctx, target, 'util.c');
  check('S6 单文件编译成功且产物恢复', single.ok && fs.existsSync(objUtil), single.ok, true);

  // S7 对象目录自动创建
  fs.rmSync(path.join(dir, 'obj'), { recursive: true, force: true });
  const recreated = await H.build(ctx, target);
  check('S7 删除对象目录后可自动重建并构建成功', recreated.ok && fs.existsSync(objMain), recreated.ok, true);

  // S8 编译失败 → 返回 false 且诊断可解析
  const broken = path.join(dir, 'broken.c');
  fs.writeFileSync(broken, 'int main(void) { this is not c; }\n', 'utf-8');
  const cbpText = fs.readFileSync(cbp, 'utf-8').replace('<Unit filename="util.c" />', '<Unit filename="util.c" />\n\t\t<Unit filename="broken.c" />');
  fs.writeFileSync(cbp, cbpText, 'utf-8');
  const badCtx = H.openProject(cbp);
  const failed = await H.build(badCtx, target);
  check('S8 编译失败返回 false', failed.ok === false, failed.ok, false);
  const errLines = failed.lines.filter((l) => /error/i.test(String(l.line)));
  check('S8 失败输出含 error 诊断行', errLines.length > 0, errLines.length, '>0');
  fs.rmSync(broken, { force: true });
  fs.writeFileSync(cbp, fs.readFileSync(cbp, 'utf-8').replace(/\n\t\t<Unit filename="broken.c" \/>/, ''), 'utf-8');
}

async function scenarioSpacesAndAsm() {
  // S9 含空格路径：把工程放到 "cb e2e space" 目录
  const base = H.mkTemp('cb-e2e-space-');
  const dir = path.join(base, 'proj with space');
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of TP) {
    const dst = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(H.root, 'test-project', rel), dst);
  }
  const ctx = H.openProject(path.join(dir, 'hello-cb.cbp'));
  const res = await H.build(ctx, 'Debug');
  check('S9 含空格路径构建成功', res.ok && fs.existsSync(path.join(dir, 'bin', 'Debug', 'hello.exe')), res.ok, true);
  check('S9 命令行对含空格路径加引号', res.commands.some((c) => c.includes('"')), res.commands.slice(0, 2), '含引号');

  // S10 汇编源参与编译与链接；链接脚本 .ld 不编译不链接
  if (!HAS_GCC) { skipCheck('S10 汇编源/链接脚本处理', 'gcc 不可用'); return; }
  const dir2 = H.mkTemp('cb-e2e-asm-');
  H.writeFile(path.join(dir2, 'main.c'), 'extern int asm_add(int, int);\n#include <stdio.h>\nint main(void){ printf("%d\\n", asm_add(2,3)); return 0; }\n');
  H.writeFile(path.join(dir2, 'add.S'), '.text\n.globl asm_add\nasm_add:\n\tmovl %edi, %eax\n\taddl %esi, %eax\n\tret\n');
  H.writeFile(path.join(dir2, 'app.ld'), '/* linker script probe */\nSECTIONS { }\n');
  H.writeFile(path.join(dir2, 'asm-demo.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="asm-demo" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option output="bin/Debug/asm-demo" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t\t<Compiler><Add option="-g" /></Compiler>
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t\t<Unit filename="add.S" />
\t\t<Unit filename="app.ld" />
\t</Project>
</CodeBlocks_project_file>
`);
  const ctx2 = H.openProject(path.join(dir2, 'asm-demo.cbp'));
  const res2 = await H.build(ctx2, 'Debug');
  const allCmds = res2.commands.join(' ');
  check('S10 汇编源参与编译（生成 add.o）', fs.existsSync(path.join(dir2, 'obj', 'Debug', 'add.o')), res2.ok, true);
  check('S10 链接命令包含汇编对象', /add\.o/.test(allCmds), allCmds.slice(0, 200), 'add.o');
  check('S10 链接脚本 .ld 不编译不链接', !/app\.ld/.test(allCmds), allCmds.slice(0, 200), '不含 app.ld');
  const exe = path.join(dir2, 'bin', 'Debug', 'asm-demo.exe');
  check('S10 产物可执行文件生成', fs.existsSync(exe), exe, '存在');
}

async function scenarioLongCommandAndScripts() {
  // S11 超长命令行 → 响应文件（.respFile）
  const { generateBigProject } = require('../perf/fixtures');
  const dir = H.mkTemp('cb-e2e-resp-');
  const big = generateBigProject(dir, { files: 220, dirs: 5, targets: ['Debug'], withSources: true, longNames: true });
  // 探针工程需要 main() 才能链接成功（生成器产出的是纯函数，无入口）；写入首个 .c
  const firstC = big.sourceFiles.find((p) => p.endsWith('.c'));
  fs.writeFileSync(firstC, 'int main(void) { return 0; }\n', 'utf-8');
  const ctx = H.openProject(big.cbp);
  const res = await H.build(ctx, 'Debug');
  const linkLine = res.lines.map((l) => String(l.line)).find((l) => / -o bin/.test(l) || /-o "?bin/.test(l)) || '';
  check('S11 链接命令行长度超过响应文件阈值（>8000）', linkLine.length > 8000, linkLine.length, '>8000');
  const respFiles = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.respFile$/i.test(e.name)) respFiles.push(p);
    }
  };
  walk(dir);
  check('S11 超长命令行改用响应文件', res.ok && respFiles.length > 0, { ok: res.ok, respFiles: respFiles.length }, '存在 .respFile');
  check('S11 响应文件位于对象输出目录', respFiles.every((p) => p.includes(path.sep + 'obj' + path.sep)), respFiles, 'obj/ 下');

  // S12 pre/post 构建脚本真实执行（.bat 生成标记文件）
  const dir2 = H.mkTemp('cb-e2e-script-');
  H.writeFile(path.join(dir2, 'main.c'), 'int main(void){return 0;}\n');
  H.writeFile(path.join(dir2, 'pre.bat'), '@echo off\r\necho pre > pre.marker\r\n');
  H.writeFile(path.join(dir2, 'post.bat'), '@echo off\r\necho post > post.marker\r\n');
  H.writeFile(path.join(dir2, 'script-demo.cbp'), `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="script-demo" />
\t\t<Option compiler="gcc" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option output="bin/Debug/script-demo" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t</Target>
\t\t</Build>
\t\t<ExtraCommands>
\t\t\t<Add before="cmd /c pre.bat" />
\t\t\t<Add after="cmd /c post.bat" />
\t\t</ExtraCommands>
\t\t<Unit filename="main.c" />
\t</Project>
</CodeBlocks_project_file>
`);
  const ctx2 = H.openProject(path.join(dir2, 'script-demo.cbp'));
  const res2 = await H.build(ctx2, 'Debug');
  check('S12 pre/post 构建命令执行（标记文件生成）',
    res2.ok && fs.existsSync(path.join(dir2, 'pre.marker')) && fs.existsSync(path.join(dir2, 'post.marker')),
    res2.ok, '两个标记文件');
}

async function scenarioCompileCommands() {
  // S13 compile_commands.json 生成（clangd 索引入口）
  const dir = H.copyTestProject(TP, '');
  const ctx = H.openProject(path.join(dir, 'hello-cb.cbp'));
  const { collectClangdEntries, writeClangdDatabase } = H.modules();
  const entries = collectClangdEntries(ctx.project, ctx.getCompiler(((ctx.project.buildTargets[0] || {}).compilerId) || ctx.project.compilerId), { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }, []);
  const outDir = H.mkTemp('cb-e2e-cc-');
  writeClangdDatabase(entries, outDir);
  const cc = path.join(outDir, 'compile_commands.json');
  check('S13 compile_commands.json 生成', fs.existsSync(cc), cc, '存在');
  if (fs.existsSync(cc)) {
    const parsed = JSON.parse(fs.readFileSync(cc, 'utf-8'));
    check('S13 条目覆盖全部 C 源（≥2）', parsed.length >= 2, parsed.length, '≥2');
    check('S13 条目含 directory/command/file', parsed.every((e) => e.directory && e.command && e.file), parsed.slice(0, 1), '字段齐备');
    check('S13 命令为真实编译命令（含 -c）', parsed.every((e) => / -c /.test(e.command)), parsed[0] && parsed[0].command, '含 -c');
  }
}

async function scenarioWorkspace() {
  // S14 工作区依赖：dep-lib 先于 dep-app；静态库产物生成
  if (!HAS_AR) { skipCheck('S14 工作区依赖构建（静态库）', 'ar 不可用'); return; }
  const files = ['dep-test.workspace', 'dep-lib/dep-lib.cbp', 'dep-lib/lib.c', 'dep-lib/lib.h', 'dep-app/dep-app.cbp', 'dep-app/main.c'];
  const dir = H.copyTestProject(files, '');
  const { WorkspaceParser } = H.modules();
  const ws = new WorkspaceParser().parse(path.join(dir, 'dep-test.workspace'));
  check('S14 工作区解析出 2 个项目', ws.projectPaths.length === 2, ws.projectPaths, 2);
  check('S14 依赖方向为 dep-app → dep-lib',
    JSON.stringify(ws.dependencies['dep-app/dep-app.cbp']) === JSON.stringify(['dep-lib/dep-lib.cbp']),
    ws.dependencies, { 'dep-app/dep-app.cbp': ['dep-lib/dep-lib.cbp'] });

  const libCtx = H.openProject(path.join(dir, 'dep-lib', 'dep-lib.cbp'));
  const libRes = await H.build(libCtx, 'Debug');
  const libFile = path.join(dir, 'dep-lib', 'bin', 'Debug', 'libdep_lib.a');
  check('S14 静态库构建成功', libRes.ok && fs.existsSync(libFile), libRes.ok, true);
  check('S14 归档命令使用 ar', libRes.commands.some((c) => /(^|\s)ar(\.exe)?(\s|$)/i.test(c)), libRes.commands.slice(-1), 'ar');

  const appCtx = H.openProject(path.join(dir, 'dep-app', 'dep-app.cbp'));
  const appRes = await H.build(appCtx, 'Debug');
  check('S14 依赖项目（可执行）构建成功', appRes.ok && fs.existsSync(path.join(dir, 'dep-app', 'bin', 'Debug', 'dep_app.exe')), appRes.ok, true);
}

async function main() {
  if (!HAS_GCC) {
    console.log('SKIP e2e：gcc 不可用，跳过真实工程构建矩阵');
    console.log('\ne2e 构建矩阵: 0 pass, 0 fail, 1 skip');
    process.exit(0);
  }
  H.boot();
  try {
    await scenarioHelloCb();
    await scenarioSpacesAndAsm();
    await scenarioLongCommandAndScripts();
    await scenarioCompileCommands();
    await scenarioWorkspace();
  } finally {
    H.shutDown();
  }
  console.log(`\ne2e 构建矩阵: ${pass} pass, ${fail} fail, ${skip} skip${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('e2e 运行异常: ' + (err && err.stack ? err.stack : err));
  H.shutDown();
  process.exit(1);
});
