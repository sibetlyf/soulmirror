import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bridge, bridgeExe, meetingMicActive, micStateOcr, toggleMicOcr, restoreWindow, holdSpaceDown, holdSpaceUp } from './bridge.js'
import { synthesizeStream } from './dashscope-tts.js'

/** 离线 TTS：SAPI 合成 16k 单声道 WAV */
export async function synthesize(text, ttsCfg, outPath) {
  const args = ['tts', '--text', text, '--out', outPath]
  if (ttsCfg.voice) args.push('--voice', ttsCfg.voice)
  args.push('--rate', String(ttsCfg.rate ?? 0))
  await bridge(args, { timeoutMs: 60000 })
  return outPath
}

export async function playWav(file, device, { timeoutMs = 120000 } = {}) {
  const args = ['play', '--file', file]
  if (device) args.push('--device', device)
  return bridge(args, { timeoutMs })
}

/** 云端 TTS（OpenAI 兼容 /v1/audio/speech，pcm 流式） */
async function synthCloudStream(text, cfg) {
  const key = process.env[cfg.apiKeyEnv || 'OPENAI_API_KEY'] || cfg.apiKey || ''
  if (!cfg.baseUrl) throw new Error('TTS 未配置 baseUrl')
  if (!key) throw new Error(`TTS 缺少密钥：环境变量 ${cfg.apiKeyEnv || 'OPENAI_API_KEY'} 未设置`)
  const url = cfg.baseUrl.replace(/\/+$/, '') + '/audio/speech'
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.model || 'tts-1',
      voice: cfg.voice || 'alloy',
      input: text,
      response_format: 'pcm',
      speed: cfg.speed || 1,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`TTS HTTP ${res.status}: ${body.slice(0, 160)}`)
  }
  return res
}

/** 把 PCM 流灌进 mbridge stream-play（边到边播） */
function pipeToSpeaker(res, device, sampleRate) {
  return new Promise((resolve, reject) => {
    const args = ['stream-play']
    if (device) args.push('--device', device)
    args.push('--rate', String(sampleRate))
    const child = spawn(bridgeExe, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (b) => { err += b.toString() })
    child.on('error', reject)
    child.on('close', () => resolve(err))
    ;(async () => {
      try {
        for await (const chunk of res.body) {
          if (!child.stdin.write(chunk)) await new Promise((r) => child.stdin.once('drain', r))
        }
        child.stdin.end()
      } catch (e) {
        try { child.stdin.destroy() } catch { /* ignore */ }
        reject(e)
      }
    })()
  })
}

/**
 * 说话（流式优先）：
 *  - openai: 云端边合成边播（首字延迟 ≈ 网络 RTT + 首个 chunk）
 *  - sapi  : 按句子切分，逐句合成并播放（比整段合成快很多）
 */
export async function speak(text, cfg, { device, onFirstAudio } = {}) {
  if (cfg.provider === 'dashscope') {
    const key = cfg.apiKey || process.env[cfg.apiKeyEnv || 'DASHSCOPE_API_KEY'] || ''
    if (!key) throw new Error('TTS 缺少密钥：环境变量 ' + (cfg.apiKeyEnv || 'DASHSCOPE_API_KEY') + ' 未设置')
    const args = ['stream-play']
    if (device) args.push('--device', device)
    args.push('--rate', String(cfg.sampleRate || 16000))
    const child = spawn(bridgeExe, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    let first = false
    const closed = new Promise((res) => child.on('close', res))
    const s = await synthesizeStream({
      apiKey: key,
      model: cfg.model || 'cosyvoice-v2',
      voice: cfg.voice || 'longxiaochun_v2',
      sampleRate: cfg.sampleRate || 16000,
      onAudio: (b) => {
        if (!first) { first = true; onFirstAudio?.() }
        try { child.stdin.write(b) } catch { /* ignore */ }
      },
    })
    try {
      s.speak(text)
      await s.finish()
    } finally {
      try { child.stdin.end() } catch { /* ignore */ }
      await closed
    }
    return { mode: 'dashscope-stream' }
  }
  if (cfg.provider === 'openai') {
    const res = await synthCloudStream(text, cfg)
    onFirstAudio?.()
    await pipeToSpeaker(res, device, cfg.sampleRate || 24000)
    return { mode: 'cloud-stream' }
  }
  const parts = String(text).split(/(?<=[。！？!?；;\n])/).map((s) => s.trim()).filter(Boolean)
  if (parts.length === 0) return { mode: 'sapi', parts: 0 }
  let i = 0
  for (const part of parts) {
    const wav = join(tmpdir(), `dsh-meeting-tts-${Date.now()}-${i++}.wav`)
    await synthesize(part, cfg, wav)
    onFirstAudio?.()
    await playWav(wav, device)
  }
  return { mode: 'sapi', parts: parts.length }
}

/**
 * 说一句话并送进会议：
 *  1. 默认录音设备临时切到虚拟声卡（会议客户端跟随默认设备）
 *  2. TTS 播到虚拟声卡播放端（流式）
 *  3. 切回真实麦克风
 */
/**
 * 发言前自动开麦：
 *  1. 还原被最小化的会议窗口
 *  2. OCR 读工具栏判断是否静音（读不到就跳过，不盲点）
 *  3. 静音则点击切换，并回读确认
 */
export async function ensureUnmuted(windowTitle, logger) {
  const info = { before: 'unknown', after: 'unknown', clicked: false }
  try {
    await restoreWindow(windowTitle, { proc: 'wemeetapp' }).catch(() => {})
    const st = await micStateOcr(windowTitle)
    info.before = st.state
    if (st.state === 'unmuted') { info.after = 'unmuted'; return info }
    if (st.state !== 'muted') { info.after = st.state; logger?.warn?.('[meeting-agent] 读不到麦克风状态，跳过自动开麦'); return info }
    const r = await toggleMicOcr(windowTitle)
    info.clicked = true
    info.after = r.after || 'unknown'
  } catch (e) {
    info.error = e.message
  }
  return info
}

export async function sayToMeeting(text, ttsCfg, { speakDevice, micRestore, onFirstAudio, proc = 'wemeetapp', windowTitle, logger, ptt = true } = {}) {
  let switched = false
  let cableMic = ''
  let verified = false
  let holding = false
  let pttInfo = null

  // 1) 还原并聚焦会议窗口（长按空格必须发到真实前台窗口）
  if (windowTitle) {
    try { await restoreWindow(windowTitle, { proc }); } catch { /* ignore */ }
  }

  // 2) 腾讯会议默认"长按空格发言"：整段播报期间保持按下
  if (ptt && windowTitle) {
    const d = await holdSpaceDown(windowTitle)
    holding = d.ok
    pttInfo = d
    if (!holding) logger?.warn?.('[meeting-agent] 按住空格失败: ' + (d.err || d.text))
  }
  if (speakDevice && micRestore) {
    cableMic = speakDevice.replace(/Input/i, 'Output')
    try {
      await bridge(['set-default', '--flow', 'capture', '--device', cableMic], { timeoutMs: 15000 })
      switched = true
      // 校验会议客户端真的跟着切过去了（最多等 3 秒）
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 500))
        try {
          const m = await meetingMicActive(proc)
          if (m.devices.some((d) => d.toLowerCase().includes('cable'))) { verified = true; break }
        } catch { /* ignore */ }
      }
    } catch { /* 切不过去就直连播放 */ }
  }
  try {
    const r = await speak(text, ttsCfg, { device: speakDevice, onFirstAudio })
    return { ok: true, switched, verified, cableMic, ptt: holding, ...r }
  } finally {
    if (holding) { try { await holdSpaceUp() } catch { /* ignore */ } }
    if (switched) {
      await new Promise((r) => setTimeout(r, 200))
      try { await bridge(['set-default', '--flow', 'capture', '--device', micRestore], { timeoutMs: 15000 }) } catch { /* ignore */ }
    }
  }
}
