# 测试执行报告（0.8.159 · 滚动更新）

> 生成时间：2026-11-19 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU Ryzen 7 7840U ×16 ｜ 31.3GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.152 测试报告](./test-report-0.8.152-archive.md)；本版发布说明见 [release/0.8.159.md](../release/0.8.159.md)。
> 独立功能审计（逐项证据 / 覆盖真实性 / 缺陷与修复建议）见 [functional-audit-0.8.159.md](./functional-audit-0.8.159.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 725 断言 |
| 无头层（unit） | `npm test` | **TOTAL=217 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；含功能审计修复回归与命令入口冒烟 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套；本机指纹走跨环境容差分支 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；0 warn / 0 fail |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.159 打包 / 安装冒烟通过，含 `bundle/search-worker.js` 检查 |
| 产物 | `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（25 用例）** | 真实 VS Code 1.85.0 宿主；**25 pass / 0 fail / 0 skip** |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 项目菜单拆分 | `test-project-manager-feature.js` **7 断言**：动作项、活动工程标记、项目列表、旧实现不再回退 | 菜单/状态栏静态检查通过 |
| 既有回归 | AutoVersioning 26+19、Profiler 22、编译器资源 46 断言 | 本机 gprof / 假工具链 PATH 探测 |
| 命令/设置 | `test-settings-structure.js` 38 断言；覆盖矩阵 136/91 | Settings 页面检查无变化 |
| 功能审计修复 | F-01/F-04/F-05/F-07…F-13 回归；F-06 扫描器语言矩阵 | 新建工程覆盖保护、HeaderGuard、Open Include、i18n、TODO 注释扫描 |
| 文档 | D1/D1b/D2/D3/D4/D5；0.8.159 发布页与报告同步 | README / usage / backlog / architecture 互链 |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 136 | 136 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 91 | 91 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，数据来源 package.json v0.8.159）。
> 命令缺口 0 个。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | 项目管理菜单拆分与架构收敛 |
| 拆分 | `showProjectManager` / `buildManagerItems` / `ProjectManagerItem` → `src/features/projectManager.ts`；依赖注入 |
| 保持不变 | 打开/新建/检测/切换/移除语义；命令/设置计数不变 |
| 功能审计修复 | F-01 覆盖保护、F-04 HeaderGuard、F-05 Open Include、F-07…F-10 i18n、F-11 文档计数、F-12 测试体系、F-13 工程名校验；F-06 TODO 扫描器语言识别 |
| 新增测试 | `tests/test-project-manager-feature.js`、`test-project-overwrite-command.js`、`test-open-include-command.js`、`test-debug-build-guard.js`、`test-command-entry-smoke.js`、`test-todo-scanner-languages.js` |
| 文档 | [release/0.8.159.md](../release/0.8.159.md)、发布页、architecture / progress / CHANGELOG / release index、[功能审计报告](./functional-audit-0.8.159.md) 同步 |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 拆分 | 删除旧函数时误删 `WorkspaceProjectPickItem` 接口 | 恢复接口定义；编译/菜单测试通过 |
| 2 | 拆分 | 旧 `showProjectManager` 可能与 feature 重复定义 | 删除旧实现，`test-project-manager-feature.js` 守卫 |
| 3 | 功能审计 | F-01 新建工程静默覆盖、F-04 HeaderGuard 非头文件、F-05 系统头搜索、F-07…F-10 英文 UI、F-11 文档计数、F-13 工程名校验 | 已修复并补回归；见 [功能审计报告](./functional-audit-0.8.159.md) §11–§12 |
| 4 | 功能审计 | F-06 TODO 扫描器漏掉 `#` / `REM`/`::` | 已修复；`test-todo-scanner-languages.js` |

## 5. 结论

- 单元 **217** / 契约 **3/3** / E2E **6/6** / 视觉 **26/26** / 性能 **13/13** / 打包 **15 断言** / 宿主 **25/25** 全部通过。
- 功能审计修复未改变既有命令/设置契约；新增回归覆盖覆盖保护、HeaderGuard、Open Include、i18n、TODO 语言注释与命令入口。
