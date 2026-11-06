# 测试执行报告（0.8.141 · 滚动更新）

> 生成时间：2026-11-06 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB ｜ ccache 4.14.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.141.md](../release/0.8.141.md)；上一版发布说明见 [release/0.8.140.md](../release/0.8.140.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 665 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=178 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具，不参与自动回归）；新增 `test-error-navigation.js`（15 断言） |
| L3 视觉 | `npm run test:visual` | **24/24** | 本版无 UI 布局改动；指纹匹配，严格判定，基线未刷新 |
| L1 端到端 | `npm run test:e2e` | **5/5（288 pass / 0 fail / 8 skip）** | 真实工具链（本机 GCC 8.1 / MinGW）：构建 48、调试 143、边界 38、工具链 38、ccache 21 |
| L4 性能 | `npm run test:perf` | **13 项：10 pass / 2 warn / 1 fail** | 失败项 B10「真实单文件编译」min 1535 ms > 预算 450.6 ms，属**环境**因素：同一时刻手工 `gcc -c main.c` 连测 3 次为 1479 / 1520 / 1683 ms（基线 139 ms）；B8/B11 同步变慢 3–7×（min 仍在预算内）。纯 JS 基准（B1–B6）全部正常；本版无构建链路改动 |
| L5 打包 | `npm run test:pack` | **1/1（14 断言）** | VSIX 0.8.141 打包 / 安装冒烟通过 |
| 产物 | `npm run bundle` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **24/24（0 fail / 0 skip）**（沿用 0.8.140 复核结果；本版无宿主/调试适配层改动） | 真实 VS Code 1.85.0；激活/命令/设置/WebView/真实构建/真实 GDB/跨工具链 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| clangd 打开工程后重启（问题 1） | `tests/test-clangd-settings-sync.js` 第 13 步（2 断言）：移除全部工程 → 装载 clangd 扩展（`isActive`）→ 清空 `visibleTextEditors` → 改 `suppressedWarnings` → 打开工程 ⇒ 断言执行 `clangd.restart` 且输出通道留痕；G1（编译器变化无条件重启）保持绿 | 现场复现路径对照：`restartOnActiveProjectSwitch=false` + 从状态栏打开工程 |
| 编译错误自动跳转（问题 2） | `tests/test-error-navigation.js`（15 断言）：① 静态接线——Build Log / Symbols 不再出现 `command: 'vscode.open'`，改 `codeblocks.openLocation`；② 行为级——`BuildLogTreeProvider.setSummary()` 注入「ld.exe 伪文件 + 已删除文件 + 真实源码」后 `gotoFirstError()` 命中真实源码且 `showTextDocument` 收到 selection；只有伪文件时判定为"无可导航错误"；③ `gotoNextError()` 逐条前进 | 根因证据：VS Code 扩展宿主内 `Range.toJSON(){return[this.start,this.end]}`、`Position.toJSON(){return{line:character}}`（命令参数 JSON 序列化后主进程不再认作 `IRange`） |
| Symbols 视图同类缺陷 | `tests/test-debug-registry-providers.js` B6：`codeblocks.openLocation` + 单参数 `{file,line}` | — |
| 文档与版本标记 | `tests/contract/test-contract.js` G1/G2/G3（CHANGELOG / README / 根目录 VSIX 版本一致）、`test-doc-consistency.js` D1/D1b/D5（覆盖矩阵、台账、版本标记） | `npm run coverage:matrix` 重新生成，命令 total=111 / covered=109 / 98% |

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
> 剩余缺口 2 个命令：`codeblocks.detectCompilers`（已登记的可解释缺项：真实并行探测外部编译器，需交互环境）、`codeblocks.restartClangd`（本版新增的排障命令，仅转发 `clangd.restart`，其重启链路由 `test-clangd-settings-sync.js` 覆盖）。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | **无**（设置项总数保持 83） |
| 行为变更 | ① 打开工程（含从状态栏打开检测到的工程）时，若编译数据库**或** clangd 配置片段有变化且 clangd 扩展已激活 ⇒ 重启 clangd（不受 `codeblocks.clangd.restartOnActiveProjectSwitch` 限制）；② 构建失败后的"首个错误跳转"改为 `showTextDocument` + `revealRange`，面板聚焦先 `await`；③ 导航跳过链接期伪文件与打不开的文件 |
| 新增命令 | `codeblocks.restartClangd`（`Code::Blocks: Restart clangd Language Server`，命令面板 + 菜单 `Settings`）；内部命令 `codeblocks.openLocation`（不贡献，树节点专用） |
| 新增测试 | `tests/test-error-navigation.js`（15 断言）；`test-clangd-settings-sync.js` +2 断言；`test-debug-registry-providers.js` B6 断言更新 |
| 文档 | 新增 [release/0.8.141.md](../release/0.8.141.md)；`usage.md(.en)` 增补「clangd 没按预期分析时」小节；滚动报告重命名并更新台账；覆盖矩阵重新生成 |
| 行为边界 | `restartOnActiveProjectSwitch` 语义不变（仍只作用于切换活动工程）；构建进行中的重启仍推迟到构建结束；树视图仍展示链接期伪文件的错误（只是不作为跳转目标） |

## 4. 缺陷与处置（本轮 review 发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | `finishBuildSummary` 内嵌常量 `configWritten` 误写在 `if (clangd)` 块内、而重启判定在其之前 | 编译失败（TS 变量在使用前未声明） | 改为外层 `let configWritten = false` + 块内赋值，重启判定移到配置写入之后 |
| 2 | `codeblocks.buildLog.focus` 只发起内部命令却不返回 Promise | 跳转前 `await` 落空，面板激活仍可能与编辑器争焦点 | 处理器改为直接 `return executeCommand('workbench.view.extension.codeblocks-buildPanel')` |
| 3 | 新增日志/文案未进 `src/i18n/strings.zh-cn.json`，且键漏写 `[Code::Blocks] ` 前缀 | `test-i18n-dict.js` S1（缺词条）与 S5（孤儿键）红 | 补齐 6 条词条 + 菜单标签；键与 `logT` 源串逐字一致 |
| 4 | 新增运行期内部命令 `codeblocks.openLocation` 未登记白名单 | 契约 B4「运行期注册但未贡献的命令与白名单一致」红 | 加入 `INTERNAL_RUNTIME_COMMANDS`（树节点直接调用，不进命令面板） |
| 5 | 覆盖矩阵未随新增命令重生成 | 契约 D1/D1b 红（命令 110 → 111） | `npm run coverage:matrix` 重新生成并同步报告 §2 |

## 5. 待办与已知限制

- **人工验收（建议）**：① 工作区自动检测弹窗按 Esc 取消 → 状态栏「Code::Blocks projects」打开工程 → 输出通道出现
  「已打开工程，重启 clangd 以套用新的编译数据库 / 配置」，clangd 输出面板可看到重新索引；② 制造一个编译错误并构建
  → 光标落在出错行/列，输出通道出现「已跳转到首个错误：`file:line:col`」；③ 链接期错误（`cannot find -lxxx`）构建
  → 输出通道出现「首个错误没有可跳转的源码位置（链接期/通用错误）」而不是静默无反应。
- **已记录不修**：`codeblocks.detectCompilers` 覆盖缺口（沿用 0.8.139 说明）；`codeblocks.restartClangd` 属排障转发命令，
  不单独做覆盖矩阵登记；ccache 对非 ASCII **文件/目录名**的限制不变（只告警 + 文档指引）。
- **本轮环境异常**：性能层 B10（真实单文件编译）在与本版改动无关的情况下硬预算失败——同机手工
  `gcc -c main.c` 也需 1479–1683 ms（基线 139 ms），属机器/杀软负载；`docs/testing/performance-baseline.md`
  未用 `--report` 刷新（避免把异常数据写进基线），后续在空闲机上复跑 `npm run test:perf` 即可恢复。
