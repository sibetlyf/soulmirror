# ui.ps1 — Windows 桌面 UI 自动化（UIAutomation + SendKeys），供 dsh-meeting-agent 调用。
# 用法（必须用 -File 调用）：
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File ui.ps1 list
#   powershell.exe ... -File ui.ps1 focus  -title 腾讯会议
#   powershell.exe ... -File ui.ps1 dump   -title 腾讯会议 [-max 60]
#   powershell.exe ... -File ui.ps1 click  -title 腾讯会议 -name 加入会议
#   powershell.exe ... -File ui.ps1 settext -title 腾讯会议 -name 会议号 -value 123456789
#   powershell.exe ... -File ui.ps1 key    -title 腾讯会议 -keys "ctrl+m"
#   powershell.exe ... -File ui.ps1 type   -title 腾讯会议 -text "hello"
param(
  [Parameter(Position=0)][string]$cmd = 'list',
  [string]$title = '',
  [string]$cls = '',
  [string]$proc = '',
  [string]$name = '',
  [string]$value = '',
  [string]$text = '',
  [string]$keys = '',
  [int]$max = 40,
  [int]$x = 0,
  [int]$width = 0,
  [int]$height = 0,
  [string]$out = '',
  [int]$y = 0,
  [switch]$json
)

$ErrorActionPreference = 'Stop'

# 多显示器 + 缩放环境下，必须 DPI 感知，否则坐标与鼠标位置不同尺度
try {
  Add-Type -Namespace W32Dpi -Name Native -MemberDefinition @'
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
'@ -ErrorAction Stop
  [W32Dpi.Native]::SetProcessDpiAwarenessContext([IntPtr]-4) | Out-Null
} catch { try { [W32Dpi.Native]::SetProcessDPIAware() | Out-Null } catch { } }
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W32 {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint dx, uint dy, uint d, IntPtr e);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
}
"@

function Get-Root { [System.Windows.Automation.AutomationElement]::RootElement }

function Rect-Text {
  param($r)
  if ([double]::IsInfinity($r.Width) -or [double]::IsInfinity($r.Height) -or $r.Width -lt 0 -or $r.Height -lt 0) {
    return "0x0`t0,0"
  }
  return ("{0}x{1}`t{2},{3}" -f [int]$r.Width, [int]$r.Height, [int]$r.Left, [int]$r.Top)
}

function Find-Window {
  param([string]$substr, [string]$clsFrag = '', [string]$procName = '')
  $wins = (Get-Root).FindAll([System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  $cands = @()
  $procCache = @{}
  foreach ($w in $wins) {
    $n = $w.Current.Name
    $c = $w.Current.ClassName
    if ([string]::IsNullOrEmpty($n) -and [string]::IsNullOrEmpty($c)) { continue }
    $okTitle = $substr -and $n -and $n -like "*$substr*"
    $okClass = $false
    if ($clsFrag) {
      foreach ($f in $clsFrag.Split('|')) {
        if ($f -and $c -and $c -like "*$f*") { $okClass = $true; break }
      }
    }
    if (-not ($okTitle -or $okClass)) { continue }
    if ($procName) {
      $p = $w.Current.ProcessId
      if (-not $procCache.ContainsKey($p)) {
        $procCache[$p] = ''
        try { $procCache[$p] = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { }
      }
      if ($procCache[$p] -ne $procName) { continue }
    }
    $cands += $w
  }
  if ($cands.Count -eq 0) { return $null }
  if ($substr) {
    $exact = @($cands | Where-Object { $_.Current.Name -eq $substr })
    if ($exact.Count -gt 0) { $cands = $exact }
  }
  $best = $cands[0]; $bestArea = -1
  foreach ($c in $cands) {
    $r = $c.Current.BoundingRectangle
    if ([double]::IsInfinity($r.Width)) { continue }
    $a = $r.Width * $r.Height
    if ($a -gt $bestArea) { $bestArea = $a; $best = $c }
  }
  return $best
}

function Invoke-ClickElement {
  param($el)
  $p = $null
  if ($el.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$p)) {
    $p.Invoke(); return 'invoke'
  }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$p)) {
    $p.Toggle(); return 'toggle'
  }
  if ($el.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$p)) {
    $p.Select(); return 'select'
  }
  $r = $el.Current.BoundingRectangle
  if ($r.Width -le 0 -or $r.Height -le 0) { return 'no-rect' }
  $x = [int]($r.Left + $r.Width / 2); $y = [int]($r.Top + $r.Height / 2)
  [W32]::SetCursorPos($x, $y) | Out-Null
  Start-Sleep -Milliseconds 60
  [W32]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)  # LEFTDOWN
  Start-Sleep -Milliseconds 40
  [W32]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)  # LEFTUP
  return 'mouse'
}

function Focus-Window {
  param($w)
  $h = [IntPtr]$w.Current.NativeWindowHandle
  if ($h -eq [IntPtr]::Zero) { return }
  if ([W32]::IsIconic($h)) { [W32]::ShowWindow($h, 9) | Out-Null; Start-Sleep -Milliseconds 150 }
  # SetForegroundWindow 直接被拒是常态：把本线程挂到当前前台线程上再抢
  for ($try = 0; $try -lt 3; $try++) {
    [W32]::SetForegroundWindow($h) | Out-Null
    [W32]::BringWindowToTop($h) | Out-Null
    $fg = [W32]::GetForegroundWindow()
    if ($fg -eq $h) { break }
    $pidFg = 0
    $tidFg = [W32]::GetWindowThreadProcessId($fg, [ref]$pidFg)
    $tidMe = [W32]::GetCurrentThreadId()
    if ($tidFg -ne 0 -and $tidFg -ne $tidMe) {
      [W32]::AttachThreadInput($tidMe, $tidFg, $true) | Out-Null
      [W32]::SetForegroundWindow($h) | Out-Null
      [W32]::AttachThreadInput($tidMe, $tidFg, $false) | Out-Null
    }
    Start-Sleep -Milliseconds 120
  }
  Start-Sleep -Milliseconds 200
}

function Send-Keys {
  param([string]$k)
  $map = @{ 'ctrl'='^'; 'alt'='%'; 'shift'='+'; 'win'='#';
            'enter'='{ENTER}'; 'return'='{ENTER}'; 'esc'='{ESC}'; 'escape'='{ESC}';
            'tab'='{TAB}'; 'space'=' '; 'backspace'='{BACKSPACE}'; 'delete'='{DELETE}';
            'up'='{UP}'; 'down'='{DOWN}'; 'left'='{LEFT}'; 'right'='{RIGHT}';
            'home'='{HOME}'; 'end'='{END}'; 'pageup'='{PGUP}'; 'pagedown'='{PGDN}' }
  $parts = $k -split '\+'
  $out = ''
  for ($i = 0; $i -lt $parts.Length; $i++) {
    $p = $parts[$i].Trim().ToLower()
    if ($i -lt $parts.Length - 1 -and $map.ContainsKey($p)) { $out += $map[$p] }
    elseif ($map.ContainsKey($p)) { $out += $map[$p] }
    else { $out += $p }
  }
  [System.Windows.Forms.SendKeys]::SendWait($out)
}

function Escape-SendKeysText {
  param([string]$s)
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $s.ToCharArray()) {
    switch -regex ($ch) {
      '[+^%~(){}\[\]]' { [void]$sb.Append('{' + $ch + '}'); break }
      default { [void]$sb.Append($ch) }
    }
  }
  return $sb.ToString()
}

switch ($cmd) {
  'list' {
    $wins = (Get-Root).FindAll([System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    $names = @{}
    foreach ($w in $wins) {
      $n = $w.Current.Name
      if ([string]::IsNullOrEmpty($n)) { continue }
      $p = $w.Current.ProcessId
      if (-not $names.ContainsKey($p)) {
        $names[$p] = ''
        try { $names[$p] = (Get-Process -Id $p -ErrorAction Stop).ProcessName } catch { }
      }
      $cls = $w.Current.ClassName
      "{0}`t{1}`t{2}`t{3}`t{4}" -f $p, $names[$p], $cls, $n, (Rect-Text $w.Current.BoundingRectangle)
    }
  }
  'focus' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    Focus-Window $w
    "OK focused " + $w.Current.Name
  }
  'dump' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    "window`t" + $w.Current.Name + "`telements`t" + $all.Count
    $i = 0
    foreach ($e in $all) {
      if ($i -ge $max) { break }
      $c = $e.Current
      "{0}`t{1}`t{2}`t{3}`t{4}" -f $i, $c.ControlType.ProgrammaticName.Replace('ControlType.',''),
        $c.Name, $c.AutomationId, (Rect-Text $c.BoundingRectangle)
      $i++
    }
  }
  'shot' {
    # 用 PrintWindow 直接渲染窗口内容：即使被别的窗口盖住也能截到
    if (-not $out) { Write-Error "shot needs -out"; exit 2 }
    Add-Type -AssemblyName System.Drawing
    if ($title -or $cls -or $proc) {
      $w = Find-Window $title $cls $proc
      if (-not $w) { Write-Error "window not found: $title"; exit 3 }
      $hwnd = [IntPtr]$w.Current.NativeWindowHandle
      $rc = New-Object W32+RECT
      [W32]::GetWindowRect($hwnd, [ref]$rc) | Out-Null
      $width = $rc.Right - $rc.Left
      $height = $rc.Bottom - $rc.Top
      if ($width -le 0 -or $height -le 0) { Write-Error "window has no size"; exit 2 }
      $bmp = New-Object System.Drawing.Bitmap $width, $height
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $hdc = $g.GetHdc()
      # flags=2: PW_RENDERFULLCONTENT，Qt/DWM 窗口必须用这个
      $ok = [W32]::PrintWindow($hwnd, $hdc, 2)
      $g.ReleaseHdc($hdc)
      $g.Dispose()
      if (-not $ok) { $bmp.Dispose(); Write-Error "PrintWindow failed"; exit 4 }
    } else {
      if ($width -le 0 -or $height -le 0) { Write-Error "shot needs window or -width/-height"; exit 2 }
      $bmp = New-Object System.Drawing.Bitmap $width, $height
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $width, $height))
      $g.Dispose()
    }
    $dir = Split-Path -Parent $out
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    $bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    "OK shot $out ${width}x${height}"
  }
  'rect' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    # Find-Window 返回 AutomationElement，需要转成窗口句柄
    $hwnd = [IntPtr]$w.Current.NativeWindowHandle
    $r = New-Object W32+RECT
    [W32]::GetClientRect($hwnd, [ref]$r) | Out-Null
    $pt = New-Object W32+POINT
    [W32]::ClientToScreen($hwnd, [ref]$pt) | Out-Null
    "OK rect $($pt.X),$($pt.Y) $($r.Right - $r.Left)x$($r.Bottom - $r.Top)"
  }
  'clickxy' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    $hwnd = [IntPtr]$w.Current.NativeWindowHandle
    Focus-Window $w
    # 目标窗口可能被全屏应用或置顶窗口盖住：临时提到最上层再点
    $SWP_NOSIZE = 0x0001; $SWP_NOMOVE = 0x0002; $SWP_SHOWWINDOW = 0x0040
    $flags = $SWP_NOSIZE -bor $SWP_NOMOVE -bor $SWP_SHOWWINDOW
    [W32]::SetWindowPos($hwnd, [IntPtr](-1), 0, 0, 0, 0, $flags) | Out-Null
    Start-Sleep -Milliseconds 180
    [W32]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 80
    [W32]::mouse_event(0x0002, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 40
    [W32]::mouse_event(0x0004, 0, 0, 0, [IntPtr]::Zero)
    Start-Sleep -Milliseconds 120
    # 恢复普通层级，别把用户的窗口一直钉在最上面
    [W32]::SetWindowPos($hwnd, [IntPtr](-2), 0, 0, 0, 0, $flags) | Out-Null
    "OK clickxy $x,$y"
  }
  'click' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    Focus-Window $w
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, $name)
    $el = $w.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if (-not $el) {
      $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
      foreach ($e in $all) {
        $n = $e.Current.Name
        $aid = $e.Current.AutomationId
        if (($n -and $n -like "*$name*") -or ($aid -and $aid -like "*$name*")) { $el = $e; break }
      }
    }
    if (-not $el) { Write-Error "element not found: $name"; exit 4 }
    $how = Invoke-ClickElement $el
    "OK click " + $how + " " + $el.Current.Name
  }
  'settext' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    Focus-Window $w
    $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants,
      [System.Windows.Automation.Condition]::TrueCondition)
    $el = $null
    foreach ($e in $all) {
      $n = $e.Current.Name
      $aid = $e.Current.AutomationId
      if (($n -and $n -like "*$name*") -or ($aid -and $aid -like "*$name*")) { $el = $e; break }
    }
    if (-not $el) { Write-Error "element not found: $name"; exit 4 }
    $p = $null
    if ($el.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
      $p.SetValue($value)
      "OK settext (value pattern) " + $el.Current.Name
    } else {
      Invoke-ClickElement $el | Out-Null
      Start-Sleep -Milliseconds 120
      [System.Windows.Forms.SendKeys]::SendWait('^a')
      [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText $value))
      "OK settext (keystrokes) " + $el.Current.Name
    }
  }
  'key' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    Focus-Window $w
    Send-Keys $keys
    "OK key " + $keys
  }
  'type' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    Focus-Window $w
    [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeysText $text))
    "OK typed " + $text.Length + " chars"
  }
  'restore' {
    $w = Find-Window $title $cls $proc
    if (-not $w) { Write-Error "window not found: $title"; exit 3 }
    $h = [IntPtr]$w.Current.NativeWindowHandle
    [W32]::ShowWindow($h, 9) | Out-Null
    Start-Sleep -Milliseconds 200
    $r = New-Object W32+RECT
    [W32]::GetWindowRect($h, [ref]$r) | Out-Null
    $visL = [System.Windows.Forms.SystemInformation]::VirtualScreen.Left
    $visT = [System.Windows.Forms.SystemInformation]::VirtualScreen.Top
    $visR = $visL + [System.Windows.Forms.SystemInformation]::VirtualScreen.Width
    $visB = $visT + [System.Windows.Forms.SystemInformation]::VirtualScreen.Height
    $off = ($r.Left -lt $visL) -or ($r.Top -lt $visT) -or ($r.Left -gt ($visR - 200)) -or ($r.Top -gt ($visB - 200))
    if ($off) {
      $mw = [Math]::Min(1200, $visR - $visL - 80)
      $mh = [Math]::Min(800, $visB - $visT - 80)
      [W32]::MoveWindow($h, ($visL + 40), ($visT + 40), $mw, $mh, $true) | Out-Null
      Start-Sleep -Milliseconds 300
      "moved on-screen"
    }
    [W32]::SetForegroundWindow($h) | Out-Null
    Start-Sleep -Milliseconds 300
    "OK restored " + $w.Current.Name
  }
  default { Write-Error "unknown command: $cmd"; exit 2 }
}
