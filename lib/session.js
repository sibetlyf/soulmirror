import { diagnoseCapture, compareCaptureWithLoud, captureVerdict } from './capture-guard.js'
import { mkdir, writeFile, readFile, stat, unlink } from 'node:fs/promises'
import { createReadStream, createWriteStream, existsSync, appendFileSync } from 'node:fs'
import { resolveDshHome } from './profile-path.js'
import { pipeline } from 'node:stream/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
/** DSH 根目录（跟随实例安装位置，不写死 homedir） */
function dshHome() {
  try {
    return resolveDshHome({ selfUrl: import.meta.url, env: process.env, homeDir: homedir(), exists: existsSync, join }) || join(homedir(), '.dsh')
  } catch {
    return join(homedir(), '.dsh')
  }
}

import { spawn } from 'node:child_process'

// 采集进程的重启退避（毫秒）：越失败越慢，防止抖动
const CAPTURE_BACKOFF_MS = [800, 2000, 4000, 8000, 15000]
import { bridge, bridgeExe, ensureBridge, listDevices, loudestRenderDevice, defaultRenderDevice, pickCaptureDevice } from './bridge.js'

/**
 * 连续静音时"要不要换采集设备"的决策（纯函数，便于测试）。
 * 只有"确实有另一个设备在出声"且"它不是当前设备"时才换；
 * 没人说话（所有设备都静音）绝不换——换了只是把静音搬到另一个端点。
 */
export function recoverDeviceDecision({ currentDevice = '', loud = null, minLevel = 0.02 } = {}) {
  const name = loud && loud.name ? String(loud.name) : ''
  const level = Number(loud && (loud.level != null ? loud.level : loud.peak)) || 0
  if (!name) return { swap: false, reason: 'no-device-playing' }
  if (level < minLevel) return { swap: false, reason: 'playing-but-too-quiet:' + level.toFixed(3) }
  if (currentDevice && String(currentDevice) === name) return { swap: false, reason: 'already-on-playing-device' }
  return { swap: true, name, level, reason: 'sound-on-another-device:' + name }
}
import { startDashScopeAsr } from './dashscope.js'
import { createResilientAsr } from './asr-stream.js'
import { TranscriptDeduper, similarText } from './dedupe.js'
import { shouldMerge, joinTexts } from './segment-merge.js'
import { resolveAsrModel } from './asr-model.js'
import { matchDevice, deviceRef } from './resolve-device.js'
import { sessionDevice } from './bridge.js'
import { toSimplified } from './t2s.js'
import { transcribeWav, removeFile, boostWav } from './asr.js'
// 双路采集：环回 + 麦克风（会议客户端不会把自己的声音再放到输出，只采环回会漏掉用户自己）
import { PcmMixer, mixPcm16, wavFromPcm, pcmFromWav, BYTES_PER_MS } from './audio-mix.js'
import { resolveDashScopeKey } from './env.js'
import { synthesize, playWav } from './tts.js'

const nowIso = () => new Date().toISOString()
/** 把任意失败原因变成一句能写进日志/状态的话（null 也要有原因，不能空着） */
const reasonOf = (e) => (e && e.message ? e.message : String(e == null ? '未知原因' : e))

export class MeetingSession {
  constructor(cfg, logger, deps = {}) {
    this.cfg = cfg
    this.logger = logger
    // 可注入的进程工厂：测试里换成假的，就能验证"采集死了会不会恢复、会不会抖动"
    this.spawnFn = deps.spawnFn || spawn
    this.createAsr = deps.createAsr || null
    this.appendSync = deps.appendFileSync || appendFileSync
    this.onEvent = deps.onEvent || null
    // Desktop probes are injectable too: fake capture/ASR alone does not isolate tests.
    this.loudestRenderDevice = deps.loudestRenderDevice || loudestRenderDevice
    this.defaultRenderDevice = deps.defaultRenderDevice || defaultRenderDevice
    this.listDevices = deps.listDevices || listDevices
    this.sessionDevice = deps.sessionDevice || sessionDevice
    this.ensureBridge = deps.ensureBridge || ensureBridge
    // 取 Key 必须和体检走同一条路（凭据库 → 统一 Key → 配置 → 环境变量）。
    // 以前这里只看 cfg.asr.apiKey + 环境变量，体检却看凭据库，于是
    // 体检显示链路就绪、采集却报缺少密钥。
    this.getKey = typeof deps.getKey === 'function' ? deps.getKey : null
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
    // 用户是否"想要在采集"：与 running 分开，才能在崩溃后自动恢复
    this.wanted = false
    this.captureFailed = false
    this.recoveries = 0
    this.silentSec = 0          // 连续多少秒采到的是全零（端点没声音）
    this._silentAcc = 0
    this._recoverTimer = null
    // 双路采集（环回 + 麦克风）：混音器只在流式路径存在，分片路径用 mixPcm16 逐窗口混
    this.mixer = null
    this.micChild = null
    this.micRunning = false
    this.micDeviceLabel = ''
    this.mixWarn = ''
    this._mixDroppedSeen = 0
    this._mixCounters = { aBytes: 0, bBytes: 0, droppedA: 0, droppedB: 0, dropped: 0, pulledBytes: 0, resyncs: 0 }
  }

  /** 麦克风那一路的设备选择：空 = 系统默认采集端点（mbridge 的 FindDevice(1, default)） */
  _micDeviceSel() {
    return String((this.cfg.devices && this.cfg.devices.micDevice) || '').trim()
  }

  /** 界面/状态里显示的麦克风设备名（没配置也如实说"系统默认采集设备"，不假装知道具体名字） */
  _micDeviceLabel() {
    return this._micDeviceSel() || '系统默认采集设备'
  }

  /**
   * 是否走「环回 + 麦克风」双路。
   *
   * 只有显式开启（devices.mixMic === true）才走：默认值由 Config schema 与 apply() 的
   * cfg 归一化成 true；但直接构造 Session 的旧调用方/测试不会被悄悄多起一条采集进程
   * （这是"mixMic=false 时行为与现在完全一致"的硬要求）。
   *
   * captureMode === 'device' 时不叠加：那时采的本来就是麦克风，
   * 再叠一路麦克风只会把同一句话录两遍（转写会出现重复）。
   */
  mixMicEnabled() {
    const d = this.cfg.devices || {}
    if (d.mixMic !== true) return false
    return String(d.captureMode || 'loopback') === 'loopback'
  }

  /** 状态投影里的混音统计：流式路径看实时混音器，分片路径看逐窗口计数 */
  _mixStatsSnapshot() {
    if (this.mixer) {
      const s = this.mixer.stats()
      return {
        aBytes: s.aBytes, bBytes: s.bBytes,
        droppedA: s.droppedA, droppedB: s.droppedB, dropped: s.dropped,
        pulledBytes: s.pulledBytes, resyncs: s.paddedPulls,
        bufferedA: s.bufferedA, bufferedB: s.bufferedB,
      }
    }
    return { ...this._mixCounters }
  }

  dataRoot() {
    return this.cfg.dataDir || join(dshHome(), 'soulmirror')
  }

  /** 与体检一致的取 Key；返回空串表示确实没有 */
  resolveAsrKey() {
    const asrCfg = this.cfg.asr || {}
    let k = ''
    try { k = this.getKey ? (this.getKey() || '') : '' } catch { k = '' }
    return resolveDashScopeKey({ ...asrCfg, apiKey: k || asrCfg.apiKey }).key || ''
  }

  _event(type, data = {}) {
    // Hook must synchronously persist before returning. A rejected hook is never ignored.
    const result = this.onEvent?.(type, data)
    if (result && typeof result.then === 'function') throw new Error('onEvent 必须同步落盘，不能返回 Promise')
  }

  _reportError(message, type = 'capture.error', data = {}) {
    try { this._event(type, { run: this.dir || undefined, error: message, ...data }) }
    catch (e) { message += '；状态日志写入失败：' + e.message }
    this.lastError = message
    this.logger?.warn?.('[soulmirror] ' + message)
    return { ok: false, error: message }
  }

  async startCapture(label) {
    if (this.capturing) return { ok: true, already: true }
    if (this.cfg.asr?.provider === 'dashscope' && !this.resolveAsrKey()) {
      return this._reportError('缺少百炼 Key：在「设置 → 会议助手」填写，或设置环境变量 ' + (this.cfg.asr.apiKeyEnv || 'DASHSCOPE_API_KEY'), 'capture.fail')
    }
    try {
      await this._closeAudioStream()
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const dir = join(this.dataRoot(), stamp + (label ? '-' + label : ''))
      await mkdir(dir, { recursive: true })
      const audioFile = join(dir, 'audio.pcm')
      await writeFile(audioFile, Buffer.alloc(0))
      this._event('capture.start', { run: dir, reason: label || 'manual' })
      this.dir = dir
      this.audioFile = audioFile
      this.audioWav = ''
      this.transcript = []
      this.bytes = 0
      this.lastByteAt = 0
      this.silentSec = 0
      this._silentAcc = 0
      this.silentChunks = 0
      this.audioDropped = 0
      this.partial = ''
      this.partialAt = 0
      this._silenceWarned = false
      this._lastDeviceCheck = 0
      this.deduper = new TranscriptDeduper({ windowMs: 8000 })
      this.lastError = ''
      // 双路：上一场的混音器/计数不能带进这一场，否则界面上会有"上场的麦克风还在跑"
      this.mixer = null
      this.micChild = null
      this.micRunning = false
      this.micDeviceLabel = ''
      this.mixWarn = ''
      this._mixDroppedSeen = 0
      this._mixCounters = { aBytes: 0, bBytes: 0, droppedA: 0, droppedB: 0, dropped: 0, pulledBytes: 0, resyncs: 0 }
      this.running = this.capturing = this.wanted = true
      this.captureFailed = false
      this.recoveries = this.chunks = this._captureAttempts = 0
      this.startedAt = nowIso()
      this._loop = this.cfg.asr.provider === 'dashscope' ? this._streamLoop() : this._loopBody()
      return { ok: true, dir }
    } catch (e) {
      return this._reportError('录音启动失败：' + e.message, 'capture.fail')
    }
  }

  /**
   * 分片（whisper）路径的双路采集：同一时间窗口**并行**录两份，再把两路 PCM 相加成一个 WAV。
   *
   * 为什么必须并行：串行跑会把时间轴拉长一倍，两段音频就对不上会议里的真实先后。
   * 为什么失败不整体失败：任一路挂掉只写清原因、用另一路继续转写——
   * 麦克风断了不该让整个会议记录停掉，环回断了也不该让用户自己的发言白录。
   */
  async _captureWindowBoth(loopArgs, { wav, micWav, chunkSeconds, timeoutMs }) {
    const micSel = this._micDeviceSel()
    const micArgs = ['capture', '--out', micWav, '--seconds', String(chunkSeconds),
      ...(micSel ? ['--device', micSel] : []),
      '--mode', 'device']
    this.micDeviceLabel = this._micDeviceLabel()
    const [rl, rm] = await Promise.allSettled([
      bridge(loopArgs, { timeoutMs }),
      bridge(micArgs, { timeoutMs }),
    ])
    const loopOk = rl.status === 'fulfilled'
    const micOk = rm.status === 'fulfilled'
    const loopErr = loopOk ? '' : reasonOf(rl.reason)
    const micErr = micOk ? '' : reasonOf(rm.reason)
    this.micRunning = micOk
    if (!loopOk && !micOk) {
      throw new Error('环回与麦克风两路都失败：环回：' + loopErr + '；麦克风：' + micErr +
        '。请检查设备是否被独占，或在「设置 → 采集」换一个采集/麦克风设备')
    }
    if (!micOk) {
      this.lastError = '麦克风路失败，这一片只有环回（转写里可能没有你自己的发言）：' + micErr
      this.logger?.warn?.('[soulmirror] ' + this.lastError)
    } else if (!loopOk) {
      this.lastError = '环回那一路失败，这一片只用麦克风（可能少了会议里别人的声音）：' + loopErr
      this.logger?.warn?.('[soulmirror] ' + this.lastError)
    }
    if (!loopOk && !micOk) throw new Error('两路都没有可混的录音文件')
    // 混音与临时文件清理统一走 _mixWindowFiles（同一份逻辑，单独可测）
    const r = await this._mixWindowFiles(wav, micWav, { loopOk, micOk })
    return 'mixed loop=' + r.loopBytes + ' mic=' + r.micBytes + ' out=' + r.mixedBytes
  }

  /**
   * 把同一时间窗口的两份 WAV 混成一份（只做文件读写，不碰设备，可单独测）。
   * 任一路缺失就用另一路原样写回：这条路失败不该让整片转写消失。
   */
  async _mixWindowFiles(wav, micWav, { loopOk = true, micOk = true } = {}) {
    const readPcm = async (path, ok, label) => {
      if (!ok) return Buffer.alloc(0)
      try { return pcmFromWav(await readFile(path)) }
      catch (e) { throw new Error(label + '的采集文件读不出来：' + e.message) }
    }
    const loopPcm = await readPcm(wav, loopOk, '环回')
    const micPcm = await readPcm(micWav, micOk, '麦克风')
    if (loopPcm.length) this._mixCounters.aBytes += loopPcm.length
    if (micPcm.length) this._mixCounters.bBytes += micPcm.length
    const mixedPcm = mixPcm16(loopPcm, micPcm, { clip: true })
    await writeFile(wav, wavFromPcm(mixedPcm, { sampleRate: 16000 }))
    await removeFile(micWav)
    return { loopBytes: loopPcm.length, micBytes: micPcm.length, mixedBytes: mixedPcm.length }
  }

  async _loopBody() {
    const chunkSeconds = Math.max(3, Math.min(30, this.cfg.asr.chunkSeconds || 6))
    const silenceRms = Number(this.cfg.silenceRms ?? 0.004)
    while (this.running) {
      const idx = String(this.chunks).padStart(4, '0')
      const wav = join(this.dir, `chunk-${idx}.wav`)
      const micWav = join(this.dir, `chunk-${idx}.mic.wav`)
      try {
        const timeoutMs = (chunkSeconds + 15) * 1000
        const dev = this.deviceInUse || this.cfg.devices.capture
        const loopArgs = ['capture', '--out', wav, '--seconds', String(chunkSeconds),
          ...(dev ? ['--device', dev] : []),
          '--mode', this.cfg.devices.captureMode || 'loopback']
        let out
        if (!this.mixMicEnabled()) {
          // 单路：与改动前完全一致（一次 bridge、一份 WAV）
          out = await bridge(loopArgs, { timeoutMs })
          this.micRunning = false
        } else {
          out = await this._captureWindowBoth(loopArgs, { wav, micWav, chunkSeconds, timeoutMs })
        }
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
        // 自愈：连续静音说明"采的那个端点没声音"。测一下此刻哪个设备在出声，
        // 若有声音在别的端点就直接切过去（下一次循环即生效），别让用户自己发现并重开。
        if (!this._realigning) {
          this._realigning = true
          try {
            const loudNow = await this.loudestRenderDevice({ samples: 3, intervalMs: 200 })
            const decision = recoverDeviceDecision({
              currentDevice: this.deviceLabel || this.deviceInUse || this.cfg.devices.capture || '',
              loud: loudNow,
            })
            if (decision.swap) {
              const rowsNow = await this.listDevices().then((d) => (Array.isArray(d) ? d : [])).catch(() => [])
              const dev = rowsNow.filter((x) => x.flow === 'RENDER').find((x) => String(x.name || '') === decision.name)
              if (dev) {
                this.deviceInUse = deviceRef(dev)
                this.deviceLabel = dev.name
                this.lastError = '连续 3 片静音：已自动切到「' + dev.name + '」（此刻在出声的设备，电平 ' + (decision.level || 0).toFixed(2) + '）'
                this.logger?.info?.('[soulmirror] ' + this.lastError)
              }
            } else {
              this.logger?.info?.('[soulmirror] 连续静音但不换设备：' + decision.reason)
            }
          } catch { /* 探测失败就保持原提示 */ }
          finally { this._realigning = false }
        }
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
          this._pushLine({ t, text: r.text, rms })
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
  /** 采集崩溃后的慢速自动恢复：60 秒一次，最多 20 次（约 20 分钟） */
  _scheduleRecover() {
    if (this._recoverTimer) return
    this._recoverTimer = setTimeout(() => {
      this._recoverTimer = null
      if (!this.wanted || this.running) return
      this.recoveries += 1
      this.logger?.info?.('[soulmirror] 自动恢复采集（第 ' + this.recoveries + ' 次）')
      this.captureFailed = false
      this._captureAttempts = 0
      this.running = true
      this.capturing = true
      const loop = this.cfg.asr.provider === 'dashscope' ? this._streamLoop() : this._loopBody()
      this._loop = Promise.resolve(loop).catch(() => undefined)
    }, 60 * 1000)
    this._recoverTimer.unref?.()
  }

  async _streamLoop() {
    const asrCfg = this.cfg.asr
    // 进程环境 → 配置 → Windows 用户级环境变量，三级兜底
    const key = this.resolveAsrKey()
    if (!key) {
      this.lastError = `缺少密钥：环境变量 ${asrCfg.apiKeyEnv || 'DASHSCOPE_API_KEY'} 未设置`
      this.running = false
      this.capturing = false
      return
    }
    while (this.running) {
      let child = null
      // 双路：这两条子进程/混音器必须声明在 try 之外，否则 finally 里访问不到（块作用域事故）
      let micChild = null
      let mixer = null
      let micRunning = false
      let micGaveUp = false
      let micRetryAt = 0
      let micRestarts = 0
      let asr = null
      try {
        const args = ['capture-stream', '--mode', this.cfg.devices.captureMode || 'loopback']
        // 采集设备：启动时定一次，本次会话锁定，之后永不自动切换
        //   1) 配置显式指定  2) 正在出声的设备  3) 系统默认播放设备
        if (!this.deviceInUse) {
          let def = ''
          try { def = await this.defaultRenderDevice() } catch { /* ignore */ }
          let loud = null
          try { loud = await this.loudestRenderDevice({ samples: 3, intervalMs: 200 }) } catch { /* ignore */ }

          let rows = []
          try { rows = (await this.listDevices()).filter((d) => d.flow === 'RENDER') } catch { /* ignore */ }

          // 最可靠的一步：问系统"会议进程正在往哪个端点放声音"。
          // 设备名会变（插拔耳机），但"进程 → 端点"是系统事实。
          try {
            const procs = this.cfg.meetingProcs && this.cfg.meetingProcs.length
              ? this.cfg.meetingProcs
              : [this.cfg.processName || 'wemeetapp', 'CloudVideo', 'Feishu', 'DingTalk', 'Teams', 'ms-teams', 'Zoom', 'WXWork']
            const bySession = await this.sessionDevice(procs)
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
        // 实测校验：当场测"现在哪个设备在出声"，与采集设备比对。
        // 不靠名字猜，靠电平测——虚拟端点本身没错，错的是"采的不是出声的那个"。
        try {
          const loud = await this.loudestRenderDevice({ samples: 3, intervalMs: 150 })
          const cmp = compareCaptureWithLoud({
            capture: String(this.cfg.devices.capture || '') || this.deviceLabel || '',
            loud,
          })
          if (!cmp.ok) {
            this.lastError = cmp.reason + '。' + cmp.suggestion
            this.captureDiagnosis = cmp
            this.logger?.warn?.('[soulmirror] ' + this.lastError)
            // 不需要用户手动救：如果配置允许自动跟随，就直接把采集切到出声的那个设备
            if (this.cfg.devices.captureAuto !== false && loud && loud.name) {
              try {
                // listDevices 返回扁平数组（flow/index/name/id），不是 {render,capture}；
                // 形状用错会让这里永远返回 null，自动切换静默失效。
                const resolved = await this.listDevices().then((d) =>
                  (Array.isArray(d) ? d : []).filter((x) => x.flow === 'RENDER')
                    .find((x) => String(x.name || '') === String(loud.name)),
                ).catch(() => null)
                if (resolved) {
                  this.deviceInUse = deviceRef(resolved)
                  this.deviceLabel = resolved.name
                  this.lastError = ''
                  this.logger?.info?.('[soulmirror] 已自动把采集切到正在出声的设备：' + resolved.name)
                }
              } catch { /* 自动切换失败就保留提示 */ }
            }
          } else if (cmp.level === 'warn') {
            this.captureDiagnosis = cmp
            this.logger?.info?.('[soulmirror] 采集提示：' + cmp.reason + '。' + cmp.suggestion)
          } else {
            this.captureDiagnosis = { ok: true, level: 'ok' }
          }
        } catch { /* 测不到电平就跳过，不影响采集 */ }
        if (this.deviceInUse) args.push('--device', this.deviceInUse)
        // 先确认 mbridge.exe 可用（缺了就尝试编译一次）。
        // 事故：全新安装缺这个 exe 时，spawn 抛 ENOENT，而 child 没有 error 监听，
        // 未捕获异常直接把整个 DSH 进程打崩——不是"采集失败"，是"应用闪退"。
        const bridgeCheck = this.ensureBridge({ logger: this.logger })
        if (!bridgeCheck.ok) {
          this.lastError = '采集组件不可用：' + bridgeCheck.error
          this.captureFailed = true
          this.running = false
          this.capturing = false
          this.logger?.error?.('[soulmirror] ' + this.lastError)
          return
        }

        child = this.spawnFn(bridgeExe, args, { stdio: ['ignore', 'pipe', 'pipe'] })
        this.child = child // 暴露给健康检查与混沌注入（kill-capture）
        // spawn 的 ENOENT/EACCES 是异步事件，不监听就会变成未捕获异常
        child.on('error', (err) => {
          this.lastError = '采集进程启动失败：' + (err && err.message ? err.message : String(err))
          this.captureFailed = true
          this.logger?.error?.('[soulmirror] ' + this.lastError)
        })
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
                this._pushLine(item)
              } else {
                this.partial = fixed
                this.partialAt = Date.now()
              }
            }).catch(() => {})
          },
          onError: (e) => { this.lastError = e.message },
          // 断线太久：在转写里留一条可见的断点，别让纪要以为这段没人说话
          onGap: (g) => this._recordGap(g),
          // 健康指标：重连次数 / 丢帧 / 缓冲，供 /status 与 /health 展示
          onState: (s) => {
            try { this._event('runtime.asr', { run: this.dir, state: s }); this.asrState = s }
            catch (e) { this.lastError = '识别状态日志写入失败：' + e.message }
          },
        })
        await asr.start()
        this.partial = ''
        // __SM_DBG=1 时打印采集管道埋点（排查"有音频但没转写"用，默认静默）
        const dbg = process.env.__SM_DBG === '1'
        let dbgChunks = 0
        let dbgMicChunks = 0
        let bytesSeen = 0
        const noteRecovered = () => {
          if (this._captureAttempts > 0) {
            this.logger?.info?.('[soulmirror] 采集已恢复（此前失败 ' + this._captureAttempts + ' 次）')
            this._captureAttempts = 0
          }
        }
        // 送进识别的每一块音频统一记账（单路/双路共用）。
        // 双路时记的是**混音结果**：录音文件、字节数、端点静音判定与喂给 ASR 的是同一份数据；
        // 否则录音里没有用户自己的声音，状态上却显示"在采"，又变成一套互相矛盾的状态。
        const noteChunk = (d) => {
          bytesSeen += d.length
          this._writeAudio(d)
          // 暴露给面板/健康检查：采集到底有没有在出数据
          this.bytes = (this.bytes || 0) + d.length
          this.lastByteAt = Date.now()
          // 端点静音检测：全零说明会议声音没进这个端点（换设备 / 独占 / 没人说话）
          if (!Buffer.isBuffer(d) || d.length < 2) return
          let loud = false
          for (let i = 0; i + 1 < d.length; i += 2) {
            if (d.readInt16LE(i) !== 0) { loud = true; break }
          }
          if (loud) {
            this._silentAcc = 0
            this.silentSec = 0
            this._silenceWarned = false   // 有声音了 → 允许下次再报，而不是一次之后就沉默
          } else {
            this._silentAcc += d.length / BYTES_PER_MS // 16k 单声道 16bit ≈ 32 字节/毫秒
            this.silentSec = Math.round(this._silentAcc / 1000)
          }
        }
        const feedAsr = (d) => {
          try { asr.feed(d) } catch (e) {
            // 不能吞成空 catch：喂不进去就是识别断了，必须留下原因
            this.lastError = '送进识别的音频失败：' + reasonOf(e)
            this.logger?.warn?.('[soulmirror] ' + this.lastError)
          }
        }
        // 每个混音块固定 100ms（16k 单声道 16bit = 3200 字节）：
        // 两路都到齐这么久才混，对齐最稳，也不会把 ASR 切成碎渣。
        const MIX_BLOCK = 3200
        const mixEnabled = this.mixMicEnabled()
        if (mixEnabled) {
          mixer = new PcmMixer({ clip: true })
          this.mixer = mixer
          this.micDeviceLabel = this._micDeviceLabel()
        }
        const flushMix = () => {
          if (!mixer) return
          let out = null
          while ((out = mixer.pull(MIX_BLOCK))) {
            noteRecovered()
            feedAsr(out)
            noteChunk(out)
          }
        }
        /**
         * 起麦克风那一路（capture-stream --mode device → mbridge 的 FindDevice(1,…)）。
         * 失败/退出只影响"能不能听见你自己"：环回还在跑，整场采集不能因此判死。
         */
        const startMic = () => {
          const margs = ['capture-stream', '--mode', 'device']
          const sel = this._micDeviceSel()
          if (sel) margs.push('--device', sel)
          const c = this.spawnFn(bridgeExe, margs, { stdio: ['ignore', 'pipe', 'pipe'] })
          this.micChild = c
          let ended = false
          c.on('error', (err) => {
            if (ended) return
            ended = true
            // 迟到的旧进程事件：已经起过新进程了，不能把新进程判成"没在跑"
            if (this.micChild !== c) return
            micRunning = false
            this.micRunning = false
            micRetryAt = Date.now() + 800
            if (mixer) mixer.setActive('b', false)
            if (!this.running) return
            this.lastError = '麦克风路启动失败：' + reasonOf(err) +
              '；当前只有环回，你自己的发言不会进转写（可在「设置 → 采集」换一个麦克风设备，或关掉「同时录我的麦克风」）'
            this.logger?.error?.('[soulmirror] ' + this.lastError)
          })
          c.stderr.on('data', (b) => { this.micLog = b.toString().trim() })
          c.on('exit', () => {
            if (ended) return
            ended = true
            if (this.micChild !== c) return
            micRunning = false
            this.micRunning = false
            micRetryAt = Date.now() + 800
            if (mixer) mixer.setActive('b', false)
            // 正常停止（running=false）时不改写 lastError，否则"结束录音"会被这句覆盖
            if (!this.running) return
            this.lastError = '麦克风路中断，当前只有环回（转写里可能没有你自己的发言）；正在尝试重新采集麦克风'
            this.logger?.warn?.('[soulmirror] ' + this.lastError)
          })
          c.stdout.on('data', (d) => {
            if (dbg) {
              dbgMicChunks += 1
              if (dbgMicChunks === 1 || dbgMicChunks % 100 === 0) {
                this.logger?.info?.('[soulmirror/dbg] 麦克风块 #' + dbgMicChunks + ' ' + d.length + ' bytes')
              }
            }
            if (!mixer) return
            mixer.push('b', d)
            flushMix()
          })
          micRunning = true
          this.micRunning = true
          this.micDeviceLabel = this._micDeviceLabel()
          return c
        }
        child.stdout.on('data', (d) => {
          if (dbg) {
            dbgChunks += 1
            if (dbgChunks === 1 || dbgChunks % 100 === 0) {
              this.logger?.info?.('[soulmirror/dbg] 采集块 #' + dbgChunks + ' ' + d.length + ' bytes; asr.feed=' + (typeof asr?.feed))
            }
          }
          if (mixEnabled) {
            // 双路：环回先进混音器攒着，等麦克风也够一块再混 → 送识别的是混音结果
            if (mixer) { mixer.push('a', d); flushMix() }
            return
          }
          noteRecovered()
          feedAsr(d)
          noteChunk(d)
        })
        if (mixEnabled) {
          try {
            micChild = startMic()
            this.logger?.info?.('[soulmirror] 双路采集：环回 + 麦克风（' + this._micDeviceLabel() + '）')
          } catch (e) {
            micRunning = false
            this.micRunning = false
            micRetryAt = Date.now() + 800
            if (mixer) mixer.setActive('b', false)
            this.lastError = '麦克风路启动失败：' + reasonOf(e) + '；当前只有环回，你自己的发言不会进转写'
            this.logger?.error?.('[soulmirror] ' + this.lastError)
          }
        }
        let childExited = false
        // 主动停止时 running 已经是 false：不要把"我让你停"写成"进程退出，正在重启"（会误导用户）
        child.on('exit', () => {
          childExited = true
          if (this.running) this.lastError = '采集进程退出，正在重启'
        })
        let lastLineAt = Date.now()
        // 采集静音检测：环回拿到全零说明"这个设备的环回采不到声音"（常见于 HDMI）
        // 配置里可以指定“采不到就切到哪个设备”（通常填 CABLE Input）
        const cfgForce = String(this.cfg.devices.forceCaptureDevice || '').trim()
        // 采集配置体检：把设备选成虚拟声卡"输入端"是常见陷阱——
        // 那条通道只会回放我们主动播进去的 TTS，会议声音走扬声器，录到的是纯静音。
        // 不在这里拦，用户会拿到一段 20 分钟的全静音录音，还以为是识别坏了。
        try {
          const dg = diagnoseCapture({
            capture: this.cfg.devices.capture,
            speak: this.cfg.devices.speakDevice || this.cfg.devices.speak,
            captureAuto: this.cfg.devices.captureAuto,
          })
          if (!dg.ok) {
            this.lastError = '采集设备有问题（' + dg.reason + '）：' + dg.suggestion
            this.captureDiagnosis = dg
            this.logger?.warn?.('[soulmirror] ' + this.lastError)
          } else if (dg.level === 'warn') {
            this.captureDiagnosis = dg
            this.logger?.info?.('[soulmirror] 采集提示：' + dg.reason + '。' + dg.suggestion)
          }
        } catch { /* 体检失败不影响采集 */ }
        const origPush = this.transcript.push.bind(this.transcript)
        this.transcript.push = (...a) => { lastLineAt = Date.now(); return origPush(...a) }
        while (this.running && !asr.closed && !childExited) {
          await new Promise((r) => setTimeout(r, 200))
          // 麦克风那一路独立重启：环回还在采，不能因为麦克风断了就把整场重来。
          // 用循环里的"到点再试"而不是额外 timer —— 少一个需要清理的句柄。
          if (mixEnabled && !micRunning && !micGaveUp && Date.now() >= micRetryAt) {
            micRestarts += 1
            if (micRestarts > this.backoffMs.length + 2) {
              micGaveUp = true
              this.lastError = '麦克风路连续 ' + micRestarts + ' 次起不来，已放弃这一段；当前只有环回，你自己的发言不会进转写。' +
                '可在「设置 → 采集」换一个麦克风设备，或关掉「同时录我的麦克风」'
              this.logger?.warn?.('[soulmirror] ' + this.lastError)
            } else {
              try {
                if (micChild) { try { micChild.kill() } catch { /* 已经退出了 */ } }
                // 两路重启时刻不同，相对偏移已经不可知：清空缓冲重新对齐。
                // 宁可有 ≤1 块的缝隙，也不要把错位的两份声音混在一起（错位听起来是重影/回声）。
                if (mixer) { mixer.reset(); mixer.setActive('b', true) }
                micChild = startMic()
                this.lastError = '麦克风路已恢复：环回 + 麦克风同时采集'
                this.logger?.info?.('[soulmirror] ' + this.lastError)
              } catch (e) {
                micRunning = false
                this.micRunning = false
                const waitMs = this.backoffMs[Math.min(micRestarts - 1, this.backoffMs.length - 1)] || 2000
                micRetryAt = Date.now() + waitMs
                this.lastError = '麦克风路重启失败（' + Math.round(waitMs / 1000) + ' 秒后再试）：' + reasonOf(e) + '；当前只有环回'
                this.logger?.warn?.('[soulmirror] ' + this.lastError)
              }
            }
          }
          // 混音丢了音频必须可见（不能只躺在统计里）：直接点名是哪一路掉队。
          // 用独立的 mixWarn 而不是覆盖 lastError：lastError 留给"哪一路断了"这种更根本的原因，
          // 否则"麦克风路中断"会被下一句丢弃统计冲掉，用户看到的原因就错了。
          if (mixer) {
            const st = mixer.stats()
            if (st.dropped > this._mixDroppedSeen) {
              const delta = st.dropped - this._mixDroppedSeen
              this._mixDroppedSeen = st.dropped
              const who = st.droppedB > st.droppedA ? '麦克风' : '环回'
              const msg = '混音丢弃 ' + delta + ' 字节：' + who + '那一路过慢或中断，这段里可能少了' +
                (who === '麦克风' ? '你自己的发言' : '会议里别人的声音') + '（累计 ' + st.dropped + ' 字节）'
              this.mixWarn = msg
              this.logger?.warn?.('[soulmirror] ' + msg)
              // 两路都还在跑却丢了数据 → 这才是"变慢"的真问题，放进 lastError；
              // 一路已经断了时原因由断线那句负责，避免互相覆盖。
              if (micRunning) this.lastError = msg
            }
          }
          // 会议里很少停顿 800ms，整句迟迟不落 → 中间结果超过 4 秒没变就提为正式一行，
          // 否则用户会觉得"没有实时转写"（实测能落后 20 秒以上）
          if (this.partial && this.partialAt && Date.now() - this.partialAt > 4000) {
            try { this._commitPartial('stale-partial') } catch { /* ignore */ }
          }
          // 设备巡检：采集静音 != 会议静音。
          // 每 30 秒测一次"哪个设备在出声"，若采的不是它 → 明确报错并（配置允许时）自动纠正。
          // 光靠"20 秒无转写"不够：ASR 对静音会幻听出句子，看起来"有转写"，实际全是废话。
          if (!this._lastDeviceCheck || Date.now() - this._lastDeviceCheck > 30000) {
            this._lastDeviceCheck = Date.now()
            try {
              const silentNow = (this.silentSec || 0) >= 8
              if (silentNow) {
                const loud = await this.loudestRenderDevice({ samples: 2, intervalMs: 150 })
                const cmp = compareCaptureWithLoud({
                  capture: String(this.cfg.devices.capture || '') || this.deviceLabel || '',
                  loud,
                })
                if (!cmp.ok) {
                  this.lastError = cmp.reason + '。' + cmp.suggestion
                  this.captureDiagnosis = cmp
                  this.logger?.warn?.('[soulmirror] ' + this.lastError)
                  if (this.cfg.devices.captureAuto !== false && loud && loud.name) {
                    const resolved = await this.listDevices().then((d) =>
                      (Array.isArray(d) ? d : []).filter((x) => x.flow === 'RENDER')
                        .find((x) => String(x.name || '') === String(loud.name)),
                    ).catch(() => null)
                    if (resolved) {
                      // 只改配置并标记需要重启采集：真正换设备必须重启采集进程
                      this.deviceInUse = deviceRef(resolved)
                      this.deviceLabel = resolved.name
                      this.lastError = '已切到「' + resolved.name + '」，请停止并重新开始采集以生效'
                      this.logger?.info?.('[soulmirror] ' + this.lastError)
                    }
                  }
                } else if (cmp.level === 'ok' && this.lastError && /采集设备|不是同一个端点/.test(this.lastError)) {
                  this.lastError = ''
                }
              }
            } catch { /* 巡检失败不影响采集 */ }
          }
          // 长时间没转写：只诊断并报警，绝不自动换设备——
          // 换设备要杀掉采集进程重启，中间会丢音频，反而更像"卡住"
          if (Date.now() - lastLineAt > 20000 && !this._silenceWarned) {
            this._silenceWarned = true
            try {
              const loud = await this.loudestRenderDevice({ samples: 3, intervalMs: 200 })
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
        // 麦克风那一路也要一起收掉，否则停止采集后它还占着设备
        try { micChild?.kill() } catch { /* ignore */ }
        micRunning = false
        this.micRunning = false
        this.micChild = null
      }
      if (!this.running) break
      // 采集中断：指数退避重启；次数用尽就停下来并说清楚，不再无限抖
      const attempt = this._captureAttempts + 1
      if (attempt > this.backoffMs.length) {
        this.running = false
        this.captureFailed = true
        this.lastError = '采集连续失败 ' + this.backoffMs.length + ' 次，已暂停；60 秒后自动重试（已重试 ' + this.recoveries + ' 次）。请检查音频设备。'
        this.logger?.warn?.('[soulmirror] ' + this.lastError)
        // 崩溃后不能永久躺平：用户可能只是插拔了耳机 / 会议换了输出设备
        if (this.wanted && this.recoveries < 20) this._scheduleRecover()
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
  /**
   * 把整场 PCM 封装成 WAV，返回路径（失败返回空串）。
   *
   * 用流式拷贝而不是 readFile：
   *  - 一场 40 分钟的录音 43MB，readFile 会让峰值再抬 43MB（叠加 Blob/上传就很危险）
   *  - 转完把 .pcm 删掉，磁盘上只留一个音频文件（"不要产生很多临时文件"）
   */
  /**
   * 音频落盘：常开写流 + 积压上限。
   *
   * 事故：原来是"每个音频块都 appendFile"，并且用 this._audioQ = this._audioQ.then(...)
   * 串起来。磁盘一慢（杀软扫描、机械盘、同时还在写大文件），这条 Promise 链会无限增长，
   * 每个待写块（16~32KB）连同闭包都留在内存里 —— 长时间会议足以堆到几个 GB。
   *
   * 现在：常开一个 append 写流交给内部缓冲与背压；待写超过上限就丢音频并计数，
   * 宁可录音有缺口，也不能把宿主撑爆。
   */
  _openAudioStream() {
    if (this._audioStream || !this.audioFile) return this._audioStream
    try {
      this._audioStream = createWriteStream(this.audioFile, { flags: 'a' })
      this._audioStream.on('error', (e) => {
        this._reportError('录音写入失败：' + (e && e.message ? e.message : String(e)))
        this.audioDropped = (this.audioDropped || 0) + 1
        try { this._audioStream.destroy() } catch { /* ignore */ }
        this._audioStream = null
      })
    } catch (e) {
      this._reportError('录音写入失败：' + e.message)
      this._audioStream = null
    }
    return this._audioStream
  }
  
  _writeAudio(chunk) {
    if (!this.audioFile) return
    const stream = this._openAudioStream()
    if (!stream) { this.audioDropped = (this.audioDropped || 0) + 1; return }
    const MAX_BACKLOG = Number(this.cfg && this.cfg.devices && this.cfg.devices.audioBacklogBytes) || 16 * 1048576
    if (stream.writableLength > MAX_BACKLOG) {
      this.audioDropped = (this.audioDropped || 0) + 1
      if (this.audioDropped === 1 || this.audioDropped % 200 === 0) {
        this.logger?.warn?.('[soulmirror] 录音写入跟不上，已丢弃 ' + this.audioDropped + ' 块')
      }
      return
    }
    try { stream.write(chunk) } catch { this.audioDropped = (this.audioDropped || 0) + 1 }
  }
  
  /** 收尾：flush 写流（否则最后几秒音频可能没落盘） */
  async _closeAudioStream() {
    const stream = this._audioStream
    this._audioStream = null
    if (!stream) return
    await new Promise((resolve, reject) => {
      let timer
      let settled = false
      const done = (err) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        stream.removeListener('error', failed)
        if (err) { stream.destroy(); reject(err) } else resolve()
      }
      const failed = (err) => done(err)
      stream.once('error', failed)
      timer = setTimeout(() => done(new Error('录音写流关闭超时')), 3000)
      try { stream.end(() => done()) } catch (e) { done(e) }
    })
  }


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
      await pipeline(createReadStream(pcmPath), createWriteStream(out, { flags: 'a' }))
      // 只留 wav：临时 pcm 转完即删
      try { await unlink(pcmPath) }
      catch (e) { this._reportError('WAV 已生成，但临时 PCM 清理失败：' + e.message) }
      return out
    } catch (e) {
      this._reportError('录音封装失败：' + e.message)
      throw e
    }
  }

  /** 把当前中间结果提升为正式一行（长时间不落句时用，保证转写不被"整句"卡住） */
  /**
   * 落一行转写。同一句话的"截断版"和"完整版"只保留一行。
   *
   * 真实 bug：中间结果 4 秒没变会被提前落地成「Hello可以听」，
   * 随后完整句「Hello可以听到吗？」到达，因为文本不同，去重没命中 → 出现两行。
   * 现在的规则：窗口内若与上一行相似，就用更长的那个替换，而不是追加。
   */
  /**
   * 转写落盘（只增不改的账）。
   *
   * 设计对齐 DSH：会话即日志。这里每来一句就追加一行 JSONL，
   * 不重写、不覆盖；合并/升级也写成"新行 + replaces 指向旧行"，
   * 所以哪怕进程被强杀，也能从这份账里恢复到最后一句。
   *
   * 为什么每次 appendFile 而不是常开一个流：
   *  - 常开句柄在进程被强杀时缓冲会丢，反而更不可靠
   *  - appendFile 每次 open/write/close，数据交到操作系统即算落盘
   *  - 会议线条目少（几分钟一句到几十句），开销可以忽略
   */
  _recordGap(g) {
    const item = { t: nowIso(), text: g.text, src: 'gap', gap: true }
    if (!this._appendTranscript(item)) return false
    this.transcript.push(item)
    this.lastError = '语音识别中断约 ' + Math.round((g.droppedMs || 0) / 1000) + ' 秒（已标记）'
    return true
  }

  _appendTranscript(item) {
    try {
      if (!this.dir) throw new Error('没有会议目录')
      this.appendSync(join(this.dir, 'transcript.jsonl'), JSON.stringify(item) + '\n', 'utf8')
      return true
    } catch (e) {
      this._reportError('转写落盘失败：' + e.message)
      return false
    }
  }

  _pushLine(item, { force = false } = {}) {
    const last = this.transcript[this.transcript.length - 1]
    if (!force && last) {
      const prevItem = { text: last.text, t: last.t, speaker: last.speaker }
      if (shouldMerge(prevItem, item)) {
        const merged = { ...last, text: joinTexts(last.text, item.text), updatedAt: nowIso(), replaces: last.t }
        if (!this._appendTranscript(merged)) return 'persist-failed'
        this.transcript[this.transcript.length - 1] = merged
        this.merged = (this.merged || 0) + 1
        return 'merged-fragment'
      }
      const age = Date.now() - (Date.parse(last.t) || 0)
      if (age < 8000 && similarText(last.text, item.text)) {
        if (String(item.text).length > String(last.text).length) {
          const upgraded = { ...last, text: item.text, updatedAt: nowIso(), replaces: last.t }
          if (!this._appendTranscript(upgraded)) return 'persist-failed'
          this.transcript[this.transcript.length - 1] = upgraded
          return 'upgraded'
        }
        this.dupSkipped = (this.dupSkipped || 0) + 1
        return 'duplicate'
      }
    }
    if (!this._appendTranscript(item)) return 'persist-failed'
    this.transcript.push(item)
    this.onLine?.(item)?.catch?.(() => {})
    return 'added'
  }

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
    const how = this._pushLine(item, { force: false })
    if (how === 'persist-failed') return false
    if (how === 'duplicate') { this.partial = ""; return false }
    this.partial = ""
    this.partialAt = 0
    this.lastError = ''
    return true
  }

  stopCapture() {
    if (this._stopPromise) return this._stopPromise
    // Single-flight: lifecycle, watchdog and UI can all stop the same capture.
    this._stopPromise = this._stopCaptureOnce().finally(() => { this._stopPromise = null })
    return this._stopPromise
  }

  async _stopCaptureOnce() {
    this.running = false
    this.wanted = false
    this.captureFailed = false
    if (this._recoverTimer) { clearTimeout(this._recoverTimer); this._recoverTimer = null }
    let wav = ''
    let error = ''
    try {
      if (this._loop) await this._loop
      this._loop = null
      await this._closeAudioStream()
      wav = await this.finalizeRecording(this.dir)
      if (!wav && this.bytes > 0) throw new Error('已采集 ' + this.bytes + ' 字节，但没有有效录音文件')
      this._event('capture.stop', { run: this.dir || undefined, bytes: this.bytes || 0, audio: wav })
      this.capturing = false
      this.audioWav = wav
    } catch (e) {
      error = e.message
      this._reportError('停止录音失败：' + error)
      // Safety: actual device capture has stopped even if persistence failed.
      this.capturing = false
      try { await this._closeAudioStream() } catch (closeError) { error += '；' + closeError.message }
    }
    return { ok: !error, error, chunks: this.chunks, dir: this.dir, audio: wav }
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
      captureFailed: !!this.captureFailed,
      silentSec: this.silentSec || 0,
      recoveries: this.recoveries || 0,
      lastByteAt: this.lastByteAt || 0,
      // 双路采集的可见状态（不许静默：混没混、麦克风在不在跑、丢没丢都有字段）
      mixMic: this.mixMicEnabled(),
      micRunning: !!this.micRunning,
      micDevice: this._micDeviceSel(),
      micDeviceLabel: this.micDeviceLabel || (this.mixMicEnabled() ? this._micDeviceLabel() : ''),
      mixStats: this._mixStatsSnapshot(),
      // 混音丢弃的具体原因（不占用 lastError，避免把"哪一路断了"这条盖掉）
      mixWarn: this.mixWarn || '',
    }
  }
}
