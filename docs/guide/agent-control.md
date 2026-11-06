# Agent 控制（Copilot / MCP / CLI）

> 版本：**0.8.143-agent-control**（`feat/agent-control` 预发布构建） ｜ 需要 VS Code **1.102.0+**
>
> 本页说明如何让 AI agent（GitHub Copilot Chat 的 Agent 模式）以及任意 MCP 客户端 / 命令行
> 完整控制本扩展的 Code::Blocks 工程：读取与修改 `.cbp`、构建/重建/清理、运行、调试。

---

## 1. 三种接入方式

| 方式 | 适用场景 | 需要什么 |
|---|---|---|
| **Language Model Tools**（推荐） | VS Code 内与 Copilot 对话，直接说"把 Debug 目标加上 `-std=c++17` 然后构建" | VS Code 1.102+、Copilot Chat；工具由扩展自动注册 |
| **MCP server** | 其它 MCP 客户端（Claude Desktop、Inspector…），或希望工具跨客户端复用 | `bundle/cb-mcp.js`（扩展自带，无需单独安装） |
| **cb-cli** | 终端 / CI / 脚本；不启动 VS Code | `bundle/cb-cli.js`（扩展自带）或 `dist/cli/cb-cli.js`（开发态） |

三者共用同一份实现（`src/api/toolRegistry.ts`），**参数、行为、错误码完全一致**。

---

## 2. 快速开始（Copilot Chat）

1. 安装并启用扩展，打开包含 `.cbp` 的工作区；
2. 打开 Chat，切到 **Agent** 模式，点 **Configure Tools** 确认 `Code::Blocks: …` 系列工具已启用；
3. 直接描述任务，例如：

```text
读取 test-project/hello-cb.cbp，把 Debug 目标的编译器选项加上 -std=c++17，
然后构建 Debug 目标；如果失败，把错误按文件:行 列出来。
```

```text
在 hello-cb 工程里新增一个 DebugOnly 目标（复制 Release 的设置），
把 main.c 的 compile 关掉，再用 preserve 格式写回。
```

```text
构建 Release 并运行，把程序输出和退出码告诉我；如果退出码非 0，再调试它、
停在 main 上并打印局部变量。
```

> 提示：agent 的写操作会返回 `changed[]`（before/after）。让它先 `dryRun` 再落盘，可以避免误改。

---

## 3. 工具参考（11 个）

| 工具 | 主要参数 | 说明 |
|---|---|---|
| `codeblocks_project_read` | `cbp?`、`section=summary\|targets\|files\|options\|schema\|all`、`target?` | 读取工程模型；`section=schema` 返回**可编辑字段目录**（不需要工程） |
| `codeblocks_project_edit` | `ops[]`、`dryRun?`、`format=canonical\|preserve`、`allowScripts?`、`force?` | 增量编辑；返回 `changed[]` 与 `warnings[]` |
| `codeblocks_project_file` | `action=add\|remove\|rename`、`file`、`targets?`、`to?` | 工程内文件增删改 |
| `codeblocks_project_target` | `action=add\|remove\|rename`、`title`、`copyFrom?`、`targetType?` | 构建目标增删改 |
| `codeblocks_build` | `cbp?`、`target?`、`mode=build\|rebuild\|clean`、`timeoutMs?`、`dryRun?` | 构建并返回结构化诊断 |
| `codeblocks_build_status` | `cbp?`、`severity?`、`tail?` | 最近一次构建摘要（诊断/统计/实际命令） |
| `codeblocks_run` | `cbp?`、`target?`、`args?`、`cwd?`、`timeoutMs?` | 运行目标并捕获输出与退出码（非交互） |
| `codeblocks_debug` | `action=start\|stop\|breakpoints\|state\|stack\|variables\|evaluate\|continue\|step\|run` | 调试控制；`run` = 启动 + 断点 + 返回栈/变量 |
| `codeblocks_compiler` | `action=list\|info`、`compilerId?` | 列出可用编译器、解析实际程序路径 |
| `codeblocks_export` | `kind=makefile\|compile_commands\|commands`、`out?` | 导出构建信息 |
| `codeblocks_workspace` | `action=info\|deps\|list\|open\|close\|setActive` | `.workspace` 与多工程管理 |

所有工具都接受 `cbp`；省略时使用**当前活动工程**。

### 3.1 编辑语法（`codeblocks_project_edit`）

```jsonc
{
  "cbp": "E:/proj/app.cbp",
  "format": "canonical",
  "dryRun": false,
  "ops": [
    { "op": "set", "scope": "project", "field": "compilerId", "value": "gcc" },
    { "op": "add", "scope": "target", "target": "Debug", "field": "compilerOptions", "value": "-std=c++17" },
    { "op": "remove", "scope": "target", "target": "Debug", "field": "includeDirs", "value": "old/inc" },
    { "op": "set", "scope": "file", "file": "src/main.c", "field": "compile", "value": false },
    { "op": "addTarget", "title": "Release2", "copyFrom": "Release", "targetType": 0 },
    { "op": "renameTarget", "title": "Release2", "to": "ReleaseFast" },
    { "op": "addFile", "file": "src/extra.c", "targets": ["Debug"], "compile": true, "link": true },
    { "op": "addVirtualTarget", "alias": "AllFast", "targets": ["ReleaseFast"] }
  ]
}
```

规则：

- **字段白名单**：拼错或越权字段会直接报 `invalid-input`，不会静默忽略；可用字段见 `section=schema`。
- **数组字段**：`op=add/remove` 只接受单个字符串；`op=set` 替换整个数组。
- **脚本类字段**（`commandsBeforeBuild` / `commandsAfterBuild` / `buildScripts` / `makeCommands` /
  `customBuildCommands`）需要显式 `allowScripts: true`——它们会执行任意命令。
- **写盘格式**：
  - `canonical`（默认）：`parse → 改模型 → serializeProject` 整体重写，保证语义正确、必定可解析；
  - `preserve`：只对 `file.compile` / `file.link` 做定点改写，保留其余字节（注释/缩进/属性顺序）；
    其它操作会自动降级为 canonical，并在 `warnings[]` 中说明。
- **外部修改保护**：若 `.cbp` 在编辑期间被其它程序改写，返回 `external-modified`；确认要覆盖时传 `force: true`。

---

## 4. 典型工作流

### 4.1 改编译选项并构建

```text
1) codeblocks_project_edit  { ops: [{op:"add",scope:"target",target:"Debug",field:"compilerOptions",value:"-O2"}] }
2) codeblocks_build         { target: "Debug" }
3) codeblocks_build_status  { severity: "error" }        // 只在失败时需要
```

### 4.2 新增源文件

```text
codeblocks_project_file { action:"add", file:"src/new.c", targets:["Debug","Release"] }
```

文件必须**已存在于磁盘**；`targets` 省略表示"归属所有目标"（与 Code::Blocks 缺省语义一致）。

### 4.3 构建失败排查

`codeblocks_build` 的返回里 `summary.projects[].diagnostics[]` 就是结构化诊断：

```json
{ "severity": "error", "file": "E:/proj/src/a.c", "line": 12, "column": 5, "message": "..." }
```

需要完整命令时用 `codeblocks_build_status`，或在构建前 `codeblocks_export { kind: "commands" }`。

### 4.4 运行与调试

```text
codeblocks_run   { target: "Debug", args: "--verbose", timeoutMs: 10000 }
codeblocks_debug { action: "run", target: "Debug", stopOnEntry: true }
codeblocks_debug { action: "variables" }
codeblocks_debug { action: "continue" }
```

`codeblocks_run` 是**非交互**的（捕获 stdout/stderr）；需要 stdin 的程序请在集成终端里运行。

---

## 5. CLI（`cb-cli`）

扩展自带打包版本：`<扩展目录>/bundle/cb-cli.js`。开发态可直接用 `node dist/cli/cb-cli.js`。

```bash
# 读取
node bundle/cb-cli.js show app.cbp --section summary --json
node bundle/cb-cli.js schema --json

# 编辑（--ops 或 --ops-file；PowerShell 建议用 --ops-file 避免引号转义）
node bundle/cb-cli.js edit app.cbp --ops-file ops.json --format preserve --json

# 构建 / 清理 / 运行
node bundle/cb-cli.js build app.cbp --target Debug --json
node bundle/cb-cli.js build app.cbp --clean --json
node bundle/cb-cli.js run app.cbp --target Debug --json

# 导出 / 编译器
node bundle/cb-cli.js export app.cbp --kind makefile --out Makefile.cli --json
node bundle/cb-cli.js compiler info --compiler-id gcc --json
```

约定：

- **stdout 只放结果**（`--json` 时是纯 JSON），构建日志与警告全部走 **stderr**；
- 退出码：`0` 成功、`2` 用法错误、`3` 参数/校验错误、`4` 构建或运行失败、`5` 写盘 / 工程不存在；
- 设置来源与扩展一致：用户 `settings.json` → 工作区 `.vscode/settings.json` → `CB_*` 环境变量
  （`CB_COMPILER_ID`、`CB_MASTER_PATH`、`CB_COMPILER_PROGRAMS`、`CB_MAX_REPORTED_ERRORS`、`CB_UI_LANGUAGE`）；
- 文案语言跟随 `codeblocks.ui.language`（`auto` 时无宿主按英文）：`CB_UI_LANGUAGE=zh-cn` 可让错误提示与构建日志出中文，
  示例 `CB_UI_LANGUAGE=en node bundle/cb-cli.js show app.cbp --json` 便于 CI 断言英文输出。

---

## 6. MCP

### 6.1 VS Code 内（自动）

扩展注册了 MCP provider（`contributes.mcpServerDefinitionProviders`）。
在 **MCP: List Servers** 里应能看到 `Code::Blocks`，启动后即可在 Chat 的 Tools 里选用它的工具。

> 服务器用 `process.execPath` 启动，不需要本机 PATH 里有 `node`。

### 6.2 其它客户端（`.vscode/mcp.json` 或客户端配置）

```json
{
  "servers": {
    "codeblocks": {
      "type": "stdio",
      "command": "node",
      "args": ["<扩展目录>/bundle/cb-mcp.js"]
    }
  }
}
```

协议行为：

- 工具名/参数与本文第 3 节完全一致；
- 工具失败返回 `isError: true` + `{ ok:false, error:{ code, message } }` 文本；
- 日志只写 stderr（stdout 是协议通道）。

---

## 7. 开关与安全模式

两个设置（`settings.json`，切换**即时生效、无需重载窗口**）：

| 设置 | 默认 | 行为 |
|---|---|---|
| `codeblocks.agent.enabled` | `true` | 总闸。关闭后 11 个 Language Model Tools **不再注册**（Copilot 看不到也调不到），内嵌 MCP server 不再暴露；外部客户端直接启动的 `cb-mcp.js` 也会拒绝调用（`disabled`）。**未受信任的工作区一律按关闭处理**。独立的 `cb-cli` 不受影响。 |
| `codeblocks.agent.readOnly` | `false` | 只读模式。只放行 `project_read` / `build_status` / `compiler list,info` / `workspace info,deps,list` / `debug state`；其余返回 `read-only`，工程文件字节不变。 |

```jsonc
// .vscode/settings.json
{
  "codeblocks.agent.enabled": true,
  "codeblocks.agent.readOnly": false
}
```

> 关闭开关后，如果正在运行的 MCP server 是外部客户端启动的，请重启该客户端；VS Code 内嵌的 server 会随 provider 的定义变化自动停止暴露。
>
> 工具**调用**在切换后立即生效（关闭后报未知工具、只读模式下报 `read-only`）；但 VS Code 的工具**列表快照**
> （Configure Tools 面板 / `vscode.lm.tools`）可能滞后到下次窗口重载才刷新，这不影响权限判定。

---

## 8. 安全与权限

| 关卡 | 行为 |
|---|---|
| 总闸 | `codeblocks.agent.enabled`（见上表）；未受信任工作区强制关闭 |
| 只读模式 | `codeblocks.agent.readOnly`（见上表），拦截在 `invokeTool` 统一入口 |
| 工具启用 | VS Code 的 **Tools** 选择器逐个开关；也可在自定义 agent 里固定工具集 |
| 审批 | 由 VS Code 的权限等级决定；写操作返回 before/after，便于复核 |
| `dryRun` | `project_edit` / `build` 支持只校验不落盘 |
| 字段白名单 | 只能改文档化的字段；未知字段/越界值直接报错 |
| `allowScripts` | 构建脚本、pre/post 命令、自定义构建命令必须显式开启才能改 |
| `force` | 覆盖"外部已修改"的 `.cbp` 必须显式开启 |
| 范围 | 默认只写工作区内已存在的 `.cbp`/`.workspace` |

---

## 9. 与扩展状态的交互

- **LM Tools（扩展内）**：编辑走内存模型 → `persistProjectAndReload`，不会触发"外部修改，是否重载"弹窗，
  Build Log / Problems / 状态栏都会同步更新。
- **CLI / MCP（独立进程）**：直接读写磁盘，扩展的文件监听会提示"工程被外部修改"——点击重载即可；
  或者改用 LM Tools 路径。
- **构建互斥**：扩展内已有构建在跑时，工具返回 `build-busy`，不会并发双跑。
- **Rebuild / 停止调试**：agent 触发时**不会**弹模态确认（自动停调试），与手动命令的交互不同。

---

## 10. 排障

| 现象 | 处理 |
|---|---|
| Chat 里看不到工具 | 确认 VS Code ≥ 1.102、Copilot Chat 已启用、Tools 选择器里已勾选；重载窗口 |
| 工具返回 `invalid-input: Unknown field` | 先 `codeblocks_project_read { section: "schema" }` 看白名单 |
| 返回 `external-modified` | 先让 VS Code 重载工程，或确认后传 `force: true` |
| `compiler-missing` / 构建跳过 | 检查 `codeblocks.compilerId`、`codeblocks.masterPath`、`codeblocks.compilerPrograms`；CLI 可用 `compiler info` |
| CLI 找不到编译器 | CLI 会读工作区 `.vscode/settings.json`；也可用 `CB_MASTER_PATH` 覆盖 |
| MCP 启动失败 | 确认 `<扩展目录>/bundle/cb-mcp.js` 存在；外部客户端改用 `node` 显式指定路径 |
| 调试拿不到变量 | `codeblocks_debug { action: "stack" }` 确认已停止（`state.stopped`）；`run` 模式会一次返回栈与局部变量 |

---

## 11. 已知限制

- `codeblocks_run` 不提供 stdin；交互式程序请用终端。
- `preserve` 格式仅覆盖 `compile` / `link`（其余操作降级 canonical）。
- `codeblocks_build_status` 在 CLI 里只反映**同一进程内**的最近一次构建；跨进程请直接读 `codeblocks_build` 的返回值。
- web 扩展（`vscode.dev`）不支持 stdio MCP。
- 调试的交互式子集（registers/内存/反汇编）只在扩展内提供。
