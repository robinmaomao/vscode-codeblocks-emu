# 开发环境配置（Windows x64）

本文说明如何从零配置本仓库的开发环境：Node.js、原生 MinGW 工具链、依赖安装、构建、分层测试与 VS Code 调试。

> 示例安装根目录为 `D:\tools`，可替换成任意自定义目录（含空格也可，命令中已加引号）；下文命令均使用 PowerShell。

## 1. 前置条件

- Windows 10/11 x64。
- VS Code `>= 1.85`（仓库 `engines.vscode` 要求）。
- Git。
- 可选：系统 Edge（视觉回归默认使用）；本机已安装时无需额外下载 Chromium。
- 无需管理员权限：Node 与 w64devkit 都采用便携解压 + 用户 PATH。

## 2. 安装 Node.js 24 LTS

仓库 `package-lock.json` 的部分依赖要求 Node `>= 22`，推荐使用 Node 24 LTS。

```powershell
$tools = 'D:\tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null

$zip = Join-Path $env:TEMP 'node-v24.22.3-win-x64.zip'
curl.exe -L --fail -o $zip 'https://nodejs.org/dist/v24.22.3/node-v24.22.3-win-x64.zip'
tar -xf $zip -C $tools
Move-Item (Join-Path $tools 'node-v24.22.3-win-x64') (Join-Path $tools 'node')
```

把 Node 目录追加到**用户 PATH**（已存在则跳过）：

```powershell
$nodeDir = Join-Path $tools 'node'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($userPath -split ';' | Where-Object { $_ -ne '' })
if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $nodeDir.TrimEnd('\') })) {
    [Environment]::SetEnvironmentVariable('Path', (($parts + $nodeDir) -join ';'), 'User')
}
```

验证：

```powershell
& (Join-Path $nodeDir 'node.exe') --version   # v24.22.3
& (Join-Path $nodeDir 'npm.cmd') --version    # 11.x
```

## 3. 安装 w64devkit（gcc/g++/gdb/ar/make）

使用 [w64devkit](https://github.com/skeeto/w64devkit) 2.11.0 便携包，包含 `gcc`、`g++`、`gdb`、`ar`、`make` 等工具。

```powershell
$sfx = Join-Path $env:TEMP 'w64devkit-x64-2.11.0.7z.exe'
curl.exe -L --fail --ssl-no-revoke -o $sfx `
  'https://github.com/skeeto/w64devkit/releases/download/v2.11.0/w64devkit-x64-2.11.0.7z.exe'

& $sfx -y -o"D:\tools"
```

解压后目录应为 `D:\tools\w64devkit\bin`。把它追加到用户 PATH：

```powershell
$mingwBin = 'D:\tools\w64devkit\bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($userPath -split ';' | Where-Object { $_ -ne '' })
if (-not ($parts | Where-Object { $_.TrimEnd('\') -ieq $mingwBin.TrimEnd('\') })) {
    [Environment]::SetEnvironmentVariable('Path', (($parts + $mingwBin) -join ';'), 'User')
}
```

扩展的 `MAKE` 程序名默认为 `mingw32-make.exe`；若 w64devkit 只提供 `make.exe`，复制一份兼容别名：

```powershell
if (-not (Test-Path (Join-Path $mingwBin 'mingw32-make.exe'))) {
    Copy-Item (Join-Path $mingwBin 'make.exe') (Join-Path $mingwBin 'mingw32-make.exe')
}
```

> w64devkit 使用静态 libgcc，未随包提供 `libgcc_eh.a`。仓库自带 LLVM/clang 做原生 MinGW 链接时会查找它（`test:e2e` 的 S4）；若报 `unable to find library -lgcc_eh`，把 `libgcc.a` 复制为 `libgcc_eh.a` 即可：
>
> ```powershell
> $gccLib = Get-ChildItem 'D:\tools\w64devkit\lib\gcc\x86_64-w64-mingw32' -Directory | Select-Object -First 1
> if ($gccLib -and -not (Test-Path (Join-Path $gccLib.FullName 'libgcc_eh.a'))) {
>     Copy-Item (Join-Path $gccLib.FullName 'libgcc.a') (Join-Path $gccLib.FullName 'libgcc_eh.a')
> }
> ```

验证（新开终端，或先把 `mingwBin` **追加**到 PATH 末尾）：

```powershell
$env:Path = $env:Path + ";$mingwBin"
gcc --version
g++ --version
gdb --version
ar --version
make --version
mingw32-make --version
```

### 3.1 PATH 生效说明

- 修改用户 PATH 只影响**新进程**；当前 VS Code、集成终端和扩展宿主仍持有旧环境。
- 安装完成后需要**完全重启 VS Code**（不是仅新建窗口）。
- **PATH 顺序**：把 `w64devkit\bin` 追加到 PATH **末尾**，让 `C:\Windows\System32` 保持在前面；否则 w64devkit 自带的 `ping.exe` 等 BusyBox 工具会覆盖 Windows 同名命令，导致部分测试（如进程树快照）失败。Node 目录放在前面或末尾均可（不会与系统命令同名）。
- 在当前自动化会话中验证时，命令前显式拼接：
  `$env:Path = "D:\tools\node;" + $env:Path + ";D:\tools\w64devkit\bin"`
  或使用绝对路径调用 `node.exe` / `npm.cmd` / `gcc.exe`。

## 4. 恢复依赖与构建

```powershell
npm.cmd ci
npm.cmd run compile
npm.cmd run bundle
npm.cmd run bundle:search
```

产物：

- `dist/`：tsc 编译产物，无头测试使用。
- `bundle/extension.js`：esbuild 单文件入口（`package.json` 的 `main`）。
- `bundle/search-worker.js`：工程搜索 worker。

## 5. 分层测试

按需运行：

```powershell
npm.cmd run test:contract   # L-1 静态契约
npm.cmd test                # L0 无头单元/集成
npm.cmd run test:e2e        # L1 真实工具链 E2E
npm.cmd run test:pack       # L5 打包与安装冒烟
npm.cmd run test:host       # L2 真实 VS Code 宿主
```

说明：

- `test:e2e` 在本机缺少 MSP430、SDCC 等可选工具链时会打印 `SKIP` 原因，**不判失败**；w64devkit 提供原生 gcc/g++/ar/gdb 与 ccache，原生场景应实际执行。
- `test:host` 默认复用 `.vscode-test/` 中缓存的 VS Code；首次运行或缓存损坏时会重新下载。
- `test:host` 会先通过 `pretest:host` 构建 `bundle/extension.js` 与 `bundle/search-worker.js`，干净检出后可直接运行，不依赖先前的手工构建。
- 视觉/性能层不在默认开发流程内；需要时使用 `npm run test:visual` / `npm run test:perf`，并参考 [分层测试方案](../testing/strategy.md)。
- **视觉基线跨机**：`tests/visual/baselines` 中的基线来自另一台机器，本机指纹不同 → 自动走**跨环境容差**分支并逐条标注 `OK(P)`，属预期。确认界面真变了才刷新基线：`npm run visual:baseline`（指纹不匹配时只写 `.cb-tools/visual/<指纹>/`，需 `--canonical` 才改入库基线）。

## 6. VS Code 开发与调试

1. 完全重启 VS Code，让用户 PATH 生效（仅新建窗口不会刷新扩展宿主环境）。
2. 打开仓库根目录。
3. 按 `F5`，VS Code 会运行 `build-extension` 任务（compile + bundle + bundle:search），然后启动 **Extension Development Host**。
4. 也可直接使用：

```powershell
code.cmd --extensionDevelopmentPath="." --disable-extensions --new-window
```

手工冒烟：

1. 在扩展开发宿主中打开 `test-project/hello-cb.cbp`。
2. 状态栏确认检测到 GCC/MinGW 编译器。
3. `Ctrl+F9` 构建，`F9` 运行，`F5` 启动 GDB 调试并验证断点/变量。

### 6.1 打包与安装（VSIX）

```powershell
npm.cmd run package                                   # = vsce package（自动 compile + bundle + bundle:search）
code.cmd --install-extension codeblocks-vscode-0.8.160.vsix --force
code.cmd --list-extensions --show-versions | Select-String codeblocks
```

- `.vscodeignore` 已排除 `src/`、`tests/`、`test-project/`、`docs/`、`.github/`、`.vscode/`、`.nvmrc`、`*.map`、`package-lock.json`；VSIX 入口只有 `bundle/extension.js`。
- 安装后**重载窗口**生效；重复安装同版本需带 `--force`。

## 7. 常见问题

**终端里找不到 `node` / `gcc`**

- 用户 PATH 只对新进程生效；完全退出并重启 VS Code。
- 当前终端可临时执行：
  ```powershell
  $env:Path = "D:\tools\node;" + $env:Path + ";D:\tools\w64devkit\bin"
  ```

**PowerShell 提示无法加载 `npm.ps1`**

- 使用 `npm.cmd` / `npx.cmd`，或调整执行策略：
  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

**扩展状态栏未检测到编译器**

- 设置 `codeblocks.masterPath` 为 `D:\tools\w64devkit`，然后重新加载窗口。
- 或在设置 `codeblocks.compilerPrograms` 中显式填写 `gcc.exe` / `g++.exe` / `gdb.exe` 路径。

**GDB 启动失败**

- 确认 `gdb.exe` 在 PATH 中，或通过 `codeblocks.debug.gdbPath` / `codeblocks.compilerPrograms` 指定绝对路径。
- 现代 GDB 的 MI 协议与扩展兼容；若遇到旧版/异常构建，优先使用 w64devkit 自带 GDB。

**宿主测试下载 VS Code 失败**

- 删除 `.vscode-test/vscode-win32-x64-archive-*` 后重跑 `npm run test:host`。
- 或设置 `CB_VSCODE_PATH` 指向本机 VS Code 安装目录。

## 8. 可选组件

- **ccache / sccache**：w64devkit 2.11.0 已自带 **ccache 4.14.1**，无需额外安装；用于 `codeblocks.build.compilerCache` 与 ccache E2E。
- **clangd**：仓库 `.cb-tools/toolchains/llvm/bin` 已含 **clangd 23.1.3**；该目录已加入用户 PATH，宿主 D-10 用例不再 SKIP。
- **Playwright Chromium**：视觉回归默认使用系统 Edge；如需固定 Chromium，执行 `npx playwright install chromium` 并设置 `CB_VISUAL_BROWSER=chromium`。
- **交叉工具链**：AVR / RISC-V / LLVM / TCC / MSP430 / SDCC 已解包到 `.cb-tools/toolchains/<name>/`（已 gitignore），测试自动探测；其中 MSP430 为 **4.6.3**（PlatformIO `toolchain-timsp430`），SDCC 为 **4.6.4 #17226**（SourceForge nightly），均无需修改系统 PATH。

## 9. 依赖安全（npm audit）

- `fast-xml-parser` 升级到 **5.12.1**，修复低危 `GHSA-474x-hrwr-fgx4`。
- `@vscode/vsce` 升级到 **4.1.1**；`overrides.minimatch` 固定 **11.0.9**，修复中危 `GHSA-g3hv-75wg-m249`。
- 剩余 **4 个 high** 均来自开发期打包工具链 `@vscode/vsce → tinyglobby → fdir/picomatch`；截至当前无可用修复版本（`picomatch <=4.0.7`、`fdir >=5.2.1`、`tinyglobby *`）。它们**不进入扩展运行时**；`npm audit fix --force` 会降级 vsce 到 3.9.1（引入 keytar 原生依赖），不建议。
- `npm audit --omit=dev` 为 0：全部剩余项都是 `devDependencies` 的传递依赖。

## 10. 版本基线

| 组件 | 版本 |
|------|------|
| Node.js | v24.22.3 LTS |
| npm | 11.19.1 |
| w64devkit | 2.11.0 |
| VS Code | `>= 1.85`（本机 1.140.0） |
| TypeScript | 5.9.3（lock） |
| esbuild | 0.28.2（lock） |
| fast-xml-parser | 5.12.1（lock） |
| @vscode/vsce | 4.1.1（dev） |
| clangd | 23.1.3（`.cb-tools/toolchains/llvm/bin`） |
| MSP430 GCC | 4.6.3（`.cb-tools/toolchains/msp430`） |
| SDCC | 4.6.4 #17226（`.cb-tools/toolchains/sdcc`） |

相关配置：[.vscode/settings.json](../../.vscode/settings.json)、[.vscode/tasks.json](../../.vscode/tasks.json)、[.vscode/launch.json](../../.vscode/launch.json)。
