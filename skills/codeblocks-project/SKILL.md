---
name: codeblocks-project
description: Work with Code::Blocks .cbp projects through the Code::Blocks extension tools. Use when reading or editing targets, files, compiler/linker options, building, running, debugging, exporting, or diagnosing build failures in a .cbp project.
---

# Code::Blocks project workflow

Use the `codeblocks_*` tools instead of editing `.cbp` XML by hand. The same tool behavior is available through the VS Code tools, the embedded MCP server, and `cb-cli`.

## Start by reading

1. Call `codeblocks_project_read` with `section: "summary"` for the active project, or pass an explicit absolute `cbp` path.
2. Before editing a field you have not used before, call `codeblocks_project_read` with `section: "schema"`. Field names are whitelisted and misspellings fail with `invalid-input`.
3. Use `section: "targets"` / `"files"` / `"options"` when you only need one slice; avoid `all` on large projects.

Never parse, rewrite, or patch `.cbp` XML directly when a structured tool can express the change.

## Editing rules

- Prefer one `codeblocks_project_edit` call with several `ops` over several separate calls.
- For multi-op or unfamiliar edits, set `dryRun: true` first and review `changed[]` / `warnings[]`; then repeat without `dryRun`.
- Use `format: "preserve"` only for `file.compile` / `file.link`; other operations fall back to canonical and report a warning.
- Array fields: `op: "add"` / `"remove"` accept one string; `op: "set"` replaces the whole array.
- `commandsBeforeBuild`, `commandsAfterBuild`, `buildScripts`, `makeCommands`, and `customBuildCommands` execute arbitrary commands. Only pass `allowScripts: true` when the user explicitly asked to change a script, and only when the `codeblocks.agent.allowScripts` setting is enabled.
- If a write returns `external-modified`, reload the project in VS Code or ask the user before retrying with `force: true`.
- Report the resulting `changed[]` to the user; do not claim success without inspecting the tool result.

## Build and fix loop

1. Choose a target that exists in the project (read the summary first); omit `target` only when the active target is intended.
2. Call `codeblocks_build` with `mode: "build"`, `"rebuild"`, or `"clean"`.
3. On failure, call `codeblocks_build_status` with `severity: "error"` and use the structured `file` / `line` / `column` diagnostics. Fix the source, then build again.
4. Do not retry the same failing build indefinitely. Stop after a small number of attempts and report the remaining diagnostics.
5. `build-busy` means another build is running: wait for it or ask the user to stop it; do not start a parallel build.

Build scripts run with the user's permissions. Do not add or change scripts unless the user explicitly approves it.

## Run and debug

- `codeblocks_run` is non-interactive: it captures stdout/stderr and the exit code. Programs that need stdin must run in an integrated terminal.
- For a quick debug session, use `codeblocks_debug` with `action: "run"`, `stopOnEntry: true`, and optionally a breakpoint `file` / `lines`. Inspect `stack` and `variables`; call `stop` when finished.
- In the extension, debug start/stop/breakpoints/continue/step may ask the user for confirmation. Do not bypass or repeatedly retry a denied confirmation.
- `evaluate` can execute code in the debuggee. Use it only when the user asks for an expression evaluation.

## Error recovery

| Error code | What to do |
|---|---|
| `invalid-input` | Read `section: "schema"` / check allowed actions; fix the arguments instead of retrying blindly. |
| `project-not-found` | Ask for an absolute `.cbp` path or open the project in VS Code. |
| `external-modified` | Reload the project or ask the user before forcing an overwrite. |
| `build-busy` | Wait for the current build; do not launch another one. |
| `unsupported` | The target is not supported on this platform; report it and offer another target. |
| `compiler-missing` | Check `codeblocks.compilerId` / `codeblocks.masterPath`; use `codeblocks_compiler` to inspect the resolved toolchain. |
| `read-only` | Tell the user to turn off `codeblocks.agent.readOnly` if changes are intended. |
| `disabled` | Tell the user to enable `codeblocks.agent.enabled` and trust the workspace. |

## Safety

- Do not modify build scripts, pre/post-build commands, or custom build commands without explicit approval.
- Do not bypass workspace trust, the read-only switch, or the global script policy.
- Prefer the active project; pass `cbp` explicitly when multiple projects are open.
- Keep changes scoped to the requested project and target. Summarize what changed and what was verified.
