# docs 目录索引

> 文档导航、命名规范与维护约定。目录按用途分组，文件名统一使用 **英文 kebab-case**（正文保持中文）。

## 目录结构

```text
docs/
  README.md                目录索引（本文件）
  guide/                   用户与对齐参考
    usage.md               用户手册（中文）
    usage.en.md            用户手册（英文）
    settings.md            设置项完整参考（中文）
    settings.en.md         设置项完整参考（英文）
    alignment.md           与 Code::Blocks 对齐对照
  dev/                     开发过程文档
    progress.md            开发进度快照
    backlog.md             未实现功能与决策
    decisions.md           遗留问题决策清单
    i18n.md                国际化约定与实现
    i18n.en.md             国际化（英文）
  testing/                 测试与验收
    strategy.md            分层测试方案
    coverage-matrix.md     测试覆盖矩阵（自动生成）
    test-report-<ver>.md   当前版本测试报告（滚动更新）
    manual-acceptance.md   手工验收清单
    performance-baseline.md 性能基准（自动生成）
  release/                 逐版本发布说明（见 00-index.md）
  archive/                 仍有取证价值的历史报告
  images/                  文档截图与 GIF
```

## 入门与参考

| 文档 | 用途 |
|------|------|
| [guide/usage.md](./guide/usage.md) | 用户手册：安装、界面、构建、调试、快捷键、设置（§13）、FAQ、已知限制（§16）｜英文版 [guide/usage.en.md](./guide/usage.en.md) |
| [guide/settings.md](./guide/settings.md) | **设置项完整参考**：9 个分区逐项说明类型、默认值、作用域、取值与生效时机｜英文版 [guide/settings.en.md](./guide/settings.en.md) |
| [guide/alignment.md](./guide/alignment.md) | 与 Code::Blocks 25.03 的逐项对齐依据（CB 源码位置 + 扩展实现 + 保护性差异） |
| [dev/progress.md](./dev/progress.md) | 恢复开发进度用：总体进度、已完成能力、构建命令、关键踩坑、版本里程碑 |
| [dev/backlog.md](./dev/backlog.md) | 功能对齐现状：剩余缺口、明确不移植清单、A–E 组完成摘要 |
| [dev/decisions.md](./dev/decisions.md) | 历次核查待确认项的处置结论（状态表 + 缺陷一览 + 决策记录） |
| [dev/i18n.md](./dev/i18n.md) | 中英双语约定与实现：nls 静态贡献 / `ui.language` 运行时、`i18n.t()` 用法、批次台账、已知限制｜英文版 [dev/i18n.en.md](./dev/i18n.en.md) |

## 测试与验收

| 文档 | 用途 |
|------|------|
| [testing/strategy.md](./testing/strategy.md) | 分层测试体系（L-1…L5 + CI）：覆盖范围、运行方式、环境约束、工具链安装 |
| [testing/coverage-matrix.md](./testing/coverage-matrix.md) | 命令/视图/设置/键位/语言语法/DAP 能力逐项覆盖台账（`npm run coverage:matrix` 生成） |
| [testing/test-report-0.8.141.md](./testing/test-report-0.8.141.md) | 当前版本的测试执行报告（滚动更新）：分层结果、覆盖台账、本版变更与缺陷处置 |
| [testing/test-report-0.8.139-full.md](./testing/test-report-0.8.139-full.md) | 0.8.139 完整独立复核：七层结果、失败/SKIP 取证、ccache 与短路径专项、性能明细 |
| [testing/manual-acceptance.md](./testing/manual-acceptance.md) | 需人工 GUI 会话执行的验收项与留档要求（自动化不可覆盖的交互） |
| [testing/performance-baseline.md](./testing/performance-baseline.md) | 微基准 + 真实构建的性能数据与预算（`npm run perf:report` 更新，含趋势） |

## 历史归档

- [`release/`](./release/)：逐版本发布说明。保留全部正式版说明与最近两份 dev 说明（`0.8.129-dev`、`0.8.135-dev`）；
  `0.8.76`–`0.8.128` 的 dev 说明已合并为 [`0.8.76-0.8.99-dev.md`](./release/archive/0.8.76-0.8.99-dev.md)、
  [`0.8.100-0.8.128-dev.md`](./release/archive/0.8.100-0.8.128-dev.md)；`0.8.2`–`0.8.46` 见
  [`0.8.2-0.8.46.md`](./release/archive/0.8.2-0.8.46.md)。索引见 [release/00-index.md](./release/00-index.md)。
- [`archive/`](./archive/)：仅保留仍有持续取证价值的报告：
  - [2026-11-04-rg-storm-root-cause.md](./archive/2026-11-04-rg-storm-root-cause.md)（0.8.136 工作区路径守卫根因）
  - [compile-link-alignment-round4.md](./archive/compile-link-alignment-round4.md)（命令快照测试的期望值来源）
  - [progress-history-0.8.89.md](./archive/progress-history-0.8.89.md)（0.8.89 及以前逐轮条目）
- 其余一次性盘点/核查报告已被 release 说明与决策清单取代，不再保留。

## 命名规范

- 文件名统一 **小写英文 kebab-case**，扩展名 `.md`；英文版以 `.en.md` 结尾。
- 版本号原样保留（`0.8.137.md`、`0.8.129-dev.md`）；版本区间用 `-`（`0.8.76-0.8.99-dev.md`），不再使用 `~`。
- 带日期的归档以 `YYYY-MM-DD-` 前缀开头（`2026-11-04-rg-storm-root-cause.md`）。
- 目录职责：`guide/` 面向使用者，`dev/` 面向开发过程，`testing/` 面向测试与验收，`release/` 只放发布说明，`archive/` 只放仍有取证价值的历史报告。

## 归档与保留策略

- **常读文档**随版本更新；自动生成文档（覆盖矩阵、性能基准）不手工编辑。
- **release**：每个版本新增 `0.8.xx-dev.md`；正式版里程碑汇总进 [CHANGELOG](../CHANGELOG.md)。旧 dev 说明按版本段合并归档，正文保留。
- **archive**：只保留仍被引用或仍具取证价值的报告；一次性报告在结论并入决策清单/release 后删除。
- 提交/推送日志不写轮次编号；新增核查报告用主题命名，实施完毕后归档到 `archive/`，待决项同步并入 [dev/decisions.md](./dev/decisions.md)。

## 维护约定

- 测试类文档维护时机：**视觉基线**在 UI/WebView 变更后刷新（`npm run visual:baseline`，随 PR 附基线 PNG）；**性能基准**在构建链路或依赖变化后刷新（`npm run perf:baseline`）并同步 [testing/performance-baseline.md](./testing/performance-baseline.md)（`npm run perf:report`）；**覆盖矩阵**在新增/调整用例后刷新（`npm run coverage:matrix`），并与当版 [测试报告](./testing/test-report-0.8.141.md) §2 台账保持一致。
- **文档一致性巡检**：`tests/contract/test-doc-consistency.js`（随 `npm run test:contract` 自动跑）校验「文档里的命令/相对链接真实存在」「覆盖矩阵与性能基准的计数与产物一致」「版本标记与 `package.json` 一致」；改文档后可单独跑一次，`--self-test` 自检规则本身。
- 代码约定（空 catch 需注释、无 `console.*`、无 `@ts-ignore`、**已迁移 i18n 的文件 UI 语境禁中文字面量**）由 `tests/test-code-conventions.js` 自动检查；i18n 三条守卫 `tests/test-i18n-{nls,dict}.js` + `tests/test-i18n-runtime.js` 约定见 [dev/i18n.md](./dev/i18n.md) §6。
