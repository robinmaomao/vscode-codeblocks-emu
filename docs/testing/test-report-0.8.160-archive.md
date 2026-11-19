# 测试执行报告（0.8.160 · 滚动更新）

> 生成时间：2026-11-19 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU demo CPU ×16 ｜ 32GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版报告见 [0.8.159 测试报告](./test-report-0.8.159-archive.md)；本版发布说明见 [release/0.8.160.md](../release/0.8.160.md)。
> 独立功能审计（逐项证据 / 覆盖真实性 / 缺陷与修复建议）见 [functional-audit-0.8.159.md](./functional-audit-0.8.159.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 725 断言；含 G1/G2/D5 版本标记校验（0.8.160） |
| 无头层（unit） | `npm test` | **TOTAL=217 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（手工工具） |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.160 打包 / 安装冒烟通过 |
| 产物 | `npm run compile` + `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警 |
| L1 端到端 | `npm run test:e2e` | **6/6**（沿用 `9b4f288`） | 本版仅版本/文档文件变更，构建与调试链路代码零改动 |
| L3 视觉 | `npm run test:visual` | **26/26**（沿用 `9b4f288`） | 同上 |
| L4 性能 | `npm run test:perf` | **13/13**（沿用 `9b4f288`） | 同上 |
| L2 宿主 | `npm run test:host` | **25/25**（沿用 `9b4f288`，VS Code 1.85.0） | 同上；本版 `engines.vscode` 未变 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 版本标记 | G1（CHANGELOG 顶部）/ G2（README 版本）/ D5（usage、progress、coverage-matrix、报告文件名与 H1） | 逐文件核对 VSIX 文件名 |
| 发布文档 | D4 相对链接（release 索引、报告、审计互链） | `docs/release/0.8.160.md` 与 `00-index.md` 表行 |
| 功能审计修复 | F-01/F-04/F-05/F-06/F-07…F-13 回归（代码与 `9b4f288` 一致） | 见上一版报告 §3 |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 136 | 136 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 91 | 91 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，数据来源 package.json v0.8.160）。
> 命令缺口 0 个。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | 独立功能审计修复轮的正式发布（版本固化） |
| 代码 | 与 `9b4f288`（审计修复 commit）一致，无源码变更 |
| 版本文件 | `package.json` / `package-lock.json` 0.8.159 → 0.8.160 |
| 文档 | [release/0.8.160.md](../release/0.8.160.md)、CHANGELOG 顶部、README/usage/progress/setup 版本标记、release 索引 |
| 测试报告 | 原 `test-report-0.8.159.md` 归档为 `-archive`，本文件接替当版报告 |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 发布流程 | 版本标记分散在 8 处（CHANGELOG/README/usage/progress/setup/coverage-matrix/报告/索引），漏改必被 D5 拦截 | 按 [测试方案](./strategy.md) 与 D5 清单逐项同步，契约层复核通过 |
| 2 | 发布流程 | 仓库根目录残留 `*.vsix` 会让 G3（VSIX 文件名版本 == package.json）在下一版本失败 | 打包产物输出到 `.cb-tools/` 并在上传后清理 |

## 5. 结论

- 契约 **3/3**、无头 **217**（FAIL=0 / SKIP=1）、打包 **15 断言** 本轮实跑通过；E2E / 视觉 / 性能 / 宿主沿用同一代码提交的结果。
- 本版不含源码改动，命令/设置/键位/视图计数与 0.8.159 完全一致；审计修复的行为变化见 [release/0.8.160.md](../release/0.8.160.md)。
