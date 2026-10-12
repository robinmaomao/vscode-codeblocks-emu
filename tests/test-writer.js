// 往返测试：parse → serialize，验证不破坏 .cbp
//
// 手工用法（保持兼容，未改动输出格式）：
//   node tests/test-writer.js <cbp文件...>
//
// 自动模式（新增，供回归 / CI 调用）：
//   node tests/test-writer.js --check [目录或 .cbp...]   # 无参时自动发现探针工程
//   · 自动发现：test-project/**/*.cbp + tests/**/*.cbp
//   · 输出逐文件结果与「N pass, M fail」摘要；全部往返一致 → 退出码 0
//
// 说明：本文件仍被 tests/run-all.js 列入 KNOWN_MANUAL（无参时打印用法并 exit 1，
// 属需参数的手工工具）。其核心逻辑（discoverProbeProjects / roundTrip / summarize）
// 已导出，由 tests/test-writer-automation.js 直接 require 调用并纳入自动回归；
// --check 模式亦可被手工或 CI 直接调用。
const { ProjectParser } = require('../dist/model/parser');
const { serializeProject } = require('../dist/model/projectWriter');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// 临时产物统一落 .cb-tools/（gitignore，随仓库产物治理约定），不使用系统临时目录
const TMP_DIR = path.join(ROOT, '.cb-tools', 'test-writer-tmp');

function summarize(p) {
  return {
    title: p.title,
    compiler: p.compilerId,
    targets: p.buildTargets.map((t) => ({
      title: t.title, type: t.targetType, out: t.outputFilename, obj: t.objectOutput,
      copts: t.compilerOptions.length, iDirs: t.includeDirs.length,
      lopts: t.linkerOptions.length, libs: t.linkLibs.length,
      before: t.commandsBeforeBuild.length, after: t.commandsAfterBuild.length,
    })),
    files: p.files.map((x) => x.relativeFilename).sort(),
  };
}

/** 单文件往返：parse → serialize → 再 parse，比较模型关键字段摘要 */
function roundTrip(abs) {
  const original = fs.readFileSync(abs, 'utf-8');
  const project = new ProjectParser().parse(abs);
  const serialized = serializeProject(project);

  // 再 parse 一次序列化结果，对比模型关键字段（临时文件落 .cb-tools/，用完即删）
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const tmp = path.join(TMP_DIR, `${path.basename(abs)}.${process.pid}.${Date.now()}.cbp`);
  try {
    fs.writeFileSync(tmp, serialized, 'utf-8');
    const reparse = new ProjectParser().parse(tmp);
    const before = summarize(project);
    const after = summarize(reparse);
    return { ok: JSON.stringify(before) === JSON.stringify(after), original, serialized, before, after };
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* 临时文件已被清理 */ }
  }
}

/** 自动发现探针工程：test-project/** 与 tests/** 下的全部 .cbp（相对 ROOT，'/'-分隔，排序） */
function discoverProbeProjects(root = ROOT) {
  const skip = new Set(['.git', '.cb-tools', 'node_modules', 'dist', 'bundle', 'codeblocks-src', '.vscode-test']);
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.cbp')) out.push(path.relative(root, p).split(path.sep).join('/'));
    }
  };
  for (const top of ['test-project', 'tests']) {
    const d = path.join(root, top);
    if (fs.existsSync(d)) walk(d);
  }
  return out.sort();
}

/** 手工模式：逐文件打印往返结果（输出格式与历史版本一致） */
function runManual(files) {
  let failed = false;
  for (const f of files) {
    const abs = path.resolve(f);
    const r = roundTrip(abs);
    console.log('='.repeat(60));
    console.log('文件:', abs);
    console.log('目标数:', r.before.targets.length, ' 文件数:', r.before.files.length);
    console.log('往返一致:', r.ok ? 'OK' : 'FAIL');
    if (!r.ok) {
      failed = true;
      console.log('原模型:', JSON.stringify(r.before, null, 2));
      console.log('再解析:', JSON.stringify(r.after, null, 2));
    }
  }
  return failed ? 1 : 0;
}

/** --check 模式：对给定路径（目录递归 / .cbp 文件）或自动发现的探针执行往返 */
function runCheck(inputs) {
  let files = [];
  if (inputs.length) {
    for (const input of inputs) {
      const abs = path.resolve(input);
      if (fs.statSync(abs).isDirectory()) {
        const prefix = path.relative(ROOT, abs).split(path.sep).join('/') + '/';
        files.push(...discoverProbeProjects(ROOT).filter((p) => p.startsWith(prefix)));
      } else {
        files.push(path.relative(ROOT, abs).split(path.sep).join('/'));
      }
    }
    files = [...new Set(files)].sort();
  } else {
    files = discoverProbeProjects(ROOT);
  }
  if (!files.length) {
    console.log('check: 未发现任何 .cbp 探针工程（零探针视为失败，避免静默全绿）');
    console.log('check 汇总: 0 pass, 1 fail');
    return 1;
  }
  let pass = 0, fail = 0;
  for (const rel of files) {
    try {
      const r = roundTrip(path.join(ROOT, rel));
      if (r.ok) {
        pass++;
        console.log(`[check] ${rel}  OK（目标 ${r.before.targets.length} / 文件 ${r.before.files.length}）`);
      } else {
        fail++;
        console.log(`[check] ${rel}  FAIL：往返模型不一致`);
        console.log('  原模型: ' + JSON.stringify(r.before));
        console.log('  再解析: ' + JSON.stringify(r.after));
      }
    } catch (e) {
      fail++;
      console.log(`[check] ${rel}  FAIL：${e && e.message ? e.message : e}`);
    }
  }
  console.log(`check 汇总: ${pass} pass, ${fail} fail`);
  return fail ? 1 : 0;
}

function printUsage() {
  console.log('用法: node test-writer.js <cbp文件...>');
  console.log('      node test-writer.js --check [目录或 .cbp...]   # 自动往返校验（无参=自动发现探针）');
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  let code;
  if (!argv.length) {
    printUsage();
    code = 1;
  } else if (argv[0] === '--check') {
    code = runCheck(argv.slice(1));
  } else if (argv[0] === '--help' || argv[0] === '-h') {
    printUsage();
    code = 0;
  } else {
    code = runManual(argv);
  }
  process.exit(code);
}

module.exports = { summarize, roundTrip, discoverProbeProjects, runCheck };
