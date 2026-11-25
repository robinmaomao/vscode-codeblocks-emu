# 测试执行报告（0.10.0 · 滚动更新）

> 生成时间：2026-11-20 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU demo CPU ×16 ｜ 32GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 本版发布说明见 [release/0.10.0.md](../release/0.10.0.md)；上一版报告见 [0.9.3 测试报告（归档）](./test-report-0.9.3-archive.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 777 断言 |
| 无头层（unit） | `npm test` | **TOTAL=237 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；新增 `test-agent-history` 51 断言 |
| L1 端到端 | `npm run test:e2e` | **7/7** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、CLI 构建 7、CLI 调试 8、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；13 pass / 0 warn / 0 fail（另一轮曾出现 11 pass / 2 warn，属环境容差，不判失败） |
| L5 打包 | `npm run test:pack` | **1/1（17 断言）** | VSIX 0.10.0 打包 / 安装冒烟（含 Agent Skill） |
| 产物 | `npm run compile` / `bundle` / `bundle:search` / `bundle:agent` | 通过 | tsc + esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（40 用例）** | 真实 VS Code 1.102.0 宿主；40 pass / 0 fail / 0 skip |

### 1.1 Agent 变更历史专项（本版重点）

| 用例 | 结果 | 覆盖点 |
|---|---|---|
| `test-agent-history` | **51 pass** | 写目标解析、dryRun 不快照、`.cbp` / `.workspace` 快照、latest-per-file、冲突/缺失/损坏、保留条数/保留期、写前错误不误记、审计脱敏、只读拒绝审计、索引篡改防护、索引损坏恢复 |
| `host/suite/agent-history.tests.js` | **2 pass** | 真实 `project_edit` → 工作区历史 → 字节级撤销；两个历史命令已注册 |
| `test-chat-participant` | **14 pass** | `/history` `/undo` 解析（含既有命令） |
| `test-agent-skill` | **14 pass** | chatSkills 路径、安装命令、覆盖保护 |
| `test-lm-tool-confirmation` | **11 pass** | 既有写入/运行/调试/导出确认 |
| `test-agent-policy` | **42 pass** | 只读白名单、总闸、`allowScripts` 总闸 |
| `host/suite/agent.tests.js` | **37 pass** | 真实宿主 11 个 LM Tools、取消、摘要、调试桥 |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 140 | 140 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 96 | 96 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成）。
> 命令缺口 0 个，设置缺口 0 个。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | 0.10.0：Agent 变更审计与一键撤销（本地历史 / 字节级快照 / 冲突保护） |
| 代码 | 新增 `src/api/agentHistory.ts`、`src/agent/historyStore.ts`、`src/agent/historyCommands.ts`；修改 `src/api/toolRegistry.ts`、`src/extension.ts`、`src/chat/{commands,participant}.ts`、`package.json` / NLS / Skill |
| 新增断言 | `test-agent-history` 51、宿主历史 2、`test-chat-participant` +2；设置结构/契约总数 94→96；命令 138→140 |
| 更名 | 产品名 → `Originium IDE for Code::Blocks`；扩展 ID → `robinmaomao.originium-ide`；VSIX → `originium-ide-0.10.0.vsix`；`codeblocks.*` 命名空间与 clangd 片段标记保持不变 |
| 词条 | 新增 Agent 历史/撤销/冲突提示词条；`strings.zh-cn.json` 同步 |
| 文档 | 新增 `agent-history.md` / `.en.md`；更新 agent-control / recipes / settings / usage / README / architecture / decisions / progress / release 0.10.0 |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | 设计 | 撤销可能覆盖 Agent 之后的外部修改 | 撤销前校验当前文件 SHA-256；默认拒绝，二次确认才强制覆盖 |
| 2 | 设计 | 同一文件多次 Agent 变更时直接撤销旧条目会打乱顺序 | 仅允许撤销每文件最新一条；旧条目提示 `superseded` |
| 3 | 设计 | 工程目录被历史/快照污染 | 历史写入 `context.storageUri/agent-history`，不进仓库 |
| 4 | 设计 | 历史磁盘失败可能阻断编辑 | capture/finish/recordCall 全部吞错并写输出通道，工具结果不受影响 |
| 5 | 安全 | 审计日志可能夹带脚本/源码 | 审计只保留白名单参数和数量；单测断言脚本内容不出现 |
| 6 | 安全 | 损坏/伪造索引可能指向任意文件 | 撤销仅接受 `.cbp` / `.workspace`，快照路径限制在 `snapshots/` 下并校验哈希 |
| 7 | 并发 | 构建/调试期间恢复文件导致内存模型竞争 | 命令层检查 `buildInProgress` / `buildPreflightInProgress` / `activeDebugSession`，忙时拒绝 |
| 8 | 兼容 | CLI / 外部 MCP 没有工作区存储 | 明确不提供跨进程撤销；文档与 UI 提示只覆盖 VS Code 扩展内 |
