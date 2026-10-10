# 更新日志（Changelog）

本文件记录**正式版**里程碑；每个 dev 迭代的逐轮发布说明见 [`docs/release/`](docs/release/)（`0.8.xx-dev.md`），版本号与维护约定见 [`docs/release/00-说明.md`](docs/release/00-说明.md)。

## 0.8.128 — 2026-10-09

**汇编注释可配置 · F5 调试接入 · 文档与 README 整理**（相对 0.8.127 的增量小版本，构建引擎零变化）

- **F5 接入调试**：新增 `DebugConfigurationProvider`（Initial + Dynamic 两组）——无 `launch.json` 时按 F5 直接以活动工程的活动目标启动调试（与 F8 同一套推导）；`program` 失效自动回退到活动目标输出；推导失败给出「请先构建」等明确提示而不再静默；`Select and Start Debugging` / 「More Code::Blocks GDB options...」中亦可见动态配置
- 新增设置 `codeblocks.editor.asmHashComment`（默认 `false`）：开启后汇编行注释由默认 `//` 动态切回 GAS 原生 `#`，修改即时生效
- `.s` / `.S` 行注释默认由 `#` 改为 `//`（预处理的 `.S` 安全；原生 `.s` 直接汇编请开启上述设置）
- README 特性按主题重组、已知限制表与安装说明修正；《扩展残留问题核查分析报告》归档
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
