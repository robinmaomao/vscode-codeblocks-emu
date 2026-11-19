# 测试执行报告（0.9.0 · 滚动更新）

> 生成时间：2026-11-19 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU demo CPU ×16 ｜ 32GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版报告见 [0.8.160 测试报告](./test-report-0.8.160-archive.md)；本版发布说明见 [release/0.9.0.md](../release/0.9.0.md)。
> Agent 控制面报告见 [0.8.143-agent-control](./test-report-0.8.143-agent-control-archive.md)；使用说明见 [guide/agent-control.md](../guide/agent-control.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 745 断言 |
| 无头层（unit） | `npm test` | **TOTAL=227 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；含 Agent 控制、构建内核抽取、clangd 判定回归 |
| L1 端到端 | `npm run test:e2e` | **7/7** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、**CLI 构建 7**、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套；本机指纹走跨环境容差分支 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；0 warn / 0 fail |
| L5 打包 | `npm run test:pack` | **1/1（16 断言）** | VSIX 0.9.0 打包 / 安装冒烟；含 `bundle/cb-cli.js`、`bundle/cb-mcp.js`、`bundle/search-worker.js` 清单校验 |
| 产物 | `npm run compile` / `bundle` / `bundle:search` / `bundle:agent` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（33 用例）** | 真实 VS Code **1.102.0** 宿主；**33 pass / 0 fail / 0 skip**（含 Agent 控制面套件） |

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
| 主题 | Agent 控制面合入 + 构建内核下沉（`feat/agent-control` → main） |
| 冲突解决 | `clangdRestart.ts` 双实现合并；`extension.ts` 以 main 为底嫁接；`package.json` 版本/引擎/依赖/脚本/贡献点并集 |
| 语义移植 | 语言标志 → `compilerFactory.languageFlags`；缓存键含 `languageFlagsSignature`；自动版本号与 makefile 状态机 → `buildProject` 钩子；诊断可导航归一化 |
| 新增测试 | `test-cli` / `test-mcp-server` / `test-api-*` / `test-agent-policy` / `test-ai-tools-contract` / `test-clangd-restart-decision` / `test-clangd-startup-restore` / `test-e2e-cli-build` / `host/suite/agent.tests.js` |
| 文档 | [release/0.9.0.md](../release/0.9.0.md)、先生成的 [0.8.160](../release/0.8.160.md)、settings / usage / progress / README / decisions |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 合并 | Agent 抽取的 `buildProject` 缺少 main 的本地化日志与诊断归一化 | 已移植（`logT` + 可导航判定） |
| 2 | 合并 | 编译器缓存键丢失 `languageFlagsSignature`，语言标志改动后仍命中旧实例 | 已补回缓存键 |
| 3 | 合并 | `compilerFactory` 未应用 `readLanguageFlags`，仅 C / 仅 C++ 参数失效 | 增加 `languageFlags` 注入点 |
| 4 | 合并 | makefile 目标在工作区构建路径下无法 Stop | 统一传 `cancel` 源 |
| 5 | 合并 | `package.nls*.json` 并集后缺逗号导致 JSON 非法 | 已修正并由设置契约（745 断言）覆盖 |

## 5. 结论

- 契约 **3/3**、无头 **227**（FAIL=0 / SKIP=1）、E2E **7/7**、视觉 **26/26**、性能 **13/13**、打包 **16 断言**、宿主 **33/33（VS Code 1.102.0）** 全部通过。
- 合并未回退 0.8.160 的审计修复：语言标志、缓存签名、自动版本号、makefile Stop、可导航诊断、本地化日志均有对应断言或回归用例。
- 清单：命令 136 / 设置 93 / 分区 10 / 键位 34 / 视图 6 / LM Tools 11 / MCP provider 1，覆盖矩阵 100%。
