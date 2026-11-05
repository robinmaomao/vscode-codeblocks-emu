# 测试执行报告（0.8.141-agent-control · 滚动更新）

> 生成时间：2026-11-05 ｜ 执行环境：Windows 10 x64 ｜ Node v24.19.0 ｜ CPU i3-10105 ×8 ｜ 15.8GB ｜ ccache 4.14.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版权威复核见 [0.8.139 完整报告](./test-report-0.8.139-full.md)；本版发布说明见 [release/0.8.141-agent-control.md](../release/0.8.141-agent-control.md)；上一正式版见 [release/0.8.140.md](../release/0.8.140.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 665 断言（覆盖矩阵/性能基准/命令与链接/版本标记） |
| 无头层（unit） | `npm test` | **TOTAL=184 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`（需 `<cbp>` 参数的手工工具）；本分支新增 3 个无头用例文件（`test-api-tool-guards` 9 项、`test-api-build-service` 9 项、`test-api-project-edit` 27 项含 query/preserve） |
| L3 视觉 | `npm run test:visual` | **24/24** | 本分支无 UI 改动；指纹匹配，严格判定，基线未刷新 |
| L1 端到端 | `npm run test:e2e` | **6/6（CLI 真实构建 7 项 + 既有 5 个脚本）** | 真实工具链：构建矩阵 48、调试 143、边界 38、工具链 38、ccache 21、`cb-cli` 7 |
| L4 性能 | `npm run test:perf` | **13 项：9 pass / 1 warn / 3 fail（环境性）** | B8/B10/B11 为真实工具链计时；本机裸 `gcc -c main.c` 实测 **1.43–1.73 s/文件**（预算按 ~150 ms 制定），同期纯 CPU 项亦 +36%～94% 趋势告警 ⇒ 机器整体变慢，非代码回归 |
| L5 打包 | `npm run test:pack` | **1/1（15 断言）** | VSIX 0.8.141-agent-control（1.34 MB，含 `bundle/cb-cli.js` + `bundle/cb-mcp.js`）；隔离目录安装/卸载通过 |
| 产物 | `npm run bundle` + `bundle:agent` | 通过 | esbuild 无告警；`bundle/cb-cli.js`、`bundle/cb-mcp.js` 生成 |
| L2 宿主 | `npm run test:host` | **30/30（0 fail / 0 skip）** | 真实 VS Code 1.102.0；激活/命令/设置/WebView/真实构建/真实 GDB/跨工具链 + Agent 控制面 6 项 |

### 1.1 本轮验证要点

| 改动组 | 已自动验证 | 已人工/实测验证 |
|--------|-----------|------------------|
| 工具面与清单接线 | `tests/test-ai-tools-contract.js`（11 个声明 ↔ registry 的 `name`/`inputSchema` 深度相等、命名 `[\w-]+`、`toolReferenceName` 配套）；`tests/host/suite/agent.tests.js`（清单 11 个、`vscode.lm.tools` 全含、MCP provider 声明） | 宿主内 `vscode.lm.invokeTool` 实调；MCP stdio 握手 |
| 工程读改与写盘 | `tests/test-api-project-edit.js`（summary/targets/files/options/schema、增删改、`dryRun`、`allowScripts` 门控、`preserve` P1–P6 含"其余字节完全一致"） | 宿主 `invokeTool` 改 `.cbp` → 读回 → 构建（`agent.tests.js`） |
| 写盘守卫 | `tests/test-api-tool-guards.js`（9 项：并发外部修改拒绝写盘、`force` 覆盖、preserve 走 `isExternallyModified`、`project_file` 受签名守卫、`saveProject` 错误透传、`build-busy`） | 扩展侧 `projectChangeTracker` 兜底（`saveProject` 抛 `external-modified`） |
| 构建 / 清理 / 超时 | `tests/test-api-build-service.js`（9 项：`timeoutMs` 取消 + `cancelled` 摘要 + 及时返回、clean 模式、目标选择）；`tests/e2e/test-e2e-cli-build.js`（真实构建、增量跳过、结构化诊断、运行、导出） | `node bundle/cb-cli.js build/run --json` 冒烟；宿主内真实构建 |
| 调试 | `tests/host/suite/agent.tests.js`（无会话时 `state.active=false`、`stop` 返回 `not-running`） | CLI/MCP 非交互调试（break-insert / exec-run / stack / variables / evaluate / step）手工实测 |
| CLI / MCP 传输 | `tests/test-cli.js`（15 项：纯 JSON、退出码、bundle 资源目录、中英文案）、`tests/test-mcp-server.js`（initialize → tools/list → tools/call 成功与错误分支） | `npx @modelcontextprotocol/inspector` 等价握手；`.vscode/mcp.json` 兜底接入 |
| 版本与文档联动 | `tests/contract/test-contract.js` G1/G2/G3（CHANGELOG / README / 根目录 VSIX 版本一致，已支持 semver 预发布后缀）、`test-doc-consistency.js` D1/D1b/D5（矩阵、台账、版本标记） | `npm run coverage:matrix` 重新生成；滚动报告重命名并更新全仓引用 |

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
> 本分支**未新增命令与设置**：Agent 能力通过 `languageModelTools` / MCP provider / CLI 暴露，不改变命令与设置面。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 新增能力 | 11 个 Language Model Tools + MCP server/provider + 独立 CLI（`bundle/cb-cli.js`）；控制内核 `src/api/*`；构建内核 `src/build/buildProject.ts` 与 UI 同源 |
| 行为变更 | `engines.vscode` 抬到 `^1.102.0`；扩展激活时注册 LM Tools 与 MCP provider（失败不阻断激活）；构建新增非交互模式（跳模态、自动停调试、`build-busy`） |
| 新增测试 | `test-api-project-edit` / `test-api-settings-reader` / `test-api-tool-guards` / `test-api-build-service` / `test-ai-tools-contract` / `test-cli` / `test-mcp-server`（无头）、`e2e/test-e2e-cli-build`（E2E）、`host/suite/agent.tests.js`（宿主） |
| 文档 | 新增 [agent-control.md](../guide/agent-control.md) / [.en.md](../guide/agent-control.en.md) 与 [release/0.8.141-agent-control.md](../release/0.8.141-agent-control.md)；README / usage / strategy / decisions / progress / docs 索引 / THIRD-PARTY-NOTICES / CI 同步 |
| 行为边界 | 既有 112 个命令、83 个设置项、全部 UI 与 WebView 行为不变（契约 + 视觉层校验）；`preserve` 仅覆盖文件级 `compile`/`link`，其余自动降级 `canonical` |
| 已知限制 | `codeblocks_run` 无 stdin（交互式程序用终端）；CLI/MCP 写盘会触发扩展的「外部修改」提示；perf 真实工具链项受本机负载影响 |

## 4. 缺陷与处置（本轮 review 发现并修复）

| # | 问题 | 影响 | 处理 |
|---|------|------|------|
| 1 | `project_edit` 先 `loadProject` 再 `captureSignature`，两步之间无 await | 并发外部修改永远检不出（守卫形同虚设），CLI/MCP 可能覆盖别人的保存 | 改为读盘前取签名；`project_file` / `project_target` 补同样的签名校验；新增 `test-api-tool-guards.js` 9 项锁死 |
| 2 | `preserve` 正则漏了闭合引号（`<Unit filename="X"\s*/>`） | 自闭合与带子节点的 `<Unit>` 匹配错位，可能改错文件 | 正则补 `"` 并要求闭合，P4/P5 断言"其余字节完全一致" |
| 3 | 新增文件默认不进任何目标（`target.files` 未同步） | Build Engine 不编译新文件 | `syncTargetFiles()` 重建目标文件集，且 `project.files` 与 `target.files` 共享同一对象引用 |
| 4 | 打包后 CLI 资源目录按 `dist/cli` 推断，指向仓库根 | VSIX 安装后 `compiler list` 找不到 `resources/compilers` | 以 `resources/compilers` 是否存在判定扩展根；`test-cli` C12/C13 覆盖 bundle |
| 5 | CLI/MCP 无法指定界面语言（只能惰性回退） | CI 断言文案语言不稳定 | 新增 `i18n.setUiLanguage()`，`createRuntime()` 按 `codeblocks.ui.language` / `CB_UI_LANGUAGE` 定语言 |
