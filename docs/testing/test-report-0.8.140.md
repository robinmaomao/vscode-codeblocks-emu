# 测试执行报告（0.8.140 · 滚动更新）

> 生成时间：2026-11-05 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB ｜ ccache 4.14.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.140.md](../release/0.8.140.md)；上一版发布说明见 [release/0.8.139.md](../release/0.8.139.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 665 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=177 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具，不参与自动回归）；新增 `test-build-performance-advisor.js`（31 断言） |
| L3 视觉 | `npm run test:visual` | **24/24** | 本版无 UI 改动；指纹匹配，严格判定，基线未刷新 |
| L1 端到端 | `npm run test:e2e` | **5/5（288 pass / 0 fail / 8 skip）** | 真实工具链（本机 GCC 8.1 / MinGW）：构建 48、调试 143、边界 38、工具链 38、ccache 21 |
| L4 性能 | `npm run test:perf` | **1/1（13 pass / 0 warn / 0 fail）** | 硬预算 `min ≤ 预算` 全部通过；复跑一次消除首轮的冷缓存告警 |
| L5 打包 | `npm run test:pack` | **1/1（14 断言）** | VSIX 0.8.140 打包 / 安装冒烟通过 |
| 产物 | `npm run bundle` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **24/24（0 fail / 0 skip）** | 真实 VS Code 1.85.0；激活/命令/设置/WebView/真实构建/真实 GDB/跨工具链 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 归因告警门控（`build.performanceAdvisor`） | `tests/test-build-performance-advisor.js` **31 断言**：设置声明/默认 false/双语 nls/设置键唯一；dist 源码断言四类收尾归因在 `adviceEnabled()` 分支内、低内存检查同受门控、`build.profile` 与 `build.sampleSystem` 放行、`[profile]` 块与 `traceProcesses` 行**不受**门控；四份文档均覆盖新键 | 设置契约 665 断言（含 83 项设置与 4 张文档表）；覆盖矩阵 `设置 83/83` |
| 设置计数与文档联动 | `tests/test-settings-structure.js`（82→83）、`tests/contract/test-settings-contract.js`（82→83）、`tests/contract/test-doc-consistency.js`（版本标记/台账/链接） | `npm run coverage:matrix` 重新生成，汇总 `设置 total=83 covered=83` |
| 打包与版本标记 | `tests/contract/test-contract.js` G1/G2/G3（CHANGELOG / README / 根目录 VSIX 版本一致） | 根目录旧 `codeblocks-vscode-0.8.139.vsix` 已删除，避免版本标记红 |

## 2. 覆盖台账（自动生成）

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 110 | 109 | 99% |
| 视图 | 5 | 5 | **100%** |
| 设置项 | 83 | 83 | **100%** |
| 快捷键 | 33 | 33 | **100%** |
| 语言/语法 | 6 | 6 | **100%** |
| DAP 能力 | 30 | 30 | **100%** |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，逐项列出命中层与未覆盖项）。
> 剩余缺口 1 个命令：`codeblocks.detectCompilers`（已登记的可解释缺项：真实并行探测外部编译器，需交互环境）。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | **`codeblocks.build.performanceAdvisor`**（boolean，默认 `false`）；设置项总数 82 → **83** |
| 行为变更 | 五类构建期归因告警（宿主卡顿 + `dispatch wait` 判定 / 第三方实时防护 / VS Code 文件扫描器 / CPU 饱和 / 构建开始低内存）统一受门控；`build.profile` 或 `build.sampleSystem` 开启时自动输出（诊断模式），无需额外设置 |
| 新增测试 | `tests/test-build-performance-advisor.js`（31 断言：配置面 + dist 源码门控接线 + 文档面） |
| 文档 | 新增 [release/0.8.140.md](../release/0.8.140.md)；`README(.en)` / `settings.md(.en)` / `usage.md(.en)` 四张设置表与双语 nls 同步；滚动报告重命名并更新台账；覆盖矩阵重新生成 |
| 行为边界 | `[profile]` 计时块、`build.traceProcesses` 子进程行、`build.sampleSystem` 系统 CPU 汇总块、`plainCb` 纯日志模式全部不变；宿主滞后/系统 CPU 采样本身照旧运行（只是告警输出被门控） |
| 已知限制 | 满核并行编译时「宿主卡顿占比」天然偏高（定时器自身被饿死），只能作诊断参考；判断扩展开销应看 `dispatch wait` |

## 4. 缺陷与处置（本轮 review 发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | 编辑 `package.nls.json` 时误将 `lowerCompilerPriority` 的键前缀替换为新键，值尾部悬空 | 设置文案丢失、JSON 损坏导致扩展加载失败 | 立即修正；每次编辑后用 `node -e require(...)` 校验可解析，两语言包键数一致（229） |
| 2 | 遗漏 `tests/test-settings-structure.js` 的设置计数硬断言（82） | 无头层 `FAIL=1`（`设置项总数 = 82 got=83`） | 断言与文件头注释同步改为 83 |
| 3 | 滚动测试报告未随版本重命名、§2 台账仍是 82 | 契约层 D1b/D5 红（文件名版本、台账总数/已覆盖数） | `git mv` 为 `test-report-0.8.140.md`，H1/台账/变更说明同步；全仓引用链接批量更新 |
| 4 | 根目录遗留 `codeblocks-vscode-0.8.139.vsix` | 契约 G3「根目录 VSIX 版本 == package.json」红 | 打包 0.8.140 后删除旧产物 |
| 5 | `adviceEnabled()` 初版只认 `this.prof` 与两项设置，工程级 `build.profile` 覆盖时不一致 | 文件夹级开启 profile 时告警不出现（诊断体验不一致） | 增加 `scopeConfig()` 的 `build.profile` 判断 |

## 5. 待办与已知限制

- **人工验收（必做）**：① 默认设置构建 → 输出通道不再出现四行 ⚠️ 归因；② `codeblocks.build.profile = true` → 四行恢复且 `[profile]` 块正常；③ 仅 `codeblocks.build.sampleSystem = true` → 归因告警与系统 CPU 汇总都出现。
- **验证方式说明**：新增回归 `tests/test-build-performance-advisor.js` 共 31 断言，其中 10 条是**行为级**——用 `tests/_harness/vscodeMock` 装载真实 `dist/build/buildEngine.js`，注入「卡顿 60% / 最长 975 ms」的构建统计后调用 `emitBuildProfile()`，验证默认 0 条告警、打开后恰好 4 条（含 `dispatch wait` 判定）、诊断模式同时输出 `[profile]`，以及对 `os.totalmem/freemem` 打桩验证低内存检查的门控（打桩必定还原）。其余为配置面/文档面与 dist 源码接线断言。
- **已记录不修**：`codeblocks.detectCompilers` 覆盖缺口（沿用 0.8.139 说明）；ccache 对非 ASCII **文件/目录名**的限制不变（只告警 + 文档指引）；`sccache` 非 ASCII 未实测。