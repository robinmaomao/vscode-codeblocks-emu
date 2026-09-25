# 提示词：从 Code::Blocks 源码解耦功能并原生移植为 VS Code 扩展

> 本提示词基于已就位的 **Code::Blocks 25.03 纯净源码**（`codeblocks-src/`，SVN rev 13644 基线）测绘编写，类名/文件名均为真实存在的符号，可直接投喂给 AI。

## 核心定位（一句话）
> **不是「`.cbp → tasks.json/launch.json` 桥接」**，而是把 Code::Blocks 的功能内核
> **原生移植**进 VS Code 扩展：扩展自身就是一个「迷你 IDE 内核」，直接承载项目模型、
> 构建引擎、编译器管理与调试引擎，像 CodeBlocks 的 `compilergcc`/`debuggergdb` 插件一样工作。
>
> - 构建：扩展内部直接生成并执行编译/链接命令（自行派生进程），不依赖 `tasks.json`。
> - 调试：扩展内部直接驱动 GDB/CDB（实现 DAP `DebugSession`），不依赖 cppdbg/CodeLLDB。
> - `tasks.json`/`launch.json`/`CMakeLists.txt` 仅作为可选的「导出/桥接」兼容能力，优先级最低。

---

```
你是一名精通 Code::Blocks 源码架构、C++/wxWidgets，以及 VS Code 扩展开发
（TypeScript + VS Code Extension API + Debug Adapter Protocol）的资深工程师。
请基于当前工作区已就位的 Code::Blocks 25.03 源码（位于 codeblocks-src/ 目录），
完成"源码解耦 → 原生移植 Code::Blocks 功能到 VS Code 扩展"的完整方案设计与实现提示。

【核心定位约束（务必遵守）】
本任务不是"解析 .cbp 生成 tasks.json/launch.json 再委托 VS Code"的桥接方案，
而是把 Code::Blocks 的核心功能**原生移植**进扩展内部：
- 扩展自己就是一个"迷你 IDE 内核"，直接承载项目模型、构建引擎、编译器管理、
  调试引擎，就像 Code::Blocks 的 compilergcc / debuggergdb 插件那样工作。
- 构建：扩展内部直接生成并执行编译/链接命令（自行派生进程），
  不依赖 VS Code 的 tasks.json；仅在需要与用户已有任务体系打通时可选暴露 TaskProvider。
- 调试：扩展内部直接驱动 GDB/CDB（实现 DAP DebugSession），
  不依赖 cppdbg / CodeLLDB 等现成调试器，也不依赖 launch.json 的预配置。
- tasks.json / launch.json / CMakeLists.txt 不作为核心产物，仅作为可选的"导出/桥接"
  兼容能力存在，优先级最低。

## 零、源码事实基线（已测绘，直接使用，勿臆造）
- 源码版本：Code::Blocks 25.03，SVN baseline rev 13644。
- 核心目录：
  - src/include/      —— SDK 公共头文件（接口层）
  - src/sdk/          —— SDK 实现（90 个 .cpp）
  - src/plugins/compilergcc/   —— 编译器 + 构建系统插件
  - src/plugins/debuggergdb/   —— GDB/CDB 调试器插件
  - src/plugins/codecompletion/—— 代码补全插件
  - src/src/          —— 主程序
- 关键许可证事实（务必遵守，详见"五、许可证合规"）：
  - src/include/ 与 src/sdk/ 的头文件标注 **LGPL v3**（如 compilercommandgenerator.h、
    compiler.h、cbproject.h 均声明 "GNU Lesser General Public License, version 3"）。
  - src/plugins/ 下的插件源码（compilergcc.cpp、codecompletion.cpp、debuggergdb.cpp 等）
    标注 **GPL v3**。
  - 顶层 COPYING 为 GPL v3。

## 一、第一阶段：源码结构测绘（先输出，作为解耦依据）
逐项分析并给出"源文件/类 → 职责 → wxWidgets 耦合点 → 解耦产物"四列表格：

### 1. 编译器与命令行生成（解耦最高价值区）
- 源：src/include/compiler.h、compilercommandgenerator.h、compileroptions.h、
  compileoptionsbase.h；src/sdk/compiler.cpp、compilercommandgenerator.cpp、
  compileroptions.cpp；src/plugins/compilergcc/compilergcc.cpp、directcommands.*、
  compilerMINGWgenerator.*、compilerOWgenerator.*。
- 重点接口（已确认）：
  - CompilerCommandGenerator::Init(cbProject*)、GenerateCommandLine(Result&, const Params&)、
    GetCompilerSearchDirs/GetLinkerSearchDirs(target)、SetupOutputFilenames/SetupIncludeDirs/
    SetupCompilerOptions/SetupLinkerOptions/SetupLinkLibraries 等。
  - 命令宏体系（compiler.h 中注释明确定义）：$compiler、$linker、$lib_linker、$options、
    $link_options、$includes、$libdirs、$libs、$file、$object、$link_objects、
    $exe_output、$static_output、$def_output、$resource_output、$objects_output_dir 等。
  - 编译输出分类 CompilerLineType（cltNormal/cltWarning/cltError/cltInfo）与 RegExStruct 数组
    （错误/警告行匹配正则，对应 VS Code problemMatcher）。
- 解耦要点：把"宏展开 + 选项拼接 + 编译/链接命令行生成"抽为无 UI 纯逻辑；错误行正则
  表直接映射为 problemMatcher 的 regexp 定义。

### 2. 项目/工作区/构建目标模型
- 源：src/include/cbproject.h、cbworkspace.h、projectbuildtarget.h、projectfile.h、
  projectloader.h、workspaceloader.h；src/sdk/cbproject.cpp、projectloader.cpp、
  projectbuildtarget.cpp、projectfile.cpp。
- 重点：cbProject、cbWorkspace、ProjectBuildTarget、ProjectFile、虚拟文件夹
  （FileTreeDataKind: ftdkFolder/ftdkVirtualGroup/ftdkVirtualFolder/ftdkFile）、
  .cbp/.workspace 的 XML（TinyXML）解析。
- 解耦要点：抽离 .cbp/.workspace 解析 → 内部对象图（cbProject/cbWorkspace/
  ProjectBuildTarget/ProjectFile），该对象图**直接驻留在扩展内部作为运行状态**，
  由扩展自己的构建/调试引擎直接消费，而不是转换为外部配置文件。

### 3. 调试器
- 源：src/plugins/debuggergdb/：debuggerdriver.*、debuggerstate.*、gdb_driver.*、
  gdb_commands.h、cdb_driver.*、cdb_commands.h、parsewatchvalue.*；
  src/include/cbdebugger_interfaces.h、debuggermanager.h。
- 重点：GDB/MI 与 CDB 命令构造 + 响应解析、断点/监视/调用栈/寄存器/内存数据模型。
- 解耦要点：抽离"MI 命令文本生成 + 响应解析"纯逻辑；UI 面板映射到 DAP
  （评估是否复用 cppdbg / CodeLLDB / native-debug，或自研 DAP 适配层复用其解析逻辑）。

### 4. 代码补全与符号浏览
- 源：src/plugins/codecompletion/：parsemanager.*、parser/（tokenizer/语法树）、
  classbrowser.*、doxygen_parser.*；src/sdk/ccmanager.*。
- 解耦要点：评估自研 C/C++ 解析器 vs 对接 clangd / cpptools IntelliSense；
  结合 GPL v3 合规给出结论。

### 5. 其它可移植纯逻辑
- 代码统计（行数/注释/空行）、TODO 列表（plugins/todo/）、AStyle 格式化调用
  （plugins/astyle/）、外部工具（toolsmanager.*）、代码模板/snippets（abbreviations/）。

## 二、第二阶段：解耦策略（每个功能域输出）
对每个功能域输出：
1. 依赖图：哪些类只依赖 STL/纯数据（可直接搬），哪些依赖 wxString/wxArrayString
   （用 std::string/std::vector 等价替换），哪些依赖 wxWidgets UI 控件（重写）。
2. 接口隔离方案：为可复用逻辑定义 C++ 纯接口（或直接 TypeScript 重写等价物），
   UI 侧通过适配层调用。
3. 是否值得复用 vs 重写：给出"复用 C++（WASM/N-API 编译）"与"TypeScript 等价重写"
   的成本/收益结论，重点针对 CompilerCommandGenerator 与 GDB MI 解析器。

## 三、第三阶段：VS Code 扩展架构设计（原生移植，非桥接）
1. 扩展形态：单个扩展 / 扩展包 / 多扩展；理由与边界。核心主张是"扩展即 IDE 内核"。
2. 语言与复用：主逻辑 TypeScript；C++ 纯逻辑复用方式评估（WASM / node-addon N-API），
   并注明许可证约束。
3. package.json 设计：
   - contributes：commands、debuggers（注册自定义 DAP 调试器）、languages、
     keybindings、snippets、menus、configuration、problemMatchers、views
     （侧边栏项目树/构建日志/监视面板）。
   - activationEvents 清单。
   - 注意：tasks 贡献点**不是核心**，构建由扩展内部进程管理实现，不生成 tasks.json。
4. 核心 TS 模块划分（对齐解耦产物，原生承载功能）：
   - projectModel：cbProject/cbWorkspace/ProjectBuildTarget/ProjectFile 的等价模型，
     常驻内存，含虚拟文件夹树、构建目标多态（Debug/Release）。
   - compilerRegistry：多编译器自动探测与配置（等价 CompilerFactory/Compiler）。
   - macroExpander：命令宏体系展开（$compiler/$options/$link_objects 等）。
   - buildEngine：构建图遍历 + 依赖排序 + 并行调度 + 直接派生进程执行编译/链接命令，
     并捕获 stdout/stderr（等价 compilergcc 的构建主循环）。
   - problemMatcher：编译输出错误/警告行解析与 Diagnostics 上报（等价 RegExStruct）。
   - debugSession（DAP）：实现 DebugSession 直接驱动 GDB/CDB 子进程（等价
     gdb_driver/cdb_driver/debuggerdriver），断点/监视/调用栈/寄存器/内存。
   - codeStats、todo、formatter（AStyle）等辅助模块。
   给出以上模块的接口签名草案。
5. 与官方扩展协同（避免冲突，而非依赖）：
   - 补全/符号：明确由本扩展接管还是委托 clangd/cpptools，二选一避免双补全。
   - 调试：本扩展提供自研 DAP；说明与 cppdbg/CodeLLDB 的冲突规避（同类型调试器唯一注册）。
   - 构建：与 CMake Tools / Makefile Tools 的关系——本扩展走 .cbp 自建构建，
     与它们互斥或明确分工。

## 四、交付物清单
1. 《源码模块 → 解耦产物 → VS Code 实现》对照映射表。
2. 解耦后的纯逻辑模块清单（类/函数级，标注来源文件 + wxWidgets 依赖点）。
3. package.json 骨架 + 核心 TS 接口/类设计（伪代码）。
4. 分阶段开发路线：
   P0 项目模型（.cbp/.workspace 解析） + 编译命令行生成 + 构建引擎（直接执行） +
      错误解析（problemMatcher）；
   P1 多编译器探测与配置 + 编译选项 UI；
   P2 自研调试引擎（DAP，直接驱动 GDB/CDB）；
   P3 补全/代码统计/TODO/格式化等辅助。
5. 风险清单（GPL 合规、GDB MI 兼容性、Windows 路径/GBK 编码、wxString 迁移、性能）。

## 五、许可证合规（必须单独、精确说明）
- 已确认事实：SDK 头文件 = LGPL v3；插件源码 = GPL v3；顶层 COPYING = GPL v3。
- 请据此明确：
  1. 复用 SDK（LGPL）纯逻辑的合规路径：动态链接 / 独立编译，需保留 LGPL 声明与
     可再链接性。
  2. 复用插件（GPL）源码的合规约束：整体 GPL 开源、进程隔离边界、不得闭源内嵌。
  3. 推荐路径：优先"重写等价逻辑"或"进程隔离复用"，避免 GPL 传染到闭源扩展；
     若接受整体 GPL 开源，则说明如何正确署名与附完整源码。
  4. 明确"翻译/移植"与"衍生作品"的界定，给出可执行的规避风险清单。

## 六、验收标准
- 能用该扩展打开 .cbp 项目，**不依赖 tasks.json/launch.json**，由扩展原生完成
  "解析 → 编译 → 链接 → 运行 → 调试"闭环。
- 构建引擎直接派生编译进程并实时回显日志；错误行能正确高亮并跳转（Diagnostics）。
- 自研 DAP 调试器能对多目标项目断点、单步、查看变量/调用栈/寄存器。
- 核心纯逻辑模块与 wxWidgets 零耦合，可独立单元测试。
- 许可证合规说明清晰、可执行、有明确边界。
```

---

## 附：本提示词的关键测绘依据（供你后续迭代参考）

| 事实 | 依据 |
|------|------|
| SDK 为 LGPL v3 | `src/include/compilercommandgenerator.h`、`compiler.h`、`cbproject.h` 头注释 |
| 插件为 GPL v3 | `src/plugins/compilergcc/compilergcc.cpp`、`codecompletion/codecompletion.cpp` 头注释 |
| 顶层许可证 GPL v3 | `COPYING` |
| 命令行宏体系 | `src/include/compiler.h` 的宏注释块（`$compiler`、`$options`、`$link_objects` 等） |
| 编译输出分类 | `CompilerLineType` 枚举 + `RegExStruct`（`compiler.h`） |
| 命令生成核心类 | `CompilerCommandGenerator`（`compilercommandgenerator.h`） |
| 虚拟文件夹模型 | `FileTreeDataKind` 枚举（`cbproject.h`） |
| 调试器结构 | `debuggergdb/` 下 `gdb_driver`、`cdb_driver`、`debuggerdriver`、`parsewatchvalue` |
| 补全结构 | `codecompletion/` 下 `parsemanager`、`parser/`、`classbrowser`、`doxygen_parser` |
