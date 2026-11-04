# 未实现功能待办（功能对齐现状）

> 对照 Code::Blocks 25.03（`codeblocks-src/`）的功能盘点结论与剩余事项。
> 首轮盘点：2026-09-26（基线 0.8.74-dev，A–E 组 33 项）；最近复核：2026-11-04（0.8.137）。
> 状态约定：`☐ 待确认` ｜ `◐ 已确认待实施` ｜ `✔ 已实施` ｜ `✖ 不实施` ｜ `▣ 记录`。
> 已实施项的逐项取证与实施方案见归档 [0.8.76-0.8.99-dev](../release/archive/0.8.76-0.8.99-dev.md)、
> [0.8.100-0.8.128-dev](../release/archive/0.8.100-0.8.128-dev.md)。

## 1. 剩余缺口（记录待办，暂不实施）

| 编号 | 缺口 | 现状/影响 | 依据与建议 |
|---|---|---|---|
| G1 | `.workspace` 外部修改检测 | 只对已打开工程的 `.cbp` 检测（change 事件 + 焦点兜底）；`.workspace` 被外部修改不提示，`<Depends>` 改动需重新打开工作区 | 引用关系变化影响构建拓扑，误重载风险高于 `.cbp`；需先定「重载是否重建全部工程」策略 |
| G2 | `Compile File (Without Project)` 输出编码 | 走 VS Code 任务终端（固定 UTF-8），编译器 GBK 输出乱码 | 仅影响无工程单文件编译；需改用扩展输出通道或自建终端（牵动执行模型）；已在 [使用说明](../guide/usage.md) §16 标注 |
| T2 | Profiler（gprof） | 未实现；市场无 gprof 前端（`blacksmith` 属 valgrind/callgrind 换后端） | CB `profiler/cbprofiler.cpp:83-255`、`cbprofilerexec.cpp:44-426`；需目标带 `-pg`，Windows 下 gprof 输出编码/路径需处理；建议 S→M（目标选择 + `gmon.out` 校验 + `gprof` 运行 + 输出查看） |
| T3 | Copy strings to clipboard | 未实现；无等效扩展 | CB `copystrings/copystrings.cpp:67-183`；XS |
| T5 | 跨库符号搜索 | 单库查看可用市场扩展（`nm-tool` / `vscode-binutils`），跨库批量搜索无替代 | CB `symtab/symtabexec.cpp:64-542`、`symtabconfig.cpp:188-343`；S（选目录 → 枚举库 → 逐个 `nm`） |
| M1 | Export Makefile 入 Build 菜单 | 命令已有（Tools 菜单，`menuStructure.ts`），未放入 Build 菜单 | CB `compiler_menu.xrc:85-86`；XS（可双入口，同步 `test-menu-structure.js`） |

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
