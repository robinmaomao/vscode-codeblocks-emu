# 测试执行报告（0.8.143-agent-control · 滚动更新）

> 生成时间：2026-11-06 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB ｜ ccache 4.14.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.143-agent-control.md](../release/0.8.143-agent-control.md)；上游正式版见 [release/0.8.142.md](../release/0.8.142.md)。
> 本版为 `feat/agent-control` **分支预发布版**（不合并 main），测试口径按分支内容实测。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 **685** 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=187 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具）；新增 `test-agent-policy.js`（34 断言），另有 `test-api-tool-guards` / `test-api-build-service` / `test-mcp-server` 门控用例 |
| L3 视觉 | `npm run test:visual` | **24/24** | 本版无 UI 布局改动；指纹匹配，严格判定，基线未刷新 |
| L1 端到端 | `npm run test:e2e` | **7/7** | 真实工具链（本机 GCC 8.1 / MinGW）：构建 48、调试 143、边界 38、工具链 38、ccache 21、链接期诊断 7、CLI 7 |
| L4 性能 | `npm run test:perf` | **13 项：9 pass / 1 warn / 3 fail（环境性）** | 裸 `gcc -c main.c` 实测 1.43–1.73 s/文件（基线约 0.14 s），B8/B10/B11 超预算；同期纯 CPU 项 +36%～94% 趋势告警 ⇒ 机器整体变慢 |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.143-agent-control（1.34 MB，含 `bundle/cb-cli.js` + `bundle/cb-mcp.js`）；隔离目录安装/卸载通过 |
| 产物 | `npm run bundle` + `bundle:agent` | 通过 | esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **32/32（0 fail / 0 skip）** | 真实 VS Code 1.102.0；激活/命令/设置/WebView/真实构建/真实 GDB/跨工具链 + Agent 8 项（含开关切换与只读拦截） |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 链接期诊断定位（`src/build/diagnosticPath.ts`） | `tests/test-diagnostic-path.js` **18 断言**：token 拆解（`file:(section)` / `obj:src:(section)` / `file:line`）、文件定位（`cwd` → 工程根 → basename → `.o` 回退源文件；同名多份取后缀匹配）、行号启发式（段名函数名 → 定义；未定义符号 → **调用处**并跳过 `extern`）、按文件缓存、与真实 `OutputParser` 串联 | 现场形态复现：`func_bt.c:(.text.func_bt_warning_discon+0x2e)` 与 MinGW `obj\...\x.o:x.c:(.text+0x9)` |
| 构建引擎接线 | `tests/e2e/test-e2e-linker-diagnostic.js` **7 断言**：真实 gcc 链接失败 → `onStructuredDiagnostic` 的 file = 真实源文件、line = 调用行（第 6 行）、`onDiagnostic` 的 URI 一致、伪路径 `:(.text` 消失 | 真机 MinGW GCC 8.1：`obj\Debug\...\link_err.o:link_err.c:(.text+0x9): undefined reference to ...` |
| 回归安全 | `test-e2e-build.js` 构建矩阵 48 断言保持全绿（构建命令 / 增量语义 / 产物零变化）；`unit 179 FAIL=0` | — |
| Agent 开关（`agentPolicy` + `invokeTool`） | `tests/test-agent-policy.js` **34 断言**：设置声明/默认值/双语 nls/文档覆盖、`isAgentEnabled`/`isAgentReadOnly` 真值表、只读白名单逐工具逐动作（8 放行 / 13 拒绝）、`invokeTool` 只读拦截（含工程字节不变）、MCP 暴露计划；`test-mcp-server` M7–M10（关闭 → 空列表 + `disabled`；只读 → `read-only`）；`test-cli` C16（CLI 不受开关影响） | 宿主实测：关闭 `agent.enabled` → `invokeTool` 报未知工具、重开恢复；`agent.readOnly` → `build` 返回 `read-only`；`lm.tools` 快照可能滞后到重载 |
| 文档与版本标记 | `test-contract.js` G1/G2/G3（CHANGELOG / README / 根目录 VSIX 版本）、`test-doc-consistency.js` D1/D1b/D3/D4/D5；`gen-release-notes.js --check`（13 条发布页） | `npm run coverage:matrix` 重新生成（命令 111 / 设置 85） |

## 2. 覆盖台账（自动生成）

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 111 | 109 | 98% |
| 视图 | 5 | 5 | **100%** |
| 设置项 | 85 | 85 | **100%** |
| 快捷键 | 33 | 33 | **100%** |
| 语言/语法 | 6 | 6 | **100%** |
| DAP 能力 | 30 | 30 | **100%** |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成，逐项列出命中层与未覆盖项）。
> 剩余缺口 2 个命令：`codeblocks.detectCompilers`（已登记的可解释缺项：真实并行探测外部编译器，需交互环境）、`codeblocks.restartClangd`（排障转发命令，其重启链路由 `test-clangd-settings-sync.js` 覆盖）。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增设置 | **`codeblocks.agent.enabled`**（boolean，默认 `true`）、**`codeblocks.agent.readOnly`**（boolean，默认 `false`）；设置项总数 83 → **85**，新增第 10 分区 `Agent` |
| 新增命令 | **无**（命令总数保持 111） |
| 新增能力 | 11 个 Language Model Tools + MCP provider（`bundle/cb-mcp.js`）+ 独立 CLI（`bundle/cb-cli.js`）；控制内核 `src/api/*`；构建内核 `src/build/buildProject.ts` 与 UI 同源（含 main 的链接期诊断 `resolveFile`） |
| 行为变更 | `engines.vscode` → `^1.102.0`；关闭总闸后 LM Tools 不注册、内嵌 MCP 返回空定义、外部客户端直启的 server 拒绝调用（`disabled`）；只读模式白名单外返回 `read-only`；**未受信任工作区强制关闭**；每次工具调用写一行审计日志；切换**即时生效** |
| 新增测试 | `test-agent-policy.js`（34 断言）、`test-mcp-server` 关闭/只读门控（M7–M10）、`test-cli` C16（CLI 不受开关影响）、宿主开关切换与只读拦截 2 项；另有分支既有的 `test-api-project-edit` / `test-api-settings-reader` / `test-api-tool-guards` / `test-api-build-service` / `test-ai-tools-contract` / `test-e2e-cli-build` |
| 文档 | 新增 [release/0.8.143-agent-control.md](../release/0.8.143-agent-control.md) 与 [agent-control.md](../guide/agent-control.md) / `.en.md`；`settings.md(.en)` 第 10 分区；README / usage / progress / CHANGELOG / decisions / strategy 同步；滚动报告重命名、覆盖矩阵重生成 |
| 行为边界 | 默认行为与 0.8.142 一致（开关默认开启）；`cb-cli` 不受开关影响；工具**列表快照**可能滞后到重载窗口（调用即时受控）；命令数不变 |

## 4. 缺陷与处置（本轮发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | 只读模式只在「首次注册」时读取，切换 `readOnly` 复用旧上下文 | 打开只读后写操作仍然放行 | 记录 `agentAppliedReadOnly`，与设置不一致时整体注销并重建上下文 |
| 2 | LM Tools 直接调用 `def.handler`，绕过 `invokeTool` 的策略入口 | 只读拦截对 Copilot 无效（仅 MCP/CLI 生效） | 改为统一走 `invokeTool()`，三端同一条路径 |
| 3 | MCP server 读设置时未带工作区锚点 | 工作区级 `agent.enabled/readOnly` 对外部客户端不生效 | 以 `process.cwd()` 为锚点向上找 `.vscode/settings.json` |
| 4 | 中文 nls 文案经 PowerShell 管道写入被替换成 `?` | 中文设置面板显示乱码 | 改用编辑工具重写；`test-i18n-nls` B3 拦截此类回归 |
| 5 | 契约测试版本正则只认 `x.y.z` | 预发布后缀 `-agent-control` 无法通过 G1/G2/D1b/D5 | 正则改为 semver 预发布感知（仍要求完全相等） |
| 6 | `Agent` 分区标题中文无 CJK 字符 | `test-i18n-nls` B3 报错 | 按专名加入白名单（与 IntelliSense 同款处理） |

## 5. 待办与已知限制

- **人工验收（建议）**：① 默认开启时 Copilot 可调用 11 个工具；② 关闭 `agent.enabled` 后调用报未知工具、内嵌 MCP 不可用；③ 打开 `agent.readOnly` 后 `build`/`edit` 返回 `read-only`、工程字节不变；④ 不受信任工作区下工具不注册；⑤ `cb-cli` 在开关关闭时仍可构建。
- **已知表现**：VS Code 的 `vscode.lm.tools` / Configure Tools 快照在注销后可能滞后到窗口重载（权限判定不受影响，已写入使用说明）。
- **已记录不修**：`codeblocks.detectCompilers` 覆盖缺口（沿用 0.8.139 说明）；`codeblocks.restartClangd` 属排障转发命令，不单独做覆盖矩阵登记；真实工具链 perf 项受本机负载影响（环境性）。
