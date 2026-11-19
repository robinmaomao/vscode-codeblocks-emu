# E3 手工验收记录（0.9.2）

> 日期：2026-11-19
> 版本：`robinmaomao.codeblocks-vscode@0.9.2`（`.cb-tools/codeblocks-vscode-0.9.2.vsix`）
> 方式：Computer Use 在本会话不可启用（`/computer on` 后仍返回 unattended 限制），改用**可复现的 GUI 自动化**：
> 便携 VS Code 1.102.0（`.vscode-test/vscode-win32-x64-archive-1.102.0`）+ 独立临时 profile + 安装 0.9.2 VSIX，
> 通过 Chromium DevTools Protocol（Playwright `connectOverCDP`）驱动真实工作台 DOM、键盘、鼠标与 WebView，并逐项截图。
> 截图目录：`.cb-tools/audit-0.9.2/e3/shots/`（gitignored）。
> 说明：本记录覆盖可观察的 GUI 行为；原生 OS 文件对话框、真实拖拽手势与需人工目视的像素级项仍需人工复核（见 §4）。

## 1. 环境

| 项 | 值 |
|---|---|
| OS | Windows（win32-x64） |
| VS Code | 1.102.0（便携测试实例，独立 `--user-data-dir` / `--extensions-dir`） |
| 运行时 | 便携实例自带 Electron/Node，扩展 bundle 来自 0.9.2 VSIX |
| 工具链 | `gcc 16.2.0`、`gdb 18.1`（PATH） |
| 初始工程 | `test-project` 复制到临时工作区（hello-cb / dep-app / dep-lib / dep-test.workspace） |

## 2. 结果总览

| # | 手工验收章节 | 结果 | 证据 |
|---|---|---|---|
| 1 | 工程树与项目管理 | **PASS（核心）** | 01/06/07/40–44 |
| 2 | 状态栏 Menu（9 大顶级菜单） | **PASS** | 04/05 |
| 3 | 构建交互 | **PASS（核心）**；Rebuild 待人工复核 | 02/03/09/34 |
| 4 | WebView 面板交互 | **PASS（核心）** | 10–25/39 |
| 5 | 调试（真实 GDB） | **PASS** | 30–33 |
| 6 | IntelliSense / 符号 / 辅助工具 | **PARTIAL**（宿主/E2E 已覆盖；GUI 只验证入口） | 37 |
| 7 | 文档与资源一致性 | **PASS**（契约层 3/3、745 设置断言） | — |
| 8 | 界面语言（中英文） | **PASS** | 26–28/38 |
| 9 | 工程搜索 | **PASS（核心）** | 22/23 |

## 3. 逐项记录

### 3.1 工程树与项目管理

- ✅ 启动后自动检测到 4 个工程/工作区，状态栏显示 `Code::Blocks projects (4)`；QuickPick 默认全选并显示目录/文件名；选择 `hello-cb.cbp` 后工程打开、`Sources/Headers` 出现、状态栏变为 `Code::Blocks: 1 project(s)`（01）。
- ✅ 工程打开后状态栏入口变为工程管理器（Open/New/Detect/已打开列表），可再次检测并多选打开；检测列表把已打开项标记 `Opened`。
- ✅ 多工程：打开 hello-cb + dep-app + dep-lib 后状态栏 `3 project(s)`，树中三个工程并列；活动工程高亮（40/42）。
- ✅ 树层级：工程 → `Sources/Headers` → 文件；C 文件图标正确；双击 `main.c` 打开编辑器（06/29）。
- ✅ 右键菜单：Save/Close/Add Files/Remove Files/Reload/Build/Rebuild/Clean/Build options/Properties/Select Build Target/Move Up/Move Down/Remove Project 均存在（07）。
- ✅ `Move Up` 把 dep-lib 移到 dep-app 之前，树顺序即构建顺序（43，等价于拖拽排序的后端行为）。
- ⚠️ **未在树中看到“构建目标”层级**：当前为工程 → Sources/Headers → 文件；目标通过状态栏 `Target:` 与右键 `Select Build Target for Project` 切换。若手工清单要求“工程 → 构建目标 → 文件”，需确认是否为产品预期（见 §4）。
- ⚠️ **外部修改检测未触发**：直接给已打开 `.cbp` 追加注释并多次切换前台焦点，未出现“工程已在磁盘上被修改”提示；随后用 `Code::Blocks: Reload Project from Disk` 可手动刷新。需在真实用户 profile 复核（临时 profile/隐藏目录可能影响 watcher）。

### 3.2 状态栏 Menu

- ✅ 状态栏 `Menu` 打开 9 个顶级菜单，顺序为 File / Edit / View / Search / Project / Build / Debug / Tools / Settings（04）。
- ✅ 逐级进入 9 个子菜单均有内容（File 15、Edit 15、View 10、Search 15、Project 12、Build 15、Debug 15、Tools 10、Settings 11 个可见行），无 `group@n` 裸文本泄漏（05）。
- ✅ Build 子菜单包含 Build(Ctrl+F9)、Compile Current File(Ctrl+Shift+F9)、Run(Ctrl+F10)、Build and Run(F9)、Rebuild(Ctrl+F11)、Clean、Dist Clean、Build/Rebuild/Clean Workspace、Abort、Errors、Select Target、Export Makefile；快捷键展示与命令一致。

### 3.3 构建交互

- ✅ 状态栏 Build 按钮在构建中显示 `Building… (Ns)`，完成后恢复 `Build`（02/03）。
- ✅ 普通 Build：构建成功通知 `✅ Build succeeded · 0 error(s) · 0 warning(s)`；输出通道出现 `Output file is bin\Debug\hello.exe with size 86.93 KB`、`[Linked]`、Build Log 汇总（03）。
- ✅ 运行：`Code::Blocks: Run` 打开 `Run: Debug` 终端，实际输出 `hello-cb: 2 + 3 = 5`（34）。
- ⚠️ **Rebuild 模态在本次自动化中未呈现**：执行 `Code::Blocks: Rebuild` 后状态栏停在 `Building… (101s+)`，输出通道没有新日志；`Stop Build` 返回 `No build in progress`，只能 `Developer: Reload Window` 恢复。代码层面 Rebuild 在 `confirmRebuild()` 模态期间已持有构建互斥（`buildSingleProject` → `claimBuildMutex`），若模态不可见/未响应会表现为无法停止。需人工在真实窗口中复核是否为 CDP/后台窗口导致模态未置前，或确有互斥与确认顺序问题（见 §4）。
- ⚠️ 增量 up-to-date 未单独判定：本轮第二次 Build 之前工程文件被 WebView 保存（notes/build options）改动，重新编译属预期；未把“无改动第二次构建”作为通过证据。

### 3.4 WebView 面板

- ✅ 工程属性面板正常打开，标题 `Project Properties: hello-cb`；6 个页签全部切换成功：Project settings / Build targets / Build scripts / Notes / C/C++ parser options / Debugger（10–16/39）。
- ✅ Notes：输入内容并点 Save 后 `.cbp` 实际写入 `E3-NOTE-2026-11-19`，输出通道出现 `Project properties saved: hello-cb (2 target(s))`（18–20）。
- ✅ Build options：勾选 `Profile code when executed (-pg)` 并 Save 后 `.cbp` 实际包含 `-pg`，通知 `Build options saved`（24/25）。
- ✅ Keybinding Settings 面板渲染完整：搜索、Apply、Reset all、Check conflicts、Open keybindings.json、Export/Import scheme；Build/Rebuild/Clean/Run 行与当前键位显示正确（21）。
- ✅ 未切换页签直接保存（Notes 场景）未出现 TypeError/静默失败。
- ⚠️ 窄面板 500px、英文界面下的属性面板、`retainContextWhenHidden`、虚拟目标 alias 多选等未逐项操作；由视觉回归（26 面）与宿主/E2E 覆盖，人工可抽查。

### 3.5 调试（真实 GDB）

- ✅ 打开 `main.c`，在第 7 行 gutter 设置断点，BREAKPOINTS 面板出现 `main.c / 7`（32）。
- ✅ `Code::Blocks: Debug` 启动真实 GDB 会话：命中断点，CALL STACK 显示 `main.c:7`、`BREAKPOINT-HIT`、`PAUSED`；VARIABLES 显示 `result = 32759`（未初始化值，符合停在第 7 行未赋值的状态）；REGISTERS/LOADED SCRIPTS 视图存在（33）。
- ✅ `Debug: Stop` 可结束会话；随后 Run 终端正常输出（34）。
- ⚠️ 单步/逐指令/内存查看/Attach 等 8 条调试辅助命令未在 GUI 逐条点击（无头行为测试已覆盖 14 断言）。

### 3.6 IntelliSense / 符号 / 辅助工具

- ✅ `Find File` 类命令入口存在；clangd 检测/compile_commands 生成在输出通道可见（`Regenerated compile_commands.json (2 compile command(s))`、`clangd detected: …llvm\bin\clangd.exe`）。
- ⚠️ 未逐项验证跳转/补全/符号搜索的编辑器交互；由宿主 37 用例、E2E 与 clangd 专项测试覆盖。

### 3.7 文档与资源一致性

- ✅ `npm run test:contract`：contract 44 + doc-consistency 6 + settings 745，全部通过；版本/文档链接/覆盖矩阵一致。
- ✅ 审计报告与 0.9.2 发版文档在 GUI 帮助/命令面板中可访问（Settings 菜单项指向正确设置节）。

### 3.8 界面语言

- ✅ `Code::Blocks: Switch UI Language…` 选择 Chinese (Simplified) 后，状态栏立即变为 `Code::Blocks: 1 项目`，Menu 变为 文件/编辑/视图/搜索/工程/构建/调试/工具/设置（27）。
- ✅ 切回 English 后状态栏恢复 `1 project(s)`（38）。
- ✅ 命令标题仍跟随 VS Code 显示语言（英文），与设置说明一致（`command.ui.switchLanguage` 文档已说明）。

### 3.9 工程搜索

- ✅ Project Search 视图加载 `3 files · 1 ms`；输入 `main` 后 `1 files · 0 ms`，查询执行成功（22/23）。
- ✅ 视图包含 Files/Text、All projects 范围、Search History、Keep history；搜索结果区域受侧栏高度限制未展开截图，但计数与查询耗时表明搜索链路正常。

## 4. 待人工复核 / 后续

1. **Rebuild 确认与构建互斥（优先级最高）**：在真实窗口（非 CDP 后台）执行 Rebuild，确认模态是否置前；若出现 `Building…` 但无模态且 Stop 无效，应把 `confirmRebuild()` 移到 `claimBuildMutex()` 之前，或让 Stop 在确认阶段可取消。当前仅记录现象，未改产品代码。
2. **外部修改检测**：在普通用户 profile/非隐藏目录重复“外部改 `.cbp` → 切回 VS Code”，确认 watcher/焦点路径；若仍不弹，需要检查 `detect.checkExternalChanges` 与 watcher 排除。
3. **工程树构建目标层级**：对照 Code::Blocks 手工清单确认是否需要在树中显示 target 节点；当前通过状态栏/右键切换目标。
4. **原生对话框与拖拽手势**：Open/New 文件对话框、项目节点真实拖拽、悬停菜单为 OS/指针级交互，CDP 自动化不覆盖，保留人工抽查。
5. **性能/窄面板/像素级视觉**：由 L3 视觉 26 基线、L4 性能 13 项、宿主 37 用例覆盖；人工只需抽查暗/亮主题与 500px 窄面板。

## 5. 结论

- 0.9.2 的核心 GUI 链路（工程打开/多工程树、状态栏菜单、构建/运行、属性/构建选项/快捷键 WebView、真实 GDB 断点、语言切换、工程搜索）在便携 VS Code 1.102.0 中**可正常操作并产生预期结果**。
- 未发现阻断级 GUI 缺陷；Rebuild 模态与外部修改检测两项需在真实窗口人工确认，已记录为观察项而非定论。
- E3 的自动化证据可重复：临时 profile、安装 VSIX、`--remote-debugging-port` + Playwright CDP 脚本（`.cb-tools/audit-0.9.2/e3/driver.js`）。
