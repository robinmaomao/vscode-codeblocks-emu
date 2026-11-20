# Agent change history and undo

> Version: **0.10.0** ｜ Requires VS Code 1.102.0+
>
> This page explains how to inspect Agent edits to `.cbp` / `.workspace` files, undo the latest change, and where the local history lives.
> Tool parameters and permissions are in [Agent control](./agent-control.en.md); copyable workflows are in [Agent recipes](./agent-recipes.en.md).

## 1. What it protects

Agents can edit project files directly, and recovering from a bad edit by hand is painful. 0.10.0 adds two layers:

| Capability | What it does |
|---|---|
| **Audit** | Every Agent tool call appends a local audit record: tool, action, result, duration and changed files. Scripts and source text are not recorded. |
| **Undo** | Writes to `.cbp` / `.workspace` keep a byte-level before-snapshot; the **latest** Agent change for each file can be undone. |

History lives in VS Code **workspace extension storage** — not in the project, not in Git, and never sent as telemetry.

## 2. Quick start

### View history

Run **Code::Blocks: Agent Change History…** from the Command Palette, or type:

```text
@codeblocks /history
```

The QuickPick lists time, tool, file, size and status:

- **Undo available**: the latest Agent change for that file;
- **Superseded**: a newer Agent change exists for the same file (undo that first);
- **Undone** / **Snapshot corrupt**: cannot be undone.

The QuickPick also offers:

- **Open Audit Log**: open `audit.jsonl` with every tool call;
- **Clear Agent history…** (deletes local snapshots and audit log; project files are untouched).

Select an entry to:

- **Undo This Change**;
- **Reveal File** (show it in the OS file manager);
- **Copy Path**.

### Undo the latest

Run **Code::Blocks: Undo Last Agent Change**, or type:

```text
@codeblocks /undo
```

The confirmation shows file, tool, time and size. After you confirm, the extension:

1. verifies the current file is still the version written by the Agent (SHA-256);
2. atomically restores the original bytes;
3. refreshes the project tree / workspace dependencies;
4. marks the entry as `undone`.

## 3. Conflicts and refusal

Undo **never** silently overwrites changes you made after the Agent.

| Situation | Behavior |
|---|---|
| File changed after the Agent write | Refuse by default; `Force Undo…` is available behind a second confirmation |
| File was deleted | Offer to restore it from the snapshot |
| A newer Agent change exists for the same file | Refuse the old entry and offer to undo the latest |
| Build or debug session active | Refuse; stop the build/debug session first |
| Workspace is untrusted | Refuse |
| Snapshot missing or hash mismatch | Refuse and mark the entry `corrupt` |

> “Latest” is **per file**. If the Agent edits `app.cbp` twice, only the second change can be undone first; after that, the first becomes undoable again.

## 4. What is recorded

### File snapshots

- `codeblocks_project_edit` (when not `dryRun`)
- `codeblocks_project_file`
- `codeblocks_project_target`
- `codeblocks_workspace` with `action=deps`

### Audit only (no snapshot)

- `project_read` / `build_status` / `compiler` queries
- `build` / `run` / `debug`
- `export` (exported files are outside the project-file undo scope)
- `workspace` `open` / `close` / `setActive` / `info` / `list`

`dryRun`, no-op writes, and calls rejected by read-only/script policy do **not** create undo entries; rejected calls still appear in the audit log.

## 5. Storage and retention

```text
<VS Code workspace storage>/agent-history/
  index.json          # change metadata, newest first
  audit.jsonl         # tool-call audit, append-only
  snapshots/
    <id>.before       # original bytes (encoding and line endings preserved)
```

- Uses `context.storageUri`; each workspace is isolated. History is unavailable when no folder is open.
- Snapshots preserve raw bytes, so GBK / CRLF projects are restored exactly.
- Defaults: **50** changes and **14** days; `audit.jsonl` rotates at about **2 MB**.
- Clearing history removes extension storage only, never project files.

Settings:

| Setting | Default | Meaning |
|---|---|---|
| `codeblocks.agent.history.enabled` | `true` | When off, new calls are not captured/audited; existing history can still be viewed and undone |
| `codeblocks.agent.history.maxEntries` | `50` | 5–200; oldest entries are pruned first |

## 6. Boundaries

- **VS Code extension only**: LM Tools and `@codeblocks` use workspace history. The standalone `cb-cli` and external MCP clients have no VS Code workspace storage and **do not support cross-process undo**.
- No redo, arbitrary-file undo, line-level diff, or Git integration.
- **No sensitive content in the audit log**: only allow-listed arguments and counts; scripts, source and full `ops` are not written. Snapshots are still local plain bytes — protect access to workspace storage accordingly.

## 7. Troubleshooting

| Symptom | Check |
|---|---|
| “History unavailable” | Open a folder first; no folder means no workspace storage |
| No history entry | `codeblocks.agent.history.enabled=true`, workspace trusted, and the call actually wrote a file (not `dryRun`) |
| `conflict` | The file changed after the Agent; inspect it, then force-undo only if intentional |
| `superseded` | Undo the newer Agent change for that file first |
| `busy` | Stop the build/debug session |
| Old entries missing | Retention (`maxEntries` / 14 days) pruned them |

**Code::Blocks: Agent Status** shows history count, audit bytes and storage path for support.
