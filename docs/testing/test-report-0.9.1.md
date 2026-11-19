# 测试执行报告（0.9.1 · 滚动更新）

> 生成时间：2026-11-19 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU demo CPU ×16 ｜ 32GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版报告见 [0.9.0 测试报告](./test-report-0.9.0-archive.md)；本版发布说明见 [release/0.9.1.md](../release/0.9.1.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 745 断言 |
| 无头层（unit） | `npm test` | **TOTAL=227 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；含 clangd 单飞/重试新断言 |
| L1 端到端 | `npm run test:e2e` | **7/7** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、CLI 构建 7、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；0 warn / 0 fail |
| L5 打包 | `npm run test:pack` | **1/1（16 断言）** | VSIX 0.9.1 打包 / 安装冒烟 |
| 产物 | `npm run compile` / `bundle` / `bundle:search` / `bundle:agent` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（33 用例）** | 真实 VS Code 1.102.0 宿主；33 pass / 0 fail / 0 skip |

### 1.1 clangd 专项（本版重点）

| 用例 | 结果 | 覆盖点 |
|---|---|---|
| `test-clangd-restart` | **29 pass** | 合并窗口 / 最小间隔 / cancel / 异常安全 + **单飞 3**（执行中不并发、结束后补跑尾随）+ **重试策略 4** |
| `test-clangd-restart-decision` | **21 pass** | 判定真值表 19 + 执行层留痕与重试接线 2 |
| `test-clangd-startup-restore` | **A6 + B6** | 真实 mock 双阶段：恢复期只生成一次、仅配置变化不重启、日志文案同步 |
| `test-clangd-settings-sync` | **36 pass** | 编译器设置变更 → DB 变化 → 重启 clangd（mock 中恢复「扩展已安装且激活」的真实前提） |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 136 | 136 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 93 | 93 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成）。
> 命令缺口 0 个。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | clangd 重启链路：合并器单飞 + 跳过留痕 + 有限重试 + 文案对齐 |
| 代码 | `src/tools/clangdRestart.ts`（单飞、尾随、`nextClangdRestartRetry`）、`src/extension.ts`（执行层日志/重试接线、类型复用、import 合并） |
| 词条 | 新增 6 条（跳过/重试日志），移除 1 条旧「仍在启动中」文案；迁移点 1711 / 词条 1547 |
| 新增断言 | `test-clangd-restart` 单飞 3 + 重试 4；`test-clangd-restart-decision` 接线 2；`test-clangd-startup-restore` 文案同步 |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 合并复查 | 合并器不 await run：慢重启期间新请求并发排期（`applyFix` 竞态窗口） | 单飞 + 尾随补跑；假时钟用例锁死 |
| 2 | 合并复查 | 决策层打印「正在重启」，执行层（未安装/未激活/Stopped）静默返回 | 三种跳过各留一行日志 |
| 3 | 合并复查 | 客户端迟迟未就绪时一次必要重启被丢弃 | `nextClangdRestartRetry`：2s/4s 上限 2 次；手动/停用清理 |
| 4 | 合并复查 | `skip-config-only` 文案声称「仍在启动」但判据不含客户端状态 | 文案改为「启动恢复期间仅配置变化」 |
| 5 | 合并复查 | 模块注释重复、同模块两条 import、reason 类型重复定义 | 分节注释 + 合并 import + 复用 `ClangdRestartReason` |

## 5. 结论

- 契约 **3/3**、无头 **227**（FAIL=0 / SKIP=1）、E2E **7/7**、视觉 **26/26**、性能 **13/13**、打包 **16 断言**、宿主 **33/33（VS Code 1.102.0）** 全部通过。
- clangd 重启链路：单飞（不再并发叠加）+ 三类跳过留痕 + 有限重试（2s/4s，上限 2）+ 文案对齐；
  新增/更新断言 9 条，既有 3 个 clangd 测试全部保持通过。
- 清单不变：命令 136 / 设置 93 / 分区 10 / 键位 34 / 视图 6 / LM Tools 11 / MCP provider 1。
