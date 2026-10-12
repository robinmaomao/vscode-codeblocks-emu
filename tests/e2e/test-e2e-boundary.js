// L1 边界/异常 E2E：真实工程探针 × 可激活扩展（extensionActivation + dist 产物 + 真实 gcc）
//
// 覆盖五类边界场景（对应待办 p5-e2e-boundary）：
//   S1 畸形工程：截断/未闭合 XML、未知 <Option>、空 .cbp、缺失源文件、<Target> 缺 output/title
//   S2 只读/写盘失败注入：目录真实只读（Windows 上不可靠时退化为写注入）→ 输出目录/对象目录被同名文件占位
//   S3 超长路径（>260，\\?\ 前缀）与 UNC（不可达主机 / 不存在的共享 / 可管理共享时真实构建）
//   S4 构建取消：真实慢 pre-build 中途 codeblocks.build.stop → 无半成品、无挂死、后续构建仍成功
//   S5 并发/重入：构建进行中的第二次 Build（明确拒绝）+ 同 tick 双发（互斥窗口竞态）+ 后续构建
//
// 观测口径（不依赖宿主私有 API）：
//   · 输出通道：mock 的 'Code::Blocks' OutputChannel（普通通道 appendLine 落 lines[]，clear() 清空）
//   · 用户可见提示：app.mock.warnings（含 showErrorMessage/showWarningMessage 文案）与
//     app.records.warningButtons（带按钮的 showWarningMessage 留痕）
//   · 产物/状态：真实文件系统（exe 是否存在、占位文件是否被破坏、对象目录是否残留）
//   · 并发进程：tasklist 采样 PING.EXE 数量（慢 pre-build 的探针进程）
//
// 前置条件：PATH 上有 gcc（本机 mingw64 可用）。缺失时整组 SKIP 并打印原因；绝不静默通过。
// 说明：全程只激活一次扩展（mock 是进程级安装，重复激活会让 dist 模块与新 mock 混用导致误判）；
//       工程探针一律生成在 os.tmpdir 临时目录，结束清理（仓库零污染）。
//
// 边界缺陷修复断言（阶段 5：本组用例先复现 6 条真实缺陷 C1–C6，随后产品侧修复，断言已翻转为「应有行为」）：
//   · S1.2/S1.3 截断与未闭合 XML → 可读中文错误（D-14，src/model/parser.ts parseXmlText）
//   · S5.2 同 tick 双发必须被互斥拒绝（D-15，src/extension.ts claimBuildMutex 先置位后 await）
//   · S4.3 取消上报为「构建已取消」而非失败（D-16，从 cancelSource 判定）
//   · S1.7 缺 <Output> 提前拦截（D-18）；S1.9 重复 <ExtraCommands> 不再丢命令（D-19）
//   · S2.4 对象目录创建失败在输出通道可见（D-17）
//
// 用法：node tests/e2e/test-e2e-boundary.js [--filter <子串>]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./harness');
const { activate } = require('../_harness/extensionActivation');
const { generateBigProject } = require('../_harness/projectFixtures');

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

// 候选线索收集（历史用途：本轮 S1–S5 探出的 6 条缺陷 C1–C6 已全部修复并翻转为断言）
const OBSERVATIONS = [];
function noteObservation(text) {
  OBSERVATIONS.push(text);
  console.log('     OBS ' + text);
}

const HAS_GCC = H.toolAvailable('gcc');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(cond, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (cond()) return true; await sleep(40); }
  return cond();
}
/** 有界收敛：返回 'resolved' | 'rejected:<msg>' | 'TIMEOUT' */
function settle(p, ms = 120000) {
  return Promise.race([
    p.then(() => 'resolved', (e) => 'rejected:' + (e && e.message)),
    sleep(ms).then(() => 'TIMEOUT'),
  ]);
}
/** 采样 PING.EXE 进程数（慢 pre-build 探针；用于证明"真的在构建/真的并发"） */
function pingCount() {
  const r = spawnSync('tasklist', ['/FI', 'IMAGENAME eq PING.EXE', '/NH'], { encoding: 'utf-8', windowsHide: true });
  return ((r.stdout || '').match(/PING\.EXE/gi) || []).length;
}
/** 提取可读错误行（证据字符串用，限长避免刷屏） */
function errorLines(text, n = 5) {
  return text.split(/\r?\n/)
    .filter((l) => /error|Error|失败|无法|中止|No such|fatal|not a directory/i.test(l))
    .slice(0, n).map((l) => l.trim().slice(0, 150));
}

// ---------- 扩展实例（单次激活，全场景复用） ----------
let app = null;
let channel = null;
const logLines = () => (channel ? channel.lines.join('\n') : '');
const errToasts = () => app.mock.warnings;                 // showErrorMessage / showWarningMessage(单参)
const warnToasts = () => app.records.warningButtons.map((w) => String(w.message));
async function openInExt(cbp, ms = 45000) { return settle(app.invoke('codeblocks.openProject', cbp), ms); }
async function activateProject(cbp) { return settle(app.invoke('codeblocks.setActiveProject', cbp), 10000); }
async function runBuild(ms = 120000) { return settle(app.invoke('codeblocks.build'), ms); }

// ---------- 探针工程生成 ----------
const MAIN_C = 'int main(void) { return 0; }\n';

/** 写一个最小合法 .cbp；可用开关制造缺 output / 缺 title 的畸形目标 */
function mkCbp(dir, file, opts = {}) {
  const {
    title = path.basename(file, '.cbp'),
    targetTitle = 'Debug',
    includeTitle = true,
    output = `bin/Debug/${title}`,
    includeOutput = true,
    objectOutput = 'obj/Debug/',
    units = ['main.c'],
    extraProject = '',
    extraTarget = '',
  } = opts;
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="${title}" />
\t\t<Option compiler="gcc" />
${extraProject}\t\t<Build>
\t\t\t<Target${includeTitle ? ` title="${targetTitle}"` : ''}>
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
${includeOutput ? `\t\t\t\t<Option output="${output}" />\n` : ''}\t\t\t\t<Option object_output="${objectOutput}" />
${extraTarget}\t\t\t</Target>
\t\t</Build>
${units.map((u) => `\t\t<Unit filename="${u}" />`).join('\n')}
\t</Project>
</CodeBlocks_project_file>
`;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), xml, 'utf-8');
  return path.join(dir, file);
}
function mkProjDir(prefix, fileName, opts = {}) {
  const dir = H.mkTemp(prefix);
  fs.writeFileSync(path.join(dir, 'main.c'), MAIN_C, 'utf-8');
  return { dir, cbp: mkCbp(dir, fileName, opts) };
}
const exeOf = (dir, name) => path.join(dir, 'bin', 'Debug', `${name}.exe`);

// ---------- S6 编译器程序路径作用域（D-20 回归） ----------
// 旧行为：`codeblocks.compilerPrograms` 是全局的，用「探测编译器」选定交叉编译器后，
// `<Option compiler="gcc">` 的工程也会被静默改用交叉工具链。修复后：程序路径按家族 id 作用域解析，
// 旧扁平形态只对「它所属的全局 compilerId」生效。
async function scenarioCompilerProgramsScope() {
  const store = app.mock.configStore;
  const prevPrograms = store['codeblocks.compilerPrograms'];
  const prevCompilerId = store['codeblocks.compilerId'];
  const bogus = path.join(os.tmpdir(), 'cb-e2e-no-such-family', 'avr-gcc.exe'); // 不存在的程序路径：被误用时构建必然失败
  const probe = mkProjDir('cb-e2e-progscope-', 'progscope.cbp', { title: 'progscope' });
  // 每次断言前清空 bin+obj：否则增量判定会跳过编译，只能用陈旧对象链接 ⇒ 无法真正验证「用了哪个编译器」
  const wipe = () => { for (const d of ['bin', 'obj']) fs.rmSync(path.join(probe.dir, d), { recursive: true, force: true }); };
  try {
    await openInExt(probe.cbp);
    await activateProject(probe.cbp);

    // S6.1 新形态（按 id 分组）：别的家族的程序路径不得影响本工程
    wipe();
    store['codeblocks.compilerPrograms'] = { 'avr-gcc': { C: bogus, CPP: bogus } };
    store['codeblocks.compilerId'] = 'gcc';
    const s61 = await runBuild();
    const text61 = logLines();
    check('S6.1 程序路径按家族作用域：其它家族（avr-gcc）的路径不影响 gcc 工程构建（D-20 已修）',
      s61 === 'resolved' && fs.existsSync(exeOf(probe.dir, 'progscope')) && !text61.includes('cb-e2e-no-such-family'),
      `settle=${s61} exe=${fs.existsSync(exeOf(probe.dir, 'progscope'))} 误用=${text61.includes('cb-e2e-no-such-family')}`,
      'resolved + exe 存在 + 日志无被误用的程序路径');

    // S6.2 旧扁平形态：只对「写入时的全局 compilerId」生效（此处全局 id 是 avr-gcc ≠ 工程的 gcc ⇒ 不生效）
    wipe();
    store['codeblocks.compilerPrograms'] = { C: bogus, CPP: bogus };
    store['codeblocks.compilerId'] = 'avr-gcc';
    const s62 = await runBuild();
    const text62 = logLines();
    check('S6.2 旧扁平形态不再泄漏到别的家族（全局 compilerId=avr-gcc，工程声明 gcc）',
      s62 === 'resolved' && fs.existsSync(exeOf(probe.dir, 'progscope')) && !text62.includes('cb-e2e-no-such-family'),
      `settle=${s62} exe=${fs.existsSync(exeOf(probe.dir, 'progscope'))} 误用=${text62.includes('cb-e2e-no-such-family')}`,
      'resolved + exe 存在 + 日志无被误用的程序路径');

    // S6.3 兼容性正对照：旧扁平形态在「全局 compilerId === 工程家族」时仍然生效（否则会破坏既有用户配置）
    wipe();
    store['codeblocks.compilerId'] = 'gcc';
    const s63 = await runBuild();
    const text63 = logLines();
    check('S6.3 兼容性正对照：扁平形态在所属家族上仍生效（编译失败 + 日志出现该程序路径）',
      s63 === 'resolved' && !fs.existsSync(exeOf(probe.dir, 'progscope')) && text63.includes('cb-e2e-no-such-family'),
      `settle=${s63} exe=${fs.existsSync(exeOf(probe.dir, 'progscope'))} 命中=${text63.includes('cb-e2e-no-such-family')}`,
      'resolved + 无 exe + 日志命中该程序路径');
  } finally {
    if (prevPrograms === undefined) delete store['codeblocks.compilerPrograms'];
    else store['codeblocks.compilerPrograms'] = prevPrograms;
    if (prevCompilerId === undefined) delete store['codeblocks.compilerId'];
    else store['codeblocks.compilerId'] = prevCompilerId;
  }
}

// ---------- S1 畸形工程 ----------
async function scenarioMalformed() {
  const { ProjectParser } = require('../../dist/model/parser.js');
  const dir = H.mkTemp('cb-e2e-bad-');
  const parseOf = (f) => {
    try { return { ok: true, project: new ProjectParser().parse(f) }; }
    catch (e) { return { ok: false, message: String(e && e.message) }; }
  };

  // S1.1/S1.2 截断 XML
  const trunc = path.join(dir, 'trunc.cbp');
  fs.writeFileSync(trunc, '<CodeBlocks_project_file>\n\t<Project>\n\t\t<Option title="trunc"', 'utf-8');
  const rT = parseOf(trunc);
  check('S1.1 截断 XML：解析报错（不产生半成品工程对象）',
    rT.ok === false && !!rT.message, rT.ok ? 'parse 返回对象' : rT.message);
  const e12 = errToasts().length;
  const s12 = await openInExt(trunc);
  const toast12 = errToasts().slice(e12).join(' | ');
  const readable12 = /打开项目失败/.test(toast12) && /[\u4e00-\u9fa5]/.test(toast12.replace('打开项目失败', ''));
  check('S1.2 截断 XML：openProject 不崩溃且提示可读（D-14 已修：中文 + 结构错误定位）',
    s12 === 'resolved' && readable12 && /XML 结构错误/.test(toast12),
    `settle=${s12} toast=${toast12}`, 'resolved + 可读中文提示（XML 结构错误）');

  // S1.3 未闭合标签：结构错误 → 可读中文错误（不再静默降级成「标题可用、0 目标」的半成品工程，D-14）
  const uncl = path.join(dir, 'unclosed.cbp');
  fs.writeFileSync(uncl, '<?xml version="1.0"?><CodeBlocks_project_file><Project><Option title="unclosed"></Project></CodeBlocks_project_file>', 'utf-8');
  const rU = parseOf(uncl);
  check('S1.3 未闭合标签：解析抛可读中文错误（不再静默降级）',
    rU.ok === false && /不是有效的 \.cbp 文件/.test(rU.message || '') && /XML 结构错误/.test(rU.message || ''),
    rU.ok ? `title=${rU.project.title} targets=${rU.project.buildTargets.length}` : rU.message,
    '抛错 + 不是有效的 .cbp 文件：XML 结构错误');

  // S1.3b 合法 XML 但没有任何 <Target> → 构建时中文早退「项目没有构建目标」
  const noTarget = path.join(dir, 'no-target.cbp');
  fs.writeFileSync(noTarget, `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="no-target" />
\t\t<Option compiler="gcc" />
\t</Project>
</CodeBlocks_project_file>
`, 'utf-8');
  const rNT = parseOf(noTarget);
  check('S1.3b 合法 XML 无 <Target>：解析成功但目标为空',
    rNT.ok === true && rNT.project.title === 'no-target' && rNT.project.buildTargets.length === 0,
    rNT.ok ? `title=${rNT.project.title} targets=${rNT.project.buildTargets.length}` : rNT.message, 'title=no-target targets=0');
  await openInExt(noTarget);
  await activateProject(noTarget);
  const w13 = warnToasts().length;
  const s13 = await runBuild(60000);
  const warn13 = warnToasts().slice(w13).join(' | ');
  check('S1.3c 无目标工程构建：中文提示「项目没有构建目标」且不进入构建',
    s13 === 'resolved' && /项目没有构建目标/.test(warn13), `settle=${s13} warns=${warn13 || '（无）'}`, 'resolved + 项目没有构建目标');

  // S1.4 未知 <Option> / 未知节点：忽略未知项、保留 <Add> 收集；工程仍可构建
  const unknownXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<CodeBlocks_project_file>
\t<FileVersion major="1" minor="6" />
\t<Project>
\t\t<Option title="unknown-opt" />
\t\t<Option compiler="gcc" />
\t\t<Option bogus_project_option="7" />
\t\t<Build>
\t\t\t<Target title="Debug">
\t\t\t\t<Option type="1" />
\t\t\t\t<Option compiler="gcc" />
\t\t\t\t<Option output="bin/Debug/unknown-opt" />
\t\t\t\t<Option object_output="obj/Debug/" />
\t\t\t\t<Compiler>
\t\t\t\t\t<Option unknown_attr="1" />
\t\t\t\t\t<Add option="-DPROBE=1" />
\t\t\t\t\t<BogusNode><Option x="1" /></BogusNode>
\t\t\t\t</Compiler>
\t\t\t\t<Linker>
\t\t\t\t\t<Option other_unknown="2" />
\t\t\t\t\t<Add library="m" />
\t\t\t\t</Linker>
\t\t\t</Target>
\t\t</Build>
\t\t<Unit filename="main.c" />
\t</Project>
</CodeBlocks_project_file>
`;
  const unkDir = H.mkTemp('cb-e2e-unk-');
  fs.writeFileSync(path.join(unkDir, 'main.c'), MAIN_C, 'utf-8');
  const unkCbp = path.join(unkDir, 'unknown-opt.cbp');
  fs.writeFileSync(unkCbp, unknownXml, 'utf-8');
  const rP = parseOf(unkCbp);
  const tgt = rP.ok ? rP.project.buildTargets[0] : undefined;
  check('S1.4 未知 <Option>：忽略未知节点且 <Add option/library> 正常收集',
    rP.ok === true && !!tgt && tgt.compilerOptions.includes('-DPROBE=1') && tgt.linkLibs.includes('m'),
    rP.ok ? `compilerOptions=${JSON.stringify(tgt.compilerOptions)} linkLibs=${JSON.stringify(tgt.linkLibs)}` : rP.message);
  await openInExt(unkCbp);
  await activateProject(unkCbp);
  const s14 = await runBuild();
  check('S1.4b 含未知 <Option> 的工程仍可完整构建',
    s14 === 'resolved' && fs.existsSync(exeOf(unkDir, 'unknown-opt')),
    `settle=${s14} exe=${fs.existsSync(exeOf(unkDir, 'unknown-opt'))}`, 'resolved + exe 存在');

  // S1.5 空 .cbp / 纯空白 .cbp
  const empty = path.join(dir, 'empty.cbp');
  const ws = path.join(dir, 'ws.cbp');
  fs.writeFileSync(empty, '', 'utf-8');
  fs.writeFileSync(ws, '   \r\n \t', 'utf-8');
  const rE = parseOf(empty);
  const rW = parseOf(ws);
  check('S1.5 空/纯空白 .cbp：受控中文错误（不是有效的 .cbp 文件）',
    rE.ok === false && /不是有效的 \.cbp 文件/.test(rE.message) && rW.ok === false && /不是有效的 \.cbp 文件/.test(rW.message),
    `${rE.message} | ${rW.message}`);
  const e15 = errToasts().length;
  const s15 = await openInExt(empty);
  check('S1.5b 扩展对空 .cbp 报「打开项目失败」且不崩溃',
    s15 === 'resolved' && /打开项目失败: 不是有效的 \.cbp 文件/.test(errToasts().slice(e15).join(' ')),
    `settle=${s15} toast=${errToasts().slice(e15).join(' | ')}`);

  // S1.6 .cbp 指向不存在的源文件
  const miss = mkProjDir('cb-e2e-bad-miss-', 'miss.cbp', { title: 'miss', units: ['missing.c'] });
  await openInExt(miss.cbp);
  await activateProject(miss.cbp);
  const s16 = await runBuild();
  const text16 = logLines();
  check('S1.6 引用不存在源文件：构建失败且给出诊断（不崩溃、无产物）',
    s16 === 'resolved' && /构建失败/.test(text16) && !fs.existsSync(exeOf(miss.dir, 'miss')),
    `settle=${s16} exe=${fs.existsSync(exeOf(miss.dir, 'miss'))} 诊断=${JSON.stringify(errorLines(text16, 3))}`,
    'resolved + 构建失败 + 无 exe');

  // S1.7 <Target> 缺 output（保留 title）
  const noOut = mkProjDir('cb-e2e-bad-noout-', 'noout.cbp', { title: 'noout', includeOutput: false });
  await openInExt(noOut.cbp);
  await activateProject(noOut.cbp);
  const s17 = await runBuild();
  const text17 = logLines();
  check('S1.7 目标缺 <Option output>：构建失败且中文提示「未配置输出文件名」（不崩溃、无产物）',
    s17 === 'resolved' && /构建失败/.test(text17) && /未配置输出文件名/.test(text17) && !fs.existsSync(exeOf(noOut.dir, 'noout')),
    `settle=${s17} 诊断=${JSON.stringify(errorLines(text17, 3))}`, 'resolved + 构建失败 + 未配置输出文件名 + 无 exe');
  const badLinkCmd = (text17.match(/(?:gcc|g\+\+)[^\n]*-o[^\n]*/g) || [])[0];
  check('S1.7b 缺 <Option output>：不再生成畸形链接命令（D-18 已修）',
    !badLinkCmd, `畸形链接命令=${badLinkCmd ? badLinkCmd.trim().slice(0, 90) : '（无）'}`, '无 -o 链接命令');

  // S1.8 <Target> 缺 title（且缺 output）
  const noTitle = mkProjDir('cb-e2e-bad-notitle-', 'notitle.cbp', { title: 'notitle', includeTitle: false, includeOutput: false });
  await openInExt(noTitle.cbp);
  await activateProject(noTitle.cbp);
  const w18 = warnToasts().length;
  const s18 = await runBuild(60000);
  const warn18 = warnToasts().slice(w18).join(' | ');
  check('S1.8 目标缺 title：中文警告「项目没有构建目标」且不进入构建（不崩溃）',
    s18 === 'resolved' && /项目没有构建目标/.test(warn18), `settle=${s18} warns=${warn18 || '（无）'}`, 'resolved + 项目没有构建目标');

  // S1.9 重复 <ExtraCommands> 块（畸形但合法 XML）→ 两处 pre-build 命令都必须保留（D-19 已修）
  {
    const dupDir = H.mkTemp('cb-e2e-dupextra-');
    fs.writeFileSync(path.join(dupDir, 'main.c'), MAIN_C, 'utf-8');
    const dupCbp = mkCbp(dupDir, 'dup.cbp', { title: 'dup' });
    fs.writeFileSync(dupCbp, fs.readFileSync(dupCbp, 'utf-8')
      .replace('\t\t<Build>', '\t\t<ExtraCommands>\n\t\t\t<Add before="echo FIRST" />\n\t\t</ExtraCommands>\n\t\t<Build>')
      .replace('\t</Project>', '\t\t<ExtraCommands>\n\t\t\t<Add before="echo SECOND" />\n\t\t</ExtraCommands>\n\t</Project>'), 'utf-8');
    const dupProj = new ProjectParser().parse(dupCbp);
    check('S1.9 重复 <ExtraCommands>：两处 pre-build 命令全部保留',
      dupProj.commandsBeforeBuild.join('|') === 'echo FIRST|echo SECOND',
      JSON.stringify(dupProj.commandsBeforeBuild), '["echo FIRST","echo SECOND"]');
  }
}

// ---------- S2 只读目录 / 写盘失败注入 ----------
async function scenarioWriteDenied() {
  // S2.1 真实只读尝试：先验证只读是否真的生效（Windows 非管理员下 chmod/attrib 通常无效）
  const roRoot = H.mkTemp('cb-e2e-ro-');
  const roSub = path.join(roRoot, 'sub');
  fs.mkdirSync(roSub, { recursive: true });
  fs.chmodSync(roSub, 0o555);
  spawnSync('attrib', ['+R', roSub], { windowsHide: true });
  const probeFile = path.join(roSub, 'write-probe.tmp');
  let stillWritable = false;
  try { fs.writeFileSync(probeFile, 'probe'); stillWritable = true; } catch { /* 真只读时抛错 */ }
  let modeStr = '';
  try { modeStr = (fs.statSync(roSub).mode & 0o777).toString(8); } catch { /* ignore */ }
  if (stillWritable) {
    fs.rmSync(probeFile, { force: true });
    spawnSync('attrib', ['-R', roSub], { windowsHide: true });
    fs.chmodSync(roSub, 0o755);
    skipCheck('S2.1 真实只读目录下的构建',
      `本机无法构造真实只读：chmod 0o555（目录 mode 实测 ${modeStr}）+ attrib +R 后写探针仍成功（非管理员 Windows 下目录只读位不阻止新建文件）→ 按任务约定退化为写盘失败注入（S2.2/S2.4）`);
  } else {
    const roProj = path.join(roSub, 'proj');
    fs.mkdirSync(roProj, { recursive: true });
    fs.writeFileSync(path.join(roProj, 'main.c'), MAIN_C, 'utf-8');
    const roCbp = mkCbp(roProj, 'ro.cbp', { title: 'ro' });
    fs.chmodSync(roProj, 0o555);
    try {
      const so = await openInExt(roCbp);
      await activateProject(roCbp);
      const sb = await runBuild();
      const text = logLines();
      check('S2.1 真实只读目录下的构建：可读错误且不崩溃、无产物',
        so === 'resolved' && sb === 'resolved' && !fs.existsSync(exeOf(roProj, 'ro')) && /无法创建|失败|error/i.test(text),
        `open=${so} build=${sb} 诊断=${JSON.stringify(errorLines(text, 3))}`, 'resolved + 可读错误 + 无 exe');
    } finally {
      fs.chmodSync(roProj, 0o755);
      fs.chmodSync(roSub, 0o755);
      spawnSync('attrib', ['-R', roSub], { windowsHide: true });
    }
  }

  // S2.2 输出目录写注入：bin 位置放同名文件 → mkdir 失败（ENOTDIR）
  const injDir = H.copyTestProject(['hello-cb.cbp', 'main.c', 'util.c', 'util.h'], 'inj');
  const injCbp = path.join(injDir, 'hello-cb.cbp');
  const blocker = path.join(injDir, 'bin');
  fs.writeFileSync(blocker, 'blocking file\n', 'utf-8');
  await openInExt(injCbp);
  await activateProject(injCbp);
  const s22 = await runBuild();
  const text22 = logLines();
  const exe22 = path.join(injDir, 'bin', 'Debug', 'hello.exe');
  check('S2.2 输出目录被同名文件占位：可读中文错误 + 构建失败 + 不崩溃',
    s22 === 'resolved' && /无法创建输出目录，目标 "Debug" 中止/.test(text22) && /构建失败/.test(text22) && !fs.existsSync(exe22),
    `settle=${s22} exe=${fs.existsSync(exe22)} 关键行=${JSON.stringify(errorLines(text22, 3))}`,
    'resolved + 无法创建输出目录…中止 + 构建失败');
  check('S2.2b 占位文件未被破坏（仍是普通文件）',
    fs.existsSync(blocker) && fs.statSync(blocker).isFile(),
    fs.existsSync(blocker) ? fs.statSync(blocker).isFile() : '不存在', true);

  // S2.3 移除注入后重建成功（写失败不破坏工程状态）
  fs.rmSync(blocker, { force: true });
  const s23 = await runBuild();
  check('S2.3 移除写注入后重建成功（状态未被破坏）',
    s23 === 'resolved' && fs.existsSync(exe22) && /构建成功/.test(logLines()),
    `settle=${s23} exe=${fs.existsSync(exe22)}`, 'resolved + exe 存在');

  // S2.4 对象目录写注入：obj 位置放同名文件 → 编译期写盘失败
  const objInj = mkProjDir('cb-e2e-objinj-', 'objinj.cbp', { title: 'objinj' });
  fs.writeFileSync(path.join(objInj.dir, 'obj'), 'blocking file\n', 'utf-8');
  await openInExt(objInj.cbp);
  await activateProject(objInj.cbp);
  const s24 = await runBuild();
  const text24 = logLines();
  check('S2.4 对象目录被同名文件占位：构建失败且有诊断（不崩溃、无产物）',
    s24 === 'resolved' && !fs.existsSync(exeOf(objInj.dir, 'objinj')) && /构建失败/.test(text24)
      && /Fatal error|can't create|No such file|error/i.test(text24),
    `settle=${s24} exe=${fs.existsSync(exeOf(objInj.dir, 'objinj'))} 诊断=${JSON.stringify(errorLines(text24, 3))}`,
    'resolved + 构建失败 + 诊断');
  check('S2.4b 对象目录创建失败在输出通道可见（D-17 已修：warn 级中文提示）',
    /无法创建目录/.test(text24),
    JSON.stringify(text24.split(/\r?\n/).filter((l) => /无法创建目录/.test(l)).slice(0, 2)),
    '通道含「无法创建目录」');
}

// ---------- S3 超长路径 / UNC ----------
async function scenarioLongPathAndUnc() {
  // S3.1 超长路径（>260，\\?\ 前缀）
  let deep = H.mkTemp('cb-e2e-long-');
  while (deep.length <= 250) deep = path.join(deep, 'deep_segment_0123456789');
  const longDir = '\\\\?\\' + deep;
  fs.mkdirSync(longDir, { recursive: true });
  fs.writeFileSync(path.join(longDir, 'main.c'), MAIN_C, 'utf-8');
  const longCbp = mkCbp(longDir, 'longpath.cbp', { title: 'longpath' });
  check('S3.1 探针路径长度 > 260（\\\\?\\ 扩展长路径前缀）', longDir.length > 260, longDir.length, '>260');
  const e31 = errToasts().length;
  const s31 = await openInExt(longCbp);
  check('S3.1b 超长路径工程可被扩展打开（不崩溃）',
    s31 === 'resolved' && /已打开项目: longpath/.test(logLines()) && errToasts().length === e31,
    `settle=${s31} 已打开=${/已打开项目: longpath/.test(logLines())} 新错误=${JSON.stringify(errToasts().slice(e31))}`);

  // S3.2 超长路径构建：有界收敛 + 明确结果（成功或失败都要有结论，不能挂死）
  await activateProject(longCbp);
  const s32 = await runBuild(180000);
  const text32 = logLines();
  const hasOk = /构建成功/.test(text32);
  const hasFail = /构建失败/.test(text32);
  check('S3.2 超长路径构建有界收敛且给出明确结果（成功 / 失败+诊断）',
    s32 === 'resolved' && (hasOk || hasFail),
    `settle=${s32} 构建成功=${hasOk} 构建失败=${hasFail}`, 'resolved + 明确结果');
  if (hasFail) {
    const mangled = errorLines(text32, 3);
    noteObservation('\\\\?\\ 前缀工程构建失败时的诊断（路径经 shell/编译器后可能被破坏）: ' + JSON.stringify(mangled));
  }

  // S3.3 不可达 UNC 主机
  const e33 = errToasts().length;
  const t33 = Date.now();
  const s33 = await openInExt('\\\\nonexistent-host-cb-e2e\\share\\probe.cbp', 45000);
  const ms33 = Date.now() - t33;
  check('S3.3 不可达 UNC 主机：有界返回 + 中文「打开项目失败」',
    s33 === 'resolved' && /打开项目失败/.test(errToasts().slice(e33).join(' ')),
    `settle=${s33} ${ms33}ms toast=${errToasts().slice(e33).join(' | ')}`, 'resolved + 打开项目失败');

  // S3.4 可达主机但共享不存在（localhost）
  const e34 = errToasts().length;
  const t34 = Date.now();
  const s34 = await openInExt('\\\\localhost\\__cb_e2e_no_such_share__\\probe.cbp', 45000);
  const ms34 = Date.now() - t34;
  check('S3.4 本机不存在的共享：有界返回 + 中文「打开项目失败」',
    s34 === 'resolved' && /打开项目失败/.test(errToasts().slice(e34).join(' ')),
    `settle=${s34} ${ms34}ms toast=${errToasts().slice(e34).join(' | ')}`, 'resolved + 打开项目失败');

  // S3.5 可管理共享（\\localhost\<drive>$）下的真实 UNC 构建：本机不可达则 SKIP
  //   CB_BOUNDARY_UNC_DIR=<目录> 可强制走该分支（CI/本机验证用，语义等价：把 <目录> 当作可达 UNC 根）
  const tmp = os.tmpdir();
  const driveLetter = path.parse(tmp).root.charAt(0);
  const uncOverride = process.env.CB_BOUNDARY_UNC_DIR || '';
  const uncTmp = uncOverride || `\\\\localhost\\${driveLetter}$` + tmp.slice(2);
  let uncReachable = !!uncOverride;
  if (!uncReachable) {
    try { uncReachable = fs.statSync(uncTmp).isDirectory(); } catch { /* 管理共享不可达 */ }
  }
  if (!uncReachable) {
    skipCheck(`S3.5 可达 UNC（\\\\localhost\\${driveLetter}$）下的真实构建`,
      `本机管理共享不可访问：stat('${uncTmp}') 失败（非管理员令牌或默认共享未启用），无法构造可达 UNC 工程路径；可用 CB_BOUNDARY_UNC_DIR 强制验证该分支`);
  } else {
    const uncDir = path.join(uncTmp, `cb-e2e-unc-${Date.now()}`);
    fs.mkdirSync(uncDir, { recursive: true });
    fs.writeFileSync(path.join(uncDir, 'main.c'), MAIN_C, 'utf-8');
    const uncCbp = mkCbp(uncDir, 'unc.cbp', { title: 'unc' });
    const so = await openInExt(uncCbp);
    await activateProject(uncCbp);
    const sb = await runBuild();
    const exeOk = fs.existsSync(exeOf(uncDir, 'unc'));
    const text35 = logLines();
    // 断言口径：可达 UNC 上「可打开 + 构建有明确结论（成功产 exe，或失败有诊断）且不崩溃」。
    // 不把「必须构建成功」写死——GNU 工具链对 UNC 工作路径的支持视环境而定（CI runner 实测构建失败且有诊断），
    // 写死会让用例变成环境断言而非产品断言。
    check('S3.5 可达 UNC（管理共享）：可打开 + 构建给出明确结论且不崩溃',
      so === 'resolved' && sb === 'resolved' && (exeOk || /构建失败/.test(text35)),
      `open=${so} build=${sb} exe=${exeOk} 结论=${exeOk ? '构建成功' : (/构建失败/.test(text35) ? '构建失败(有诊断)' : '无结论')}`,
      'resolved + （exe 存在 或 明确构建失败诊断）');
    if (!exeOk) {
      noteObservation(`可达 UNC 下构建未产出 exe（工具链对 UNC 工作路径支持有限）：${JSON.stringify(errorLines(text35, 2))}`);
    }
  }
}

// ---------- S4 构建取消 ----------
async function scenarioCancel() {
  const dir = H.mkTemp('cb-e2e-cancel-');
  fs.writeFileSync(path.join(dir, 'main.c'), MAIN_C, 'utf-8');
  const slowCbp = mkCbp(dir, 'slow.cbp', {
    title: 'slow',
    extraProject: '\t\t<ExtraCommands>\n\t\t\t<Add before="echo CB_BOUNDARY_MARK &amp; ping -n 6 127.0.0.1" />\n\t\t</ExtraCommands>\n',
  });
  const fastCbp = mkCbp(dir, 'fast.cbp', { title: 'fast' });
  await openInExt(slowCbp);
  await activateProject(slowCbp);

  const pingBase = pingCount();
  const e40 = errToasts().length;
  const p = app.invoke('codeblocks.build'); // 不 await：真实构建进行中
  p.catch(() => { /* 防未处理拒绝：结果统一由 settle 读取 */ });
  const sawMark = await waitFor(() => logLines().includes('CB_BOUNDARY_MARK'), 20000);
  check('S4.1 慢 pre-build 真实子进程已启动（构建确实在进行中）', sawMark, sawMark, true);

  const t0 = Date.now();
  await settle(app.invoke('codeblocks.build.stop'), 10000);
  const s4 = await settle(p, 30000);
  const stopMs = Date.now() - t0;
  check('S4.2 Cancel 命令后构建有界收敛（无挂死）', s4 === 'resolved' && stopMs < 20000, `settle=${s4} stop→收敛=${stopMs}ms`, 'resolved 且 <20s');

  const text4 = logLines();
  const exe4 = exeOf(dir, 'slow');
  check('S4.3 取消后无半成品：无 exe 且摘要标注「构建已取消」',
    !fs.existsSync(exe4) && /构建已取消/.test(text4),
    `exe=${fs.existsSync(exe4)} 取消摘要=${/构建已取消/.test(text4)}`, '无 exe + 构建已取消');
  const drained = await waitFor(() => pingCount() <= pingBase, 20000);
  check('S4.3b 取消后探针子进程全部退出（无残留进程）', drained, `ping=${pingCount()} base=${pingBase}`, '无残留');
  const cancelToast = errToasts().slice(e40).join(' | ');
  check('S4.3c 取消上报为「构建已取消」而非「构建失败」（D-16 已修）',
    /构建已取消/.test(cancelToast) && !/构建失败/.test(cancelToast),
    `cancelToast=${cancelToast || '（无）'}`, 'toast 含「构建已取消」，且不含「构建失败」');

  skipCheck('S4.4 进度通知取消按钮（CancellationToken）路径',
    'mock 的 withProgress 不暴露可触发的取消令牌（真实宿主才能点通知里的 ❌）；已用同一 cancelSource 覆盖的 Cancel 命令验证取消语义');

  // S4.5 取消后同一会话再构建成功（互斥/取消状态已释放）
  await openInExt(fastCbp);
  await activateProject(fastCbp);
  const w45 = warnToasts().length;
  const s45 = await runBuild();
  check('S4.5 取消后再次构建成功且无互斥残留',
    s45 === 'resolved' && fs.existsSync(exeOf(dir, 'fast')) && !/已有构建正在进行/.test(warnToasts().slice(w45).join(' | ')),
    `settle=${s45} exe=${fs.existsSync(exeOf(dir, 'fast'))} warns=${warnToasts().slice(w45).join(' | ') || '（无）'}`,
    'resolved + exe 存在 + 无互斥提示');
}

// ---------- S5 并发 / 重入 ----------
async function scenarioReentrancy() {
  // 真实规模工程（projectFixtures 生成 40 文件 / 4 目录 / 1 目标）+ 可控慢 pre-build（标记 + 5s ping）
  const big = generateBigProject(H.mkTemp('cb-e2e-big-'), { files: 40, dirs: 4, targets: ['Debug'], withSources: true, includePerDir: 2 });
  // 生成器的源文件都没有 main()（无法链接可执行文件）→ 追加一个，保持"真实可构建工程"
  const mainSrc = big.sourceFiles.find((f) => /\.c$/.test(f));
  if (mainSrc) fs.appendFileSync(mainSrc, 'int main(void) { return 0; }\n', 'utf-8');
  // 把生成器自带的 pre-build 命令替换为「标记 + 慢 ping」（注意：不能新增第二个 <ExtraCommands> 块——
  // fast-xml-parser 会把重复节点解析为数组，parser 只按单节点读取，导致命令整体丢失，见候选 C5）
  const bigXml = fs.readFileSync(big.cbp, 'utf-8');
  if (!bigXml.includes('<Add before="echo perf pre-build" />')) {
    throw new Error('projectFixtures 生成器结构变化：未找到 pre-build 命令锚点');
  }
  fs.writeFileSync(big.cbp, bigXml.replace(
    '<Add before="echo perf pre-build" />',
    '<Add before="echo CB_RACE_MARK &amp; ping -n 6 127.0.0.1" />',
  ), 'utf-8');
  const bigExe = exeOf(big.dir, 'perf-app');
  await openInExt(big.cbp);
  await activateProject(big.cbp);
  const pingBase = pingCount();

  // S5.1 构建进行中（标记已见）→ 第二次 Build 必须毫秒级明确拒绝
  const p1 = app.invoke('codeblocks.build');
  p1.catch(() => { /* 防未处理拒绝：结果统一由 settle 读取 */ });
  const sawMark = await waitFor(() => logLines().includes('CB_RACE_MARK'), 25000);
  const w51 = warnToasts().length;
  const t51 = Date.now();
  await settle(app.invoke('codeblocks.build'), 10000);
  const rejectMs = Date.now() - t51;
  const rejMsg = warnToasts().slice(w51).join(' | ');
  check('S5.1 构建进行中的第二次 Build：明确拒绝（中文警告 + 毫秒级返回）',
    sawMark && rejectMs < 3000 && /已有构建正在进行/.test(rejMsg),
    `sawMark=${sawMark} 耗时=${rejectMs}ms warns=${rejMsg || '（无）'}`, '<3000ms + 已有构建正在进行');
  await settle(app.invoke('codeblocks.build.stop'), 10000);
  const s51 = await settle(p1, 30000);
  check('S5.1b 第一次构建随后被停止并正常收尾', s51 === 'resolved', s51, 'resolved');
  await waitFor(() => pingCount() <= pingBase, 20000);

  // S5.2 同 tick 双发（快速连点）：互斥必须具备原子性 → 第二次必须被拒绝，不得并发双跑
  const w52 = warnToasts().length;
  let maxPing = 0;
  const timed = (p) => { const t = Date.now(); return p.then(() => Date.now() - t, () => Date.now() - t); };
  const t52 = Date.now();
  const r1 = timed(app.invoke('codeblocks.build'));
  const r2 = timed(app.invoke('codeblocks.build'));
  while (Date.now() - t52 < 9000) {
    maxPing = Math.max(maxPing, pingCount());
    const done = await Promise.race([Promise.all([r1, r2]).then(() => true), sleep(300).then(() => false)]);
    if (done) break;
  }
  const d1 = await settle(r1.then(() => 'done'), 90000);
  const d2 = await settle(r2.then(() => 'done'), 90000);
  const dur1 = await r1, dur2 = await r2;
  const rejMsg2 = warnToasts().slice(w52).join(' | ');
  const doubleRan = dur2 > 1500 && !/已有构建正在进行/.test(rejMsg2);
  check('S5.2 同 tick 双发：第二次 Build 必须被明确拒绝，不得并发双跑（D-15 已修）',
    !doubleRan,
    `第二次耗时=${dur2}ms（首次=${dur1}ms）maxPing=${maxPing} 拒绝警告=${rejMsg2 || '（无）'}`, '第二次毫秒级被拒 + maxPing=1');

  // S5.3 双发后的安全边界：所有 Promise 有界收敛、子进程无残留（未捕获异常会直接终止进程 ⇒ 能执行到本行即未发生）
  await settle(app.invoke('codeblocks.build.stop'), 10000);
  await settle(app.invoke('codeblocks.build.stop'), 10000);
  const drained = await waitFor(() => pingCount() <= pingBase, 30000);
  check('S5.3 双发后安全边界：Promise 有界收敛 + 子进程无残留 + 进程未因未捕获异常退出',
    d1 === 'resolved' && d2 === 'resolved' && drained,
    `r1=${d1} r2=${d2} ping=${pingCount()} base=${pingBase}`, '全部收敛 + 无残留');

  // S5.4 互斥释放：随后单独一次构建成功产出 exe（状态未破坏）
  const s54 = await runBuild(180000);
  check('S5.4 互斥释放 + 状态未破坏：随后单独一次构建成功产出 exe',
    s54 === 'resolved' && fs.existsSync(bigExe) && /构建成功/.test(logLines()),
    `settle=${s54} exe=${fs.existsSync(bigExe)}`, 'resolved + exe 存在');
}

// ---------- 主流程 ----------
async function main() {
  if (!HAS_GCC) {
    console.log('SKIP e2e-boundary：PATH 未找到 gcc（无真实工具链环境整组跳过，不判失败）');
    console.log('\ne2e 边界/异常: 0 pass, 0 fail, 1 skip');
    process.exit(0);
  }
  console.log('e2e 边界/异常探针开始（真实 gcc；模式：extensionActivation + dist 产物）');
  // tmpDir 显式登记进 harness 的清理列表（H.shutDown 删除）→ 本文件不残留激活用的临时目录
  app = await activate({ tmpDir: H.mkTemp('cb-e2e-boundary-ext-'), config: { 'codeblocks.clangd.enabled': false, 'codeblocks.build.verboseOutput': false } });
  channel = app.mock.channels.filter((c) => c.name === 'Code::Blocks').pop();
  if (!channel) throw new Error('未找到 Code::Blocks 输出通道（mock channels 异常）');
  try {
    await scenarioMalformed();
    await scenarioWriteDenied();
    await scenarioLongPathAndUnc();
    await scenarioCancel();
    await scenarioReentrancy();
    await scenarioCompilerProgramsScope();
    await settle(app.invoke('codeblocks.build.stop'), 10000);
  } finally {
    try { await app.deactivate(); } catch (e) { console.log('（deactivate 异常：' + (e && e.message) + '）'); }
    H.shutDown();
  }
  console.log(`\ne2e 边界/异常: ${pass} pass, ${fail} fail, ${skip} skip${failures.length ? '  [' + failures.join(', ') + ']' : ''}`);
  if (OBSERVATIONS.length) {
    console.log('观测（非断言项，不参与判定）：');
    for (const o of OBSERVATIONS) console.log('  - ' + o);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error('e2e 边界/异常运行异常: ' + (err && err.stack ? err.stack : err));
  try { if (app && app.deactivate) app.deactivate(); } catch { /* ignore */ }
  H.shutDown();
  process.exit(1);
});
