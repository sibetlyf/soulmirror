<#
.SYNOPSIS
  dsh-meeting-agent 能力自测脚本（Windows）

.DESCRIPTION
  逐项验证插件依赖的真实能力，最后给出 PASS/SKIP/FAIL 汇总。
  默认只做"无声"测试（声音只走虚拟设备，不会打扰会议）；
  加 -Live 秒数 才真采会议声音，加 -Say 才会真的向会议播报。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\test-meeting-agent.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\test-meeting-agent.ps1 -Live 30

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\test-meeting-agent.ps1 -Say "大家好，我是会议助手" -MicRestore "麦克风阵列 (适用于数字麦克风的英特尔® 智音技术)"
#>
param(
  [int]$Live = 0,
  [string]$Say = '',
  [string]$ProcessName = 'wemeetapp',
  [string]$SpeakDevice = 'CABLE Input',
  [string]$MicRestore = ''
)

$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $PSScriptRoot
$mb = Join-Path $root 'tools\mbridge.exe'
$ui = Join-Path $root 'tools\ui.ps1'
$whisper = Join-Path $root 'tools\whisper\Release\whisper-cli.exe'
$model = Join-Path $root 'tools\whisper\models\ggml-base.bin'
$work = Join-Path $root '.test-out'
New-Item -ItemType Directory -Force -Path $work | Out-Null

$script:results = @()
$script:skips = @()

function Add-Result([string]$name, [bool]$ok, [string]$detail) {
  $script:results += [pscustomobject]@{ Name = $name; Ok = $ok; Detail = $detail }
  $tag = '[PASS]'
  $color = 'Green'
  if (-not $ok) { $tag = '[FAIL]'; $color = 'Red' }
  if ($detail) { Write-Host ("  {0} {1}  - {2}" -f $tag, $name, $detail) -ForegroundColor $color }
  else { Write-Host ("  {0} {1}" -f $tag, $name) -ForegroundColor $color }
}

function Add-Skip([string]$name, [string]$detail) {
  $script:skips += [pscustomobject]@{ Name = $name; Detail = $detail }
  Write-Host ("  [SKIP] {0}  - {1}" -f $name, $detail) -ForegroundColor DarkYellow
}

function Section([string]$t) { Write-Host "`n=== $t" -ForegroundColor Cyan }

function Run([string]$exe, [string[]]$callArgs) {
  $out = & $exe @callArgs 2>&1 | Out-String
  return $out.Trim()
}

function Get-Rms([string]$wav) {
  $o = Run $mb @('rms', '--file', $wav)
  $m = [regex]::Match($o, 'RMS\s+([0-9.]+)')
  if ($m.Success) { return [double]$m.Groups[1].Value }
  return -1
}

Write-Host "dsh-meeting-agent 自测 - $root" -ForegroundColor Yellow
Write-Host ("PowerShell {0} - {1}" -f $PSVersionTable.PSVersion, (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) -ForegroundColor DarkGray

# 1. 依赖
Section '1. 依赖文件'
Add-Result 'mbridge.exe' (Test-Path $mb) $mb
Add-Result 'whisper-cli.exe' (Test-Path $whisper) $whisper
Add-Result 'ggml-base.bin' (Test-Path $model) $(if (Test-Path $model) { "{0:N1} MB" -f ((Get-Item $model).Length / 1MB) } else { 'missing' })
Add-Result 'ui.ps1' (Test-Path $ui) $ui

# 2. 音频端点
Section '2. 音频端点'
$devText = Run $mb @('devices')
$devLines = @($devText -split "`n" | Where-Object { $_.Trim() })
$renders = @($devLines | Where-Object { $_ -like 'RENDER*' })
$captures = @($devLines | Where-Object { $_ -like 'CAPTURE*' })
Add-Result '渲染端点' ($renders.Count -gt 0) ("{0} 个" -f $renders.Count)
Add-Result '采集端点' ($captures.Count -gt 0) ("{0} 个" -f $captures.Count)
$hasCable = [bool]($devText -match 'CABLE Input')
Add-Result '虚拟声卡 VB-CABLE' $hasCable $(if ($hasCable) { 'CABLE Input / CABLE Output' } else { '未安装，发言链路不可用' })

# 3. 实时电平
Section '3. 实时电平（此刻有没有声音）'
$meters = Run $mb @('meters')
Write-Host $meters -ForegroundColor DarkGray
$maxPeak = 0.0
foreach ($line in ($meters -split "`n")) {
  $m = [regex]::Match($line, '\t([0-9.]+)')
  if ($m.Success) {
    $v = [double]$m.Groups[1].Value
    if ($v -gt $maxPeak) { $maxPeak = $v }
  }
}
$levelNote = '（当前静音，正常）'
if ($maxPeak -ge 0.004) { $levelNote = '（当前有声音）' }
Add-Result '电平采样' $true ("最大峰值 {0:F4}{1}" -f $maxPeak, $levelNote)

# 4. TTS
Section '4. TTS 合成（SAPI 离线）'
$ttsWav = Join-Path $work 'tts.wav'
Remove-Item ($ttsWav + '.txt') -Force -ErrorAction SilentlyContinue
Remove-Item $ttsWav -Force -ErrorAction SilentlyContinue
$ttsOut = Run $mb @('tts', '--text', '大家好，我是会议助手，正在测试语音合成。', '--out', $ttsWav, '--voice', 'Microsoft Huihui Desktop')
$ttsOk = $false
if ((Test-Path $ttsWav) -and ((Get-Item $ttsWav).Length -gt 10000)) { $ttsOk = $true }
$ttsDetail = ($ttsOut -split "`n")[0]
if ($ttsOk) { $ttsDetail = "{0:N0} 字节" -f (Get-Item $ttsWav).Length }
Add-Result '中文合成 16k WAV' $ttsOk $ttsDetail
if (-not $ttsOk) {
  Write-Host '  提示：SAPI 在部分非系统盘路径会报"未安装语音"，请从安装副本运行' -ForegroundColor Yellow
}

# 5. 虚拟声卡回路
Section '5. 虚拟声卡回路（发言通道）'
if ($hasCable) {
  $tone = Join-Path $work 'tone.wav'
  Run $mb @('tone', '--out', $tone, '--seconds', '2', '--freq', '600') | Out-Null
  $capWav = Join-Path $work 'cable.wav'
  $p = Start-Process $mb -ArgumentList @('capture', '--out', $capWav, '--seconds', '3', '--mode', 'device', '--device', 'CABLE Output') -PassThru -NoNewWindow
  Start-Sleep -Milliseconds 500
  Run $mb @('play', '--file', $tone, '--device', 'CABLE Input') | Out-Null
  $p.WaitForExit(8000) | Out-Null
  $rms = Get-Rms $capWav
  Add-Result 'CABLE Input -> CABLE Output' ($rms -gt 0.05) ("RMS {0:F3}" -f $rms)
} else {
  Add-Skip 'CABLE Input -> CABLE Output' '缺少 VB-CABLE'
}

# 6. 设备环回
Section '6. 设备环回（听会议）'
$tone2 = Join-Path $work 'tone2.wav'
$loopDevice = ''
if ($hasCable) { $loopDevice = 'CABLE Input' }
Run $mb @('tone', '--out', $tone2, '--seconds', '2', '--freq', '700') | Out-Null
$loopWav = Join-Path $work 'loop.wav'
$p2Args = @('capture', '--out', $loopWav, '--seconds', '3', '--mode', 'loopback')
if ($loopDevice) { $p2Args += @('--device', $loopDevice) }
$p2 = Start-Process $mb -ArgumentList $p2Args -PassThru -NoNewWindow
Start-Sleep -Milliseconds 500
$playArgs = @('play', '--file', $tone2)
if ($loopDevice) { $playArgs += @('--device', $loopDevice) }
Run $mb $playArgs | Out-Null
$p2.WaitForExit(8000) | Out-Null
$rms2 = Get-Rms $loopWav
Add-Result '渲染端点环回采集' ($rms2 -gt 0.05) ("RMS {0:F3}" -f $rms2)

# 7. 本地 ASR
Section '7. 本地 whisper 转写'
if ((Test-Path $ttsWav) -and (Test-Path $whisper) -and (Test-Path $model) -and $ttsOk) {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $asrOut = Run $whisper @('-m', $model, '-f', $ttsWav, '-l', 'zh', '-nt', '--no-prints', '-otxt', '-t', '8', '-bs', '1', '-bo', '1', '--prompt', '以下是普通话的句子，请用简体中文转写。')
  $sw.Stop()
  $txtFile = $ttsWav + '.txt'
  $line = ''
  if (Test-Path $txtFile) {
    $line = ((Get-Content $txtFile -Encoding UTF8) -join ' ').Trim()
  }
  if (-not $line) {
    foreach ($l in ($asrOut -split "`n")) {
      $s = $l.Trim()
      if ($s -and $s -notmatch 'whisper|read_audio_data|^\[|system_info') { $line = $s; break }
    }
  }
  Add-Result 'TTS 音频 -> 文本' ([bool]($line.Length -ge 2)) ("{0:N1}s - {1}" -f $sw.Elapsed.TotalSeconds, $line)
} else {
  Add-Skip 'TTS 音频 -> 文本' 'TTS 或 whisper 未就绪'
}

# 8. 进程级采集
Section '8. 进程级采集（只采会议软件）'
$procWav = Join-Path $work 'proc.wav'
$procOut = Run $mb @('capture-process', '--out', $procWav, '--seconds', '2', '--process', $ProcessName)
$procOk = $false
if ((Test-Path $procWav) -and ((Get-Item $procWav).Length -gt 1000)) { $procOk = $true }
$buildNo = [Environment]::OSVersion.Version.Build
if (-not $procOk -and $buildNo -lt 22621) {
  Add-Skip 'capture-process' ("build {0} < 22621，系统不支持进程环回（代码就绪，换机可验）" -f $buildNo)
} elseif (-not $procOk) {
  Add-Result 'capture-process' $false ($procOut -split "`n")[0]
} else {
  Add-Result 'capture-process' $true '可用'
}


# 8.5 阿里云链路（env 或页面配置里任一有 Key 就跑）
Section '8.5 阿里云 ASR+TTS 闭环'
$dsKey = $env:DASHSCOPE_API_KEY
$dsKeyFrom = '环境变量'
if (-not $dsKey) {
  $cfgPath = Join-Path $env:USERPROFILE '.dsh\meeting-agent\config.json'
  if (Test-Path $cfgPath) {
    try {
      $cfgObj = (Get-Content $cfgPath -Raw -Encoding UTF8) | ConvertFrom-Json
      if ($cfgObj.asr -and $cfgObj.asr.apiKey) { $dsKey = $cfgObj.asr.apiKey; $dsKeyFrom = '页面配置' }
      elseif ($cfgObj.tts -and $cfgObj.tts.apiKey) { $dsKey = $cfgObj.tts.apiKey; $dsKeyFrom = '页面配置(TTS)' }
    } catch { }
  }
}
if ($dsKey) {
  $env:DASHSCOPE_API_KEY = $dsKey
  Write-Host ("  Key 来源：" + $dsKeyFrom) -ForegroundColor DarkGray
  Write-Host '  TTS(cosyvoice) → 虚拟线 → ASR(paraformer) …' -ForegroundColor DarkGray
  $ds = Join-Path $root 'tools\ds-selftest.mjs'
  if (Test-Path $ds) {
    $dsOut = Run 'node' @($ds)
    $pass = $dsOut -match 'RESULT PASS'
    $line = ($dsOut -split "`n" | Where-Object { $_ -match '繁转简|首字延迟' }) -join ' | '
    Add-Result '阿里云 TTS→ASR 闭环' $pass $line
  } else { Add-Skip '阿里云闭环' '缺少 ds-selftest.mjs' }
} else {
  Add-Skip '阿里云闭环' '未设置 DASHSCOPE_API_KEY，页面配置里也没填'
}

# 8.6 繁体 → 简体
Section '8.6 繁转简'
$t2s = Run 'node' @((Join-Path $root 'tools\t2s-check.mjs'))
Add-Result '繁转简' ($t2s -match '我们讨论一下进度和预算') $t2s
# 9. 会议客户端
Section '9. 会议客户端（UIA）'
$wins = Run 'powershell.exe' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ui, 'list')
$meetLine = ($wins -split "`n" | Where-Object { $_ -match $ProcessName } | Select-Object -First 1)
Add-Result '发现会议进程' ([bool]$meetLine) $meetLine

# 10. 可选：真采
if ($Live -gt 0) {
  Section ("10. 实采 {0} 秒会议声音" -f $Live)
  Write-Host '  请现在在会议里说话……' -ForegroundColor Yellow
  $liveWav = Join-Path $work 'live.wav'
  Run $mb @('capture', '--out', $liveWav, '--seconds', [string]$Live, '--mode', 'loopback', '--gain', '2') | Out-Null
  $liveRms = Get-Rms $liveWav
  Add-Result '会议声音电平' ($liveRms -gt 0.004) ("RMS {0:F4}" -f $liveRms)
  if ($liveRms -gt 0.004 -and (Test-Path $whisper)) {
    Run $whisper @('-m', $model, '-f', $liveWav, '-l', 'zh', '-nt', '--no-prints', '-otxt', '-t', '8', '-bs', '1', '-bo', '1', '--prompt', '以下是普通话的句子，请用简体中文转写。') | Out-Null
    $liveTxt = ''
    if (Test-Path ($liveWav + '.txt')) { $liveTxt = ((Get-Content ($liveWav + '.txt') -Encoding UTF8) -join ' ').Trim() }
    Write-Host '  转写结果：' -ForegroundColor DarkGray
    Write-Host ("    " + $liveTxt) -ForegroundColor White
    Add-Result '会议声音 -> 文本' ([bool]($liveTxt.Length -gt 1)) ''
  }
}

# 11. 可选：发言
if ($Say) {
  Section '11. 向会议发言'
  if (-not $MicRestore) {
    Add-Skip '向会议发言' '需要 -MicRestore "真实麦克风设备名"'
  } elseif (-not $hasCable) {
    Add-Skip '向会议发言' '缺少 VB-CABLE'
  } else {
    Write-Host "  切换默认麦克风到 CABLE Output，播报后切回 $MicRestore" -ForegroundColor Yellow
    Run $mb @('set-default', '--flow', 'capture', '--device', 'CABLE Output') | Out-Null
    Start-Sleep -Milliseconds 600
    $sayWav = Join-Path $work 'say.wav'
    Run $mb @('tts', '--text', $Say, '--out', $sayWav) | Out-Null
    $playOut = Run $mb @('play', '--file', $sayWav, '--device', $SpeakDevice)
    Start-Sleep -Milliseconds 400
    Run $mb @('set-default', '--flow', 'capture', '--device', $MicRestore) | Out-Null
    Add-Result '播报并恢复麦克风' ([bool]($playOut -match 'OK played')) ($playOut -split "`n")[0]
  }
}

# 汇总
Section '汇总'
$pass = @($script:results | Where-Object { $_.Ok }).Count
$fail = @($script:results | Where-Object { -not $_.Ok }).Count
$script:results | Format-Table Name, Ok, Detail -AutoSize | Out-String -Width 160 | Write-Host
if ($script:skips.Count -gt 0) {
  Write-Host '跳过项：' -ForegroundColor DarkYellow
  foreach ($s in $script:skips) { Write-Host ("  - {0}: {1}" -f $s.Name, $s.Detail) -ForegroundColor DarkYellow }
}
$sumColor = 'Green'
if ($fail -gt 0) { $sumColor = 'Red' }
Write-Host ("通过 {0} 项，跳过 {1} 项，失败 {2} 项" -f $pass, $script:skips.Count, $fail) -ForegroundColor $sumColor
Write-Host "产物目录：$work" -ForegroundColor DarkGray

if ($fail -gt 0) { exit 1 } else { exit 0 }
