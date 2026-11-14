# 测试执行报告（0.8.151 · 滚动更新）

> 生成时间：2026-11-12 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.151.md](../release/0.8.151.md)；上一版发布说明见 [release/0.8.150.md](../release/0.8.150.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 707 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=193 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；新增 `test-project-context-menu.js`（18 断言）、`test-file-properties.js`（**36 断言**：行数统计 / 对象名 / 三页结构 / 自动生成禁用 / customBuild 往返 / 只读切换）、`test-run-targets-panel.js`（17 断言）、`test-build-options-enable-rules.js`（24）+ `test-properties-enable-rules.js`（29，启用联动）；`test-webview-panels.js` **65 断言** |
| L3 视觉 | `npm run test:visual` | **26/26** | 6 个属性页签（settings/targets/scripts/notes/parser/debugger）+ 文件属性三页（`props-file-general/build/advanced`）+ `build-options` + `run-targets` + keybindings + buildlog，dark/light 各一套 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 边界 38（3 skip）/ 构建矩阵 48 / ccache 21 / 调试 143（1 skip）/ 链接期诊断 9 / 工具链 42（4 skip） |
| L4 性能 | `npm run test:perf` | 未复跑 | 本版未触碰构建执行路径；沿用 [性能基准](./performance-baseline.md) 的 0.8.148 结论 |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.151 打包 / 安装冒烟通过，含 `bundle/search-worker.js` 检查 |
| 产物 | `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警；worker 单独产物已生成 |
| L2 宿主 | `npm run test:host` | 未复跑 | 沿用 0.8.140 复核；本版未改动视图声明 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| Properties 版式（`projectPropertiesPanel.ts`） | `test-webview-panels.js` **45 断言**（CSS/模板/内联脚本语法、保存前收集异常、未渲染表单守卫、模态 API） | 1400px 与 470px 两档逐页签渲染；标签列/控件高度/静态框与 XRC 逐条对照 |
| 保存协议 | `test-project-properties-save.js`、`test-compiler-options-apply.js` 全绿 | 设置页改值 → 还原设置 → 状态提示；目标改名字段跨切换 |
| Build options 还原/描边/Linker | `test-webview-panels.js`、`test-compiler-options-apply.js` 全绿 | 勾选 → 还原；Linker executable 工程级只读提示；Linker 卡片边框 |
| 工程右键菜单/Expand All | 新增 `test-project-context-menu.js` **18 断言**（命令贡献/NLS/子菜单/00–06 分组顺序/注册/缓存重建/一次性复位/文档同步） | 工程节点右键顺序；Expand All 后逐级展开 |
| Properties / Build options 启用联动 | `test-properties-enable-rules.js` **29 断言**、`test-build-options-enable-rules.js` **24 断言**（自定义 Makefile / Commands only / 动态库 / 静态库 / 仅命令 / 未安装编译器 / 多选边界） | 逐项切换目标类型与 Makefile 模式核对灰显 |
| Build options 严格对齐 | `test-webview-panels.js` 断言「无 Extensions 页」「Make 页仅四行」；`test-run-targets-panel.js` **17 断言**（`default_target` 落盘、宿主程序、终端选项、双击确定） | 打开 Build options 逐页核对；Set Programs' Arguments 写回后重开确认 |
| 文件属性对话框 | 新增 `test-file-properties.js` **36 断言**（`analyzeFile` 统计口径、`objectNameFor` 源文件/资源/PCH、三页结构、自动生成禁用、customBuild 只写非空命令、只读 `chmod`、compilerVar 补 CPP） | Playwright 16/16 交互自检（切页保留、取消还原、按编译器暂存、默认命令、对象文件名）；6 张基线逐页对照 |
| i18n | `test-i18n-dict.js` **11 断言**（迁移点 1427 / 词条 1299）、`test-i18n-webview.js` **21 断言**（反查表 261 条） | 英文态 6 页签 + 文件属性三页无中文 UI 文案 |
| 文档与版本标记 | `test-contract.js` G1/G2/G3/G4、`test-doc-consistency.js` D1/D1b/D3/D4/D5；`npm run coverage:matrix` 重新生成 | README / usage / progress / CHANGELOG / release 索引一致 |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 118 | 116 | 98% |
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
| 新增设置 | 无（设置项总数保持 **88**） |
| 新增命令 | **5**：`codeblocks.saveProject` / `codeblocks.closeProject` / `codeblocks.removeFiles` / `codeblocks.projectTree.expandAll` / `codeblocks.projectTree.collapseAll`（命令总数 113 → **118**） |
| 新增子菜单 | **1**：`codeblocks.projectTree.menu`（`Project Tree ▸`） |
| 新增视图/快捷键 | 无（视图 **6** / 快捷键 **34** 不变） |
| 行为变更 | 工程节点右键分组顺序改为 CB 的 `00_save` → `06_extra`；Properties 面板按 CB `project_options.xrc` 重排（单张 2 列网格、PCH `Strategy` radio box、目标文件列表回右栏、脚本页 1:2）；Build options 与 Properties 均新增「还原设置」 |
| main 追加·启用联动 | Properties / Build options 的灰显规则按 CB 源码逐条补齐（自定义 Makefile、Commands only、动态库、静态库、仅命令、未安装编译器、多选边界） |
| main 追加·Build options | 删除 CB 没有的 `Extensions` 页、Project custom variables 文本域、`Dist-clean`、`Silent build`；Make 页只留四行；新增 Set Programs' Arguments 对话框并写回 `default_target` / 宿主程序 / 终端选项 |
| main 追加·文件属性 | 重写为 CB `ProjectFileOptionsDlg` 三页（General / Build / Advanced），新增 `src/model/fileStats.ts`（统计 + 对象名）、6 张视觉基线 |
| 0.8.151 修复 | Expand All 展不开（VS Code 仅对新元素采用 `collapsibleState`）：清空节点/目录缓存重建实例 + `reveal({expand:true})` 兜底；该请求为一次性，`setProjects`/`setCategorize` 复位，避免重载后把折叠节点重新顶开 |
| 代码评审批次 | 修复 3 项：Debugger 搜索目录 `window.prompt`、还原设置 `window.confirm`（WebView 沙箱无 `allow-modals`，均静默失效）→ 改用 `askText`/`confirmBox`；Expand All 粘滞 → 一次性复位 |
| 新增/扩展测试 | `test-project-context-menu.js`（17 断言）；`test-file-properties.js`（36 断言）；`test-run-targets-panel.js`（17 断言）；`test-properties-enable-rules.js`（29）/ `test-build-options-enable-rules.js`（24）；`test-webview-panels.js` 65 断言；i18n 词条表清理 27 条旧 UI 孤儿键并补文件属性词条 |
| 文档 | 新增 [release/0.8.151.md](../release/0.8.151.md) 与本报告；usage(.en) 更新面板版式与环境变量入口；progress / CHANGELOG / release/00-index 同步；覆盖矩阵重新生成 |
| 行为边界 | 不改数据模型与保存协议（元素 id/name 全部保留）；保留扩展独有能力（顶部目标选择器、目标 ↑/↓、高级分组）；不执行 Squirrel 构建脚本 |

## 4. 缺陷与处置（本轮发现并修复）

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 单元测试 | i18n 词条表缺少 `[Code::Blocks] Project saved: {0}` 与 `[Code::Blocks] {0} file(s) removed from the project: {1}`（新增命令的日志文案） | 补两条 zh-cn 词条 |
| 2 | 单元测试 | 面板重构后 27 条旧 UI 词条成为孤儿（反查表/正查表都报错） | 删除 `Build target options` 与 26 条旧标签键 |
| 3 | 单元测试 | `collectDebugForm` 改为数组编辑后不再读取 `dbg-paths` 文本域，旧断言失效 | 断言改为「未渲染时守卫 + 不改写 searchPaths」 |
| 4 | 覆盖台账 | 新增 5 个命令后命令覆盖率从 98% 降到 95%（4 个新命令无测试引用） | 新增 `test-project-context-menu.js`，命令覆盖率回到 **98%** |
| 5 | 代码评审 | Debugger 搜索目录「添加/编辑」用 `window.prompt`，WebView 沙箱无 `allow-modals` → 点了没反应 | 改用面板内 `askText` 模态；新增静态断言防回归 |
| 6 | 代码评审 | 「还原设置」用 `window.confirm`，WebView 中恒返回 false → 按钮失效 | 新增 `confirmBox` 模态并接入 |
| 7 | 代码评审 | Expand All 标记粘滞：工程重载/重新分组后仍强制保留展开，抵消用户折叠 | `setProjects`/`setCategorize` 复位标记（一次性请求） |
| 8 | 交互自检 | 文件属性内联脚本里 `String.replace(/\//g, ...)` 写在 TS 模板字符串中，反斜杠被转义吞掉 → 整个面板脚本语法错误（`missing ) after argument list`） | 改为 `split('/').join(...)`；`test-html-syntax.js` / `test-i18n-webview.js` C4 双保险捕获 |
| 9 | 单元测试 | 未知语言（`.txt` 等）在 CB 里不做行数统计（`lang == HL_NONE` 直接跳过），此前仍统计 | `FileStatistics.counted` 标记，General 页只显示大小/时间戳 |
| 10 | 单元测试 | 头文件 PCH 对象名在非 extended 模式下被错误替换扩展名（CB 恒追加 `.gch`） | 按 `SetObjName` 改为始终追加 |
| 11 | 单元测试 | 英文词条含撇号（`File's date/time stamp`）会截断内联脚本字符串 | 改词条为 `File modification time:`；C4 断言防回归 |
| 12 | 单元测试 | `test-writer-automation.js` 子集断言写死「1 pass」，新增 `tests/visual/fixtures/fileprops/*.cbp` 后失效 | 改为按目录实际 `.cbp` 数量动态计算 |

## 5. 结论

- 单元（**193**）/ 契约 / E2E / 视觉（**26**）/ 打包全部通过；三批 main 追加改动（启用联动、Build options 严格对齐、文件属性对话框）共修 5 个缺陷（#8–#12），无遗留。
- 命令缺口保持 2 个（交互式探测与 clangd 重启转发），与 0.8.150 一致。
- 未运行 `test:perf` / `test:host`：本版未触碰构建执行路径与视图声明，沿用既有基线。
