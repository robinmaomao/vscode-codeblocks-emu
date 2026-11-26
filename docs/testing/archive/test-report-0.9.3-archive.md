# 测试执行报告（0.9.3 · 滚动更新）

> 生成时间：2026-11-20 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](../strategy.md)；覆盖台账见 [测试覆盖矩阵](../coverage-matrix.md)；性能数据见 [性能基准](../performance-baseline.md)。
> 0.9.2 全量审计见 [functional-audit-0.9.2.md](./functional-audit-0.9.2.md)（D-01…D-13 已全部修复，逐项验证见该报告 §12）。
> 上一版报告见 [0.9.2 测试报告](./test-report-0.9.2-archive.md)；本版发布说明见 [release/0.9.3.md](../../release/0.9.3.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 745 断言 |
| 无头层（unit） | `npm test` | **TOTAL=236 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；新增 Agent Skill / participant / 确认策略；审计轮新增命令分区守卫（入口冒烟 120/136）；修复轮新增调试命令行为 14 / 命令处理器 31 / 设置行为 20 |
| L1 端到端 | `npm run test:e2e` | **7/7** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、CLI 构建 7、**CLI 调试 8（真实 gdb）**、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；0 warn / 0 fail |
| L5 打包 | `npm run test:pack` | **1/1（17 断言）** | VSIX 0.9.3 打包 / 安装冒烟（含 Agent Skill） |
| 产物 | `npm run compile` / `bundle` / `bundle:search` / `bundle:agent` | 通过 | tsc + esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（38 用例）** | 真实 VS Code 1.102.0 宿主；38 pass / 0 fail / 0 skip |

### 1.1 Agent 控制面专项（本版重点）

| 用例 | 结果 | 覆盖点 |
|---|---|---|
| `test-api-build-service` | **30 pass** | 目标守卫 / 平台不支持 / clean / make 已最新不递增 / 超时与取消 |
| `test-api-project-edit` | **47 pass** | 目标与文件校验、`weight` 0–100、重命名冲突、`preserve` 转义 |
| `test-api-tool-guards` | **27 pass** | `build_status` `no-build`、`project_read` 未知 target、导出保护、workspace 依赖 |
| `test-debug-shapes` | **15 pass** | 三端 `state/stack/variables/evaluate` 归一化、`level→id` |
| `test-api-run-plan` | **4 pass** | `cwd` 按工程目录、默认超时 |
| `test-cli` | **19 pass** | 退出码映射、`--json` 失败输出、USAGE |
| `test-agent-policy` | **42 pass** | 只读白名单（含 `debug state/stack/variables`）、总闸、`allowScripts` 总闸 |
| `test-agent-skill` | **14 pass** | Skill frontmatter、chatSkills 路径、工作区/用户安装、覆盖保护、命令与 participant 清单 |
| `test-chat-participant` | **12 pass** | `/read` `/build` `/fix` `/debug` `/status` `/help` 解析 |
| `test-lm-tool-confirmation` | **11 pass** | 写入/运行/调试/导出确认，dryRun 与只读不打扰 |
| `host/agent.tests.js` | **37 pass** | 真实宿主下的 11 个 LM Tools、取消、摘要、调试桥 |
| `host/external-change.tests.js` | **1 pass** | 真实宿主 `.cbp` 外部修改检测 + auto 重载 |
| `e2e/test-e2e-cli-debug` | **8 pass** | 真实 gdb：start / 断点 / continue / step / stack / variables / stop |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 138 | 138 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 94 | 94 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](../coverage-matrix.md)（`npm run coverage:matrix` 生成）。
> 命令缺口 0 个。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | 0.9.3：Agent 上手体验与安全护栏（Skill / participant / 确认 / 脚本总闸） |
| 代码 | 新增 `src/chat/{commands,participant}.ts`、`src/features/agentSkill.ts`；修改 `src/extension.ts`、`src/lm/tools.ts`、`src/mcp/server.ts`、`src/api/{agentPolicy,toolRegistry}.ts`、`package.json` / NLS |
| 新增断言 | `test-agent-skill` 14、`test-chat-participant` 12、`test-lm-tool-confirmation` 11、`test-agent-policy` 42（含脚本总闸）；`test-pack` 17 断言（含 Skill）；契约 44 + 文档一致性 6 + 设置契约 754 |
| 词条 | 新增 Agent 确认/状态/Skill/participant 词条；`strings.zh-cn.json` 同步 |

## 4. 缺陷与处置

| # | 来源 | 问题 | 处置 |
|---|------|------|------|
| 1 | R3 复查 | `run` 的 `cwd` 相对进程 cwd 解析，宿主下常落到 `C:\Windows\System32` | 按 `project.basePath` 解析 |
| 2 | R3 复查 | CLI `--json` 失败无输出、退出码不全、USAGE 缺项 | 全量映射 + 失败 JSON + USAGE 补全 |
| 3 | R3 复查 | 当前平台不支持的目标「假成功」 | `assertTargetRunnable` + `unsupported` |
| 4 | R5 复查 | `start` 失败泄漏 gdb；`continue`/`step` 返回旧状态；断点只增不减 | 启动 try/catch 回收、`resumeAndWait`、替换语义 |
| 5 | R7 复查 | 虚拟目标「首个成员」平台判定错误导致整组跳过 | `targetPlatformSupported` 成员并集 |
| 6 | R8 复查 | gdb 探测失败进程泄漏；`ENOENT` 未映射；clean spawn 失败被当成功 | 回收 + `compiler-missing` + `ok:false` |
| 7 | R9 复查 | 编辑中途失败污染宿主内存模型 | `loadForEdit` / `projectService` 深拷贝 |
| 8 | R2 复查 | 导出默认覆盖用户 `Makefile`；`out` 相对进程 cwd | 默认 `Makefile.cb` + 工程目录解析 |
| 9 | R-09 | 产物排除通知无人应答导致构建永久挂起 | `{ notify: 'interactive' }` |
| 10 | E3 验收 | Rebuild/停调试确认期间已占用构建互斥，`Building…` 挂起且 Stop 谎报“没有构建” | 确认移到互斥锁前（`runBuildPreflight`）；Stop 提示等待确认 |
| 11 | E3 验收 | 外部修改检测疑似未弹窗 | 增加诊断日志 + 真实宿主 watcher/auto 重载回归；多窗口焦点观察保留人工复核 |
| 12 | 0.9.3 | Agent 文档仍写 0.8.143 预发布版，缺少上手指南 | 版本头/README 修正，新增 5 分钟上手、权限矩阵、CLI/MCP 路径、排障与 recipes |
| 13 | 0.9.3 | 模型缺少工作流约束，易跳过 `project_read` / `dryRun` | 内置 `codeblocks-project` Skill + 安装命令 |
| 14 | 0.9.3 | MCP `readOnlyHint` 容易被误解为逐 action | 明确工具级保守标注；仅 `project_read` / `build_status` 为 true |
| 15 | 0.9.3 | Agent 可改构建脚本，缺少全局闸门 | `codeblocks.agent.allowScripts` 默认 false，与单次 `allowScripts` 双重门控 |

## 5. 结论

- 契约 **3/3**、无头 **236**（FAIL=0 / SKIP=1）、E2E **7/7**、视觉 **26/26**、性能 **13/13**、打包 **17 断言**、宿主 **38/38（VS Code 1.102.0）** 全部通过；非宿主六层合计 **250** 行 / 0 失败 / 1 SKIP（含宿主 **251**）。
- 本版新增 Agent Skill / `@codeblocks` / 确认文案 / 脚本总闸，并修正 Agent 文档版本与 MCP hint 口径；无既有功能行为回退。
- 清单：命令 **138** / 设置 **94** / 分区 10 / 键位 34 / 视图 6 / LM Tools 11 / MCP provider 1 / chat participant 1 / chat skill 1。
