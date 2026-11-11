# 手工验收清单（L6 · 不可自动化项）

> 本清单覆盖**自动化难以稳定判定**的交互与视觉项。执行前先完成：
> `npm run compile && npm run bundle && npm run bundle:search`，然后按「开发调试」方式启动扩展宿主（`F5`，或 `code --extensionDevelopmentPath=<仓库路径> test-project`）。
> 建议用仓库内 `test-project/`（3 个 `.cbp` + 1 个 `.workspace`）与 `test-project/dep-test.workspace` 作为验收工程。
>
> 记录方式：逐项勾选并截图留档（原生 UI 不做像素门禁，截图仅作回归留档与问题复现证据）。

## 1. 工程树与项目管理

- [ ] 打开 `test-project`：自动检测并弹窗多选打开 `.cbp`（默认全选，显示目录名/文件名）
- [ ] 状态栏 `Code::Blocks` 入口可随时重新打开工程
- [ ] 同时打开 `hello-cb.cbp` 与 `dep-test.workspace`：工作区依赖项目全部打开、活动项目高亮
- [ ] 工程树层级：项目 → 构建目标 → 文件；虚拟文件夹多层展开；缺失文件有标记
- [ ] 目录优先排序与 VS Code Explorer 一致；文件类型图标（C/C++/头文件/汇编/链接脚本）正确
- [ ] **拖拽排序**项目节点（即编译顺序）后构建顺序随之改变；上移/下移按钮等效
- [ ] 右键「移除项目」后树与状态栏同步；`激活下一个/上一个项目` 键位可用
- [ ] 目标右键「设为活动目标」后状态栏与树高亮同步
- [ ] **外部修改检测**：用其它编辑器给已打开工程的 `.cbp` 增加一个 `<Target>`（或删除一个 `<Unit>`）→ 切回 VS Code 应弹「工程…已在磁盘上被修改，是否重新加载？」；选「重新加载」后目标/文件立即刷新（活动工程与已选目标保持），选「忽略」后不再重复弹
- [ ] **外部修改检测（网络盘/工作区外）**：把工程放在工作区目录之外（或加入 `files.watcherExclude`）后重复上一步 → 仅靠**窗口获得焦点**也应弹出询问
- [ ] 扩展自己改工程（如右键「编译文件」开关、`设置程序参数`）后**不应**弹出外部修改提示
- [ ] 命令 `Code::Blocks: 从磁盘重新加载工程`（工程树右键 / Menu → Project）可手动刷新；`codeblocks.detect.checkExternalChanges=off` 时不自动检测但手动命令仍生效

## 2. 状态栏 Menu（9 大顶级菜单）

- [ ] 状态栏 `Menu` 打开顶级菜单列表，顺序与 Code::Blocks 一致
- [ ] 逐级进入子菜单（File/Edit/View/Search/Project/Build/Debug/Tools/Settings）均非空且可返回
- [ ] 子菜单项快捷键展示与实际键位一致（与 `keybindings.json` 同步）
- [ ] 悬停分组标题正确渲染（不出现裸 `group@n` 文本）
- [ ] 「Build」子菜单：Build/Rebuild/Clean/Compile File/Stop 均指向正确命令

## 3. 构建交互

- [ ] 状态栏构建按钮实时反映状态（空闲/构建中/失败/成功）
- [ ] 构建通知带 ❌ 停止按钮；点击后 Windows 进程树（cmd→gcc→cc1/as/ld）无残留
- [ ] Rebuild 弹出模态确认框；普通 Build 不弹窗
- [ ] 增量构建：第二次构建提示 up-to-date（无编译命令输出）
- [ ] 触碰头文件后构建触发重编译；触碰 `external_deps` 触发重链
- [ ] 构建失败 → Problems 面板错误可点击跳转；状态栏与通知文案一致
- [ ] **链接期诊断定位**：Build Log 的 Errors 条目（`<obj>:(.text+0xN)` / `<src>:(.text+0xN)` 形式的 `undefined reference`）点击能落到真实源码/调用行；`.o` 对象文件不会作为跳转目标
- [ ] **无源码位置诊断**：`ld.exe: cannot find -lfoo`、`collect2.exe: error: ld returned 1 exit status` 等条目显示「无源码位置（链接器/工具输出）」且不提供跳转（点击无反应属预期）
- [ ] **ANSI 颜色输出**：工程给编译器加 `-fdiagnostics-color=always` 后，Build Log 仍列出错误且可跳转，输出面板无 `[01m` 噪声
- [ ] **失效路径反馈**：点击一个构建后被删除的诊断文件路径会弹出可见警告，而不是点击无反应
- [ ] 构建日志面板：错误过滤开关、清除输出、复制消息、诊断复制均可用
- [ ] 构建日志中文件名/命令行含空格时不截断
- [ ] **CB 产物体积行**：任一可执行目标链接成功后，输出通道出现 `Output file is bin\Debug\xxx.exe with size N.NN KB`（体积与磁盘上文件一致，两位小数、`bytes`/`KB`/`MB` 三档）；勾选 `codeblocks.build.plainCbLog` 后**仍然出现**该行（此时无 `✔️ [Linked]` 摘要行）；静态库目标打包后同样出现（`.a`）；产物被删/链接跳过的场景不出现
- [ ] **脚本输出实时流式**：post-build 脚本 echo 一行后睡眠数秒 —— 该行应**立即**出现在构建日志（缩进两空格），而不是等脚本结束才出现
- [ ] **长命令心跳行**：脚本命令运行超过 5s 起，每 5s 出现 `[script i-N] 仍在运行 (x s)…`（首条含「网络盘/服务等待…或点『停止构建』终止」提示）；`plainCbLog` 模式下无该行
- [ ] **脚本命令超时**：设 `codeblocks.build.scriptCommandTimeoutMs=3000` 后运行 8s+ 的 post-build 命令 → 约 3s 后日志出现「超时（… 已终止该命令）」、构建记为失败、任务管理器无残留子进程；默认值 0 时不超时
- [ ] **超时不留残兵（逃逸后台进程）**：脚本写法 `ping -n 5 127.0.0.1 >nul` 后接 `start "" /b <长驻程序>`，把超时设在 3.9~4.1s（正压在前台等待结束附近）——杀树后 10s 内任务管理器不应出现该后台程序（修复前可稳定复现逃逸，实测存活 >10s）
- [ ] **超时连带终止脚本启动的后台程序**：同上脚本，超时点在 `start /b` **之后**（例如 `start /b <长驻程序>` 后再 `timeout /t 20`）→ 超时后该后台程序应被一并终止（超时语义 = 终止整棵命令树）
- [ ] **post-build 后台进程不阻塞**：脚本里 `start "" /b <命令>` 启动后台程序时，命令本体结束即继续构建，日志出现「后台进程仍在运行（不阻塞构建…）」说明行；`codeblocks.build.scriptExitGraceMs=0` 时立即收口（严格对齐 CB）
- [ ] **安静期提前继续（宽限是上限）**：与上一条同一脚本，`scriptExitGraceMs` 保持默认 1500 —— 命令本体退出后约 0.25s 即继续（构建日志时间戳/gif 观察，明显快于 1.5s）；把宽限设为 60000 仍约 0.25s 收口（后台程序持续输出时才会等到上限）
- [ ] **并行任务数默认 8**：`codeblocks.parallelJobs` 未配置（或恢复默认）时，任务管理器观察大工程并发编译进程 ≤ 8（此前自动值为逻辑核数 × 2）；显式设为 16 立即升到 16，设为 1 退化为串行，设为 0 按当前主机逻辑核数自动（`min(逻辑核数, 32)`；升级时显式 0 会一次性迁移为 8）；文件夹级设置（多根工作区的 `.vscode/settings.json`）同样生效
- [ ] **进程预算收敛**：`codeblocks.parallelJobs` 设为 `0` 或 `32` 构建大工程 → 输出通道打印「并发已按进程预算收敛：请求 N → 实际 M」，且 `M ≤ max(8, 逻辑核数)`；设 `1`/`8` 时**不应**出现该行（未被收敛）
- [ ] **编译/链接命令不再经过 cmd.exe**：`codeblocks.build.profile = true` 构建 → `[profile]` 中出现「去 shell 直接派生次数」，且与「spawn 次数」相等（自定义 `buildCommand` 用 `echo`/`copy` 等 cmd 内建命令时，该条走 shell 属预期）
- [ ] **进程统计行**：`codeblocks.build.traceProcesses = true` 构建 → 结束打印「本次构建启动的子进程：N 次，同时存活峰值 P（并发上限 M，逻辑核数 C）」；`parallelJobs=1` 时 `P = 1`；`plainCbLog` 模式下同样出现
- [ ] **PCH 旧产物删除仍在**：含 PCH 头文件的工程 Rebuild → 旧 `.gch` 先被删除再重编（构建日志无 `cmd /c if exist … del …` 命令行回显，但产物行为一致）
- [ ] **构建期不生成编译数据库**：构建进行中修改任意 `codeblocks.clangd.*` 或切换活动工程 → 输出「构建进行中：编译数据库生成推迟到构建结束」；构建结束后补一条「补执行构建期间推迟的编译数据库生成」，随后 clangd 正常索引
- [ ] **诊断批量发布（Problems）**：大警告量工程（数百条警告）构建期间 Problems 面板仍逐步刷新（约 0.2s 一次批量），构建结束后条目数/位置/级别与逐条发布一致；构建中执行「清除全部编译错误」后待发布诊断不复活
- [ ] **慢脚本可定位**：post-build 命令自身超过 3s 时，日志给出 `[script i-N] 耗时 x.xs（命令自身运行时）` 行；`plainCbLog` 模式下无上述两类提示行
- [ ] **编译输出编码（中文 Windows）**：在含中文的目录/文件上制造编译错误（如 `#include "不存在.h"`）→ 构建日志里「文件路径」与「源码摘录行」都不乱码（两者编码可能不同）；pre/post 脚本 `echo 中文` 也正常显示
- [ ] **旧 ANSI 工程**：用 ANSI(GBK) 保存的 `.cbp` 打开 → 工程树中文标题/文件名正常；在该工程上「添加文件」后文件仍是 GBK 编码（不被静默转成 UTF-8）
- [ ] **超长命令 + 中文路径**：构造超长链接命令（>8000 字符，对象路径含中文）→ 生成的 `.respFile` 能被 GCC 正常读取（链接成功、无「找不到文件」乱码）

## 4. WebView 面板交互

- [ ] 工程属性面板 9 个 tab 逐一切换无报错；修改后「保存」写回 `.cbp` 并刷新工程树
- [ ] **未切换过 tab 直接保存**：只改「构建目标」页标题后点「保存」→ 保存成功（不再抛 `TypeError` 静默失败）
- [ ] **窄面板布局**：把面板拖到约 500 px 宽 → 「添加/复制/删除/上移/下移/导出为工程」按钮水平排列（可换行），左侧列表与右侧表单上下堆叠、表单不再被挤成细条
- [ ] **英文界面**：`codeblocks.ui.language=en` 打开工程属性面板 → tab/表单正常渲染、保存可用（英文译文含撇号时不得使内联脚本失效）
- [ ] 「保存并关闭」与仅「保存」行为区分正确
- [ ] 目标增删改/复制、虚拟目标 alias 多选、文件归属多选即时反馈
- [ ] 构建选项 tab 的 OptionsRelation 5 个下拉可保存并回读一致
- [ ] 搜索目录、构建脚本（`<Script file>` + pre/post 命令）编辑生效
- [ ] 备注 tab 的 CDATA 内容与 `show_notes` 开关往返正常
- [ ] 调试器 tab：search_path 增删、remote_debugging 各目标配置保存后可回读；目标改名/删除后该目标的远程配置随目标同步（不产生孤儿 `remote_debugging` 节点）
- [ ] 快捷键面板：录入（含组合键 `ctrl+k ctrl+s`）、手动输入、解绑、恢复默认、全部重置、检查冲突、导出/导入方案
- [ ] 编译选项面板：勾选后写回 `.cbp`（重开工程/面板状态保持）；工程属性页手写的自定义选项（如 `-pipe`）不被清除；面板状态区显示「已应用」
- [ ] 面板 `retainContextWhenHidden`：切走再切回不丢失未保存输入

## 5. 调试（真实 GDB）

- [ ] F5（无 `launch.json`）直接以活动目标启动调试；`Select and Start Debugging` 可见 `Code::Blocks GDB`
- [ ] 断点：普通/条件/命中次数/日志消息；命中与跳过行为正确
- [ ] 单步：Step Over/Into/Out 与指令级单步；`Set Next Statement`、运行到光标
- [ ] 变量：局部/全局、深层成员展开、双击修改值生效
- [ ] 调用栈切换帧后变量视图与源码定位同步；线程视图切换正常
- [ ] Watch/表达式求值；Debug Console 中 `-` 前缀透传 MI 原生命令
- [ ] Memory 视图跳转与编辑；Registers 视图刷新；反汇编视图滚动定位
- [ ] 数据断点、异常断点、指令断点、附加进程/Detach、Add Symbol File 均可用
- [ ] 多调试会话：聚焦会话优先路由，切换会话输出不串台
- [ ] 程序 stdout/stderr 转发到 Debug Console（MinGW GDB 兼容）

## 6. IntelliSense / 符号 / 辅助工具

- [ ] `generateCompileCommands` 后工作区外缓存生成 `compile_commands.json`，clangd 配置更新（未装 clangd 时回退轻量补全）
- [ ] **补全不自动插入头文件**：接受一个未包含头文件的符号补全（如 `printf`）后，编辑区**不**自动插入 `#include`；`%LocalAppData%\clangd\config.yaml` 中扩展片段含 `Completion:` / `HeaderInsertion: Never`
- [ ] **失效片段自动清理**：把某个已打开工程移动到别处（或删除）后重新生成配置 —— 输出通道出现「已清理 N 个失效 clangd 配置片段」，`config.yaml` 中该作用域的 `# >>> codeblocks-vscode <hash> begin` 段消失，用户自有内容与其它作用域片段保持原样；随后执行命令 `Clean Stale clangd Config Fragments`（状态栏 → Settings → 清理 clangd 遗留配置）应提示「配置干净」
- [ ] **手动清理 + 预览**：手工在 `config.yaml` 里造一个失效作用域片段（把 `PathMatch` 指向不存在的目录，标记保持扩展格式）→ 执行清理命令：输出通道列出该片段（hash + 作用域 + 原因），确认后片段被移除、文件无悬空 `---`；点「取消」则文件不变
- [ ] **配置由用户决定**：把 `codeblocks.clangd.unusedIncludes` 设为 `omit` 后重新生成 → 扩展片段里**不再有** `UnusedIncludes` 行；在 `codeblocks.clangd.extraConfig` 里填 `Diagnostics:\n  MissingIncludes: Strict` → 生成的片段中含带 `If.PathMatch` 的**后置**片段（可覆盖扩展键）；填一个含制表符的值 → 输出通道出现 extraConfig 语法提示
- [ ] **--query-driver 配置**：执行命令 `Configure clangd --query-driver`，选择「仅复制到剪贴板」→ 剪贴板 JSON 含 `--query-driver=<工程编译器目录>/*` 且保留原有 `clangd.arguments`；选择「写入工作区设置」并确认后 `.vscode/settings.json` 出现该参数；把 `codeblocks.clangd.builtinHeaders` 设为 `queryDriver` 后重新生成 → 扩展片段含 `BuiltinHeaders: QueryDriver`
- [ ] **clangd 设置改动立即生效**：打开工程后把 `codeblocks.clangd.suppressedWarnings` 改成含 `-Wempty-body` 的数组并保存 → 不重开工程、不手动执行命令，输出通道出现「codeblocks.clangd 设置已变更，按新设置重新生成 clangd 用户配置」与「已更新 clangd 用户配置」，`%LocalAppData%\clangd\config.yaml` 本工程片段的 `Diagnostics.Suppress` 出现 `- -Wempty-body`
- [ ] **clangd 设置取值容错**：把 `codeblocks.clangd.suppressedWarnings` 手改成字符串（如 `"-Wunused-function, -Wempty-body"`）→ 输出通道提示「取值类型不正确…检测到字符串（已按逗号/分号/空白拆分）」，片段正常写入两项且**无** `- -`、`- W` 之类单字符项；改成数字（如 `42`）→ 提示「类型非法（已回退默认值）」且片段回退默认两项
- [ ] **G1 改编译器立即生效**：打开工程并打开一个 `.c` 文件后修改 `codeblocks.compilerPrograms`（把 `C`/`CPP` 指向另一工具链程序）→ 不重开工程、不手动执行命令：底部状态栏 `Compiler:` 立即刷新，输出通道出现「编译器设置已变更，按新编译器重新生成 clangd 编译数据库」+「已重新生成 compile_commands.json」+「编译器设置已变更，重启 clangd 以刷新已打开文件」；把 `codeblocks.clangd.restartOnActiveProjectSwitch` 设为 `false` 后重复上述步骤 → **仍然会重启**（编译器变化不提供关闭项）；未打开任何 C/C++ 文件时重复 → 只重新生成、不重启
- [ ] **G3 persistLog 重载提醒**：把 `codeblocks.build.persistLog` 由 `false` 改成 `true` → 弹出提醒「需重载窗口后生效」+ 按钮「重载窗口 / 稍后」；点「重载窗口」窗口重启，输出历史开始写盘跨窗口保留；点「稍后」则本次窗口行为不变（重载后生效）
- [ ] **G4 关闭 clangd 集成提醒**：在已生成过 clangd 配置的机器上把 `codeblocks.clangd.enabled` 由 `true` 改成 `false` → 弹出提醒「仍有 N 个扩展片段会被继续读取」+ 按钮「打开 clangd 配置 / 稍后」；点前者在编辑器打开 `%LocalAppData%\clangd\config.yaml`；值未变化（如再次保存）时不重复弹窗；从未生成过配置的机器上关闭 → 不弹窗（无遗留）
- [ ] Symbols 视图按 函数/宏/类型/变量 分组，点击跳转准确
- [ ] Analysis 视图：概览/文件/目录/目标/虚拟目标/历史/备注各页可展开
- [ ] 代码统计、TODO 列表、书签（切换/上一个/下一个/全部清除）行为正确
- [ ] 一行工具：格式化（AStyle）、插入头文件守卫、注释整理、swap header/source、运行外部工具
- [ ] 设置面板中「快捷键」相关命令跳转与写入正确

## 7. 文档与资源一致性

- [ ] README 截图与当前界面一致（`docs/images/*` 需在重大 UI 变更后更新）
- [ ] 使用说明/对齐对照中的操作路径与实际菜单一致
- [ ] 打包产物（`vsce package` 后 VSIX）安装到干净用户配置目录可用
- [ ] `docs/dev/i18n.md` 的批次台账与仓库实际状态一致（`node tests/test-i18n-dict.js` 输出的迁移点数、词条数）
- [ ] 新增/修改任何用户可见文案后：`node tests/test-i18n-nls.js`（静态）、`node tests/test-i18n-dict.js`（运行时词条）、`node tests/test-code-conventions.js`（已迁移文件禁用中文字面量）、`node tests/test-i18n-logT.js`（构建日志 `logT` 语义）四者全绿
- [ ] WebView 面板模板新增文案后：`node tests/test-i18n-webview.js`（插桩点 ↔ 反查表双向一致、中英两态内联脚本可编译）全绿

## 8. 界面语言（中英文，0.8.132 起）

> 约定与批次范围见 [国际化](../dev/i18n.md)；以下每项都需**中英各跑一轮**（VS Code 显示语言中文 / 英文各一次）。

- [ ] **静态贡献跟随显示语言**：显示语言为中文时，命令面板显示 `Code::Blocks: 新建工程`、设置界面描述为中文、视图名显示「工程 / 符号 / 分析 / 构建日志 / 寄存器」；切英文后同类文案全部变英文（**需重载窗口**）
- [ ] **视图欢迎语**：Project 视图空态欢迎语随显示语言切换（中/英），`command:` 链接可点击
- [ ] **运行时默认（`auto`）**：显示语言中文 → 弹窗/QuickPick/状态栏为中文；显示语言英文 → 为英文
- [ ] **强制切换**：命令 `Code::Blocks: Switch UI Language…` → 选 `English`，QuickPick 立刻以英文提示结果、给出「Reload Window」按钮；后续弹窗/状态栏为英文，**命令面板标题仍跟随显示语言**（混语言为预期，提示里已说明）
- [ ] **即时生效**：改设置 `codeblocks.ui.language` 为 `zh-cn`（不重载窗口）→ 状态栏 tooltip（如「点击选择编译器」）与下一个弹窗立刻变中文
- [ ] **面板标题刷新**：打开工程属性面板 → 切换语言 → 面板**标题**立即变化；正文/标签在重新打开后按新语言渲染（旧面板不丢未保存编辑）
- [ ] **状态栏菜单**：状态栏 `$(menu) Menu` → 一级列表「构建顺序 / N 个 / 选择菜单」与二级 `（无工程）` 标注随 `ui.language` 切换
- [ ] **构建悬停菜单**：悬停状态栏 Build 项 → 空闲态标题「构建菜单 / Build menu」与底部提示随 `ui.language` 切换；构建中显示「**构建进行中（Ns）** / **Building (Ns)**」且秒数累加、`停止构建` 链接可点（命令链接文字沿用 Code::Blocks 菜单命名，见 [国际化](../dev/i18n.md) §4）
- [ ] **异常路径文案**：无工程时执行 `Code::Blocks: Build`（提示「请先打开一个 Code::Blocks 项目 (.cbp)」）中英两态一致且可读
- [ ] **构建日志（批次 2 已全覆盖）**：英文显示语言下输出通道日志为英文；切回中文即中文。另设 `codeblocks.log.english=true` 时**恒定英文**（对齐 CB 原文，与 `ui.language` 无关），关闭后回到跟随 `ui.language`
- [ ] **构建阶段剖析**：`CB_BUILD_PROFILE=1` 构建 → `[profile]` 块的标题/分组/计数单位随语言切换（`Build phase timings` ↔ 「构建阶段计时」）；`log.english=true` 时恒英文
- [ ] **性能顾问开关（`build.performanceAdvisor`）**：默认（`false`）构建 → 输出通道不再出现 ⚠️ 归因行（宿主卡顿/杀软/扫描器/CPU 饱和/低内存）；`build.profile=true` 或 `build.sampleSystem=true` → 自动恢复；仅把 `performanceAdvisor` 设为 `true`（不开 profile）→ 只出现归因行、无 `[profile]` 块
- [ ] **树视图节点**：工程 / 符号 / 分析 / 构建日志 / 寄存器视图的节点、分组与空态文案随 `ui.language` 切换（重开视图）
- [ ] **调试层文案**：启动失败、GDB 异常退出、断点/寄存器禁用等提示中英两态一致（重点：错误提示仍含可定位的命令名/路径）
- [ ] **WebView 面板正文**：工程属性 9 页、快捷键面板、编译选项面板的字段标签/按钮/校验提示随语言切换；**工程名与备注等数据不被翻译**（源级插桩的边界）
- [ ] **菜单标签**：状态栏菜单「选择菜单」→「Build / 构建菜单」等 148 个菜单项标签随 `ui.language` 切换，且点击行为与命令映射不变

## 9. 工程搜索（Project Search，0.8.145 起）

- [ ] 侧边栏出现 **Project Search**（Project 之后、Symbols 之前）；200px 窄侧栏无横向溢出，历史栏文字缩为图标
- [ ] 文件模式：输入即搜、活动工程置顶、按工程分组；空查询可浏览全部工程文件；单击打开、悬停 ⤢ 在工程树定位
- [ ] 内容模式：输入后 `Enter` / 「搜索」执行；结果按文件分组且默认全部展开；单击匹配行跳转并选中匹配文本；搜索中「停止」可取消
- [ ] 中文输入法组合输入期间不触发搜索；组合结束后再搜
- [ ] 范围：所有工程 / 当前活动工程；从工程树右键 folder / virtualFolder / fileGroup 进入显示范围 chip，× 清除后恢复
- [ ] `Aa` / `.*`：内容模式大小写与 `/正则/` 生效；非法正则给出可读提示；文件模式不受影响
- [ ] 顶部历史栏：`🕘 搜索历史` 展开；**`保留历史` switch 位于搜索栏顶部**，开/关即时生效并与设置 `codeblocks.search.keepHistory` 同步
- [ ] 点击历史条目：有有效上次结果直接跳转；失效/无结果时恢复查询/模式/范围/选项并重跑；`↻` 仅重跑
- [ ] 清空历史需二次确认；关闭保留历史后历史面板隐藏、不再写新记录
- [ ] 子树范围搜索不写历史；历史只在当前工作区可见（另开工作区不串）
- [ ] 中英切换后重建搜索视图，标签/提示/相对时间语言一致；深/浅/高对比主题下颜色可读
- [ ] 打开/关闭/切换活动工程、增删文件后，可见视图自动刷新结果；隐藏视图不产生后台搜索
- [ ] 命令 `Code::Blocks: Project Search: Search Project Files`（`Ctrl+Alt+P`）与 `Search in Project Files` 可打开/聚焦视图；编辑器单行选区会预填内容查询
- [ ] 运行 `Code::Blocks: Reset View Layout` 后顺序为 Project → Search → Symbols（未手动隐藏 Search 时）
