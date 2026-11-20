# 遗留问题决策清单

> 汇总历次核查报告的待确认项与处置结论；已实施项保留编号便于追溯。
> 整理：2026-09-30（基线 0.8.119-dev）｜ 最近复核：2026-11-04（0.8.137）。
> 状态约定：`☐ 待确认` ｜ `◐ 已确认待实施` ｜ `✔ 已实施` ｜ `✖ 不实施` ｜ `▣ 记录`（维持现状，无需动作）。
> 功能级待办（A–E 组）见 [未实现功能待办](./backlog.md)；逐版本明细见 [release/](../release/)。

## 1. 决策总表

### 1.1 开关类（F 组）

| 编号 | 项目 | 建议方案（摘要） | 状态 |
|---|---|---|---|
| F2 | 启动自动恢复 + 自动打开工程（无开关） | 新增 `codeblocks.project.autoOpenOnStartup`（restore/blank/detect） | ✖ 不实施（2026-10-08 回执：维持现状） |
| F3 | 编辑器激活自动切换活动工程（无开关） | 新增 `codeblocks.ui.syncActiveProjectWithEditor`（布尔） | ✖ 不实施（2026-10-08 回执：维持现状） |
| F4 | 工程树文件固定字母序（无开关） | 新增 `codeblocks.projectTree.sortAlphabetically`（布尔） | ✖ 不实施（2026-10-08 回执：维持现状） |
| F6 | 构建进度显示固定开启（无开关） | 新增 `codeblocks.build.showProgress`（notification/statusBar/none） | ✖ 不实施（2026-10-08 回执：维持现状） |
| F7 | `use_folders` / `hide_folder_name` 无对应开关 | 记录不移植｜或做两个布尔 | ✖ 不实施（2026-10-08 回执：维持现状） |

### 1.2 界面与行为（N / R 组）

| 编号 | 项目 | 建议方案（摘要） | 状态 |
|---|---|---|---|
| N4 | 状态栏左区 5 项常驻 | cbp 项并入 Menu / 仅待打开时显示（可选） | ▣ 维持现状（2026-10-08 确认） |
| N5 | 两个 WebView `retainContextWhenHidden` | 维持现状（推荐） | ▣ 维持现状（2026-10-08 确认） |
| R1 | On project load 打开文件策略 | 功能差异记录（扩展固定不打开任何文件） | ▣ 记录 |
| R2 | `ignore_output`（构建日志忽略行过滤） | 记录，暂不实现 | ▣ 记录 |
| R3 | 调试前自动构建（扩展方向相反） | 新增 `codeblocks.debug.buildBeforeDebug`（默认对齐 CB＝true）+ 失败「仍要调试?」 | ✖ 不实施（2026-10-08 回执：维持现状） |
| R4 | 保存时机（run/debug 也保存） | 已有 `saveBeforeBuild` 覆盖，记录即可 | ▣ 记录 |
| R5 | `.cbp` 即时写盘 | 记录；如担心写入中断可评估原子写（temp+rename） | ▣ 记录 |
| R6① | tokenColor 激活时写用户 settings.json | 加开关 / 首启确认 | ✖ 不实施（2026-10-08 回执：维持现状） |
| R6② | 快捷键冲突静默提示 | 维持现状（已有 globalState 去重） | ▣ 记录 |

### 1.3 工程类 / 审计遗留

| 编号 | 项目 | 建议方案（摘要） | 状态 |
|---|---|---|---|
| 审计 2.5 | 无 CI / Lint 门禁 | 最小 GitHub Actions（compile + 全量回归 + vsce 冒烟） | ✔ 已实施（0.8.129-dev：测试分层七层 + `.github/workflows/ci.yml`） |
| 审计 3.2 | 巨型模块拆分 | 按域拆包（无功能影响，低优先） | ☐ 待确认（无排期） |
| 审计 3.3 | 最低 VS Code 版本 1.85 限制 AI 能力接入 | 抬到 `^1.102.0`（LM Tools 稳定 + MCP GA）；`@types/vscode` 固定 1.102.0，避免误用更高版本 API | ✔ 已实施（feat/agent-control：Agent 全控制改造） |
| 决策 A1 | Agent 如何写入 `.cbp` | 结构编辑走 canonical（`serializeProject`，语义可保证）；`compile`/`link` 保留定点改写（diff 最小）；CLI/工具用 `--format` 切换，默认 canonical | ✔ 已实施（feat/agent-control） |
| 决策 A2 | 工具面与安全边界 | 11 个工具三端共用一份注册表；字段白名单 + `dryRun` + `external-modified` + `allowScripts` 门控；不新增命令/设置 | ✔ 已实施（feat/agent-control） |
| 决策 E3-1 | 构建确认与互斥锁顺序 | 停调试器 / Rebuild 确认前置（preflight），确认期间用 `buildPreflightInProgress` 占位；避免 `Building…` 挂起与 Stop 谎报 | ✔ 已实施（0.9.2 E3 修复轮） |
| 决策 E3-2 | 外部修改检测疑似失效 | 先补诊断日志 + 真实宿主回归（`.cbp` 外部修改 → auto 重载）；多窗口/焦点模态观察保留人工复核，不先改产品逻辑 | ✔ 已实施（0.9.2 E3 修复轮，宿主 38/38） |
| 决策 E3-3 | 工程树是否显示构建目标层级 | 保持现状：对齐 CB Manager，目标通过状态栏/右键/属性面板切换，不新增树层级 | ▣ 维持现状（既有设计） |
| 决策 E3-4 | 是否内置 Agent Skill | 随包 `skills/codeblocks-project/SKILL.md` + `contributes.chatSkills`；另加安装命令兜底旧版 VS Code/外部客户端，不抬高 `engines.vscode` | ✔ 已实施（0.9.3） |
| 决策 E3-5 | Agent 脚本权限 | 新增 `codeblocks.agent.allowScripts`（默认 false），与单次 `allowScripts: true` 双重门控；`cb-cli` 保持单次开关 | ✔ 已实施（0.9.3，行为变化） |
| 决策 E3-6 | 是否新增 Chat participant | `@codeblocks` 只做确定性命令包装（`/read` `/build` `/fix` `/debug` `/status` `/help`），不替代 Agent 模式 | ✔ 已实施（0.9.3） |
| 决策 E3-7 | 工具确认与 MCP hint | 写入/执行/调试/导出/工作区变更前确认；MCP `readOnlyHint` 只对整工具只读的 `project_read` / `build_status` 标 true | ✔ 已实施（0.9.3） |
| 决策 E3-8 | Agent 变更审计/回滚 | 0.10.0 实施：审计所有工具调用；`.cbp` / `.workspace` 写操作保存工作区别字节快照；每个文件仅允许撤销最新一条；历史存 `context.storageUri/agent-history`，不进仓库；外部修改默认拒绝、二次确认可强制覆盖 | ✔ 已实施（0.10.0） |
| 决策 E3-9 | 变更历史边界 | CLI / 外部 MCP 无 VS Code 工作区存储，不提供跨进程撤销；不做 redo / 任意文件撤销 / 逐行 diff；`agent.history.enabled` 默认 true，未受信任工作区不采集 | ✔ 已实施（0.10.0） |

> 其余审计 P1–P3 已于 0.8.97-dev 实施；F1/F1b（0.8.95-dev）、F5/F8（0.8.94-dev）、N1/N3（0.8.110-dev）、
> N2（0.8.109-dev + 0.8.113-dev）、N6（0.8.111-dev + 0.8.112-dev）、P1–P8/G1/G3（0.8.114-dev）、
> G2（0.8.115-dev）、复核修复（0.8.116–0.8.119-dev）均已落地，明细见 [release/](../release/)。

### 1.4 测试阶段缺陷（D 组 / C-01，全部修复）

| 编号 | 问题 | 处理 | 状态 |
|---|---|---|---|
| D-01 | 回退正则表把 warning/note 归类为 error，无列号诊断不识别 | 关键字条目前置于 catch-all + 新增 `file:line:` 变体 | ✔ 0.8.129-dev |
| D-02 | 变量树子成员 `value` 恒为空 | `-var-list-children` 带 print-values | ✔ 0.8.129-dev |
| D-03 | 全局作用域不含程序全局变量 | 改 `info variables` 真实枚举（过滤工具链符号） | ✔ 0.8.129-dev |
| D-04 | 异常断点命中上报 `reason=breakpoint` 且无描述 | 按 catchpoint 编号识别 → `exception` + 描述 | ✔ 0.8.129-dev |
| D-05 | 会话销毁后仍推送 DAP 消息 | `disposed` 标志 + 摘除 gdb 回调/释放 emitter | ✔ 0.8.129-dev |
| D-06 | 导出的 Makefile 在 make 选 `sh` 时失效 | makefile 内显式 `SHELL := cmd.exe` | ✔ 0.8.129-dev |
| D-07 | `pause` 在 Windows 原生 GDB 下卡死调试会话 | `onPause` 能力探测 + 优雅降级（不下发会卡死的 `-exec-interrupt`） | ✔ 0.8.129-dev |
| D-08 | `cleanFile` 无对象文件时清空输出面板且零反馈 | 「无对象文件可清理」提升为 info 级（用户可见） | ✔ 0.8.129-dev |
| D-09 | `toggleCompile/toggleLink` 重新启用时写入默认值字面量 `="1"` | 启用＝删除该 `<Option>`；禁用＝写 `="0"`；空子节点收回自闭合 | ✔ 0.8.129-dev |
| D-10 | clangd 二进制存在即让出 Problems 诊断 | 判定改为需 clangd **扩展**已安装；未装/禁用时构建诊断回到 Problems | ✔ PR #16 |
| D-11 | `codeblocks.openProject` 忽略传入参数 | 支持 `Uri \| string` 带参直开；无参保持对话框 | ✔ PR #16 |
| D-12 | keybindings 去抖回写窗口内 reset 后托管条目被写回 | 去抖句柄提升到模块级：reset 先取消未决应用，再按「写设置 → 清文件 → 立即应用」收敛 | ✔ 0.8.129-dev |
| D-13 | 无扩展名的可执行产物（TCC 语义）在 Windows 下无法 Run/Debug | 按 `extension_auto` 补 `.exe`；仍无扩展名时给可读提示 | ✔ 0.8.129-dev |
| D-14 | 截断/未闭合 `.cbp` 提示为内部英文 TypeError | 解析前 `XMLValidator.validate`，统一抛「不是有效的 .cbp 文件：XML 结构错误（…）」 | ✔ 0.8.129-dev |
| D-15 | 构建互斥竞态：同 tick 连发两次 Build 并发双跑 | `claimBuildMutex()` 在任何 `await` 之前同步占位 | ✔ 0.8.129-dev |
| D-16 | 用户主动取消被误报为「构建失败」 | 构建/编译 `finally` 按 `cancelSource.isCancelled()` 判定取消 | ✔ 0.8.129-dev |
| D-17 | 对象目录创建失败只有 debug 级日志 | `ensureDir` 增加 `warn` 级（仍继续执行） | ✔ 0.8.129-dev |
| D-18 | 目标缺 `<Output>` 未拦截，链接命令畸形 | 非 `CommandsOnly` 目标必须有输出文件名，否则中文报错并跳过该目标 | ✔ 0.8.129-dev |
| D-19 | 重复 `<ExtraCommands>` 时 pre/post 命令静默丢失 | `parseExtraCommands` 入口展开数组后逐个解析 | ✔ 0.8.129-dev |
| D-20 | `compilerPrograms` 为全局且无 compiler-id 归属，交叉编译器会污染 `compiler="gcc"` 工程 | 设置改为按编译器 id 分组；解析/迁移/写入集中到 `src/compiler/compilerPrograms.ts` | ✔ 0.8.129-dev |
| C-01 | 适配器未消费 launch 的 `stopOnEntry`（无首停） | 入口临时断点：`main` → `WinMain` → `wWinMain`，兜底程序入口地址（可重定位镜像跳过）；命中映射 `stopped(reason=entry)` | ✔ 0.8.129-dev |

## 2. 决策记录

| 日期 | 范围 | 结论 |
|---|---|---|
| 2026-10-08 | F2/F3/F4/F6/F7、N4/N5、R3、R6①（9 项） | 均维持现状（不实施）；审计 2.5（最小 CI）与审计 3.2（巨型模块拆分）待单独确认 |
| 2026-10-09 | 扩展残留核查（X1–X4 + Y1–Y3 + A2 + R4） | 已实施完毕（0.8.122–0.8.127） |
| 2026-10-12 | 测试阶段缺陷 D-01…D-11 | 全部修复（D-07 = PR #11；D-08/D-09 = PR #13；D-10/D-11 = PR #16） |
| 2026-10-12 | 候选缺陷 D-12/D-13/D-20 + 能力缺口 C-01 | 全部实施（随 0.8.129-dev） |
| 2026-10-12 | 边界/异常 E2E 新发现 D-14…D-19 | 全部修复（随 0.8.129-dev） |
| 2026-11-04 | 审计 2.5 复核 | 已由 0.8.129-dev 测试分层 + CI 落地，状态改为 ✔；仅审计 3.2 保持待确认 |
| 2026-11-05 | Agent 控制分支版本号 | 功能分支用 semver 预发布后缀（不占用正式版号、可并存安装）；契约测试的版本正则同步支持 `-\w+` 后缀。分支版本 `0.8.143-agent-control`（已随 0.9.0 合入 main，版本号回到正式版） |
| 2026-11-06 | Agent 控制设置开关 | 总闸 `codeblocks.agent.enabled` **默认开启**（保持既有行为）、作用域 = LM Tools + 内嵌 MCP（CLI 不受影响，避免 CI 被工作区设置意外锁死）；只读 `codeblocks.agent.readOnly` 用白名单（`project_read` / `build_status` / `compiler list,info` / `workspace info,deps,list` / `debug state`）；**未受信任工作区强制按关闭处理**；策略集中在 `src/api/agentPolicy.ts` 并由 `invokeTool()` 统一拦截 |
| 2026-11-18 | 0.8.154 功能/健壮性批次 | G1/G2/T2/T3/T5/M2/M3/M6/M7 子集实施；原子写、单元路径 XML 转义、package.json i18n、Makefile CompileFile/DistClean 收口；P3（WebView CSP、模块拆分）仍待排期 |
| 2026-11-19 | 0.8.157 AutoVersioning/Profiler | AutoVersioning 的 ChangesLog 只提供文本打开/创建（不移植 wxGrid）；SVN 查询失败只警告并生成空字段；`version.h` 内容不变不写。Profiler 拒绝旧 `gmon.out`，`gprof -A` 空 stdout 时回退 `--separate-files` |
| 2026-11-19 | 0.9.0 合并 Agent 控制 | 以 `--no-ff` 合入 `feat/agent-control`：构建内核抽到 `build/buildProject.ts`（UI/CLI/MCP 共用一份），`engines.vscode` 抬到 `^1.102.0`；main 的审计修复（语言标志、缓存签名、自动版本号、可导航诊断、本地化日志）逐项移植回抽取后的模块 |
| 2026-11-19 | 合并复查 R9（编辑副本 / 归属校验） | 工具编辑改在深拷贝上进行（`loadForEdit` / `projectService`），任一条 op 校验失败不再把宿主内存模型改一半；`file.buildTargets` 必须引用真实目标（否则 `invalid-input`）；`addFile.weight` 按字段白名单 0–100 校验；`addFile`/`addVirtualTarget` 的 `targets` 去重；`agentBuild` 互斥竞态返回 `build-busy` |
| 2026-11-19 | 合并复查 R8（清理 / 调试启动 / 预览） | makefile Clean 的 spawn 失败（code=null）或被取消不再算成功；gdb 就绪失败回收进程，`ENOENT` 映射 `compiler-missing` + `debug.gdbPath` 提示；preserve + dryRun 返回 preview；`build_status` 合并摘要的 `truncated` 归一为布尔；新增真实 gdb 的 `test-e2e-cli-debug`（`debug run` = 启动 + 断点 + 栈/变量） |
| 2026-11-19 | 合并复查 R7（构建平台判定 / 等待器） | 平台判定抽成 `targetPlatformSupported`（虚拟目标按成员并集），`buildProjectTarget` 早退与 `assertTargetRunnable` 共用，修掉「首个成员不支持 → 整组静默跳过」；`debug start/continue/step` 的停止等待器在命令发送失败时先吞掉 rejection，避免 30s 后 unhandled rejection |
| 2026-11-19 | 合并复查 R5（调试状态机） | `continue`/`step` 先把 `stopped` 置 false 再等停止（断点处不再立即返回旧状态）；`start` 中途失败回收 gdb 会话（不再永久「已在运行」）；`stop`/`dispose` 清空 reason/threadId/断点跟踪；CLI `setBreakpoints` 改「替换该文件」并跟踪断点号（与宿主一致）；`debug run` 的断点统一由 `start` 应用（CLI 先 setBreakpoints 会 not-running）；`continue`/`step` 支持 `timeoutMs` |
| 2026-11-19 | 合并复查 R3-06 / R3-07 | 只读白名单放开 `debug stack` / `variables`（纯查询；`evaluate` 会真实执行函数，仍拒绝）；`codeblocks_run` 增加默认超时 **120000ms**（显式 `0` = 不限时），避免死循环程序永久占住工具调用 |
| 2026-11-20 | E3 观察项处置 | Rebuild/停调试确认移到 `claimBuildMutex()` 之前（`runBuildPreflight`），确认期间 Stop 返回“等待构建确认”；外部修改检测补 `.cbp` 事件 / tracker / 焦点 / 问询日志并新增宿主回归；工程树不含 target 层级按既有设计维持 |

## 3. 仍开放项

| 编号 | 项 | 说明 |
|---|---|---|
| 审计 3.2 | 巨型模块拆分 | 进行中（0.8.159）：纯逻辑模块 + `features/{toolCommands,workspaceCommands,newProjectCommands,debugCommands,autoVersioningCommands,profilerCommands,projectManager}.ts` 已拆出；buildCommands、debug 剩余、uiCommands 按 [architecture.md](./architecture.md) §4 继续按需推进 |
| G1 / G2 | `.workspace` 外部修改检测、无工程单文件编译编码 | ✔ 0.8.154 已实施（见 [未实现功能待办](./backlog.md) §1） |
| 原子写（R5） | `.cbp`/`.workspace` 写入中断 | ✔ 0.8.154：同目录临时文件 + rename；失败保留原文件 |
