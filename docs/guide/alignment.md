# 与 Code::Blocks 对齐对照表

> 本扩展**原生移植 Code::Blocks 的构建/调试内核**：直接解析 `.cbp` / `.workspace`、内置其命令模板与宏展开引擎、直接派生进程执行编译/链接/调试，**不是** `.cbp → tasks.json/launch.json` 桥接。
> 本文档记录逐项对齐依据（对应 `codeblocks-src/` 源码位置）、扩展实现与有意保留的差异。
> 最后更新：0.8.137（2026-11-04）。功能级剩余项与不移植清单见 [未实现功能待办](../dev/backlog.md)。

## 1. 构建链路对齐

| 项 | Code::Blocks 依据 | 扩展实现 |
|---|---|---|
| 编译单元收集 | `directcommands.cpp GetCompileFileCommand`：compile=true 且可编译类型/自定义命令/PCH/生成器；compilerVar 空跳过；`GetTargetCompileCommands:558` 仅对过期单元生成命令 | `buildEngine.buildTarget`：compile=false 跳过、compilerVar 空 debug 跳过；自定义命令/可编译类型/PCH/生成器纳入；`isCompileCandidate` 保持条目计数语义 |
| 反引号展开（全命令） | `cbExpandBackticks`（compilergcc.cpp:1402）执行前统一展开，覆盖模板/自定义命令/脚本；`SearchDirsFromBackticks:1286-1337` 把 -I/-L 目录汇入搜索目录 | `expandBackticks` 模块级缓存；setup*Options 三处 + `renderTemplate` 末尾展开；目录汇入 `getCompilerSearchDirs`。保护性差异：单条命令超时 3s，失败按空串处理并缓存 |
| deps 扫描目录 | `m_CompilerSearchDirs` = `GetOrderedOptions(ortIncludeDirs)` 合并后的项目+目标目录（compilercommandgenerator.cpp:803-812）；`DepsSearchStart:1208` 逐个 ReplaceMacros 后 depsAddSearchDir | `getIncludeDirs` 用 `getCompilerSearchDirs`（关系合并 + 反引号目录），调用点宏展开 |
| 单文件编译/清理目标归属 | `GetBuildTargetForFile:3119-3145` 未归属/不属于当前目标 → 中止；`OnCleanFile:3297-3310` 只删对象文件 | `compileFile`/`cleanFile` 归属校验；cleanFile 仅删对象；compileFile 与整目标构建共用 `makeCompileUnit`（字节级一致）；右键 Build/Clean File |
| 链接对象收集 | `GetTargetLinkCommands`：`GetProjectFilesSortedByWeight(target,false,true)` 过滤 !link + 文件类型 | `file.link===false` + `isLinkableFileType` 双重过滤；资源文件独立 `$link_resobjects` |
| 链接对象组装 | `pfDetails::Update:579-583` 逐文件 `QuoteStringIfNeeded` + objectSeparator 拼接；`flat_object` 恒扁平命名 | 逐对象 `quoteIfNeeded` 后 join；`objectPathRelativeFlat`/`linkObjectRelativeFlat` 四处传参 |
| weight 排序 | `MySortProjectFilesByWeight`（升序，同 weight 字节序；0-100 合法，缺省 50） | `compareFilesByWeight`（字节序）；parser 显式区间判断（0 合法，非法保持 50） |
| COMPILER_WAIT 屏障 | 同 weight 并行，跨 weight 串行 | `runInParallel` 按 weight 分组；组内 PCH 先编译 |
| 并行任务数默认值 | `cbthreadpool.cpp:32-39`：≤0 → CPU 核数 | 默认 **8**（`parallelJobs`：0=自动、1=串行，支持文件夹级覆盖） |
| 增量编译 | `IsObjectOutdated`：源/头依赖 mtime；源缺失跳过；时间戳失败回退编译 | `isUpToDate` + `depsNewestMtime`（含注释/字符串剥离的 #include 扫描） |
| 链接跳过 | `GetTargetLinkCommands` 时间戳检查（输出 ≥ 全部对象） | `linkObjectsUpToDate`（共用 `src/build/outputPath.ts`；Windows 无扩展名补 `.exe`） |
| 外部依赖强制重链 | `AreExternalDepsOutdated`：库/`external_deps`/`additional_output` 比输出新 → 重链，缺失 → WARNING | `areExternalDepsOutdated`（先查外部依赖再判断最新；缺失同样 WARNING） |
| 链接输入（.ld 等）新鲜度 | 两路：① compile=1 列表文件过期即强制（`GetTargetCompileCommands:585` 条目计数；不可编译/空命令文件每次构建重链）；② compile=false 无自动识别，官方手段 = External dependencies | 复刻 ①：`staleNoopFiles` + `totalUnits>0` + `missingSourceFiles` → 强制链接/打包并附说明日志；② 保护性增强 `build.linkInputExtensions`（默认 `xm`，可配 `ld`/`*.ld`，`[]` 关闭）按 mtime 强制重链 |
| 链接命令类型映射 | `GetTargetLinkCommands` ttConsoleOnly/ttExecutable/ttDynamicLib/ttStaticLib/ttNative → ct* | `linkCommandType` |
| 选项关系合并 | `GetOrderedOptions`（5 种关系，项目/目标合并顺序） | `combineOptions` + `OptionsRelation` |
| 链接库构造 | `FixupLinkLibraries`/`SetupLinkLibraries`：项目+目标库 + 全局库；含路径库原样；剥前缀后才剥扩展；needsPathResolved；逐库引号 | `setupLinkLibraries`/`fixupLinkLibrary`/`pathSearchLibrary` |
| 编译器开关 | `forceFwdSlashes`；`Use83Paths` 短路径；`UseFullSourcePaths=false` 时 `$file` 相对 | `fixSep` / `shortPathWin` / `relativeFilename`；输出文件名 Quote 后 fixSep |
| `$objects_output_dir` | `GetObjectOutput()` + `FixPathSeparators` | `fixSep(target.objectOutput)` |
| 绝对路径 Unit 规范化 | `cbProject::AddFile`（cbproject.cpp:880-904）：同盘 `MakeRelativeTo`，跨盘/UNC 保留；Windows 不展开 `~`，Linux 展开 | `parseUnits` 同款（盘符不敏感）；前导 `~` 展开为家目录（保护性增强，等价 CB-Linux；`~user` 不展开）；方案 A 经用户确认 |
| makefile 项目模式子集 | `<Option makefile_is_custom>`：Build/Rebuild/Clean 走 `<MakeCommands>`（GetMakeCommandFor:2178-2197）；CompileFile/DistClean 未接 | `getMakeCommand` + `runMakeBuild`（$make/$makefile/$target 替换 + 宏展开，execution_dir） |
| host_application | 库/CommandsOnly 目标 Run：宿主程序 + executionParameters（compilergcc.cpp:2091-2126） | `run()` 分支（hostApplication 宏展开） |
| DAP 深层成员赋值 | `-var-assign` 直接 parent.member 链，失败逐层物化 | 同语义（parseChildVar 定位） |
| `$(#var.$(FIELD))` 嵌套与 `$if` | 变量名内嵌宏递归展开 + `$if{cond}{then}$else{else}$endif` | 括号配对扫描 `applyVars` + `expandName` + `applyConditional`（递归护栏） |
| 无项目单文件编译 | `CompileFileWithoutProject`（compilergcc.cpp:3174-3191：默认编译器 + 控制台模板 + 编译后询问运行） | 运行时构造 `vscode.Task`（ShellExecution + `$gcc` matcher），编译+链接到文件目录，成功后询问运行 |
| CommandsOnly 目标文件编译 | `GetTargetCompileCommands` 无类型过滤 + `Init:130-144` 空存根 → 文件照常编译（不带选项），链接跳过（882-886），post 按 hasCommands | 设置 `build.compileCommandsOnlyTargets`（默认 false 仅跑脚本；开启后对齐 CB：空存根编译 + 跳过链接），compileFile/collectCompileCommands 同门控 |
| Clean 目标选择 | `OnClean` 确认框（3385-3397）→ 只清理选中目标（虚拟目标展开组）；`OnCleanAll → CleanWorkspace`；`OnRebuildAll → RebuildWorkspace`（确认 → 清反引号缓存 → clean + build） | `clean()` 确认 + 只清理选中目标/虚拟组；`cleanWorkspace`（拓扑遍历）+ `rebuildWorkspace`（确认 → 清缓存 → clean + build） |
| Clean 状态机 | `GetNextStateBasedOnJob`（2368-2430）：clean-only 遍跳过 pre/post 脚本 | clean 仅逐目标 `cleanTarget`，不跑脚本；Rebuild = clean 遍 + build 遍（脚本只在 build 遍） |
| 无效编译器跳过 | `CompilerValid:1741-1754` + `PreprocessJob:2759-2764` 报错跳过；`PrintInvalidCompiler:1756-1786`（5 行 + 空行 + `Skipping...` 条目 + 尝试路径） | `resolveTargetCompiler`/`isCompilerUsable` + `reportInvalidCompiler`（共享 `invalidCompiler.ts`）同结构；文案适配 VS Code（`masterPath`/`compilerPrograms`/Detect Compilers）；尝试路径保护性补全；单项目 Rebuild 单遍只报一次；全跳过补 `Nothing to be done` |
| Run 前编译器校验 | `CompilerGCC::Run():1963-1986`：非 CommandsOnly / 非 null 需 CompilerValid；无效 → 同款消息 + `Run aborted...`（:1981） | `run()` 启动前同款检查（共享 `invalidCompiler.ts`）；无效中止并 `show(true)` 保证报错可见 |
| 平台不支持的目标跳过 | `PreprocessJob:2745-2764`：先 `SupportsCurrentPlatform` 警告（:2749-2756），再 CompilerValid 报错；任务为空 → `NotifyJobDone` 收尾 | `build()` 预过滤同序输出平台警告 + 无效编译器消息；全跳过补 `Nothing to be done`；`collectCompileCommands` 平台过滤保持静默 |
| 反引号缓存清理 | `cbClearBackticksCache`：Build/Rebuild/工作区构建入口调用；单目标 Clean 不清 | `clearBackticksCache()`：`build()` 开头 + `rebuildWorkspace()` 开头 |
| 生成文件（GenFilesHackMap） | `cbproject.cpp AddFile`：编译器 XML gen 属性、延后编译、对象命名、clean 删本体 | `generatedFiles.ts applyGeneratedFiles` + deferredUnits |
| 对象命名 | `pfDetails::Update/GetObjName`：flat/extended/.res/PCH/公共顶层；空 object_output → `.objs` | `objectPathRelative`/`pchObjectRelative`（fallback `.objs`） |
| 静态库/import/def 命名 | lib 前缀 + 扩展 + `GetStaticLibFilename`/`GetDynamicLibImportFilename`/`GetDynamicLibDefFilename`；import/def 基础名去扩展名（compiletargetbase.cpp:396/412）；静态 def 恒替换、动态 def 追加（687/704-716） | `computeStaticOutput`/`computeLibOutput`（insensitiveExt）+ `setupDefOutput` 分支化；`expandOutputBasename` 默认基础名；clean 同路径 |
| Clean 范围 | `GetTargetCleanCommands`（distclean=true）：对象 + deps 文件 + 生成文件本体 + 输出 + import 库 | `cleanTarget` 同范围（CommandsOnly 不删输出） |
| 输出目录创建 | 对象目录失败 DebugLog 继续；链接输出目录失败提示 | `ensureDir`：对象目录失败 debug 继续（编译器报真实错误）；链接/打包目录失败 error + 中止 |
| 构建 EnvVars | 不应用到编译命令（仅 Run/Debug） | 同样仅 Run/Debug |
| UseFullSourcePaths | gcc/clang XML 默认 true → 源文件绝对路径 | 始终绝对路径 |
| 资源文件短路径 | `GetCompileFileCommand`：windres 空格 bug → GetShortPath | `shortPathWin`（cmd `%~sI` + 缓存） |
| Use83Paths 目录 | `GetOrdered*Dirs` 目录存在时短路径 | `finalizeDir` |
| 编译随时停止 | 工具栏 Stop Build（中断队列 + 杀进程） | 通知 ❌ + `Code::Blocks: Stop Build`，`taskkill /T /F` 进程树强杀 |
| Rebuild 确认 | Rebuild 前确认对话框 | 模态确认框（关闭 = 无动作） |
| 项目自定义变量 | `cbproject SetVariable` + macrosmanager ReplaceMacros | parser 解析 `codeblocks_project_custom_variables` + 迭代替换 |
| 目标选择与构建过滤 | `platforms`（项目/目标级）：`GetPlatformsFromString` + `SupportsCurrentPlatform`；不支持目标从选择列表排除、构建跳过 | `supportsCurrentPlatform` + 构建/选择/默认目标三处过滤 |
| 文件归属过滤 | `GetProjectFilesSortedByWeight`：按 `pf->buildTargets` 过滤 | `target.files`（由 `file.buildTargets` 反查填充） |
| 错误/警告正则 | 编译器 XML 34 条全量加载；用户自定义正则 default.conf `/compiler_sets/<id>/regex/reNNN` 按索引覆盖/追加（`LoadSettings:699`） | `optionsLoader` + `CodeBlocksConfig.applyUserRegexes`（POSIX→JS 转换共享工具） |
| 多行错误消息 | 仅 GNU Fortran / XML multilinemessages 启用；C/C++ 恒 false → 逐行解析 | 逐行解析（等价） |
| 输出文件名宏展开 | `ReplaceMacros(outputfilename, target)` | `expandedOutputFilename` |

## 2. 输出与交互对齐

| 项 | Code::Blocks | 扩展 |
|---|---|---|
| Banner | `PrintBanner`（compilergcc.cpp:1786-1830）：Build/Clean/Build file；`-------------- <Action>: <target> in <project> (compiler: <name>)---------------` | `printBanner(action, target)`：build 循环（项目 pre 后每目标一次）、`cleanTarget` 开头、`compileFile` 开头；显示目标编译器 |
| up-to-date 提示 | "Target is up to date." | 「目标已是最新」 |
| post-build 门控 | 最后目标 `hasCommands` 或 alwaysRunPostBuildSteps 才跑项目 post | `hadCommands` 同语义 |
| 脚本命令结束判定 | 同步等待**命令本体**（`wxExecute`）：脚本启动的后台程序不阻塞构建 | `spawn` 的 `exit` 事件为结束信号 + 管道排空宽限（`build.scriptExitGraceMs` 默认 1500ms，0 = 完全对齐）；宽限是上限，退出后管道安静约 250ms 即继续，管道关闭立即继续 |
| 脚本命令编号 | 无（直接打印命令） | `[script 1-3]` 编号（有意增强，防链接误判） |
| 编译进度 | 逐文件 `Compiling/Compiled` | 单行完成式 `✔️ [Compiled] 123-248 xxx.c (2.0s)`（有意增强，无交错） |
| 错误/警告解析 | 编译器 XML 正则 + 严重级别 | 同正则移植 + 官方日志级别着色 |
| 编译输出编码 | 控制台/locale（中文 Windows 路径 GBK、源码摘录随源文件）；响应文件按 locale | 按**完整行**逐行判定 UTF-8/GBK（`src/tools/encoding.ts`），覆盖主构建、pre/post、Makefile、自定义工具、GDB；跨块残行保留；响应文件按系统 ANSI 代码页；`.cbp`/`.workspace` 保留原编码 |
| 工程文件外部修改 | `CheckForExternallyModifiedProjects`（projectmanagerui.cpp:3134）应用激活时比较 mtime，弹 Reload 选项；开关 `environment/check_modified_files` | `.cbp` change 事件 + 窗口焦点兜底（`projectChangeTracker.ts` 记录 mtime+size）；`重新加载`/`全部重新加载`/`忽略`；重载保留位置/活动工程/目标并关闭旧面板；自写盘不弹；开关 `detect.checkExternalChanges` |
| 编译选项对话框 | `CompilerOptionsDlg`：把 `options_<id>.xml` 列表写回 `cbProject`/`cbTarget`，由用户保存工程 | 面板 `codeblocks.compilerOptions` 勾选后**立即写回 `.cbp`**（保护性差异）；只管理 XML 内选项，手写自定义选项保留；失败可见，目标已改名/删除时报错不误写 |
| 快捷键 | F9/Ctrl+F9/Ctrl+F10/Ctrl+F11/Ctrl+Shift+F9/F8/Alt-F1/Alt-F2 | F9/Ctrl+F9/Ctrl+F10/Ctrl+F11/Ctrl+Shift+F9/F8 对齐；错误导航沿用 VS Code F4/Shift+F4（有意差异） |

## 3. 有意的差异（保留，不追求逐字节一致）

| 差异 | 原因 |
|---|---|
| 引号规则更宽（空格 + cmd 元字符 `& \| < > ^ ( )`；含空格的编译器程序名也加引号） | shell 二次解析防护；含空格库名的双层引号与 CB NeedQuotes 字节一致；`build.strictQuoting` 可切回 CB 严格模式 |
| 脚本编号、单行完成式日志、Emoji 汇总块、最慢 Top3 | VS Code 可读性增强（用户已确认）；`build.plainCbLog` 可关闭为纯 CB 日志 |
| 中文日志文案 | 面向中文用户；`log.english` 切换英文（汇总/状态类消息） |
| 输出目录创建失败：CB 模态弹窗 + 继续（必然失败）；扩展错误日志 + 中止目标 | 模态弹窗阻塞扩展宿主，与异步构建/随时停止冲突；中止更干净 |
| 响应文件长度阈值：CB 32767/131072；扩展 8000 | 命令经 cmd.exe 执行，受 8191 上限约束；分割/转义/命名等其余行为一致 |
| CommandsOnly 目标 post 执行一次（CB 执行两次） | CB 怪癖，不复制 |
| 时间戳粒度：CB 秒；扩展毫秒 | 毫秒更保守（同秒写入也触发重编/重链），不会漏编，仅可能多编 |
| 构建前自动保存文件 | CB 普通 Build 不保存；扩展在 Build/Rebuild/Clean/运行前统一保存（环境增强） |
| WORKSPACE_DIR 多根工作区 | VS Code 无「当前工作区目录」；优先 `.code-workspace` 目录，次首个文件夹，回退工程目录 |

## 4. 尚未实现（已知限制）

> 功能级剩余项、不移植清单与决策见 [未实现功能待办](../dev/backlog.md) §1/§2。本表只列扩展特有的实现限制。

| 功能 | 说明 |
|---|---|
| Squirrel 构建脚本 | `<Script file="*.script"/>` 未支持（警告跳过；已决策维持现状） |
| console runner | `cb_console_runner` 未移植（集成终端等价） |
| `forceCompilerUseQuotes` / `forceLinkerUseQuotes` | CB 命令生成本身未使用该开关（仅读写/UI），不实现 |
| EvalXMLCondition exec 分支 | CB 编译器 XML 条件 `<if exec="程序">` 会运行外部程序判定分支；扩展简化返回 default（gcc/clang XML 未使用） |
| default.conf 全局设置编辑（B1/B2/C4） | 评估后不做（2026-09-27 方案 A）：CB 本体退出/打开设置时会整文件覆写，竞态不可消；全局目录/选项/库/变量已被完整读取生效。替代：Settings → Default Config… 手工编辑 |
| Export Makefile 菜单位置（M1） | 命令已具备（当前在 **Tools** 菜单）；CB 在 Build 菜单（`compiler_menu.xrc:85-86`），记录待办 |

## 5. 菜单对齐（Code::Blocks 菜单栏 → 状态栏 Menu）

> 结构数据 `src/ui/menuStructure.ts`（`tests/test-menu-structure.js` 静态校验）；渲染 `src/ui/statusBarMenu.ts`（QuickPick：子菜单下钻 / 分隔线 / 快捷键标注 /「（无工程）」提示）。

| 顶级菜单 | Code::Blocks 依据 | 扩展状态 |
|---|---|---|
| File | `main_menu.xrc:4`（New/Open/Recent/Save*/Close*/Print/Quit；`projectmanagerui.cpp:840` 追加 Properties…） | 覆盖 New/New Project/New Project from Template…/Open Project/Save/Save As/Save All/Save Project as Template…/Close Editor/Close All Files/Quit；Recent 收第一级动态区（含 Clear）；Print 与 Save project/workspace 由 VS Code 原生菜单承担；Import Project… 支持 Dev-C++ `.dev` / VC6 `.dsp` / VS2010+ `.vcxproj`；用户模板存 `<globalStorage>/templates`（工程名 → `$(PROJECT_NAME)`） |
| Edit | `main_menu.xrc:140`（Undo/Redo/Cut/Copy/Paste/Highlight/Bookmarks/Folding/EOL/Encoding/Special commands/Comment/Goto matching brace/Show call tip） | 覆盖 Undo/Redo/Cut/Copy/Paste/Toggle+Block Comment/Folding/Case/Line/Select All/Select Next Occurrence/Goto Matching Brace/Swap header-source/Encoding/EOL/Highlight/Parameter Hints/Find Next·Previous Selected/Go to Previous·Next Change/Bookmarks 子菜单（`Alt+K/H/L`，按工作区存储）/Add Todo Item… |
| View | `main_menu.xrc:503`（Perspectives/Toolbars/Manager/Logs/Start Page/Script console/Status bar/Full screen/Focus/Switch tabs） | 覆盖 Project/Symbols/Analysis/Build Log/Problems/Terminal/Full Screen/Reset View Layout；Perspectives/Toolbars/Start Page/Script console 属 VS Code 体系差异 |
| Search | `main_menu.xrc:607`（Find/Find in files/Find next-prev/Replace/Goto line/Goto changed line；`projectmanagerui.cpp:828` 追加 Goto file） | 覆盖 Find/Find in Files/Find Next·Previous/Replace/Replace in Files/Goto Line/Goto File/TODO List/Open Include File（当前目录 → 目标 include 目录）；Find next/prev selected 与 Goto changed line 在 Edit 菜单 |
| Project | `projectmanagerui.cpp:825 CreateMenu`（Add files/recursively/Automatic source paths/Remove/Project tree/Set programs' arguments/Notes/Properties；compiler 插件插 Build options…，`compilergcc.cpp:596`） | 覆盖 Add Files（无节点回退活动工程）/Project tree（Move up·down、Activate prior·next、Categorize by File Types）/Build Options/Notes/Set Programs' Arguments/Properties/Workspace Dependencies…（`.workspace <Depends>` 编辑 + 环路检测）/目标上·下移/Create Project from Target…；Add files recursively、Automatic source paths、Remove files…（多选）未移植 |
| Build | `compiler_menu.xrc`（Build/Compile current file/Run/Build and run/Rebuild/Clean/workspace 三连/Abort/Errors/Select target/Export Makefile） | 覆盖 Compile Current File（Ctrl+Shift+F9）/Build·Rebuild·Clean Workspace/Abort/Errors（Previous·Next·Clear All）/Select Target/Export compile_commands.json/Export Makefile…（当前在 Tools 菜单，M1 待办） |
| Debug | `debugger_menu.xrc`（Start-Continue/Break/Stop/Run to cursor/Step/指令步进/Set next statement/Breakpoints/Add symbol file/Debugging windows/Information/Attach/Detach/Send user command） | 覆盖 Start-Continue/Break/Stop/Step Over·Into·Out/Toggle Breakpoint/Run and Debug 视图；Run to cursor、Set next statement、单指令步进、Attach、Detach、Add Symbol File…、Send user command、反汇编/内存/寄存器、异常断点、Debug Information 子菜单（`info frame/sharedlibrary/files/float/signals`）已移植；工程级 `<debugger><search_path>` 与 `<remote_debugging>` 已支持 |
| Tools | `main.cpp:1387` ToolsManager.BuildToolsMenu + tool 插件（AStyle / Code statistics） | 覆盖 Detect Compilers/Code Statistics/Format with AStyle/Configure tools…（`codeblocks.tools` + 动态条目 + 三种输出模式）/Show Compiler Commands…/Export Makefile… |
| Settings | `main_menu.xrc:692`（Environment/Editor/Compiler/Debugger/Global variables/Backtick Cache/Scripting） | 覆盖 Environment/Editor/Compiler/Debugger（映射设置过滤串）/Global Variables（只读查看，选中复制）/Backtick Cache（清空）/Default Config…（打开 default.conf 手工编辑，B1/B2/C4 替代入口）；Scripting 无脚本引擎 |
| Plugins / Help | `main_menu.xrc:684/723` | 有意不移植（VS Code 扩展体系与原生 Help 承担） |

**调试器能力对齐**：DAP 扩展至 VS Code 原生窗口 —— `disassemble`（反汇编）/ `readMemory`·`writeMemory`（Memory，指针 `memoryReference`）/ `dataBreakpoints`（watch·rwatch·awatch）/ `supportsSteppingGranularity` / 命中次数与日志断点 / `gotoTargets`·`goto` / `setExceptionBreakpoints`（throw·catch）/ `attach`（`-target-attach`）/ Registers 视图；Send user command 双通道（命令面板 + Debug Console `-` 前缀）。`debugger.disableInit`（默认 true → GDB `-nx`）对齐 `disable_init`。源：`src/debug/gdbDebugAdapter.ts`、`miParse.ts`、`debugRegistry.ts`、`src/ui/registersTreeProvider.ts`。

**快捷键**：F9/Ctrl+F9/Ctrl+F10/Ctrl+F11/Ctrl+Shift+F9/F8 与 CB 一致；新增安全键 Alt+F5/F6（Activate prior/next project）、Alt+F1/F2（错误导航）、Alt+G（Goto file）、Shift+F2（Manager→Project）、Ctrl+Shift+R（Replace in files）、Ctrl+Shift+Up/Down（Project tree 移动）、Ctrl+E（选择下一个匹配）。与 VS Code 默认冲突的 CB 键位由 `keybindings.cbStyle` 门控（默认关闭）；`Check Keybinding Conflicts` 三源报告冲突。

**快捷键托管**：`keybindings.overrides`（30 项）为唯一数据源，变更物化写入用户 `keybindings.json`（正向条目 + `-command` 移除规则；空 = 解绑；仅增删托管条目；首次备份，回读校验失败回滚）。命令：Apply / Configure / Reset；`Keybinding Settings` 面板支持搜索、按键捕获、解绑、恢复默认、导入导出方案；设置页内嵌 `command:` 链接直达面板。

**Set programs' arguments**：目标级 `<Option parameters>`（`executionParameters`）支持属性面板编辑与序列化写回。

## 6. 测试保障

- 全量回归（`npm test`）与分层测试（契约 / 无头 / E2E / 视觉 / 性能 / 打包 / 宿主）覆盖解析/序列化、选项关系、对象命名、权重排序、响应文件、静态库、生成文件、取消源、外部依赖、自定义变量、宏展开、模板、菜单结构、工程导入、Makefile 导出（含 mingw32-make 真机构建）、工作区依赖、头文件保护、注释整理、自定义工具等。分层与环境约束见 [测试方案](../testing/strategy.md)，逐项覆盖见 [测试覆盖矩阵](../testing/coverage-matrix.md)。
- 无头真实构建校验（`test-project/headless-build-check.js`）：真实 GCC 编译/链接静态库→可执行链路、外部依赖 touch 强制重链、双目标脚本执行次数与顺序。
