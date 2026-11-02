import { mkdir, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'
import { bridge, bridgeExe, loudestRenderDevice } from './bridge.js'
import { startDashScopeAsr } from './dashscope.js'
import { toSimplified } from './t2s.js'
import { transcribeWav, removeFile, boostWav } from './asr.js'
import { resolveApiKey } from './env.js'
import { synthesize, playWav } from './tts.js'

const nowIso = () => new Date().toISOString()

export class MeetingSession {
  constructor(cfg, logger) {
    this.cfg = cfg
    this.logger = logger
    this.running = false
    this.capturing = false
    this.startedAt = null
    this.dir = ''
    this.chunks = 0
    this.transcript = []
    this.lastError = ''
    this.speaking = false
    this._loop = null
  }

  dataRoot() {
    return this.cfg.dataDir || join(homedir(), '.dsh', 'soulmirror')
  }

  async startCapture(label) {
    if (this.capturing) return { ok: true, already: true }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    this.dir = join(this.dataRoot(), `${stamp}${label ? '-' + label : ''}`)
    await mkdir(this.dir, { recursive: true })
    this.running = true
    this.capturing = true
    this.startedAt = nowIso()
    this.chunks = 0
    this._loop = this.cfg.asr.provider === 'dashscope' ? this._streamLoop() : this._loopBody()
    return { ok: true, dir: this.dir }
  }

  async _loopBody() {
    const chunkSeconds = Math.max(3, Math.min(30, this.cfg.asr.chunkSeconds || 6))
    const silenceRms = Number(this.cfg.silenceRms ?? 0.004)
    while (this.running) {
      const idx = String(this.chunks).padStart(4, '0')
      const wav = join(this.dir, `chunk-${idx}.wav`)
      try {
        const out = await bridge(
          ['capture', '--out', wav, '--seconds', String(chunkSeconds),
            ...(this.cfg.devices.capture ? ['--device', this.cfg.devices.capture] : []),
            '--mode', this.cfg.devices.captureMode || 'loopback'],
          { timeoutMs: (chunkSeconds + 15) * 1000 },
        )
        this.chunks += 1
        const t = nowIso()

        // 静音门限：whisper 对纯静音会"幻听"出固定句子，必须先拦掉
        let rms = 1
        try {
          const rmsOut = await bridge(['rms', '--file', wav], { timeoutMs: 15000 })
          const m = /RMS\s+([0-9.]+)/.exec(rmsOut)
          if (m) rms = Number(m[1])
        } catch { /* 测不了就当有声音 */ }

        if (rms < silenceRms) {
          this.silentChunks = (this.silentChunks || 0) + 1
          if (this.silentChunks === 3) {
            this.lastError = `连续 3 片静音（RMS<${silenceRms}）：可能采错设备 —— 会议声音从哪个设备出，就把 devices.capture 设成它`
          }
          if (!this.cfg.keepAudio) await removeFile(wav)
          continue
        }
        this.silentChunks = 0
        if (rms < 0.02) {
          const factor = Math.min(10, 0.08 / Math.max(rms, 0.002))
          try {
            if (await boostWav(wav, factor)) this.lastError = `音量偏低（RMS ${rms.toFixed(4)}），已放大 ${factor.toFixed(1)}x`
          } catch { /* 放大失败就用原音 */ }
        }

        const r = await transcribeWav(wav, this.cfg.asr, this.logger)
        if (r.ok && r.text) {
          this.transcript.push({ t, text: r.text, rms })
          await appendFile(join(this.dir, 'transcript.jsonl'), JSON.stringify({ t, text: r.text, rms }) + '\n', 'utf8')
        } else if (!r.ok) {
          this.lastError = r.reason
          if (this.cfg.asr.provider === 'none') {
            // 没配 ASR 时不保留音频切片，避免无意义占盘
            await removeFile(wav)
            this.running = false
            this.lastError = 'ASR 未配置：请设置 asr.provider=local（内置）或 openai（云端）'
            break
          }
        }
        // 静音切片不值得留
        if (!this.cfg.keepAudio) await removeFile(wav)
        void out
      } catch (err) {
        this.lastError = err.message
        this.logger?.warn?.(`[soulmirror] 采集失败: ${err.message}`)
        await new Promise((r) => setTimeout(r, 1500))
      }
    }
    this.capturing = false
  }


  /** 百炼实时识别：持续 PCM 流 → WebSocket → 句子 */
  async _streamLoop() {
    const asrCfg = this.cfg.asr
    // 进程环境 → 配置 → Windows 用户级环境变量，三级兜底
    const key = resolveApiKey({ apiKey: asrCfg.apiKey, apiKeyEnv: asrCfg.apiKeyEnv || 'DASHSCOPE_API_KEY' }).key
    if (!key) {
      this.lastError = `缺少密钥：环境变量 ${asrCfg.apiKeyEnv || 'DASHSCOPE_API_KEY'} 未设置`
      this.running = false
      this.capturing = false
      return
    }
    while (this.running) {
      let child = null
      let asr = null
      try {
        const args = ['capture-stream', '--mode', this.cfg.devices.captureMode || 'loopback']
        // 会议声音未必在系统默认设备上（可能走 HDMI / 虚拟声卡）。采默认设备的环回会得到静音，
        // 所以先看一眼哪个渲染设备在出声，优先采它。
        let device = this.cfg.devices.capture || ''
        if (!device) {
          try {
            const loud = await loudestRenderDevice({ samples: 4, intervalMs: 250 })
            if (loud) {
              device = loud.name
              this.logger?.info?.('[soulmirror] 自动选择采集设备：' + loud.name + '（峰值 ' + loud.level.toFixed(3) + '）')
            }
          } catch { /* 探测失败就用默认设备 */ }
        }
        this.deviceInUse = device
        if (device) args.push('--device', device)
        child = spawn(bridgeExe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        child.stderr.on('data', (b) => { this.captureLog = b.toString().trim() })
        asr = startDashScopeAsr({
          apiKey: key,
          model: asrCfg.model === 'whisper-1' ? 'paraformer-realtime-v2' : (asrCfg.model || 'paraformer-realtime-v2'),
          sampleRate: 16000,
          asr: asrCfg,
          onSentence: (s) => {
            // 串行处理：先润色（可选 LLM 纠错）再入库，保证顺序与 1:1
            this._q = (this._q || Promise.resolve()).then(async () => {
              let fixed = toSimplified((s.text || '').trim())
              if (s.sentenceEnd && fixed) {
                if (this.correctText) {
                  try {
                    const better = await this.correctText(fixed)
                    if (better && better.trim()) fixed = better.trim()
                  } catch { /* 纠错失败就用原文 */ }
                }
                const item = { t: nowIso(), text: fixed, begin: s.begin, end: s.end }
                if (this.acceptLine && !this.acceptLine(item)) {
                  this.partial = ''
                  return
                }
                this.transcript.push(item)
                appendFile(join(this.dir, 'transcript.jsonl'), JSON.stringify(item) + '\n', 'utf8').catch(() => {})
                await this.onLine?.(item)?.catch?.(() => {})
              } else {
                this.partial = fixed
                this.partialAt = Date.now()
              }
            }).catch(() => {})
          },
          onError: (e) => { this.lastError = e.message },
        })
        await asr.open()
        this.partial = ''
        child.stdout.on('data', (d) => { try { asr.send(d) } catch { /* ignore */ } })
        let childExited = false
        child.on('exit', () => { childExited = true; this.lastError = '采集进程退出，正在重启' })
        let lastLineAt = Date.now()
        // 采集静音检测：环回拿到全零说明"这个设备的环回采不到声音"（常见于 HDMI）
        // 配置里可以指定“采不到就切到哪个设备”（通常填 CABLE Input）
        const cfgForce = String(this.cfg.devices.forceCaptureDevice || '').trim()
        let silentSince = 0
        let bytesSeen = 0
        child.stdout.on('data', (d) => { bytesSeen += d.length })
        const origPush = this.transcript.push.bind(this.transcript)
        this.transcript.push = (...a) => { lastLineAt = Date.now(); return origPush(...a) }
        while (this.running && !asr.closed && !childExited) {
          await new Promise((r) => setTimeout(r, 200))
          // 会议里很少停顿 800ms，整句迟迟不落 → 中间结果超过 4 秒没变就提为正式一行，
          // 否则用户会觉得"没有实时转写"（实测能落后 20 秒以上）
          if (this.partial && this.partialAt && Date.now() - this.partialAt > 4000) {
            try { this._commitPartial('stale-partial') } catch { /* ignore */ }
          }
          // 60 秒一句话都没有，且有别的设备在响 → 换设备重采（说明我们采错了）
          if (Date.now() - lastLineAt > 60000) {
            try {
              const loud = await loudestRenderDevice({ samples: 3, intervalMs: 200 })
              if (loud && loud.name && loud.name !== this.deviceInUse) {
                this.logger?.warn?.('[soulmirror] 60 秒无转写，改采正在出声的设备：' + loud.name)
                this.lastError = '采集设备无声，已切换到 ' + loud.name
                this.cfg.devices.capture = loud.name
                break
              }
            } catch { /* ignore */ }
            lastLineAt = Date.now()
          }
        }
      } catch (err) {
        this.lastError = err.message
      } finally {
        try { await asr?.finish?.() } catch { /* ignore */ }
        try { child?.kill() } catch { /* ignore */ }
      }
      if (this.running) await new Promise((r) => setTimeout(r, 800))
    }
    this.capturing = false
  }
  /** 把当前中间结果提升为正式一行（长时间不落句时用，保证转写不被"整句"卡住） */
  _commitPartial(reason) {
    const text = String(this.partial || '').trim()
    if (text.length < 8) return false
    const last = this.transcript[this.transcript.length - 1]
    if (last && last.text === text) { this.partial = ""; return false }
    const item = { t: nowIso(), text, forced: true }
    if (this.acceptLine && !this.acceptLine(item)) { this.partial = ""; return false }
    this.transcript.push(item)
    appendFile(join(this.dir, 'transcript.jsonl'), JSON.stringify(item) + '\n', 'utf8').catch(() => {})
    this.onLine?.(item)?.catch?.(() => {})
    this.partial = ""
    this.partialAt = 0
    this.lastError = ''
    return true
  }

  async stopCapture() {
    this.running = false
    if (this._loop) await this._loop.catch(() => undefined)
    this.capturing = false
    return { ok: true, chunks: this.chunks, dir: this.dir }
  }

  formatTranscript(limit = 30, sinceMs = 0) {
    const items = this.transcript
      .filter((x) => Date.parse(x.t) >= sinceMs)
      .slice(-limit)
    if (items.length === 0) return this.lastError ? `（暂无转写）${this.lastError}` : '（暂无转写）'
    return items.map((x) => `[${x.t.slice(11, 19)}] ${x.text}`).join('\n')
  }

  /** 合成并播放一句话；返回是否真的送到了会议麦克风 */
  async say(text, { autoMute = false } = {}) {
    if (!this.dir) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      this.dir = join(this.dataRoot(), `${stamp}-speech`)
      await mkdir(this.dir, { recursive: true })
    }
    const wav = join(this.dir, `say-${Date.now()}.wav`)
    this.speaking = true
    try {
      await synthesize(text, this.cfg.tts, wav)
      const device = this.cfg.devices.speak
      const out = await playWav(wav, device)
      return { ok: true, device: device || '(default render)', log: out, wav }
    } finally {
      this.speaking = false
      if (!this.cfg.keepAudio) await removeFile(wav)
    }
  }

  snapshot() {
    return {
      capturing: this.capturing,
      startedAt: this.startedAt,
      chunks: this.chunks,
      lines: this.transcript.length,
      dir: this.dir,
      lastError: this.lastError,
      speaking: this.speaking,
    }
  }
}
