# 测试执行报告（0.8.139 · 滚动更新）

> 生成时间：2026-11-05 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB ｜ ccache 4.14.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 完整独立复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；根因取证见 [release/0.8.139.md](../release/0.8.139.md)；上一版发布说明见 [release/0.8.138.md](../release/0.8.138.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 659 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=176 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具，不参与自动回归） |
| L3 视觉 | `npm run test:visual` | **24/24** | 本版无 UI 改动；指纹匹配，严格判定，基线未刷新 |
| L1 端到端 | `npm run test:e2e` | **5/5（288 pass / 0 fail / 8 skip）** | 真实工具链（本机 GCC 8.1 / MinGW）：构建 48、调试 143、边界 38、工具链 38、ccache 21 |
| L4 性能 | `npm run test:perf` | **1/1（13 pass / 0 warn / 0 fail）** | 硬预算 `min ≤ 预算` 全部通过；本轮无趋势告警 |
| L5 打包 | `npm run test:pack` | **1/1（14 断言）** | VSIX 0.8.139 打包 / 安装冒烟通过 |
| 产物 | `npm run bundle` | 通过 | esbuild 无告警，1,847,594 B |
| L2 宿主 | `npm run test:host` | **24/24（0 fail / 0 skip）** | 真实 VS Code 1.85.0；激活/命令/设置/WebView/真实构建/真实 GDB/跨工具链 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 8.3 短路径修复（windres / Use83Paths / `$TO_83_PATH` / `$file`） | `tests/test-drive-case.js` 新增 4 断言（中文+空格有效路径、无畸形拼接、缓存稳定、特殊字符）；`tests/test-compiler-wrapper.js` 资源断言改为「存在的绝对路径 + basename=res.rc」并通过（37 pass） | 真实 `windres` 4.14.1：`CB-RC-~1\中文资~1\res.rc` 成功生成 `.res`（228 B）；CI 失败形态 `D:\"...\"` 已由统一解码 + `existsSync` 过滤 |
| ccache 非 ASCII 路径修复 + 新增 E2E | `tests/e2e/test-e2e-ccache.js` **21 断言**：中文路径构建、相对源路径 + `-fno-working-directory`、真实 `Cacheable calls > 0` / `Hits > 0`、ASCII 与 `cache=none` 对照；无 ccache 时 SKIP | 对照实验：无规避 0/1、仅开关 0/1、相对+开关 2/2（1 Direct HIT）；`.text` 与 ASCII 对照逐字节一致；DWARF `DW_AT_comp_dir` 保留完整中文路径 |
| 宿主层补齐 | `tests/host/runTest.js` **24 用例 0 fail 0 skip** | VS Code 1.85.0 真实宿主：真实构建 / GDB 调试 / 跨工具链 |

## 2. 覆盖台账（自动生成）

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 110 | 109 | 99% |
| 视图 | 5 | 5 | **100%** |
| 设置项 | 82 | 82 | **100%** |
| 快捷键 | 33 | 33 | **100%** |
| 语言/语法 | 6 | 6 | **100%** |
| DAP 能力 | 30 | 30 | **100%** |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，逐项列出命中层与未覆盖项）。
> 剩余缺口 1 个命令：`codeblocks.detectCompilers`（已登记的可解释缺项：真实并行探测外部编译器，需交互环境）。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | **无**（不新增/不改设置项） |
| 行为变更 | `shortPathWin` 改为 `windowsVerbatimArguments + cmd /u`，UTF-16LE 解码并用 `existsSync` 校验；无效时回退原路径。修复资源文件（windres）、`Use83Paths`、`$TO_83_PATH`、`$file` 的畸形短路径 |
| 新增测试 | `tests/test-drive-case.js` +4（短路径回归）；`tests/test-compiler-wrapper.js` 资源断言兼容 8.3；`tests/e2e/test-e2e-ccache.js` 21 断言 |
| 文档 | 新增 [release/0.8.139.md](../release/0.8.139.md) 与 [完整复核报告](./test-report-0.8.139-full.md)；版本标记/README/使用说明/进度同步；覆盖矩阵重新生成 |
| 行为边界 | ASCII 路径与非 Windows 行为不变；8.3 短路径仍按 CB 语义使用；cmd/8.3 不可用时回退原路径；不改 ccache 规避、编译/链接流程或 CLI/调试链路 |
| 已知限制 | 非 ASCII **文件名 / 包含目录**仍无法自动修复（ccache 只接受 UTF-8 预处理输出），仅告警 + 文档指引；`sccache` 非 ASCII 未实测（本机无 sccache） |

## 4. 缺陷与处置（本轮 review 发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | `shortPathWin` 的 `/c` 参数被 Node 再次加引号，`cmd /s` 输出 `E:\"C:\...\"` / `D:\"...\"` | 资源文件（windres）、`Use83Paths`、`$TO_83_PATH`、`$file` 拿到非法路径；真实构建可能失败 | `windowsVerbatimArguments: true` + `cmd /u`；UTF-16LE 解码 + `existsSync` 校验，失败回退原路径 |
| 2 | 资源文件测试只断言「包含原始长路径」 | 畸形串仍含长路径 → 本地偶然通过；CI `RUNNER~1` 缩写后假红/暴露 | 改为提取 `-i` 路径，断言存在的绝对路径 + basename=`res.rc` |
| 3 | 非中文代码页下 `%~sI` 中文短路径可能变为 `??` | 短路径失效，windres 无法找到文件 | `cmd /u` 输出 UTF-16LE；仍无效则回退原路径 |
| 4 | 缺少 `shortPathWin` 直接回归 | 同类 cmd/编码问题只能靠间接断言发现 | `tests/test-drive-case.js` 新增 4 条（中文+空格、无畸形、缓存、特殊字符） |

> 0.8.138 的 ccache 非 ASCII 路径缺陷（仅开关不足、相对源路径、设置读取次数等）已在本版前序提交中修复，回归见 `tests/test-compiler-wrapper.js` / `test-compiler-cache-detect.js` / `test-parallel-jobs.js`。

## 5. 待办与已知限制

- **短路径手验建议**：在含空格/中文的工程路径下构建带 `.rc` 的工程，确认 windres 命令中的 `-i` 路径存在且能生成 `.res`；`cbp` 使用 `Use83Paths` 时检查 include/lib 目录仍可解析。
- **真实环境手验建议**：中文路径工程开启 `compilerCache = ccache` 后连续构建两次，`ccache -s` 应看到 `Cacheable calls` 全量增长且第二次出现 `Hits`；输出通道应只出现一次 info 说明。
- **无法自动修复**：源文件 / 头文件 / 包含目录含非 ASCII 时，该次编译仍不可缓存（ccache 只接受 UTF-8 预处理输出）——需改名为 ASCII 或把工程放到 ASCII 路径（FAQ 已写）。
- **已记录不修**：`Compile File (Without Project)` 的终端编码限制（见使用说明 §16）；`codeblocks.detectCompilers` 的真实并行探测缺项；`sccache` 的非 ASCII 行为未实测（本机无 sccache，未写入任何承诺）。