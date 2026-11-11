# 测试执行报告（0.8.148 · 滚动更新）

> 生成时间：2026-11-11 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.148.md](../release/0.8.148.md)；上一版发布说明见 [release/0.8.147.md](../release/0.8.147.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 686 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=188 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具）；本版新增/扩展 `test-diagnostic-path.js`（26 断言）、`test-error-navigation.js`（19 断言）、`test-encoding-lines.js`（29 断言） |
| L3 视觉 | `npm run test:visual` | **24/24** | 未改动任何面板/布局；Build Log 仅节点文案与命令门控变化 |
| L1 端到端 | `npm run test:e2e` | **6/6** | 链接期诊断测试 **9 断言**（新增 `obj/*.o:(.text+0x9)` 形态）；其余构建/调试链沿用既有结论 |
| L4 性能 | `npm run test:perf` | **13 项（12 pass / 1 fail）** | B8「真实全量构建」受本机 gcc 进程启动 268–513ms、系统负载 48% 影响（min 3038ms > 预算 1123ms），与本版改动无关；其余 12 项通过 |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.148 打包 / 安装冒烟通过，含 `bundle/search-worker.js` 检查 |
| 产物 | `npm run bundle` + `npm run bundle:search` | 通过 | esbuild 无告警；worker 单独产物已生成 |
| L2 宿主 | `npm run test:host` | **24/24（0 fail / 0 skip）** | 沿用 0.8.140 复核；本版未改动视图声明/宿主协议 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 诊断定位（`src/build/diagnosticPath.ts`） | `tests/test-diagnostic-path.js` **26 断言**：token 拆解（`file:(section)` / `obj:src:(section)` / `file:line`）、段名函数名/未定义符号行号、**剥段名后文件已正确仍返回真实文件**、**`.o` 存在也回退同名源码**、**同目录源码回退**、`.o` 无源码返回 undefined、`isNavigableDiagnosticFile`（伪工具名/二进制/残留段名） | 复现脚本：`src/main.c:(.text+0x9)`、`obj/Debug/main.o:(.text+0x9)` 均落到真实源码 |
| Build Log 节点（`buildLogTreeProvider.ts`） | `tests/test-error-navigation.js` **19 断言**：伪文件/对象文件不进 F4、**树节点不挂无效命令**、真实源码节点仍挂 `codeblocks.openLocation`、无源码位置节点带提示 | 点击 Errors 条目跳转；无源码位置条目点击无动作（预期） |
| ANSI 清理（`src/tools/encoding.ts`） | `tests/test-encoding-lines.js` **29 断言**（CSI/OSC/无 ESC 快路径 + `decodeOutputLines` 清理）；`test-diagnostic-path.js` C5–C7 断言清理后真实 `OutputParser` 能解析彩色行 | `-fdiagnostics-color=always` 输出不再出现 `[01m` 噪声 |
| 诊断跳转回归 | 真实 gcc 链接失败（e2e）S1–S9：`undefined reference` 落到源码/调用行，Problems URI 一致，`.o` 形态不残留 `:(.text` | — |
| 回归安全 | `test-keybindings`、`test-keybinding-config`、`test-settings-structure`（85 设置）、`test-settings-coverage`、`test-menu-structure`、`test-bundle-packaging` 全绿 | — |
| 文档与版本标记 | `test-contract.js` G1/G2/G3、`test-doc-consistency.js` D1/D1b/D3/D4/D5；`gen-release-notes.js --check` | `npm run coverage:matrix` 重新生成（命令 113 / 视图 6 / 设置 85 / 快捷键 34） |

## 2. 覆盖台账（自动生成）

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 113 | 111 | 98% |
| 视图 | 6 | 6 | **100%** |
| 设置项 | 85 | 85 | **100%** |
| 快捷键 | 34 | 34 | **100%** |
| 语言/语法 | 6 | 6 | **100%** |
| DAP 能力 | 30 | 30 | **100%** |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，逐项列出命中层与未覆盖项）。
> 命令缺口 2 个：`codeblocks.detectCompilers`（交互式并行探测）、`codeblocks.restartClangd`（排障转发）。新增的两个搜索命令由 Provider/HTML/纯逻辑/命令注册测试覆盖。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | 无（设置项总数保持 **85**） |
| 新增命令 | 无（命令总数保持 **113**） |
| 新增视图 | 无（视图总数保持 **6**） |
| 新增快捷键 | 无（快捷键总数保持 **34**） |
| 行为变更 | 无源码位置诊断（链接器/工具输出、伪工具名、构建产物）不再挂跳转命令，显示「无源码位置（链接器/工具输出）」；`.o/.obj` 不再作为跳转目标；不可导航的 Problems 诊断回退到工程根 |
| 0.8.148 修复 | 诊断定位的「无改善」判断改用原始 token；对象文件只作「找同名源码」线索（工程索引 + 同目录源码）；新增 `isNavigableDiagnosticFile` 统一门控 Build Log 树与 Problems |
| 0.8.148 ANSI | 子进程行输出统一 `stripAnsi`（构建 / 脚本 / GDB）；`-fdiagnostics-color=always` 不再破坏诊断正则 |
| 新增/扩展测试 | `test-diagnostic-path.js` **26 断言**、`test-error-navigation.js` **19 断言**、`test-encoding-lines.js` **29 断言**、e2e 链接期诊断 **9 断言** |
| 文档 | 新增 [release/0.8.148.md](../release/0.8.148.md) 与 [release/pages/0.8.148.md](../release/pages/0.8.148.md)；usage(.en) §10、manual-acceptance、progress、CHANGELOG 同步；覆盖矩阵重新生成 |
| 行为边界 | 工程外对象无同名源码时不猜测（保持不可导航）；clangd 模式诊断来源与行为不变 |

## 4. 缺陷与处置（本轮发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | `resolveDiagnosticLocation` 用剥掉 `:(section)` 的 token 做 `unchanged` 比较 | 文件本来就对、行号推不出时返回 `undefined` ⇒ 调用方回退到带 `:(.text+0x9)` 的原始路径，点击必然失败 | 改用原始 `input.file` 比较；剥段名后落到真实文件即视为改善 |
| 2 | `resolveExistingFile` 先判存在，`.o/.obj` 链接阶段必然存在 | 对象文件（二进制）被当成跳转目标，或行号探测失败后留下伪路径 | `.o/.obj` 跳过「存在即返回」，只走源码索引/同目录源码回退，绝不返回对象文件 |
| 3 | 无源码位置诊断仍按可点击渲染，`openFileAtLocation` 失败静默 | `ld.exe`/`collect2.exe` 条目点击无反应、无提示 | 树节点与 Problems 统一过滤；无源码位置显示提示、不挂命令；`codeblocks.openLocation` 失败弹 warning |
| 4 | ANSI 颜色码插入 `file:line:col:` 之间 | `-fdiagnostics-color=always` 时整行解析失败，Build Log/Problems 为空 | `stripAnsi` 在行解码阶段统一清理（CSI/OSC），无 ESC 行走 `includes` 快路径 |

## 5. 待办与已知限制

- **人工验收**：按 [手工验收清单](./manual-acceptance.md) §3 构建交互执行链接期跳转、无源码位置提示、ANSI 输出、失效路径警告。
- **已记录限制**：工程外对象且找不到同名源码时不猜测跳转目标（条目保留消息、无跳转）；`make` 自定义工程仍不经构建引擎解析诊断。
