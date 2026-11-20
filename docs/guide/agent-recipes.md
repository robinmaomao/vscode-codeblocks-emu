# Agent recipes（Copilot / MCP / CLI）

> 面向“直接复制就能用”的 Code::Blocks Agent 工作流。完整工具参数见 [Agent 控制](./agent-control.md)，
> 安全开关与确认规则见该文 §3.2 / §7 / §8。

## 0. 通用约定

- 先 `codeblocks_project_read { section: "summary" }`，再决定目标与文件；不要手改 `.cbp` XML。
- 多步编辑先 `dryRun: true`，确认 `changed[]` 后再落盘。
- 脚本字段需要 `codeblocks.agent.allowScripts` 与调用里的 `allowScripts: true` 同时开启。
- 构建失败先看 `codeblocks_build_status { severity: "error" }`；不要反复重试同一个失败构建。

## 1. 构建失败 → 修复 → 再构建

**自然语言**

```text
构建当前工程的 Debug 目标。失败时按文件:行:列汇总错误，定位并修复源代码，
然后只重新构建一次；如果仍有错误，把剩余诊断列出来，不要继续盲目重试。
```

**等价工具序列**

```text
codeblocks_project_read  { section: "summary" }
codeblocks_build         { target: "Debug", mode: "build" }
codeblocks_build_status  { severity: "error" }     // 仅在失败时
...修改源文件（普通编辑工具）...
codeblocks_build         { target: "Debug" }
```

## 2. 改编译选项（先预览）

```text
读取 Debug 目标，把编译器选项从 -O0 改为 -O2，先 dryRun 给我看 before/after，
确认后再写回并构建。保留 .cbp 的其它内容。
```

```text
codeblocks_project_read { section: "targets", target: "Debug" }
codeblocks_project_edit {
  target: "Debug",
  dryRun: true,
  ops: [{ op: "set", scope: "target", target: "Debug", field: "compilerOptions", value: "-O2" }]
}
// 确认 changed[] 后去掉 dryRun 再调用一次
```

## 3. 新增源文件与目标

```text
在 src/ 下新增 util.c（文件已存在），加入 Debug 和 Release 两个目标；
再复制 Release 创建一个 ReleaseFast 目标，然后把 util.c 从 ReleaseFast 中移除。
```

```text
codeblocks_project_file   { action: "add", file: "src/util.c", targets: ["Debug", "Release"] }
codeblocks_project_target { action: "add", title: "ReleaseFast", copyFrom: "Release" }
codeblocks_project_edit   { ops: [{ op: "set", scope: "file", file: "src/util.c", field: "buildTargets", value: ["Debug", "Release"] }] }
```

> `addFile` / `project_file` 要求文件已在磁盘存在；`targets` 省略表示归属全部目标。

## 4. 运行与调试

```text
构建并运行 Release，把 stdout/stderr 和退出码告诉我。退出码非 0 时，
用 Debug 目标停在 main，打印局部变量和调用栈，然后结束调试会话。
```

```text
codeblocks_build  { target: "Release" }
codeblocks_run    { target: "Release", timeoutMs: 10000 }
codeblocks_debug  { action: "run", target: "Debug", stopOnEntry: true }
codeblocks_debug  { action: "variables" }
codeblocks_debug  { action: "stack" }
codeblocks_debug  { action: "stop" }
```

> `run` 不提供 stdin，交互式程序请用集成终端；调试的 start/stop/continue/step 在扩展内可能弹确认。

## 5. 撤错改：查看历史 → 撤销

```text
刚才 Agent 改错了 Debug 目标的编译选项。先列出当前工作区的 Agent 变更历史，
确认是最新一条后撤销，并检查工程树里的值已经恢复。
```

```text
@codeblocks /history
// 选择最新一条 → Undo This Change
// 或直接：
@codeblocks /undo
```

> 同一文件只能撤销最新一条；如果文件在 Agent 之后被外部修改，默认拒绝，二次确认才强制覆盖。
> 详细规则见 [Agent 变更历史与撤销](./agent-history.md)。

## 5. CI 导出

```text
导出当前工程的 Makefile 和 compile_commands.json 到工程目录内的 .cb-tools/ci/，
并告诉我实际写出的路径。
```

```bash
node "$ext/bundle/cb-cli.js" export app.cbp --kind makefile --out .cb-tools/ci/Makefile --json
node "$ext/bundle/cb-cli.js" export app.cbp --kind compile_commands --out .cb-tools/ci --json
node "$ext/bundle/cb-cli.js" build app.cbp --target Release --json
```

> `out` 必须落在工程目录内；默认 Makefile 是 `Makefile.cb`，不会覆盖工程声明的 Makefile。

## 6. 多工程 / workspace

```text
列出当前 .workspace 的工程与依赖，把 app 的依赖改为 lib，确认没有环，
然后构建整个 workspace 的 Release 目标。
```

```text
codeblocks_workspace { action: "info" }
codeblocks_workspace { action: "deps", project: "app.cbp", dependencies: ["lib.cbp"] }
codeblocks_build     { target: "Release" }   // 工作区构建用 UI 的 Build Workspace
```

## 7. `@codeblocks` 快捷命令

| 命令 | 说明 |
|---|---|
| `@codeblocks /read [target]` | 读取活动工程摘要 |
| `@codeblocks /build [target] --rebuild` | 构建/重建 |
| `@codeblocks /fix` | 最近一次构建错误 |
| `@codeblocks /debug stack` | 当前栈 |
| `@codeblocks /status` | 开关、工具数、CLI/MCP/Skill 路径 |
| `@codeblocks /help` | 帮助 |

> 需要“自己决定改哪里”的循环时用 **Agent 模式**；`@codeblocks` 只做确定性命令包装。
