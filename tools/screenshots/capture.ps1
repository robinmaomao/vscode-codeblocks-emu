# 截取当前屏幕上的 VS Code 窗口（只抓窗口区域，自动置前/最大化）。
# 依赖：Windows PowerShell 5.1+ / PowerShell 7，无需第三方包。
# 用法：
#   . tools/screenshots/capture.ps1
#   $h = Find-CodeWindow '*test-project*'
#   Focus-CodeWindow $h
#   Save-WindowShot $h 'shot.png'
#   Invoke-CodeClick $h 24 87          # 点击窗口内坐标（24,87）
#   Send-CodeKeys '{ENTER}' 500        # 发送按键并等待 500ms

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class OriginiumWin {
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  public delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
[void][OriginiumWin]::SetProcessDpiAwarenessContext([IntPtr]::new(-4))
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

function Find-CodeWindow([string]$Pattern) {
  $script:codeWindow = [IntPtr]::Zero
  $cb = [OriginiumWin+EnumWindowsProc] {
    param($h, $l)
    if ([OriginiumWin]::IsWindowVisible($h)) {
      $sb = New-Object System.Text.StringBuilder 512
      [void][OriginiumWin]::GetWindowText($h, $sb, 512)
      if ($sb.ToString() -like $Pattern) { $script:codeWindow = $h }
    }
    return $true
  }
  [void][OriginiumWin]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:codeWindow
}

function Focus-CodeWindow([IntPtr]$Hwnd) {
  [void][OriginiumWin]::ShowWindow($Hwnd, 3)
  [void][OriginiumWin]::SetForegroundWindow($Hwnd)
  Start-Sleep -Milliseconds 700
}

function Save-WindowShot([IntPtr]$Hwnd, [string]$Path) {
  $r = New-Object OriginiumWin+RECT
  [void][OriginiumWin]::GetWindowRect($Hwnd, [ref]$r)
  $bmp = New-Object System.Drawing.Bitmap ($r.Right - $r.Left), ($r.Bottom - $r.Top)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
  return $Path
}

function Invoke-CodeClick([IntPtr]$Hwnd, [int]$X, [int]$Y, [switch]$Right) {
  $r = New-Object OriginiumWin+RECT
  [void][OriginiumWin]::GetWindowRect($Hwnd, [ref]$r)
  [void][OriginiumWin]::SetCursorPos(($r.Left + $X), ($r.Top + $Y))
  Start-Sleep -Milliseconds 150
  if ($Right) {
    [OriginiumWin]::mouse_event(0x0008, 0, 0, 0, [IntPtr]::Zero)
    [OriginiumWin]::mouse_event(0x0010, 0, 0, 0, [IntPtr]::Zero)
  } else {
    [OriginiumWin]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    [OriginiumWin]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
  }
}

function Send-CodeKeys([string]$Keys, [int]$DelayMs = 400) {
  [System.Windows.Forms.SendKeys]::SendWait($Keys)
  Start-Sleep -Milliseconds $DelayMs
}
