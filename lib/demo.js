/**
 * 演练模式：不用任何会议软件、不联网，也能把整条链路跑一遍。
 *
 * 为什么要有：新用户装完 30 秒就能看到效果；报障时能复现；验收时能演示。
 *
 * 组成：
 *   ScriptedSignalSource   → "1.5 秒后进入会议（会议号 983593253）"
 *   PcmReplayAudioSource   → 播放内置 assets/demo_meeting.wav
 *   Transcriber            → 默认 ScriptedTranscriber（离线）；可选真实 ASR
 *
 * 演练目录与真实会议目录同构：audio.wav（16k/16bit/单声道）+ transcript.jsonl + meta.json。
 * 所以会后整理 / 离线转写 / 纪要对演练目录同样可用（meta.json 里标 demo:true，界面能区分）。
 */
import { mkdirSync, appendFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import { ScriptedSignalSource, PcmReplayAudioSource, ScriptedTranscriber, parseWav, wrapWav } from './sources.js'
import { saveMeta } from './meeting-record.js'

const here = dirname(fileURLToPath(import.meta.url))
export const DEMO_ASSET = join(here, '..', 'assets', 'demo_meeting.wav')

const DEMO_SENTENCES = [
  '各位好，我们开始今天的周会，先同步一下上周的进度。',
  '前端这边完成了会议字幕模块，剩下的是移动端适配。',
  '帮我确认一下下周三的评审会时间有没有冲突。',
  '好，这个我整理一下给大家，今天就到这里。',
]

const nowIso = () => new Date().toISOString()

export class DemoController {
  /**
   * @param {{
   *   root?: string,                 // 演练数据目录（默认 ~/.dsh/soulmirror/demo）
   *   assetPath?: string,            // 样例音频
   *   makeTranscriber?: (opts) => any, // 传入则用真实 ASR（需要 key）
   *   onLine?: (item) => void,
   *   logger?: any,
   * }} opts
   */
  constructor(opts = {}) {
    this.root = opts.root || ''
    this.assetPath = opts.assetPath || DEMO_ASSET
    this.makeTranscriber = opts.makeTranscriber || null
    this.onLine = opts.onLine || null
    this.logger = opts.logger || null

    this.running = false
    this.finished = false
    this.speed = 1
    this.real = false
    this.dir = ''
    this.transcript = []
    this.partial = ''
    this.error = ''
    this.startedAt = null
    this.audioSeconds = 0
    this.audioBytes = 0
    this._signal = null
    this._audio = null
    this._asr = null
    this._timer = null
    this._maxTimer = null
    this._gen = 0
  }

  snapshot() {
    return {
      running: this.running,
      finished: this.finished,
      speed: this.speed,
      real: this.real,
      // 演练是演练：界面据此把它和真实录音区分开（不冒充会议）
      demo: true,
      audioSeconds: this.audioSeconds,
      audioBytes: this.audioBytes,
      audioPath: this.dir ? join(this.dir, 'audio.wav') : '',
      lines: this.transcript.length,
      partial: this.partial,
      transcript: this.transcript.slice(-200),
      dir: this.dir,
      error: this.error,
      startedAt: this.startedAt,
      banner: this.running ? '演练中 · 不连接真实会议 · 不会发言' : '',
    }
  }

  async start({ speed = 1, real = false, maxSeconds = 240 } = {}) {
    if (this.running) return this.snapshot()

    this._gen++
    const gen = this._gen
    this.running = true
    this.finished = false
    this.speed = Number(speed) > 0 ? Number(speed) : 1
    this.real = !!real && !!this.makeTranscriber
    this.transcript = []
    this.partial = ''
    this.error = ''
    this.audioSeconds = 0
    this.startedAt = nowIso()
    // 每轮都重建：上一轮的转写器已经被 stop() 关闭，
    // 如果沿用会导致"演练在跑但一句都不出"（曾经踩过）
    this._asr = null
    this._audio = null
    clearTimeout(this._timer)
    clearTimeout(this._maxTimer)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    this.dir = join(this.root || '.', stamp)
    try { mkdirSync(this.dir, { recursive: true }) } catch { /* ignore */ }

    // 1) 信号：1.5 秒后"进入会议"
    this._signal = new ScriptedSignalSource([
      { ms: 1500, signal: { app: '演练会议', title: '周会（演练）', code: '', inMeeting: false } },
      { ms: 24 * 3600 * 1000, signal: { app: '演练会议', title: '周会（演练）', code: '983593253', inMeeting: true } },
    ])
    // 从此刻开始计时：否则首次 poll 在 2.5s 才发生，"开会前"那 1.5 秒会被跳过
    this._signal.startedAt = Date.now()

    // 2) 音频：内置样例（按 speed 加速）
    let pcm = Buffer.alloc(0)
    let rate = 16000
    try {
      const wav = readFileSync(this.assetPath)
      const parsed = parseWav(wav)
      pcm = parsed.pcm
      rate = parsed.rate || 16000
      this.audioSeconds = Math.round(pcm.length / 32 / 100) / 10
    } catch (e) {
      this.error = '演练音频缺失：' + e.message
      this.running = false
      return this.snapshot()
    }
    // 2.1) 按录音同一格式落盘 audio.wav（16k/16bit/单声道）。
    //      以前演练只有 transcript.jsonl 没有音频，所以演练目录永远出不了纪要。
    //      PCM 就是上面解析出来的合成数据，不新增依赖。
    this.audioBytes = 0
    try {
      const wavOut = wrapWav(pcm, rate)
      writeFileSync(join(this.dir, 'audio.wav'), wavOut)
      this.audioBytes = wavOut.length
    } catch (e) {
      // 落不了盘要可见：没有 audio.wav 的演练目录不能出纪要
      this.error = '演练音频落盘失败：' + e.message
    }
    // 2.2) meta.json 与真实会议同构，但标 demo:true —— 界面据此区分"演练"与"真实"
    try {
      saveMeta(this.dir, {
        demo: true,
        source: 'demo',
        app: '演练会议',
        title: '周会（演练）',
        startedAt: this.startedAt,
        audioBytes: this.audioBytes,
      })
    } catch (e) {
      this.error = '演练 meta.json 写入失败：' + e.message
    }
    this._audio = new PcmReplayAudioSource(pcm, { chunkMs: 100, speed: this.speed })

    // 3) 转写：默认离线脚本；real=true 时用真实 ASR
    if (this.real) {
      try {
        this._asr = await this.makeTranscriber({
          onEvent: (e) => this._onAsrEvent(e),
        })
        await this._asr.start?.()
      } catch (e) {
        this.error = '真实识别启动失败，已回退到离线模拟：' + e.message
        this.real = false
        this._asr = null
      }
    }
    if (!this._asr) {
      // 26 秒音频里有 4 句 → 平均约 6.5 秒一句；这样演示节奏和真实识别接近
      const per = Math.max(1200, Math.round((this.audioSeconds * 1000) / DEMO_SENTENCES.length))
      this._asr = new ScriptedTranscriber(DEMO_SENTENCES, {
        msPerSentence: per,
        onEvent: (e) => this._onAsrEvent(e),
      })
      await this._asr.start()
    }

    await this._audio.start()

    // 4) 泵音频
    ;(async () => {
      try {
        for await (const chunk of this._audio.chunks()) {
          if (!this.running) break
          this._asr.feed?.(chunk)
        }
      } catch (e) {
        this.error = '演练音频中断：' + e.message
      }
      // 音频播完 → 给 1.5 秒收尾，然后标记结束（只对同一代演练生效）
      if (gen !== this._gen) return
      this._timer = setTimeout(() => this._finish(gen), 1500)
      this._timer.unref?.()
    })()

    // 5) 兜底时长
    this._maxTimer = setTimeout(() => this._finish(gen), Math.max(5, maxSeconds) * 1000)
    this._maxTimer.unref?.()

    this.logger?.info?.('[soulmirror] 演练开始 speed=' + this.speed + ' real=' + this.real)
    return this.snapshot()
  }

  _onAsrEvent(e) {
    if (!this.running) return
    if (e.error) { this.error = e.error; return }
    const text = String(e.text || '').trim()
    if (!text) return
    if (!e.sentenceEnd) {
      this.partial = text
      return
    }
    const item = { t: nowIso(), text, demo: true, src: 'asr' }
    this.transcript.push(item)
    this.partial = ''
    try {
      appendFileSync(join(this.dir, 'transcript.jsonl'), JSON.stringify(item) + '\n', 'utf8')
    } catch { /* ignore */ }
    try { this.onLine?.(item) } catch { /* ignore */ }
  }

  _finish(gen) {
    if (gen !== undefined && gen !== this._gen) return // 上一轮的定时器，忽略
    if (!this.running) return
    this.running = false
    this.finished = true
    this.partial = ''
    clearTimeout(this._timer)
    clearTimeout(this._maxTimer)
    this._audio?.stop?.().catch?.(() => {})
    this._asr?.stop?.().catch?.(() => {})
    // 收尾信息按真实会议的 meta.capture 形状写，inspectRecord 才能判"能整理"
    try {
      saveMeta(this.dir, {
        demo: true,
        endedAt: nowIso(),
        durationSec: this.audioSeconds,
        capture: {
          device: '演练（合成音频）',
          bytes: this.audioBytes,
          silentSec: 0,
          durationSec: this.audioSeconds,
          silentRatio: 0,
          verdict: '演练音频',
        },
      })
    } catch (e) {
      this.error = '演练 meta.json 写入失败：' + e.message
    }
    this.logger?.info?.('[soulmirror] 演练结束，共 ' + this.transcript.length + ' 句')
  }

  async stop() {
    this._finish()
    return this.snapshot()
  }

  async poll() {
    if (!this._signal) return null
    return this._signal.poll()
  }
}
