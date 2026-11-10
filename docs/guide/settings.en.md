# Settings reference

> For the Code::Blocks extension (`codeblocks-vscode`). This page documents every setting in the **9 settings sections**, including type, default, scope, allowed values and when changes take effect.
> Chinese version: [settings.md](./settings.md)｜Features and workflows: [User manual](./usage.en.md).

## 0. General

- **Open settings**: `Ctrl+,` → search `codeblocks`, or run `Preferences: Open Settings (UI)` from the Command Palette.
- **Configuration files**: user `settings.json`, workspace `.vscode/settings.json`, and folder settings in multi-root workspaces.
- **Scopes**:
  - No scope listed = can be overridden at user / workspace / folder level.
  - `window` = window scope; only user or remote settings can override.
  - `machine-overridable` = machine-specific path setting, excluded from Settings Sync but still overridable per workspace.
  - `resource` = read per resource (project file); folder-level overrides work in multi-root workspaces.
- **When changes take effect**: most settings apply immediately; some require a window reload or the next build/debug session (noted per setting).
- **Upgrade migration** (this version):
  - `codeblocks.parallelJobs` `0` changed from "logical cores × 2" to "the host's logical core count". On upgrade, an **explicitly configured 0** is rewritten to `8` once; set it back to `0` afterwards to use the logical core count.
  - `codeblocks.clangd.queryDriver` was removed (it only printed a hint). Use `codeblocks.clangd.builtinHeaders = queryDriver` and run `Code::Blocks: Configure clangd --query-driver`.
  - Settings were reorganized into 9 sections; **setting keys were not renamed**, so existing configuration files keep working.

---

## 1. Compiler & Toolchain

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.compilerId` | string | `gcc` |  | Default compiler ID (matches `options_<id>.xml`). Used when a project has no compiler or for standalone file compilation; changing it refreshes the `Compiler:` status bar and regenerates the clangd database for the new compiler (restarting clangd when the database actually changes). |
| `codeblocks.masterPath` | string | `""` | machine-overridable | Compiler installation root; empty = detect from `PATH`. Changes propagate to compile commands, system include paths and the clangd database. |
| `codeblocks.compilerPrograms` | object | `{}` | machine-overridable | Per-compiler program paths overriding `C` / `CPP` / `LD` / `LIB` / `WINDRES` / `MAKE` / `DBGconfig`. Usually written by "Detect Compilers"; can be set explicitly for cross toolchains. |

Example:

```jsonc
{
  "codeblocks.compilerId": "gcc",
  "codeblocks.masterPath": "C:/mingw64",
  "codeblocks.compilerPrograms": {
    "gcc": { "C": "C:/mingw64/bin/gcc.exe", "CPP": "C:/mingw64/bin/g++.exe" }
  }
}
```

---

## 2. Build

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.saveBeforeBuild` | boolean | `true` |  | Save all dirty files before build / run / clean. |
| `codeblocks.parallelJobs` | number | `8` | resource | Parallel compile jobs. `1` = serial; `2`–`32` = explicit concurrency; `0` = auto (the host's logical core count, capped at 32). The effective concurrency is also bounded by the process budget `max(8, logical cores)`; when capped, the build prints a one-line note. Folder-level overrides are supported; applies to the next build. |
| `codeblocks.build.compilerCache` | string | `none` | machine-overridable | Compiler cache: `none` / `ccache` / `sccache`. Only standard compile commands are prefixed; missing tools fall back to the original compiler with a warning. ccache only accepts UTF-8 preprocessed output: when the project path contains non-ASCII characters, compile units switch to project-relative source paths and get `-fno-working-directory` (otherwise every compilation is uncacheable); non-ASCII source files or include directories stay uncacheable (a warning is printed at build start). |
| `codeblocks.build.compilerCachePath` | string | `""` | machine-overridable | Explicit cache tool path; empty = auto-detect (PATH / WinGet / Scoop / cargo / Chocolatey / Program Files). An invalid path counts as not found; only used when the cache is not `none`. |
| `codeblocks.build.skipIncludeDeps` | boolean | `false` |  | Skip the `#include` dependency scan during incremental builds (aligned with CB `skip_include_deps`). |
| `codeblocks.build.linkInputExtensions` | array | `["xm"]` |  | In-project link-input extensions that trigger relinking (e.g. `ld` / `lds` / `icf` / `def`). Accepts `xm`, `.xm`, `*.xm`; set `[]` to disable. |
| `codeblocks.build.verboseOutput` | boolean | `false` |  | Verbose output: full compile command lines, per-file clean lists and files skipped by incremental builds. |
| `codeblocks.build.profile` | boolean | `false` |  | Build performance probe: appends a `[profile]` phase timing block; equivalent to `CB_BUILD_PROFILE=1`. |
| `codeblocks.build.traceProcesses` | boolean | `false` |  | Print child-process spawn count, peak concurrency and the concurrency limit after a build. |
| `codeblocks.build.lowerCompilerPriority` | boolean | `false` |  | Run compiler/link children at below-normal priority; can make I/O-bound builds slower, so it is off by default. |
| `codeblocks.build.autoExcludeOutputs` | boolean | `true` |  | Before each build, add object/output directories to `files.watcherExclude` and `search.exclude` in **user settings** so VS Code stops re-scanning build outputs. |
| `codeblocks.build.sampleSystem` | boolean | `false` |  | Sample CPU attribution (machine / editor / security software / file scanner) once per second during builds (Windows only). Not enabled automatically with `build.profile`. |
| `codeblocks.build.performanceAdvisor` | boolean | `false` |  | Performance advisor: attribution warnings at build end (host stalls / CPU saturation / antivirus / file-scanner storms) plus the build-start low-memory check. Off by default; enabled automatically by `build.profile` or `build.sampleSystem`. |
| `codeblocks.build.compileCommandsOnlyTargets` | boolean | `false` |  | Whether CommandsOnly targets (type=4) compile their files; default runs only pre/post scripts. |
| `codeblocks.build.scriptExitGraceMs` | number | `1500` |  | Exit grace period for pre/post-build script commands (0–60000 ms); `0` fully matches CB's "wait for the command only". |
| `codeblocks.build.scriptCommandTimeoutMs` | number | `0` |  | Per-command script timeout (0 = no timeout, max 3600000 ms); on timeout the process tree is killed and the build fails. |
| `codeblocks.build.strictQuoting` | boolean | `false` |  | Strict quoting (only spaces need quotes, aligned with CB `NeedQuotes`); off also quotes cmd metacharacters. |
| `codeblocks.build.asmUsesCompilerVar` | boolean | `false` |  | Pick the compiler program for assembly files via `compilerVar`; `true` matches CB (`.s` uses g++), `false` forces the C compiler. |
| `codeblocks.build.responseFile` | string | `safe` |  | Response-file strategy for over-long commands: `safe` = threshold 8000, absolute paths, keeps the source extension; `cb` = threshold 32767, `main.respFile`, relative paths (CB-aligned). |
| `codeblocks.build.cleanResponseFiles` | boolean | `false` |  | Delete `*.respFile` in object directories on Clean/Rebuild; CB never cleans them, so off by default. |

---

## 3. Build Log & Notifications

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.maxReportedErrors` | number | `50` |  | Maximum errors collected per build; `0` = unlimited. |
| `codeblocks.build.plainCbLog` | boolean | `false` |  | Plain CB log mode: disables script numbering, single-line completion, Emoji summary and slowest Top 3; prints `=== Build finished ===`. |
| `codeblocks.build.persistLog` | boolean | `false` |  | Write build output to disk and keep it across windows (`%APPDATA%\Code\logs\CodeBlocks.log`); requires a window reload. |
| `codeblocks.build.outputTimestamp` | boolean | `false` |  | Prefix each regular output line with a timestamp (only when `persistLog=false`); applies immediately. |
| `codeblocks.build.saveHtmlLog` | boolean | `false` |  | Save an HTML build log (`<project>_build_log.html`) with start/end time and a diagnostics summary. |
| `codeblocks.build.saveHtmlLogFullCommandLine` | boolean | `false` |  | Include full command lines in the HTML log; only effective when `saveHtmlLog` is on. |
| `codeblocks.log.english` | boolean | `false` |  | Force English build-log messages (overrides `ui.language`). |
| `codeblocks.ui.quietSuccess` | boolean | `false` |  | Do not show a toast on successful builds (log + status bar badge only). |
| `codeblocks.ui.quietFailure` | boolean | `false` |  | Do not show a toast on failed builds (Build Log and status bar still update). |
| `codeblocks.ui.buildLogAutoFocus` | string | `errors` |  | Build Log auto-focus: `errors` / `errorsAndWarnings` / `always` / `never`. |
| `codeblocks.ui.buildLogFocusFirstError` | boolean | `true` |  | Focus the first error when auto-focusing. |

---

## 4. Workspace & Projects

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.workspace.pathGuard` | string | `prompt` |  | Workspace path guard: when the path contains glob metacharacters (`[ ] { } * ?`), `off` = no check, `prompt` = ask before disabling the two AI instruction scan locations, `auto` = disable immediately. |
| `codeblocks.detect.autoOpen` | string | `all` |  | Workspace project detection: `all` = multi-select prompt, `single` = auto-open only when one project exists, `off` = disabled (status-bar entry still works). |
| `codeblocks.detect.autoOpenThreshold` | number | `20` |  | Project-count safety threshold for auto-detection (1–1000); larger results prompt first. |
| `codeblocks.detect.checkExternalChanges` | string | `prompt` |  | When a `.cbp` changes externally: `prompt` = ask to reload, `auto` = reload immediately, `off` = do not check. |
| `codeblocks.projectTree.categorize` | boolean | `true` |  | Group the project tree by source / header / other; turn off to show a flat list. |

---

## 5. Debug (GDB)

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.gdbTimeoutMs` | number | `30000` |  | GDB MI command timeout (≥1000 ms). |
| `codeblocks.debug.initCommands` | array | `[]` |  | GDB commands executed after the debug session starts (e.g. `set pagination off`). |
| `codeblocks.debug.userArguments` | string | `""` |  | Extra arguments appended to the GDB command line (quote-aware splitting). |
| `codeblocks.debug.disableInit` | boolean | `true` |  | Pass `-nx` to GDB so `.gdbinit` / `gdb.ini` are not executed. |
| `codeblocks.debug.printPretty` | boolean | `false` |  | Pretty-print variables (`set print pretty on`). |
| `codeblocks.debug.printElements` | number | `0` |  | Maximum array/string elements to display (`set print elements`; 0 = unset). |
| `codeblocks.debug.disassemblyFlavor` | string | `default` |  | Disassembly syntax: `default` / `intel` / `att` / `custom`; `custom` uses `instructionSet`. |
| `codeblocks.debug.instructionSet` | string | `""` |  | Custom disassembly flavor argument (only when `disassemblyFlavor=custom`). |
| `codeblocks.debug.charset` | string | `""` |  | Debug charset (`set charset`, e.g. `UTF-8` / `GBK`); empty = unset. |
| `codeblocks.debug.gdbPath` | string | `""` | machine-overridable | GDB executable path; empty = detect `masterPath/bin` → `PATH`. |
| `codeblocks.debug.trace` | boolean | `false` |  | Write DAP requests/responses/events to the Code::Blocks output channel. |
| `codeblocks.debug.registers` | boolean | `false` |  | Allow the Registers view to read registers (some MinGW GDB 8.1 builds crash; enable after verifying). |
| `codeblocks.debug.addOtherProjectDirs` | boolean | `false` |  | Add other open project directories to the debug source search path. |

---

## 6. IntelliSense (clangd)

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.clangd.enabled` | boolean | `true` |  | Enable clangd integration: generate `compile_commands.json` and update the clangd user config; off falls back to lightweight completion. |
| `codeblocks.clangd.buildLogDiagnostics` | string | `build` |  | Build Log diagnostics source: `build` = full build-engine diagnostics; `clangd` = clangd diagnostics (opened files only). |
| `codeblocks.clangd.restartOnActiveProjectSwitch` | boolean | `true` |  | Restart clangd when switching active projects and the compile database actually changes. |
| `codeblocks.clangd.forcedIncludes` | array | `["global.h"]` |  | Base headers force-included when analyzing headers; looked up in include search paths and added with `-include` when found. |
| `codeblocks.clangd.suppressedWarnings` | array | `["-Wunused-function","redefinition_different_typedef"]` |  | Diagnostics written to clangd `Diagnostics.Suppress`. |
| `codeblocks.clangd.suppressHeaderDiagnostics` | boolean | `true` |  | Suppress all diagnostics when analyzing headers standalone (`.c` files unaffected). |
| `codeblocks.clangd.unusedIncludes` | string | `none` |  | Written to `Diagnostics.UnusedIncludes`: `none` / `strict` / `omit` (omit = leave the key out). |
| `codeblocks.clangd.headerInsertion` | string | `never` |  | Written to `Completion.HeaderInsertion`: `never` / `iwyu` / `omit`. |
| `codeblocks.clangd.indexBackground` | string | `default` |  | Written to `Index.Background`: `default` / `build` / `skip`. |
| `codeblocks.clangd.indexStandardLibrary` | string | `default` |  | Written to `Index.StandardLibrary`: `default` / `true` / `false`. |
| `codeblocks.clangd.clangTidy` | string | `default` |  | `default` = leave the key out; `off` = disable all clang-tidy diagnostics. |
| `codeblocks.clangd.completionAllScopes` | string | `default` |  | Written to `Completion.AllScopes`: `default` / `yes` / `no`. |
| `codeblocks.clangd.inlayHints` | string | `default` |  | Written to `InlayHints.Enabled`: `default` / `on` / `off`. |
| `codeblocks.clangd.documentationCommentFormat` | string | `default` |  | Written to `Documentation.CommentFormat`: `default` / `plaintext` / `markdown` / `doxygen`. |
| `codeblocks.clangd.excludeDirs` | array | `[]` |  | Directory names written to `If.PathExclude` (relative to the project tree, e.g. `obj` / `bin`). |
| `codeblocks.clangd.builtinHeaders` | string | `clangd` |  | Written to `CompileFlags.BuiltinHeaders`: `clangd` / `queryDriver` (use the cross toolchain's builtin headers). Setting `queryDriver` without `--query-driver` prints a hint about the configuration command. |
| `codeblocks.clangd.extraConfig` | string | `""` |  | Free-form YAML appended to every project fragment; the extension adds the scope `If` automatically. YAML syntax errors make clangd discard the whole config. |

> Removed: `codeblocks.clangd.queryDriver`. It only printed a hint; the real switch is `builtinHeaders=queryDriver`, and stale entries are cleaned up on upgrade.

---

## 7. UI

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.ui.language` | string | `auto` | window | Runtime UI language: `auto` (follow VS Code display language) / `en` / `zh-cn`. Command titles and the Settings UI still follow the VS Code display language and require a window reload. |
| `codeblocks.ui.projectToolbar` | array | `["buildWorkspace","rebuildWorkspace","cleanWorkspace"]` |  | Buttons shown in the Project view title bar. Available: `newProject`, `openProject`, `build`, `rebuild`, `clean`, `run`, `debug`, `buildWorkspace`, `rebuildWorkspace`, `cleanWorkspace`, `compilerOptions`, `projectProperties`, `codeStats`. Unselected buttons move to the `⋯` overflow menu. |
| `codeblocks.ui.symbolsView` | boolean | `true` |  | Show the Symbols view in the sidebar. |
| `codeblocks.ui.recentProjectsLimit` | number | `8` |  | Maximum recent projects (0–50; 0 = do not record). |
| `codeblocks.ui.findFileOpen` | boolean | `false` |  | Open files directly from "Find File"; default locates the file in the project tree only. |
| `codeblocks.search.scope` | string | `openProjects` |  | Default Project Search scope: `openProjects` (all open projects) / `activeProject` (active project only). The view's selector overrides it per workspace. |
| `codeblocks.search.keepHistory` | boolean | `true` |  | Keep recent search history per workspace (20 entries each for files/text). Turn it off to stop recording; existing history can be cleared at the top of the view. |

---

## 8. Editor & Tools

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.editor.autoHeaderGuard` | boolean | `false` |  | Automatically insert a header guard in new empty header files. |
| `codeblocks.editor.headerGuardStyle` | string | `ifndef` |  | Header guard style: `ifndef` / `pragma-once`. |
| `codeblocks.editor.tidyCommentWidth` | number | `80` |  | Comment reflow width for "Tidy Comments" (20–200). |
| `codeblocks.editor.asmHashComment` | boolean | `false` |  | Use GAS-native `#` line comments for assembly (`.s`/`.S`); default `//` (safe for preprocessed `.S`). |
| `codeblocks.astyleOptions` | array | `["--style=allman","--indent=spaces=4"]` |  | AStyle formatting options. |
| `codeblocks.todo.keywords` | array | `["TODO","FIXME","NOTE","HACK","XXX"]` |  | Keywords used by TODO scanning and "Insert TODO". |
| `codeblocks.tools` | array | `[]` |  | Custom tool entries. Each item has `name` and `command` (required), plus optional `arguments`, `workingDirectory`, `env`, and `output` (`output` / `terminal` / `silent`). |

Example:

```jsonc
{
  "codeblocks.tools": [
    {
      "name": "size",
      "command": "size",
      "arguments": "\"${file}\"",
      "output": "output"
    }
  ]
}
```

---

## 9. Keybindings

| Setting | Type | Default | Scope | Description |
|---------|------|---------|-------|-------------|
| `codeblocks.keybindings.cbStyle` | boolean | `false` |  | Enable Code::Blocks-style keybindings (e.g. `F9` build and run, `Ctrl+F9` build). |
| `codeblocks.keybindings.overrides` | object | `{}` |  | Command → key override map, e.g. `{ "codeblocks.build": "ctrl+shift+b" }`; set to `null` or delete an entry to restore the default. |

---

## 10. When changes take effect

| Setting | Takes effect |
|---------|--------------|
| `parallelJobs` / most build settings | Next build |
| `build.persistLog` | Window reload |
| `ui.language` | Runtime messages immediately; command titles / Settings UI after a window reload |
| `clangd.*` (artifact-affecting keys) | Automatically regenerates clangd config after ~150 ms debounce |
| `debug.*` | Next debug session |
| `compilerId` / `masterPath` / `compilerPrograms` | Status bar refreshes immediately; clangd database regenerates as needed |
| `editor.*` / `astyleOptions` / `todo.keywords` / `tools` | Immediately (tool menus refresh on next open) |
