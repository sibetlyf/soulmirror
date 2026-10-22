/**
 * lib/setup.js —— 环境自检与自动配置。
 *
 * 目标：装完即可用，缺什么就说清楚怎么补。
 *  - Windows：从 tools/meeting-bridge.cs 用系统自带 csc 编译 mbridge.exe
 *  - macOS / Linux：改用 ffmpeg 采集、say / espeak-ng 合成
 */
import { existsSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { toolsDir } from './bridge.js'

const WIN_CSC = [
  'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',
  'C:/Windows/Microsoft.NET/Framework/v4.0.30319/csc.exe',
]

const WIN_SPEECH = [
  'C:/Windows/Microsoft.NET/assembly/GAC_MSIL/System.Speech/v4.0_4.0.0.0__31bf3856ad364e35/System.Speech.dll',
]

function firstExisting(list) {
  for (const p of list) if (existsSync(p)) return p
  return ''
}

function which(bin) {
  try {
    const out = execFileSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return (out || '').split(/\r?\n/)[0].trim()
  } catch { return '' }
}

/** 编译 mbridge.exe（仅 Windows） */
export function buildBridge({ force = false, logger } = {}) {
  if (process.platform !== 'win32') return { ok: false, skipped: true, reason: 'mbridge 只在 Windows 上需要' }
  const src = join(toolsDir, 'meeting-bridge.cs')
  const out = join(toolsDir, 'mbridge.exe')
  if (!existsSync(src)) return { ok: false, error: '缺少源码 ' + src }
  if (!force && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) {
    return { ok: true, skipped: true, path: out, reason: '已是最新' }
  }
  const csc = firstExisting(WIN_CSC)
  if (!csc) return { ok: false, error: '找不到 csc.exe（需要 .NET Framework 4.x）' }
  const speech = firstExisting(WIN_SPEECH)
  const args = ['/nologo', '/target:exe', '/out:' + out]
  if (speech) args.push('/r:' + speech)
  args.push(src)
  try {
    const stdout = execFileSync(csc, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    if (stdout && stdout.trim()) logger?.info?.(stdout.trim())
    return { ok: existsSync(out), path: out }
  } catch (e) {
    return { ok: false, error: String(e.stderr || e.message).slice(0, 400) }
  }
}

/** 探测所有依赖与可选工具 */
export function detectEnv() {
  const platform = process.platform
  const tools = {
    mbridge: existsSync(join(toolsDir, 'mbridge.exe')),
    uiScript: existsSync(join(toolsDir, 'ui.ps1')),
    holdScript: existsSync(join(toolsDir, 'hold.ps1')),
    bridgeSource: existsSync(join(toolsDir, 'meeting-bridge.cs')),
    csc: platform === 'win32' ? firstExisting(WIN_CSC) : '',
    ffmpeg: which('ffmpeg'),
    parec: which('parec'),
    say: which('say'),
    espeak: which('espeak-ng') || which('espeak'),
    aplay: which('aplay'),
    whisper: existsSync(join(toolsDir, 'whisper', 'Release', 'whisper-cli.exe')),
  }
  const missing = []
  const hints = []

  if (platform === 'win32') {
    if (!tools.mbridge && !tools.csc) {
      missing.push('mbridge（需 .NET Framework 4.x 的 csc.exe 才能编译）')
      hints.push('安装 .NET Framework 4.8 后执行：soul_setup { action: "build" }')
    } else if (!tools.mbridge) {
      missing.push('mbridge.exe')
      hints.push('执行 soul_setup { action: "build" } 自动编译')
    }
    if (!tools.uiScript) missing.push('ui.ps1')
  } else if (platform === 'darwin') {
    if (!tools.ffmpeg) {
      missing.push('ffmpeg')
      hints.push('brew install ffmpeg')
    }
    hints.push('系统没有原生环回：需要装 BlackHole 并把会议输出同时投到 BlackHole（brew install blackhole-2ch）')
    if (!tools.say) missing.push('say')
  } else {
    if (!tools.ffmpeg && !tools.parec) {
      missing.push('ffmpeg 或 parec（PulseAudio/PipeWire）')
      hints.push('sudo apt install ffmpeg   # 或 pulseaudio-utils')
    }
    if (!tools.espeak) hints.push('sudo apt install espeak-ng   # 本地 TTS 兜底')
  }
  hints.push('云端 ASR/TTS 需要 DASHSCOPE_API_KEY；意图判定需要任意 OpenAI 兼容模型')

  return { platform, arch: process.arch, tools, missing, hints, ready: missing.length === 0 }
}

/** 一次性把能自动做的做完 */
export async function autoSetup({ logger } = {}) {
  const before = detectEnv()
  const actions = []
  if (process.platform === 'win32' && !before.tools.mbridge) {
    const r = buildBridge({ logger })
    actions.push({ what: 'build mbridge', ...r })
  }
  const after = detectEnv()
  return { before, after, actions, ready: after.ready }
}

/** 生成一段可读的报告 */
export function formatEnv(env) {
  const t = env.tools
  const lines = []
  lines.push('平台：' + env.platform + ' / ' + env.arch)
  lines.push((env.ready ? '✅ 环境就绪' : '⚠️ 还缺 ' + env.missing.length + ' 项'))
  const mark = (ok, name, extra = '') => lines.push('  ' + (ok ? '✓' : '✗') + ' ' + name + (extra ? '  ' + extra : ''))
  if (env.platform === 'win32') {
    mark(t.mbridge, 'mbridge.exe')
    mark(t.uiScript, 'ui.ps1')
    mark(t.holdScript, 'hold.ps1')
    mark(!!t.csc, 'csc（编译 mbridge 用）')
  } else {
    mark(!!t.ffmpeg, 'ffmpeg')
    if (env.platform === 'linux') mark(!!t.parec, 'parec')
    mark(!!t.say || !!t.espeak, '本地 TTS（say / espeak）')
  }
  if (t.whisper) lines.push('  ✓ whisper 离线模型')
  if (env.hints.length) {
    lines.push('建议：')
    for (const h of env.hints) lines.push('  · ' + h)
  }
  return lines.join('\n')
}
