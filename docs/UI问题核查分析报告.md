# UI 问题核查分析报告 —— 界面侧遗留问题与新增发现

> 核查日期：2026-09-29 ｜ 基线版本：codeblocks-vscode 0.8.108-dev
> 范围：`src/ui/*`、`src/extension.ts` 界面相关部分、`package.json`（views / menus / 状态栏 / 设置）
> 本报告只做核查与修复方案建议，**不含代码改动**——各修复项待用户确认后实施。

---

## 1. 结论摘要

| # | 问题 | 现状 | 建议级别 |
|---|------|------|----------|
| **F2** | 启动自动恢复 + 自动打开工程（无开关） | `extension.ts:1587-1603` 无条件执行 | ★ 高 |
| **F3** | 编辑器激活自动切活动工程（无开关） | `extension.ts:677-680 / 2711` 无条件执行 | ★ 中 |
| **F4** | 工程树文件固定字母序（无开关） | `projectTreeProvider.ts:502/525/537-545/573-581` | ★ 中 |
| **F6** | 构建进度通知 + 状态栏秒数固定开启（无开关） | `extension.ts:4645/4765/4832` + spinTimer `:594-609` | ○ 可选 |
| **F7** | use_folders / hide_folder_name 无对应开关 | 仅 `projectTree.categorize` | ○ 记录不移植 |
| **N1** | Symbols 视图与 Project 视图**共用同一图标** | `package.json` views：`codeblocks.symbols` icon=`resources/project.svg` | ○ 低 |
| **N2** | 每次 Run 新建同名终端，重复运行堆积终端标签 | `extension.ts:6138/6155` 无复用逻辑 | ✔ 已实施（0.8.109-dev，方案 C） |
| **N3** | Build Log「只看错误」开关**无开/关视觉反馈** | `package.json:93`（icon `$(filter)`）+ `:1099/1104` 两条 when 互补但图标相同 | ○ 低 |
| **N4** | 状态栏左区常驻 5 项，`Code::Blocks: N 项目` 与 Menu 功能重叠 | priority：Menu 1000 / cbp 110 / Target 100 / Build 90 / Compiler 70 | ○ 可选 |
| **N5** | 两个 Webview 面板 `retainContextWhenHidden: true` | `compilerOptionsPanel.ts:28`、`projectPropertiesPanel.ts:235` | ○ 记录（有意保留状态） |
| **R1/R2/R3** | 打开文件策略 / ignore_output / 调试前自动构建 | 功能差异，见 §4 | ○ 记录 |

---

## 2. 第六轮报告遗留项（至今仍无门控，需确认）

> 第六轮报告 F1/F1b/F5/F8 已实施（0.8.94/0.8.95-dev）；**F2/F3/F4/F6/F7 未确认也未实施**，现状复核如下。

### F2 启动自动恢复 + 自动打开工程

- 现状：`activate()` 末尾无条件 `restorePersistedProjects()`（`:1587`）+ `autoDetectAndOpenProject()`（`:1590`）+ 工作区文件夹变化监听（`:1595`）+ `**/*.cbp` 创建/删除监视器 800ms 去抖重扫（`:1598-1603`）。新建一个 `.cbp` 也可能被自动打开。
- CB：`/environment/blank_workspace` 默认 true＝不加载上次工作区。
- 建议：新增 `codeblocks.project.autoOpenOnStartup`（`restore` / `blank` / `detect`）。**默认值请确认**：`restore`＝现状；`blank`＝对齐 CB。

### F3 编辑器激活自动切活动工程

- 现状：`onDidChangeActiveTextEditor → syncActiveProjectToEditor()`（`:677-680`）无条件切活动工程（影响状态栏、F9 构建对象、clangd 归属）。
- CB：`/sync_editor_with_project_manager` 默认 false 且仅树定位。
- 建议：新增 `codeblocks.ui.syncActiveProjectWithEditor`（布尔）。**默认值请确认**：`true`＝现状（文档已宣传）；`false`＝对齐 CB。

### F4 工程树文件固定字母序

- 现状：`sortDirNodes()`（`projectTreeProvider.ts:537-545`）与根层排序（`:573-581`）无条件按 label 字母序。
- CB：`/sort_alpha` 默认 false＝按 .cbp 原序。
- 建议：新增 `codeblocks.projectTree.sortAlphabetically`（布尔）。**默认值请确认**：`true`＝现状；`false`＝对齐 CB 原序。

### F6 构建进度显示固定开启

- 现状：三处 `withProgress(Notification, cancellable)`（工作区 `:4645` / 单工程 `:4765` / 单文件 `:4832`）+ 状态栏 250ms `Building… (Ns)` spinner。
- CB：`/build_progress/bar`、`/build_progress/percentage` 默认 false。
- 建议（可选）：新增 `codeblocks.build.showProgress`（`notification` 默认 / `statusBar` / `none`）。注意通知进度承担「取消构建」入口，改 `none` 后状态栏停止入口（spinner 点击）仍保留。

### F7 use_folders / hide_folder_name

- 现状：物理目录模式恒等价 CB `use_folders=true`，无平铺/隐藏文件夹名模式。
- 建议：**记录不移植**（当前默认组合与 CB 默认一致，仅少数用户会关闭）。

---

## 3. 新增发现（N1–N5）

### N1 Symbols 视图复用 Project 图标

- `package.json` views：`codeblocks.symbols` 的 `icon` 为 `resources/project.svg`，与 `codeblocks.projectTree` 完全相同（侧栏视图标题图标看不出区别）；`resources/` 下无 `symbol.svg`。
- 建议（低）：新增 `resources/symbols.svg`（或换 codicon 风格 SVG）供 Symbols 视图使用。

### N2 每次 Run 新建同名终端

- 4 处 `vscode.window.createTerminal` 每次调用都**新建终端实例**（VS Code 不合并同名终端）：
  1. `run()` 普通可执行分支 `extension.ts:6155` — `Run: <target>`
  2. `run()` 库/CommandsOnly 宿主程序分支 `:6138` — `Run: <target>`
  3. 自定义工具 terminal 模式 `:5300` — `CB Tool: <name>`
  4. 无工程编译成功后运行 `:6097` — `Run (no project)`
- 现象：连续运行 N 次 → 面板堆积 N 个同名终端标签（每次还新起一个 shell 进程；`show()` 把焦点切到新标签）。旧输出留在旧标签里。
- 与 CB 的关系：CB-Windows 每次 Run 弹新控制台窗口，故「每次新终端」行为近似 CB，但 VS Code 面板里会**持续堆积**（CB 窗口是关一个少一个）。
- 方案（请选）：
  - **A 复用**：先查 `vscode.window.terminals` 是否有同名实例，有则 `sendText` + `show()`，无则新建。改动最小；但多次运行的输出会首尾相接、且忽略本次运行的新 cwd/env（沿用旧终端的）。
  - **C 先弃后建（推荐）**：找到同名终端先 `dispose()` 再新建——**始终只有一个标签 + 每次全新输出**，cwd/env 每轮正确；代价是上一轮滚动历史丢失。
  - B（不可行）：清空已有终端缓冲无公开 API，排除。
- 范围选项：仅 `run()` 两分支 / 4 处全改 / 加设置门控（如 `codeblocks.ui.runTerminalReuse`，默认关闭维持现状）。
- Debug 走 DAP 无此问题。

### N3 「只看错误」开关无开/关视觉反馈

- `codeblocks.buildLog.toggleErrorsOnly` 的 `view/title` 两条条目（`package.json:1099/1104`）when 互补，但指向同一 command、同一 icon（`$(filter)`，`:93`）——开启/关闭时工具栏图标不变。VS Code 的 icon 定义在 command 上，无法按 when 区分。
- 建议（低）：① 拆成两条命令各配不同图标（如 `$(filter)` / `$(filter-filled)`），或用 `$(eye)` / `$(eye-closed)`；② 或接受现状。

### N4 状态栏左区 5 项常驻

- 现状：`$(menu) Menu`（1000）+ `Code::Blocks: N 项目`（110）+ `Target`（100）+ `Build`（90）+ `Compiler`（70）。其中 cbp 入口（打开/新建/扫描/移除）与 Menu 的 File 菜单功能重叠。
- 建议（可选）：将 projectManager 并入 Menu QuickPick 一级列表、cbp 状态栏项仅在「有待打开项目」时显示；或维持现状。

### N5 两个 Webview 面板 retainContextWhenHidden

- `compilerOptionsPanel.ts:28`、`projectPropertiesPanel.ts:235` 保留 `retainContextWhenHidden: true`（0.8.97 审计只移除了 keybindingPanel）。此属性使面板隐藏后驻留内存、保留未保存的编辑状态——**判断为有意保留表单状态，建议维持现状**，仅记录。
- 三面板均已有 CSP（`default-src 'none'`），无安全问题。

---

## 4. 观察与记录（非 UI 开关类）

| # | 项 | 说明 |
|---|----|------|
| R1 | On project load 打开文件策略 | 扩展固定「不打开任何文件」；CB `/open_files` 默认 1＝打开上次文件。属功能差异。 |
| R2 | `ignore_output` | CB 可配置构建日志忽略行，扩展无此过滤。 |
| R3 | 调试前自动构建 | CB `/common/auto_build` 默认 true（构建完成后再启动调试，失败弹「Debug anyway?」）；扩展只保存不构建，缺 exe 时仅报错提示。 |
| R6① | `applyTokenColorCustomizations`（`extension.ts:167/6366`） | 激活时无条件把 .ld/.xm tokenColorRules 合并进用户 settings.json，无开关/首启确认。 |
| R6② | 静默快捷键冲突提示 | 输出通道 + 30s 状态栏项，无弹窗；已有 globalState 去重，可维持。 |

---

## 5. 已确认无问题（防误报）

- 三 Webview 面板 CSP 齐全、无 `unsafe-eval`；`buildLogAutoFocus`/`quietSuccess`/`quietFailure`/`disableInit`/`saveHtmlLog*` 等均已门控；
- 设置无死配置（`test-settings-structure` 54 项 + dist 读取扫描）；
- 视图布局一次性应用、不覆盖用户调整；Build spinner 停止入口保留；
- Project 标题栏按钮、状态栏 Menu、Analysis/Symbols 视图逻辑无异常。

---

## 6. 决策清单（请逐项确认；□＝待勾选）

| 编号 | 项目 | 建议方案 | 选项 |
|------|------|----------|------|
| F2 | 启动自动恢复/打开工程 | 新增 `codeblocks.project.autoOpenOnStartup`（枚举） | □ `restore`（现状）｜□ `blank`（对齐 CB）｜□ 不做 |
| F3 | 编辑器激活切活动工程 | 新增 `codeblocks.ui.syncActiveProjectWithEditor`（布尔） | □ `true`（现状）｜□ `false`（对齐 CB）｜□ 不做 |
| F4 | 工程树文件排序 | 新增 `codeblocks.projectTree.sortAlphabetically`（布尔） | □ `true`（现状）｜□ `false`（对齐 CB 原序）｜□ 不做 |
| F6 | 构建进度显示 | 新增 `codeblocks.build.showProgress`（枚举） | □ 做（默认 notification）｜□ 不做 |
| F7 | use_folders/hide_folder_name | — | □ 记录不移植（推荐）｜□ 做两个布尔 |
| N1 | Symbols 视图图标 | 补独立 `symbols.svg` | □ 做｜□ 不做 |
| N2 | Run 终端复用 | 复用同名终端，避免堆积 | ✔ **已实施（方案 C，用户确认）**：`src/ui/runTerminal.ts` 同名先弃后建，4 处全改、无门控 |
| N3 | 「只看错误」状态反馈 | 拆两条命令配不同图标 | □ 做｜□ 接受现状 |
| N4 | 状态栏精简 | cbp 项并入 Menu / 仅待打开时显示 | □ 做｜□ 维持现状 |
| N5 | retainContextWhenHidden | — | □ 维持现状（推荐）｜□ 移除 |
| R3 | 调试前自动构建 | `codeblocks.debug.buildBeforeDebug` + 失败「仍要调试?」 | □ 做（默认对齐 CB＝true）｜□ 记录待办 |
| R6① | tokenColor 自动写 settings.json | 加开关/首启确认 | □ 做｜□ 记录 |

---

## 7. 实施注意（如确认修复）

- 设置计数：`tests/test-settings-structure.js`（现 54 项）与 `使用说明.md` §13 设置表必须同步；
- 默认值变更（F2 若选 `blank`、F3 若选 `false`、F4 若选 `false`）需在 release notes 显著标注行为变化；
- 新增测试（每项 ≥10 断言，含「设置关闭时行为」）→ `tsc` + 全量回归 + headless（跑完恢复 `test-project/bin/Debug/hello.exe`）→ bump 版本打包。
