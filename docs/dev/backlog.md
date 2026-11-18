# 未实现功能待办（功能对齐现状）

> 对照 Code::Blocks 25.03（`codeblocks-src/`）的功能盘点结论与剩余事项。
> 首轮盘点：2026-09-26（基线 0.8.74-dev，A–E 组 33 项）；最近复核：2026-11-18（0.8.154，P0/P1/P2 批次实施后）。
> 状态约定：`☐ 待确认` ｜ `◐ 已确认待实施` ｜ `✔ 已实施` ｜ `✖ 不实施` ｜ `▣ 记录`。
> 已实施项的逐项取证与实施方案见归档 [0.8.76-0.8.99-dev](../release/archive/0.8.76-0.8.99-dev.md)、
> [0.8.100-0.8.128-dev](../release/archive/0.8.100-0.8.128-dev.md)。

## 1. 缺口状态（2026-11-18 更新）

| 编号 | 缺口 | 状态 | 说明 |
|---|---|---|---|
| G1 | `.workspace` 外部修改检测 | ✔ 0.8.154 | 独立 tracker + `**/*.workspace` watcher + 焦点兜底；改 `<Depends>`/active 后提示 Reload/Ignore；重载只刷新变化工程 |
| G2 | `Compile File (Without Project)` 输出编码 | ✔ 0.8.154 | 默认改扩展自管进程 + `OutputLineDecoder`（UTF-8/GBK 逐行）；`noProjectCompile.useTaskTerminal` 可回退旧任务终端 |
| T2 | Profiler（gprof） | ✔ 0.8.156 | 运行目标 → 定位 `gmon.out` → `gprof` → flat profile + call graph；`gprof -A` 源码注解独立输出通道；CSV/HTML 导出 |
| T3 | Copy strings to clipboard | ✔ 0.8.154 | Tools → Copy Strings；状态机移植（忽略注释/单引号、去重排序） |
| T5 | 跨库符号搜索 | ✔ 0.8.154 | Tools → Find Symbol in Libraries…；收集工程链接库，`nm -C -A` 并行解析 |
| T6 | AutoVersioning | ✔ 0.8.156 / 0.8.157 | `.cbp <Extensions><AutoVersioning>` 读写；命令与构建钩子；0.8.157 补内容跳过、构建会话去重、do_auto_increment/ask、manifest、SVN、Changes Log、version.h 加入工程 |
| T7 | 更多编译器资源 | ✔ 0.8.156 / 0.8.157 | TCC / Borland C++ / Digital Mars / ARM ELF GCC / PowerPC EABI GCC；0.8.157 补 CB 全量 options/metadata、显示名与 OpenWatcom/Cygwin/MSYS2/TDM/D/Fortran 探测 |
| M2 | File 菜单剩余项 | ◐ 0.8.154 | Save Project As / Save·Close Workspace / Open default workspace 已完成；Print 仍不移植 |
| M3 | File → New 子菜单 | ◐ 0.8.154 | New Build Target… / New File… 已完成；Custom… 仍不做 |
| M4 | Edit 菜单剩余项 | ✖ 维持 | Clear changes history / Toggle all folds / Movement·Zoom 等无稳定 VS Code 等价命令；Stream/Box comment 用内置注释命令 |
| M5 | Project 菜单剩余项 | ✖ 维持 | F4/F7/C7 决策（2026-10-08）不实施 |
| M6 | Debug 菜单剩余项 | ◐ 0.8.154 | Next instruction / Step into instruction / Examine Memory… 已完成；Active debuggers 由 VS Code 会话下拉承担 |
| M7 | Settings 菜单剩余项 | ◐ 0.8.154 | Backtick Cache 管理器已完成；Global variables 仍只读（default.conf 写回竞态，B1/B2/C4 决策） |
| N1 | `.cbp` 单元路径 XML 转义 | ✔ 0.8.154 | 添加/移除/改名/切换 compile·link 对含 `&`/`<`/`>`/`"` 的路径安全 |
| N2 | `.cbp` 原子写盘 | ✔ 0.8.154 | 同目录临时文件 + rename；失败保留原文件 |
| N3 | `package.json` 硬编码中文 | ✔ 0.8.154 | 调试属性/寄存器视图标题/工具项说明全部 nls；`test-i18n-nls` 增加无 CJK 守卫 |
| N4 | Makefile 项目 CompileFile/DistClean | ✔ 0.8.154 | `makeCommands.compileFile` / `distClean` 接入；Build → Dist Clean |
| N5 | WebView CSP / 巨型模块拆分 | ◐ 0.8.159 | WebView 已改 nonce CSP + 公共运行时；`extension.ts` 已拆出 tool/workspace/newProject/debug/autoVersioning/profiler/projectManager 七批；buildCommands、debug 剩余、uiCommands 按 [architecture.md](./architecture.md) §4 继续按需拆分 |

> 盘点时的 UI 落位与编译/链接影响结论：可实施项中 19 项零影响、6 项轻度（只写 `.cbp`/`.workspace`/`default.conf`，经既有读取路径生效）、1 项需改造构建状态机（B5 Squirrel，未实施）。

## 2. 明确不移植清单（含理由）

| 项 | 理由 |
|---|---|
| Squirrel 构建脚本（B5） | 已决策维持警告跳过（2026-09-26）；CB Squirrel 无等价 JS 语义，脚本化建议用 VS Code 扩展 API |
| console runner 二进制 | 集成终端等价 |
| Class wizard / wxSmith / NassiShneiderman / Spell checker | UI 框架强绑定 / 有更优替代 |
| Autosave / Open files list / occurrences / code completion | VS Code 原生或 clangd 覆盖 |
| LogHacker / displayevents / modpoller / xpmanifest / 打印 | 平台/体系不适配，价值低 |
| forceCompilerUseQuotes / forceLinkerUseQuotes | CB 自身命令生成未使用（仅读写设置） |
| 文件掩码/globs 编辑（C7） | VS Code 文件关联替代 |
| 缩写（D2） | snippets 替代 |
| CppCheck 集成（第五轮 T1） | 不自行实施（2026-09-28）：用市场扩展替代（`cppchecksolutionsab.cppcheck-official` / `jbenden.c-cpp-flylint` / `emielestivenartentity.cppcheck-turbo`），配合本扩展 `Export compile_commands.json…`；已写入 [使用说明](../guide/usage.md) §16.1 |
| Regex testbed（第五轮 T4） | 不自行实施：用市场扩展替代（`chrmarti.regex` / `louiswt.regexp-preview` / RegExp Preview and Editor） |
| 符号表 nm 单库查看（第五轮 T5 部分） | 不自行实施：用市场扩展替代（`wibren-wiersma.nm-tool` / `sqlpassion.vscode-binutils`） |
| DoxyBlocks / Print / Modern Fortran / 环境变量 / Valgrind | 不自行实施：已有成熟 VS Code 扩展，统一记录在 [推荐扩展](../guide/recommended-extensions.md)（扩展 ID、安装与配置边界） |

## 3. 已完成项摘要（A–E 组 33 项）

| 组 | 项 | 结论 |
|---|---|---|
| A 调试器 | A1 反汇编 / A2 内存 / A3 寄存器 / A4 数据断点 / A5 指令级步进 / A6 命中次数与日志断点 / A7 Run to cursor·Set next statement / A8 Send user command / A9 Attach to process / A10 调试器设置 / A11 异常断点过滤器 | ✔ 0.8.76-dev |
| B 编译器与构建设置 | B3 命令模板查看 / B4 Export Makefile | ✔ 0.8.78-dev |
| B / C 组 | B1 全局编译器设置编辑 / B2 编译器集 Copy·Rename·Delete / B5 Squirrel 脚本 / C4 全局变量编辑 | ✖ 不做（2026-09-27 方案 A；B5 方案 C 维持警告跳过）；替代为「打开 `default.conf`」入口 + 文档指引 |
| C 工程与工作区 | C1 工作区依赖编辑 / C2 外部依赖编辑 / C3 项目自定义变量编辑 / C5 工程导入 / C6 更多新工程模板 | ✔ 0.8.78-dev |
| C 工程与工作区 | C7 文件掩码/globs 编辑 | ✖ 不做（VS Code 文件关联替代） |
| D 编辑器辅助 | D1 头文件保护 / D3 Tidy 注释 / D4 Edit 菜单补项 | ✔ 0.8.78-dev |
| D 编辑器辅助 | D2 缩写 / D5 Class wizard 等 | ✖ 不做（snippets / 市场扩展替代） |
| E 工具与其它 | E1 Configure tools | ✔ 0.8.78-dev |
| E 工具与其它 | M1 Export Makefile 入 Build 菜单 | ✔ 2026-11-18（状态栏 Menu 优化） |
| E 工具与其它 | E2 Scripting / E3 Console runner / E4 Autosave 等 / E5 日志与平台工具 | ✖ 不做（见 §2） |

## 4. 决策与变更记录

| 日期 | 版本 | 说明 |
|---|---|---|
| 2026-09-26 | 0.8.74-dev | 初版：第二轮全面盘点（A–E 共 33 项 + 不移植清单 + UI 落位/编译影响汇总） |
| 2026-09-26 | 0.8.76-dev | A1–A11 调试器 11 项实施；B5 决策：方案 C（维持警告跳过，不实施 Squirrel/JS 钩子） |
| 2026-09-27 | 0.8.78-dev | 第三批 D1/D3/D4/E1 · C1/C2/C3 · B3/B4 · C5/C6 实施；B1/B2/C4 评估结论：方案 A 不做（替代 `codeblocks.openDefaultConfig` + 文档指引） |
| 2026-09-28 | 0.8.92-dev | 第五轮批次三：T1/T4/T5 单库查看 → 替代扩展；T2 Profiler / T3 Copy strings / T5 跨库搜索 / M1 菜单位移 → 记录暂不实施（§1） |
| 2026-10-22 | 0.8.132 | 界面语言（i18n）批次 2 全部完成，细则见 [国际化](./i18n.md) §4 |
| 2026-11-04 | 0.8.137 | 复核：新增 G1/G2 两项已知缺口；其余结论不变 |
| 2026-11-18 | 0.8.153 | 状态栏 Menu 显示优化 + 逐项排查：M1（Export Makefile 入 Build）完成；新增 M2–M7 菜单缺口（CB 有、扩展无对应命令，本次只登记不实施） |
| 2026-11-18 | 0.8.154 | P0/P1/P2 批次实施：G1/G2/T2/T3/T5 完成；M2/M3/M6/M7 子集完成；新增原子写、单元路径 XML 转义、package.json i18n、Makefile CompileFile·DistClean；N5（WebView CSP/模块拆分）仍待 P3 |
| 2026-11-18 | 0.8.155 | P3 第一批：WebView nonce CSP、`.cbp` 未知节点透传、激活扫描优化、Feature 拆分与架构文档 |
| 2026-11-19 | 0.8.156 | T2 Profiler 完整化（call graph / -A / 导出）、T6 AutoVersioning、T7 编译器资源（TCC/BCC/DMC/ARM/PowerPC）；DoxyBlocks/Print/Fortran/Env/Valgrind 统一转推荐扩展文档 |
| 2026-11-19 | 0.8.157 | AutoVersioning/Profiler 正确性收口（mtime、构建会话、do_auto_increment、SVN、旧 gmon、-A 回退）；compiler_* 元数据与 CB 全量 XML；扩展探测 |
