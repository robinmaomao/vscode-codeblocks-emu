# 设置项完整参考

> 适用于 Code::Blocks 扩展（`codeblocks-vscode`）。本页按设置页的 **10 个分区**逐项说明类型、默认值、作用域、取值与生效时机。
> 英文版：[settings.en.md](./settings.en.md)｜功能与操作见 [用户手册](./usage.md)。

## 0. 通用说明

- **打开设置**：`Ctrl+,` → 搜索 `codeblocks`，或命令面板执行 `Preferences: Open Settings (UI)`。
- **配置文件**：用户设置 `settings.json`、工作区设置 `.vscode/settings.json`、多根工作区的文件夹设置。
- **作用域**：
  - 未标注 = 可在用户/工作区/文件夹任意层级覆盖。
  - `window` = 窗口级，仅用户/远程设置可覆盖。
  - `machine-overridable` = 机器级路径设置，不参与 Settings Sync，仍可按工作区覆盖。
  - `resource` = 按资源（工程文件）读取，多根工作区可按文件夹覆盖。
- **生效时机**：多数设置即时生效；少数需要重载窗口或下一次构建/调试会话，见各项说明。
- **升级迁移**（本版本）：
  - `codeblocks.parallelJobs` 的 `0` 从「逻辑核数 × 2」改为「当前主机逻辑核数」；升级时会把**显式配置的 0** 一次性改写为 `8`，之后重新设为 `0` 即按逻辑核数自动。
  - 已移除 `codeblocks.clangd.queryDriver`（仅用于输出提示）；需要 `--query-driver` 时把 `codeblocks.clangd.builtinHeaders` 设为 `queryDriver`，并执行命令 `Code::Blocks: Configure clangd --query-driver`。
  - 设置分区重新整理为 9 个，**设置键本身未重命名**，原有配置文件无需修改。

---

## 1. 编译器与工具链

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.compilerId` | string | `gcc` |  | 默认编译器 ID（对应 `options_<id>.xml`）。工程未指定编译器或单文件编译时使用；修改后状态栏 `Compiler:` 即时刷新，并按新编译器重新生成 clangd 编译数据库（实际变化时重启 clangd）。 |
| `codeblocks.masterPath` | string | `""` | machine-overridable | 编译器安装根目录；留空则从 `PATH` 探测。修改后编译命令、系统头路径与 clangd 数据库同步更新。 |
| `codeblocks.compilerPrograms` | object | `{}` | machine-overridable | 按编译器 ID 分组的程序路径表，可覆盖 `C` / `CPP` / `LD` / `LIB` / `WINDRES` / `MAKE` / `DBGconfig`。通常由「探测编译器」自动写入；交叉编译时可显式指定。 |

示例：

```jsonc
{
  "codeblocks.compilerId": "gcc",
  "codeblocks.masterPath": "C:/mingw64",
  "codeblocks.compilerPrograms": {
    "gcc": { "C": "C:/mingw64/bin/gcc.exe", "CPP": "C:/mingw64/bin/g++.exe" }
  }
}
```

---

## 2. 构建

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.saveBeforeBuild` | boolean | `true` |  | 构建 / 运行 / 清理前自动保存所有脏文件。 |
| `codeblocks.parallelJobs` | number | `8` | resource | 并行编译任务数。`1` = 串行；`2`–`32` = 显式并发；`0` = 自动（当前主机逻辑核数，上限 32）。实际并发还受进程预算上限 `max(8, 逻辑核数)` 约束，被收敛时构建开始会输出说明。支持文件夹级覆盖，下一次构建生效。 |
| `codeblocks.build.compilerCache` | string | `none` | machine-overridable | 编译缓存：`none` / `ccache` / `sccache`。仅标准编译命令前置缓存程序；未找到工具时回退原编译器并告警。ccache 只接受 UTF-8 预处理输出：工程路径含非 ASCII 字符时编译单元改用工程相对源路径并追加 `-fno-working-directory`（否则每次编译都被判不可缓存），源文件/包含目录非 ASCII 仍无法缓存（构建开始告警）。 |
| `codeblocks.build.compilerCachePath` | string | `""` | machine-overridable | 缓存工具显式路径；留空自动探测（PATH / WinGet / Scoop / cargo / Chocolatey / Program Files）。路径无效等同未找到，仅缓存非 `none` 时生效。 |
| `codeblocks.build.skipIncludeDeps` | boolean | `false` |  | 增量编译跳过 `#include` 依赖扫描（对齐 CB `skip_include_deps`），适合非 C/C++ 编译器或追求更快的增量判断。 |
| `codeblocks.build.linkInputExtensions` | array | `["xm"]` |  | 参与增量重链接的工程内链接输入扩展名（如 `ld` / `lds` / `icf` / `def`）；支持 `xm`、`.xm`、`*.xm`，设 `[]` 关闭。 |
| `codeblocks.build.verboseOutput` | boolean | `false` |  | 详细构建输出：完整编译命令行、Clean 逐文件列表、增量跳过列表。 |
| `codeblocks.build.profile` | boolean | `false` |  | 构建性能探针：构建结束输出 `[profile]` 阶段计时块；等效环境变量 `CB_BUILD_PROFILE=1`。 |
| `codeblocks.build.traceProcesses` | boolean | `false` |  | 构建结束打印子进程 spawn 次数、同时存活峰值与并发上限，用于和任务管理器对照。 |
| `codeblocks.build.lowerCompilerPriority` | boolean | `false` |  | 把编译/链接子进程降到低于正常优先级；I/O 瓶颈构建上可能更慢，默认关闭。 |
| `codeblocks.build.autoExcludeOutputs` | boolean | `true` |  | 构建前把目标文件/输出目录写入**用户设置**的 `files.watcherExclude` 与 `search.exclude`，避免 VS Code 反复扫描产物目录。 |
| `codeblocks.build.sampleSystem` | boolean | `false` |  | 构建期间每秒采样整机 / 编辑器 / 安全软件 / 文件扫描器的 CPU 归属（仅 Windows）；不跟随 `build.profile` 自动开启。 |
| `codeblocks.build.performanceAdvisor` | boolean | `false` |  | 构建性能顾问：构建结束输出归因告警（宿主卡顿 / CPU 饱和 / 杀软 / 文件扫描器）并在构建开始时做低内存检查。默认关闭；`build.profile` 或 `build.sampleSystem` 开启时自动生效。 |
| `codeblocks.build.compileCommandsOnlyTargets` | boolean | `false` |  | CommandsOnly 目标（type=4）是否编译其文件；默认仅执行 pre/post 脚本。 |
| `codeblocks.build.scriptExitGraceMs` | number | `1500` |  | pre/post-build 脚本命令结束宽限（0–60000 ms）；`0` 完全对齐 CB「只等命令本体」。 |
| `codeblocks.build.scriptCommandTimeoutMs` | number | `0` |  | 单条脚本命令超时（0 = 不超时，上限 3600000 ms）；超时强杀整棵进程树并把构建记为失败。 |
| `codeblocks.build.strictQuoting` | boolean | `false` |  | 严格引号规则（仅空格加引号，对齐 CB `NeedQuotes`）；关闭时对 cmd 元字符也加引号。 |
| `codeblocks.build.asmUsesCompilerVar` | boolean | `false` |  | 汇编文件按 `compilerVar` 选择编译程序；`true` 对齐 CB（`.s` 默认走 g++），`false` 强制 C 编译器。 |
| `codeblocks.build.responseFile` | string | `safe` |  | 超长命令响应文件策略：`safe` = 阈值 8000、绝对路径、保留源扩展名；`cb` = 阈值 32767、`main.respFile`、相对路径（对齐 CB）。 |
| `codeblocks.build.cleanResponseFiles` | boolean | `false` |  | Clean/Rebuild 时删除对象目录下的 `*.respFile`；CB 从不清理，默认关闭。 |

---

## 3. 构建日志与通知

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.maxReportedErrors` | number | `50` |  | 单次构建最多收集的错误数；`0` = 不限制。 |
| `codeblocks.build.plainCbLog` | boolean | `false` |  | 纯 CB 日志模式：关闭脚本编号、单行完成式、Emoji 汇总块、最慢 Top 3，输出 `=== Build finished ===`。 |
| `codeblocks.build.persistLog` | boolean | `false` |  | 构建输出写盘并跨窗口保留（`%APPDATA%\Code\logs\CodeBlocks.log`）；修改后需重载窗口。 |
| `codeblocks.build.outputTimestamp` | boolean | `false` |  | 普通输出通道每行加时间戳（仅 `persistLog=false` 时生效）；修改后即时生效。 |
| `codeblocks.build.saveHtmlLog` | boolean | `false` |  | 构建结束保存 HTML 日志（`<工程名>_build_log.html`），含起止时间与诊断汇总表。 |
| `codeblocks.build.saveHtmlLogFullCommandLine` | boolean | `false` |  | HTML 日志输出完整命令行；仅 `saveHtmlLog` 开启时生效。 |
| `codeblocks.log.english` | boolean | `false` |  | 构建日志强制英文（覆盖 `ui.language`），便于与 CB 原文对照。 |
| `codeblocks.ui.quietSuccess` | boolean | `false` |  | 构建成功不弹 toast（仅日志 + 状态栏徽标）。 |
| `codeblocks.ui.quietFailure` | boolean | `false` |  | 构建失败不弹 toast（仍写入 Build Log 与状态栏）。 |
| `codeblocks.ui.buildLogAutoFocus` | string | `errors` |  | Build Log 自动聚焦：`errors` / `errorsAndWarnings` / `always` / `never`。 |
| `codeblocks.ui.buildLogFocusFirstError` | boolean | `true` |  | 自动聚焦时定位到第一个错误。 |

---

## 4. 工作区与工程

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.workspace.pathGuard` | string | `prompt` |  | 工作区路径守卫：发现路径含 glob 元字符（`[ ] { } * ?`）时，`off` 不检查、`prompt` 询问后关闭两处 AI 指令扫描、`auto` 直接关闭。 |
| `codeblocks.detect.autoOpen` | string | `all` |  | 工作区工程自动检测：`all` 弹多选、`single` 仅单个工程时自动打开、`off` 关闭（仍可用状态栏入口）。 |
| `codeblocks.detect.autoOpenThreshold` | number | `20` |  | 自动检测的工程数量保护阈值（1–1000）；超过时先提示。 |
| `codeblocks.detect.checkExternalChanges` | string | `prompt` |  | `.cbp` 被外部修改时：`prompt` 询问重载、`auto` 直接重载、`off` 不检测。 |
| `codeblocks.projectTree.categorize` | boolean | `true` |  | 工程树按 源文件 / 头文件 / 其它 分组显示；关闭后平铺。 |

---

## 5. 调试 (GDB)

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.gdbTimeoutMs` | number | `30000` |  | GDB MI 单条命令超时（≥1000 ms）。 |
| `codeblocks.debug.initCommands` | array | `[]` |  | 调试会话启动后逐条注入的 GDB 命令（如 `set pagination off`）。 |
| `codeblocks.debug.userArguments` | string | `""` |  | 附加到 GDB 命令行的参数（引号感知分词）。 |
| `codeblocks.debug.disableInit` | boolean | `true` |  | 启动 GDB 时传 `-nx`，不执行 `.gdbinit` / `gdb.ini`。 |
| `codeblocks.debug.printPretty` | boolean | `false` |  | 变量显示美化（`set print pretty on`）。 |
| `codeblocks.debug.printElements` | number | `0` |  | 数组/字符串最多显示元素数（`set print elements`；0 = 不设置）。 |
| `codeblocks.debug.disassemblyFlavor` | string | `default` |  | 反汇编语法：`default` / `intel` / `att` / `custom`；`custom` 使用 `instructionSet`。 |
| `codeblocks.debug.instructionSet` | string | `""` |  | 自定义反汇编风格参数（仅 `disassemblyFlavor=custom` 时生效）。 |
| `codeblocks.debug.charset` | string | `""` |  | 调试字符集（`set charset`，如 `UTF-8` / `GBK`）；留空不设置。 |
| `codeblocks.debug.gdbPath` | string | `""` | machine-overridable | GDB 可执行文件路径；留空按 `masterPath/bin` → `PATH` 探测。 |
| `codeblocks.debug.trace` | boolean | `false` |  | 把 DAP 请求/响应/事件写入 Code::Blocks 输出通道。 |
| `codeblocks.debug.registers` | boolean | `false` |  | 允许 Registers 视图读取寄存器（部分 MinGW GDB 8.1 会崩溃，确认后再开）。 |
| `codeblocks.debug.addOtherProjectDirs` | boolean | `false` |  | 把其它已打开工程的目录加入调试源搜索路径。 |

---

## 6. IntelliSense (clangd)

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.clangd.enabled` | boolean | `true` |  | 启用 clangd 集成：自动生成 `compile_commands.json` 并更新 clangd 用户配置；关闭后回退轻量补全。 |
| `codeblocks.clangd.buildLogDiagnostics` | string | `build` |  | Build Log 诊断来源：`build` = 构建引擎完整诊断；`clangd` = clangd 诊断（仅打开过的文件）。 |
| `codeblocks.clangd.restartOnActiveProjectSwitch` | boolean | `true` |  | 切换活动工程且编译数据库实际变化时重启 clangd。 |
| `codeblocks.clangd.forcedIncludes` | array | `["global.h"]` |  | 分析头文件时强制预包含的基础头；按 include 搜索目录查找，存在则加 `-include`。 |
| `codeblocks.clangd.suppressedWarnings` | array | `["-Wunused-function","redefinition_different_typedef"]` |  | 写入 clangd `Diagnostics.Suppress` 的诊断抑制列表。 |
| `codeblocks.clangd.suppressHeaderDiagnostics` | boolean | `true` |  | 头文件单独分析时压制全部诊断（`.c` 不受影响）。 |
| `codeblocks.clangd.unusedIncludes` | string | `none` |  | 写入 `Diagnostics.UnusedIncludes`：`none` / `strict` / `omit`（omit = 不写该键）。 |
| `codeblocks.clangd.headerInsertion` | string | `never` |  | 写入 `Completion.HeaderInsertion`：`never` / `iwyu` / `omit`。 |
| `codeblocks.clangd.indexBackground` | string | `default` |  | 写入 `Index.Background`：`default` / `build` / `skip`。 |
| `codeblocks.clangd.indexStandardLibrary` | string | `default` |  | 写入 `Index.StandardLibrary`：`default` / `true` / `false`。 |
| `codeblocks.clangd.clangTidy` | string | `default` |  | `default` = 不写该键；`off` = 关闭全部 clang-tidy 诊断。 |
| `codeblocks.clangd.completionAllScopes` | string | `default` |  | 写入 `Completion.AllScopes`：`default` / `yes` / `no`。 |
| `codeblocks.clangd.inlayHints` | string | `default` |  | 写入 `InlayHints.Enabled`：`default` / `on` / `off`。 |
| `codeblocks.clangd.documentationCommentFormat` | string | `default` |  | 写入 `Documentation.CommentFormat`：`default` / `plaintext` / `markdown` / `doxygen`。 |
| `codeblocks.clangd.excludeDirs` | array | `[]` |  | 写入 `If.PathExclude` 的目录名（相对工程树，如 `obj` / `bin`）。 |
| `codeblocks.clangd.builtinHeaders` | string | `clangd` |  | 写入 `CompileFlags.BuiltinHeaders`：`clangd` / `queryDriver`（使用交叉编译器内建头）。设为 `queryDriver` 但未配置 `--query-driver` 时会提示配置命令。 |
| `codeblocks.clangd.extraConfig` | string | `""` |  | 追加到每个工程片段的自由 YAML；扩展自动添加作用域 `If`，YAML 语法错误会使 clangd 丢弃整个配置。 |

> 已移除：`codeblocks.clangd.queryDriver`。它只用于输出提示，实际开关是 `builtinHeaders=queryDriver`；升级时会自动清理残留配置项。

---

## 7. 界面

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.ui.language` | string | `auto` | window | 运行时界面语言：`auto`（跟随 VS Code 显示语言）/ `en` / `zh-cn`；命令标题与设置界面仍跟随 VS Code 显示语言，需重载窗口。 |
| `codeblocks.ui.projectToolbar` | array | `["buildWorkspace","rebuildWorkspace","cleanWorkspace"]` |  | Project 视图标题栏常驻按钮；可选 `newProject`、`openProject`、`build`、`rebuild`、`clean`、`run`、`debug`、`buildWorkspace`、`rebuildWorkspace`、`cleanWorkspace`、`compilerOptions`、`projectProperties`、`codeStats`。未选中的进入 `⋯` 溢出菜单。 |
| `codeblocks.ui.symbolsView` | boolean | `true` |  | 显示侧边栏 Symbols 视图。 |
| `codeblocks.ui.recentProjectsLimit` | number | `8` |  | 最近工程列表上限（0–50；0 = 不记录）。 |
| `codeblocks.ui.findFileOpen` | boolean | `false` |  | 「查找文件」命中后直接打开文件；默认只在工程树中定位。 |

---

## 8. 编辑器与工具

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.editor.autoHeaderGuard` | boolean | `false` |  | 新建空头文件时自动插入头文件保护宏。 |
| `codeblocks.editor.headerGuardStyle` | string | `ifndef` |  | 保护宏风格：`ifndef` / `pragma-once`。 |
| `codeblocks.editor.tidyCommentWidth` | number | `80` |  | 「整理注释」换行宽度（20–200）。 |
| `codeblocks.editor.asmHashComment` | boolean | `false` |  | 汇编（`.s`/`.S`）行注释使用 GAS 原生 `#`；默认 `//`（预处理 `.S` 安全）。 |
| `codeblocks.astyleOptions` | array | `["--style=allman","--indent=spaces=4"]` |  | AStyle 格式化参数。 |
| `codeblocks.todo.keywords` | array | `["TODO","FIXME","NOTE","HACK","XXX"]` |  | TODO 扫描与「插入 TODO」使用的关键字。 |
| `codeblocks.tools` | array | `[]` |  | 自定义工具表。每项含 `name`、`command`（必填）、`arguments`、`workingDirectory`、`env`、`output`（`output` / `terminal` / `silent`）。 |

示例：

```jsonc
{
  "codeblocks.tools": [
    {
      "name": "size",
      "command": "size",
      "arguments": "\"${file}\"",
      "output": "output"
    }
  ]
}
```

---

## 9. 快捷键

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.keybindings.cbStyle` | boolean | `false` |  | 启用 Code::Blocks 风格快捷键（如 `F9` 构建并运行、`Ctrl+F9` 构建）。 |
| `codeblocks.keybindings.overrides` | object | `{}` |  | 命令 → 键位覆盖表，例如 `{ "codeblocks.build": "ctrl+shift+b" }`；设为 `null` / 删除条目可恢复默认。 |

---

## 10. Agent（Copilot / MCP）

| 设置项 | 类型 | 默认值 | 作用域 | 说明 |
|--------|------|--------|--------|------|
| `codeblocks.agent.enabled` | boolean | `true` |  | Agent 控制总闸：关闭后 11 个 Language Model Tools 不再注册、内嵌 MCP server 不暴露（已在运行的 MCP server 也拒绝调用）。**未受信任的工作区一律按关闭处理**。切换即时生效，无需重载窗口；独立的 `cb-cli` 不受影响。 |
| `codeblocks.agent.readOnly` | boolean | `false` |  | 只读模式：仅放行 `project_read`、`build_status`、`compiler list/info`、`workspace info/deps/list` 与 `debug state`；改工程、构建、运行、调试一律返回 `read-only`。即时生效。 |

示例：

```jsonc
{
  "codeblocks.agent.enabled": true,
  "codeblocks.agent.readOnly": false
}
```

详见 [Agent 控制（Copilot / MCP / CLI）](./agent-control.md)。

---

## 11. 生效时机速查

| 设置 | 生效时机 |
|------|----------|
| `parallelJobs` / 多数构建设置 | 下一次构建 |
| `build.persistLog` | 重载窗口 |
| `ui.language` | 运行时文案即时生效；命令标题/设置界面需重载窗口 |
| `clangd.*`（影响产物的键） | 约 150 ms 去抖后自动重新生成 clangd 配置 |
| `debug.*` | 下一次调试会话 |
| `compilerId` / `masterPath` / `compilerPrograms` | 即时刷新状态栏，并按需重新生成 clangd 编译数据库 |
| `editor.*` / `astyleOptions` / `todo.keywords` / `tools` | 即时生效（工具菜单下次打开时刷新） |
| `agent.enabled` / `agent.readOnly` | 即时生效（工具注册 / 只读拦截当场变化，无需重载窗口） |
