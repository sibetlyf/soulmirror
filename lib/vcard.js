/**
 * lib/vcard.js —— 虚拟声卡（会议"麦克风"注入通道）的检测与安装
 *
 * 为什么需要它：要把分身的声音当成"会议麦克风"送进去，需要一个虚拟录音设备。
 *  - Windows：VB-CABLE（驱动，需管理员 + 可能的重启）
 *  - macOS：BlackHole（AudioServerPlugin，brew 安装，需 sudo）
 *  - Linux：不需要驱动，PulseAudio/PipeWire 一条 module-null-sink 即可，**可全自动**
 */
import { execFileSync } from 'node:child_process'
import { bridge } from './bridge.js'

function run(cmd, args = [], opts = {}) {
  try {
    const out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: opts.timeout || 20000 })
    return { ok: true, out: out || '' }
  } catch (e) {
    return { ok: false, out: String(e.stdout || ''), err: String(e.stderr || e.message) }
  }
}

function which(bin) {
  const r = run(process.platform === 'win32' ? 'where' : 'which', [bin])
  return r.ok ? (r.out.split(/\r?\n/)[0] || '').trim() : ''
}

/** 检测当前平台是否已有可用的虚拟录音设备 */
export async function detectVirtualAudio() {
  if (process.platform === 'win32') {
    try {
      const out = await bridge(['devices'], { timeoutMs: 20000 })
      const hits = out.split(/\r?\n/).filter((l) => /CABLE|VoiceMeeter|Virtual Audio|虚拟音频/i.test(l))
      const render = hits.filter((l) => l.startsWith('RENDER'))
      const capture = hits.filter((l) => l.startsWith('CAPTURE'))
      return {
        platform: 'win32',
        available: render.length > 0 && capture.length > 0,
        devices: hits.map((l) => l.split('\t')[2]).filter(Boolean),
        render: render.length,
        capture: capture.length,
      }
    } catch (e) {
      return { platform: 'win32', available: false, error: e.message, devices: [] }
    }
  }
  if (process.platform === 'linux') {
    const r = run('pactl', ['list', 'short', 'sinks'])
    if (!r.ok) return { platform: 'linux', available: false, error: 'pactl 不可用（需要 PulseAudio/PipeWire）', devices: [] }
    const names = (r.out || '').split(/\r?\n/).map((l) => l.split('\t')[1]).filter(Boolean)
    const mono = run('pactl', ['list', 'short', 'sources'])
    const srcs = (mono.out || '').split(/\r?\n/).map((l) => l.split('\t')[1]).filter(Boolean)
    const ok = names.some((n) => /soulmirror|null/i.test(n)) || srcs.some((n) => /soulmirror|null/i.test(n))
    return { platform: 'linux', available: ok, devices: [...names, ...srcs].slice(0, 8) }
  }
  // darwin
  const r = run('system_profiler', ['SPAudioDataType'], { timeout: 30000 })
  const has = /BlackHole|Loopback|Soundflower/i.test(r.out || '')
  return { platform: 'darwin', available: has, devices: has ? ['BlackHole / Loopback'] : [] }
}

/** 安装方案：能否自动、要跑什么 */
export function installPlan(platform = process.platform) {
  if (platform === 'win32') {
    return {
      auto: false,
      needsAdmin: true,
      reason: '虚拟声卡是内核音频驱动，安装需要管理员权限（并建议重启），不能静默完成',
      steps: [
        '下载 VB-CABLE：https://vb-audio.com/Cable/ （VBCABLE_Driver_Pack43.zip）',
        '解压后右键 VBCABLE_Setup_x64.exe → 以管理员身份运行 → Install Driver',
        '重启后系统会出现 CABLE Input（播放）与 CABLE Output（录音）',
        '若暂时不想装：把 devices.speak 留空，分身只能用扬声器外放（音质差、有回声）',
      ],
      commands: [
        'winget search vb-cable   # 官方仓库目前没有，只能手动下载',
      ],
    }
  }
  if (platform === 'darwin') {
    return {
      auto: false,
      needsAdmin: true,
      reason: 'BlackHole 需要写入 /Library/Audio/Plug-Ins/HAL，brew 会要求 sudo',
      steps: ['brew install blackhole-2ch', '在「音频 MIDI 设置」里建多输出设备，把会议输出同时送到 BlackHole'],
      commands: ['brew install blackhole-2ch'],
    }
  }
  return {
    auto: true,
    needsAdmin: false,
    reason: 'Linux 不需要驱动，加载两个 PulseAudio 模块即可',
    steps: ['创建 null sink', '创建对应的 remap source 作为"麦克风"'],
    commands: [
      'pactl load-module module-null-sink sink_name=SoulMirrorSink sink_properties=device.description=SoulMirrorSink',
      'pactl load-module module-remap-source master=SoulMirrorSink.monitor source_name=SoulMirrorMic source_properties=device.description=SoulMirrorMic',
    ],
  }
}

/** 尝试自动安装（只有 Linux 真正能自动做） */
export async function installVirtualAudio({ logger } = {}) {
  const plan = installPlan()
  if (!plan.auto) {
    return { ok: false, manual: true, reason: plan.reason, steps: plan.steps, commands: plan.commands }
  }
  const results = []
  for (const cmd of plan.commands) {
    const parts = cmd.split(/\s+/)
    const r = run(parts[0], parts.slice(1))
    results.push({ cmd, ok: r.ok, err: r.ok ? '' : (r.err || '').slice(0, 200) })
  }
  const ok = results.every((r) => r.ok)
  if (ok) logger?.info?.('[soulmirror] 虚拟声卡已就绪（SoulMirrorSink / SoulMirrorMic）')
  return { ok, manual: false, results }
}

export function formatVirtualAudio(info) {
  if (!info) return ''
  const lines = ['虚拟声卡：' + (info.available ? '可用（' + (info.devices || []).slice(0, 2).join(' / ') + '）' : '未检测到')]
  return lines.join('\n')
}
