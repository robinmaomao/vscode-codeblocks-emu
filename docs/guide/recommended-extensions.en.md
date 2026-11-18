# Recommended VS Code extensions (companions for Code::Blocks features)

> Language: **English** ｜ [中文](./recommended-extensions.md)
>
> Applies to 0.8.156+ ｜ Decision record: [unimplemented-feature backlog](../dev/backlog.md) §2

Some Code::Blocks features are tightly coupled to its IDE framework, or already have mature VS Code equivalents. This extension follows a **"use a mature extension instead of re-implementing it"** policy, so it does not duplicate those UIs, debuggers or configuration formats. The tables below list recommended extensions, their IDs and integration notes.

> ⚠️ These are third-party community/vendor extensions. They are **not provided, bundled or endorsed** by this extension. Check their license, install count, last update and permissions before installing. Extension IDs can change; always confirm on the VS Code Marketplace / Open VSX.

## 1. Doxygen comments (DoxyBlocks)

| Extension | ID | Use case |
|---|---|---|
| Doxygen Documentation Generator | `cschlosser.doxdocgen` | Type `/**` above a function/class to generate `@brief` / `@param` / `@return` templates; C/C++/C#/Java and more |
| Doxygen | `bbenoist.Doxygen` | Run Doxygen and browse generated HTML/LaTeX from VS Code |

Notes:

- This extension handles **build/debug**; the Doxygen extension handles **documentation**. They are independent.
- Keep an existing `Doxyfile` at the project root and point `bbenoist.Doxygen` at it; no `.cbp` changes are needed.
- Set `OUTPUT_DIRECTORY` outside the workspace (or into an ignored directory) so generated files do not look like project sources to this extension's watcher.

## 2. Printing (File → Print)

| Extension | ID | Notes |
|---|---|---|
| Nifty Print | `nifty.nifty-print` | Prints the current file/selection through the browser, preserving syntax highlighting |
| Print2Paper | `appliedmedia.print2paper4vscode` | Paper-oriented print/export |

VS Code has no stable native print API; this extension does not emulate the Code::Blocks print dialog. Use one of the extensions above, or VS Code's built-in `File → Print` where available.

## 3. Modern Fortran

| Extension | ID | Notes |
|---|---|---|
| Modern Fortran | `fortran-lang.linter-gfortran` | Fortran language support, gfortran diagnostics, completion and formatting; maintained by the fortran-lang community |
| Fortran Language Server | `cesiumlang.zfls` | Language-server based completion, go-to-definition and hover |

A Code::Blocks Fortran project is still "a compiler plus command templates". In this extension, select a GCC-compatible compiler and point `codeblocks.compilerPrograms` at `gfortran` if needed; leave syntax analysis and completion to the extensions above.

## 4. Environment variables

| Extension | ID | Notes |
|---|---|---|
| Dotenv | `dotenv.dotenv-vscode` | `.env` highlighting and per-file environment injection; useful for secrets kept outside the workspace |
| Env Sync | `nolindnaidoo.envsync-le` | Synchronize environment configuration across workspaces/machines |

This extension already supports `<Environment><Variable>` in `.cbp` (injected for build/run) and the `codeblocks.env` setting. **Do not** inject the same variable twice: when both are set, this extension's project/target environment wins. Third-party extensions are better for IDE-wide variables shared by terminals, tasks and other extensions.

## 5. Single-library symbols / disassembly (SymTab single-library mode)

| Extension | ID | Notes |
|---|---|---|
| Nm tool | `wibren-wiersma.nm-tool` | Runs `nm` on one `.a` / `.o` / executable and groups symbols by type |
| vscode-binutils | `sqlpassion.vscode-binutils` | GUI wrapper for `nm` / `objdump` and other binutils (**Marketplace only**; may not be on Open VSX) |

This extension's **Tools → Find Symbol in Libraries…** searches **all libraries linked by the active project/target**. If you only need the complete symbol table of one library, the extensions above are more direct. Both can be used together.

## 6. Profiler / Valgrind (optional, for Callgrind workflows)

This extension already includes **Profile Target (gprof)**: run the target → `gmon.out` → gprof flat profile/call graph/annotated source/CSV·HTML export. The extensions below target the **Valgrind/Callgrind** ecosystem and do not replace gprof:

| Extension | ID | Notes |
|---|---|---|
| Blacksmith | `lucasalvcoutinho.blacksmith` | Run/view Callgrind results in VS Code (Valgrind must be installed) |
| Valgrind Task Integration | `1nVitr0.valgrind-task-integration` | Integrate Valgrind tools with VS Code tasks and the Problems panel |

Valgrind is generally unavailable on Windows. On Linux/macOS, combine this extension's build commands with the extensions above when you need cachegrind/callgrind detail.

## 7. Static analysis / regex (existing recommendations)

Both are already listed in [usage §16.1](./usage.en.md#161-prefer-a-vs-code-extension-instead-not-implemented-here); this is an index:

| Purpose | Recommended extension IDs |
|---|---|
| Cppcheck / static analysis | `cppchecksolutionsab.cppcheck-official` · `jbenden.c-cpp-flylint` · `emielestivenartentity.cppcheck-turbo` |
| Regex testing | `chrmarti.regex` · `louiswt.regexp-preview` |

Before running Cppcheck, execute **Build → Export compile_commands.json…** in this extension so the analyzer sees the same `-I` / `-D` / standard flags as Code::Blocks.

## 8. Selection principles

1. **This extension owns**: `.cbp` / `.workspace` parsing, build, debug, project tree, build log, gprof and cross-library symbol search.
2. **Third-party extensions own**: documentation generation, printing, language-level completion/diagnostics (Fortran etc.), Valgrind and IDE-wide environment synchronization.
3. **No duplication**: when a stable extension already covers a capability, this extension provides only an entry point/documentation, not a copy of its UI or configuration.
4. **Configuration ownership**: keep build/debug variables in `.cbp` or this extension's settings; leave IDE-wide configuration to the other extension to avoid "changed in two places, only one takes effect".

> If an extension in these tables is unmaintained or its ID changes, please open an issue so this document can be updated.
