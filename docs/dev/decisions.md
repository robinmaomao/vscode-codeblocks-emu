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

## 3. 仍开放项

| 编号 | 项 | 说明 |
|---|---|---|
| 审计 3.2 | 巨型模块拆分 | 无功能影响、低优先；需要时按域拆包。无排期 |
| G1 / G2 | `.workspace` 外部修改检测、无工程单文件编译编码 | 见 [未实现功能待办](./backlog.md) §1 |
