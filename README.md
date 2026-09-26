# Code::Blocks for VS Code

原生移植 Code::Blocks 核心功能到 VS Code 的扩展 —— 一个直接驱动 GCC/GDB 的「迷你 IDE 内核」，**不是** `.cbp` → `tasks.json` 的桥接。

直接在 VS Code 中打开 `.cbp` / `.workspace` 工程，即可获得与 Code::Blocks 对齐的构建、调试与工程浏览体验。

> **作者**：Robinmaomao ｜ **版本**：0.8.76-dev

[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE.md)

> **许可证说明**：本扩展的 TypeScript 代码为独立重写（非复制 GPL 源码）；其中错误正则表（`resources/compilers/options_common_re.xml`）与命令模板（`resources/compilers/options_gcc.xml`）源自 GPL v3 的 Code::Blocks `compilergcc` 资源，因此整体按 GPL v3 发布，详见 [LICENSE.md](LICENSE.md)。

> 📖 详细的功能介绍、使用说明与 **RISC-V 交叉编译完整示例**见 [docs/使用说明.md](docs/使用说明.md)；逐项对齐依据见 [docs/对齐对照.md](docs/对齐对照.md)。

## 特性

- 📁 **原生工程解析**：直接加载 `.cbp` / `.workspace`（`fast-xml-parser`），完整还原 `Project` / `BuildTarget` / `ProjectFile` 内存模型，支持虚拟目标与虚拟文件夹。
- 🔨 **真实构建引擎**：不依赖 `tasks.json`。内置 Code::Blocks 的命令模板 + 宏展开（`$compiler $options $includes ...`），直接 `spawn` 编译/链接进程。
- ⚙️ **编译器管理**：完整解析 `options_<id>.xml`（含 `extends` 继承、`<if platform>` 平台分支、`<Common>` 引用），自动探测 GCC / MinGW / Clang / MSVC；支持从 Code::Blocks 的 `default.conf` 读取**用户自定义交叉编译器**（如 RISC-V）。
- 🐞 **GDB 调试**：自研内联 DAP 调试适配器，直接驱动 `gdb -i=mi`；断点（条件/命中次数/日志）、单步（含指令级）、变量、调用栈、线程、表达式求值；**第四十九轮新增**：反汇编视图、Memory 内存查看、Registers 寄存器视图、数据断点、异常断点、运行到光标、Set Next Statement、附加进程、Send GDB Command（Debug Console `-` 前缀透传 MI）；**第五十轮实机加固**：程序输出转发、Step Out / 条件断点 / 寄存器读取等多项 GDB 兼容修复（GDB 7.6.1–8.1 实测，详见 docs/开发进度.md）。
- ✨ **IntelliSense 补全**：自动生成 `compile_commands.json`（复用与 Code::Blocks 对齐的编译命令，写到工作区外缓存并更新 clangd 用户配置），配合 clangd 获得补全 / 跳转 / 悬停 / 重命名等能力；未安装 clangd 时自动回退到项目内轻量符号补全 / 悬停 / 跳转。
- 🔍 **符号浏览器（Symbols）**：对齐 Code::Blocks Symbols 面板，按 函数 / 宏 / 类型 / 变量 分组展示项目符号，点击精确定位。
- 🗂️ **多项目管理**：同时打开多个 `.cbp`，工程树支持拖拽排序（即编译顺序）、上移/下移、移除项目、活动项目高亮；打开工作区自动检测 `.cbp`，多选弹窗（目录名/文件名、默认全选）或状态栏入口随时重新打开。
- 📂 **工程树浏览**：按公共顶层目录（`relativeToCommonTopLevelPath`）展开的多层嵌套目录树、文件类型图标、缺失文件标记、目录优先排序（对齐 VS Code Explorer）。
- 🧩 **右键菜单**：项目节点支持增量编译/全量编译/添加文件；文件节点支持从项目移除、打开所在目录、切换编译/链接开关（写回 `.cbp`）。
- 📋 **结构化构建日志**：构建摘要树（编译器/编译统计/链接结果 + **错误 (N) / 警告 (N) 分组**，诊断挂在分组下一层级），点击诊断节点精确定位到行列；`F4`/`Shift+F4` 循环跳转错误。
- 🗂️ **Code::Blocks 菜单（状态栏 `Menu`）**：File / Edit / View / Search / Project / Build / Debug / Tools / Settings 九大菜单——支持**子菜单下钻**、分隔线、**快捷键标注**；Build 菜单含 Compile Current File（Ctrl+Shift+F9）/ Build·Rebuild·Clean Workspace / Abort / Errors（上一/下一/清除全部）/ Select Target；未打开工程时相关项标注提示；悬停就地展开常用命令链接。
- ⌨️ **快捷键与冲突处理**：默认键位全部避开 VS Code 默认（新增 `Alt+G` Goto File / `Shift+F2` Project 视图 / `Alt+F1-F2` 错误导航 / `Ctrl+Shift+R` Replace in Files 等 CB 键位）；设置 `codeblocks.keybindings.cbStyle` 启用 **CB 保真键位**（F5 断点、Ctrl+R 替换 等 12 项，会覆盖 VS Code 默认，可随时关闭）；命令 `Check Keybinding Conflicts` 扫描内置默认 / 用户 keybindings.json / 其它扩展并生成冲突报告。
- 🎛️ **逐项自定义快捷键**（方案 A）：设置 `codeblocks.keybindings.overrides`（30 项：构建/调试/错误导航/工程管理 + 外部别名 + CB 保真组）为唯一数据源，修改后**自动写入用户 keybindings.json**（自定义键 + 对默认键的移除规则；仅托管条目、注释保留、首次备份、回读校验回滚）；另提供**可视化设置面板**（`Code::Blocks: Keybinding Settings`：按键捕获录入、行内冲突/生效状态、检查冲突、方案导入导出）——可从命令面板、Menu → Settings → Keybindings… 或**扩展设置界面**（两项快捷键设置的描述内嵌一键链接）打开；另含向导/应用/重置命令。
- 🖥️ **结构化输出通道**：输出面板采用日志通道（LogOutputChannel），每行带时间戳、按级别着色（错误红 / 警告黄）；构建过程输出单行完成式进度（`✓ [Compiled] 123-248 xxx.c (2.0s)`）、`[Skipping]` / `[Linking]` / `[Archiving]` 状态，构建结束输出 Emoji 汇总块（编译/跳过/失败统计 + 错误/警告数 + 耗时 + 最慢 Top3）。
- 🎨 **专用语法高亮**：为链接脚本（`.ld` / `.lcf`）、GNU 汇编（`.S` / `.s`，RISC-V）、xmaker 配置脚本（`.xm`）提供专用 TextMate 语法高亮；安装时自动写入仅作用于这些文件的 token 颜色规则，不覆盖用户其他配色。
- 🚀 **对齐 Code::Blocks 细节**：
  - 增量编译（源文件 + `#include` 头文件依赖 mtime 比对）、`rebuild` 对齐 Code::Blocks（先 Clean 再 Build）
  - 文件类型判定对齐 Code::Blocks `FileTypeOf`：汇编源文件（`.S`/`.s`/`.asm`/`.ss`/`.s62`）正确编译并参与链接；链接脚本（`.ld`）等非源文件默认不编译不链接；`<Option buildCommand>` 自定义命令按 `use="1"` 语义识别
  - pre/post build 脚本（`.bat` / 命令；Windows 下实时读取系统 PATH，支持运行期新加入 PATH 的工具）；项目级 pre/post **每次构建各执行一次**，目标级按目标执行，post-build 按「实际产生命令」门控（对齐 Code::Blocks 状态机）
  - 带空格工具链路径自动加引号（如 `C:\Program Files (x86)\...` 下的 gcc / ar，避免 cmd 在空格处截断）
  - 链接/打包对象逐文件加引号（对齐 `pfDetails::Update` 的 QuoteStringIfNeeded，源文件/子目录含空格不截断）；空 `object_output` 默认 `.objs` 目录（对齐 `GetObjectOutput`）
  - 超长命令行自动改用响应文件（`@file`，对齐 Code::Blocks CheckForToLongCommandLine，解决大量对象文件链接时 cmd「命令行太长」）
  - 静态库归档对齐 Code::Blocks `LinkStatic` 模板（先删旧库再 ar，避免追加旧符号）
  - 对象目录 `CreateDirRecursively` 自动创建
  - `GetCommonTopLevelPath` 对象路径布局（`Output/obj/<公共顶层>/...`）
  - GBK 输出解码（中文 Windows 下 GCC 报错不乱码）
  - 目标类型数字映射（`type="1"` = 控制台应用，正确区分 `-mwindows`）
  - `max_reported_errors` 错误数截断（防构建日志卡顿）
  - 路径分隔符对齐 Code::Blocks（`UnixFilename(wxPATH_NATIVE)`）：Windows 下 `directory`/`library`/`output` 属性用反斜杠，保证 `map.txt` 等构建产物与 Code::Blocks 一致
  - 库输出文件名生成策略对齐 `SetupOutputFilenames`：`prefix_auto` / `extension_auto` 按 `.cbp` 属性控制 lib 前缀与扩展名（动态库 import 库强制平台默认）；Windows 扩展名比较大小写不敏感、multi-dot 全名追加
  - 外部依赖强制重链（`external_deps` / `additional_output` / 链接库 mtime 比对，缺失 WARNING）+ 编译器全局搜索目录（`default.conf`）+ 项目自定义变量（`codeblocks_project_custom_variables`）宏展开
  - 宏展开全集对齐 `MacrosManager::ReplaceMacros`：`$(#全局编译器变量[.成员])`（default.conf `/gcv`）、日期/工作区/编辑器/应用路径内置宏、未命中宏回退环境变量、`$$`/`%%` 反转义；展开覆盖最终命令、目录/选项组装与 pre/post 脚本
  - 构建 Banner 顺序/文案、up-to-date 判定与 post-build 门控对齐 Code::Blocks 状态机
- ⏹️ **编译随时停止**：构建通知上的 ❌ 按钮或命令 `Code::Blocks: Stop Build` 一键停止；Windows 下 `taskkill /T /F` 强杀整棵进程树（cmd → gcc → cc1/as/ld 无残留），取消不计入失败
- 🛡️ **Rebuild 确认**：Rebuild 前弹出模态确认框（对齐 Code::Blocks 的 Rebuild 确认），普通 Build 不弹窗
- 📄 **单文件编译 / 单文件 Clean**：工程树右键文件 → `Build File`（对齐 Code::Blocks `CompileFile`：DepsSearchStart + IsObjectOutdated 增量判断，命令与整目标构建字节级一致）/ `Clean File`（删对象与 `.depend` 依赖文件）
- 📊 **辅助工具**：代码统计、TODO 扫描、AStyle 格式化。

## ⚠️ 已知限制（不支持的功能）

以下 Code::Blocks 功能暂未移植，遇到相关配置时扩展会明确警告或跳过：

| 功能 | 说明 |
|------|------|
| **Squirrel 构建脚本**（`<Script file="*.script"/>`） | Squirrel 脚本引擎未移植，构建时输出警告并跳过 |
| **makefile 项目模式**（`makefile_is_custom="1"`） | 自定义 Makefile 项目未实现，构建仍走内部编译链路 |
| **跨卷对象路径** | 对象文件位于不同盘符时的相对路径处理未实现 |
| **console runner** | Code::Blocks 的 cb_console_runner 未移植 |
| **DAP 深层成员赋值** | 调试中修改变量值支持顶层变量与一层成员，二层以上嵌套暂不支持 |
| **其他工程模板** | sdl / glfw / qt / wxwidgets 等依赖外部库的模板未移植（当前 5 个基础模板） |

## 安装

### 从源码构建

```powershell
# 1. 安装依赖
npm install

# 2. 编译 TypeScript
npx tsc -p ./

# 3. 打包 VSIX
npx vsce package --allow-missing-repository

# 4. 安装
code --install-extension codeblocks-vscode-0.8.76-dev.vsix --force
```

> Windows 下建议使用 `npm.cmd` / `npx.cmd`（PSReadLine 执行策略）。

### 开发调试

```powershell
code --extensionDevelopmentPath="." --disable-extensions --new-window
```

## 使用

### 快速开始

1. 打开包含 `.cbp` / `.workspace` 的文件夹（自动检测并提示选择要打开的工程），或执行命令面板的 **`Code::Blocks: Open Project (.cbp)`**。
2. 左侧活动栏点击 **Code::Blocks** 图标，展开面板：
   - **Project**：工程树（多项目 + 嵌套目录 + 文件浏览；项目行悬停有 Build / Rebuild / Clean / Properties 快捷按钮）
   - **Analysis**：工程分析（按工程展示 `.cbp` 重要属性；悬停显示对应配置片段，点击在 `.cbp` 中定位，右键可复制；顶部为「最近构建」入口）
   - **Symbols**：符号浏览器（默认隐藏，可从 ⋯ → Views 调出或设置 `codeblocks.ui.symbolsView` 控制）
   - **Build Log**：结构化构建摘要，位于**底部 Panel 的「Build Log」标签页**（`Ctrl+J` 打开）
3. 状态栏最左为 **`⊞ Menu`**（Code::Blocks 菜单栏：点击弹出两级菜单，悬停就地展开常用命令链接）。
4. 状态栏另有 **构建目标（Target）**、**构建菜单（Build）**、**编译器（Compiler）**；构建菜单包含 Build / Rebuild / **Build Workspace** / **Rebuild Workspace**；构建中点击 Build 项可停止构建。

> 视图位置、大小可自由拖动，VS Code 自动保存并恢复；命令 **`Code::Blocks: Reset View Layout`** 一键恢复默认排布。

### 构建

- **构建**：状态栏 `Build` 按钮、`Ctrl+F9`，或菜单 `Build → Build`
- **全量编译**：状态栏 `Rebuild` 按钮、`Ctrl+F11`，或菜单 `Build → Rebuild`（**弹确认框**后执行）
- **清理**：`Ctrl+Shift+F9`，或菜单 `Build → Clean`
- **构建并运行**：`F9`
- **运行**：`Ctrl+F10`
- **停止构建**：构建通知上的 ❌ 按钮，或命令 `Code::Blocks: Stop Build`

> 构建为**增量编译**（源文件与 `#include` 头文件 mtime 比对，头文件更新也触发重编译）；`Rebuild` 对齐 Code::Blocks，先清理对象目录再全量重编译。链接库/外部依赖（`external_deps`）更新会自动触发重链接；Rebuild 后的纯增量构建不会重复执行 post-build 脚本（对齐 Code::Blocks）。

### 多项目管理

- 打开多个 `.cbp` 后，**Project** 视图按顺序列出各工程（顺序即编译顺序）
- 拖动工程节点可调整编译顺序；右键工程节点可 **上移/下移/移除**
- 点击工程节点将其设为**活动项目**（绿点标识），状态栏 Target/Compiler 针对它
- 右键工程节点：**增量编译 / 全量编译 / 添加文件**

### 文件操作（右键工程树文件节点）

- **打开文件**：单击文件节点
- **Compile File / Link File**：切换该文件是否参与编译/链接（写回 `.cbp`）
- **Remove File from Project**：从工程移除文件（保留磁盘文件，写回 `.cbp`）
- **Open Containing Folder**：在系统文件管理器中打开所在目录

### 错误定位与导航

- 构建失败后，**Build Log** 视图以树形展示错误/警告，点击节点精确定位到 `文件:行:列`
- **`F4`** 跳转下一个错误，**`Shift+F4`** 跳转上一个错误（循环）
- 错误数超过上限（默认 50，可在设置 `codeblocks.maxReportedErrors` 调整）时自动截断

### 快捷键（与 Code::Blocks 对齐）

| 功能 | 快捷键 |
|------|--------|
| Build | `Ctrl+F9` |
| Build and Run | `F9` |
| Run | `Ctrl+F10` |
| Rebuild | `Ctrl+F11` |
| Clean | `Ctrl+Shift+F9` |
| Debug / Continue | `F8` |
| Next Error | `F4` |
| Previous Error | `Shift+F4` |

### 命令

- `Code::Blocks: Open Project (.cbp)`
- `Code::Blocks: Build` / `Rebuild` / `Build and Run` / `Clean` / `Run`
- `Build File` / `Clean File`（工程树右键文件：单文件编译 / 单文件清理）
- `Code::Blocks: Stop Build`（编译随时停止）
- `Code::Blocks: Select Build Target`
- `Code::Blocks: Detect Compilers`
- `Code::Blocks: Compiler Options`
- `Code::Blocks: Debug`
- `Code::Blocks: Next Error` / `Previous Error`
- `Code::Blocks: Code Statistics` / `TODO List` / `Format with AStyle`
- `Code::Blocks: Generate compile_commands.json (IntelliSense)`

## 配置

| 设置项 | 默认值 | 说明 |
|--------|--------|------|
| `codeblocks.compilerId` | `gcc` | 默认编译器 ID（对应 `options_<id>.xml`） |
| `codeblocks.masterPath` | `` | 编译器安装根目录（留空则从 PATH 探测） |
| `codeblocks.parallelJobs` | `0` | 并行编译任务数（0 = 自动） |
| `codeblocks.saveBeforeBuild` | `true` | 构建前自动保存 |
| `codeblocks.compilerPrograms` | `{}` | 编译器程序完整路径（交叉编译器由探测自动写入） |
| `codeblocks.astyleOptions` | `["--style=allman", "--indent=spaces=4"]` | AStyle 格式化选项 |
| `codeblocks.maxReportedErrors` | `50` | 单次构建最多收集的错误数（0 = 不限制） |
| `codeblocks.build.verboseOutput` | `false` | 构建详细输出：完整编译命令行、Clean 逐文件删除列表、增量跳过列表（对齐 Code::Blocks 详细模式） |
| `codeblocks.build.skipIncludeDeps` | `false` | 增量编译跳过 `#include` 头文件依赖扫描（对齐 Code::Blocks /skip_include_deps 设置） |
| `codeblocks.clangd.enabled` | `true` | 是否启用 clangd 集成（自动生成 `compile_commands.json` 并更新 clangd 用户配置） |
| `codeblocks.clangd.buildLogDiagnostics` | `build` | 检测到 clangd 时 Build Log 的诊断来源：`build` = 构建引擎完整诊断（默认）；`clangd` = clangd 诊断（仅打开过的文件） |
| `codeblocks.clangd.forcedIncludes` | `["global.h"]` | clangd 分析头文件时强制预包含的基础头文件名（默认 `global.h`：typedef/macro/sfr/clib 上下文；勿用 `include.h` 这类全量主头文件，否则递归包含产生误报） |
| `codeblocks.clangd.suppressedWarnings` | `["-Wunused-function"]` | 在 clangd 诊断中压制的警告类别（嵌入式 SDK 常用静态函数做编译期断言，`-Wunused-function` 是预期噪声） |

## 架构

```
.cbp / .workspace (XML)
   → model/parser.ts        ProjectParser（.cbp/.workspace 解析）
   → model/types.ts         数据模型（TargetType / Project / BuildTarget / ProjectFile）
   → compiler/optionsLoader.ts   options_<id>.xml 完整解析（extends / 平台条件）
   → compiler/commandGenerator.ts  宏展开 + 命令行生成
   → build/buildEngine.ts    构建引擎（增量编译 + 派生进程 + 对象目录创建）
   → build/outputParser.ts   错误/警告解析 → VS Code Diagnostics
   → debug/gdbDebugAdapter.ts  DAP 调试适配器 → GDB MI
   → ui/projectTreeProvider.ts  工程树视图
```

### 源码结构

```
src/
├── extension.ts             扩展入口
├── model/                   .cbp/.workspace 解析 + 数据模型
├── compiler/                编译器模型 / XML 解析 / 命令生成 / 探测
├── build/                   构建引擎 / 输出解析 / 脚本执行
├── debug/                   GDB MI 会话 / DAP 适配器
├── tools/                   TODO 扫描 / 代码统计 / AStyle
└── ui/                      工程树 / 编译选项面板
```

## 交叉编译器（RISC-V 等）

扩展会从 `%APPDATA%\CodeBlocks\default.conf` 读取 Code::Blocks 的「用户自定义编译器」（`/compiler/user_sets/<id>`），自动解析其 `C_COMPILER` / `LINKER` 等可执行程序路径。因此 `.cbp` 中使用 `compiler="riscv32-v2"` 这类自定义编译器 ID 的工程，无需额外配置即可直接构建。

## 许可证

[GPL v3](LICENSE.md)。本项目从 Code::Blocks 源码（LGPL/GPL v3）移植核心逻辑，`resources/compilers/*.xml` 派生自 GPL v3 源码。
