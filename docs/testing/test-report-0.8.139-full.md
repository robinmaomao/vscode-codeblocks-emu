# 完整测试验证报告（0.8.139 · 独立复核）

> 生成时间：2026-11-05 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 / npm 11.17.0 ｜ CPU i3-10105 ×8 @ 3.70GHz ｜ 15.8GB
> 代码版本：`0.8.139`（0.8.138 + 8.3 短路径修复），发布提交见仓库历史
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 本报告为**独立复核**，不改动滚动报告 [test-report-0.8.141-agent-control.md](./test-report-0.8.141-agent-control.md)，也不刷新视觉/性能基线。

## 1. 结论摘要

- **全部分层通过**：契约、无头单元、真实工具链 E2E、像素视觉、性能、打包、**真实 VS Code 宿主**共 **188 个脚本 / 0 fail / 1 个手工 SKIP**；全量套件整体耗时 **454.6 s**。
- **补齐空白**：滚动报告标注「未执行」的 **L2 宿主层**本轮实际执行，**24 用例全部通过（0 fail / 0 skip）**，靶点 VS Code **1.85.0**。
- **ccache 修复独立复现**：中文路径下「绝对源路径 + 仅开关」仍 **0/1 可缓存**；改为「工程相对源路径 + `-fno-working-directory`」后 **2/2 可缓存、1 次 Direct HIT**；`.text` 与 ASCII 对照逐字节一致，`DW_AT_comp_dir` 保留完整中文路径。
- **8.3 短路径修复**：`shortPathWin` 原实现返回 `E:\"C:\...\"` / `D:\"...\"` 畸形路径（CI run `41836259345` 暴露）；改为 `windowsVerbatimArguments + cmd /u` + UTF-16LE 解码 + `existsSync` 校验后，真实 `windres` 以 `CB-RC-~1\中文资~1\res.rc` 成功生成 `.res`。
- **新增回归**：新增 [tests/e2e/test-e2e-ccache.js](../../tests/e2e/test-e2e-ccache.js)（21 断言）与 `tests/test-drive-case.js` 4 条短路径断言；无 ccache 时按约定 SKIP（已单独验证）。

## 2. 环境与版本

| 项 | 值 |
|----|----|
| 操作系统 | Windows 10 x64（中文代码页 CP936） |
| Node / npm | v24.19.0 / 11.17.0 |
| 编译器 | MinGW-W64 GCC 8.1.0（`gcc` / `g++` / `ar` / `objcopy` / `objdump` / `gdb`） |
| 编译缓存 | ccache **4.14.1**（WinGet 安装） |
| 视觉浏览器 | 系统 Edge **121.0.2277.83**（指纹 `win32-x64_msedge-121_dsf1`） |
| VS Code 靶点 | 1.85.0（`.vscode-test/vscode-win32-x64-archive-1.85.0`） |
| `code` CLI | 可用（打包安装冒烟） |
| 代码版本 | `0.8.139`（0.8.138 + 8.3 短路径修复） |
| 构建产物 | `bundle/extension.js` **1,847,594 B** |

## 3. 分层结果

| 层 | 命令 | 脚本数 | 本轮结果 | 说明 |
|----|------|--------|----------|------|
| L-1 契约 | `npm run test:contract` | 3 | **709 断言全通过** | 契约 44 + 文档一致性 6 + 设置契约 659 |
| L0 无头单元 | `npm test` | 176 | **0 fail，1 个手工 SKIP** | SKIP=`test-writer.js`（需 `<cbp>` 参数） |
| L1 真实工程 E2E | `npm run test:e2e` | 5 | **288 pass / 0 fail / 8 skip** | 构建 48、调试 143、边界 38、工具链 38、**新增 ccache 21** |
| L2 真实宿主 | `npm run test:host` | 1 | **24 pass / 0 fail / 0 skip** | VS Code 1.85.0；激活/命令/设置/WebView/真实构建/真实 GDB/跨工具链 |
| L3 像素视觉 | `npm run test:visual` | 1 | **24/24** | 12 面 × dark/light；指纹匹配，**严格判定**（threshold=0.1、≤0.5%） |
| L4 性能 | `npm run test:perf` | 1 | **13/13 pass，0 warn** | 硬预算 `min ≤ 预算` 全部通过 |
| L5 打包 | `npm run test:pack` | 1 | **14 断言通过** | VSIX 0.8.139（668,573 B）+ 隔离安装/卸载冒烟 |
| 产物 | `npm run bundle` | — | 通过 | esbuild 无告警 |
| **全量** | `npm run test:all:host` | **188** | **TOTAL=188 FAIL=0 SKIP=1** | 整体 **454.6 s** |

### 3.1 改动相关快检

| 脚本 | 结果 |
|------|------|
| `tests/test-compiler-cache-detect.js` | **47 pass / 0 fail**（非 ASCII 判定、GNU 家族、`ccacheNeedsAsciiPaths`） |
| `tests/test-compiler-wrapper.js` | **37 pass / 0 fail**（前缀、开关、相对源路径、资源文件绝对路径、告警去抖） |
| `tests/test-drive-case.js` | **全 PASS**（新增 4 条 `shortPathWin`：中文+空格、无畸形、缓存、特殊字符） |
| `tests/test-build-cpu-guards.js` | **10 pass / 0 fail**（合并后的记忆化） |
| `tests/test-parallel-jobs.js` | **52 pass / 0 fail**（D3 设置读取 ≤2 次；上一轮 51/1 已随合并记忆化转绿） |

## 4. 与滚动报告逐项对照

| 项 | 滚动报告（0.8.139） | 本次独立复核 | 结论 |
|----|---------------------|--------------|------|
| 契约 | 3/3（44 + 6 + 659） | 3/3，709 断言全通过 | 一致 |
| 单元 | TOTAL=176 FAIL=0 SKIP=1 | 176 脚本全 exit 0，1 手工 SKIP | 一致 |
| E2E | 5/5（48/143/38/38/21） | 5/5 全部复现（288 pass / 8 skip） | 一致 |
| 视觉 | 24/24，未刷新基线 | 24/24，严格判定，指纹一致 | 一致 |
| 性能 | 13 pass / 0 warn / 0 fail | 13 pass / 0 warn / 0 fail | 一致 |
| 打包 | 1/1（14 断言） | 14 断言通过（VSIX 668,573 B） | 一致 |
| **宿主** | **24/24** | **24 pass / 0 fail / 0 skip** | 一致 |

## 5. ccache 非 ASCII 路径专项验证

### 5.1 对照实验（ccache 4.14.1 + GCC 8.1，中文路径 `中文 工程`）

| # | 场景 | 源路径 | `-fno-working-directory` | Cacheable calls | Hits | Uncacheable |
|---|------|--------|--------------------------|-----------------|------|-------------|
| A | 基线（无规避） | 绝对（含中文） | 否 | **0 / 1** | 0 | 1 |
| B | 只加开关 | 绝对（含中文） | 是 | **0 / 1** | 0 | 1 |
| C | 完整规避 | **工程相对** `main.c` | 是 | **2 / 2** | **1（Direct）** | 0 |
| D | ASCII 对照 | 相对 `main.c` | 否 | 2 / 2 | 1（Direct） | 0 |

> 结论：只有 B 的「仅追加开关」不足以恢复缓存，必须同时把编译单元改为工程相对源路径——与 [release/0.8.138.md](../release/0.8.138.md) 缺陷 #1 的记录一致。

### 5.2 产物一致性

| 对比 | `.text` | 大小 |
|------|---------|------|
| B（开关 / 绝对路径） vs C（开关 / 相对路径） | **逐字节一致** | 80 B / 80 B |
| C（中文路径 / 相对） vs D（ASCII 对照） | **逐字节一致** | 80 B / 80 B |
| DWARF | `DW_AT_name = main.c`；`DW_AT_comp_dir` 为完整中文路径（按 GBK 解码正确） | — |

### 5.3 新增自动化回归

- 文件：[tests/e2e/test-e2e-ccache.js](../../tests/e2e/test-e2e-ccache.js)，**21 断言，0 fail**。
- 覆盖：中文路径构建成功、命令含 ccache 前缀、以 `-fno-working-directory` 结尾、源文件为相对路径、链接命令不加开关、info 说明恰好一次、无「仍无法缓存」告警、真实 ccache `Cacheable calls > 0` 且 `Uncacheable = 0`、二次构建 `Hits > 0`。
- 负例：ASCII 工程仍用绝对源路径且不加开关；`compilerCache=none` 不前置 ccache、不加开关、仍用绝对路径。
- SKIP 验证：把 ccache 从 PATH 移除后执行 → `SKIP ... 未找到 ccache`，退出码 0（不伪造通过）。

## 6. 失败与 SKIP

### 6.1 失败

**无。** 全量套件 `FAIL=0`；改动相关快检与新增 E2E 均 0 fail。

### 6.2 SKIP 明细

| 层 | 项 | 原因 |
|----|----|------|
| unit | `test-writer.js` | 手工工具，需 `<cbp>` 参数，不参与自动回归（按设计） |
| e2e 边界 | S2.1 真实只读目录构建 | 本机非管理员 Windows 无法构造真实只读（`attrib +R` 后写探针仍成功），按约定退化为写盘失败注入 |
| e2e 边界 | S3.5 可达 UNC 构建 | 管理共享 `\\localhost\C$` 不可访问（非管理员令牌/默认共享未启用） |
| e2e 边界 | S4.4 进度通知取消按钮 | mock 的 `withProgress` 不暴露取消令牌；取消语义已由 Cancel 命令覆盖 |
| e2e 调试 | S1 全量寄存器读取 | MinGW GDB 8.1 读取全量寄存器会崩溃（产品已按设置门控） |
| e2e 工具链 | clang-avr / clang-msp430 | 本机 clang 未编译 AVR / MSP430 后端 |
| e2e 工具链 | MSP430 GCC / SDCC | 未安装（TI 包需交互式下载；SDCC 未纳入自动安装） |
| host | 无 | 24/24 全部执行 |

### 6.3 8.3 短路径修复（0.8.139）

- **CI 取证**：run `41836259345` 的 `test-compiler-wrapper.js` 资源断言失败，命令为 `windres ... -i "D:\"C:\Users\RUNNER~1\...\res.rc\""`。
- **根因**：`shortPathWin` 的 `spawnSync('cmd', ['/d','/s','/c', 'for %I ...'])` 被 Node 再次加引号，`cmd /s` 输出「当前盘符 + `\"原路径\"`」；本地测试因畸形串仍含长路径而偶然通过，CI 的 `RUNNER~1` 缩写使其失败。
- **修复**：`windowsVerbatimArguments: true` + `cmd /u`；UTF-16LE 解码 + `existsSync` 校验，失败回退 `decodeText` 与原路径；`tests/test-compiler-wrapper.js` 资源断言改为「存在的绝对路径 + basename=res.rc」；`tests/test-drive-case.js` 新增 4 条 `shortPathWin` 回归。
- **实测**：真实 `windres` 以 `CB-RC-~1\中文资~1\res.rc` 成功生成 `.res`（228 B）；全量套件 188/0/1。

## 7. 性能明细（13 项，全部通过）

| 基准 | min (ms) | median (ms) | 预算 (ms) | 结果 |
|------|----------|-------------|-----------|------|
| B1 大工程冷解析（1200 文件 / 6 目标） | 18.07 | 34.46 | 128.22 | pass |
| B1b 解析缓存命中 | 11.59 | 16.04 | 48.03 | pass |
| B1c 序列化往返 | 15.48 | 15.79 | 67.44 | pass |
| B2 编译命令行生成 + 宏展开（1200 文件） | 805.92 | 960.72 | 3894.15 | pass |
| B3 输出解析 → 诊断（2 万行 / 2000 条） | 84.57 | 86.34 | 1888.65 | pass |
| B4 编译器选项 XML 全量加载 | 2.45 | 2.95 | 11.13 | pass |
| B5 LRU 10 万次 + 盘符归一化 5 万次 | 64.65 | 65.24 | 200.46 | pass |
| B6 虚拟文件夹索引（1200 文件） | 0.82 | 0.91 | 10.00 | pass |
| B7 增量判定 `isUpToDate` | 10.61 | 13.64 | 36.84 | pass |
| B8 真实全量构建（gcc 3 文件 + 链接） | 354.47 | 443.62 | 1123.29 | pass |
| B9 真实增量 up-to-date | 65.80 | 92.23 | 177.18 | pass |
| B10 真实单文件编译 | 132.34 | 135.62 | 450.60 | pass |
| B11 post-build 后台进程不阻塞 | 686.56 | 844.70 | 2000.00 | pass |

> 门禁口径为 `min ≤ 预算`；`median` 仅用于趋势告警。本轮 13 项全部 pass、0 warn；`shortPathWin` 修复不改变编译/链接主路径，未观察到门禁级退化。

## 8. 未覆盖 / 待人工项

以下为自动化不可覆盖或本机条件不满足的项，**未计入本轮通过结论**：

- **外部修改 `.cbp` 提示**：真实编辑器改 `test-project/hello-cb.cbp` 后切回 VS Code，应弹「已在磁盘上被修改」（`重新加载` / `全部重新加载` / `忽略`）。
- **8.3 短路径手验**：在含空格/中文的工程路径构建带 `.rc` 的工程，确认 windres 命令 `-i` 路径存在且能生成 `.res`；`Use83Paths` 的 include/lib 目录可解析。
- **面板手工交互**：[手工验收清单](./manual-acceptance.md) §4（窄面板 520 px、英文界面、未切 tab 直接保存等）。
- **`sccache` 非 ASCII 行为**：本机未安装 sccache，未做实测；产品保持原行为。
- **`Compile File (Without Project)` 编码限制**：走 VS Code 任务终端（固定 UTF-8），无法解码编译器 GBK 输出（已记录不修）。
- **`codeblocks.detectCompilers`**：真实并行探测外部编译器需交互环境（覆盖矩阵登记的可解释缺项）。
- **宿主靶点**：本轮为最低支持版本 1.85.0，未覆盖最新版宿主差异。

## 9. 基线冻结与仓库状态

- 视觉：**未执行** `visual:baseline`；24 面在入库基线上严格判定通过，`tests/visual/baselines/.fingerprint.json` 未变更。
- 性能：**未执行** `perf:report` / `perf:baseline`；`docs/testing/performance-baseline.md` 与 `tests/perf/baseline.json` 未变更。
- 文档：滚动报告、完整复核、发布说明、版本标记已按 0.8.139 更新；覆盖矩阵重新生成。
- 仓库：本报告与 `tests/e2e/test-e2e-ccache.js` 随 0.8.139 提交；无基线或构建产物入库。

## 10. 取证产物（本机 `.cb-tools/`，gitignored）

| 产物 | 路径 |
|------|------|
| 全量套件日志 | `.cb-tools/test-all.log` |
| 结构化结果 | `.cb-tools/report-all.json` |
| 预检日志 | `.cb-tools/precheck-*.log`、`precheck-summary.txt` |
| ccache 对照实验 | `.cb-tools/ccache-probe.log`、`ccache-probe-result.json` |
| E2E SKIP 取证 | `.cb-tools/skip-*.log`、`skip-reasons.txt` |
| 性能原始结果 | `.cb-tools/perf/perf-2026-11-05T01-44-34-853Z.json` |
| 打包产物 | `.cb-tools/pack/codeblocks-vscode-0.8.139.vsix` |

## 11. 总体结论

0.8.139 在**契约、单元、E2E、视觉、性能、打包、真实宿主**七个自动化层级上全部通过；滚动报告中缺失的宿主层已补齐为 **24/24**；ccache 非 ASCII 路径修复的根因与两段式规避均被独立复现（仅开关无效、相对路径 + 开关恢复 100% 可缓存与命中）；8.3 短路径畸形已修复并由真实 `windres` 与新增单测覆盖。未发现其余需要修复的产品缺陷；建议按 §8 完成剩余人工验收项。

