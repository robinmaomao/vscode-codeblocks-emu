// 输出清理核查（A/B/C）回归：
//  - createCbOutput：persistLog=true 用日志通道（{log:true} + 分级方法）；false 用普通通道（appendLine 平替、debug/trace 丢弃）
//  - package.json：clearOutput 命令（$(clear-all)）+ 视图标题栏入口 + build.persistLog 默认 false
//  - dist：extension 读取 persistLog、注册 clearOutput；build/cbChannel.js 存在
const Module = require('module');
const origLoad = Module._load;

function makeFake() {
  const ch = {
    entries: [],
    __name: undefined,
    __options: undefined,
    info(l) { this.entries.push(['info', l]); },
    warn(l) { this.entries.push(['warn', l]); },
    error(l) { this.entries.push(['error', l]); },
    debug(l) { this.entries.push(['debug', l]); },
    trace(l) { this.entries.push(['trace', l]); },
    append(t) { this.entries.push(['append', t]); },
    appendLine(l) { this.entries.push(['appendLine', l]); },
    clear() { this.entries.push(['clear']); },
    show(p) { this.entries.push(['show', p]); },
    hide() { this.entries.push(['hide']); },
    dispose() { this.entries.push(['dispose']); },
  };
  return ch;
}
const created = [];
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') {
    return {
      window: {
        createOutputChannel: (name, options) => {
          const ch = makeFake();
          ch.__name = name;
          ch.__options = options;
          created.push(ch);
          return ch;
        },
      },
    };
  }
  return origLoad(request, parent, isMain);
};

const fs = require('fs');
const path = require('path');
const { createCbOutput } = require(path.resolve(__dirname, '../dist/build/cbChannel.js'));

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

// ---- createCbOutput：日志模式 ----
{
  const out = createCbOutput('Code::Blocks', true);
  const ch = created[created.length - 1];
  check('A1 日志模式：createOutputChannel 第二参 = { log: true }',
    ch.__options && ch.__options.log === true, ch.__options);
  out.info('x'); out.debug('y'); out.clear();
  check('A2 info → 通道 info', ch.entries.some((e) => e[0] === 'info' && e[1] === 'x'), ch.entries);
  check('A3 debug → 通道 debug（分级保留）', ch.entries.some((e) => e[0] === 'debug' && e[1] === 'y'), ch.entries);
  check('A4 clear → 通道 clear', ch.entries.some((e) => e[0] === 'clear'), ch.entries);
  check('A5 raw = 底层通道', out.raw === ch, null);
}

// ---- createCbOutput：普通模式（时间戳 + 高亮标记） ----
const TS = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} /;
{
  const out = createCbOutput('Code::Blocks', false);
  const ch = created[created.length - 1];
  check('B1 普通模式：不带 options（第二参 undefined）', ch.__options === undefined, ch.__options);
  out.info('i'); out.warn('w'); out.error('e'); out.debug('d'); out.trace('t');
  const kinds = ch.entries.map((e) => e[0]);
  const lines = ch.entries.filter((e) => e[0] === 'appendLine').map((e) => e[1]);
  check('B2 info/warn/error → appendLine 平替', kinds.filter((k) => k === 'appendLine').length === 3, ch.entries);
  check('B3 debug/trace 丢弃（无输出）', !kinds.includes('debug') && !kinds.includes('trace'), kinds);
  check('B4 每行带 YYYY-MM-DD HH:MM:SS.mmm 时间戳', lines.length === 3 && lines.every((l) => TS.test(l)), lines);
  check('B5 warn 行加 ⚠️ 标记', lines[1] === undefined ? false : TS.test(lines[1]) && lines[1].replace(TS, '') === '⚠️ w', lines[1]);
  check('B6 error 行加 ❌ 标记', lines[2] === undefined ? false : TS.test(lines[2]) && lines[2].replace(TS, '') === '❌ e', lines[2]);
  check('B7 info 行不加标记', lines[0] === undefined ? false : lines[0].replace(TS, '') === 'i', lines[0]);
  check('B8 raw = 底层通道', out.raw === ch, null);
}

// ---- createCbOutput：纯 CB 日志模式关闭标记（时间戳保留） ----
{
  const out = createCbOutput('Code::Blocks', false, { plainCb: () => true });
  const ch = created[created.length - 1];
  out.warn('plain-w'); out.error('plain-e');
  const lines = ch.entries.filter((e) => e[0] === 'appendLine').map((e) => e[1]);
  check('C1 plainCb：warn 不加 ⚠️（时间戳保留）', lines[0] === undefined ? false : TS.test(lines[0]) && lines[0].replace(TS, '') === 'plain-w', lines[0]);
  check('C2 plainCb：error 不加 ❌（时间戳保留）', lines[1] === undefined ? false : TS.test(lines[1]) && lines[1].replace(TS, '') === 'plain-e', lines[1]);
}

// ---- 关闭时间戳（build.outputTimestamp=false）：不加时间戳，标记保留 ----
{
  const out = createCbOutput('Code::Blocks', false, { timestamp: () => false });
  const ch = created[created.length - 1];
  out.info('no-ts'); out.warn('w'); out.error('e');
  const lines = ch.entries.filter((e) => e[0] === 'appendLine').map((e) => e[1]);
  check('E1 timestamp=false：无时间戳前缀', lines.length === 3 && lines.every((l) => !TS.test(l)), lines);
  check('E2 标记仍保留（⚠️）', lines[1] === '⚠️ w', lines[1]);
  check('E3 标记仍保留（❌）', lines[2] === '❌ e', lines[2]);
  check('E4 info 原样', lines[0] === 'no-ts', lines[0]);
}

// ---- G1：timestamp 惰性 getter——每次输出时求值（设置改动即时生效，无需重载） ----
{
  let tsOn = false;
  const out = createCbOutput('Code::Blocks', false, { timestamp: () => tsOn });
  const ch = created[created.length - 1];
  out.info('a');
  tsOn = true; // 运行中切换（模拟修改设置后立即写日志）
  out.info('b');
  const lines = ch.entries.filter((e) => e[0] === 'appendLine').map((e) => e[1]);
  check('G1-1 getter 返回 false 时行无时间戳', lines[0] === 'a', lines[0]);
  check('G1-2 运行中切换为 true 后行带时间戳',
    lines[1] !== undefined && TS.test(lines[1]) && lines[1].replace(TS, '') === 'b', lines[1]);
  // 未提供 getter → 默认带时间戳（兼容旧行为）
  const out2 = createCbOutput('Code::Blocks', false);
  const ch2 = created[created.length - 1];
  out2.info('c');
  const lines2 = ch2.entries.filter((e) => e[0] === 'appendLine').map((e) => e[1]);
  check('G1-3 未提供 getter 默认带时间戳', lines2[0] !== undefined && TS.test(lines2[0]), lines2[0]);
}

// ---- 已有 ⚠️/❌ 前缀不重复标记 ----
{
  const out = createCbOutput('Code::Blocks', false);
  const ch = created[created.length - 1];
  out.warn('⚠️ 已有标记'); out.error('❌ 已有标记'); out.warn('[Code::Blocks] ⚠️ 构建已取消');
  const lines = ch.entries.filter((e) => e[0] === 'appendLine').map((e) => e[1]);
  check('D1 已有 ⚠️ 不重复', lines[0] === undefined ? false : lines[0].replace(TS, '') === '⚠️ 已有标记', lines[0]);
  check('D2 已有 ❌ 不重复', lines[1] === undefined ? false : lines[1].replace(TS, '') === '❌ 已有标记', lines[1]);
  check('D3 [Code::Blocks] ⚠️ 前缀不重复', lines[2] === undefined ? false : lines[2].replace(TS, '') === '[Code::Blocks] ⚠️ 构建已取消', lines[2]);
}

// ---- package.json 静态断言 ----
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf8'));
const cmds = new Map((pkg.contributes.commands || []).map((c) => [c.command, c]));
check('C1 clearOutput 命令已贡献且 icon = $(clear-all)',
  cmds.get('codeblocks.buildLog.clearOutput')?.icon === '$(clear-all)', cmds.get('codeblocks.buildLog.clearOutput'));
const vt = pkg.contributes.menus['view/title'] || [];
const clearEntries = vt.filter((m) => m.command === 'codeblocks.buildLog.clearOutput');
check('C2 Build Log 标题栏含 clearOutput 入口（when view == codeblocks.buildLog）',
  clearEntries.length === 1 && clearEntries[0].when === 'view == codeblocks.buildLog', clearEntries);
const cfg = pkg.contributes.configuration;
const props = {};
for (const b of cfg) Object.assign(props, b.properties);
check('C3 build.persistLog 默认 false（布尔）',
  props['codeblocks.build.persistLog']?.type === 'boolean' && props['codeblocks.build.persistLog']?.default === false,
  props['codeblocks.build.persistLog']);
check('C4 build.outputTimestamp 默认 false（布尔）',
  props['codeblocks.build.outputTimestamp']?.type === 'boolean' && props['codeblocks.build.outputTimestamp']?.default === false,
  props['codeblocks.build.outputTimestamp']);

// ---- dist 静态断言 ----
const ext = fs.readFileSync(path.resolve(__dirname, '../dist/extension.js'), 'utf8');
check('D1 dist 读取 build.persistLog', ext.includes("'build.persistLog'"), null);
check('D1b dist 读取 build.outputTimestamp', ext.includes("'build.outputTimestamp'"), null);
check('D2 dist 注册 clearOutput 命令', ext.includes("'codeblocks.buildLog.clearOutput'"), null);
check('D3 dist 使用 createCbOutput', ext.includes('createCbOutput'), null);
check('D4 clearErrors 增强为清空构建输出（含 outputChannel.clear 链路）', ext.includes('已清除构建输出与编译错误'), null);
check('D5 dist 传 plainCb 判定（纯 CB 模式关闭标记）', ext.includes('plainCb'), null);
check('D6 dist 汇总块移到输出末尾（printBuildSummaryBlocks）', ext.includes('printBuildSummaryBlocks'), null);
check('D7 dist 无任务跳过逻辑已移除', !ext.includes('nothingHappened'), null);
check('D8 dist 汇总块调用点 ≥2（单项目 + 工作区）', (ext.match(/printBuildSummaryBlocks\(\)/g) || []).length >= 2, null);
check('D9 dist 汇总块含「编译时间」行（YYYY-MM-DD HH:MM:SS）', ext.includes('🕒 编译时间') && ext.includes('formatDateTime'), null);
// G1：timestamp 惰性 getter（改设置即时生效）——extension 需传函数而非布尔
check('D10 dist 传惰性 timestamp getter（G1）', /timestamp:\s*\(\)\s*=>/.test(ext), null);
// G1 复核修复：逐行读取缓存值 + 配置监听刷新（避免每行 getConfiguration）
check('D11 dist 监听 build.outputTimestamp 配置变化（G1 即时生效且免逐行读配置）',
  ext.includes("affectsConfiguration('codeblocks.build.outputTimestamp')"), null);

console.log(`\nclear-output: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);
