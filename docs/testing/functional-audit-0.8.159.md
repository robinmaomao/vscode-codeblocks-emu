# 0.8.159 全量逐项功能验证与缺陷分析报告

> 生成日期：2026-11-19 ｜ 目标版本：`0.8.159`（commit `b38dc0c`）｜ 范围：136 命令 / 6 视图 / 91 设置 / 34 键位 / 3 语言 + 3 语法 / 30 DAP / 9 菜单 + Code::Blocks 25.03 源码对照
> 方案：本轮审计计划（会话工作区，未入库）；逐项台账见 [功能审计逐项台账](./functional-audit-0.8.159-ledger.md)；测试方案见 [测试方案](./strategy.md)。
> 本轮只做验证与报告，**未修改产品代码**；缺陷修复需你确认后实施。

## 1. 结论摘要

### 1.1 总体结论

**可用性良好，但不能宣称“100% 行为覆盖”。**

- 7 层自动化测试在当前工作树全部通过：契约 **3/3**、无头 **217/217（1 SKIP）**、E2E **6/6**、视觉 **26/26**、性能 **13/13**、打包 **15 断言**、真实宿主 **25/25**。
- 136/136 命令在真实 VS Code 1.85.0 中均已注册；mock 冒烟实际执行 129 条 + 1 条 UI 等待 + 6 条延后，0 异常；真实宿主无工程 91 条 / 有工程 90 条非模态命令执行，均无命令异常（2 条因测试模式拒绝模态框，1/3 条等待 QuickPick）。
- 分域探针覆盖工程生命周期、破坏性命令、新建向导、用户模板、Makefile 项目、构建/运行、Open Include File、语言注释、TODO 插入、头文件保护、Profiler 等，共 **80+ 直接断言**。
- **发现 1 个 S1 数据丢失风险、4 个 S2 功能性/对齐缺陷、8 个 S3 一致性问题**。S1：新建工程 / 从用户模板新建会**静默覆盖**已存在的同名文件；S2：`.ld` 行注释配置错误、`todo.add` 在非 C 语言插入错误注释、`insertHeaderGuard` 可作用于非头文件、`openIncludeFile` 不搜编译器系统头。

### 1.2 缺陷统计

| 严重级 | 数量 | 编号 |
|--------|------|------|
| S0 崩溃 / 数据损坏 | 0 | — |
| S1 数据丢失 / 严重错误 | 1 | F-01 |
| S2 功能错误 / 用户可见错误行为 | 4 | F-02、F-03、F-04、F-05 |
| S3 边界 / 一致性 / 文档 / 测试体系 | 8 | F-06 … F-13 |

### 1.3 关键数字

| 指标 | 结果 |
|------|------|
| 命令注册 | **136 / 136**（真实宿主 `getCommands`） |
| 命令入口执行 | **136 / 136**（mock + 宿主 + 分域探针） |
| 命令级行为断言 | **84 / 136**（E2 72 / E3 2 / E4 10） |
| 仅有入口证据、无命令级行为断言 | **52 / 136** |
| 设置项 | **91 / 91** 有读取点或 `when` 声明式使用 |
| 快捷键 | **34** 条贡献；**31** 条托管表；**0** 冲突 |
| 视图 | **6 / 6** 有 Provider；5 个树 + 1 个 WebView 视图 |
| 语言 / 语法 | **3 + 3**；`ld` 注释配置有缺陷（F-02） |
| DAP 能力 | **30**；27 个名称在适配器直接出现，3 个为复合能力 |
| 菜单 | **9** 顶级 / **186** 项 / **171** 叶子；**0** 条未注册命令 |
| NLS | **307 / 307** 中英一致；0 缺失 / 0 多余 |
| 文档引用 | 命令 **136 / 136**、设置 **91 / 91**；相对链接失效 **0** |
| 单元脚本 | 218 个 `test-*.js`；实际执行 217；**审计时 10 个仅打印无断言，修复轮已全部转断言**；1 个手工工具 SKIP |

### 1.4 修复顺序建议

1. **F-01（S1）**：先补覆盖保护，避免新建工程丢用户文件。
2. **F-02 / F-03（S2）**：低改动、高收益，避免 Ctrl+/ 或 Add TODO 破坏 `.ld`/`.xm`。
3. **F-04 / F-05（S2）**：补齐 CB 对齐语义（头文件保护仅头文件、Open Include File 搜系统头）。
4. **F-06 … F-10（S3）**：TODO 完整性与 i18n 一致性，可合并为一个批次。
5. **F-11 … F-13（S3）**：文档计数、测试体系、项目名校验。

## 2. 方法与证据分级

### 2.1 证据等级

| 级别 | 定义 | 判定依据 |
|------|------|----------|
| E0 | 不可达 / 未注册 | 声明存在但运行时不存在，或菜单/文档指向不存在命令 |
| E1 | 仅静态存在 | 只在契约/源码/测试文本中出现，无执行证据 |
| E2 | 无头行为 | 可激活 harness 执行 handler，并对可观察状态断言（文件、输出通道、设置、树、诊断、对话框记录） |
| E3 | 真实工具链 | 真实 gcc/g++/ar/ld/gdb/nm/gprof/ccache 等产生可验证的文件/进程/调试结果 |
| E4 | 真实宿主 | 真实 VS Code 内执行，验证命令、视图、WebView、设置、键位、调试会话 |
| E5 | 人工验收 | 只能由人观察的视觉/交互项，提供步骤与预期结果 |

### 2.2 本轮使用的手段

1. **T1 静态交叉对账**：package.json ↔ src 注册/读取点 ↔ 菜单/键位 ↔ tests ↔ docs。
2. **T2 既有测试取证审计**：逐脚本判断断言对象是真实行为还是文本/夹具自证。
3. **T3 激活 harness 探针**：`tests/_harness/extensionActivation.js` 直调真实 handler，断言用户可见效果。
4. **T4 真实工具链探针**：真实 gcc/g++/ld/gprof。
5. **T5 真实宿主**：`@vscode/test-electron` 1.85.0，隔离 profile / workspace，执行 136 命令冒烟 + 构建/运行/保存/布局。
6. **T6 Code::Blocks 25.03 源码对照**：`codeblocks-src/` 对应实现（wiz.cpp、headerguard.cpp、codecompletion.cpp、parsemanager.cpp 等）。
7. **T7 人工清单**：只对不可自动化项输出 E5 清单（见 §9）。

### 2.3 覆盖幻觉判定

满足任一即标为 E1 / 覆盖不足：

- 测试只出现命令 ID 字符串，没有 `executeCommand` / `app.invoke` / handler 直调。
- 断言只检查测试自己写入的夹具或源码包含某字符串。
- 只验证 package.json 声明，不验证运行时行为。
- 永久 SKIP 且无环境说明。
- 只验证“不抛异常”，未验证正确结果。
- 测试通过但实际未产生副作用（命令早退、弹窗被自动关闭未断言）。

## 3. 环境与基线

### 3.1 环境

| 项 | 值 |
|----|----|
| OS | Windows 11 Home 10.0.26120 x64 |
| CPU / 内存 | AMD Ryzen 7 7840U w/ Radeon 780M ×16 / 31.3 GB |
| Node / npm | v24.22.3 / 11.19.1（PowerShell 执行策略禁用 `npm.ps1`，使用 `npm.cmd`） |
| PowerShell | 5.1.26100.6682（CurrentUser ExecutionPolicy = Undefined） |
| gcc / g++ | w64devkit GCC 16.2.0 |
| gdb | GNU gdb 18.1 |
| ar / nm / objdump / gprof | GNU Binutils 2.47.20260726 |
| make / cmake | GNU Make 4.4.1 / cmake 4.4.4 |
| clang / clangd | LLVM 23.1.3（`.cb-tools/toolchains/llvm`） |
| ccache | 4.14.1 |
| 缺失工具 | **astyle**、**sccache**、**svn**（对应场景只验证降级路径） |
| 交叉工具链 | avr / llvm / msp430 / riscv / sdcc / tcc |
| VS Code 缓存 | 1.85.0（engines 最低靶点）、1.102.0 |
| Git | `b38dc0c`，工作树干净 |

### 3.2 七层基线

| 层 | 命令 | 结果 | 耗时 |
|----|------|------|------|
| L-1 契约 | `npm.cmd run test:contract` | **3/3**（44 + 6 + 725 断言） | 1s |
| L0 无头 | `npm.cmd test` | **217 / 217**，1 SKIP（`test-writer.js`） | 128s |
| L1 E2E | `npm.cmd run test:e2e` | **6/6**（39+2skip / 48 / 21 / 141+1skip / 9 / 42+2skip） | 71s |
| L3 视觉 | `npm.cmd run test:visual` | **26/26**（dark/light，跨环境容差） | 20s |
| L4 性能 | `npm.cmd run test:perf` | **13/13**，0 warn / 0 fail | 10s |
| L5 打包 | `npm.cmd run test:pack` | **1/1，15 断言** | 21s |
| L2 宿主 | `npm.cmd run test:host` | **25/25**（VS Code 1.85.0） | 28s |

> 原始日志：`.cb-tools/audit-0.8.159/baseline/*.log` 与 `summary.txt`。基线工作树无改动，仅在审计目录新增证据。

## 4. 逐项验证结果

### 4.1 命令（136）

| 证据维度 | 结果 |
|----------|------|
| package.json 声明 | 136 |
| src 注册（含动态注册） | **136 / 136** |
| 真实宿主注册 | **136 / 136** |
| mock 命令冒烟 | **129 ok + 1 ui-pending + 6 deferred**，0 threw / 0 timeout |
| 真实宿主无工程执行 | 91 ok + 1 pending（`workspaceScanReport`）+ 2 dialog-refused（测试模式）+ 42 skipped |
| 真实宿主有工程执行 | 90 ok + 3 pending（`workspaceScanReport` / `findSymbolInLibraries` / `saveWorkspace`）+ 1 dialog-refused + 42 skipped |
| 命令级行为断言（既有测试 + 探针） | **84 / 136**（E2 72 / E3 2 / E4 10） |
| 仅入口、无命令级行为断言 | **52 / 136**（见 §5.3） |

**证据升级**：审计前只有 44 条命令有命令级行为证据；分域探针 + 宿主冒烟后提升到 84 条，入口执行从约 44 条提升到 **136/136**。

**域分布（入口证据）**：工程 31、构建运行 18、调试 14、编辑器工具 7、搜索诊断 5、界面/键位 5、版本/分析 4、其它 7（仅统计“仅入口”项）。

**菜单/键位面**：43 条命令不在状态栏 9 大菜单中，均为视图标题/右键菜单/命令面板入口（如 `buildLog.*`、`analysis.*`、`fileProperties`、`toggleCompile` 等）；120 条命令无默认键位（正常）。完整逐项表见 [台账附录 §A](./functional-audit-0.8.159-ledger.md#a-命令证据136)。

### 4.2 视图（6）

| 视图 | Provider | 宿主可见 | 证据 |
|------|----------|----------|------|
| `codeblocks.projectTree` | `createTreeView` | ✔ | 宿主 focus/菜单/拖拽静态测试 |
| `codeblocks.search` | `registerWebviewViewProvider` | ✔ | 工程搜索 Provider/HTML 测试 |
| `codeblocks.symbols` | `createTreeView` | ✔ | 宿主聚焦 + 符号 Provider |
| `codeblocks.analysis` | `createTreeView` | ✔ | 宿主聚焦 + 分析 Provider |
| `codeblocks.buildLog` | `createTreeView` | ✔ | 宿主 focus + HTML 日志测试 |
| `codeblocks.debug.registers` | `registerTreeDataProvider` | ✔ | 宿主聚焦 + E2E 调试 |

结论：6/6 有 Provider、有聚焦命令、宿主可聚焦；无缺失视图。

### 4.3 设置（91）

- **91/91** 都有源码读取点或 package.json `when` 声明式使用；`no-read-site = 0`。
- `settings.md` / `settings.en.md` 表格行均 **91**，默认值与 package.json 逐一比对 **0 不一致**。
- **6 个设置无测试文件引用键名**：`compiler.flagOverrides`、`compiler.languageFlags`、`noProjectCompile.useTaskTerminal`、`profiler.gprofPath`、`profiler.annotatedSource`、`search.scope`。其中 `noProjectCompile.useTaskTerminal=true` 经探针验证会走 VS Code Task 路径；其余为测试缺口（见 §5.4）。
- `ui.symbolsView` 与 `keybindings.cbStyle` 为声明式（`when` / 多键位条件），不是未读取。

完整表见 [台账附录 §B](./functional-audit-0.8.159-ledger.md#b-设置项91)。

### 4.4 快捷键（34）

- contributor 键位 **34** 条；托管表 `MANAGED_KEYBINDINGS` **31** 项（16 builtin + 3 alias + 12 cbStyle）。
- 18 条指向已声明命令，16 条指向内部命令（`projectTree.focus` / `buildLog.focus` 等），0 条外部未知命令。
- 同键位 + 同 `when` 冲突 **0**。
- 宿主机验证 `keybindings.apply` 写入、`reset` 清理、`panel` 单例、冲突检查命令可执行。
- 文档写“30 项”是过期计数（实际 31），见 F-11。

### 4.5 语言 / 语法（3 + 3）

| 语言 | 扩展名 | 语法文件 | 语言配置 | 结论 |
|------|--------|----------|----------|------|
| `ld` | `.ld` / `.lcf` | 存在 | 存在 | **行注释配置错误**（`//`，GNU ld 拒绝），F-02 |
| `asm` | `.s` / `.S` / `.asm` 等 | 存在 | 存在 | 默认 `//`（预处理 `.S` 安全）；`editor.asmHashComment` 可切 `#` |
| `xm` | `.xm` | 存在 | `#` | 语法/配置正确；`todo.add` 会插入 `//`（F-03） |

### 4.6 DAP 能力（30）

- 30 项能力标记均有测试命中；E2E 调试矩阵 **141 pass / 1 skip**，覆盖 initialize、launch/attach、断点族、step、threads/stackTrace/scopes/variables、evaluate、disassemble、readMemory、modules、exception、pause 等。
- `setConditionalBreakpoints` 通过断点 `condition` 字段实现；`pause/stop` 通过 `pause`；`disconnect/detach` 通过 `disconnect`/`detach`，不是缺失。
- 命令级补充：`debug.attachToProcess` 经 mock 探针验证会以 `request: "attach"` + PID 启动；`debug.setNextStatement`/`sendGdbCommand`/`detach`/`addSymbolFile` 的适配器路径由 E2E/单测覆盖。
- 仍需补：`nextInstruction` / `stepIntoInstruction` / `examineMemory` / `info*` 的**命令入口**在有活动会话时的断言（见 §5.3）。

### 4.7 菜单（9 / 186 / 171）

- 9 个顶级菜单：File / Edit / View / Search / Project / Build / Debug / Tools / Settings。
- `menuStructure` 共 **186** 项，叶子命令 **171**，其中 `codeblocks.*` 叶子 **99**。
- **0** 条菜单项引用未声明/未注册命令；**0** 条重复冲突。
- Code::Blocks `main_menu.xrc` 叶子 **130** 条；按标签归一化精确匹配 **60** 条。其余差异为：
  - 重命名/等价项（如 `Save everything` ↔ `Save All Files`、`&Close file` ↔ `Close Editor`、`S&wap header/source` ↔ `Swap Header / Source`）；
  - 有意不移植（Print、New Custom、Perspectives、Toolbars、Special commands、Plugins、Help、Scripting 等，见 [backlog](../dev/backlog.md) 与 [alignment](../guide/alignment.md)）；
  - 扩展特有项（状态栏菜单、VS Code 视图/终端/Problems、Project Search 等）。
- 结论：菜单结构无功能性缺口；`168` 项计数是过期文档（实际 186），见 F-11。

### 4.8 文档 / i18n

| 项 | 结果 |
|----|------|
| 文档引用命令 | 136 / 136 |
| 文档引用设置 | 91 / 91 |
| settings.md / settings.en.md 表格 | 91 / 91 行，默认值一致 |
| NLS 占位符 / en / zh | 307 / 307 / 307 |
| NLS 缺失 / 多余 | 0 / 0 |
| 相对链接失效 | 0 |
| 运行时词条 | 1537 |
| WebView 反查表 | 274 |
| 菜单标签翻译 | 186 / 186 |

结论：文档覆盖完整、NLS 一致；但**计数类陈述**存在过期（F-11）。

### 4.9 分域探针

| 探针 | 结果 | 证据 |
|------|------|------|
| 工程生命周期（newBuildTarget/newFile/addFile/recursive/findFile/removeFiles/saveAs/exportMakefile/import/swap/activate/clearRecent/notes/defaultConfig） | **22 / 22** | `lifecycle-commands.json` |
| 破坏性命令（clean/rebuild/removeFile/deleteVF/bookmarks/removeProject/closeProject/cleanWorkspace/rebuildWorkspace） | **13 / 13** | `destructive-commands.json` |
| 新建工程 + 用户模板 | **13 / 13** | `new-project-wizard.json` |
| Makefile 项目 Build/Clean/DistClean | **3 / 3** | `makefile-project.json` |
| buildLog 复制 / compileCurrentFile / attachToProcess | **4 / 4** | `misc-commands.json` |
| 无工程单文件编译 + Run 终端 | 3 场景 + 1 Run 场景通过 | `run-flows.json` |
| Profiler（-pg 构建 → 运行 → gprof） | 7 通过；短命程序无采样（命令正确提示） | `profiler-command.json` |
| Open Include File（`<stdio.h>` vs `"util.h"`） | 本地头通过；系统头**未找到**（F-05） | `open-include.json` |
| 语言注释（ld 配置 / GNU ld 解析 / todo.add / header guard） | 7 通过 / 4 失败（F-02/F-03/F-04） | `language-comment-defects.json` |
| 新建工程覆盖已有文件 | **覆盖发生**（F-01） | `new-project-overwrite.json` |
| 用户模板覆盖已有文件 | **覆盖发生**（F-01） | `user-template-overwrite.json` |
| 真实宿主 136 命令 + 构建/运行/保存/布局 | **8 / 8** | `host/results/host-commands.json` |

## 5. 覆盖真实性分析

### 5.1 覆盖矩阵的 100% 是什么

`docs/testing/coverage-matrix.md` 的判定口径是：**契约项 ID 在对应测试层源码中出现即计为命中**（见 `tests/contract/gen-coverage-matrix.js` 文件头）。它能防止“命令/设置漏实现”，但不能证明：

- 命令真的被执行；
- 执行后产生了正确的用户可见效果；
- 设置真的被读取并生效；
- 模块行为与 Code::Blocks 一致。

本轮把判定升级为“行为证据”后，得到：

| 维度 | 审计前 | 审计后 |
|------|--------|--------|
| 命令入口被执行 | 44（约） | **136 / 136** |
| 命令级行为断言 | 44 | **84 / 136** |
| 仅入口、无命令级断言 | 92 | **52 / 136** |

### 5.2 测试脚本质量

- 218 个 `test-*.js`；`npm test` 实际执行 **217**（`test-writer.js` 是手工工具，永久 SKIP）。
- 断言质量分级（审计时）：**119** 行为型、**82** 源码/纯函数断言、**12** 仅打印（其中 **10** 个真正无断言，2 个为 `new Function` 语法检查）。修复轮已将 10 个无断言脚本全部转为断言并补退出码门控。
- **10 个无断言脚本**（审计时始终 exit 0，计入 212 绿灯）：
  - `tests/test-dirs-settings-edit.js`
  - `tests/test-file-edit.js`
  - `tests/test-options-edit.js`
  - `tests/test-relation-extracommands-edit.js`
  - `tests/test-scripts-notes-edit.js`
  - `tests/test-static-prefix.js`
  - `tests/test-target-edit.js`
  - `tests/test-vfolder-sim.js`
  - `tests/test-vfolder.js`
  - `tests/test-virtualtarget-edit.js`
- 上述行为大多被其他断言测试覆盖（`test-project-properties-save`、`test-advanced-fields-edit`、`test-virtual-folders`、`test-build-options-*` 等），因此**不是功能空洞**，但会虚增“212 个测试全部通过”的可信度。修复轮已为这些脚本补断言与退出码门控（见 §12）。
- `tests/run-all.js` 只按退出码判定；本轮扫描未发现“打印 FAIL 但 exit 0”的脚本。

### 5.3 仅有入口证据的 52 条命令

按域分组（完整列表见台账附录）：

| 域 | 数量 | 命令 |
|----|------|------|
| 调试 | 14 | `debug`、`debug.refreshRegisters`、`debug.sendGdbCommand`、`debug.setNextStatement`、`debug.nextInstruction`、`debug.stepIntoInstruction`、`debug.examineMemory`、`debug.detach`、`debug.addSymbolFile`、`debug.infoFrame`、`debug.infoSharedLibrary`、`debug.infoFiles`、`debug.infoFloat`、`debug.infoSignals` |
| 工程 / 工作区生命周期 | 8 | `saveWorkspace`、`saveWorkspaceAs`、`closeWorkspace`、`openDefaultWorkspace`、`newVirtualFolder`、`renameVirtualFolder`、`projectTree.expandAll`、`projectTree.collapseAll` |
| 编辑器工具 | 7 | `codeStats`、`copyStrings`、`todoList`、`tidyComments`、`runTool`、`configureTools`、`showCompilerCommands` |
| 版本 / 分析 | 3 | `autoVersioning`、`bumpVersion`、`generateVersionHeader` |
| 搜索 | 2 | `searchProjectFiles`、`searchInProjectFiles` |
| 构建日志 | 4 | `buildLog.toggleErrorsOnly`、`buildLog.showAllMessages`、`buildLog.clearOutput`、`clearErrors` |
| 其它 | 14 | `analysis.refresh`、`selectTarget`、`detectCompilers`、`checkWorkspacePath`、`excludeBuildOutputs`、`findSymbolInLibraries`、`workspace.editDependencies`、`ui.switchLanguage`、`compileFile`、`nextError`、`prevError`、`toggleCategorize`、`showGlobalVariables`、`keybindings.check` |

说明：

- 多数条目已有**辅助函数/纯逻辑**测试（如 `checkWorkspacePath` 由 `test-workspace-path-guard` 44 断言、`excludeBuildOutputs` 由 `test-watcher-exclude` 34 断言、`autoVersioning` 由 26+19 断言），缺的是“命令入口 → 用户可见效果”的直接断言。
- 真正的高风险缺口是 **14 条调试命令**（尤其 8 条 `info*`/`nextInstruction`/`stepIntoInstruction`/`examineMemory`）：适配器原语有 E2E 覆盖，但命令入口在有活动会话时的行为没有测试。
- 其余为 UI/向导/设置入口，风险较低。

### 5.4 设置测试缺口

6 个设置无测试引用键名：

| 设置 | 风险 | 建议 |
|------|------|------|
| `compiler.flagOverrides` | 内置编译参数覆盖/删除 | 增加 build options 行为测试（修改/删除/重复 option） |
| `compiler.languageFlags` | 仅 C / 仅 C++ 参数 | 增加 C/C++ 编译命令断言 |
| `noProjectCompile.useTaskTerminal` | 无工程编译回退路径 | 已探针验证 Task 路径；补正式测试 |
| `profiler.gprofPath` | 自定义 gprof 路径 | 增加“路径不存在/自定义路径”测试 |
| `profiler.annotatedSource` | `gprof -A` 开关 | 增加开关行为测试 |
| `search.scope` | 工程搜索范围 | 已有纯函数测试，补设置键到命令入口的联动 |

### 5.5 i18n 守卫盲区

现有 `test-i18n-dict.js` 只扫描 `i18n.t()` / `logT()` 调用点，`test-code-conventions.js` 只禁止“已迁移文件中的中文字面量”。二者都**不会拦截**：

- 直接传给 `showInformationMessage` / `showWarningMessage` / `showErrorMessage` 的英文字面量（F-07）；
- 英文按钮标签（F-08）；
- 直接写 `outputChannel.*` 的英文日志（F-09）；
- `PROJECT_TEMPLATES.label` 等数据字段中的英文 UI 字符串（F-10）。

本轮用 AST 扫描补齐了这些检查（证据见 `.cb-tools/audit-0.8.159/risk/precise-scan.json` 与 `scripts/precise-risk-scan.js`）。

### 5.6 宿主 / mock 环境限制

- `vscode.languages.setLanguageConfiguration` 未在 mock 中实现；`editor.asmHashComment=true` 时 mock 激活会抛错（真实宿主 API 存在）。
- `vscode.window.terminals` 在 mock 中不存在；探针已注入空数组验证 Run 终端创建。
- `createQuickPick` 的 `onDidHide` 不触发；`detectCompilers` 在 mock 中只能标记 `ui-pending`。
- 宿主测试模式拒绝模态 DialogService；`openDefaultWorkspace` / `cleanClangdConfig` 的确认框只能标记 `dialog-refused`，属测试环境限制。
- `resetViewLayout` 的日志随 `ui.language` 翻译；探针需同时匹配中英文（本审计已修正）。

## 6. 缺陷清单

> 每条缺陷均给出可复现证据、根因（文件:行）、修复方案与回归测试设计。工作量 S/M/L 为相对量级，不含时间估算。

### F-01（S1）新建工程 / 用户模板静默覆盖已有文件

**状态**：✅ 已修复（0.8.159 修复轮）。`.cbp` 与骨架文件逐项确认，默认保留；回归：`tests/test-project-overwrite-command.js`、`tests/test-user-templates.js`。
**类别**：数据丢失 / 工程创建
**证据**：
- `new-project-overwrite.json`：目标目录 `demo/main.c` 原内容 `ORIGINAL USER CODE` 被模板内容替换，无任何警告；`demo.cbp` 被创建/覆盖。
- `user-template-overwrite.json`：`dstproj/main.c` 原内容 `ORIGINAL DEST` 被模板源 `TPL SOURCE` 替换，无警告。
**根因**：
- `src/extension.ts:3487-3492`：`createNewProject` 直接 `mkdirSync(..., { recursive: true })` 并按模板 `writeFileAtomicSync` 写入骨架，未检查目标文件是否存在。
- `src/project/userTemplates.ts:249-264`：`instantiateUserTemplate` 直接 `copyFileSync` / `writeFileSync`，未检查已存在文件。
- Code::Blocks `codeblocks-src/src/plugins/scriptedwizard/wiz.cpp:777-784` 与 `842-849`：对每个已存在文件弹确认，**默认 No（保留旧文件）**。
**影响**：用户在一个已有同名目录中新建工程（或从模板新建）时，可能无提示丢失 `main.c`、`.cbp` 等文件；属于不可逆数据丢失。
**修复方案**：
1. 写入前收集冲突文件（骨架文件 + `<name>.cbp`）。
2. 有冲突时弹模态确认，逐文件或一次性确认，默认“保留现有文件”；选择保留时跳过该文件并记录。
3. 若 `.cbp` 已存在且用户选择保留，则应取消创建或提示“项目已存在”，避免半覆盖。
4. `instantiateUserTemplate` 复用同一冲突检查。
**回归测试**：`tests/test-newproject-overwrite.js`：已有 `main.c` 时拒绝覆盖 → 内容不变、无 `.cbp` 写入；确认覆盖 → 内容更新；已有 `.cbp` 时提示项目已存在。
**风险 / 工作量**：影响新建向导与模板路径；M。

### F-02（S2）`.ld` 语言行注释配置为 `//`，GNU ld 拒绝

**状态**：⏸ 按用户决定不执行（保留现状）。
**类别**：语言配置 / 编辑器交互
**证据**：
- `language-configurations/ld.json:4`：`"lineComment": "//"`。
- `syntaxes/ld.tmLanguage.json:13-15`：`comment.line.double-slash.ld` 匹配 `//.*$`。
- 真实 GNU ld：`a.ld:4: syntax error`（`// TODO` 行）；`# TODO` 与 `/* TODO */` 均可解析（`language-comment-defects.json`）。
**根因**：把 C 风格 `//` 当作 GNU ld 脚本行注释；GNU ld 只接受 `/* */`（实测 `#` 也被忽略/接受，但官方语义以块注释最稳）。
**影响**：用户在 `.ld` 中按 Ctrl+/ 注释一行，或使用 `Add TODO Item`，会生成无效链接脚本，构建在链接期失败；语法高亮也会把非法 `//` 标成注释，掩盖问题。
**修复方案**：
- `language-configurations/ld.json`：`lineComment` 改为 `#`（实测可解析）或删除 `lineComment` 仅保留 `blockComment`（Ctrl+/ 回退块注释）。
- `syntaxes/ld.tmLanguage.json`：删除 `comment.line.double-slash.ld`，改为 `comment.line.number-sign.ld`（匹配 `#.*$`）。
- 回归测试：读取语言配置断言 `lineComment !== '//'`；用真实 `ld -T` 解析含注释的 `.ld`，断言无 `syntax error`。
**风险 / 工作量**：只影响 `.ld` 编辑体验；S。

### F-03（S2）`codeblocks.todo.add` 固定插入 `//`，不区分语言

**状态**：⏸ 按用户决定不执行（保留现状）。
**类别**：编辑器工具 / 用户可见错误行为
**证据**：
- `src/extension.ts:7097`：`const comment = \`// ${type}...\``。
- 探针：`.ld` / `.xm` 插入 `\n// TODO: note`；`.ld` 中该注释导致 GNU ld `syntax error`；`.xm` 的语言配置行注释是 `#`。
- 静态检查：`addTodoItemCmd` 未读取 `languageId` 或 `editor.asmHashComment`（`language-comment-defects.json` 的“未读取”断言通过）。
**影响**：在链接脚本/配置脚本/原生汇编中执行 Add TODO 会插入错误注释，可能直接破坏构建；即使不破坏，也与文件语言约定不一致。
**修复方案**：
1. 新增 `lineCommentForDocument(doc, cfg)`：
   - `ld` → `#`（或 `/* ... */`，与 F-02 一致）；
   - `xm` → `#`；
   - `asm` → `asmCommentsRule(cfg.editor.asmHashComment).lineComment`（默认 `//`，开启后 `#`）；
   - `bat` → `REM`；
   - 其它 → `//`。
2. 按该 token 生成注释；块注释语言用 `/* TODO: ... */`。
3. 回归测试：`.ld`、`.xm`、`.asm`（开/关设置）、`.c` 四种输入的插入文本。
**风险 / 工作量**：触碰编辑器命令，但逻辑局部；S。

### F-04（S2）`codeblocks.insertHeaderGuard` 可作用于非头文件

**状态**：✅ 已修复。入口仅接受 `.h/.hh/.hpp/.hxx`；回归：`tests/test-command-handlers-editor.js`。
**类别**：编辑器工具 / 文件修改
**证据**：
- 探针：对 `main.c` 执行命令，产生 `#ifndef __MAIN_H__ / #define __MAIN_H__ ... #endif` 的替换编辑（`language-comment-defects.json`）。
- Code::Blocks `codeblocks-src/src/plugins/headerguard/headerguard.cpp:37`：仅 `.h` / `.hpp` / `.hxx` 才处理，其它文件直接 return。
**影响**：用户在 `.c`、`.ld`、`.xm` 等文件误执行命令时，会在文件首尾插入头文件保护，造成无意义修改；对非 C 文件可能生成无效内容。命令在 Edit 菜单/命令面板始终可用，误触概率不低。
**修复方案**：
1. `insertHeaderGuardInActiveEditor` 入口检查扩展名 `/\.(h|hh|hpp|hxx)$/i`；不匹配时提示“Header guard 仅适用于头文件”并返回。
2. 与 `autoInsertHeaderGuards` 的扩展名过滤共用 helper。
3. 回归测试：`.c` 不产生编辑 + 警告；`.h` 产生编辑；`.hpp`/`.hxx` 生效。
**风险 / 工作量**：局部；S。

### F-05（S2）`codeblocks.openIncludeFile` 不搜索编译器系统头 / 工程文件后缀

**状态**：✅ 已修复。尖括号 include 并入编译器系统目录，工程文件按路径后缀匹配；回归：`tests/test-open-include-command.js`、`tests/test-include-resolver.js`。
**类别**：搜索 / Code::Blocks 对齐
**证据**：
- 探针：项目已打开、gcc 已配置，`main.c` 第 1 行 `#include <stdio.h>` → 警告“未找到包含文件: stdio.h（已搜索 0 个目录）”；`#include "util.h"` 正常打开 `util.h`（`open-include.json`）。
- 根因：`src/extension.ts:7052-7071` 只收集项目/目标的 include 目录；`resolveIncludePath` 只查这些目录 + 源文件目录（仅 quoted）。
- Code::Blocks `codeblocks-src/src/plugins/codecompletion/codecompletion.cpp:2086-2110`：先查 parser include dirs（含 `parsemanager.cpp:2322` 加入的 gcc 系统目录），再查源文件目录，最后按后缀扫工程文件。
**影响**：最常见的 `#include <stdio.h>` / `<vector>` 等系统头无法通过命令打开；工程内但不在 include 目录的头文件也无法按后缀命中。功能对常用场景不可用。
**修复方案**：
1. 对 angle-bracket include，加入编译器系统 include 目录：复用 `queryCompilerSystemIncludes`（已用于 clangd 配置）。
2. 加入工程文件后缀搜索（CB 的 `IsSuffixOfPath` 语义）：在 `project.files` 中匹配 `relativeFilename` 后缀。
3. 警告中的“searched N directories”计入系统目录。
4. 回归测试：`<stdio.h>` 打开系统头；`"util.h"` 打开本地头；`#include "sub/inc.h"` 通过工程后缀命中。
**风险 / 工作量**：涉及 include 搜索范围，需避免把编译器系统路径误当工程路径；M。

### F-06（S3）TODO 扫描器只识别 `//` / `/* */`，漏掉 `#` 注释

**状态**：✅ 已修复（仅 F-06；F-02/F-03 按用户决定仍不执行）。扫描器按文件语言识别 `#`、`REM`/`::`，`.asm` 的 `#` 受 `codeblocks.editor.asmHashComment` 控制；回归：`tests/test-todo-scanner-languages.js`。
**类别**：工具 / 语言覆盖
**证据**：
- `src/tools/todoScanner.ts:121-130` `findCommentStart` 只查 `//` 与 `/*`。
- `.xm` 的语言配置行注释是 `#`；`.asm` 开启 `asmHashComment` 后行注释是 `#`；`.ld` 可用 `#` 或 `/* */`。
- 实际影响：这些文件里的 `# TODO` 不会出现在 TODO 列表。
**修复方案**：按文件扩展名/语言选择注释起始符（`#`、`;`、`REM` 等）；或在保持“仅注释”策略的前提下，对 `#` 语言增加识别。回归测试：`.xm # TODO` 命中，`.c #define TODO 1` 不命中（保持 C 预处理语义）。
**风险 / 工作量**：纯逻辑；S。

### F-07（S3）3 处用户可见消息硬编码英文

**状态**：✅ 已修复。消息与中止日志均走 `i18n.t` / `logT`；回归：`tests/test-debug-build-guard.js`、`tests/test-i18n-dict.js`。

| 位置 | 文案 |
|------|------|
| `src/extension.ts:7312` | `The debugger must be stopped to do a (re-)build.\nDo you want to stop the debugger now?`（模态确认） |
| `src/extension.ts:9410` | `You must select a host application to "run" a library...`（Run 错误） |
| `src/extension.ts:9512` | 同上（Debug 派生配置错误） |

**影响**：中文界面下出现英文模态/错误提示，与“运行时文案由 `ui.language` 控制”的文档承诺不一致。
**修复方案**：改用 `i18n.t(...)` 并补 `strings.zh-cn.json` 词条；`test-i18n-dict` 会强制词条存在。
**回归测试**：AST 守卫：`showInformationMessage/showWarningMessage/showErrorMessage` 的第一个字符串实参必须是 `i18n.t(...)`（或明确的专名白名单）。
**工作量**：S。

### F-08（S3）7 处模态按钮标签硬编码英文

**状态**：✅ 已修复。7 处按钮与比较值统一走 `i18n.t`；回归：`tests/test-code-conventions.js` 英文 UI 守卫 + 既有命令测试。

| 位置 | 标签 |
|------|------|
| `src/extension.ts:1228` | `Remove`（removeProject） |
| `src/extension.ts:1516` | `Delete`（deleteVirtualFolder） |
| `src/extension.ts:2155` | `Clear`（bookmarks.clearAll） |
| `src/extension.ts:4137` | `Export`（exportTargetAsProject） |
| `src/extension.ts:5855` | `Remove`（removeFiles） |
| `src/extension.ts:5882` | `Remove`（removeFile） |
| `src/extension.ts:6170` | `Continue`（renameFile 编辑器占用确认） |

**影响**：中文界面的确认框按钮为英文；与其它已翻译按钮（`Clean now`、`Rebuild`、`Overwrite`）不一致。
**修复方案**：`i18n.t` 包装按钮并同步比较值；补词条。`showWarningMessage` 的按钮参数与返回值比较必须使用同一个翻译值。
**回归测试**：AST 守卫：`show*Message` 的字符串按钮实参（除 `{ modal: true }` 等对象外）必须为 `i18n.t` 或白名单（`OK` 等）。
**工作量**：S。

### F-09（S3）9 条构建/运行/清理日志硬编码英文，绕过 `logT`

**状态**：✅ 已修复。9 处日志改走 `logT` 并补词条；回归：`tests/test-banners-and-validity.js`、`tests/test-platform-skip-log.js`、`tests/test-i18n-logT.js`。

| 位置 | 日志 |
|------|------|
| `src/build/buildEngine.ts:833` / `:1744` | `[Code::Blocks] Nothing to be done (all items are up-to-date).` |
| `src/build/buildEngine.ts:1816` / `:1936` | `[Code::Blocks] Linking stage skipped (build target has no object files to link)` |
| `src/extension.ts:7317` | `[Code::Blocks] Aborting (re-)build.` |
| `src/extension.ts:7320` | `[Code::Blocks] Stopping debugger...` |
| `src/extension.ts:7868` | `[Code::Blocks] Target '...' is up to date. Nothing to be done.` |
| `src/extension.ts:8955` | `[Code::Blocks] Make: ${command}` |
| `src/extension.ts:9391` | `Run aborted...` |

**影响**：`codeblocks.log.english=false`（默认）且 `ui.language=zh-cn` 时，这些行仍为英文，与 [i18n.md](../dev/i18n.md) 的“构建日志跟随语言”承诺不一致。
**修复方案**：改用 `logT(...)`；在 `strings.zh-cn.json` 补词条；`log.english=true` 时仍输出英文（`logT` 已有该语义）。
**回归测试**：`test-i18n-logT` 增加这些键；可加静态守卫：`build/**` 与 `extension.ts` 的输出通道日志字符串必须走 `logT`（`plainCbLog` 的 CB 原文行可白名单）。
**工作量**：S。

### F-10（S3）部分 UI 数据字段硬编码英文

**状态**：✅ 已修复。12 个模板 `label` 与 `aliasReplaceInFiles` 均走 `i18n.t`；回归：`tests/test-code-conventions.js` 模板 label 守卫、`tests/test-i18n-dict.js`。
- `src/project/newProject.ts:184-289`：`PROJECT_TEMPLATES` 的 `label` 为英文（`Console application (C++)`、`Static library`、`GLFW application (C)` 等 12 项），而 `description` 已 `i18n.t`；实测中文界面 QuickPick 标签为英文、描述为中文。
- `src/tools/keybindingConfig.ts:57`：`aliasReplaceInFiles` 的 `label: 'Replace in Files'` 未翻译（其它 alias 已翻译）。

**修复方案**：`label: i18n.t(...)`；补词条；`newProject` QuickPick 的 `$(file-code) ${label}` 前缀不变。
**回归测试**：`test-i18n-dict` 增加对 `PROJECT_TEMPLATES[*].label` 和 `MANAGED_KEYBINDINGS[*].label` 的 AST/对象检查；或在 `test-i18n-switch` 中断言中文面板标签。
**工作量**：S。

### F-11（S3）文档计数过期

**状态**：✅ 已修复。README 30→31；usage 中英“三个 WebView”→五个 WebView 面；菜单 168→186；i18n 词条 1157→1537、反查表 193→274、迁移点 1233→1698；契约 `test-doc-consistency` 通过。

| 文档 | 原写法 | 实际（0.8.159 修复后） |
|------|----------|------|
| `README.md:83` / `README.en.md:80` | `keybindings.overrides` **30 项** | `MANAGED_KEYBINDINGS` **31 项**（16 builtin + 3 alias + 12 cbStyle；测试也断言 31） |
| `docs/guide/usage.md:654` / `:986`、`usage.en.md:652` / `:985` | **三个** WebView 面板 | **5** 个 WebView 面（工程属性、构建选项、运行目标、快捷键 + 工程搜索视图） |
| `docs/guide/usage.md:986`、`usage.en.md:985`、`docs/dev/i18n.md:112`、`i18n.en.md:112` | 菜单标签 **168 项** | `walkMenuItems()` **186** 项 |
| `docs/dev/i18n.md:120` / `i18n.en.md:120` | 词条 **1157**、反查表 **193**、迁移点 **1233** | 运行时词条 **1537**、WebView 反查表 **274**、迁移点 **1698** |

**影响**：不影响运行功能，但会误导用户/维护者判断快捷键与 WebView 覆盖范围；属于文档一致性缺陷。
**修复方案**：更新上述计数；在 `test-doc-consistency` 或新增脚本中从 `package.json` / `menuStructure` / `i18n.translationsTable()` 自动派生计数，避免再漂移。
**工作量**：S。

### F-12（S3）测试体系缺口

**状态**：✅ 主要项已实施；6 个设置行为、14 条调试命令活动会话矩阵保留为后续批次（运行目标 WebView 双语已补入 `test-i18n-webview`）。
- 10 个无断言脚本已全部转为断言（`GRANDFATHER_NO_EXIT` 清空），`test-writer-automation` 17/17。
- 新增 `tests/test-command-entry-smoke.js`：112 条非重命令入口执行，0 异常/超时；重命令由 e2e/host 覆盖。
- 新增英文 UI 字面量 AST 守卫（`test-code-conventions`）。
- 新增创建/覆盖安全测试（`test-project-overwrite-command.js`）与工程名边界测试。

1. **10 个无断言脚本**计入 212 绿灯（见 §5.2）；建议转为断言或从 `npm test` 移除并标注为手工脚本。
2. **52 条命令仅有入口证据**；其中 14 条调试命令（尤其 8 条 `info*` / 指令级 / 内存命令）缺“有活动会话”的命令级测试。
3. **6 个设置无测试引用**（见 §5.4）。
4. **i18n 守卫盲区**：只拦中文字面量，不拦英文 UI 字面量（F-07/F-08/F-09/F-10 均未被现有测试发现）。修复轮已补英文 UI 字面量 AST 守卫。
5. `test-i18n-webview` 原覆盖工程属性 / 编译选项 / 快捷键 / 工程搜索 4 个面；修复轮已补**运行目标面板**双语渲染（5 个面）。
**建议**：
- 新增“命令入口执行”CI 层（复用本轮 `command-sweep`/host 套件思路），至少覆盖所有非模态命令。
- 新增“语言注释/注释插入”矩阵测试（c/cpp/ld/xm/asm/bat）。
- 新增“创建/覆盖安全”测试（新建工程、用户模板、新建文件、另存为、导出）。
- 新增“英文 UI 字面量”AST 守卫。
- 将 E2E 调试矩阵扩展到 `nextInstruction`/`stepIntoInstruction`/`examineMemory`/`info*` 命令入口。
**工作量**：M。

### F-13（S3）工程名校验允许 `.` / `..` / 结尾点或空格

**状态**：✅ 已修复。`isValidProjectName` 统一拒绝 `.`/`..`、结尾点/空格、Windows 保留名；回归：`tests/test-user-templates.js`。
**证据**：
- `src/extension.ts` 的 `createNewProject` 名称校验（约 3455 行）只拒绝空值和 `[<>:"/\\|?*\x00-\x1f]`；`..`、`.`、`foo.`、`foo ` 均可通过。
- `src/project/userTemplates.ts:228-232` 的 `isValidProjectName` 同样未拒绝这些值。
**影响**：`name='..'` 会把工程目录解析到父目录（`path.join(basePath, '..')`），`.cbp` 写到父目录；`name='.'` 会写到 base 目录；结尾点/空格在 Windows 上会被静默规范化，可能导致“同名但不同输入”的覆盖。与 F-01 叠加会放大数据丢失风险。
**修复方案**：在 `createNewProject` 与 `isValidProjectName` 共用校验：
- 拒绝 `.` / `..`；
- 拒绝结尾 `.` 或空格；
- 拒绝 Windows 保留名（CON/PRN/AUX/NUL/COM1…LPT9）；
- 拒绝路径分隔符（已有）。
**回归测试**：上述输入均返回校验错误且不写盘。
**工作量**：S。

## 7. 与 Code::Blocks 25.03 对照

### 7.1 对照结论

| 域 | 结论 | 证据 |
|----|------|------|
| 构建链路（命令生成/宏/依赖/增量/clean/respFile/PCH/并行/取消） | **对齐**，未发现缺陷 | E2E 构建矩阵 48、边界 39、性能 13、单测 52+24+等 |
| 工程 XML 读写（未知节点/CDATA/编码/原子写/路径转义） | **对齐**，未发现缺陷 | `test-writer-unknown-nodes`、`test-encoding-lines`、`test-unit-path-xml-escape`、`test-atomic-write` |
| 调试（MI/断点/step/寄存器/内存/反汇编/attach/detach） | **对齐**，命令入口有少量测试缺口 | E2E 调试 141、协议 56、detach/symbol 22 |
| 菜单（9 顶级/186 项） | **对齐 + 有意重命名/不移植** | 0 未注册；CB 130 叶子中 60 精确匹配，其余为重命名/有意缺失 |
| 工具（AStyle/HeaderGuard/Tidy/CopyStrings/Bookmarks/TODO/SymTab） | **2 个缺陷**：HeaderGuard 非头文件、TODO 注释语言；其余对齐 | F-04、F-03、F-06 |
| Open Include File | **缺陷**：未搜系统头/工程后缀 | F-05；CB codecompletion.cpp:2086-2110 |
| 新建工程向导 | **缺陷**：静默覆盖；CB 逐文件确认 | F-01；CB wiz.cpp:777-784/842-849 |
| Makefile 项目 Build/Clean/DistClean | **对齐** | 探针 3/3 |
| AutoVersioning/Profiler | **对齐**（Profiler 受 gprof 采样环境限制） | 单测 26+19 / 22；探针 |
| 工程导入（Dev-C++/VC6/VS2010+） | **对齐** | 单测 34；命令探针 |

### 7.2 有意差异（非缺陷）

- WebView 面板切换语言只刷新标题，正文在下次打开时重渲染（避免丢弃未保存编辑）。
- 属性/构建选项面板勾选后立即写回 `.cbp`（CB 需用户保存）。
- 构建日志中文/Emoji 汇总、脚本编号、最慢 Top3（`plainCbLog` 可关闭）。
- 响应文件阈值 8000（cb 模式可切 32767）；CB 原文 32767/131072。
- 构建前自动保存、VS Code 错误导航 F4/Shift+F4（CB 为 Alt+F1/F2 语义）。
- 未移植：Squirrel、console runner、Print、Class wizard、wxSmith、DoxyBlocks、Valgrind 等（见 backlog/alignment）。

### 7.3 尚未实现（已记录，不计缺陷）

- Squirrel 脚本（警告跳过）。
- console runner（集成终端等价）。
- default.conf 全局设置编辑（只读 + 打开文件手工编辑）。
- Profiler Valgrind/Callgrind（推荐扩展）。
- SymTab 任意目录批量扫描/动态库运行时符号（推荐扩展）。
- WebView CSP/模块拆分（0.8.155 起 5 个面板已 CSP；`extension.ts` 继续按需拆分）。

## 8. 改进建议

### 8.1 测试体系

1. **新增命令入口执行层**：把本轮 `command-sweep` + 宿主套件纳入 CI，至少覆盖所有非模态命令；对 UI 命令记录 `pending` 并允许白名单。
2. **行为覆盖台账**：在 `gen-coverage-matrix.js` 中增加“是否执行命令入口 / 是否有断言”的证据列，不再只用 ID 出现判定。
3. **语言矩阵测试**：对 `.c/.cpp/.h/.ld/.xm/.s/.S/.bat` 的注释切换、TODO 插入、头文件保护、Open Include File 做矩阵断言。
4. **覆盖安全测试**：新建工程/用户模板/新建文件/另存为/导出目标遇到已存在文件时的保留/覆盖分支。
5. **真实宿主系统头测试**：`<stdio.h>` Open Include File 纳入宿主测试。
6. **调试命令入口**：E2E 增加 `nextInstruction`/`stepIntoInstruction`/`examineMemory`/`info*` 的活动会话断言。
7. **设置行为测试**：补齐 §5.4 的 6 个设置。
8. **i18n 字面量守卫**：AST 检查 `show*Message` / 按钮 / 输出通道日志 / 菜单数据字段，禁止未走 `i18n.t`/`logT` 的英文 UI 文案。

### 8.2 CI / 门禁

- 必跑：契约 + 无头 + 打包；E2E 按工具链门控；视觉/性能/宿主每日或手动。
- 新增“审计层”作为 nightly：命令冒烟 + 分域探针 + 覆盖安全；失败阻断发布。
- 对 `TOTAL=212` 类汇总，增加“有断言脚本数 / 仅打印脚本数”输出，避免误读。

### 8.3 架构

- 抽出 `projectCreation` 模块，统一“冲突检查 + 原子写 + 回滚”；向导与用户模板共用。
- 抽出 `commentTokens` 模块，语言 → 行注释/块注释映射；`todo.add`、`tidyComments`、未来编辑命令共用。
- 复用 `queryCompilerSystemIncludes` 到 Open Include File；避免重复探测。
- 把 `PROJECT_TEMPLATES` 的 label/description 都改为 i18n 键，消除数据字段英文。
- 逐步收口 `extension.ts` 的输出通道字面量日志到 `logT`。

### 8.4 文档

- 更新 F-11 的计数；把“30/31”“3/5”“168/186”“1157/1537”“193/274”统一为自动生成或明确“截至版本”的表述。
- 在 `docs/testing/strategy.md` 增加“行为覆盖 vs 契约覆盖”的说明，避免把覆盖矩阵 100% 解读为功能全覆盖。

## 9. 限制与未覆盖项

### 9.1 E5 人工项（本轮未替代）

- 工程树拖拽排序、悬停菜单、原生对话框外观/焦点。
- 真实 VS Code 终端中 Run 的程序执行（本轮只验证终端创建与命令文本）。
- 真实 GDB UI 的寄存器/反汇编/内存面板交互（E2E 验证协议与命令，不验证渲染）。
- WebView 面板的窄宽度布局、拖拽、未保存编辑恢复（视觉层验证像素，不验证交互）。
- Windows 只读目录/UNC/管理共享（部分由 E2E 边界 SKIP 记录）。
- 中文/英文界面的人工视觉走查（i18n 测试覆盖文案，不覆盖截断/换行）。

### 9.2 环境限制

- **AStyle 未安装**：`Format with AStyle` 只验证降级提示；真实格式化未实测。
- **sccache 未安装**：只验证 ccache 路径；sccache 探测/注入未实测。
- **SVN 未安装**：AutoVersioning 的 SVN 字段只验证空值/失败降级。
- **gprof 采样**：短命程序 `no time accumulated`；需要长跑程序才能得到 flat profile 行。
- **只读目录/UNC/管理共享**：按 E2E 既有 SKIP 记录，未在本轮强制构造。
- **VS Code 版本**：真实宿主靶点为 1.85.0（声明最低版本）；1.102.0 缓存存在但本轮未跑完整宿主套件。

### 9.3 方法限制

- Code::Blocks 25.03 对照为**源码语义对照**，未编译运行 CB 本体做差分执行。
- 菜单对照只解析 `main_menu.xrc`；CB 插件动态菜单（compiler/debugger/todo/astyle 等）未逐项并入，已按 alignment/backlog 记录的人工结论核对。
- mock harness 不模拟真实 VS Code 的终端/QuickPick/language configuration 全部行为；相关结论以宿主探针为准。

## 10. 附录与证据

- 逐项台账：[functional-audit-0.8.159-ledger.md](./functional-audit-0.8.159-ledger.md)
  - §A 命令证据（136）
  - §B 设置项（91）
  - §C 快捷键（34）
  - §D 语言/语法
  - §E DAP 能力（30）
  - §F 菜单（9/186/171）
  - §G 文档/NLS
  - §H 测试脚本质量
  - §I 静态风险扫描
  - §J 证据文件索引
- 原始证据目录：`.cb-tools/audit-0.8.159/`
  - `env.json`、`baseline/`
  - `ledger/`（commands/settings/keybindings/languages/dap/menus/docs-claims/tests-quality/final-evidence）
  - `results/`（command-sweep/lifecycle/destructive/wizard/overwrite/language/open-include/makefile/misc/profiler/run-flows）
  - `host/results/`（host-commands.json / host-run.log）
  - `parity/menu-parity.json`
  - `risk/scan.json`、`risk/precise-scan.json`
- 复现命令：
  - `npm.cmd run compile && npm.cmd run bundle && npm.cmd run bundle:search`
  - `npm.cmd run test:contract` / `npm.cmd test` / `npm.cmd run test:e2e` / `test:visual` / `test:perf` / `test:pack` / `test:host`
  - `node .cb-tools/audit-0.8.159/scripts/build-ledger.js`
  - `node .cb-tools/audit-0.8.159/probes/command-sweep.js`
  - `node .cb-tools/audit-0.8.159/host/run-audit.js`

## 11. 修复轮范围与结果

用户决定：**F-02、F-03 暂不执行；F-06 仅修复 TODO 扫描器**，其余按建议实施。

| 编号 | 严重级 | 决定 | 结果 / 回归 |
|------|--------|------|-------------|
| F-01 新建工程覆盖 | S1 | ✅ 修复 | 逐文件确认，默认保留；`test-project-overwrite-command.js`、`test-user-templates.js` |
| F-02 `.ld` 行注释 | S2 | ⏸ 不执行 | 按用户决定保留现状 |
| F-03 TODO 注释语言 | S2 | ⏸ 不执行 | 按用户决定保留现状 |
| F-04 HeaderGuard 非头文件 | S2 | ✅ 修复 | 仅头文件；`test-command-handlers-editor.js` |
| F-05 Open Include File 系统头 | S2 | ✅ 修复 | 系统头 + 工程后缀；`test-open-include-command.js`、`test-include-resolver.js` |
| F-06 TODO `#` 注释 | S3 | ✅ 修复 | 按语言识别 `#` / `REM`/`::`；`test-todo-scanner-languages.js`（F-02/F-03 仍不执行） |
| F-07 … F-10 i18n | S3 | ✅ 修复 | 英文 UI 守卫 + 词条；`test-code-conventions.js`、`test-i18n-dict.js`、`test-debug-build-guard.js` |
| F-11 文档计数 | S3 | ✅ 修复 | 31 键位 / 五 WebView / 186 菜单 / 1537 词条 / 274 反查表 / 1698 迁移点；`test-doc-consistency` |
| F-12 测试体系 | S3 | ✅ 主要项 | 10 脚本转断言、112 命令入口冒烟、英文 UI 守卫；6 设置/运行目标双语/调试活动会话留后续 |
| F-13 项目名校验 | S3 | ✅ 修复 | 拒绝 `.`/`..`/结尾点空格/Windows 保留名；`test-user-templates.js` |

> 修复轮约定：每个缺陷先写失败测试 → 修复 → 单测/契约 → 相关 E2E/宿主 → 全量 7 层；不夹带无关重构。本轮未触碰 F-02/F-03 对应文件；F-06 仅修改 TODO 扫描器与调用参数。

## 12. 修复轮验证记录（0.8.159）

| 层 | 命令 | 结果 |
|----|------|------|
| 编译 / 打包 | `npm run compile`、`npm run bundle`、`npm run bundle:search` | 通过 |
| 契约 | `npm run test:contract` | 3/3（44 + 6 + 725 断言） |
| 单元 | `npm test` | 217 个脚本，FAIL=0，SKIP=1（`test-writer.js` 手工工具） |
| E2E | `npm run test:e2e` | 6/6（含调试矩阵 141 pass、工具链 42 pass / 2 skip） |
| 视觉 | `npm run test:visual` | 26/26 |
| 性能 | `npm run test:perf` | 13/13 |
| 打包 | `npm run test:pack` | 15/15 |
| 真实宿主 | `npm run test:host` | 25/25 |

**新增回归测试**：
- `tests/test-project-overwrite-command.js`（F-01）
- `tests/test-user-templates.js` 扩展（F-01/F-13）
- `tests/test-command-handlers-editor.js` 扩展（F-04）
- `tests/test-open-include-command.js`、`tests/test-include-resolver.js` 扩展（F-05）
- `tests/test-debug-build-guard.js`（F-07）
- `tests/test-code-conventions.js` 英文 UI 守卫（F-07/F-08/F-09/F-10）
- `tests/test-todo-scanner-languages.js`（F-06：`#` / `REM`/`::` / `.S` 预处理守卫）
- `tests/test-command-entry-smoke.js`（F-12）
- `tests/test-i18n-webview.js` 扩展运行目标面板（F-12）
- 10 个原 print-only 脚本全部补断言与退出码（F-12）

## 13. 合并轮验证记录（0.9.0）

`feat/agent-control`（Agent 控制面）于 0.9.0 以 `--no-ff` 合入 main。合并的难点不是文本冲突，而是
**Agent 分支把 `buildOneProject` / `buildCompilerInstance` 抽成无 vscode 依赖模块后，main 在同一批函数里继续修的缺陷会静默回退**。
合并时逐项移植并复核：

| 审计修复 | 合并后落点 | 验证 |
|---|---|---|
| 仅 C / 仅 C++ 参数覆盖（`readLanguageFlags`） | `compilerFactory.languageFlags`（宿主注入） | 契约 + 设置覆盖用例 |
| 编译器缓存键含 `languageFlagsSignature` | `extension.getCompiler` 缓存键 | 单元（编译器缓存） |
| 自动版本号（构建前生成 / 成功后递增） | `buildProject` 的 `prepareBuild` / `finishBuild` 钩子 | 单元（AutoVersioning 26+19） |
| makefile：`silentBuild` / `askRebuildNeeded` / Stop / `reportToUi=false` | `buildProject` makefile 分支 + 统一 `cancel` 源 | E2E 构建矩阵 + 真实 makefile 工程 |
| 不可导航诊断归一化（链接器伪文件 / `.o` / 伪路径） | `buildProject` 摘要过滤 + `extension.onDiagnostic` 回退项目根 | 单元（诊断路径）+ E2E 链接期诊断 9 |
| `Target … up to date` / `Make:` 本地化 | `buildProject` 使用 `logT` 与既有词条 | 契约（英文 UI 守卫） |
| clangd 重启合并 vs 重启判定 | `tools/clangdRestart.ts` 同时导出 coalescer 与 `decideClangdRestart` | 单元 `test-clangd-restart` + `-decision` + `-startup-restore` |

**回归结果（0.9.0）**：契约 3/3（44 + 6 + 745）、无头 **227**（FAIL=0 / SKIP=1）、E2E **7/7**（含 CLI 构建 7）、
视觉 26/26、性能 13/13、打包 16 断言、宿主 **33/33（VS Code 1.102.0）**。详见 [0.9.0 测试报告](./test-report-0.9.0.md)。

**清单变化**：设置 91 → **93**（新增第 10 分区 `codeblocks.agent`），`engines.vscode` 1.85 → **1.102**，
命令 136 / 键位 34 / 视图 6 不变。
