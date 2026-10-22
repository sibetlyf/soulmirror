# hold.ps1 — 按住/松开按键（腾讯会议"长按空格发言"）
# 用法：
#   powershell -File hold.ps1 down -title 腾讯会议
#   powershell -File hold.ps1 up
param(
  [Parameter(Position=0)][string]$cmd = 'down',
  [string]$title = '腾讯会议',
  [string]$cls = 'BaseDialog',
  [string]$proc = 'wemeetapp'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32H {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
}
"@

$VK_SPACE = 0x20
$KEYUP = 2

if ($cmd -eq 'up') {
  [W32H]::keybd_event([byte]$VK_SPACE, [byte]0, [uint32]$KEYUP, [UIntPtr]::Zero)
  "OK up"
  exit 0
}

$root = [System.Windows.Automation.AutomationElement]::RootElement
$wins = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$best = $null; $bestArea = -1
foreach ($w in $wins) {
  $n = $w.Current.Name
  $c = $w.Current.ClassName
  if (-not $n) { continue }
  if ($n -notlike "*$title*" -and $c -notlike "*$cls*") { continue }
  $r = $w.Current.BoundingRectangle
  if ([double]::IsInfinity($r.Width)) { continue }
  $a = $r.Width * $r.Height
  if ($a -gt $bestArea) { $bestArea = $a; $best = $w }
}
if (-not $best) { Write-Error "window not found: $title"; exit 3 }

$h = [IntPtr]$best.Current.NativeWindowHandle
if ([W32H]::IsIconic($h)) { [W32H]::ShowWindow($h, 9) | Out-Null }
[W32H]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 200

[W32H]::keybd_event([byte]$VK_SPACE, [byte]0, [uint32]0, [UIntPtr]::Zero)
"OK down (" + $best.Current.Name + ")"
