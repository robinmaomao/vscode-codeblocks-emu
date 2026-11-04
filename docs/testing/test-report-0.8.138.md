# 测试执行报告（0.8.138 · 滚动更新）

> 生成时间：2026-11-04 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB ｜ ccache 4.14.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 根因取证与逐项方案见 [release/0.8.138.md](../release/0.8.138.md)；上一版发布说明见 [release/0.8.137.md](../release/0.8.137.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 659 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=176 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具，不参与自动回归） |
| L3 视觉 | `npm run test:visual` | **24/24** | 本版无 UI 改动；面板基线未刷新 |
| L1 端到端 | `npm run test:e2e` | **4/4** | 真实工具链（本机 GCC 8.1 / MinGW）：构建矩阵 48、调试矩阵 143、工具链 38、边界 38 |
| L4 性能 | `npm run test:perf` | **1/1（12 pass / 1 warn / 0 fail）** | 构建链路仅「ccache 开启 + 非 ASCII 路径」分支变化，默认配置微基准未退化 |
| L5 打包 | `npm run test:pack` | **1/1（14 断言）** | VSIX 0.8.138 打包 / 安装冒烟通过 |
| 产物 | `npm run bundle` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | 未执行 | 需 VS Code 宿主（`@vscode/test-electron`），按需在本机执行 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| ccache 非 ASCII 路径修复（命令注入 + 相对源路径 + 告警） | `tests/test-compiler-wrapper.js` **37 断言**：非 ASCII 工程追加 `-fno-working-directory` 且前缀仍在、命令其余部分与基线一致；ASCII 工程不加开关且逐字节一致；链接/资源/noCompilerCache/sccache/MSVC/cache=none 均不追加；`collectMakefileData` 的源路径切换与资源文件绝对路径保持；`buildEngine` info/warn 各一次 + 跨引擎去抖；`tests/test-compiler-cache-detect.js` **新增 8 断言**（`hasNonAscii` / `firstNonAscii` / `isGnuLikeCompilerProgram` / `ccacheNeedsAsciiPaths` / 开关名）；`tests/test-parallel-jobs.js` D3 设置读取次数不变 | 真实 ccache 4.14.1 + MinGW GCC 8.1：中文路径工程 `Cacheable calls` **0% → 100%**、二次构建 **4 次 Direct HIT**、Release 单文件 2.5 s → 0.1 s；`objdump` 核对 `.text` 一致、`DW_AT_name` / `DW_AT_comp_dir` 正常；ASCII 路径对照 0.8.137 命令逐字节一致 |

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
| 新增设置 | **无**（沿用 `codeblocks.build.compilerCache` / `compilerCachePath`） |
| 行为变更 | `ccache` 已启用、工具已探测到、编译器属 GCC/Clang 且工程根路径含非 ASCII 时：标准编译命令追加 `-fno-working-directory`，编译单元改用工程相对源路径；构建开始输出一次 info |
| 新增告警 | 源文件 / 头文件 / 包含目录仍含非 ASCII 时 warn（含示例文件名与出路），跨引擎 10 s 去抖 |
| 新增单测 | `tests/test-compiler-wrapper.js` +16、`tests/test-compiler-cache-detect.js` +8、`tests/test-build-cpu-guards.js` C1 断言改为校验合并后的记忆化 |
| 文档 | 新增 [release/0.8.138.md](../release/0.8.138.md)；[usage.md](../guide/usage.md) / [usage.en.md](../guide/usage.en.md) §13.2 与 §15 FAQ、[settings.md](../guide/settings.md) / [settings.en.md](../guide/settings.en.md) 的 `compilerCache` 条目同步；覆盖矩阵重新生成 |
| 行为边界 | ASCII 路径命令与 0.8.137 逐字节一致；资源文件（windres）、`sccache`、`cache=none` 行为不变；不新增设置项、不改 CLI/调试链路 |
| 已知限制 | 非 ASCII **文件名 / 包含目录**无法自动修复（ccache 只接受 UTF-8 预处理输出），仅告警 + 文档指引 |

## 4. 缺陷与处置（本轮 review 发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | 非 ASCII 工程根路径只手加 `-fno-working-directory` 时仍 0% 可缓存 | 修复无效：绝对源路径同样把中文目录的 GBK 字节带进 `# 1 "<文件>"`（实测 `Cacheable calls: 0/4`） | 规避生效时编译单元改用工程相对源路径；实测恢复 4/4 可缓存 + 4 次 Direct HIT |
| 2 | 非 ASCII 路径检查独立读设置，导致每单元设置读取 3 次 | 违反 D3「每单元 ≤2 次」性能守卫（`test-parallel-jobs` 变红） | 与「工具缺失」检查合并为一次读取，规避标志顺带求值；`cache=none` 直接置 false（零影响） |
| 3 | 前缀与非 ASCII 规避各持一份记忆化 → 单实例 2 次设置读取 | 千文件工程多一轮 getConfiguration（`test-compiler-wrapper` 记忆化断言变红） | 合并为 `compilerCacheSettings()` 单一记忆化（前缀 + 规避共用） |
| 4 | 资源文件（windres）也被切成相对路径 | windres 不前置缓存程序、不加开关，属无谓的命令行变化 | `compileSourcePath` 排除 `FileType.Resource`，保持 CB 的绝对路径 + 8.3 短路径语义 |
| 5 | 文件级告警遍历全部工程文件 | 笔记类中文文件名会误报「源文件含非 ASCII」 | 只统计可编译类型 + 头文件 |
| 6 | 规避条件与 `isGnuLikeCompilerProgram` 判定分散在两处 | 条件漂移风险 | 抽成纯函数 `ccacheNeedsAsciiPaths(kind, toolResolved, gnuLike, basePath)` 并加单测 |

## 5. 待办与已知限制

- **真实环境手验建议**：中文路径工程开启 `compilerCache = ccache` 后连续构建两次，`ccache -s` 应看到 `Cacheable calls` 全量增长且第二次出现 `Hits`；输出通道应只出现一次 info 说明。
- **无法自动修复**：源文件 / 头文件 / 包含目录含非 ASCII 时，该次编译仍不可缓存（ccache 只接受 UTF-8 预处理输出）——需改名为 ASCII 或把工程放到 ASCII 路径（FAQ 已写）。
- **已记录不修**：`Compile File (Without Project)` 的终端编码限制（见使用说明 §16）；`codeblocks.detectCompilers` 的真实并行探测缺项；`sccache` 的非 ASCII 行为未实测（本机无 sccache，未写入任何承诺）。