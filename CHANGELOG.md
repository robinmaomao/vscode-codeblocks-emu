# 更新日志（Changelog）

本文件记录**正式版**里程碑；每个 dev 迭代的逐轮发布说明见 [`docs/release/`](docs/release/)（`0.8.xx-dev.md`），版本号与维护约定见 [`docs/release/00-说明.md`](docs/release/00-说明.md)。

## 0.8.132 — 2026-10-22

**中英文界面语言切换（i18n 设施 + 静态贡献全量本地化 + 运行时文案全覆盖）**

- **i18n 运行时设施**（本版新增）：`src/i18n/core.ts`（纯逻辑：`resolveLanguage` / `formatSource` / `lookupTemplate` / `translate`）+ `src/i18n/index.ts`（`t()` / `tr()` / `htmlLang()` / `uiLanguage()` / `refreshUiLanguage()`）；词条表 `src/i18n/strings.zh-cn.json` 以**英文源串为键**，`{0}`/`{1}` 占位符，词条缺失回退源串；语言为进程内缓存，设置变更即时刷新。
- **新设置 `codeblocks.ui.language`**（`auto`/`en`/`zh-cn`，默认 `auto`，即时生效）与新命令 **`Code::Blocks: Switch UI Language…`**（`codeblocks.ui.switchLanguage`，三态 QuickPick + 当前项标记 + 一键重载窗口）。
- **静态贡献全量 nls**（本版新增）：107 命令标题、77 设置描述/枚举说明、5 视图名、2 容器标题、欢迎语、调试器片段描述、`displayName`/`description` 全部改 `%key%`，`package.nls.json`（英文默认）+ `package.nls.zh-cn.json`（中文），共 212 键 —— 跟随 VS Code 显示语言，重载窗口生效。
- **运行时文案全覆盖**（本版新增，迁移点 290 → **1123**、词条 239 → **1072**）：WebView 三个面板的**内部字段**（源级插桩 `i18n.tr()` + 193 条中文→英文反查表，不翻译工程名等数据）、状态栏菜单与 **148 个菜单标签**、树视图 5 个 provider、调试层（适配器 / MI 会话 / 调试配置）、构建引擎 5 个文件、clangd/键位/统计等工具类与工程/模型 12 个文件、`extension.ts` 剩余日志与 UI。
- **构建日志新入口 `logT()`**（本版新增）：`codeblocks.log.english=true` 时日志**恒英文**（对齐 Code::Blocks 原文），否则跟随 `ui.language`；`src/build/**` 全面改用 `logT`，历史 `msg(zh, en)` 仅保留 3 处构建结果 toast（守卫禁止新代码在 `build/**` 调用 `msg`）。
- **守卫**（本版新增/升级）：词条漂移 AST 守卫（含 `logT` 源串、`build/**` 禁 `msg`）、静态 nls 覆盖、**29 个已本地化文件 AST 级禁中文字面量**、WebView 插桩点 ↔ 反查表双向一致、mock 显示语言可覆盖。
- **文档双语**（本版新增）：面向用户的三份文档各出英文版并从中文版互链 —— `README.en.md`、`docs/使用说明.en.md`、`docs/国际化.en.md`（与中文版结构 1:1，术语沿用运行时英文源串）。
- 规模（0.8.132 时点）：命令 106 → **107** 项、设置 76 → **77** 项；分层回归 `contract 2/2`、`unit 161 FAIL=0 SKIP=1`、`e2e 4/4`、`visual 24 pass`、`perf 13 项 0 fail`、`pack 14 pass`、`host 24 pass`。

## 0.8.131 — 2026-10-15

**工作区检测开销治理 · clangd 设置改动立即生效**

- **工作区检测开销治理**（本版新增，对齐"构建期进程暴增 + CPU 冲 100%"修复简报）：
  - `.cbp` 文件新增/删除改为**增量登记**：不再触发全工作区 `findFiles`（历史上每次事件固定起 2 个 ripgrep 进程，成本 ∝ 工作区文件数）
  - 工作区工程扫描合并为**一次** `findFiles('**/*.{cbp,workspace}')`，exclude 排除 `Output`/`obj`/`bin`/`node_modules`/`.git` 等重目录（显式传 exclude 会覆盖 `files.exclude`，故把默认项写回），并加 30s 结果缓存 + 单飞；宿主实测（36 工程 / 36,829 文件）激活期扫描 **211ms → 89ms**
  - 新设置 `codeblocks.detect.autoOpen`（`all`/`single`/`off`，默认 `all`）与 `codeblocks.detect.autoOpenThreshold`（默认 `20`）：未打开工程数超阈值时不再自动弹多选（仅状态栏入口 + 输出通道提示），并限制会话恢复的工程数；多选**默认不再全选**（仅勾选最近使用/活动工程）
  - 兜底符号索引 `SymbolIndex` 增加"mtime + size"单文件缓存：多工程重建只重解析变化文件（`stats()` 可读 parsed/reused）
  - 新增命令 `Code::Blocks: Workspace Scan Report`：输出扫描耗时、工程数、工程目录数、当前 ripgrep 并发与"单工程工作区"建议
- **clangd 设置改动立即生效**（本版新增，修复「设置里配了 `-Wempty-body` 却没写进 clangd 配置」）：
  - **自动重新生成**：改任意 `codeblocks.clangd.*` 后自动重写用户级 `config.yaml` 片段（约 150ms 去抖合并；clangd 自身会重载配置），不再需要重开工程或手动跑一次 `Generate compile_commands.json`；生成中到达的请求改为**跑完再补一次**（原先单飞直接丢弃，恰逢生成中改设置会静默失效）；未打开工程时跳过（作用域未知），下次打开工程按新设置生成
  - **取值容错**：`suppressedWarnings` / `forcedIncludes` / `excludeDirs` 手改成字符串（如 `"-Wunused-function, -Wempty-body"`）时按逗号/分号/空白拆分、写成其它类型则回退默认值，并在输出通道提示取值类型问题；数组值顺带 trim/去空/去重。片段层再加非数组防御——历史上字符串会**按字符**迭代，写出 `- -`、`- W`… 单字符压制项（等于该设置彻底失效）
- **设置即时生效收口**（本版新增，回应"哪些设置改了不会立即生效"的逐项审计）：
  - **改编译器立即生效（G1）**：修改 `codeblocks.compilerId` / `masterPath` / `compilerPrograms` 时，底部状态栏 `Compiler:` 立即刷新，并按新编译器重新生成编译数据库（编译命令、`--target`、系统头 `-isystem` 全按新编译器推导）；数据库**真正变化**且存在已打开 C/C++ 文件时**重启 clangd**，免去"换了编译器、红波浪线/补全还是旧的"。编译器变化不提供关闭项（不重启等于设置没生效），切换活动工程的重启仍受 `codeblocks.clangd.restartOnActiveProjectSwitch` 控制；未打开源文件时不重启、未打开工程时只刷新状态栏
  - **`codeblocks.build.persistLog` 重载提醒（G3）**：输出通道类型在激活期创建、不可热切换（重建会清空当前输出）⇒ 改动时**弹提醒**并提供「重载窗口 / 稍后」，选前者执行 `workbench.action.reloadWindow`
  - **`codeblocks.clangd.enabled` 关闭提醒（G4）**：关闭只让扩展停止**生成/更新**用户级 `config.yaml`，已写入的片段（用户级配置，优先级高于项目 `.clangd`）仍会被 clangd 读取 ⇒ 关闭时**弹提醒**并提供「打开 clangd 配置 / 稍后」；无既存片段、或值未变化（其它来源重复派发事件）时静默，不重复打扰
- 规模：命令 106 项、设置 76 项（7 分区 + 中英 nls）、视图 5 个；分层回归 contract 2/2、unit 155 脚本 FAIL=0 SKIP=1、e2e 4/4、perf 13 项 0 fail、pack 14 pass

📄 详细发布说明：[`docs/release/0.8.131.md`](docs/release/0.8.131.md)

## 0.8.130 — 2026-10-13

**构建观感与 CPU 收口 · post-build 可观测性 · clangd 补全与配置治理**

- **post-build 观感与阻塞治理**（本版新增）：脚本输出**实时流式**写入日志（不再等命令结束才回放，卡住期间不再空白）；长命令每 5s 输出「仍在运行 (x s)」心跳行（首条附排障提示）；新增 `codeblocks.build.scriptCommandTimeoutMs`（默认 `0` = 不超时，对齐 CB 无限等待；超时强杀进程树并记失败）——用于脚本内网络盘（SMB）重连、上传服务（.NET 默认 100s 超时）等阻塞场景；杀树按「运行期采集进程树 PID + 超时后多轮收割逃逸孤儿」加固（`taskkill /T /F` 是瞬时快照式：快照后新生的子孙、以及根已退出时的空操作会让脚本继续启动 `start /b` 后台进程，实测杀树后 1~10s 仍出现且长期存活 → 加固后 8 组超时点 × 24 轮零残留）
- **构建关键路径开销与 CPU 占用**（本版新增）：
  - **post-build 宽限改为「安静期 + 上限」**：命令本体退出后管道安静约 0.25s 即继续，最多不超过 `scriptExitGraceMs`（默认 1500ms 不变）；固定等满 1.5s 的旧行为消失（基准 B11：**1891ms → 约 600ms**，与 Code::Blocks 的观感差异随之收窄）
  - **并行编译上限 64 → 32**：`codeblocks.parallelJobs=0`（自动）时并发数 = `min(逻辑核数 × 2, 32)`，降低编译期 CPU 占用峰值（显式设置 1–32 仍优先生效）
  - **Problems 诊断批量发布**：构建期按文件归集、约 0.2s 一次批量写入（原为每条诊断一次 `diagnosticCollection.set`——`set` 会整数组拷贝并跨进程提交，N 条诊断 = O(N²) 拷贝 + N 次 IPC；实测 4000 条 / 20 文件：**4000 次 → 20 次**调用、40.2 万 → 4000 个元素）；构建期间 Problems 仍逐步刷新，条目内容与顺序与逐条发布一致
- **clangd 补全不自动插入头文件**（本版新增）：生成的用户级 `config.yaml` 片段固定 `Completion.HeaderInsertion: Never`（clangd 默认 `IWYU` 会在接受补全时插入 `#include`）；如需恢复默认需自行覆盖该片段（下次生成会被重写），或改本版新增的 `codeblocks.clangd.headerInsertion` 设置
- **clangd 配置治理**（本版新增）：
  - **失效片段自动清理**：扩展只重写「本次打开作用域」的片段，历史残留（项目删除/移动、临时目录）会永久堆积（本机实测 76 个片段里 68 个已失效）⇒ 现在每次生成配置时顺带清理「作用域目录或编译数据库目录已不存在」的片段并在输出通道留痕；新增命令 `Code::Blocks: Clean Stale clangd Config Fragments`（预览 + 确认，同时清理扩展缓存目录里的孤儿 `compile_commands.json` 目录）。安全边界：只动扩展标记块、用户内容不碰；**卷未挂载 / UNC 路径一律跳过**（不误删移动硬盘、网络盘上的工程片段）
  - **片段只写「需要写」的键（12 项新设置，默认值 = 现状）**：`Diagnostics.UnusedIncludes`、`Completion.HeaderInsertion`、`Index.Background`（`skip` 可显著降低大 SDK 上 clangd 的 CPU/内存占用）、`Index.StandardLibrary`、`Diagnostics.ClangTidy`、`Completion.AllScopes`、`InlayHints.Enabled`、`Documentation.CommentFormat`、`If.PathExclude`（`excludeDirs`）、`CompileFlags.BuiltinHeaders`、`queryDriver`、`extraConfig`；留 `default`/`omit` 即**不写该键**，交给 clangd 默认值或你自己的配置（文档说明优先级：扩展写的是用户级 config.yaml，按 clangd 规则**高于**项目 `.clangd`）
  - **`extraConfig` 自由 YAML**：作为同作用域的**后置片段**注入（扩展自动补 `If.PathMatch`），可覆盖扩展写入的任意键；写入前对「制表符 / `---` / 顶层 `If:`」给出提示（YAML 错误会让 clangd 丢弃整个配置文件）
  - **交叉编译器保真（可选）**：新命令 `Code::Blocks: Configure clangd --query-driver` 按活动工程推导 `--query-driver=<编译器目录>/*`，与既有 `clangd.arguments` **合并去重**，写入位置三选一（工作区/用户/剪贴板）+ 预览确认；配合 `codeblocks.clangd.builtinHeaders=queryDriver` 使用交叉工具链的内建头
- 测试与 CI 稳定性：安静期相关断言去掉机器速度依赖、持续输出场景改用 cmd 内建 `echo` 循环、失败清单打印到输出末尾（产品行为零变化）
- 规模：命令 105 项、设置 74 项（7 分区 + 中英 nls）、视图 5 个；分层回归 contract 2/2、unit 153 脚本 FAIL=0 SKIP=1、e2e 4/4、perf 13 项 0 fail、pack 14 pass

📄 详细发布说明：[`docs/release/0.8.130.md`](docs/release/0.8.130.md)

## 0.8.129 — 2026-10-13

**测试分层体系与缺陷收口 · post-build 脚本结束判定对齐 · 构建关键路径开销**

- **post-build 脚本结束判定对齐 Code::Blocks**（本版新增）：pre/post-build 脚本以**命令本体退出**为结束信号——脚本里的后台程序（`start` / `start /b` / GUI / 守护进程）不再拖住构建（修复前实测 `start "" /b ping -n 6 …` 白等 **5113ms** → 修复后 **1557ms**，`scriptExitGraceMs=0` 时 7ms）
- 新增设置 `codeblocks.build.scriptExitGraceMs`（默认 `1500`，可设 `0` 完全对齐 CB，上限 60000）；后台进程存在时日志给出说明行，单条脚本命令 >3s 给出 `耗时 x.xs` 行（`plainCbLog` 模式静默）
- 构建关键路径：项目级 pre/post 宏展开复用 `CommandGenerator`（1200 文件 / 6 目标工程 48.2ms/次 → 0.7ms/次）；扩展激活时异步预热 Windows 系统 PATH 缓存（首次构建「环境准备」省 2×`reg.exe` ≈184–209ms）
- **测试分层体系（L-1…L5 + CI）**：契约 / 无头 / 真实工程·调试·工具链·边界 E2E / VS Code 宿主 / 像素视觉 / 性能 / 打包 七层统一运行器 + GitHub Actions；覆盖补齐（命令 / 设置 / 快捷键 / 语法 / DAP 30/30）
- **缺陷收口**：测试阶段登记的 D-01…D-20 与能力缺口 C-01（`stopOnEntry` 入口首停）全部修复
- 规模：命令 103 项、设置 61 项（7 分区 + 中英 nls）、视图 5 个；分层回归 contract 2/2、unit 151 脚本 FAIL=0 SKIP=1、e2e 4/4、perf 13 项 0 fail、pack 14 pass

📄 详细发布说明：[`docs/release/0.8.129.md`](docs/release/0.8.129.md)

## 0.8.128 — 2026-10-09

**汇编注释可配置 · F5 调试接入 · 构建流程加固 · 文档与 README 整理**（相对 0.8.127 的增量小版本，构建引擎零变化）

- **F5 接入调试**：新增 `DebugConfigurationProvider`（Initial + Dynamic 两组）——无 `launch.json` 时按 F5 直接以活动工程的活动目标启动调试（与 F8 同一套推导）；`program` 失效自动回退到活动目标输出；推导失败给出「请先构建」等明确提示而不再静默；`Select and Start Debugging` / 「More Code::Blocks GDB options...」中亦可见动态配置
- 新增设置 `codeblocks.editor.asmHashComment`（默认 `false`）：开启后汇编行注释由默认 `//` 动态切回 GAS 原生 `#`，修改即时生效
- `.s` / `.S` 行注释默认由 `#` 改为 `//`（预处理的 `.S` 安全；原生 `.s` 直接汇编请开启上述设置）
- README 特性按主题重组、已知限制表与安装说明修正；《扩展残留问题核查分析报告》归档
- 构建流程加固：新增 `vscode:prepublish` 钩子（`vsce package` / `vsce publish` 前自动 `compile` + `bundle`），杜绝打进过期或缺失的 `bundle/extension.js`；`npm run package` 简化为 `vsce package`
- 规模：命令 103 项、设置 60 项（7 分区 + 中英 nls）、视图 5 个；回归 `tests/run-all.js` 135 文件 FAIL=0

📄 详细发布说明：[`docs/release/0.8.128.md`](docs/release/0.8.128.md)

## 0.8.127 — 2026-10-09

**构建性能 · 编译缓存 · 打包瘦身**

- 并行度默认 `min(逻辑核数 × 2, 64)`（本机 4C/8T 全量 rebuild 实测约 70s → 40s）；新增 M0 阶段计时探针（设置 `build.profile`）
- 新增 `build.compilerCache`（ccache / sccache，默认 `none` 零影响）+ 自动检测 / 询问启用 / 引导安装
- 惰性编译命令生成（仅对过期单元生成）、同步子进程超时收敛（15s / 8s → 3s）
- 无效编译器与 Run 前校验日志完整对齐 Code::Blocks（`PrintInvalidCompiler` / `Run aborted...`）
- 打包瘦身：esbuild 单文件入口，VSIX 199 文件 / 528 KB → 74 文件 / 307 KB（-63% / -42%）

📄 详细发布说明：[`docs/release/0.8.127.md`](docs/release/0.8.127.md)

## 0.8.119 — 2026-09-30

**首个功能完备正式版：构建 / 调试 / 工程管理全面对齐**

- 构建引擎逐轮对齐 Code::Blocks：PCH 预编译头、失败即停、编译条目计数强制重链、跨卷 / UNC 对象路径、响应文件、AVR / MSP430 / SDCC 工具链
- 调试器（自研内联 DAP）：反汇编 / Memory / Registers / 数据断点 / 指令级步进 / 命中次数与日志断点 / Run to Cursor / Set Next Statement / 附加进程 / 指令断点 / 多会话路由 + MinGW GDB 7.6–8.1 实机兼容修复
- 界面体系：9 顶级菜单 92 项对齐、快捷键补全与可视化配置面板、设置 7 分区 + 中英 nls
- Build Log 底部面板、结构化输出、状态栏菜单、书签与错误导航（F4 / Shift+F4）、Run 终端复用
- 质量体系：回归测试 52 → 122 个文件（FAIL=0）+ 真机构建自检

📄 详细发布说明：[`docs/release/0.8.119.md`](docs/release/0.8.119.md)

## 0.8.11 — 2026-09-24

**编译产物字节级一致（Build Parity）**

- `.o / .a / .bin / .map` 与 debug 段（`.debug_info` / `.debug_line` / `.debug_str`）可与 Code::Blocks 原生构建做 `map.txt` 级逐字节对比验证
- 覆盖文件类型判定（`FileTypeOf`）、静态库归档、编译单元按 weight 排序、文件排序字节序、`$file` 分隔符、盘符归一化
- 健壮性：含空格工具链路径引号、长命令行响应文件、pre/post-build 实时读取系统 PATH

📄 详细发布说明：[`docs/release/0.8.11.md`](docs/release/0.8.11.md)

## 0.8.2 – 0.8.10（早期版本）

- 编译产物一致性对齐的起始阶段（v0.8.4 – v0.8.11 逐轮修复，详见 0.8.11 发布说明的「编译产物一致性」章节）

📄 历史存档：[`docs/release/archive/0.8.2~0.8.46.md`](docs/release/archive/0.8.2~0.8.46.md)
