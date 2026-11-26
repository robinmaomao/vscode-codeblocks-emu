# 生成 README 截图用的演示工作区（独立于本仓库，避免截图里出现用户名路径）。
# 用法：powershell -ExecutionPolicy Bypass -File tools/screenshots/prepare-demo.ps1 [-Destination E:\Originium-Demo]
param(
  [string]$Destination = 'E:\Originium-Demo'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$source = Join-Path $repo 'test-project'

if (-not (Test-Path $source)) { throw "test-project not found: $source" }
if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
New-Item -ItemType Directory $Destination | Out-Null
Copy-Item $source (Join-Path $Destination 'test-project') -Recurse

$workspace = Join-Path $Destination 'test-project'
New-Item -ItemType Directory (Join-Path $workspace '.vscode') -Force | Out-Null
@'
{
  "workbench.colorTheme": "Default Dark Modern",
  "workbench.startupEditor": "none",
  "workbench.secondarySideBar.defaultVisibility": "hidden",
  "workbench.tips.enabled": false,
  "window.zoomLevel": -1,
  "window.commandCenter": false,
  "editor.minimap.enabled": false,
  "breadcrumbs.enabled": false,
  "editor.inlayHints.enabled": "off",
  "editor.parameterHints.enabled": false,
  "telemetry.telemetryLevel": "off",
  "update.mode": "none",
  "extensions.autoCheckUpdates": false,
  "security.workspace.trust.enabled": false,
  "git.enabled": false,
  "git.decorations.enabled": false,
  "codeblocks.compilerId": "gcc",
  "codeblocks.build.compilerCache": false
}
'@ | Set-Content -Encoding utf8 (Join-Path $workspace '.vscode\settings.json')

$exe = Join-Path $workspace 'bin\Debug\hello.exe'
if (-not (Test-Path $exe)) {
  Write-Warning "hello.exe missing: run 'npm run test:e2e' in the repo, or build test-project once, before capturing."
}

Write-Host "demo workspace: $workspace"
Write-Host "open with: code --new-window --disable-workspace-trust `"$workspace`""
