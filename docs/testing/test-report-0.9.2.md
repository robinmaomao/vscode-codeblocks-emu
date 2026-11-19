# 测试执行报告（0.9.2 · 滚动更新）

> 生成时间：2026-11-19 ｜ 执行环境：Windows 11 x64 ｜ Node v24.22.3 ｜ CPU Ryzen 7 7840U ×16 ｜ 31.3GB ｜ w64devkit GCC 16.2 / GDB 18.1
> 方案见 [测试方案](./strategy.md)；覆盖台账见 [测试覆盖矩阵](./coverage-matrix.md)；性能数据见 [性能基准](./performance-baseline.md)。
> 上一版报告见 [0.9.1 测试报告](./test-report-0.9.1-archive.md)；本版发布说明见 [release/0.9.2.md](../release/0.9.2.md)。

## 1. 分层结果

| 层 | 命令 | 本轮结果 | 说明 |
|----|------|----------|------|
| L-1 契约 | `npm run test:contract` | **3/3** | 契约 44 项 + 文档一致性 6 项 + 设置契约 745 断言 |
| 无头层（unit） | `npm test` | **TOTAL=244 FAIL=0 SKIP=1** | SKIP=`tests/test-writer.js`；新增调试形状 15 / run plan 4 / CLI 调试 E2E 8 |
| L1 端到端 | `npm run test:e2e` | **7/7** | 边界 39 pass / 2 skip、构建矩阵 48、ccache 21、CLI 构建 7、**CLI 调试 8（真实 gdb）**、调试 141 pass / 1 skip、链接期诊断 9、工具链 42 pass / 2 skip |
| L3 视觉 | `npm run test:visual` | **26/26** | dark/light 各一套 |
| L4 性能 | `npm run test:perf` | **13/13** | 13 项微基准 + 真实构建；0 warn / 0 fail |
| L5 打包 | `npm run test:pack` | **1/1（16 断言）** | VSIX 0.9.2 打包 / 安装冒烟 |
| 产物 | `npm run compile` / `bundle` / `bundle:search` / `bundle:agent` | 通过 | tsc + esbuild 无告警 |
| L2 宿主 | `npm run test:host` | **1/1（37 用例）** | 真实 VS Code 1.102.0 宿主；37 pass / 0 fail / 0 skip |

### 1.1 Agent 控制面专项（本版重点）

| 用例 | 结果 | 覆盖点 |
|---|---|---|
| `test-api-build-service` | **30 pass** | 目标守卫 / 平台不支持 / clean / make 已最新不递增 / 超时与取消 |
| `test-api-project-edit` | **47 pass** | 目标与文件校验、`weight` 0–100、重命名冲突、`preserve` 转义 |
| `test-api-tool-guards` | **27 pass** | `build_status` `no-build`、`project_read` 未知 target、导出保护、workspace 依赖 |
| `test-debug-shapes` | **15 pass** | 三端 `state/stack/variables/evaluate` 归一化、`level→id` |
| `test-api-run-plan` | **4 pass** | `cwd` 按工程目录、默认超时 |
| `test-cli` | **19 pass** | 退出码映射、`--json` 失败输出、USAGE |
| `test-agent-policy` | **36 pass** | 只读白名单（含 `debug state/stack/variables`）、总闸 |
| `host/agent.tests.js` | **37 pass** | 真实宿主下的 11 个 LM Tools、取消、摘要、调试桥 |
| `e2e/test-e2e-cli-debug` | **8 pass** | 真实 gdb：start / 断点 / continue / step / stack / variables / stop |

## 2. 覆盖台账

| 契约项 | 总数 | 已覆盖 | 覆盖率 |
|--------|------|--------|--------|
| 命令 | 136 | 136 | 100% |
| 视图 | 6 | 6 | 100% |
| 设置项 | 93 | 93 | 100% |
| 快捷键 | 34 | 34 | 100% |
| 语言/语法 | 6 | 6 | 100% |
| DAP 能力 | 30 | 30 | 100% |

> 完整清单见 [测试覆盖矩阵](./coverage-matrix.md)（`npm run coverage:matrix` 生成）。
> 命令缺口 0 个。

## 3. 本版变更与回归范围

| 项 | 说明 |
|---|---|
| 主题 | 0.9.0 合并后的九轮复查：跨端契约、失败语义、资源回收、数据安全 |
| 代码 | `src/api/{toolRegistry,debugService,debugShapes,projectEdit,projectQuery,projectService,runService,exportService,buildService,agentPolicy,types}.ts`、`src/build/buildProject.ts`、`src/cli/{cb-cli,runtime}.ts`、`src/mcp/{provider,server}.ts`、`src/extension.ts`、`src/compiler/{languageFlags,compilerFlagSettings,compilerService}.ts`、`package.json`（`untrustedWorkspaces`） |
| 新增断言 | 调试形状 15、run plan 4、CLI 调试 E2E 8、构建服务 +8、工程编辑 +25、工具守卫 +5、CLI +12、宿主 +1 |
| 词条 | 无新增（错误码与提示复用既有词条） |

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

## 5. 结论

- 契约 **3/3**、无头 **244**（FAIL=0 / SKIP=1）、E2E **7/7**、视觉 **26/26**、性能 **13/13**、打包 **16 断言**、宿主 **37/37（VS Code 1.102.0）** 全部通过。
- 修复集中在「失败被当成功」「跨端响应漂移」「资源泄漏 / 挂起」「相对路径口径」四类；无功能面新增。
- 清单不变：命令 136 / 设置 93 / 分区 10 / 键位 34 / 视图 6 / LM Tools 11 / MCP provider 1。
