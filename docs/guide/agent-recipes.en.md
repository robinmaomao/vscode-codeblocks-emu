# Agent recipes (Copilot / MCP / CLI)

> Copy-paste workflows for the Code::Blocks agent tools. See [Agent control](./agent-control.en.md) for the full
> tool reference and §3.2 / §7 / §8 for permissions, confirmations and safety switches.

## 0. Ground rules

- Call `codeblocks_project_read { section: "summary" }` first; never hand-edit `.cbp` XML.
- For multi-step edits set `dryRun: true`, review `changed[]`, then repeat without `dryRun`.
- Script fields require both `codeblocks.agent.allowScripts` and `allowScripts: true` on the call.
- On build failure, read `codeblocks_build_status { severity: "error" }`; do not retry the same failing build blindly.

## 1. Build → fix → build again

**Prompt**

```text
Build the current project's Debug target. If it fails, group the errors by file:line:column,
fix the source, then build once more. If errors remain, list the remaining diagnostics and stop.
```

**Tool sequence**

```text
codeblocks_project_read  { section: "summary" }
codeblocks_build         { target: "Debug", mode: "build" }
codeblocks_build_status  { severity: "error" }     // only after a failure
...edit the source with normal editing tools...
codeblocks_build         { target: "Debug" }
```

## 2. Change compiler options (preview first)

```text
Read the Debug target and change compilerOptions from -O0 to -O2. Show me the before/after
with dryRun, then write it back and build. Keep the rest of the .cbp unchanged.
```

```text
codeblocks_project_read { section: "targets", target: "Debug" }
codeblocks_project_edit {
  target: "Debug",
  dryRun: true,
  ops: [{ op: "set", scope: "target", target: "Debug", field: "compilerOptions", value: "-O2" }]
}
// repeat without dryRun after reviewing changed[]
```

## 3. Add a source file and a target

```text
Add the existing src/util.c to Debug and Release, then create ReleaseFast by copying Release
and remove util.c from ReleaseFast.
```

```text
codeblocks_project_file   { action: "add", file: "src/util.c", targets: ["Debug", "Release"] }
codeblocks_project_target { action: "add", title: "ReleaseFast", copyFrom: "Release" }
codeblocks_project_edit   { ops: [{ op: "set", scope: "file", file: "src/util.c", field: "buildTargets", value: ["Debug", "Release"] }] }
```

> `addFile` / `project_file` require the file to exist on disk; omitting `targets` means all targets.

## 4. Run and debug

```text
Build and run Release; report stdout/stderr and the exit code. If the exit code is non-zero,
debug the Debug target, stop at main, print locals and the call stack, then stop the session.
```

```text
codeblocks_build  { target: "Release" }
codeblocks_run    { target: "Release", timeoutMs: 10000 }
codeblocks_debug  { action: "run", target: "Debug", stopOnEntry: true }
codeblocks_debug  { action: "variables" }
codeblocks_debug  { action: "stack" }
codeblocks_debug  { action: "stop" }
```

> `run` has no stdin; use the integrated terminal for interactive programs. In the extension,
> debug start/stop/continue/step may show a confirmation.

## 5. CI export

```text
Export the current project's Makefile and compile_commands.json into .cb-tools/ci/ inside the
project, and report the actual paths written.
```

```bash
node "$ext/bundle/cb-cli.js" export app.cbp --kind makefile --out .cb-tools/ci/Makefile --json
node "$ext/bundle/cb-cli.js" export app.cbp --kind compile_commands --out .cb-tools/ci --json
node "$ext/bundle/cb-cli.js" build app.cbp --target Release --json
```

> `out` must stay inside the project directory. The default Makefile is `Makefile.cb`; it never
> overwrites the Makefile declared by the project.

## 6. Multi-project / workspace

```text
List the projects and dependencies in the current .workspace, change app's dependency to lib,
verify there is no cycle, then build the workspace Release target.
```

```text
codeblocks_workspace { action: "info" }
codeblocks_workspace { action: "deps", project: "app.cbp", dependencies: ["lib.cbp"] }
codeblocks_build     { target: "Release" }   // use the UI's Build Workspace for a workspace build
```

## 7. `@codeblocks` shortcuts

| Command | Purpose |
|---|---|
| `@codeblocks /read [target]` | Read the active project summary |
| `@codeblocks /build [target] --rebuild` | Build/rebuild |
| `@codeblocks /fix` | Latest build errors |
| `@codeblocks /debug stack` | Current stack |
| `@codeblocks /status` | Switches, tool count, CLI/MCP/skill paths |
| `@codeblocks /help` | Help |

> Use **Agent mode** for the autonomous read → edit → build → fix loop; `@codeblocks` is only a deterministic command wrapper.
