# README 截图与动图

用于重录 `docs/images/` 下的 5 张静态图与 1 张动图。产物只进 GitHub，不进 VSIX（`.vscodeignore` 已排除 `tools/**`）。

## 前置

- Windows，VS Code 已安装当前 VSIX（`code --install-extension release/originium-ide-<version>.vsix --force`）。
- `test-project/bin/Debug/hello.exe` 存在（否则先跑一次 `npm run test:e2e`）。
- 关闭会抢焦点的窗口；截图期间不要移动鼠标。

## 演示工作区

```powershell
powershell -ExecutionPolicy Bypass -File tools/screenshots/prepare-demo.ps1
code --new-window --disable-workspace-trust E:\Originium-Demo\test-project
```

脚本会复制 `test-project` 并写入固定主题/缩放/隐藏干扰项的 `.vscode/settings.json`，避免截图里出现用户名路径。

## 镜头表

| 文件 | 画面 | 操作要点 |
|---|---|---|
| `detect-open-projects.png` | 启动检测对话框，4 项全选 | `Down`/`Space` 依次勾选，Enter 前截图 |
| `project-tree.png` | 工程树 + `main.c` + 空 Build Log | 点活动栏菱形图标 → 展开 Sources → `Ctrl+P` 打开 `main.c` → 点 Build Log 标签 |
| `build-log.png` | 一次成功的 Rebuild 日志 | 编辑器内 `Ctrl+F11` → 确认对话框 → 完成后截图 |
| `cb-menu.png` | 状态栏 `Menu` 打开的主菜单 | 点左下角 `Ξ Menu` |
| `cb-build-menu.png` | Build 子菜单 | 主菜单里选 `Build`，清空过滤词 |

截图脚本（DPI 感知，只抓窗口区域）：

```powershell
. tools/screenshots/capture.ps1
$h = Find-CodeWindow '*test-project*'
Focus-CodeWindow $h
Save-WindowShot $h 'shot.png'
Invoke-CodeClick $h 24 87        # 活动栏第 3 个图标（Code::Blocks）
Send-CodeKeys '^+p' 600
```

抓到的整窗图先裁掉 11px 阴影边，再裁到 1920×1010：

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("$PWD\shot.png")
$bmp = New-Object System.Drawing.Bitmap 1920,1010
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.DrawImage($src, (New-Object System.Drawing.Rectangle 0,0,1920,1010), (New-Object System.Drawing.Rectangle 16,16,1920,1010), [System.Drawing.GraphicsUnit]::Pixel)
$bmp.Save("$PWD\docs\images\project-tree.png", [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose(); $src.Dispose()
```

## 动图

以「空闲 → 主菜单 → Build 子菜单 → 构建完成日志」四帧为例：

```powershell
cd tools/screenshots
npm install
node encode-gif.js ..\..\docs\images\build-tour.gif f00-idle.png f01-menu.png f03-build-menu.png final-build.png
```

输出 900px 宽、每帧 1.2s。动图只用于 README，不参与测试。
