// clangd 重启判定真值表（decideClangdRestart）：
//  - 数据库变化 → 重启（open/compiler 不受开关限制；project 看 restartOnActiveProjectSwitch）
//  - 数据库未变、仅配置变化 → 常规重载后重启（沿用既有语义：打开工程套用新配置）
//  - 数据库未变、仅配置变化、且发生在**启动恢复**期间 → 跳过（clangd 客户端仍在 initialize，
//    重启会与其自身初始化竞态：command 'clangd.applyFix' already exists → 连接失败弹窗）
//  - 无原因 / 无消费者 / 切换工程且开关关闭 / 数据库与配置都没变 → 不重启
const path = require('path');
const { decideClangdRestart } = require('../dist/tools/clangdRestart.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else {
    fail++;
    console.log(`FAIL ${name}  got=${JSON.stringify(got)}${want !== undefined ? ' want=' + JSON.stringify(want) : ''}`);
  }
}

/** 构造判定输入（默认：数据库变化、有消费者、允许重启、非恢复） */
function state(over = {}) {
  return {
    reason: 'open',
    databaseUnchanged: false,
    configWritten: true,
    fromSessionRestore: false,
    restartAllowed: true,
    hasConsumer: true,
    ...over,
  };
}
const decide = (over) => decideClangdRestart(state(over));

console.log('clangd 重启判定（decideClangdRestart）');

// ---------- 数据库变化 ----------
check('打开工程 + 数据库变化 → 重启', decide({}) === 'restart', decide({}));
check('编译器设置变化 + 数据库变化 → 重启', decide({ reason: 'compiler' }) === 'restart', decide({ reason: 'compiler' }));
check('切换工程 + 数据库变化 + 开关开启 → 重启', decide({ reason: 'project' }) === 'restart', decide({ reason: 'project' }));
check('切换工程 + 数据库变化 + 开关关闭 → 不重启',
  decide({ reason: 'project', restartAllowed: false }) === 'skip', decide({ reason: 'project', restartAllowed: false }));
check('打开工程不受「切换工程不重启」开关限制（restartAllowed=false 也可能来自其它配置）',
  decide({ restartAllowed: true }) === 'restart', decide({ restartAllowed: true }));

// ---------- 数据库未变 ----------
check('数据库/配置均未变化 → 不重启',
  decide({ databaseUnchanged: true, configWritten: false }) === 'skip', decide({ databaseUnchanged: true, configWritten: false }));
check('数据库未变 + 仅配置变化（常规打开工程）→ 重启（沿用既有语义）',
  decide({ databaseUnchanged: true, configWritten: true }) === 'restart', decide({ databaseUnchanged: true, configWritten: true }));

// ---------- 启动恢复窗口 ----------
check('启动恢复 + 数据库未变 + 仅配置变化 → 跳过（打印说明）',
  decide({ fromSessionRestore: true, databaseUnchanged: true, configWritten: true }) === 'skip-config-only',
  decide({ fromSessionRestore: true, databaseUnchanged: true, configWritten: true }));
check('启动恢复 + 数据库变化 → 仍重启（新数据库必须套用）',
  decide({ fromSessionRestore: true, databaseUnchanged: false }) === 'restart', decide({ fromSessionRestore: true, databaseUnchanged: false }));
check('启动恢复 + 仅配置变化 + 切换工程原因 → 重启（不受恢复窗口抑制）',
  decide({ fromSessionRestore: true, reason: 'project', databaseUnchanged: true, configWritten: true }) === 'restart',
  decide({ fromSessionRestore: true, reason: 'project', databaseUnchanged: true, configWritten: true }));
check('启动恢复 + 仅配置变化 + 无配置写入 → 不重启（无变化可套用）',
  decide({ fromSessionRestore: true, databaseUnchanged: true, configWritten: false }) === 'skip',
  decide({ fromSessionRestore: true, databaseUnchanged: true, configWritten: false }));

// ---------- 无原因 / 无消费者 ----------
check('无重启原因（设置变更触发的生成）→ 不重启',
  decide({ reason: undefined }) === 'skip', decide({ reason: undefined }));
check('clangd 扩展未激活且无已打开源文件 → 不重启（重启无意义）',
  decide({ hasConsumer: false }) === 'skip', decide({ hasConsumer: false }));
check('消费者缺失优先于恢复窗口判定：不产生「跳过」说明日志',
  decide({ hasConsumer: false, fromSessionRestore: true, databaseUnchanged: true }) === 'skip',
  decide({ hasConsumer: false, fromSessionRestore: true, databaseUnchanged: true }));

// ---------- 源码接线 ----------
const extSrc = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf-8');
check('extension.ts 通过 decideClangdRestart 判定（逻辑集中在一处，可单测）',
  /decideClangdRestart\(\{/.test(extSrc) && /fromSessionRestore/.test(extSrc));
check('跳过重启时输出可排查的日志（含 window reload 说明）',
  /only the config changed, so the restart is skipped/.test(extSrc));
check('启动恢复包在 withClangdBatch 内（多工程恢复只生成一次 clangd 配置）',
  /sessionRestoreInProgress = true;[\s\S]{0,400}?await withClangdBatch\(/.test(extSrc));
check('批量打开期间只登记延后生成（不立即跑一次生成）',
  /function requestClangdGenerationAfterOpen\(\): void \{[\s\S]{0,200}?clangdBatchDepth > 0[\s\S]{0,120}?clangdBatchDeferred = true/.test(extSrc));
check('恢复期生成请求被标记（fromSessionRestore 由 sessionRestoreInProgress 采集）',
  /if \(sessionRestoreInProgress\) clangdGenerationFromRestore = true;/.test(extSrc));

console.log(`\nclangd 重启判定: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
