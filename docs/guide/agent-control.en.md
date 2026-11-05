# Agent Control (Copilot / MCP / CLI)

> Version: 0.8.140+ | Requires VS Code **1.102.0+**
>
> This page explains how AI agents (GitHub Copilot Chat agent mode) and any MCP client or shell
> can fully control Code::Blocks projects through this extension: read/edit `.cbp`, build, rebuild,
> clean, run and debug.

---

## 1. Three transports

| Transport | Use when | Requirements |
|---|---|---|
| **Language Model Tools** (recommended) | Chatting with Copilot inside VS Code | VS Code 1.102+, Copilot Chat; tools are registered automatically |
| **MCP server** | Other MCP clients (Claude Desktop, Inspector, ...) | `bundle/cb-mcp.js` (shipped with the extension) |
| **cb-cli** | Terminal / CI / scripts; no VS Code window | `bundle/cb-cli.js` (shipped) or `dist/cli/cb-cli.js` (dev) |

All three share one implementation (`src/api/toolRegistry.ts`): identical arguments, behaviour and error codes.

---

## 2. Quick start (Copilot Chat)

1. Install and enable the extension, open a workspace containing a `.cbp`.
2. Open Chat, switch to **Agent** mode, open **Configure Tools** and make sure the `Code::Blocks: ...` tools are enabled.
3. Describe the task:

```text
Read test-project/hello-cb.cbp, add -std=c++17 to the Debug target compiler options,
then build the Debug target. If it fails, list the errors as file:line.
```

```text
Add a DebugOnly target to hello-cb (copying Release settings), disable compile for main.c,
and write the project back using the preserve format.
```

```text
Build and run Release, report stdout and the exit code. If the exit code is non-zero,
debug it, stop at main and print the local variables.
```

> Tip: mutating tools return `changed[]` with before/after. Ask the agent to `dryRun` first when in doubt.

---

## 3. Tool reference (11 tools)

| Tool | Main arguments | Purpose |
|---|---|---|
| `codeblocks_project_read` | `cbp?`, `section=summary\|targets\|files\|options\|schema\|all`, `target?` | Read the project model; `section=schema` returns the editable field catalog (works without a project) |
| `codeblocks_project_edit` | `ops[]`, `dryRun?`, `format=canonical\|preserve`, `allowScripts?`, `force?` | Incremental edits; returns `changed[]` and `warnings[]` |
| `codeblocks_project_file` | `action=add\|remove\|rename`, `file`, `targets?`, `to?` | Add/remove/rename project files |
| `codeblocks_project_target` | `action=add\|remove\|rename`, `title`, `copyFrom?`, `targetType?` | Add/remove/rename build targets |
| `codeblocks_build` | `cbp?`, `target?`, `mode=build\|rebuild\|clean`, `timeoutMs?`, `dryRun?` | Build and return structured diagnostics |
| `codeblocks_build_status` | `cbp?`, `severity?`, `tail?` | Last build summary (diagnostics/stats/commands) |
| `codeblocks_run` | `cbp?`, `target?`, `args?`, `cwd?`, `timeoutMs?` | Run the target, capture output and exit code (non-interactive) |
| `codeblocks_debug` | `action=start\|stop\|breakpoints\|state\|stack\|variables\|evaluate\|continue\|step\|run` | Debug control; `run` = start + breakpoints + stack/locals in one call |
| `codeblocks_compiler` | `action=list\|info`, `compilerId?` | List compilers / resolve program paths |
| `codeblocks_export` | `kind=makefile\|compile_commands\|commands`, `out?` | Export build information |
| `codeblocks_workspace` | `action=info\|deps\|list\|open\|close\|setActive` | `.workspace` and multi-project management |

Every tool accepts `cbp`; when omitted the active project is used.

### 3.1 Edit syntax (`codeblocks_project_edit`)

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
    { "op": "addTarget", "title": "Release2", "copyFrom": "Release", "targetType": 0 }
  ]
}
```

Rules:

- **Field whitelist**: unknown fields fail with `invalid-input` instead of being ignored; see `section=schema`.
- **Array fields**: `op=add/remove` take a single string; `op=set` replaces the whole array.
- **Script fields** (`commandsBeforeBuild`, `commandsAfterBuild`, `buildScripts`, `makeCommands`,
  `customBuildCommands`) require `allowScripts: true`.
- **Write format**: `canonical` (default) re-serializes the whole model; `preserve` only rewrites
  `file.compile` / `file.link` and keeps the rest byte-identical, falling back to canonical with a warning
  for unsupported operations.
- **External modification guard**: returns `external-modified` if the file changed during the edit;
  pass `force: true` to overwrite.

---

## 4. Typical workflows

### 4.1 Change options and build

```text
1) codeblocks_project_edit  { ops: [{op:"add",scope:"target",target:"Debug",field:"compilerOptions",value:"-O2"}] }
2) codeblocks_build         { target: "Debug" }
3) codeblocks_build_status  { severity: "error" }        // only when it failed
```

### 4.2 Add a source file

```text
codeblocks_project_file { action:"add", file:"src/new.c", targets:["Debug","Release"] }
```

The file must already exist on disk; omitting `targets` means "belongs to all targets" (Code::Blocks default).

### 4.3 Diagnose a failed build

`codeblocks_build` returns `summary.projects[].diagnostics[]`:

```json
{ "severity": "error", "file": "E:/proj/src/a.c", "line": 12, "column": 5, "message": "..." }
```

For the exact command lines use `codeblocks_build_status` or `codeblocks_export { kind: "commands" }`.

### 4.4 Run and debug

```text
codeblocks_run   { target: "Debug", args: "--verbose", timeoutMs: 10000 }
codeblocks_debug { action: "run", target: "Debug", stopOnEntry: true }
codeblocks_debug { action: "variables" }
codeblocks_debug { action: "continue" }
```

`codeblocks_run` is non-interactive (captures stdout/stderr); use the integrated terminal for programs
that need stdin.

---

## 5. CLI (`cb-cli`)

Shipped as `<extension>/bundle/cb-cli.js`; in development use `node dist/cli/cb-cli.js`.

```bash
node bundle/cb-cli.js show app.cbp --section summary --json
node bundle/cb-cli.js edit app.cbp --ops-file ops.json --format preserve --json
node bundle/cb-cli.js build app.cbp --target Debug --json
node bundle/cb-cli.js run app.cbp --target Debug --json
node bundle/cb-cli.js export app.cbp --kind makefile --out Makefile.cli --json
node bundle/cb-cli.js compiler info --compiler-id gcc --json
```

Conventions:

- **stdout carries only the result** (pure JSON with `--json`); build logs and warnings go to **stderr**.
- Exit codes: `0` ok, `2` usage, `3` validation/input, `4` build or run failure, `5` write/project-not-found.
- Settings resolution matches the extension: user `settings.json` -> workspace `.vscode/settings.json` -> `CB_*` env vars
  (`CB_COMPILER_ID`, `CB_MASTER_PATH`, `CB_COMPILER_PROGRAMS`, `CB_MAX_REPORTED_ERRORS`, `CB_UI_LANGUAGE`).
- Message language follows `codeblocks.ui.language` (`auto` resolves to English without a host): set
  `CB_UI_LANGUAGE=zh-cn` for Chinese diagnostics/build logs, keep `en` for stable CI assertions.

---

## 6. MCP

### 6.1 Inside VS Code (automatic)

The extension contributes an MCP provider. **MCP: List Servers** should list `Code::Blocks`; start it and
the tools become available in Chat.

### 6.2 Other clients

```json
{
  "servers": {
    "codeblocks": {
      "type": "stdio",
      "command": "node",
      "args": ["<extension>/bundle/cb-mcp.js"]
    }
  }
}
```

Behaviour: identical tool names/arguments as section 3; failures return `isError: true` with a JSON body;
logs go to stderr only (stdout is the protocol channel).

---

## 7. Safety and permissions

| Gate | Behaviour |
|---|---|
| Tool enablement | Per-tool toggles in the VS Code **Tools** picker |
| Approval | Governed by VS Code permission levels; edits return before/after |
| `dryRun` | `project_edit` / `build` validate without writing |
| Field whitelist | Only documented fields; unknown/out-of-range values fail |
| `allowScripts` | Editing build scripts / pre-post commands / custom build commands requires opt-in |
| `force` | Overwriting an externally modified `.cbp` requires opt-in |
| Scope | Writes are limited to existing `.cbp`/`.workspace` inside the workspace by default |

---

## 8. Interaction with the editor

- **LM Tools (in-process)**: edits go through the in-memory model and `persistProjectAndReload`; no
  "externally modified, reload?" prompt, and Build Log / Problems / status bar stay in sync.
- **CLI / MCP (separate process)**: writes hit disk directly, so the extension may prompt to reload the project.
- **Build mutex**: a concurrent agent build returns `build-busy`.
- **Rebuild / stop debugger**: agent builds skip modal confirmations (the debugger is stopped automatically).

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| Tools do not appear in Chat | VS Code >= 1.102, Copilot Chat enabled, tools ticked in the picker, then reload the window |
| `invalid-input: Unknown field` | Run `codeblocks_project_read { section: "schema" }` |
| `external-modified` | Reload the project in VS Code, or pass `force: true` |
| Build skipped / `compiler-missing` | Check `codeblocks.compilerId`, `codeblocks.masterPath`, `codeblocks.compilerPrograms`; use `compiler info` in the CLI |
| CLI cannot find the compiler | The CLI reads `.vscode/settings.json`; `CB_MASTER_PATH` also works |
| MCP server fails to start | Ensure `<extension>/bundle/cb-mcp.js` exists; use `node` explicitly in external clients |
| No variables while debugging | Check `codeblocks_debug { action: "stack" }` / `state.stopped`; `run` returns stack and locals at once |

---

## 10. Known limitations

- `codeblocks_run` has no stdin; use the terminal for interactive programs.
- `preserve` only covers `compile` / `link`; everything else falls back to canonical.
- `codeblocks_build_status` in the CLI only reflects builds from the same process; use the return value of `codeblocks_build`.
- Web extensions (`vscode.dev`) cannot use stdio MCP.
- Registers / memory / disassembly debugging is only available inside the extension.
