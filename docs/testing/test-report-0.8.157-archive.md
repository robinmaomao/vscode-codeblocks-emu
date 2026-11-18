# 测试执行报告（0.8.157 · 滚动更新）

> 生成时间：2026-11-19 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU demo CPU ×16 ｜ 32GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.152 测试报告](./test-report-0.8.152-archive.md)；本版发布说明见 [release/0.8.157.md](../release/0.8.157.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 725 断言 |
| 无头层（unit） | `npm test` | **TOTAL=210 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；AutoVersioning/Profiler 正确性、编译器元数据与全量资源回归 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套；本机指纹走跨环境容差分支 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；0 warn / 0 fail |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.157 打包 / 安装冒烟通过，含 `bundle/search-worker.js` 检查 |
| 产物 | `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（25 用例）** | 真实 VS Code 1.85.0 宿主；**25 pass / 0 fail / 0 skip** |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| AutoVersioning 正确性 | `test-autoversioning.js` **26 断言**、`test-autoversioning-commands.js` **19 断言**：内容相同不写、mtime 不变、构建会话去重、manifest、SVN 头文件、version.h 加入工程 | 临时工程构建前后检查 `version.h` 与 `BUILDS_COUNT` |
| Profiler | `test-profiler-parse.js` **22 断言**：旧 gmon.out 判定、call graph、CSV/HTML、原子报告路径 | 本机 gprof 目标分析 |
| 编译器资源 | `test-more-compilers.js` **46 断言**：全量 options 可加载、metadata 显示名、PATH 探测（TCC/BCC/DMC/OW/DMD/GDC/gfortran/ARM/PowerPC） | 无本机 BCC/DMC/IAR 安装，使用伪工具链验证探测 |
| 命令/设置 | `test-settings-structure.js` 38 断言；覆盖矩阵 136/91 | Settings 页面核对新增 profiler 设置 |
| 文档 | D1/D1b/D2/D3/D4/D5；0.8.157 发布页与报告同步 | README / usage / backlog / alignment 互链 |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 136 | 136 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 91 | 91 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，数据来源 package.json v0.8.157）。
> 命令缺口 0 个。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | AutoVersioning/Profiler 正确性、编译器元数据加载与 CB 全量资源、按需架构准备 |
| AutoVersioning | 内容不变不重写 `version.h`、构建会话去重、do_auto_increment/ask_to_increment、Bump/Generate 更新 manifest、SVN 字段、Changes Log、version.h 加入工程 |
| Profiler | 拒绝旧 `gmon.out`、`gprof -A` `--separate-files` 回退、CSV/HTML 原子写 |
| 编译器 | `compiler_*.xml` 显示名/路径元数据、Code::Blocks 全量 options/metadata、OpenWatcom/Cygwin/MSYS2/TDM/LCC/DMD/GDC/gfortran 探测 |
| 命令/设置规模 | 不变（136 / 91 / 6 / 34） |
| 新增测试 | `test-autoversioning*.js`、`test-profiler-parse.js`、`test-more-compilers.js` 扩展 |
| 文档 | [release/0.8.157.md](../release/0.8.157.md)、发布页、README / usage / progress / CHANGELOG / backlog / alignment 同步 |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | AutoVersioning | 每次构建都写 `version.h`，mtime 抖动导致重复编译 | `writeVersionHeaderIfChanged` 内容相同跳过 |
| 2 | AutoVersioning | 构建计数在多路径重复递增 | 构建会话 token，完成后清除；失败/取消不递增 |
| 3 | AutoVersioning | Bump/Generate 不更新 manifest | 抽取 commit 流程，三个入口统一 |
| 4 | Profiler | 旧 `gmon.out` 被误用 | 运行前记录 mtime/size，只接受新文件 |
| 5 | Profiler | `gprof -A` 无 stdout 时无产物 | `--separate-files` 回退并收集 `.annotated` |
| 6 | 编译器 | `extends` 父文件拼成 `gcc.xml` 而非 `options_gcc.xml` | 修正 extends 前缀，全部 options 可加载 |
| 7 | 编译器 | `compiler_*.xml` 显示名未读取 | 新增 `CompilerMetadataIndex`，列表/Banner 使用真实名称 |

## 5. 结论

- 单元 **210** / 契约 **3/3** / E2E **6/6** / 视觉 **26/26** / 性能 **13/13** / 打包 **15 断言** / 宿主 **25/25** 全部通过，无遗留失败。
- 命令 136 / 设置 91 / 视图 6 / 快捷键 34，覆盖率 100%。
- 剩余架构拆分（`extension.ts` 按域）按计划后续批次推进；不阻塞本版。
