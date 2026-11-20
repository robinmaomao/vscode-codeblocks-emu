# Agent 变更历史与撤销

> 版本：**0.10.0** ｜ 适用于 VS Code 1.102.0+
>
> 本文说明如何查看 Agent 对 `.cbp` / `.workspace` 的修改、如何撤销最近一次变更，以及历史存储的位置和边界。
> 工具参数与权限见 [Agent 控制](./agent-control.md)；可复制的工作流见 [Agent recipes](./agent-recipes.md)。

## 1. 它解决什么问题

Agent 能直接改工程文件，误改后手工恢复很麻烦。0.10.0 增加两层保护：

| 能力 | 内容 |
|---|---|
| **审计** | 每次 Agent 工具调用写一条本地审计记录：工具名、动作、结果、耗时、变更文件；不记录脚本/源码内容 |
| **撤销** | 对 `.cbp` / `.workspace` 的写入保存变更前字节快照；可撤销每个文件的**最新一条** Agent 变更 |

历史只保存在 VS Code **工作区扩展存储**，不写工程目录、不进 Git、不发遥测。

## 2. 快速使用

### 查看历史

命令面板执行 **Code::Blocks: Agent Change History…**，或在 Chat 中输入：

```text
@codeblocks /history
```

QuickPick 会列出时间、工具、文件、大小和状态：

- **可撤销**：该文件最新一条 Agent 变更；
- **已被后续变更覆盖**：同一文件后面还有 Agent 变更，需先撤销更新的那条；
- **已撤销** / **快照损坏**：不可再撤销。

选中条目后可以：

- **Undo This Change**：撤销；
- **Reveal File**：在系统文件管理器中定位文件；
- **Copy Path**：复制绝对路径。

列表底部还提供：

- **Open Audit Log**：打开 `audit.jsonl`，查看所有工具调用；
- **Clear Agent history…**：删除当前工作区的本地快照与审计日志（不会删除工程文件）。

### 撤销最近一次

命令面板执行 **Code::Blocks: Undo Last Agent Change**，或在 Chat 中输入：

```text
@codeblocks /undo
```

确认框会显示文件、工具、时间、大小。确认后扩展：

1. 校验当前文件仍是 Agent 写入后的版本（SHA-256）；
2. 原子写回变更前的原始字节；
3. 刷新工程树 / 工作区依赖；
4. 把该条目标记为 `undone`。

## 3. 冲突与拒绝

撤销**不会**静默覆盖你在 Agent 之后做的修改。

| 情况 | 行为 |
|---|---|
| 文件在 Agent 变更后被外部修改 | 默认拒绝；警告框可选 `Force Undo…`，还需第二次确认 |
| 文件被删除 | 提示是否从快照恢复 |
| 同一文件有更新的 Agent 变更 | 拒绝旧条目，提示改为撤销最新一条 |
| 构建/调试进行中 | 拒绝，先停止构建或调试 |
| 工作区未受信任 | 拒绝 |
| 快照丢失/哈希不符 | 拒绝，并标记 `corrupt` |

> “最新一条”是**按文件**判断的。例如先改 `app.cbp`，再改 `app.cbp`，只能先撤销第二次；撤销后第一次会重新变为可撤销。

## 4. 记录范围

### 会生成文件快照的操作

- `codeblocks_project_edit`（非 `dryRun`）
- `codeblocks_project_file`
- `codeblocks_project_target`
- `codeblocks_workspace` 的 `action=deps`

### 只记审计、不生成快照的操作

- 所有 `project_read` / `build_status` / `compiler` 查询；
- `build` / `run` / `debug`；
- `export`（导出的是新文件，不属于工程文件撤销范围）；
- `workspace` 的 `open` / `close` / `setActive` / `info` / `list`。

`dryRun`、无实际字节变化、被只读/脚本策略拒绝的调用**不会**生成可撤销条目；其中被拒绝的调用仍会进入审计。

## 5. 存储与保留

```text
<VS Code 工作区存储>/agent-history/
  index.json          # 变更元数据（新→旧）
  audit.jsonl         # 工具调用审计（追加写）
  snapshots/
    <id>.before       # 变更前原始字节（保留编码/换行）
```

- 使用 `context.storageUri`，每个工作区独立；未打开文件夹时历史不可用。
- 快照保留原始字节，因此 GBK / CRLF 工程撤销后仍是原编码与换行。
- 默认最多 **50 条**变更、**14 天**；`audit.jsonl` 约 **2 MB** 后轮转。
- 删除历史只删扩展存储，不动工程文件；`Clear Agent history…` 需二次确认。

相关设置：

| 设置 | 默认 | 说明 |
|---|---|---|
| `codeblocks.agent.history.enabled` | `true` | 关闭后停止采集/审计；已有历史仍可查看与撤销 |
| `codeblocks.agent.history.maxEntries` | `50` | 5–200；超出后从最旧条目开始清理 |

## 6. 边界

- **仅 VS Code 扩展内**：LM Tools 与 `@codeblocks` 使用工作区历史；独立 `cb-cli`、外部 MCP 客户端没有 VS Code 工作区存储，**不提供跨进程撤销**。
- **不做 redo / 任意文件撤销 / 逐行 diff / Git 集成**。
- **不记录敏感内容**：审计只保留白名单参数与数量；脚本、源码、完整 `ops` 不落审计。快照本身是工程文件字节，仍属本地明文数据，请注意工作区存储的访问权限。

## 7. 排障

| 现象 | 检查 |
|---|---|
| 命令提示“历史不可用” | 先用 VS Code 打开一个文件夹；未打开文件夹没有工作区存储 |
| 没有生成历史 | 确认 `codeblocks.agent.history.enabled=true`、工作区已信任、调用确实写盘（不是 `dryRun`） |
| 撤销提示 `conflict` | 文件在 Agent 之后被修改；先确认外部修改，必要时二次确认强制撤销 |
| 撤销提示 `superseded` | 同文件有更新 Agent 变更；先撤销最新一条 |
| 撤销提示 `busy` | 停止构建/调试后再试 |
| 历史很多但看不到旧条目 | 超过 `maxEntries` 或 14 天保留期，已自动清理 |

Agent Status（**Code::Blocks: Agent Status**）会显示历史条数、审计字节数和存储路径，便于报障时复制。
