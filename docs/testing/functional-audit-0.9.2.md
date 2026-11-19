# 0.9.2 扩展本体全量逐项功能验证与缺陷分析报告

> 验证版本：**0.9.2**（commit `817f54b`，已安装 VSIX）｜ 审计日期：2026-11-19
> 环境：Windows 11 x64 ｜ Node v24.22.3 ｜ VS Code 1.102.0 ｜ w64devkit GCC 16.2 / GDB 18.1 ｜ Ryzen 7 7840U ×16 ｜ 31.3 GB
> 范围：扩展本体（命令 / 视图 / 设置 / 键位 / 语言语法 / DAP / 菜单 / WebView / 15 个功能域）**+ Agent 控制面**（11 个 LM Tools / MCP / CLI）
> 方法：E0–E4 证据分级（见 §2）；审计阶段**只测不改**，用户确认后按 §12 实施修复（13/13 已完成）。

## 1. 结论摘要

### 1.1 总体结论

- 七层自动化在 0.9.2 上**全绿**：`npm run test:all:host` → **TOTAL=245 / FAIL=0 / SKIP=1**（SKIP 为手工工具 `test-writer.js`）。
- 贡献面逐项均有结论：命令 **136**、设置 **93**、视图 **6**、快捷键 **34**、语言/语法 **3+3**、DAP 能力 **30**、WebView **13 面 × 2 主题 = 26 基线**、LM Tools **11**、MCP provider **1**、CLI **全部子命令**。
- 审计把命令入口冒烟从 **112/136 提升到 120/136**（补齐 6 条面板类、2 条破坏性命令；16 条重命令由 e2e/host 覆盖并纳入新守卫），新增 `test-command-inventory.js` 分区守卫，防止新增命令静默零覆盖。
- 产品核心链路（构建 / 清理 / 运行 / 调试 / 工程读改 / 目标与文件 / 导出 / 工作区）未发现破坏性缺陷；CLI 52 项矩阵中 48 项符合预期，4 项转为缺陷（D-01 / D-02 / D-03 / D-06），导出产物（Makefile、compile_commands.json）内容经 E4 校验正确。
- 发现 **13 项问题：P1 = 0，P2 = 0，P3 = 4，P4 = 9**。P3 全部集中在 Agent 三端的**运行期输入校验**（schema enum 只在 LM Tools 侧由 VS Code 强制）与 `run` 的退出码语义；P4 为次要一致性、文档与测试缺口。
- **Computer Use 在本会话不可启用**（需用户 `/computer on`），E3 真实 GUI 手工项未执行，已在 §9 明确列为待人工确认；本报告所有结论均来自 E0–E2/E4 证据，不含推测。

### 1.2 缺陷统计

| 严重度 | 数量 | 编号 | 状态 |
|---|---|---|---|
| P1（数据丢失 / 安全） | 0 | — | — |
| P2（功能不可用 / 结果错误） | 0 | — | — |
| P3（行为误导 / 契约不一致） | 4 | D-01、D-02、D-03、D-04 | 已修复（§12） |
| P4（次要 / 文档 / 测试缺口） | 9 | D-05…D-13 | 已修复（§12） |

### 1.3 关键数字

| 指标 | 结果 |
|---|---|
| 命令 | 136（入口冒烟执行 120，HEAVY 16） |
| 命令最高证据 | 审计时：E2 宿主 39 ｜ E1 E2E 1 ｜ E1 无头行为 60 ｜ **仅入口/菜单 36**；修复轮后 36 条均已补行为断言（§12） |
| 设置 | 审计时：93（宿主 7 ｜ E2E 12 ｜ 无头行为 68 ｜ **仅静态契约 6**）；修复轮后 6 项均有行为断言（§12） |
| 视图 / 键位 / 语言语法 / DAP | 6 / 34 / 6 / 30，全部有契约 + 行为层证据 |
| WebView | 13 面 × 2 主题 = 26 基线，26/26 通过 |
| Agent | 11 LM Tools；CLI 52 用例矩阵；MCP 握手 + 6 组非法输入探针；宿主 37 用例 |
| 自动化总量 | 审计基线 245 行；修复轮 `npm test` 233 脚本 / 0 失败 / 1 SKIP，契约 3/0 |

### 1.4 修复顺序（已执行）

1. **D-01～D-04（P3）**：统一 Agent 三端运行期校验（`section` / `kind` / `compilerId` / `format`）与 `run` 退出码语义。
2. **D-05～D-09（P4）**：`--help` 退出码、非法数值/未知参数、`workspace` 非法 action、`export --out` 越界写入（设计决策：限制在工程目录内）。
3. **D-10～D-13（P4）**：补 36 条仅入口证据与 6 个设置的直接行为断言；修正文档计数；给 mock 补 `window.terminals` 与 Task API。

执行结果与逐项验证见 §12。

## 2. 方法与证据分级

| 等级 | 手段 | 证明力 | 本轮使用 |
|---|---|---|---|
| **E0** | 静态契约：package.json ↔ src 注册 ↔ 资源 ↔ NLS ↔ 文档 | 只证明“存在/一致” | 契约 44 项 + 设置契约 745 断言 + 文档一致性 6 项 |
| **E1** | 无头行为：dist 层单测、真实工具链 E2E、CLI/MCP 子进程 | 证明行为（无 UI） | 无头 230 脚本；E2E 8 组；CLI 52 用例 + 边界探针；MCP 探针 |
| **E2** | 真实宿主：`@vscode/test-electron` + VS Code 1.102.0 | 证明真实扩展宿主内行为 | 宿主 37 用例（扩展/构建/调试/WebView/工具链/Agent） |
| **E3** | 真实 GUI 实操（Computer Use / 人工） | 证明用户可见交互 | **未执行**（Computer Use 不可用，见 §9） |
| **E4** | 产物/外部校验：ELF/PE、gprof、compile_commands、文件落盘 | 证明结果正确 | 构建产物、Makefile、compile_commands.json、导出保护、文件副作用 |

**覆盖幻觉判定**（与 [0.8.159 审计](./functional-audit-0.8.159.md) 同口径）：

- `coverage-matrix` 的 100% 口径是“契约项 ID 在对应测试层源码中出现”，不代表行为被断言；本报告把它降级为 E0，另行统计行为证据。
- 仅出现在 `test-menu-structure` / `test-keybindings` / `test-keybinding-panel-html` / `test-i18n-webview` / `test-settings-command-links` / `test-project-context-menu` / `tests/visual/**` / `test-install-guide` 中的引用记为**结构/菜单级**，不计行为证据。
- 命令入口冒烟证明“已注册、可执行、无未处理异常/超时”，不证明用户可见效果，单独标注为 `E0-entry`。
- 每条结论均给出证据等级与证据文件；无法验证的项显式标记，不用“代码看起来正确”代替测试。

## 3. 环境与基线

### 3.1 环境

| 项 | 值 |
|---|---|
| 版本 / 提交 | 0.9.2 / `817f54b`（`main` 与 `origin/main` 同步） |
| OS | Windows 11 x64 |
| Node | v24.22.3 |
| VS Code | 1.102.0（`.vscode-test/` 缓存；宿主测试使用临时 user-data 与临时工作区） |
| 工具链 | w64devkit GCC 16.2 / GDB 18.1（PATH）；`.cb-tools/toolchains/` 中 clang 23.1.3、AVR 16.1.0、RISC-V 15.2.0、MSP430 4.6.3、SDCC 4.6.4、TCC 0.9.27 |
| 已安装扩展 | `robinmaomao.codeblocks-vscode@0.9.2`（VSIX 安装） |

### 3.2 七层基线

| 层 | 0.9.2 发版基线 | 本轮审计（含新增用例） |
|---|---|---|
| L-1 契约 | 3/3（44 + 6 + 745） | 3/3（44 + 6 + 745） |
| L0 无头 | 全量 244（FAIL=0 / SKIP=1） | **245 / FAIL=0 / SKIP=1** |
| 无头脚本数 | 229 | **230**（+`test-command-inventory.js`） |
| L1 E2E | 8 组（边界 39/2skip、构建 48、ccache 21、CLI 构建 7、CLI 调试 8、调试 141/1skip、链接诊断 9、工具链 42/2skip） | 同左，全部通过 |
| L3 视觉 | 26/26 | 26/26 |
| L4 性能 | 13/13，0 warn | 13/13，0 warn |
| L5 打包 | 16 断言 | 16 断言 |
| L2 宿主 | 37/37 | 37/37 |

> 说明：`TOTAL` 是统一运行器的“执行行数”（脚本/层），不是断言数；断言数见各层输出（契约 795 条、设置契约 745、宿主 37 用例等）。

### 3.3 审计新增 / 扩展用例

| 文件 | 变更 | 断言 |
|---|---|---|
| `tests/test-command-entry-smoke.js` | 执行集合 112 → **120**：面板类（keybindings.panel / projectProperties / compilerOptions / keybindings.apply / reset / debug.attachToProcess）与破坏性命令（closeProject / removeProject）纳入；HEAVY 16 条保持排除并注释说明由 e2e/host 覆盖 | 120 pass |
| `tests/test-command-inventory.js`（新） | 命令分区守卫：HEAVY 可解析且都属于贡献命令、无重复；执行集合 + HEAVY == 136；每条 HEAVY 至少被一个非契约测试引用 | 6 pass |

## 4. 逐项验证结果

### 4.1 命令（136）

**证据分布**：E2 宿主 **39** ｜ E1 E2E **1** ｜ E1 无头行为 **60** ｜ E0 仅入口/菜单 **36**。

**入口执行**：`test-command-entry-smoke` 在可激活 mock 宿主逐条调用 **120/136**，0 失败；HEAVY 16 条由下列真实链路覆盖：

| 重命令 | 覆盖来源 |
|---|---|
| `build` / `clean` / `rebuild` | E2E 构建矩阵 S1–S9（48 断言）、宿主 build.tests.js |
| `buildWorkspace` / `cleanWorkspace` / `rebuildWorkspace` / `run` / `restartClangd` / `detectCompilers` | 宿主 extension.tests.js（15 用例）；CLI 构建/调试 E2E |
| `buildAndRun` / `profileTarget` | 键位/菜单结构 + profiler 命令测试；CLI `run` 矩阵 |
| `distClean` / `installCompilerCache` / `findSymbolInLibraries` / `workspaceScanReport` / `generateCompileCommands` | workspace 生命周期、install guide、symtab、工程扫描、compile_commands E2E |

**仅入口/菜单级证据（36 条，需补行为断言）**：

| 域 | 命令 |
|---|---|
| 调试会话（8） | `debug.sendGdbCommand`、`debug.nextInstruction`、`debug.stepIntoInstruction`、`debug.examineMemory`、`debug.attachToProcess`、`debug.infoSharedLibrary`、`debug.infoFloat`、`debug.infoSignals` |
| 工程/文件编辑（7） | `newProjectFromTemplate`、`newBuildTarget`、`newFile`、`saveProjectAsTemplate`、`removeFiles`、`importProject`、`saveProjectAs` |
| 工程/工作区生命周期（8） | `saveProject`、`closeProject`、`projectTree.expandAll`、`projectTree.collapseAll`、`activatePriorProject`、`activateNextProject`、`clearRecentProjects`、`projectNotes` |
| 编辑器工具（7） | `copyStrings`、`tidyComments`、`swapHeaderSource`、`exportMakefile`、`runTool`、`configureTools`、`openDefaultConfig` |
| 构建日志/杂项（6） | `buildLog.copyMessage`、`buildLog.copyDiagnostic`、`installCompilerCache`、`buildAndRun`、`findSymbolInLibraries`、`workspace.editDependencies` |

> 对比 0.8.159 审计的 52 条仅入口命令，本轮降至 **36**；剩余高风险集中在 8 条调试会话命令（适配器原语已被 E2E 141 断言覆盖，但“命令入口 + 活动会话”的组合缺少直接断言）。

### 4.2 视图（6）

| 视图 ID | 契约 | 无头 | 宿主 | 结论 |
|---|---|---|---|---|
| `codeblocks.projectTree` | ✔ | ✔ | ✔ | PASS（注册、可见性、聚焦命令由宿主 extension.tests.js 覆盖） |
| `codeblocks.search` | ✔ | ✔ | · | PASS（注册/可见性由契约与单元断言覆盖；WebView 面纳入 26 视觉基线） |
| `codeblocks.symbols` | ✔ | ✔ | ✔ | PASS（注册、可见性、聚焦命令由宿主 extension.tests.js 覆盖） |
| `codeblocks.analysis` | ✔ | ✔ | ✔ | PASS（注册、可见性、聚焦命令由宿主 extension.tests.js 覆盖） |
| `codeblocks.buildLog` | ✔ | ✔ | ✔ | PASS（注册、可见性、聚焦命令由宿主 extension.tests.js 覆盖） |
| `codeblocks.debug.registers` | ✔ | ✔ | ✔ | PASS（注册、可见性、聚焦命令由宿主 extension.tests.js 覆盖） |

### 4.3 设置（93）

| 证据 | 数量 | 含义 |
|---|---|---|
| E2 宿主 | 7 | 真实宿主内读写/生效 |
| E1 E2E | 12 | 真实工具链/进程链路读取 |
| E1 无头 | 68 | 无头行为断言引用键名 |
| **E0 契约** | **6** | 仅默认值/类型/enum/文档校验 |

**仅静态契约的 6 个设置**（实现存在，但无直接行为断言）：

| 设置 | 类型 | 默认值 | 实现位置 | 建议用例 |
|---|---|---|---|---|
| `codeblocks.compiler.customFlags` | object | `{}` | `src/compiler/compilerFlagSettings.ts`（常量 `compiler.customFlags`） | 新增参数 → 编译命令行包含 |
| `codeblocks.compiler.flagOverrides` | object | `{}` | `src/compiler/compilerFlagSettings.ts`（modified/removed） | 覆盖/删除内置参数 → 命令行变化 |
| `codeblocks.noProjectCompile.useTaskTerminal` | boolean | `false` | `src/extension.ts:9516` | 无工程编译走 Task 终端 vs 自管进程 |
| `codeblocks.profiler.gprofPath` | string | `""` | `src/features/profilerCommands.ts:112` | 自定义路径 / 路径不存在提示 |
| `codeblocks.profiler.annotatedSource` | boolean | `true` | `src/features/profilerCommands.ts:139` | 开关 `gprof -A` 注解输出 |
| `codeblocks.search.scope` | string | `openProjects` | `src/ui/projectSearchView.ts:415` | 设置默认值 → 视图初始范围 |

> 前两项的键名通过常量间接引用（`compilerFlagSettings.ts:18-20`），覆盖矩阵按字面量统计时会漏记；后四项在 src 中直接出现但测试未引用。两者都不是“未实现”，属测试缺口（D-11）。

### 4.4 快捷键（34）

契约 3 项、无头 32、E2E 2、视觉 4、性能 2、宿主 12 — 全部 34 条有绑定目标且目标命令存在；`keybindings.panel` 的写回由宿主 webview 用例覆盖。结论：**PASS**（键位映射/悬停描述由 `test-keybindings.js` 断言；运行时冲突检测由 VS Code 负责，不在本轮范围）。

### 4.5 语言 / 语法（3 + 3）

| 语言 ID | 语法 scope | 证据 | 结论 |
|---|---|---|---|
| `c` | `source.c` | 契约 + `test-grammar-smoke` + 宿主语言关联 | PASS |
| `cpp` | `source.cpp` | 契约 + `test-grammar-smoke` + 宿主 | PASS |
| `ld` | `source.disasm`（链接脚本/反汇编） | 契约 + 语法冒烟 | PASS（F-02 `.ld` 行注释为已知保留项） |
| 3 个 grammar（c/cpp/ld） | — | `test-contract` D1–D6 + `test-grammar-smoke` | PASS |

### 4.6 DAP 能力（30）

| 证据层 | 数量 | 说明 |
|---|---|---|
| E2E | 30/30 | `test-e2e-debug.js` 141 断言 / 1 skip：断点、条件断点、单步、栈、作用域、变量（含结构体/数组/深层）、evaluate、setVariable、线程、内存、寄存器、stopOnEntry、异常断点等 |
| 宿主 | 5/30 标记 | 真实会话 F5 → 断点 → 单步 → 变量 → 内存 → 停止（debug.tests.js） |
| CLI | 8 断言 | 真实 gdb：`debug run` 断点/栈/变量/退出码（test-e2e-cli-debug.js） |

结论：**PASS**。说明：`debug.info*`、`nextInstruction`、`examineMemory` 等命令入口在活动会话下的组合仍属 D-10 缺口。

### 4.7 菜单

| 菜单贡献 | 条目 | 校验 |
|---|---|---|
| `codeblocks.projectTree.menu` | 2 | 契约 B5/B6 + 宿主工程树右键 |
| `commandPalette` | 1 | 契约 + 命令可达性 |
| `view/title` | 27 | 契约 + 宿主视图标题 |
| `view/item/context` | 48 | 契约 + 宿主树节点 |
| 状态栏 Menu（运行时 9 大顶级菜单） | 9 | 宿主 extension.tests.js（菜单结构/命令 ID 存在性） |

### 4.8 WebView（13 面 × 2 主题）

面清单：`build-options`、`buildlog-html`、`keybindings`、`props-debugger`、`props-file-advanced`、`props-file-build`、`props-file-general`、`props-notes`、`props-parser`、`props-scripts`、`props-settings`、`props-targets`、`run-targets`。
视觉 26/26 通过（dark/light），HTML 语法 + 内联脚本可执行 + i18n 反查 + 面板消息往返由 `test-webview-panels` / `test-i18n-webview` / 宿主 `webview.tests.js` 覆盖。结论：**PASS**。

### 4.9 Agent 控制面

**11 个 LM Tools**：schema ↔ handler 逐字一致（`test-ai-tools-contract` 44 断言）；宿主注册与调用（`agent.tests.js` 12 用例）；只读/禁用/未信任门控（`test-agent-policy` 36 断言）。

**CLI 矩阵（52 用例）**：

| 组 | 用例数 | 结果 |
|---|---|---|
| usage / schema | 4 | `--help` 无命令 exit 2（D-06）；其余符合 |
| project read | 8 | 未知 section 静默返回 `{cbp}`（D-01）；未知 target 正确 `invalid-input` |
| project edit | 6 | 正常/非法 JSON/未知字段正确；非法 `--format` 被接受（D-05） |
| file / target ops | 12 | 增删改、重名、未知目标全部符合 |
| build | 5 | 构建/增量/清理/平台与目标守卫、`no-build` 符合 |
| run | 2 | 正常路径通过；程序非零退出 → CLI exit 4 且无 `error.code`（D-04） |
| export | 5 | Makefile/compile_commands/commands 内容正确、默认 `Makefile.cb` 保护；非法 kind 静默导出 commands（D-02） |
| compiler | 3 | `info` 未知 id 编造结果（D-03） |
| workspace | 4 | info/list/deps 正常；未知 action 落入 deps 分支（D-08） |
| debug（错误路径） | 3 | not-running / invalid-input 符合 |

**MCP 探针**：握手 + `tools/list` 11 工具 + annotations/cwd 正常；非法 `section` / `kind` / `format` / `compilerId` 与 CLI 同样静默回退（证明确为工具层校验缺口，而非 CLI 解析问题）；`timeoutMs:"abc"` 被静默丢弃。

**三端一致性**：debug 响应归一化（`test-debug-shapes` 15 断言）与 `build_status`/`run`/`export` 形状一致；`no-build`、`unsupported`、`compiler-missing` 错误码三端一致。

### 4.10 功能域证据映射

| 功能域 | 相关测试文件 | 无头 | E2E | 宿主 | 代表用例 |
|---|---|---|---|---|---|
| 激活 / 语言 / 语法 | 4 | 2 | 0 | 1 | tests/contract/test-contract.js<br>tests/host/suite/extension.tests.js<br>tests/test-grammar-smoke.js<br>tests/test-i18n-webview.js |
| 工程生命周期 / 工作区 | 11 | 10 | 0 | 1 | tests/host/suite/extension.tests.js<br>tests/test-project-context-menu.js<br>tests/test-project-detect-scan.js<br>tests/test-project-manager-feature.js |
| 目标 / 文件 / 虚拟文件夹 | 17 | 17 | 0 | 0 | tests/test-advanced-fields-edit.js<br>tests/test-dirs-settings-edit.js<br>tests/test-file-edit.js<br>tests/test-file-properties-focus.js |
| 构建 / 清理 / 诊断 | 22 | 16 | 4 | 2 | tests/e2e/test-e2e-boundary.js<br>tests/e2e/test-e2e-build.js<br>tests/e2e/test-e2e-ccache.js<br>tests/e2e/test-e2e-linker-diagnostic.js |
| 运行 | 6 | 4 | 1 | 1 | tests/e2e/test-e2e-cli-build.js<br>tests/host/suite/extension.tests.js<br>tests/test-api-run-plan.js<br>tests/test-run-invalid-compiler.js |
| 调试 | 13 | 10 | 2 | 1 | tests/e2e/test-e2e-cli-debug.js<br>tests/e2e/test-e2e-debug.js<br>tests/host/suite/debug.tests.js<br>tests/test-debug-build-guard.js |
| Build options / Properties 面板 | 11 | 6 | 0 | 0 | tests/test-build-options-enable-rules.js<br>tests/test-build-options-interactions.js<br>tests/test-compiler-options-apply.js<br>tests/test-keybinding-panel-html.js |
| 编译器 / 工具链 | 17 | 15 | 1 | 1 | tests/e2e/test-e2e-toolchains.js<br>tests/host/suite/toolchain.tests.js<br>tests/test-asm-compiler-var.js<br>tests/test-avr-compiler.js |
| clangd | 9 | 9 | 0 | 0 | tests/test-clangd-commands.js<br>tests/test-clangd-compile-flags.js<br>tests/test-clangd-config.js<br>tests/test-clangd-detect-cache.js |
| 工程搜索 | 7 | 7 | 0 | 0 | tests/test-project-search-commands.js<br>tests/test-project-search-tasks.js<br>tests/test-project-search-view-html.js<br>tests/test-project-search-view-provider.js |
| 工具类（Profiler/SymTab/TODO/AV/复制/整理） | 13 | 13 | 0 | 0 | tests/test-autoversioning-commands.js<br>tests/test-autoversioning.js<br>tests/test-backticks-and-owner.js<br>tests/test-copy-strings.js |
| 导出（Makefile / compile_commands） | 4 | 3 | 1 | 0 | tests/e2e/test-e2e-cli-build.js<br>tests/test-cli.js<br>tests/test-makefile-export.js<br>tests/test-workspace-serializer.js |
| i18n | 8 | 8 | 0 | 0 | tests/test-code-conventions.js<br>tests/test-i18n-dict.js<br>tests/test-i18n-logT.js<br>tests/test-i18n-nls.js |
| 工作区信任 / Agent 门控 | 5 | 4 | 0 | 1 | tests/host/suite/agent.tests.js<br>tests/test-agent-policy.js<br>tests/test-ai-tools-contract.js<br>tests/test-api-settings-reader.js |
| 安装 / 升级 / 迁移 | 4 | 3 | 0 | 0 | tests/pack/test-pack.js<br>tests/test-bundle-packaging.js<br>tests/test-install-guide.js<br>tests/test-settings-migration.js |

> 统计口径：按文件名/路径正则匹配 `tests/**/*.js`，同一文件可计入多个域；仅用于定位证据，不作为覆盖率高低的唯一依据。

> 补充：Build options / Properties 面板的宿主证据在 `tests/host/suite/webview.tests.js`（5 用例，含 9 个 tab 的创建/单例/关闭重开）；上表按文件名匹配未计入 host 列。

## 5. 覆盖真实性分析

### 5.1 覆盖矩阵的 100% 是什么

矩阵判定“契约项 ID 在某层测试源码中出现即命中”。它能发现“漏实现/漏注册”，不能证明：命令真的被执行、执行后用户可见效果正确、设置真的生效、行为与 Code::Blocks 一致。本报告把矩阵命中降级为 E0，另行统计行为证据（§2）。

### 5.2 仅入口/菜单级证据的命令：36 / 136（审计时）

> §12 修复轮已为全部 36 条补行为断言；本节的分类是**审计时快照**，附录 A 的 ⚠ 标记同样保留审计时状态。

较 0.8.159 审计的 52 条下降 16 条（入口冒烟补齐 + 分域测试增加）。剩余 36 条中：

- **高风险 8 条**：`debug.sendGdbCommand`、`nextInstruction`、`stepIntoInstruction`、`examineMemory`、`attachToProcess`、`infoSharedLibrary`、`infoFloat`、`infoSignals` —— 需要“真实会话 + 命令入口”的宿主测试；当前只有适配器原语 E2E。
- **中风险 7 条**：`newBuildTarget`、`newFile`、`removeFiles`、`importProject`、`saveProjectAs`、`newProjectFromTemplate`、`saveProjectAsTemplate` —— 对话框驱动，需脚本化 QuickPick/InputBox/文件对话框。
- **低风险 21 条**：保存/关闭/最近工程/树展开折叠/编辑器工具/构建日志复制等，行为大多由非命令入口的辅助函数测试覆盖。

### 5.3 设置的 6 个静态契约缺口

见 §4.3。`compiler.customFlags` / `flagOverrides` 的键名经常量引用，矩阵统计会漏记；其余 4 项在 src 中直接引用但测试未断言。

### 5.4 CLI/MCP 运行期校验缺口（本轮 P3 的根因）

LM Tools 的 inputSchema 带 `enum`，VS Code 会在 LM 侧拒绝非法值；但 CLI 与 MCP 直接把原始参数交给 `invokeTool`，而 handler 内部大多用 `as` 强转（`section` / `kind` / `format` / `action`），没有统一的运行期校验。结果：同一非法输入在 LM 侧报错、在 CLI/MCP 侧静默回退。R9 已为 `targets` / `weight` / `title` 等字段补过运行期校验，但 `section` / `kind` / `format` / `action` / `compilerId` / 数值参数仍未覆盖。

### 5.5 测试环境限制

- ~~mock 宿主缺失 `vscode.window.terminals`~~：审计时 `src/ui/runTerminal.ts:45` 读取该数组，探针需手动注入 `[]`；§12 已为 mock 补齐 `terminals` / `createTerminal` / Task API（D-13）。
- `detectCompilers` 在 mock 中依赖 UI 交互（`ui-pending`），入口冒烟以超时豁免；宿主测试覆盖真实检测。
- 宿主测试模式下模态 DialogService 被拒绝，部分确认框只能走“取消”分支。
- 视觉基线绑定当前渲染指纹；跨环境自动降级为容差判定（≤2%），不存在静默放宽。

### 5.6 E3 真实 GUI 未执行

Computer Use 在本会话不可启用（工具返回：需要用户 `/computer on`）。`docs/testing/manual-acceptance.md` 的 9 节原生 UI 项（拖拽、悬停、原生对话框、菜单点击、截图）本轮**未执行**，见 §9。

## 6. 缺陷清单

> 下列条目保留审计时的现象/根因；**修复状态与验证见 §12**（D-01…D-13 全部已修复）。

### D-01（P3）非法 `section` 静默返回空结果

- **现象**：`cb-cli show <cbp> --section nope --json` 与 MCP `codeblocks_project_read { section: "nope" }` 均 exit 0，输出只有 `{ cbp }`。
- **期望**：`invalid-input`，并列出 `summary|targets|files|options|schema|all`。
- **实际**：`projectSnapshot` 的 `want(section)` 对未知值全为 false，静默返回空壳。
- **影响**：Agent/脚本误以为已取得请求的分片（空数据而非报错），可能据此做出错误判断。
- **根因**：`src/api/toolRegistry.ts:134-148` 强转 `QuerySection` 无校验；`src/api/projectQuery.ts:80-84` 无 default 分支。
- **建议**：在 `projectRead` handler 开头按枚举校验（与 LM schema 共用常量），非法值 `invalid-input`。

### D-02（P3）非法 `kind` 静默导出 commands

- **现象**：`cb-cli export <cbp> --kind nope`（及大写 `Makefile`）exit 0，返回 `kind:"commands"`、`files:[]`；MCP 同样。
- **期望**：`invalid-input`（kind ∈ makefile|compile_commands|commands）。
- **实际**：`exportProject` 用 `if makefile … else if compile_commands … else commands`，未知值落入 commands。
- **影响**：脚本以为已生成 Makefile/compile_commands，实际只拿到命令文本，且 `files` 为空可能被忽略。
- **根因**：`src/api/exportService.ts:49,82` 的 else 兜底；`toolRegistry.ts:554` 的 enum 只在 schema 侧。
- **建议**：`switch (kind)` + `default: fail('invalid-input', …, { allowed })`；CLI/MCP 与 LM 行为一致。

### D-03（P3）`compiler info` 对未知 id 编造结果

- **现象**：`compiler info --compiler-id nope`（含空字符串）exit 0，返回 `{ compilerId:"nope", name:"nope", programs:{…gcc…}, versionString:"16.2.0" }`；MCP 同样。
- **期望**：`invalid-input` 并列出已注册编译器（与 `build --target` 未知目标的处理一致）。
- **实际**：`getCompiler(id)` 未做注册校验，`buildCompilerInstance` 以配置的 masterPath 合成实例，name 取 id。
- **影响**：Agent/用户无法发现拼写错误，误判“编译器存在且版本正常”。
- **根因**：`src/api/toolRegistry.ts:526-538`；`src/api/compilerService.ts:49-67`（`resolveTargetCompiler` 有注册校验，`getCompiler` 没有）。
- **建议**：`info` 先 `findRegisteredCompilerId`/`codeBlocksConfig.find` 校验；未知 → `invalid-input` + 可用列表。

### D-04（P3）`run` 非零退出被改写为 CLI exit 4 且无错误码

- **现象**：程序 `return 3`：`cb-cli run … --json` 进程 exit **4**，结果为 `{ ok:false, exitCode:3, stdout, stderr }`，无 `error.code`；plain 模式同样 exit 4。
- **期望**：保留程序退出码（或明确 `run-failed` + `error.code` + `programExitCode`），并文档化。
- **实际**：`cb-cli.ts:333-335` 只按 `result.ok === false` 统一 exit 4；`runService` 把非零退出视为 `ok:false`。
- **影响**：CI/脚本无法区分“程序返回 3”与“工具链失败/超时/不支持（同为 4）”；结果缺 `error.code` 违反错误契约。
- **根因**：`src/cli/cb-cli.ts:333-335`；`src/api/runService.ts` 的 run 结果语义；`docs/guide/agent-control.md` 退出码表未覆盖“程序非零退出”。
- **建议**：CLI 对 `run` 特判：`process.exit(result.exitCode)`（超时/失败仍走错误码），或在结果中加 `error.code="run-failed"` 并映射到独立退出码；补文档与 `test-cli` 断言。

### D-05（P4）非法 `format` 被接受并原样回显

- **现象**：`edit --format nope` → exit 0，结果 `format:"nope"`；写入实际按 canonical 执行（dryRun 时也回显 `format:"nope"`）。MCP 同样。
- **期望**：`invalid-input`（format ∈ canonical|preserve）。
- **实际**：`opts.format === "preserve" ? "preserve" : "canonical"` 静默兜底，但结果回显原值。
- **影响**：调用方以为使用了 preserve，实际 canonical 重写（可能改变 XML 格式）。
- **根因**：`src/api/projectService.ts:33,75`；`src/api/toolRegistry.ts:177-215`。
- **建议**：统一枚举校验；结果回显实际使用的 format。

### D-06（P4）`--help` / `-h` 单独调用退出码为 2

- **现象**：`cb-cli --help`、`cb-cli -h` 打印 USAGE 后 exit 2；带命令（`show x --help`）exit 0。
- **期望**：帮助属于成功路径，exit 0。
- **实际**：`process.exit(parsed.command ? 0 : 2)`。
- **影响**：脚本/包装器把帮助调用判为失败。
- **根因**：`src/cli/cb-cli.ts:171-174`。
- **建议**：有 `--help/-h` 时始终 exit 0；无命令且无 help 才 exit 2。

### D-07（P4）非法数值 / 未知参数被静默忽略

- **现象**：`build --timeout abc`、`show --frobnicate`、`build --target ""`、`--section Summary` 均不报错（按缺省处理），MCP `timeoutMs:"abc"` 被丢弃；未知 flag 不产生 usage 错误。
- **期望**：非法值 → `invalid-input`/`usage`；未知参数 → usage 错误。
- **实际**：`flagNumber` 返回 NaN/undefined；`typeof input.timeoutMs === "number"` 丢弃非数字；未知 flag 被忽略。
- **影响**：拼写错误导致“超时/目标/分片”静默失效，长构建可能无限运行。
- **根因**：`src/cli/cb-cli.ts:74` 及 `flagNumber`；`src/api/toolRegistry.ts:336,401,447`。
- **建议**：数值参数严格解析（非有限数/负数报错）；未知 flag 报 usage；`timeoutMs` 非 number 报 `invalid-input`。

### D-08（P4）`workspace` 非法 action 落入 deps 分支

- **现象**：`workspace frob --workspace x.workspace --json` → `invalid-input: A project path is required for deps`。
- **期望**：`invalid-input: Unknown action`，列出 info|list|deps|open|close|setActive。
- **实际**：`if action === list/open/close/setActive/info` 之后直接进入 deps 分支，无 default。
- **影响**：错误信息误导（用户以为缺 project 参数，实际是 action 拼错）。
- **根因**：`src/api/toolRegistry.ts:586-603`。
- **建议**：switch + default `invalid-input`。

### D-09（P4）`export --out` 可写出工程/工作区目录

- **现象**：`export --out ..\outside.mk` 与绝对路径均成功写出（exit 0）；无越界提示。
- **期望**：至少文档化；若面向 Agent，建议限制为工程目录内或显式确认。
- **实际**：`path.resolve(project.basePath, out)`，无包含性检查。
- **影响**：Agent/MCP 可在工作区外写文件（用户显式给 out 时才发生）；自动化可能误写。
- **根因**：`src/api/exportService.ts:54` 及 `out` 解析。
- **建议**：产品决策：保持现状 + 文档声明“out 可指向任意可写路径”，或限制根目录并提示。

### D-10（P4）36 条命令仅有入口/菜单级证据

- **现象**：§4.1 列表；其中 8 条调试会话命令、7 条对话框驱动工程/文件命令无用户可见效果断言。
- **影响**：命令参数拼装/状态更新错误无法被现有测试发现（入口可执行 ≠ 功能正确）。
- **根因**：历史测试布局偏重辅助函数与 DAP 原语；宿主会话测试只覆盖 1 条调试链路。
- **修复（§12）**：新增 `tests/test-debug-command-behavior.js`（8 条调试命令驱动真实处理器 + 假适配器）与 `tests/test-command-handlers-misc.js`（28 条工程/文件/工具/树/最近工程命令，含向导、导入、导出、移除文件）；36 条全部脱离“仅入口”，重路径（真实构建/符号扫描）保留 e2e/host 覆盖。

### D-11（P4）6 个设置仅有静态契约证据

- **现象**：§4.3 列表：compiler.customFlags / flagOverrides / noProjectCompile.useTaskTerminal / profiler.gprofPath / profiler.annotatedSource / search.scope。
- **影响**：设置值拼写/读取作用域错误不会被发现；矩阵仍显示 100%。
- **根因**：前两项键名经常量间接引用（`compilerFlagSettings.ts:18-20`），后四项缺少直接行为用例。
- **建议**：为每项加 1 条行为断言（编译命令包含自定义参数、覆盖/删除生效、gprof 路径、注解开关、搜索默认范围、Task 终端回退）。

### D-12（P4）测试文档计数过期

- **现象**：`docs/testing/strategy.md:14` 仍写“12 个 WebView 面 × 2 主题 = 24 基线”，实际 **13 面 / 26 基线**（`props-parser`、`run-targets` 等）；L0 描述“135+ 项”，实际无头脚本 **230**。
- **影响**：读者低估测试规模，审计/交接时被误导。
- **根因**：新增视觉面与脚本后未同步文档。
- **建议**：改为 13 面 / 26 基线、230 脚本；可加契约断言防漂移（如校验 baselines 数量）。

### D-13（P4）mock 宿主缺少 `window.terminals`

- **现象**：在 mock 中调用 `run`/`buildAndRun` 抛 `api.existing is not a function or its return value is not iterable`，除非先 `app.vscode.window.terminals = []`（入口冒烟已手动注入）。
- **影响**：后续测试容易把环境缺陷误判为产品缺陷；探针需额外样板。
- **根因**：`tests/_harness/vscodeMock.js` 未提供 `terminals`；`src/ui/runTerminal.ts:45` 直接读取。
- **建议**：在 mock 中提供 `terminals: []` 与 `createTerminal` 记录数组（可断言同名终端回收）。

## 7. 与 Code::Blocks 对照

本轮未发现新的“假实现/静默跳过”类对齐问题：构建/清理/运行/调试/工程编辑的语义与 0.9.0 合并后一致，`Makefile.cb` 默认输出、`cwd` 工程目录锚点、平台守卫均按设计工作。历史有意差异（F-02 `.ld` 行注释、F-03 TODO 注释语言口径扩展）保持不变，不计入本轮缺陷。深度 CB 语义对照（对话框逐项）需 E3 GUI，见 §9。

## 8. 改进建议

### 8.1 Agent 三端统一运行期校验（对应 D-01/02/03/05/08）

- 在 `src/api/toolRegistry.ts` 增加 `requireEnum(value, allowed, field)` / `requireFiniteNumber` 小工具，handler 入口统一调用；错误统一 `invalid-input` + `details.allowed`。
- 让 LM schema 的 enum 与 handler 校验共用同一常量，避免两处漂移；`test-ai-tools-contract` 增加“非法值在三端都报错”的断言。

### 8.2 CLI 契约（D-04/06/07）

- `run` 保留程序退出码（推荐），超时/启动失败仍用工具错误码；补 `docs/guide/agent-control.md` 退出码表与 `test-cli` 用例。
- `--help` 始终 0；未知 flag/非法数值 → `usage`；数值参数严格解析。

### 8.3 测试体系（D-10/11/13）

- 先补 8 条调试会话命令（复用宿主真实会话），再补工程/文件对话框命令（脚本化 QuickInput）。
- 为 6 个设置各加 1 条行为断言；把 `compilerFlagSettings` 的常量键名纳入覆盖矩阵的键名映射。
- mock 补 `terminals`，并记录 `createTerminal` 调用，供“同名终端回收”断言。

### 8.4 文档与 CI（D-12）

- 更新 strategy.md 计数；新增“入口冒烟执行率 + 仅入口命令数”作为 CI 摘要指标（本次审计已产出脚本可复用）。
- 在 CI 中把 `test-command-inventory.js` 作为必跑（当前已自动纳入 `npm test`）。

## 9. 限制与未覆盖项

| 项 | 状态 | 说明 |
|---|---|---|
| E3 真实 GUI（9 节手工清单） | **未执行** | Computer Use 不可用（需 `/computer on`）；涉及拖拽排序、悬停菜单、原生对话框、截图留档 |
| 跨平台 | 未覆盖 | 仅 Windows 11 x64；Linux/macOS 路径与终端差异未验证 |
| 多根工作区 | 部分 | 宿主测试为单根临时工作区；多根 + MCP cwd 语义仅单测 |
| 跨工具链全矩阵 | 部分 | E2E 工具链矩阵按已安装工具链运行（2 skip）；未安装的编译器资源未实测 |
| 长时/压力 | 未覆盖 | 无 soak/内存增长/并发构建压力测试 |
| 安全审计 | 未覆盖 | 未做威胁建模/权限提升分析；`export --out` 越界写入为设计提示（D-09） |
| E3 替代 | 部分 | WebView 由 26 视觉基线覆盖；命令/设置由宿主测试覆盖；原生交互无替代 |

## 10. 附录与证据索引

| 证据 | 位置 |
|---|---|
| 全量条目清单（JSON） | `.cb-tools/audit-0.9.2/inventory.json` |
| 条目摘要与缺口 | `.cb-tools/audit-0.9.2/inventory-summary.md` |
| 逐项证据分级表（命令 136 + 设置 93） | `.cb-tools/audit-0.9.2/evidence-tables.md` |
| 功能域证据映射 | `.cb-tools/audit-0.9.2/domains.md` |
| 七层基线日志（发版 / 审计） | `.cb-tools/audit-0.9.2/layers.log` / `layers-final.log` |
| CLI 52 用例矩阵 | `.cb-tools/audit-0.9.2/cli-matrix.json` |
| CLI 边界/非法输入探针 | `.cb-tools/audit-0.9.2/probe-edge*.log`、`probe-cli-mismatch.log` |
| MCP 非法输入探针 | `.cb-tools/audit-0.9.2/probe-mcp.js` 输出 |
| 宿主用例标题 | `.cb-tools/audit-0.9.2/host-titles.txt` |
| 视觉面清单 | `tests/visual/baselines/<theme>/*.png`（13 面 × 2） |

> `.cb-tools/` 已 gitignore；报告正文保留了全部结论与缺陷定位，证据文件可按 §10 命令重新生成。

## 11. 审计轮改动（仅测试，无产品代码）

| 文件 | 变更 | 结果 |
|---|---|---|
| `tests/test-command-entry-smoke.js` | 执行 112 → 120：面板类 6 条 + 破坏性 2 条纳入；HEAVY 16 条保持排除并注释 | 120 pass / 0 fail |
| `tests/test-command-inventory.js` | 新增分区守卫（6 断言）：HEAVY 合法性/唯一性、执行+HEAVY==136、每条 HEAVY 有非契约测试引用 | 6 pass / 0 fail |
| 产品代码 | **零改动** | `git status` 仅上述测试文件 |

## 12. 修复轮记录（13/13）

> 触发：用户确认“修复全部 13 项缺陷后执行 E3”。产品代码与测试同时修改；`npm run compile`、`npm test`（233/0/1）、`npm run test:contract`（3/0）通过。

| 缺陷 | 修复 | 主要文件 | 回归 |
|---|---|---|---|
| D-01 | `project_read` 的 `section` 运行期枚举校验；未知值 → `invalid-input` 并列出允许值；空 `target` 同样报错 | `src/api/toolRegistry.ts`、`src/api/projectQuery.ts` | G13、G13f、M11、C22 |
| D-02 | `export` 的 `kind` 运行期枚举校验；未知值 → `invalid-input`（不再默认 `commands`） | `src/api/exportService.ts`、`src/api/toolRegistry.ts` | M12、C23、G16 系列 |
| D-03 | `compiler info` 校验 id 是否注册（`isRegisteredCompiler`），未知 id → `invalid-input` 并提示 `action=list` | `src/api/compilerService.ts`、`src/api/toolRegistry.ts`、`src/extension.ts` | G14、M13、C24 |
| D-04 | CLI `run` 成功启动后传播被运行程序的退出码；未启动/超时仍用控制层错误码 | `src/cli/cb-cli.ts` | C28/C29/C29b |
| D-05 | `format` 严格化为 `canonical\|preserve`；写盘服务 `requireWriteFormat` 拒绝未知值（直接 API 调用同样生效） | `src/api/types.ts`、`src/api/projectService.ts`、`src/api/toolRegistry.ts` | G13b、C25、P13 |
| D-06 | `--help` / `-h` 退出码改为 `0`；无命令仍为 `2` | `src/cli/cb-cli.ts` | C20/C20b |
| D-07 | CLI 未知开关 → usage(2)；`flagString` 缺值 → usage；`flagNumber` 非有限数 → invalid-input；Agent 三端数值/数组参数运行期校验 | `src/cli/cb-cli.ts`、`src/api/toolRegistry.ts` | C21/C26、G15 系列 |
| D-08 | `workspace` 的 `action` 运行期枚举校验；未知 action → `invalid-input` | `src/api/toolRegistry.ts` | G13e |
| D-09 | `export.out` 必须落在工程目录内（相对/绝对都校验），越界 → `invalid-input`，不写盘 | `src/api/exportService.ts` | G16/G16b/G16c/G16d、C27/C27b；B16 调整到工程内目录 |
| D-10 | 36 条仅入口命令补行为断言：8 条调试命令 + 28 条工程/文件/工具/树/最近工程命令（含向导、导入、导出、移除文件、无工程守卫） | `tests/test-debug-command-behavior.js`、`tests/test-command-handlers-misc.js` | 14 + 31 断言 |
| D-11 | 6 个设置各补行为断言：customFlags/flagOverrides 读写与合并、gprofPath/annotatedSource、search.scope、noProjectCompile.useTaskTerminal（含任务化编译） | `tests/test-settings-behavior.js`；为可测性提取 `resolveGprofCommand`、`annotatedSourceEnabled`、`configuredSearchScope`、`useTaskTerminalForNoProjectCompile` | 20 断言 |
| D-12 | `strategy.md` 计数改为 13 面/26 基线、233 个无头脚本、136 命令/93 设置 | `docs/testing/strategy.md` | 契约文档一致性 |
| D-13 | mock 补 `window.terminals`（记录/回收）、Task/TaskGroup/ShellExecution、`debug.startDebugging` 记录；入口冒烟改为原地清空 | `tests/_harness/vscodeMock.js`、`tests/_harness/extensionActivation.js`、`tests/test-command-entry-smoke.js` | 入口冒烟 120/0、任务化编译用例 |

**行为变更（需知悉）**

1. `cb-cli run`：程序正常启动并退出时，CLI 退出码 = 程序退出码（例如 3），不再统一改写为 4；脚本若依赖“非 0 即 4”需调整。
2. `codeblocks_export` / `cb-cli export`：`out` 越出工程目录会被拒绝（安全修复）；此前写到工程外的脚本需改到工程内。

**验证**

- `npm test`：`TOTAL=233 FAIL=0 SKIP=1`（`test-writer.js` 为手工工具）。
- `npm run test:contract`：`TOTAL=3 FAIL=0`。
- `npm run test:all`：`TOTAL=247 FAIL=0 SKIP=1`（contract + unit + e2e + visual + perf + pack；宿主单列 37/37）。
- 新增/更新用例：`test-debug-command-behavior.js` 14/0、`test-command-handlers-misc.js` 31/0、`test-settings-behavior.js` 20/0、`test-api-tool-guards.js` 44/0、`test-cli.js` 32/0、`test-mcp-server.js` 16/0。
- E3（真实 GUI）仍受 Computer Use 开关限制：本轮再次调用仍返回“Computer Use is off…需 `/computer on`”；启用后按 `manual-acceptance.md` 执行（菜单/对话框/悬停/拖拽/WebView/调试手工项）。

---

## 附录 A：命令逐项表（136）

> `入口` = 入口冒烟是否执行（HEAVY = 由 e2e/host 覆盖）；`最高证据` = E2-host / E1-e2e / E1-unit / E0-entry；`仅入口` 标 ⚠ 表示只有入口/菜单级证据。完整引用文件见 `.cb-tools/audit-0.9.2/evidence-tables.md`。

| # | 命令 | 入口 | 最高证据 | 仅入口 |
|---|---|---|---|---|
| 1 | `codeblocks.newProject` | ✔ | E1-unit |  |
| 2 | `codeblocks.newProjectFromTemplate` | ✔ | E0-entry | ⚠ |
| 3 | `codeblocks.newBuildTarget` | ✔ | E0-entry | ⚠ |
| 4 | `codeblocks.newFile` | ✔ | E0-entry | ⚠ |
| 5 | `codeblocks.saveProjectAsTemplate` | ✔ | E0-entry | ⚠ |
| 6 | `codeblocks.openProject` | ✔ | E2-host |  |
| 7 | `codeblocks.build` | HEAVY | E2-host |  |
| 8 | `codeblocks.rebuild` | HEAVY | E2-host |  |
| 9 | `codeblocks.buildWorkspace` | HEAVY | E2-host |  |
| 10 | `codeblocks.build.stop` | ✔ | E1-e2e |  |
| 11 | `codeblocks.installCompilerCache` | HEAVY | E0-entry | ⚠ |
| 12 | `codeblocks.buildAndRun` | HEAVY | E0-entry | ⚠ |
| 13 | `codeblocks.compileFileWithoutProject` | ✔ | E1-unit |  |
| 14 | `codeblocks.buildLog.toggleErrorsOnly` | ✔ | E1-unit |  |
| 15 | `codeblocks.buildLog.showAllMessages` | ✔ | E2-host |  |
| 16 | `codeblocks.buildLog.clearOutput` | ✔ | E2-host |  |
| 17 | `codeblocks.buildLog.copyMessage` | ✔ | E0-entry | ⚠ |
| 18 | `codeblocks.buildLog.copyDiagnostic` | ✔ | E0-entry | ⚠ |
| 19 | `codeblocks.openRecentProject` | ✔ | E2-host |  |
| 20 | `codeblocks.resetViewLayout` | ✔ | E2-host |  |
| 21 | `codeblocks.analysis.refresh` | ✔ | E2-host |  |
| 22 | `codeblocks.analysis.locate` | ✔ | E1-unit |  |
| 23 | `codeblocks.analysis.copyXml` | ✔ | E1-unit |  |
| 24 | `codeblocks.clean` | HEAVY | E2-host |  |
| 25 | `codeblocks.distClean` | HEAVY | E1-unit |  |
| 26 | `codeblocks.cleanWorkspace` | HEAVY | E2-host |  |
| 27 | `codeblocks.rebuildWorkspace` | HEAVY | E2-host |  |
| 28 | `codeblocks.run` | HEAVY | E2-host |  |
| 29 | `codeblocks.selectTarget` | ✔ | E2-host |  |
| 30 | `codeblocks.selectProjectTarget` | ✔ | E2-host |  |
| 31 | `codeblocks.detectCompilers` | HEAVY | E2-host |  |
| 32 | `codeblocks.workspaceScanReport` | HEAVY | E1-unit |  |
| 33 | `codeblocks.checkWorkspacePath` | ✔ | E1-unit |  |
| 34 | `codeblocks.excludeBuildOutputs` | ✔ | E1-unit |  |
| 35 | `codeblocks.compilerOptions` | HEAVY | E2-host |  |
| 36 | `codeblocks.projectProperties` | HEAVY | E2-host |  |
| 37 | `codeblocks.generateCompileCommands` | HEAVY | E2-host |  |
| 38 | `codeblocks.cleanClangdConfig` | ✔ | E1-unit |  |
| 39 | `codeblocks.restartClangd` | HEAVY | E2-host |  |
| 40 | `codeblocks.clangd.applyQueryDriver` | ✔ | E1-unit |  |
| 41 | `codeblocks.debug` | ✔ | E2-host |  |
| 42 | `codeblocks.codeStats` | ✔ | E2-host |  |
| 43 | `codeblocks.copyStrings` | ✔ | E0-entry | ⚠ |
| 44 | `codeblocks.profileTarget` | HEAVY | E1-unit |  |
| 45 | `codeblocks.autoVersioning` | ✔ | E1-unit |  |
| 46 | `codeblocks.bumpVersion` | ✔ | E1-unit |  |
| 47 | `codeblocks.generateVersionHeader` | ✔ | E1-unit |  |
| 48 | `codeblocks.findSymbolInLibraries` | HEAVY | E0-entry | ⚠ |
| 49 | `codeblocks.todoList` | ✔ | E2-host |  |
| 50 | `codeblocks.todo.add` | ✔ | E1-unit |  |
| 51 | `codeblocks.bookmarks.toggle` | ✔ | E1-unit |  |
| 52 | `codeblocks.bookmarks.prev` | ✔ | E1-unit |  |
| 53 | `codeblocks.bookmarks.next` | ✔ | E1-unit |  |
| 54 | `codeblocks.bookmarks.clearAll` | ✔ | E1-unit |  |
| 55 | `codeblocks.openIncludeFile` | ✔ | E1-unit |  |
| 56 | `codeblocks.format` | ✔ | E1-unit |  |
| 57 | `codeblocks.insertHeaderGuard` | ✔ | E1-unit |  |
| 58 | `codeblocks.tidyComments` | ✔ | E0-entry | ⚠ |
| 59 | `codeblocks.swapHeaderSource` | ✔ | E0-entry | ⚠ |
| 60 | `codeblocks.runTool` | ✔ | E0-entry | ⚠ |
| 61 | `codeblocks.configureTools` | ✔ | E0-entry | ⚠ |
| 62 | `codeblocks.showCompilerCommands` | ✔ | E2-host |  |
| 63 | `codeblocks.exportMakefile` | ✔ | E0-entry | ⚠ |
| 64 | `codeblocks.workspace.editDependencies` | ✔ | E0-entry | ⚠ |
| 65 | `codeblocks.importProject` | ✔ | E0-entry | ⚠ |
| 66 | `codeblocks.exportTargetAsProject` | ✔ | E1-unit |  |
| 67 | `codeblocks.openDefaultConfig` | ✔ | E0-entry | ⚠ |
| 68 | `codeblocks.ui.switchLanguage` | ✔ | E1-unit |  |
| 69 | `codeblocks.moveProjectUp` | ✔ | E1-unit |  |
| 70 | `codeblocks.moveProjectDown` | ✔ | E1-unit |  |
| 71 | `codeblocks.removeProject` | HEAVY | E1-unit |  |
| 72 | `codeblocks.closeProject` | HEAVY | E0-entry | ⚠ |
| 73 | `codeblocks.saveProject` | ✔ | E0-entry | ⚠ |
| 74 | `codeblocks.saveProjectAs` | ✔ | E0-entry | ⚠ |
| 75 | `codeblocks.saveWorkspace` | ✔ | E1-unit |  |
| 76 | `codeblocks.saveWorkspaceAs` | ✔ | E1-unit |  |
| 77 | `codeblocks.closeWorkspace` | ✔ | E1-unit |  |
| 78 | `codeblocks.openDefaultWorkspace` | ✔ | E1-unit |  |
| 79 | `codeblocks.removeFiles` | ✔ | E0-entry | ⚠ |
| 80 | `codeblocks.projectTree.expandAll` | ✔ | E0-entry | ⚠ |
| 81 | `codeblocks.projectTree.collapseAll` | ✔ | E0-entry | ⚠ |
| 82 | `codeblocks.reloadProject` | ✔ | E1-unit |  |
| 83 | `codeblocks.buildProject` | ✔ | E1-unit |  |
| 84 | `codeblocks.rebuildProject` | ✔ | E1-unit |  |
| 85 | `codeblocks.cleanProject` | ✔ | E1-unit |  |
| 86 | `codeblocks.addFile` | ✔ | E1-unit |  |
| 87 | `codeblocks.addFilesRecursively` | ✔ | E1-unit |  |
| 88 | `codeblocks.findFile` | ✔ | E1-unit |  |
| 89 | `codeblocks.searchProjectFiles` | ✔ | E1-unit |  |
| 90 | `codeblocks.searchInProjectFiles` | ✔ | E1-unit |  |
| 91 | `codeblocks.fileProperties` | ✔ | E2-host |  |
| 92 | `codeblocks.renameFile` | ✔ | E1-unit |  |
| 93 | `codeblocks.newVirtualFolder` | ✔ | E1-unit |  |
| 94 | `codeblocks.renameVirtualFolder` | ✔ | E1-unit |  |
| 95 | `codeblocks.deleteVirtualFolder` | ✔ | E1-unit |  |
| 96 | `codeblocks.removeFile` | ✔ | E1-unit |  |
| 97 | `codeblocks.openContainingFolder` | ✔ | E1-unit |  |
| 98 | `codeblocks.toggleCompile` | ✔ | E1-unit |  |
| 99 | `codeblocks.toggleLink` | ✔ | E1-unit |  |
| 100 | `codeblocks.compileFile` | ✔ | E1-unit |  |
| 101 | `codeblocks.cleanFile` | ✔ | E1-unit |  |
| 102 | `codeblocks.editFileBuildCommand` | ✔ | E1-unit |  |
| 103 | `codeblocks.nextError` | ✔ | E2-host |  |
| 104 | `codeblocks.prevError` | ✔ | E2-host |  |
| 105 | `codeblocks.compileCurrentFile` | ✔ | E2-host |  |
| 106 | `codeblocks.clearErrors` | ✔ | E2-host |  |
| 107 | `codeblocks.activatePriorProject` | ✔ | E0-entry | ⚠ |
| 108 | `codeblocks.activateNextProject` | ✔ | E0-entry | ⚠ |
| 109 | `codeblocks.toggleCategorize` | ✔ | E2-host |  |
| 110 | `codeblocks.clearRecentProjects` | ✔ | E0-entry | ⚠ |
| 111 | `codeblocks.projectNotes` | ✔ | E0-entry | ⚠ |
| 112 | `codeblocks.setProgramArguments` | ✔ | E1-unit |  |
| 113 | `codeblocks.showGlobalVariables` | ✔ | E2-host |  |
| 114 | `codeblocks.backtickCache` | ✔ | E1-unit |  |
| 115 | `codeblocks.clearBacktickCache` | ✔ | E1-unit |  |
| 116 | `codeblocks.keybindings.check` | ✔ | E2-host |  |
| 117 | `codeblocks.keybindings.apply` | HEAVY | E2-host |  |
| 118 | `codeblocks.keybindings.configure` | ✔ | E1-unit |  |
| 119 | `codeblocks.keybindings.reset` | HEAVY | E2-host |  |
| 120 | `codeblocks.keybindings.panel` | HEAVY | E2-host |  |
| 121 | `codeblocks.keybindings.export` | ✔ | E1-unit |  |
| 122 | `codeblocks.keybindings.import` | ✔ | E1-unit |  |
| 123 | `codeblocks.debug.refreshRegisters` | ✔ | E2-host |  |
| 124 | `codeblocks.debug.sendGdbCommand` | ✔ | E0-entry | ⚠ |
| 125 | `codeblocks.debug.setNextStatement` | ✔ | E2-host |  |
| 126 | `codeblocks.debug.nextInstruction` | ✔ | E0-entry | ⚠ |
| 127 | `codeblocks.debug.stepIntoInstruction` | ✔ | E0-entry | ⚠ |
| 128 | `codeblocks.debug.examineMemory` | ✔ | E0-entry | ⚠ |
| 129 | `codeblocks.debug.attachToProcess` | HEAVY | E0-entry | ⚠ |
| 130 | `codeblocks.debug.detach` | ✔ | E1-unit |  |
| 131 | `codeblocks.debug.addSymbolFile` | ✔ | E1-unit |  |
| 132 | `codeblocks.debug.infoFrame` | ✔ | E2-host |  |
| 133 | `codeblocks.debug.infoSharedLibrary` | ✔ | E0-entry | ⚠ |
| 134 | `codeblocks.debug.infoFiles` | ✔ | E2-host |  |
| 135 | `codeblocks.debug.infoFloat` | ✔ | E0-entry | ⚠ |
| 136 | `codeblocks.debug.infoSignals` | ✔ | E0-entry | ⚠ |
| 1 | `codeblocks.compilerId` | string | "gcc" | E1-e2e |
| 2 | `codeblocks.compiler.customFlags` | object | {} | E0-contract |
| 3 | `codeblocks.compiler.flagOverrides` | object | {} | E0-contract |
| 4 | `codeblocks.compiler.languageFlags` | object | {} | E1-unit |
| 5 | `codeblocks.masterPath` | string | "" | E1-unit |
| 6 | `codeblocks.compilerPrograms` | object | {} | E2-host |
| 7 | `codeblocks.saveBeforeBuild` | boolean | true | E1-unit |
| 8 | `codeblocks.noProjectCompile.useTaskTerminal` | boolean | false | E0-contract |
| 9 | `codeblocks.profiler.gprofPath` | string | "" | E0-contract |
| 10 | `codeblocks.profiler.annotatedSource` | boolean | true | E0-contract |
| 11 | `codeblocks.parallelJobs` | number | 8 | E1-unit |
| 12 | `codeblocks.build.compilerCache` | string | "none" | E1-e2e |
| 13 | `codeblocks.build.compilerCachePath` | string | "" | E1-e2e |
| 14 | `codeblocks.build.skipIncludeDeps` | boolean | false | E1-e2e |
| 15 | `codeblocks.build.linkInputExtensions` | array | ["xm"] | E1-unit |
| 16 | `codeblocks.build.verboseOutput` | boolean | false | E1-e2e |
| 17 | `codeblocks.build.profile` | boolean | false | E1-unit |
| 18 | `codeblocks.build.traceProcesses` | boolean | false | E1-unit |
| 19 | `codeblocks.build.lowerCompilerPriority` | boolean | false | E1-unit |
| 20 | `codeblocks.build.autoExcludeOutputs` | boolean | true | E1-unit |
| 21 | `codeblocks.build.sampleSystem` | boolean | false | E1-unit |
| 22 | `codeblocks.build.performanceAdvisor` | boolean | false | E1-unit |
| 23 | `codeblocks.build.compileCommandsOnlyTargets` | boolean | false | E1-unit |
| 24 | `codeblocks.build.scriptExitGraceMs` | number | 1500 | E1-unit |
| 25 | `codeblocks.build.scriptCommandTimeoutMs` | number | 0 | E1-unit |
| 26 | `codeblocks.build.strictQuoting` | boolean | false | E1-unit |
| 27 | `codeblocks.build.asmUsesCompilerVar` | boolean | false | E1-unit |
| 28 | `codeblocks.build.responseFile` | string | "safe" | E1-unit |
| 29 | `codeblocks.build.cleanResponseFiles` | boolean | false | E1-unit |
| 30 | `codeblocks.maxReportedErrors` | number | 50 | E1-unit |
| 31 | `codeblocks.build.plainCbLog` | boolean | false | E1-e2e |
| 32 | `codeblocks.build.persistLog` | boolean | false | E2-host |
| 33 | `codeblocks.build.outputTimestamp` | boolean | false | E1-unit |
| 34 | `codeblocks.build.saveHtmlLog` | boolean | false | E2-host |
| 35 | `codeblocks.build.saveHtmlLogFullCommandLine` | boolean | false | E1-unit |
| 36 | `codeblocks.log.english` | boolean | false | E1-unit |
| 37 | `codeblocks.ui.quietSuccess` | boolean | false | E1-unit |
| 38 | `codeblocks.ui.quietFailure` | boolean | false | E1-unit |
| 39 | `codeblocks.ui.buildLogAutoFocus` | string | "errors" | E1-unit |
| 40 | `codeblocks.ui.buildLogFocusFirstError` | boolean | true | E1-unit |
| 41 | `codeblocks.workspace.pathGuard` | string | "prompt" | E1-unit |
| 42 | `codeblocks.detect.autoOpen` | string | "all" | E1-unit |
| 43 | `codeblocks.detect.autoOpenThreshold` | number | 20 | E1-unit |
| 44 | `codeblocks.detect.checkExternalChanges` | string | "prompt" | E1-unit |
| 45 | `codeblocks.projectTree.categorize` | boolean | true | E1-unit |
| 46 | `codeblocks.gdbTimeoutMs` | number | 30000 | E1-unit |
| 47 | `codeblocks.debug.initCommands` | array | [] | E1-unit |
| 48 | `codeblocks.debug.userArguments` | string | "" | E1-e2e |
| 49 | `codeblocks.debug.disableInit` | boolean | true | E1-e2e |
| 50 | `codeblocks.debug.printPretty` | boolean | false | E1-e2e |
| 51 | `codeblocks.debug.printElements` | number | 0 | E1-e2e |
| 52 | `codeblocks.debug.disassemblyFlavor` | string | "default" | E1-e2e |
| 53 | `codeblocks.debug.instructionSet` | string | "" | E1-unit |
| 54 | `codeblocks.debug.charset` | string | "" | E1-unit |
| 55 | `codeblocks.debug.gdbPath` | string | "" | E1-unit |
| 56 | `codeblocks.debug.trace` | boolean | false | E1-e2e |
| 57 | `codeblocks.debug.registers` | boolean | false | E2-host |
| 58 | `codeblocks.debug.addOtherProjectDirs` | boolean | false | E1-unit |
| 59 | `codeblocks.clangd.enabled` | boolean | true | E2-host |
| 60 | `codeblocks.clangd.buildLogDiagnostics` | string | "build" | E1-unit |
| 61 | `codeblocks.clangd.restartOnActiveProjectSwitch` | boolean | true | E1-unit |
| 62 | `codeblocks.clangd.forcedIncludes` | array | ["global.h"] | E1-unit |
| 63 | `codeblocks.clangd.suppressedWarnings` | array | ["-Wunused-function","redefinition_different_typedef"] | E1-unit |
| 64 | `codeblocks.clangd.suppressHeaderDiagnostics` | boolean | true | E1-unit |
| 65 | `codeblocks.clangd.unusedIncludes` | string | "none" | E1-unit |
| 66 | `codeblocks.clangd.headerInsertion` | string | "never" | E1-unit |
| 67 | `codeblocks.clangd.indexBackground` | string | "default" | E1-unit |
| 68 | `codeblocks.clangd.indexStandardLibrary` | string | "default" | E1-unit |
| 69 | `codeblocks.clangd.clangTidy` | string | "default" | E1-unit |
| 70 | `codeblocks.clangd.completionAllScopes` | string | "default" | E1-unit |
| 71 | `codeblocks.clangd.inlayHints` | string | "default" | E1-unit |
| 72 | `codeblocks.clangd.documentationCommentFormat` | string | "default" | E1-unit |
| 73 | `codeblocks.clangd.excludeDirs` | array | [] | E1-unit |
| 74 | `codeblocks.clangd.builtinHeaders` | string | "clangd" | E1-unit |
| 75 | `codeblocks.clangd.extraConfig` | string | "" | E1-unit |
| 76 | `codeblocks.ui.language` | string | "auto" | E2-host |
| 77 | `codeblocks.ui.projectToolbar` | array | ["buildWorkspace","rebuildWorkspace","cleanWorkspace"] | E1-unit |
| 78 | `codeblocks.ui.symbolsView` | boolean | true | E1-unit |
| 79 | `codeblocks.ui.recentProjectsLimit` | number | 8 | E1-unit |
| 80 | `codeblocks.ui.findFileOpen` | boolean | false | E1-unit |
| 81 | `codeblocks.search.scope` | string | "openProjects" | E0-contract |
| 82 | `codeblocks.search.keepHistory` | boolean | true | E1-unit |
| 83 | `codeblocks.editor.autoHeaderGuard` | boolean | false | E1-unit |
| 84 | `codeblocks.editor.headerGuardStyle` | string | "ifndef" | E1-unit |
| 85 | `codeblocks.editor.tidyCommentWidth` | number | 80 | E1-unit |
| 86 | `codeblocks.editor.asmHashComment` | boolean | false | E1-unit |
| 87 | `codeblocks.astyleOptions` | array | ["--style=allman","--indent=spaces=4"] | E1-unit |
| 88 | `codeblocks.todo.keywords` | array | ["TODO","FIXME","NOTE","HACK","XXX"] | E1-unit |
| 89 | `codeblocks.tools` | array | [] | E1-unit |
| 90 | `codeblocks.keybindings.cbStyle` | boolean | false | E1-unit |
| 91 | `codeblocks.keybindings.overrides` | object | {} | E1-unit |
| 92 | `codeblocks.agent.enabled` | boolean | true | E1-unit |
| 93 | `codeblocks.agent.readOnly` | boolean | false | E2-host |

## 附录 B：设置逐条表（93）

> `最高证据` = E2-host / E1-e2e / E1-unit / E0-contract。

| # | 设置 | 类型 | 默认值 | 最高证据 |
|---|---|---|---|---|
| 1 | `codeblocks.compilerId` | string | "gcc" | E1-e2e |
| 2 | `codeblocks.compiler.customFlags` | object | {} | E0-contract |
| 3 | `codeblocks.compiler.flagOverrides` | object | {} | E0-contract |
| 4 | `codeblocks.compiler.languageFlags` | object | {} | E1-unit |
| 5 | `codeblocks.masterPath` | string | "" | E1-unit |
| 6 | `codeblocks.compilerPrograms` | object | {} | E2-host |
| 7 | `codeblocks.saveBeforeBuild` | boolean | true | E1-unit |
| 8 | `codeblocks.noProjectCompile.useTaskTerminal` | boolean | false | E0-contract |
| 9 | `codeblocks.profiler.gprofPath` | string | "" | E0-contract |
| 10 | `codeblocks.profiler.annotatedSource` | boolean | true | E0-contract |
| 11 | `codeblocks.parallelJobs` | number | 8 | E1-unit |
| 12 | `codeblocks.build.compilerCache` | string | "none" | E1-e2e |
| 13 | `codeblocks.build.compilerCachePath` | string | "" | E1-e2e |
| 14 | `codeblocks.build.skipIncludeDeps` | boolean | false | E1-e2e |
| 15 | `codeblocks.build.linkInputExtensions` | array | ["xm"] | E1-unit |
| 16 | `codeblocks.build.verboseOutput` | boolean | false | E1-e2e |
| 17 | `codeblocks.build.profile` | boolean | false | E1-unit |
| 18 | `codeblocks.build.traceProcesses` | boolean | false | E1-unit |
| 19 | `codeblocks.build.lowerCompilerPriority` | boolean | false | E1-unit |
| 20 | `codeblocks.build.autoExcludeOutputs` | boolean | true | E1-unit |
| 21 | `codeblocks.build.sampleSystem` | boolean | false | E1-unit |
| 22 | `codeblocks.build.performanceAdvisor` | boolean | false | E1-unit |
| 23 | `codeblocks.build.compileCommandsOnlyTargets` | boolean | false | E1-unit |
| 24 | `codeblocks.build.scriptExitGraceMs` | number | 1500 | E1-unit |
| 25 | `codeblocks.build.scriptCommandTimeoutMs` | number | 0 | E1-unit |
| 26 | `codeblocks.build.strictQuoting` | boolean | false | E1-unit |
| 27 | `codeblocks.build.asmUsesCompilerVar` | boolean | false | E1-unit |
| 28 | `codeblocks.build.responseFile` | string | "safe" | E1-unit |
| 29 | `codeblocks.build.cleanResponseFiles` | boolean | false | E1-unit |
| 30 | `codeblocks.maxReportedErrors` | number | 50 | E1-unit |
| 31 | `codeblocks.build.plainCbLog` | boolean | false | E1-e2e |
| 32 | `codeblocks.build.persistLog` | boolean | false | E2-host |
| 33 | `codeblocks.build.outputTimestamp` | boolean | false | E1-unit |
| 34 | `codeblocks.build.saveHtmlLog` | boolean | false | E2-host |
| 35 | `codeblocks.build.saveHtmlLogFullCommandLine` | boolean | false | E1-unit |
| 36 | `codeblocks.log.english` | boolean | false | E1-unit |
| 37 | `codeblocks.ui.quietSuccess` | boolean | false | E1-unit |
| 38 | `codeblocks.ui.quietFailure` | boolean | false | E1-unit |
| 39 | `codeblocks.ui.buildLogAutoFocus` | string | "errors" | E1-unit |
| 40 | `codeblocks.ui.buildLogFocusFirstError` | boolean | true | E1-unit |
| 41 | `codeblocks.workspace.pathGuard` | string | "prompt" | E1-unit |
| 42 | `codeblocks.detect.autoOpen` | string | "all" | E1-unit |
| 43 | `codeblocks.detect.autoOpenThreshold` | number | 20 | E1-unit |
| 44 | `codeblocks.detect.checkExternalChanges` | string | "prompt" | E1-unit |
| 45 | `codeblocks.projectTree.categorize` | boolean | true | E1-unit |
| 46 | `codeblocks.gdbTimeoutMs` | number | 30000 | E1-unit |
| 47 | `codeblocks.debug.initCommands` | array | [] | E1-unit |
| 48 | `codeblocks.debug.userArguments` | string | "" | E1-e2e |
| 49 | `codeblocks.debug.disableInit` | boolean | true | E1-e2e |
| 50 | `codeblocks.debug.printPretty` | boolean | false | E1-e2e |
| 51 | `codeblocks.debug.printElements` | number | 0 | E1-e2e |
| 52 | `codeblocks.debug.disassemblyFlavor` | string | "default" | E1-e2e |
| 53 | `codeblocks.debug.instructionSet` | string | "" | E1-unit |
| 54 | `codeblocks.debug.charset` | string | "" | E1-unit |
| 55 | `codeblocks.debug.gdbPath` | string | "" | E1-unit |
| 56 | `codeblocks.debug.trace` | boolean | false | E1-e2e |
| 57 | `codeblocks.debug.registers` | boolean | false | E2-host |
| 58 | `codeblocks.debug.addOtherProjectDirs` | boolean | false | E1-unit |
| 59 | `codeblocks.clangd.enabled` | boolean | true | E2-host |
| 60 | `codeblocks.clangd.buildLogDiagnostics` | string | "build" | E1-unit |
| 61 | `codeblocks.clangd.restartOnActiveProjectSwitch` | boolean | true | E1-unit |
| 62 | `codeblocks.clangd.forcedIncludes` | array | ["global.h"] | E1-unit |
| 63 | `codeblocks.clangd.suppressedWarnings` | array | ["-Wunused-function","redefinition_different_typedef"] | E1-unit |
| 64 | `codeblocks.clangd.suppressHeaderDiagnostics` | boolean | true | E1-unit |
| 65 | `codeblocks.clangd.unusedIncludes` | string | "none" | E1-unit |
| 66 | `codeblocks.clangd.headerInsertion` | string | "never" | E1-unit |
| 67 | `codeblocks.clangd.indexBackground` | string | "default" | E1-unit |
| 68 | `codeblocks.clangd.indexStandardLibrary` | string | "default" | E1-unit |
| 69 | `codeblocks.clangd.clangTidy` | string | "default" | E1-unit |
| 70 | `codeblocks.clangd.completionAllScopes` | string | "default" | E1-unit |
| 71 | `codeblocks.clangd.inlayHints` | string | "default" | E1-unit |
| 72 | `codeblocks.clangd.documentationCommentFormat` | string | "default" | E1-unit |
| 73 | `codeblocks.clangd.excludeDirs` | array | [] | E1-unit |
| 74 | `codeblocks.clangd.builtinHeaders` | string | "clangd" | E1-unit |
| 75 | `codeblocks.clangd.extraConfig` | string | "" | E1-unit |
| 76 | `codeblocks.ui.language` | string | "auto" | E2-host |
| 77 | `codeblocks.ui.projectToolbar` | array | ["buildWorkspace","rebuildWorkspace","cleanWorkspace"] | E1-unit |
| 78 | `codeblocks.ui.symbolsView` | boolean | true | E1-unit |
| 79 | `codeblocks.ui.recentProjectsLimit` | number | 8 | E1-unit |
| 80 | `codeblocks.ui.findFileOpen` | boolean | false | E1-unit |
| 81 | `codeblocks.search.scope` | string | "openProjects" | E0-contract |
| 82 | `codeblocks.search.keepHistory` | boolean | true | E1-unit |
| 83 | `codeblocks.editor.autoHeaderGuard` | boolean | false | E1-unit |
| 84 | `codeblocks.editor.headerGuardStyle` | string | "ifndef" | E1-unit |
| 85 | `codeblocks.editor.tidyCommentWidth` | number | 80 | E1-unit |
| 86 | `codeblocks.editor.asmHashComment` | boolean | false | E1-unit |
| 87 | `codeblocks.astyleOptions` | array | ["--style=allman","--indent=spaces=4"] | E1-unit |
| 88 | `codeblocks.todo.keywords` | array | ["TODO","FIXME","NOTE","HACK","XXX"] | E1-unit |
| 89 | `codeblocks.tools` | array | [] | E1-unit |
| 90 | `codeblocks.keybindings.cbStyle` | boolean | false | E1-unit |
| 91 | `codeblocks.keybindings.overrides` | object | {} | E1-unit |
| 92 | `codeblocks.agent.enabled` | boolean | true | E1-unit |
| 93 | `codeblocks.agent.readOnly` | boolean | false | E2-host |
