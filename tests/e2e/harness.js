// L1 真实工程 E2E harness：在临时目录用真实工具链（gcc/g++/ar）驱动 dist 产物的构建引擎。
//
// 约定：
//  - 探针工程一律复制/生成到 os.tmpdir 下的临时目录，测试结束清理（保证仓库零污染）。
//  - vscode mock 在 require dist 之前安装（dist 在加载期即读取 vscode）。
//  - 通过 setConfig 调整设置项（对应 codeblocks.* 配置），模拟不同开关下的行为。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const { installVscodeMock } = require('../_harness/vscodeMock');

let mock = null;
const tmpDirs = [];

/** 安装全局 mock（幂等）并返回 dist 模块集合（懒加载） */
function boot(config = {}) {
  if (!mock) {
    mock = installVscodeMock({ config: { 'codeblocks.build.verboseOutput': false, 'codeblocks.build.skipIncludeDeps': false, ...config } });
  } else {
    setConfig(config);
  }
  return modules();
}

function setConfig(kv) {
  if (!mock) throw new Error('boot() 未调用');
  Object.assign(mock.configStore, kv);
}

function shutDown() {
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ } }
  tmpDirs.length = 0;
  if (mock) { mock.restore(); mock = null; }
}

let cached = null;
function modules() {
  if (cached) return cached;
  const { ProjectParser, WorkspaceParser } = require('../../dist/model/parser.js');
  const { CompilerOptionsLoader } = require('../../dist/compiler/optionsLoader.js');
  const { CodeBlocksConfig } = require('../../dist/compiler/codeblocksConfig.js');
  const { BuildEngine } = require('../../dist/build/buildEngine.js');
  const { applyGeneratedFiles } = require('../../dist/build/generatedFiles.js');
  const { collectClangdEntries, writeClangdDatabase } = require('../../dist/build/compileCommands.js');
  const { OutputParser } = require('../../dist/build/outputParser.js');
  cached = { ProjectParser, WorkspaceParser, CompilerOptionsLoader, CodeBlocksConfig, BuildEngine, applyGeneratedFiles, collectClangdEntries, writeClangdDatabase, OutputParser };
  return cached;
}

// ---------- 临时目录与工程复制 ----------
function mkTemp(prefix = 'cb-e2e-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}

/** 复制 test-project 下的若干文件到临时目录（保持相对结构） */
function copyTestProject(files, destName) {
  const base = mkTemp('cb-e2e-' + (destName || 'proj') + '-');
  const dest = destName ? path.join(base, destName) : base;
  fs.mkdirSync(dest, { recursive: true });
  for (const rel of files) {
    const src = path.join(root, 'test-project', rel);
    const dst = path.join(dest, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  return dest;
}

function writeFile(abs, content) {
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

// ---------- 构建器 ----------
// 引擎把「执行/跳过/up-to-date」等信息经 output.info/warn/error 上报，process 的 stdout/stderr 走 onLine。
// E2E 需要看到命令行本身，因此用一个记录型 output。
function recordingOutput(lines) {
  return {
    info: (m) => lines.push({ line: String(m), sev: 'info', kind: 'output' }),
    warn: (m) => lines.push({ line: String(m), sev: 'warning', kind: 'output' }),
    error: (m) => lines.push({ line: String(m), sev: 'error', kind: 'output' }),
    debug: (m) => lines.push({ line: String(m), sev: 'debug', kind: 'output' }),
  };
}

/** 编译器工厂（与扩展启动路径一致：options_<id>.xml + Code::Blocks default.conf 用户自定义覆盖） */
function makeCompilerFactory() {
  const { CompilerOptionsLoader, CodeBlocksConfig } = modules();
  const loader = new CompilerOptionsLoader(path.join(root, 'resources', 'compilers'));
  const cb = new CodeBlocksConfig();
  cb.load();
  const factory = (id) => {
    const c = loader.load(id);
    const up = cb.resolvePrograms(id);
    if (up) { c.programs = { ...c.programs, C: up.C, CPP: up.CPP, LD: up.LD, LIB: up.LIB }; c.masterPath = up.masterPath; }
    const sd = cb.searchDirs(id);
    if (sd) {
      c.includeDirs = sd.includeDirs;
      c.libDirs = sd.libDirs;
      c.resIncludeDirs = sd.resIncludeDirs;
      c.linkLibs = sd.linkLibs;
      c.compilerOptions = sd.compilerOptions;
      c.linkerOptions = sd.linkerOptions;
      c.resourceCompilerOptions = sd.resourceCompilerOptions;
    }
    return c;
  };
  return factory;
}

/**
 * 打开工程并返回上下文。
 * @param {string} cbpPath 工程文件
 * @param {{programs?: object}} [opts] 交叉/异构工具链的程序覆盖（对**每次**工厂取出的编译器都生效，
 *        因为构建引擎会在构建时重新调用工厂，仅覆盖首个对象无效）
 * @returns {{project:any, compiler:any, engine:any, lines:Array<{line:string,sev?:string}>, commands:()=>string[]}}
 */
function openProject(cbpPath, opts = {}) {
  const { ProjectParser, BuildEngine } = modules();
  const factory = makeCompilerFactory();
  const getCompiler = opts.programs
    ? (id) => { const c = factory(id); Object.assign(c.programs, opts.programs); return c; }
    : factory;
  const project = new ProjectParser().parse(cbpPath);
  applyGeneratedFilesFor(project, getCompiler);
  const compiler = getCompiler((project.buildTargets[0] || {}).compilerId || project.compilerId);
  const lines = [];
  const engine = new BuildEngine(project, compiler, recordingOutput(lines), getCompiler);
  return { project, compiler, engine, getCompiler, lines, commands: () => commandLines(lines) };
}

/**
 * 覆盖编译器程序（用于交叉/异构工具链：把某家族的 C/CPP/LD/LIB 指向实测可执行文件）。
 * 注意：构建引擎可能在构建时重新走工厂取编译器，此函数只影响已取到的对象——可交叉场景请优先用
 * `openProject(cbp, { programs })`。
 */
function setPrograms(ctx, programs) {
  Object.assign(ctx.compiler.programs, programs);
}

function applyGeneratedFilesFor(project, getCompiler) {
  const { applyGeneratedFiles } = modules();
  try { applyGeneratedFiles(project, getCompiler); } catch { /* 无生成文件配置时忽略 */ }
}

/** 采集到的编译/链接/归档命令（真实进程调用行；一条日志可能含多行命令，先按换行拆分） */
function commandLines(lines) {
  return lines
    .flatMap((l) => String(l.line).split(/\r?\n/))
    .filter((l) => /(^|[\\/])(gcc|g\+\+|clang|clang\+\+|ar|windres|mingw32-ar|avr-gcc|avr-g\+\+|avr-ar|riscv-none-elf-gcc|riscv-none-elf-ar|sdcc|tcc)(\.exe)?\s+[^\n]*\s-/.test(l));
}

/** 执行构建（默认全部目标） */
async function build(ctx, targetTitle, config) {
  if (config) setConfig(config);
  const before = ctx.lines.length;
  const ok = await ctx.engine.build(targetTitle, { onLine: (line, sev) => ctx.lines.push({ line, sev }) });
  return { ok, lines: ctx.lines.slice(before), commands: commandLines(ctx.lines.slice(before)) };
}

async function compileFile(ctx, targetTitle, rel) {
  const before = ctx.lines.length;
  const ok = await ctx.engine.compileFile(targetTitle, rel, { onLine: (line, sev) => ctx.lines.push({ line, sev }) });
  return { ok, lines: ctx.lines.slice(before), commands: commandLines(ctx.lines.slice(before)) };
}

/** 给文件打新时间戳（触发增量）。默认使用当前时间；如需"更旧"传负值（勿用未来时间，会让依赖永久过期）。 */
function touch(abs, offsetMs = 0) {
  const now = new Date(Date.now() + offsetMs);
  fs.utimesSync(abs, now, now);
}

function toolAvailable(name) {
  const r = spawnSync('where.exe', [name], { encoding: 'utf-8', windowsHide: true });
  return r.status === 0;
}

// ---------- 工具链探测（W6：交叉/异构工具链） ----------
// 搜索顺序：PATH（where.exe）→ CB_TOOLCHAIN_ROOT（分号分隔，多根）→ 仓库 .cb-tools/toolchains 下的各工具链 bin 目录。
// 约定：本地下载的工具链一律解包到 .cb-tools/toolchains/<name>/（gitignored），测试不依赖系统级安装。
let binDirsCache = null;

function toolchainBinDirs() {
  if (binDirsCache) return binDirsCache;
  const roots = [];
  for (const r of String(process.env.CB_TOOLCHAIN_ROOT || '').split(';').map((s) => s.trim()).filter(Boolean)) roots.push(r);
  roots.push(path.join(root, '.cb-tools', 'toolchains'));
  const dirs = [];
  const walk = (dir, depth) => {
    if (depth < 0) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name === '_dl' || e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.name === 'bin') dirs.push(p);
      walk(p, depth - 1);
    }
  };
  for (const r of roots) if (fs.existsSync(r)) walk(r, 4);
  binDirsCache = dirs;
  return dirs;
}

/** 解析可执行文件（PATH 优先；其次本地工具链 bin 目录）。返回绝对路径或 undefined */
function findExecutable(name) {
  const w = spawnSync('where.exe', [name], { encoding: 'utf-8', windowsHide: true });
  if (w.status === 0) {
    const first = (w.stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first && fs.existsSync(first)) return first;
  }
  for (const d of toolchainBinDirs()) {
    for (const candidate of [name, `${name}.exe`, `${name}.cmd`]) {
      const p = path.join(d, candidate);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
}

module.exports = {
  root, boot, shutDown, setConfig, modules, mkTemp, copyTestProject, writeFile,
  openProject, build, compileFile, commandLines, touch, toolAvailable, setPrograms, findExecutable,
};
