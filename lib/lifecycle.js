/**
 * 会议生命周期检测：靠"窗口形态 + 音频能量"判断会议开始 / 结束。
 *
 * 判定规则（腾讯会议这类客户端）：
 *  - 首页窗口标题就是软件名（"腾讯会议"），标题里的"腾讯会议"是固定文案
 *  - 进会后窗口标题变成"会议主题"（不再等于软件名）
 *  - 会中会出现悬浮窗（类名 FloatSpeakingWnd）
 *  - 会中才有音频能量（环回峰值 > 阈值）
 *
 * 进入：出现"非软件名标题"的会议窗口，或出现悬浮窗
 * 退出：连续 N 次检查都没有这类窗口（默认 3 次 × 5s = 15s）
 */
const HOME_TITLES = ['腾讯会议', 'wemeetapp', '移动会议']

export class MeetingLifecycle {
  constructor(cfg, deps) {
    this.cfg = cfg
    this.deps = deps // { listWindows, meters, onEnter, onExit, logger }
    this.state = 'idle'
    this.timer = null
    this.misses = 0
    this.silentTicks = 0
    this.startedAt = null
    this.audioSeen = false
    this.lastPeak = 0
    this.history = []
    this.confirmTicks = cfg.confirmTicks || 3
    this.intervalMs = cfg.intervalMs || 5000
  }

  /** 判断当前窗口列表是否处于"会议中" */
  detect(wins) {
    const apps = this.cfg.apps || []
    const procs = new Set(apps.filter((a) => a.proc).map((a) => a.proc))
    const candidates = wins.filter((w) => procs.size === 0 || procs.has(w.proc))
    for (const w of candidates) {
      const title = (w.title || '').trim()
      const cls = w.cls || ''
      if (!title && !cls) continue
      if (/FloatSpeakingWnd|VideoMainWindow|MeetingView/i.test(cls)) {
        return { inMeeting: true, reason: 'class:' + cls, window: w }
      }
      const isHome = HOME_TITLES.some((t) => title === t || title === t + ' ')
      if (!isHome && title && !/^wemeetapp$/i.test(title)) {
        return { inMeeting: true, reason: 'title:' + title, window: w }
      }
    }
    return { inMeeting: false, reason: 'no-meeting-window' }
  }

  async tick() {
    try {
      const wins = await this.deps.listWindows()
      const d = this.detect(wins)
      let peak = 0
      try {
        peak = (await this.deps.meters()) || 0
      } catch { /* 忽略 */ }
      this.lastPeak = peak
      if (peak >= 0.004) { this.audioSeen = true; this.silentTicks = 0 } else { this.silentTicks += 1 }

      if (d.inMeeting && d.window) this.lastWindowTitle = d.window.title
      if (this.state === 'idle' && d.inMeeting) {
        this.state = 'in-meeting'
        this.startedAt = new Date().toISOString()
        this.misses = 0
        this.audioSeen = false
        this.history.push({ at: this.startedAt, event: 'enter', reason: d.reason })
        this.deps.logger?.info?.('[meeting-agent] 检测到会议开始：' + d.reason)
        await this.deps.onEnter?.({ reason: d.reason, window: d.window })
      } else if (this.state === 'in-meeting') {
        if (d.inMeeting) { this.misses = 0 } else {
          this.misses += 1
          if (this.misses >= this.confirmTicks) {
            const ended = { startedAt: this.startedAt, endedAt: new Date().toISOString(), hadAudio: this.audioSeen }
            this.state = 'idle'
            this.startedAt = null
            this.history.push({ at: ended.endedAt, event: 'exit', hadAudio: ended.hadAudio })
            this.deps.logger?.info?.('[meeting-agent] 检测到会议结束')
            await this.deps.onExit?.(ended)
          }
        }
      }
    } catch (e) {
      this.deps.logger?.warn?.('[meeting-agent] 生命周期检查失败: ' + e.message)
    }
  }

  start() {
    if (this.timer) return false
    this.timer = setInterval(() => { this.tick() }, this.intervalMs)
    if (this.timer.unref) this.timer.unref()
    this.tick()
    return true
  }

  stop() {
    if (!this.timer) return false
    clearInterval(this.timer)
    this.timer = null
    return true
  }

  snapshot() {
    return {
      state: this.state,
      since: this.startedAt,
      audioSeen: this.audioSeen,
      lastPeak: this.lastPeak,
      intervalMs: this.intervalMs,
      confirmTicks: this.confirmTicks,
      history: this.history.slice(-10),
    }
  }
}
