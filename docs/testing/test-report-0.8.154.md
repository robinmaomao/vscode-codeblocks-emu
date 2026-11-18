# 测试执行报告（0.8.154 · 滚动更新）

> 生成时间：2026-11-18 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU demo CPU ×16 ｜ 32GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.152 测试报告](./test-report-0.8.152-archive.md)；本版发布说明见 [release/0.8.154.md](../release/0.8.154.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 719 断言 |
| 无头层（unit） | `npm test` | **TOTAL=206 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；新增 `test-atomic-write` / `test-unit-path-xml-escape` / `test-workspace-change-tracker` / `test-workspace-serializer` / `test-no-project-compile` / `test-copy-strings` / `test-memory-dump` / `test-profiler-parse` / `test-symtab-parse` / `test-workspace-lifecycle-commands` 等 11 个脚本 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套；本机指纹走跨环境容差分支 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；0 warn / 0 fail |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.154 打包 / 安装冒烟通过，含 `bundle/search-worker.js` 检查 |
| 产物 | `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（24 用例）** | 真实 VS Code 1.85.0 宿主；**24 pass / 0 fail / 0 skip** |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 菜单结构/图标 | `test-menu-structure.js` **39 断言**（命令接线、图标 100% 覆盖、1.85 codicon 白名单、标签单语言/去重、CB 顺序、needs* 标注、Settings 过滤串）；`test-menu-presentation.js` **13 断言** | 状态栏 Menu 一级 9 项、子菜单 chevron/返回/面包屑、File 动态区、Tools 自定义工具顺序 |
| 状态栏渲染 | `test-statusbar-menu-astyle.js` **30 断言**（一级收敛、File 动态项、每行图标、无“子菜单”文案、Categorize 状态、无工程/无调试会话标注、返回导航） | 实际安装 VSIX 后 Reload Window 人工审核通过 |
| 标签/i18n | `test-i18n-dict.js` **11 断言**（菜单标签全覆盖、无孤儿键、无中英混排/重名） | 中文态菜单逐项检查无英文括号混排 |
| 命令/设置 | `test-menu-structure.js` 命令接线 81 项；Settings 过滤串断言 | Settings → Editor / Compiler / Debugger / Build & Log 过滤结果逐项打开核对 |
| 宿主回归 | `test:host` WebView 面板标题、快捷键面板、构建/调试链路 24 用例 | 修复 i18n 恢复时误改的 `工程属性: {0}` 分隔符（全角/半角）后复跑 24/24 |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 133 | 133 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 90 | 90 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，数据来源 package.json v0.8.153）。
> 命令缺口 0 个（`codeblocks.detectCompilers` / `codeblocks.restartClangd` 已由宿主层覆盖）。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | Code::Blocks 剩余功能缺口 + 健壮性收口（Workspace 生命周期 / `.workspace` 检测 / 无工程编码 / 指令步进 / Copy Strings / Profiler / SymTab / Makefile CompileFile·DistClean） |
| 菜单结构 | 一级收敛为 9 个顶级菜单；Recent Files / Recent Projects / Workspace Build Order 移入 File；TODO List → View、Export Makefile → Build、Find/Changed line → Search；补 Remove Files / Save Project / Close Project / Project Properties / Debugging Windows |
| 显示规则 | 全部菜单项 1.85 合法 codicon；子菜单 chevron；description 仅“快捷键 · 不可用原因”；面包屑 + 返回；动态列表图标与活动工程标记 |
| 标签 | 修正 11 条中英混排、`Copy`/`Duplicate` 重名、`Project tree` → `Project Tree`、`Debug Information` → `Information` 等 |
| 可用性 | `needsProject` 修正；新增 `needsWorkspace` / `needsDebugSession`；Categorize 状态图标；Settings 过滤串修正 |
| 命令/设置规模 | 新增 15 个命令与 2 个设置项（133 / 90 / 6 / 34） |
| 新增测试 | `tests/test-menu-presentation.js`（13 断言）；`tests/fixtures/codicons.json`（VS Code 1.85 白名单） |
| 扩展测试 | `test-menu-structure.js` 39、`test-statusbar-menu-astyle.js` 30、`test-i18n-dict.js` 11 |
| 文档 | 新增 [release/0.8.153.md](../release/0.8.153.md)、发布页 `pages/0.8.153.md` 与本报告；README / usage / progress / CHANGELOG / release 索引同步；覆盖矩阵重新生成 |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 静态排查 | 70 项无图标、`Undo` 使用非法 codicon `undo` | 补齐图标映射；`undo` → `discard`；新增 1.85 白名单测试 |
| 2 | 静态排查 | 11 条中英混排标签、`Copy`/`Duplicate` 译文重名 | 统一中文单语标签；`Duplicate` → “复制行” |
| 3 | 静态排查 | `Find File…` 误标无工程；Code Statistics/TODO/compile_commands 漏标 | 修正 `needsProject`；新增 workspace/debug session 标注 |
| 4 | 静态排查 | Settings 过滤串打开全部编辑器设置/仅命中单键 | 改为 `@ext:...` + 对应设置组 |
| 5 | 功能检查 | Export compile_commands 无工程时静默；AStyle / Open Include File 无编辑器无提示 | 增加提示 |
| 6 | 宿主回归 | 恢复 `Project Properties: {0}` 词条时误用全角冒号，宿主面板标题断言失败 | 恢复半角冒号 `工程属性: {0}`；复跑宿主 **24/24** |

## 5. 结论

- 单元 **206** / 契约 **3/3** / E2E **6/6** / 视觉 **26/26** / 性能 **13/13** / 打包 **15 断言** / 宿主 **25/25** 全部通过，无遗留失败。
- 菜单项 168 项全部有图标；命令/设置规模不变；未修改 `.cbp` 数据模型与保存协议。
- 剩余 CB 菜单缺口（M2–M7）已记录在 [未实现功能待办](../dev/backlog.md)，不在本版范围内。
