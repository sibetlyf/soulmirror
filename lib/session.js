import { mkdir, appendFile, writeFile, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

// 采集进程的重启退避（毫秒）：越失败越慢，防止抖动
const CAPTURE_BACKOFF_MS = [800, 2000, 4000, 8000, 15000]
import { bridge, bridgeExe, listDevices, loudestRenderDevice, defaultRenderDevice, pickCaptureDevice } from './bridge.js'
import { startDashScopeAsr } from './dashscope.js'
import { createResilientAsr } from './asr-stream.js'
import { TranscriptDeduper } from './dedupe.js'
import { resolveAsrModel } from './asr-model.js'
import { matchDevice, deviceRef } from './resolve-device.js'
import { sessionDevice } from './bridge.js'
import { toSimplified } from './t2s.js'
import { transcribeWav, removeFile, boostWav } from './asr.js'
import { resolveDashScopeKey } from './env.js'
import { synthesize, playWav } from './tts.js'

const nowIso = () => new Date().toISOString()

export class MeetingSession {
  constructor(cfg, logger, deps = {}) {
    this.cfg = cfg
    this.logger = logger
    // 可注入的进程工厂：测试里换成假的，就能验证"采集死了会不会恢复、会不会抖动"
    this.spawnFn = deps.spawnFn || spawn
    this.createAsr = deps.createAsr || null
    this.backoffMs = Array.isArray(deps.backoffMs) ? deps.backoffMs : CAPTURE_BACKOFF_MS
    this._captureAttempts = 0
    // 同一句在 8 秒内重复到达只处理一次（断线补发 / 说话人重复都会造成重复）
    this.deduper = new TranscriptDeduper({ windowMs: 8000 })
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
    // 整场录音落盘：会后要拿它做一次离线重转写（只转录/Agent 都要）
    try {
      this.audioFile = join(this.dir, 'audio.pcm')
      await writeFile(this.audioFile, Buffer.alloc(0))
    } catch { this.audioFile = '' }

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
    const key = resolveDashScopeKey({ apiKey: asrCfg.apiKey, apiKeyEnv: asrCfg.apiKeyEnv }).key
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
        // 采集设备：启动时定一次，本次会话锁定，之后永不自动切换
        //   1) 配置显式指定  2) 正在出声的设备  3) 系统默认播放设备
        if (!this.deviceInUse) {
          let def = ''
          try { def = await defaultRenderDevice() } catch { /* ignore */ }
          let loud = null
          try { loud = await loudestRenderDevice({ samples: 3, intervalMs: 200 }) } catch { /* ignore */ }

          let rows = []
          try { rows = (await listDevices()).filter((d) => d.flow === 'RENDER') } catch { /* ignore */ }

          // 最可靠的一步：问系统"会议进程正在往哪个端点放声音"。
          // 设备名会变（插拔耳机），但"进程 → 端点"是系统事实。
          try {
            const procs = this.cfg.meetingProcs && this.cfg.meetingProcs.length
              ? this.cfg.meetingProcs
              : [this.cfg.processName || 'wemeetapp', 'CloudVideo', 'Feishu', 'DingTalk', 'Teams', 'ms-teams', 'Zoom', 'WXWork']
            const bySession = await sessionDevice(procs)
            if (bySession && bySession.id) {
              this.deviceInUse = bySession.id
              this.deviceLabel = bySession.name
              this.deviceSource = 'session'
              this.logger?.info?.('[soulmirror] 采集设备（会话枚举）：' + bySession.name)
            }
          } catch { /* 忽略，走下面的回退 */ }

          // 配置里记的名字可能已经失效（插拔耳机后 "耳机" 变成 "扬声器"）。
          // 先拿当前列表解析一次；解析不到就不带设备名，交给系统默认。
          const wanted = this.cfg.devices.captureAuto ? '' : this.cfg.devices.capture
          let resolved = null
          if (wanted) {
            const m = matchDevice(rows, wanted)
            if (m.device) {
              resolved = m.device
              if (m.how !== 'exact' && m.how !== 'id') {
                this.logger?.info?.('[soulmirror] 设备名已变化，按当前列表解析为：' + m.device.name + '（' + m.how + '）')
              }
            } else {
              this.logger?.warn?.('[soulmirror] 配置的设备「' + wanted + '」当前不存在，回退到自动选择')
              this.deviceStale = wanted
            }
          }

          if (this.deviceInUse) {
            // 已由会话枚举确定，跳过名字解析
          } else if (resolved) {
            this.deviceInUse = deviceRef(resolved)
            this.deviceLabel = resolved.name
            this.logger?.info?.('[soulmirror] 采集设备锁定：' + resolved.name)
          } else {
            const picked = pickCaptureDevice({ configured: '', defaultDevice: def, loud })
            this.deviceInUse = picked.device
            this.deviceLabel = picked.device
            this.logger?.info?.('[soulmirror] 采集设备锁定：' + (picked.device || '(系统默认)') + ' — ' + picked.why)
          }
        }
        if (this.deviceInUse) args.push('--device', this.deviceInUse)
        child = this.spawnFn(bridgeExe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        this.child = child // 暴露给健康检查与混沌注入（kill-capture）
        child.stderr.on('data', (b) => { this.captureLog = b.toString().trim() })
        asr = (this.createAsr || createResilientAsr)({
          apiKey: key,
          logger: this.logger,
          model: resolveAsrModel(asrCfg),
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
                if (this.deduper.isDuplicate(fixed)) {
                  this.dupSkipped = (this.dupSkipped || 0) + 1
                  this.partial = ''
                  return
                }
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
          // 断线太久：在转写里留一条可见的断点，别让纪要以为这段没人说话
          onGap: (g) => {
            const item = { t: nowIso(), text: g.text, src: 'gap', gap: true }
            this.transcript.push(item)
            appendFile(join(this.dir, 'transcript.jsonl'), JSON.stringify(item) + '\n', 'utf8').catch(() => {})
            this.lastError = '语音识别中断约 ' + Math.round((g.droppedMs || 0) / 1000) + ' 秒（已标记）'
          },
          // 健康指标：重连次数 / 丢帧 / 缓冲，供 /status 与 /health 展示
          onState: (s) => { this.asrState = s },
        })
        await asr.start()
        this.partial = ''
        // __SM_DBG=1 时打印采集管道埋点（排查"有音频但没转写"用，默认静默）
        const dbg = process.env.__SM_DBG === '1'
        let dbgChunks = 0
        child.stdout.on('data', (d) => {
          if (dbg) {
            dbgChunks += 1
            if (dbgChunks === 1 || dbgChunks % 100 === 0) {
              this.logger?.info?.('[soulmirror/dbg] 采集块 #' + dbgChunks + ' ' + d.length + ' bytes; asr.feed=' + (typeof asr?.feed))
            }
          }
          if (this._captureAttempts > 0) {
            this.logger?.info?.('[soulmirror] 采集已恢复（此前失败 ' + this._captureAttempts + ' 次）')
            this._captureAttempts = 0
          }
          try { asr.feed(d) } catch { /* ignore */ }
        })
        let childExited = false
        child.on('exit', () => { childExited = true; this.lastError = '采集进程退出，正在重启' })
        let lastLineAt = Date.now()
        // 采集静音检测：环回拿到全零说明"这个设备的环回采不到声音"（常见于 HDMI）
        // 配置里可以指定“采不到就切到哪个设备”（通常填 CABLE Input）
        const cfgForce = String(this.cfg.devices.forceCaptureDevice || '').trim()
        let silentSince = 0
        let bytesSeen = 0
        child.stdout.on('data', (d) => {
          bytesSeen += d.length
          if (this.audioFile) {
            this._audioQ = (this._audioQ || Promise.resolve())
              .then(() => appendFile(this.audioFile, d))
              .catch(() => {})
          }
          // 暴露给面板/健康检查：采集到底有没有在出数据
          this.bytes = (this.bytes || 0) + d.length
          this.lastByteAt = Date.now()
        })
        const origPush = this.transcript.push.bind(this.transcript)
        this.transcript.push = (...a) => { lastLineAt = Date.now(); return origPush(...a) }
        while (this.running && !asr.closed && !childExited) {
          await new Promise((r) => setTimeout(r, 200))
          // 会议里很少停顿 800ms，整句迟迟不落 → 中间结果超过 4 秒没变就提为正式一行，
          // 否则用户会觉得"没有实时转写"（实测能落后 20 秒以上）
          if (this.partial && this.partialAt && Date.now() - this.partialAt > 4000) {
            try { this._commitPartial('stale-partial') } catch { /* ignore */ }
          }
          // 长时间没转写：只诊断并报警，绝不自动换设备——
          // 换设备要杀掉采集进程重启，中间会丢音频，反而更像"卡住"
          if (Date.now() - lastLineAt > 20000 && !this._silenceWarned) {
            this._silenceWarned = true
            try {
              const loud = await loudestRenderDevice({ samples: 3, intervalMs: 200 })
              if (loud && loud.level > 0.02) {
                this.lastError = "采不到声音：当前设备「" + (this.deviceInUse || "默认") + "」的环回是静音，有声音的是「" + loud.name + "」，请把系统播放设备切到它"
                this.logger?.warn?.("[soulmirror] " + this.lastError)
              } else {
                this.logger?.info?.("[soulmirror] 20 秒无转写，但也没有设备在出声——可能只是没人说话")
              }
            } catch { /* ignore */ }
          }
        }
      } catch (err) {
        this.lastError = err.message
      } finally {
        try { await asr?.stop?.() } catch { /* ignore */ }
        try { child?.kill() } catch { /* ignore */ }
      }
      if (!this.running) break
      // 采集中断：指数退避重启；次数用尽就停下来并说清楚，不再无限抖
      const attempt = this._captureAttempts + 1
      if (attempt > this.backoffMs.length) {
        this.running = false
        this.lastError = '采集连续失败 ' + this.backoffMs.length + ' 次，已停止。请检查音频设备是否可用，或改用其它播放设备。'
        this.logger?.warn?.('[soulmirror] ' + this.lastError)
        break
      }
      this._captureAttempts = attempt
      const wait = this.backoffMs[attempt - 1]
      this.lastError = '采集进程退出，' + Math.round(wait / 1000) + ' 秒后第 ' + attempt + ' 次重启'
      this.logger?.info?.('[soulmirror] ' + this.lastError)
      await new Promise((r) => setTimeout(r, wait))
    }
    this.capturing = false
  }
  /** 把整场 PCM 封装成 WAV，返回路径（失败返回空串） */
  async finalizeRecording(dir, pcmName = 'audio.pcm', wavName = 'audio.wav') {
    try {
      const pcmPath = join(dir, pcmName)
      const info = await stat(pcmPath)
      if (!info || info.size < 3200) return ''
      const header = Buffer.alloc(44)
      header.write('RIFF', 0, 'ascii')
      header.writeUInt32LE(36 + info.size, 4)
      header.write('WAVE', 8, 'ascii')
      header.write('fmt ', 12, 'ascii')
      header.writeUInt32LE(16, 16)
      header.writeUInt16LE(1, 20)      // PCM
      header.writeUInt16LE(1, 22)      // 单声道
      header.writeUInt32LE(16000, 24)  // 采样率
      header.writeUInt32LE(32000, 28)  // 字节率
      header.writeUInt16LE(2, 32)      // 块对齐
      header.writeUInt16LE(16, 34)     // 位深
      header.write('data', 36, 'ascii')
      header.writeUInt32LE(info.size, 40)
      const out = join(dir, wavName)
      await writeFile(out, header)
      await appendFile(out, await readFile(pcmPath))
      return out
    } catch { return '' }
  }

  /** 把当前中间结果提升为正式一行（长时间不落句时用，保证转写不被"整句"卡住） */
  _commitPartial(reason) {
    const text = String(this.partial || '').trim()
    if (text.length < 8) return false
    const last = this.transcript[this.transcript.length - 1]
    if (last && last.text === text) { this.partial = ""; return false }
    if (this.deduper.isDuplicate(text)) {
      this.dupSkipped = (this.dupSkipped || 0) + 1
      this.partial = ""
      return false
    }
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
    // 等最后一笔音频写完，再封装 WAV（会后离线重转写要用）
    try { await this._audioQ } catch { /* ignore */ }
    let wav = ''
    try { wav = await this.finalizeRecording(this.dir) } catch { wav = '' }
    this.audioWav = wav
    return { ok: true, chunks: this.chunks, dir: this.dir, audio: wav }
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
      captureDevice: this.deviceInUse || '',
      asr: this.asrState || { phase: 'idle', reconnects: 0, droppedMs: 0, bufferedMs: 0 },
      partialLen: (this.partial || '').length,
      dupSkipped: this.dupSkipped || 0,
      bytes: this.bytes || 0,
      lastByteAt: this.lastByteAt || 0,
    }
  }
}
