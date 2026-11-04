// 设置升级迁移回归：
//  - 纯函数：parallelJobs 显式 0 的作用域判定、显式值判定
//  - 激活：显式 0（global/workspace/folder）→ 写 8；旧 clangd.queryDriver 残留 → 清理
//  - 迁移标记写入后不再重复改写
const fs = require('fs');
const os = require('os');
const path = require('path');
const { activate } = require('./_harness/extensionActivation');

const ROOT = path.resolve(__dirname, '..');
const MIGRATION = require('../dist/settings/migration.js');

let pass = 0, fail = 0;
function check(name, cond, got, want) {
  if (cond) { pass++; console.log('OK   ' + name); }
  else { fail++; console.log('FAIL ' + name + '  got=' + JSON.stringify(got) + (want !== undefined ? ' want=' + JSON.stringify(want) : '')); }
}

check('M1 迁移标记/目标值常量', MIGRATION.PARALLEL_JOBS_MIGRATION_KEY === 'codeblocks.settingsMigration.parallelJobs'
  && MIGRATION.PARALLEL_JOBS_MIGRATION_VERSION === 1
  && MIGRATION.PARALLEL_JOBS_MIGRATION_VALUE === 8,
  [MIGRATION.PARALLEL_JOBS_MIGRATION_KEY, MIGRATION.PARALLEL_JOBS_MIGRATION_VERSION, MIGRATION.PARALLEL_JOBS_MIGRATION_VALUE]);

check('M2 显式 0 的三个作用域都被识别',
  JSON.stringify(MIGRATION.parallelJobsMigrationScopes({ globalValue: 0, workspaceValue: 0, workspaceFolderValue: 0 }))
  === JSON.stringify(['global', 'workspace', 'workspaceFolder']),
  MIGRATION.parallelJobsMigrationScopes({ globalValue: 0, workspaceValue: 0, workspaceFolderValue: 0 }));

check('M3 只迁移显式 0（未配置/其它值不迁移）',
  JSON.stringify(MIGRATION.parallelJobsMigrationScopes({ globalValue: 8, workspaceValue: undefined, workspaceFolderValue: 16 }))
  === JSON.stringify([]),
  MIGRATION.parallelJobsMigrationScopes({ globalValue: 8, workspaceValue: undefined, workspaceFolderValue: 16 }));

check('M3b 字符串 "0" 同样按显式 0 迁移', JSON.stringify(MIGRATION.parallelJobsMigrationScopes({ globalValue: '0' })) === JSON.stringify(['global']),
  MIGRATION.parallelJobsMigrationScopes({ globalValue: '0' }));

check('M4 inspect 缺失 → 不迁移', JSON.stringify(MIGRATION.parallelJobsMigrationScopes(undefined)) === '[]',
  MIGRATION.parallelJobsMigrationScopes(undefined));

check('M5 显式值判定（含 0）', MIGRATION.hasExplicitSetting({ globalValue: 0 }) === true
  && MIGRATION.hasExplicitSetting({ workspaceValue: false }) === true
  && MIGRATION.hasExplicitSetting({}) === false
  && MIGRATION.hasExplicitSetting(undefined) === false,
  [MIGRATION.hasExplicitSetting({ globalValue: 0 }), MIGRATION.hasExplicitSetting({})]);

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-migrate-'));
  const app = await activate({
    tmpDir: tmp,
    inspect: {
      'codeblocks.parallelJobs': {
        key: 'parallelJobs',
        defaultValue: 8,
        globalValue: 0,
        workspaceValue: 0,
        workspaceFolderValue: 0,
      },
      'codeblocks.clangd.queryDriver': {
        key: 'queryDriver',
        defaultValue: undefined,
        globalValue: true,
        workspaceValue: undefined,
        workspaceFolderValue: undefined,
      },
    },
  });
  try {
    const updates = app.configUpdates || [];
    const parallelUpdates = updates.filter((u) => u.key === 'codeblocks.parallelJobs');
    check('M6 激活后把 global/workspace/folder 的显式 0 改写为 8',
      parallelUpdates.length >= 3 && parallelUpdates.every((u) => u.value === 8),
      parallelUpdates);
    check('M7 三个作用域目标齐全',
      new Set(parallelUpdates.map((u) => u.target)).size >= 3,
      parallelUpdates.map((u) => u.target));
    check('M8 清理已移除的 clangd.queryDriver',
      updates.some((u) => u.key === 'codeblocks.clangd.queryDriver' && u.value === undefined),
      updates.filter((u) => u.key === 'codeblocks.clangd.queryDriver'));
    check('M9 迁移标记已写入',
      app.ctx.globalState.get(MIGRATION.PARALLEL_JOBS_MIGRATION_KEY) === MIGRATION.PARALLEL_JOBS_MIGRATION_VERSION,
      app.ctx.globalState.get(MIGRATION.PARALLEL_JOBS_MIGRATION_KEY));
  } finally {
    await app.deactivate().catch(() => undefined);
  }

  // 标记已存在 → 不再改写（模拟第二次激活）
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-migrate-'));
  const app2 = await activate({
    tmpDir: tmp2,
    globalState: { [MIGRATION.PARALLEL_JOBS_MIGRATION_KEY]: MIGRATION.PARALLEL_JOBS_MIGRATION_VERSION },
    inspect: {
      'codeblocks.parallelJobs': { key: 'parallelJobs', defaultValue: 8, globalValue: 0 },
      'codeblocks.clangd.queryDriver': { key: 'queryDriver', globalValue: true },
    },
  });
  try {
    const updates = app2.configUpdates || [];
    check('M10 迁移标记存在时不重复写 parallelJobs',
      !updates.some((u) => u.key === 'codeblocks.parallelJobs'), updates.filter((u) => u.key === 'codeblocks.parallelJobs'));
    check('M11 迁移标记存在时不重复清理 queryDriver',
      !updates.some((u) => u.key === 'codeblocks.clangd.queryDriver'), updates.filter((u) => u.key === 'codeblocks.clangd.queryDriver'));
  } finally {
    await app2.deactivate().catch(() => undefined);
  }

  console.log(`\n设置升级迁移回归: ${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('设置升级迁移回归异常: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
