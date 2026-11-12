# 测试执行报告（0.8.150 · 滚动更新）

> 生成时间：2026-11-12 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.150.md](../release/0.8.150.md)；上一版发布说明见 [release/0.8.148.md](../release/0.8.148.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 **707** 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=188 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具）；本版重写 `test-compiler-options-apply.js`（22 断言）到新 `save` 协议，并更新 `test-webview-panels.js`（42）、`test-i18n-webview.js`（21）、`test-file-properties-focus.js`（10）、`test-settings-coverage.js`（104）、`test-settings-structure.js`（38） |
| L3 视觉 | `npm run test:visual` | **18/18** | 面定义随面板重构更新：6 个属性页签（settings/targets/scripts/notes/parser/debugger）+ `build-options` 独立面板 + keybindings + buildlog；移除已不存在的 `props-vtargets/props-files/props-options/props-dirs/compiler-options` 五个面并重生成基线 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 边界 38（3 skip）/ 构建矩阵 48 / ccache 21 / 调试 143（1 skip）/ 链接期诊断 9 / 工具链 42（4 skip）；构建、链接与调试链未受面板改动影响 |
| L4 性能 | `npm run test:perf` | 未复跑 | 本版未触碰构建执行路径；沿用 [性能基准](./performance-baseline.md) 的 0.8.148 结论 |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.150 打包 / 安装冒烟通过，含 `bundle/search-worker.js` 检查 |
| 产物 | `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警；worker 单独产物已生成 |
| L2 宿主 | `npm run test:host` | 未复跑 | 沿用 0.8.140 复核；本版未改动视图声明 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| Build options 数据模型（`buildOptionsView.ts` / `buildOptionsPanel.ts`） | `test-webview-panels.js` **42 断言**：CSS/模板提取、CSP、内联脚本语法、`.bo-actions` 换行、`.bo-tabs` 横向滚动、`.bo-derived-input`；`test-i18n-webview.js` **21 断言**（中英双语标签、`Save`/`Save and Close`） | 面板浅/深色渲染基线（`build-options` 面）逐像素比对 |
| 保存协议（面板 → 宿主 → `.cbp`） | `test-compiler-options-apply.js` **22 断言**：快照交给宿主、`saved`/`error` 回执、连点保存串行、保存并关闭释放面板、缺字段报文忽略；宿主侧 `.cbp` 目标选项更新、项目级 `-pipe` 保留、连点两次写盘、自写盘不触发外部修改询问、重载后关闭面板 | 打开工程 → 改选项 → 保存 → 重开工程选项仍在 |
| 参数右键菜单与覆盖（`compilerFlagSettings.ts`） | `test-settings-coverage.js`（新增键有真实读点）/ `test-settings-structure.js`（88 项）；`flag-store-smoke`（会话脚本）覆盖新建/修改/删除/仅 C/仅 C++ 的读写与清空恢复 | 右键菜单四项 + 展开/折叠；删除内置参数后「恢复默认」提示 |
| 设置键接线 | `test-settings-structure.js` **38 断言**、`test-settings-coverage.js` **104 断言**（常量式读取 `compiler.customFlags/flagOverrides/languageFlags` 已纳入扫描） | `package.json` / nls / 文档三处一致 |
| i18n 词条 | `test-i18n-dict.js` **11 断言**（迁移点 1397 / 词条 1284），清理 11 条旧面板孤儿键；`test-i18n-webview.js` 21 断言 | 中英文界面切换后标题与按钮文案正确 |
| 文件属性直达 | `test-file-properties-focus.js` **10 断言**：`focusFile` 注入、选中行、打开文件属性模态、滚入可视区、定位先于初始 `switchTab` | 工程树文件右键「属性」定位到对应行 |
| 解析/写回 | `test-writer-automation.js` 17 断言、`test-unit-options.js`、`test-target-edit.js` 全绿；MakeCommands 与 `<Extensions>` 往返一致 | 6 条 make 命令 + target 级命令原样回写（临时脚本核对） |
| 文档与版本标记 | `test-contract.js` G1/G2/G3/G4、`test-doc-consistency.js` D1/D1b/D3/D4/D5；`gen-release-notes.js --check` | `npm run coverage:matrix` 重新生成（命令 113 / 视图 6 / 设置 **88** / 快捷键 34） |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 113 | 111 | 98% |
| 视图 | 6 | 6 | **100%** |
| 设置项 | 88 | 88 | **100%** |
| 快捷键 | 34 | 34 | **100%** |
| 语言/语法 | 6 | 6 | **100%** |
| DAP 能力 | 30 | 30 | **100%** |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，逐项列出命中层与未覆盖项）。
> 命令缺口 2 个：`codeblocks.detectCompilers`（交互式并行探测）、`codeblocks.restartClangd`（排障转发）。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | **3**：`codeblocks.compiler.customFlags` / `codeblocks.compiler.flagOverrides` / `codeblocks.compiler.languageFlags`（设置项总数 85 → **88**） |
| 新增命令 | 无（`codeblocks.compilerOptions` 标题由「Compiler Options…」改为「Build options…」，命令总数保持 **113**） |
| 新增视图 | 无（视图总数保持 **6**） |
| 新增快捷键 | 无（快捷键总数保持 **34**） |
| 行为变更 | 工程/目标右键 `Build options…` 打开 Code::Blocks 风格对话框（独立面板 + 属性面板覆盖层共用视图）；`Properties…` 改为 6 个页签 + 文件属性/虚拟目标以模态呈现；Silent build 为只读派生值（Build + ` > $(CMD_NULL)`），Dist-clean 仅在非默认值时只读显示 |
| 0.8.150 修复 | MakeCommands 在 `<ExtraCommands>` 无 `Add` 时被提前 `return` 跳过；写回丢失未建模字段/legacy `<Build><Option>`；`listCompilers` 把 `options_common_*.xml` 当编译器；覆盖层重开丢失参数目录；过期面板按索引写到别的目标；Squirrel 校验器把字符串字面量当运算符 |
| 新增/扩展测试 | `test-compiler-options-apply.js` 重写（22 断言）、`test-webview-panels.js` 42、`test-i18n-webview.js` 21、`test-file-properties-focus.js` 10、`test-settings-coverage.js` 104、`test-settings-structure.js` 38；视觉面重构（18 面） |
| 文档 | 新增 [release/0.8.150.md](../release/0.8.150.md)；settings(.en) 增补 3 个设置；usage(.en)、progress、CHANGELOG、release/00-index 同步；覆盖矩阵重新生成；0.8.148 测试报告归档为 `test-report-0.8.148-archive.md` |
| 行为边界 | 不执行 Squirrel 构建脚本（仅语法校验后给出「暂不支持」警告）；不改变构建命令生成与产物路径 |

## 4. 缺陷与处置（本轮发现并修复）

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 代码评审 | 参数设置键写成 `customFlags` / `flagOverrides` / `languageFlags`，与 `package.json` 的 `compiler.*` 不一致 ⇒ 读写落在不同键上 | 常量改为 `compiler.customFlags` / `compiler.flagOverrides` / `compiler.languageFlags` |
| 2 | 代码评审 | `<ExtraCommands>` 没有 `Add` 时解析器提前返回，`<MakeCommands>` 永不解析；写回时丢失 legacy 子节点 | 解析继续走 MakeCommands/legacy；写回在无模型值时回退原始 XML，legacy 节点透传，显式空串视为清空 |
| 3 | 代码评审 | `listCompilers` 把 `options_common_*.xml` 当成编译器 | 以 `/^common(_|$)/i` 过滤 |
| 4 | 代码评审 | 属性面板覆盖层重开后参数目录/语言参数丢失 | `applyBuildOptions` 回写 `compilerCatalogs/compilerBaseCatalogs/compilerFlags/defaultCompilerId` |
| 5 | 代码评审 | 目标被改名/删除后，过期快照按索引写到另一个目标 | 先整体校验所有目标标题（`Target not found: {0}`），再落字段；移除索引回退 |
| 6 | 代码评审 | Squirrel 校验器把 `thread`/`wait` 当关键字、把字符串字面量当运算符 | 关键字表移除 `thread/wait/sleep`；`parseUnary/parseExpression/parsePostfix` 增加 `t.type === 'op'` 守卫 |
| 7 | 回归 | 旧面板测试（`apply` 协议）与旧视觉面全部失效 | 重写为 `save` 协议 + 新页签；视觉基线按新 UI 重生成 |
| 8 | 回归 | 常量式读取的设置键被「无读点」规则误判；设置项总数与文档计数漂移 | 扫描器解析 `const X_SETTING = '...'` 并识别 `.get(X_SETTING)`；总数与文档同步为 88 |

## 5. 结论

- 五层自动化中已执行的四层（契约 / 无头 / 视觉 / 打包）与 E2E 全绿；性能与宿主层沿用既有结论（本版未触碰对应路径）。
- 人工审核项（UI 与 Code::Blocks 对齐、右键菜单交互、Silent/Dist-clean 只读提示）已按前几轮反馈迭代完成，本版基线即为审核后的界面。
- 发布说明见 [release/0.8.150.md](../release/0.8.150.md)。
