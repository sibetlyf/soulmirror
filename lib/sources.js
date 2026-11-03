/**
 * 外部世界抽象层。
 *
 * 目的：让"会议检测 / 采集 / 语音识别"这三件必须依赖真实环境的事，
 * 都能在测试与演练里换成模拟实现——不需要会议软件、不需要网络、不需要麦克风。
 *
 * 三个接口：
 *   SignalSource   → 轮询出「当前在开什么会」（谁、会议号、是否在会中）
 *   AudioSource    → 吐出 16k 单声道 PCM16 音频块
 *   Transcriber    → 吃音频，吐中间结果 / 整句 / 错误
 *
 * 每个接口都有真实实现和模拟实现，实现之间不互相引用。
 */

// ─────────────────────────── 音频工具 ───────────────────────────

/** 从 WAV 里取 PCM 与采样率（只支持 16bit 单/多声道，多声道会混成单声道） */
export function parseWav(buf) {
  if (!buf || buf.length < 44) throw new Error('不是有效的 WAV')
  let off = 12
  let dataOff = -1
  let dataLen = 0
  let rate = 0
  let channels = 1
  let bits = 16
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(off + 10)
      rate = buf.readUInt32LE(off + 12)
      bits = buf.readUInt16LE(off + 22)
    } else if (id === 'data') {
      dataOff = off + 8
      dataLen = Math.min(size, buf.length - dataOff)
      break
    }
    off += 8 + size + (size % 2)
  }
  if (dataOff < 0) throw new Error('WAV 缺少 data 块')
  if (bits !== 16) throw new Error('只支持 16bit PCM，实际 ' + bits + 'bit')
  let pcm = buf.subarray(dataOff, dataOff + dataLen)
  if (channels > 1) {
    const frames = Math.floor(pcm.length / (2 * channels))
    const mono = Buffer.alloc(frames * 2)
    for (let f = 0; f < frames; f++) {
      let sum = 0
      for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((f * channels + c) * 2)
      mono.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sum / channels))), f * 2)
    }
    pcm = mono
  }
  return { pcm, rate, channels, bits }
}

/** 生成静音 PCM16 */
export function silentPcm(ms, rate = 16000) {
  return Buffer.alloc(Math.round((rate * 2 * ms) / 1000))
}

/** 把 16k 单声道 PCM16 算成一段 WAV（Buffer） */
export function wrapWav(pcm, rate = 16000) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(1, 22)
  h.writeUInt32LE(rate, 24)
  h.writeUInt32LE(rate * 2, 28)
  h.writeUInt16LE(2, 32)
  h.writeUInt16LE(16, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/** PCM16 的 RMS（0–1），用于判断"这段有没有声音" */
export function rms(pcm) {
  const n = Math.floor(pcm.length / 2)
  if (!n) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = pcm.readInt16LE(i * 2) / 32768
    sum += v * v
  }
  return Math.sqrt(sum / n)
}

// ─────────────────────────── SignalSource ───────────────────────────

/**
 * 真实实现：由调用方注入 listWindows / micHeldByApp / 检测函数，
 * 这样 sources.js 不直接依赖桌面层，测试里可以完全不传。
 */
export class DesktopSignalSource {
  constructor({ detect, listWindows, micHeldByApp } = {}) {
    this.detect = detect
    this.listWindows = listWindows
    this.micHeldByApp = micHeldByApp
    this.closed = false
  }

  async poll() {
    const wins = (await this.listWindows?.()) || []
    const base = this.detect ? this.detect(wins) : { app: null, inMeeting: false, code: '', title: '' }
    let micHeld = false
    if (!base.inMeeting && this.micHeldByApp) {
      try { micHeld = !!(await this.micHeldByApp(base.app)) } catch { /* ignore */ }
    }
    return { ...base, inMeeting: base.inMeeting || micHeld, micHeld }
  }

  dispose() { this.closed = true }
}

/**
 * 模拟实现：按脚本依次返回。脚本每项是一段"持续多久的信号"。
 *   [{ ms: 3000, signal: {...} }, ...]
 * 不传 loop 时，脚本走完就停在最后一项。
 */
export class ScriptedSignalSource {
  constructor(steps, { loop = false, clock = () => Date.now() } = {}) {
    this.steps = Array.isArray(steps) && steps.length ? steps : [{ ms: 1000, signal: {} }]
    this.loop = loop
    this.clock = clock
    // 计时起点在构造时就定下：否则第一次 poll 永远算作"第 0 步"，
    // 测试里先跳到 999 秒也还是拿到第一步的信号。
    this.startedAt = clock()
    this.cursor = 0
  }

  async poll() {
    const now = this.clock()
    if (this.startedAt === null) this.startedAt = now
    let elapsed = Math.max(0, now - this.startedAt)
    for (let guard = 0; guard < 10000; guard++) {
      const step = this.steps[this.cursor]
      if (elapsed < step.ms) {
        return {
          app: step.signal?.app || null,
          title: step.signal?.title || '',
          code: step.signal?.code || '',
          inMeeting: !!step.signal?.inMeeting,
          micHeld: !!step.signal?.micHeld,
          demo: true,
        }
      }
      elapsed -= step.ms
      this.cursor++
      if (this.cursor >= this.steps.length) {
        if (!this.loop) { this.cursor = this.steps.length - 1; break }
        this.cursor = 0
      }
    }
    const last = this.steps[this.steps.length - 1].signal || {}
    return { ...last, demo: true }
  }

  dispose() { /* no-op */ }
}

// ─────────────────────────── AudioSource ───────────────────────────

/**
 * 模拟实现：把一段内存里的 PCM 按真实速率（可加速）吐出来。
 * speed=1 表示与真实播放同速；测试里常用 speed=20 跑得快。
 */
export class PcmReplayAudioSource {
  constructor(pcm, { rate = 16000, chunkMs = 100, speed = 1, loop = false } = {}) {
    this.pcm = pcm
    this.rate = rate
    this.chunkMs = chunkMs
    this.speed = speed > 0 ? speed : 1
    this.loop = loop
    this.running = false
    this.bytes = 0
    this.sent = false
  }

  async start() { this.running = true }

  async *chunks() {
    const step = Math.max(1, Math.round((this.rate * 2 * this.chunkMs) / 1000))
    while (this.running) {
      if (!this.sent) {
        for (let i = 0; i < this.pcm.length; i += step) {
          if (!this.running) return
          const piece = this.pcm.subarray(i, Math.min(i + step, this.pcm.length))
          this.bytes += piece.length
          yield piece
          await new Promise((r) => setTimeout(r, Math.max(0, this.chunkMs / this.speed)))
        }
        this.sent = true
        if (!this.loop) return
        this.sent = false
      }
    }
  }

  health() {
    return { bytes: this.bytes, silentMs: 0, lastChunkAt: Date.now() }
  }

  async stop() { this.running = false }
}

// ─────────────────────────── Transcriber ───────────────────────────

/**
 * 模拟实现：吃音频字节，按"每 N 毫秒音频产出一句"的节奏吐事件。
 * 用于端到端测试与演练——不联网、不需要 key。
 */
export class ScriptedTranscriber {
  constructor(sentences, { msPerSentence = 2000, partialPerSentence = 2, onEvent } = {}) {
    this.sentences = sentences && sentences.length ? sentences : ['（演练）这是一句模拟的会议内容。']
    this.msPerSentence = msPerSentence
    this.partialPerSentence = partialPerSentence
    this.onEvent = onEvent
    this.bytes = 0
    this.done = 0
    this.opened = false
    this.closed = false
    this.nextAt = msPerSentence
    this._timer = null
  }

  async start() {
    this.opened = true
    // 用定时器驱动：即使没有音频进来也能演示；有音频时按字节推进
    this._timer = setInterval(() => this._tick(), 100)
    this._timer.unref?.()
  }

  feed(pcm) {
    if (this.closed) return
    this.bytes += pcm.length
  }

  _tick() {
    if (this.closed) return
    const audioMs = this.bytes / 32 // 16k mono 16bit = 32 B/ms
    if (audioMs < this.nextAt) return
    this._emitSentence()
    this.nextAt += this.msPerSentence
  }

  _emitSentence() {
    const text = this.sentences[this.done % this.sentences.length]
    for (let p = 1; p <= this.partialPerSentence; p++) {
      const cut = Math.max(2, Math.round((text.length * p) / (this.partialPerSentence + 1)))
      this.onEvent?.({ text: text.slice(0, cut), sentenceEnd: false, demo: true })
    }
    this.onEvent?.({ text, sentenceEnd: true, demo: true })
    this.done++
  }

  async stop() {
    this.closed = true
    if (this._timer) clearInterval(this._timer)
  }
}
