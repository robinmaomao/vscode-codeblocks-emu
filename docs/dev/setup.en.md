# Development Environment Setup (Windows x64)

This document describes how to set up the repository from scratch: Node.js, a native MinGW toolchain, dependencies, builds, layered tests, and VS Code debugging.

> The examples use `E:\VSCode Developer\tools` as the installation root. Replace it with any directory you prefer; all commands are PowerShell.

## 1. Prerequisites

- Windows 10/11 x64.
- VS Code `>= 1.85` (the repository's `engines.vscode` requirement).
- Git.
- Optional: system Edge (visual regression uses it by default); no Chromium download is required when Edge is installed.
- No administrator rights are required: Node and w64devkit are portable extractions with user-level PATH entries.

## 2. Install Node.js 24 LTS

Some dependencies in `package-lock.json` require Node `>= 22`; Node 24 LTS is recommended.

```powershell
$tools = 'E:\VSCode Developer\tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null

$zip = Join-Path $env:TEMP 'node-v24.22.3-win-x64.zip'
curl.exe -L --fail -o $zip 'https://nodejs.org/dist/v24.22.3/node-v24.22.3-win-x64.zip'
tar -xf $zip -C $tools
Move-Item (Join-Path $tools 'node-v24.22.3-win-x64') (Join-Path $tools 'node')
```

Append the Node directory to the **user PATH** (idempotent):

```powershell
$nodeDir = Join-Path $tools 'node'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($userPath -split ';' | Where-Object { $_ -ne '' })
if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $nodeDir.TrimEnd('\') })) {
    [Environment]::SetEnvironmentVariable('Path', (($parts + $nodeDir) -join ';'), 'User')
}
```

Verify:

```powershell
& (Join-Path $nodeDir 'node.exe') --version   # v24.22.3
& (Join-Path $nodeDir 'npm.cmd') --version    # 11.x
```

## 3. Install w64devkit (gcc/g++/gdb/ar/make)

Use the [w64devkit](https://github.com/skeeto/w64devkit) 2.11.0 portable bundle, which includes `gcc`, `g++`, `gdb`, `ar`, `make`, and related tools.

```powershell
$sfx = Join-Path $env:TEMP 'w64devkit-x64-2.11.0.7z.exe'
curl.exe -L --fail --ssl-no-revoke -o $sfx `
  'https://github.com/skeeto/w64devkit/releases/download/v2.11.0/w64devkit-x64-2.11.0.7z.exe'

& $sfx -y -o"E:\VSCode Developer\tools"
```

The extracted directory should be `E:\VSCode Developer\tools\w64devkit\bin`. Append it to the user PATH:

```powershell
$mingwBin = 'E:\VSCode Developer\tools\w64devkit\bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($userPath -split ';' | Where-Object { $_ -ne '' })
if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $mingwBin.TrimEnd('\') })) {
    [Environment]::SetEnvironmentVariable('Path', (($parts + $mingwBin) -join ';'), 'User')
}
```

The extension's default `MAKE` program is `mingw32-make.exe`. If w64devkit only provides `make.exe`, create a compatibility alias:

```powershell
if (-not (Test-Path (Join-Path $mingwBin 'mingw32-make.exe'))) {
    Copy-Item (Join-Path $mingwBin 'make.exe') (Join-Path $mingwBin 'mingw32-make.exe')
}
```

> w64devkit uses a static libgcc and does not ship `libgcc_eh.a`. The repository's LLVM/clang native MinGW link (E2E S4) looks for it; if you see `unable to find library -lgcc_eh`, copy `libgcc.a` to `libgcc_eh.a`:
>
> ```powershell
> $gccLib = Get-ChildItem 'E:\VSCode Developer\tools\w64devkit\lib\gcc\x86_64-w64-mingw32' -Directory | Select-Object -First 1
> if ($gccLib -and -not (Test-Path (Join-Path $gccLib.FullName 'libgcc_eh.a'))) {
>     Copy-Item (Join-Path $gccLib.FullName 'libgcc.a') (Join-Path $gccLib.FullName 'libgcc_eh.a')
> }
> ```

Verify (open a new terminal, or append `mingwBin` to the end of PATH):

```powershell
$env:Path = $env:Path + ";$mingwBin"
gcc --version
g++ --version
gdb --version
ar --version
make --version
mingw32-make --version
```

### 3.1 PATH activation

- User PATH changes only affect **new processes**; the current VS Code, integrated terminal, and extension host keep the old environment.
- **Fully restart VS Code** after installation (opening a new window is not enough).
- **PATH order**: append `w64devkit\bin` to the **end** of PATH so `C:\Windows\System32` stays first. Otherwise w64devkit's BusyBox tools such as `ping.exe` shadow the Windows commands and can break tests (for example, process-tree snapshots). The Node directory can be placed at the front or the end (it does not shadow Windows commands).
- To verify in the current automation session, prepend explicitly:
  `$env:Path = "E:\VSCode Developer\tools\node;" + $env:Path + ";E:\VSCode Developer\tools\w64devkit\bin"`
  or call `node.exe` / `npm.cmd` / `gcc.exe` by absolute path.

## 4. Restore dependencies and build

```powershell
npm.cmd ci
npm.cmd run compile
npm.cmd run bundle
npm.cmd run bundle:search
```

Outputs:

- `dist/`: tsc output used by the headless tests.
- `bundle/extension.js`: the esbuild single-file entry (`main` in `package.json`).
- `bundle/search-worker.js`: the project search worker.

## 5. Layered tests

Run as needed:

```powershell
npm.cmd run test:contract   # L-1 static contract
npm.cmd test                # L0 headless unit/integration
npm.cmd run test:e2e        # L1 real-toolchain E2E
npm.cmd run test:pack       # L5 packaging/install smoke
npm.cmd run test:host       # L2 real VS Code host
```

Notes:

- `test:e2e` prints `SKIP` reasons for optional toolchains that are not installed (MSP430, SDCC, etc.) and does **not** fail. w64devkit provides native gcc/g++/ar/gdb and ccache, so native scenarios should actually run.
- `test:host` reuses the VS Code copy cached in `.vscode-test/`; it downloads again on first use or when the cache is damaged.
- `test:host` first builds `bundle/extension.js` and `bundle/search-worker.js` via `pretest:host`, so it works from a clean checkout without a manual build.
- Visual/performance layers are outside the default development flow. Use `npm run test:visual` / `npm run test:perf` when needed and see the [layered testing strategy](../testing/strategy.md).

## 6. VS Code development and debugging

1. Fully restart VS Code so the user PATH is picked up (opening a new window is not enough for the extension host).
2. Open the repository root.
3. Press `F5`; VS Code runs the `build-extension` task (compile + bundle + bundle:search), then launches the **Extension Development Host**.
4. Or launch it directly:

```powershell
code.cmd --extensionDevelopmentPath="." --disable-extensions --new-window
```

Manual smoke test:

1. Open `test-project/hello-cb.cbp` in the Extension Development Host.
2. Confirm the status bar detects the GCC/MinGW compiler.
3. Press `Ctrl+F9` to build, `F9` to run, and `F5` to start GDB debugging; verify breakpoints and variables.

## 7. Troubleshooting

**`node` / `gcc` not found in the terminal**

- User PATH changes only affect new processes; fully quit and restart VS Code.
- In the current terminal, prepend the directories temporarily:
  ```powershell
  $env:Path = "E:\VSCode Developer\tools\node;" + $env:Path + ";E:\VSCode Developer\tools\w64devkit\bin"
  ```

**PowerShell cannot load `npm.ps1`**

- Use `npm.cmd` / `npx.cmd`, or adjust the execution policy:
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

**The extension status bar does not detect a compiler**

- Set `codeblocks.masterPath` to `E:\VSCode Developer\tools\w64devkit`, then reload the window.
- Or set `codeblocks.compilerPrograms` explicitly with the paths to `gcc.exe` / `g++.exe` / `gdb.exe`.

**GDB fails to start**

- Make sure `gdb.exe` is on PATH, or specify an absolute path via `codeblocks.debug.gdbPath` / `codeblocks.compilerPrograms`.
- Modern GDB's MI protocol is compatible with the extension; prefer the GDB bundled with w64devkit if you encounter an unusual build.

**The host test cannot download VS Code**

- Delete `.vscode-test/vscode-win32-x64-archive-*` and rerun `npm run test:host`.
- Or set `CB_VSCODE_PATH` to a local VS Code installation.

## 8. Optional components

- **ccache / sccache**: w64devkit 2.11.0 already bundles **ccache 4.14.1**; no separate installation is needed. It is used by `codeblocks.build.compilerCache` and the ccache E2E test.
- **Playwright Chromium**: visual regression uses system Edge by default; for a pinned Chromium, run `npx playwright install chromium` and set `CB_VISUAL_BROWSER=chromium`.
- **Cross toolchains**: AVR / RISC-V / LLVM / TCC can be extracted to `.cb-tools/toolchains/<name>/` (gitignored); tests detect them automatically without changing the system PATH.

## 9. Version baseline

| Component | Version |
|-----------|---------|
| Node.js | v24.22.3 LTS |
| npm | 11.19.1 |
| w64devkit | 2.11.0 |
| VS Code | `>= 1.85` (local: 1.140.0) |
| TypeScript | 5.9.3 (lock) |
| esbuild | 0.28.2 (lock) |

Related configuration: [.vscode/settings.json](../../.vscode/settings.json), [.vscode/tasks.json](../../.vscode/tasks.json), [.vscode/launch.json](../../.vscode/launch.json).
