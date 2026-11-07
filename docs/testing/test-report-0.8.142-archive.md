# 测试执行报告（0.8.142 · 滚动更新）

> 生成时间：2026-11-06 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB ｜ ccache 4.14.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.142.md](../release/0.8.142.md)；上一版发布说明见 [release/0.8.141.md](../release/0.8.141.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 665 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=179 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具）；新增 `test-diagnostic-path.js`（18 断言） |
| L3 视觉 | `npm run test:visual` | **24/24** | 本版无 UI 布局改动；指纹匹配，严格判定，基线未刷新 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 真实工具链（本机 GCC 8.1 / MinGW）：构建 48、调试 143、边界 38、工具链 38、ccache 21，新增「链接期诊断定位」7 断言 |
| L4 性能 | `npm run test:perf` | **13 项** | 沿用 0.8.141 结论：B10 受本机负载影响（同一时刻手工 `gcc -c` 亦需 1.5 s，基线 0.14 s），未写回基线 |
| L5 打包 | `npm run test:pack` | **1/1（14 断言）** | VSIX 0.8.142 打包 / 安装冒烟通过 |
| 产物 | `npm run bundle` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **24/24（0 fail / 0 skip）**（沿用 0.8.140 复核；本版无宿主/调试适配层改动） | 真实 VS Code 1.85.0；激活/命令/设置/WebView/真实构建/真实 GDB/跨工具链 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 链接期诊断定位（`src/build/diagnosticPath.ts`） | `tests/test-diagnostic-path.js` **18 断言**：token 拆解（`file:(section)` / `obj:src:(section)` / `file:line`）、文件定位（`cwd` → 工程根 → basename → `.o` 回退源文件；同名多份取后缀匹配）、行号启发式（段名函数名 → 定义；未定义符号 → **调用处**并跳过 `extern`）、按文件缓存、与真实 `OutputParser` 串联 | 现场形态复现：`func_bt.c:(.text.func_bt_warning_discon+0x2e)` 与 MinGW `obj\...\x.o:x.c:(.text+0x9)` |
| 构建引擎接线 | `tests/e2e/test-e2e-linker-diagnostic.js` **7 断言**：真实 gcc 链接失败 → `onStructuredDiagnostic` 的 file = 真实源文件、line = 调用行（第 6 行）、`onDiagnostic` 的 URI 一致、伪路径 `:(.text` 消失 | 真机 MinGW GCC 8.1：`obj\Debug\...\link_err.o:link_err.c:(.text+0x9): undefined reference to ...` |
| 回归安全 | `test-e2e-build.js` 构建矩阵 48 断言保持全绿（构建命令 / 增量语义 / 产物零变化）；`unit 179 FAIL=0` | — |
| 文档与版本标记 | `test-contract.js` G1/G2/G3（CHANGELOG / README / 根目录 VSIX 版本）、`test-doc-consistency.js` D1/D1b/D3/D4/D5；`gen-release-notes.js --check`（13 条发布页） | `npm run coverage:matrix` 重新生成（命令 111 / 设置 83 未变） |

## 2. 覆盖台账（自动生成）

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 111 | 109 | 98% |
| 视图 | 5 | 5 | **100%** |
| 设置项 | 83 | 83 | **100%** |
| 快捷键 | 33 | 33 | **100%** |
| 语言/语法 | 6 | 6 | **100%** |
| DAP 能力 | 30 | 30 | **100%** |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，逐项列出命中层与未覆盖项）。
> 剩余缺口 2 个命令：`codeblocks.detectCompilers`（已登记的可解释缺项：真实并行探测外部编译器，需交互环境）、`codeblocks.restartClangd`（排障转发命令，其重启链路由 `test-clangd-settings-sync.js` 覆盖）。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | **无**（设置项总数保持 83） |
| 新增命令 | **无**（命令总数保持 111） |
| 行为变更 | 链接期诊断（`undefined reference`：`obj:src:(section)` / `src:(section)` / `file:line`）在解析位置打不开时，按工程文件表落回真实源码并从段名或未定义符号补出行号；已正确（绝对路径 + 行号）的诊断原样透传 |
| 新增测试 | `tests/test-diagnostic-path.js`（18 断言）、`tests/e2e/test-e2e-linker-diagnostic.js`（7 断言，真实 gcc） |
| 文档 | 新增 [release/0.8.142.md](../release/0.8.142.md) 与 [release/pages/0.8.142.md](../release/pages/0.8.142.md)；滚动报告重命名为 `test-report-0.8.142-archive.md`；覆盖矩阵重新生成 |
| 行为边界 | 工程外文件（系统头 / 第三方库）不猜测；`.o/.obj` 仅在工程文件表内回退；构建命令与产物零变化 |

## 4. 缺陷与处置（本轮发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | 链接期诊断把 `obj:src:(section)` 整串当文件名、行号缺失 | Build Log Errors 点击不跳、构建结束不自动跳（Warnings 正常） | 新增 `diagnosticPath` 拆解 + 工程文件表定位 |
| 2 | 相对路径按链接命令 cwd 拼接（源文件在子目录） | Problems 条目指向不存在的路径 | 依次尝试 `cwd` / 工程根 / basename 索引 |
| 3 | 首版行号启发式命中 `extern` 声明（第 2 行）而非调用（第 6 行） | 跳到文件头部附近 | `findIdentifierLine(..., 'call')` 跳过 `extern`/类型前缀行 |
| 4 | 全局替换版本号时误改历史引用（`0.8.136–0.8.141` → `–0.8.142`） | 进度文档描述失真 | 回滚该文件并按行精确改写（表行 / 当前版本块 / VSIX 名） |

## 5. 待办与已知限制

- **人工验收（建议）**：打开含 `undefined reference` 的工程并构建 → Build Log 的 Errors 条目应显示 `源文件:行`（如 `func_bt.c:6`），点击跳到调用行；构建结束自动跳首个错误亦生效；Problems 面板同一错误点击可跳。
- **已记录不修**：`codeblocks.detectCompilers` 覆盖缺口（沿用 0.8.139 说明）；`codeblocks.restartClangd` 属排障转发命令，不单独做覆盖矩阵登记；ccache 对非 ASCII **文件/目录名**的限制不变（只告警 + 文档指引）。
