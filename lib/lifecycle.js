/**
 * 会议生命周期检测 + "该不该自动停"的决策。
 *
 * 为什么这个文件同时管两件事：两者用的是同一批证据（窗口形态 / 麦克风 / 音频能量 /
 * 静音时长），拆成两个地方判会出现"窗口说在会、音频说结束"各说各话。
 * 这里只做纯逻辑（输入 → 输出），采证与副作用留在 index.js。
 *
 * 判定规则（腾讯会议这类客户端）：
 *  - 首页窗口标题就是软件名（"腾讯会议"），标题里的"腾讯会议"是固定文案
 *  - 进会后窗口标题变成"会议主题"（不再等于软件名）
 *  - 会中会出现悬浮窗（类名 FloatSpeakingWnd）、参会人窗口（ParticipantWnd）
 *  - 会中才有音频能量（环回峰值 > 阈值）
 *
 * 真实数据（本机 journal 与 config）暴露过三个误判，规则按它们定：
 *  1) 腾讯会议首页窗口的类名也含 VideoMainWindow → 只要客户端开着就"永远在会中"
 *  2) "加入会议""预定会议"这类对话框是同一个进程的窗口，但没开会
 *  3) apps 没配 proc 时，旧代码把所有窗口都当候选 → 记事本/浏览器/UU远程都算会议
 */

/**
 * 首页窗口标题：标题等于这些就是客户端首页，**一律不算会议**，即使类名命中。
 * 移动会议的会中窗口标题也叫"移动会议"（认不出会中），它靠麦克风/音频信号。
 */
export const HOME_TITLES = Object.freeze(['腾讯会议', 'wemeetapp', '移动会议', 'TencentMeeting'])

/**
 * 客户端里"不是会议"的窗口标题：入会/预定/详情/设置都是同一个进程的窗口，
 * 但没有会中音频。旧代码把它们当"非首页标题"= 在会中，于是打开入会框就开始录音。
 */
export const DIALOG_TITLES = Object.freeze([
  '加入会议', '加入会议室', '预定会议', '预约会议', '会议详情', '历史会议',
  '会议设置', '设置', '共享屏幕', '屏幕共享',
])

/**
 * 配置里一个 proc 都没填时的兜底白名单（不能退化成"所有窗口都算会议"）。
 * 只认内置已知会议软件名/进程名 + 会中独有类名。
 */
const KNOWN_NAMES = Object.freeze(['腾讯会议', '移动会议'])
const KNOWN_PROCS = Object.freeze(['wemeetapp', 'cloudvideo', 'tencentmeeting', 'ydmeeting'])

/** 只有会中才会出现的窗口类：单凭类名即可判定（不受标题/首页影响）。 */
const STRONG_CLASS = /FloatSpeakingWnd|SpeakingWnd|ParticipantWnd|VideoCellWnd/i
/** 客户端主窗口/会议视图也会用的类名：必须叠加"标题不是首页/不是对话框"。 */
const WEAK_CLASS = /VideoMainWindow|MeetingView|MeetingMainWindow/i

/** 音频能量阈值：与 asr.silenceRms 默认值一致（RMS 0.004 以下视为没人说话）。 */
export const AUDIO_MIN_PEAK = 0.004

/** 自动停止的默认参数（cfg.autoStop* 覆盖 graceSec / silenceSec）。 */
export const AUTO_STOP_DEFAULTS = Object.freeze({
  confirmTicks: 2,      // 连续两次看不到会议窗口才认为窗口真的没了（15s × 2 = 30s）
  graceSec: 60,         // 采集开始 60 秒内不许自动停（刚入会窗口还没稳定）
  silenceSec: 120,      // 客户端可能还占着麦克风句柄：要静音够 120 秒才算结束
  quietConfirmSec: 30,  // 连麦克风都不占了：静音确认 30 秒即可（保证 60 秒内能停）
  minPeak: AUDIO_MIN_PEAK,
})

/** 配置里的 apps 归一化：name/title/proc/classes 都可能是空串。 */
function normalizeApps(apps) {
  const list = Array.isArray(apps) ? apps : []
  return list
    .map((a) => ({
      name: String((a && a.name) || '').trim(),
      title: String((a && a.title) || '').trim(),
      proc: String((a && a.proc) || '').trim().toLowerCase(),
      classes: String((a && a.classes) || '').trim(),
    }))
    .filter((a) => a.name || a.title || a.proc)
}

/**
 * 纯函数：这一组窗口里有没有"正在开会"的证据。
 *
 * 规则（按顺序，第一条命中即返回）：
 *  A. 候选窗口 = 进程名命中配置的 proc；**配置里一个 proc 都没有时**退化成白名单：
 *     标题/进程名包含已知会议软件名，或出现会中独有的窗口类。绝不放行"所有窗口"。
 *  B. 标题等于首页（HOME_TITLES 或配置里的软件名）→ 跳过，什么类名都不算。
 *  C. 标题是入会/预定/详情等对话框 → 跳过。
 *  D. 会中独有类名（FloatSpeakingWnd/ParticipantWnd…）→ 在会中（强证据）。
 *  E. 标题不是首页也不是对话框 → 在会中（腾讯会议会中标题=会议主题）。
 *     VideoMainWindow/MeetingView 这类弱类名同样只作为证据标签，不能单凭类名判定。
 *
 * @param {Array<{proc?:string,cls?:string,title?:string}>} wins
 * @param {Array<{name?:string,title?:string,proc?:string,classes?:string}>} apps
 * @returns {{inMeeting:boolean, reason:string, window:object|null, evidence:object}}
 */
export function detectMeetingWindow(wins, apps) {
  const list = Array.isArray(wins) ? wins : []
  const normalized = normalizeApps(apps)
  const procs = new Set(normalized.map((a) => a.proc).filter(Boolean))
  const names = Array.from(new Set(normalized.flatMap((a) => [a.name, a.title]).filter(Boolean)))
  const homeSet = new Set([...HOME_TITLES, ...names].map((t) => String(t).trim()))
  const whiteNames = Array.from(new Set([...names, ...KNOWN_NAMES]))
  const whiteProcs = Array.from(new Set([...procs, ...KNOWN_PROCS.map((p) => p.toLowerCase())]))
  const evidence = {
    mode: procs.size > 0 ? 'process' : 'title-whitelist',
    procs: Array.from(procs),
    names,
    // 白名单模式用了哪些名字也要能解释清楚
    whiteList: procs.size > 0 ? null : { names: whiteNames, procs: whiteProcs },
    windowCount: list.length,
    candidateCount: 0,
    matched: null,
    skipped: [],
  }
  const whiteNamesLower = whiteNames.map((n) => String(n).toLowerCase()).filter(Boolean)
  const whiteProcsLower = whiteProcs.map((p) => String(p).toLowerCase()).filter(Boolean)
  const skip = (w, why) => {
    if (evidence.skipped.length < 8) evidence.skipped.push({ title: String(w.title || '').trim().slice(0, 40), why })
  }

  for (const w of list) {
    const proc = String((w && w.proc) || '').toLowerCase()
    const title = String((w && w.title) || '').trim()
    const cls = String((w && w.cls) || '')
    // A. 候选筛选：有 proc 就只认进程；没 proc 才用白名单（旧代码在 none 时放行全部窗口）
    let candidate = false
    if (evidence.mode === 'process') {
      candidate = procs.has(proc)
    } else {
      const probe = (title + ' ' + proc).toLowerCase()
      candidate = whiteNamesLower.some((n) => probe.includes(n))
        || whiteProcsLower.some((p) => !!proc && proc.includes(p))
        || STRONG_CLASS.test(cls)
    }
    if (!candidate) continue
    evidence.candidateCount += 1
    // B. 首页标题：一律不算会议（客户端开着 ≠ 在开会）
    if (title && homeSet.has(title)) { skip(w, 'home'); continue }
    // C. 入会/预定/详情等对话框：没有会中音频
    if (title && DIALOG_TITLES.includes(title)) { skip(w, 'dialog'); continue }
    const strong = STRONG_CLASS.test(cls)
    const weak = WEAK_CLASS.test(cls)
    const matched = { proc, title, cls, strong, weak }
    // D. 会中独有的窗口类
    if (strong) {
      evidence.matched = matched
      return { inMeeting: true, reason: 'class:' + cls, window: w, evidence }
    }
    // E. 标题不再是首页/对话框（腾讯会议把标题换成会议主题）
    if (title) {
      evidence.matched = matched
      return { inMeeting: true, reason: (weak ? 'class+title:' : 'title:') + title, window: w, evidence }
    }
    skip(w, 'no-evidence')
  }
  return { inMeeting: false, reason: 'no-meeting-window:' + evidence.mode, window: null, evidence }
}

/**
 * 纯函数：现在该不该自动停止采集。
 *
 * 为什么单独抽出来：停错了会丢整场会的录音，停晚了用户就一直在等（本机实测
 * 有过 220 秒 / 140 秒的"会后空转"）。规则必须能逐条解释、能单测。
 *
 * 规则表（按顺序，第一条命中即返回）：
 *  1. 没在采集 → 不停（reason: not-capturing）。别对已经收尾的会话重复收尾。
 *  2. capturingSec < graceSec → 不停（grace）。刚入会时窗口/麦克风都还没稳定。
 *  3. meetingSeen（会中窗口还在）→ 不停（in-meeting-window）。
 *     长时间没人说话但窗口还在 = 仍然在线，不能停。
 *  4. missTicks < confirmTicks → 不停（window-miss）。窗口刷新/切标签/短暂最小化。
 *  5. micHeld 且 peak ≥ minPeak → 不停（mic-held-with-audio）。能听到会里的声音。
 *  6. 有音频能量（哪怕麦克风没被会议软件占用）→ 不停（audio-active）。
 *  7. 无窗口、无音频，但麦克风仍被会议软件占用 → 静音够 silenceSec 才停
 *     （mic-held-quiet）。客户端常把设备句柄留着，但它不说话就是会散了。
 *  8. 无窗口、无音频、麦克风也不占了 → 静音够 quietConfirmSec 就停
 *     （no-window-no-mic-quiet）。客户端崩溃/退出会议都归这类；保证 60 秒内能停。
 *
 * 静音证据 quietSec = max(silentSec, lastLineAgeSec)：端点静音秒数优先，但不依赖它；
 * 本地/whisper 识别那条线不维护 silentSec（恒 0），靠"距最后一句转写"兜底。
 * peak = null 表示"读不到音频能量"（桥接失败），**不能**当成静音：此时只看 quietSec。
 *
 * @returns {{stop:boolean, reason:string, evidence:object}}
 */
export function shouldAutoStop(input = {}) {
  const {
    capturing,
    meetingSeen,
    micHeld,
    peak = null,
    silentSec = null,
    lastLineAgeSec = null,
    capturingSec = 0,
    missTicks = 0,
    confirmTicks = AUTO_STOP_DEFAULTS.confirmTicks,
    graceSec = AUTO_STOP_DEFAULTS.graceSec,
    silenceSec = AUTO_STOP_DEFAULTS.silenceSec,
    quietConfirmSec = AUTO_STOP_DEFAULTS.quietConfirmSec,
    minPeak = AUTO_STOP_DEFAULTS.minPeak,
  } = input || {}

  const peakKnown = typeof peak === 'number' && Number.isFinite(peak)
  const audioEnergy = peakKnown && peak >= minPeak
  const endpointSilent = typeof silentSec === 'number' && Number.isFinite(silentSec) ? silentSec : null
  const lineAge = typeof lastLineAgeSec === 'number' && Number.isFinite(lastLineAgeSec) ? lastLineAgeSec : null
  // 静音证据：端点静音秒数（session.silentSec）与"距最后一句转写"取大值。
  // 为什么取大值：whisper / 本地识别那条线不维护 silentSec（恒为 0），只剩末句时间可用；
  // 两条线在"没人说话"时会一起增长，而真的有音频能量时规则 5/6 更早返回，轮不到这里。
  const quietSec = Math.max(endpointSilent != null ? endpointSilent : 0, lineAge != null ? lineAge : 0)
  const grace = Number.isFinite(graceSec) ? graceSec : AUTO_STOP_DEFAULTS.graceSec
  const silence = Number.isFinite(silenceSec) ? silenceSec : AUTO_STOP_DEFAULTS.silenceSec
  const confirm = Number.isFinite(confirmTicks) ? confirmTicks : AUTO_STOP_DEFAULTS.confirmTicks
  const quickQuiet = Math.min(silence, Number.isFinite(quietConfirmSec) ? quietConfirmSec : AUTO_STOP_DEFAULTS.quietConfirmSec)
  const evidence = {
    capturing: !!capturing,
    meetingSeen: !!meetingSeen,
    micHeld: !!micHeld,
    peak: peakKnown ? peak : null,
    audioEnergy,
    silentSec: endpointSilent,
    lastLineAgeSec: lineAge,
    quietSec,
    capturingSec,
    missTicks,
    confirmTicks: confirm,
    graceSec: grace,
    silenceSec: silence,
  }
  const no = (reason) => ({ stop: false, reason, evidence })
  const yes = (reason) => ({ stop: true, reason, evidence })

  if (!capturing) return no('not-capturing')                                   // 1
  if (!(capturingSec >= grace)) return no('grace:' + capturingSec + 's<' + grace + 's')  // 2
  if (meetingSeen) return no('in-meeting-window')                              // 3
  if (!(missTicks >= confirm)) return no('window-miss:' + missTicks + '/' + confirm)  // 4
  if (micHeld && audioEnergy) return no('mic-held-with-audio')                 // 5
  if (audioEnergy) return no('audio-active')                                   // 6
  if (micHeld) {                                                               // 7
    if (quietSec < silence) return no('mic-held-quiet:' + quietSec + 's<' + silence + 's')
    return yes('no-window-mic-held-quiet:' + quietSec + 's')
  }
  if (quietSec < quickQuiet) return no('quiet:' + quietSec + 's<' + quickQuiet + 's')  // 8
  return yes('no-window-no-mic-quiet:' + quietSec + 's')
}

export class MeetingLifecycle {
  constructor(cfg = {}, deps = {}) {
    this.cfg = cfg
    this.deps = deps // { listWindows, meters, micHeldByApp, onEnter, onExit, logger }
    this.state = 'idle'
    this.timer = null
    this.misses = 0
    this.startedAt = null
    this.audioSeen = false
    this.lastPeak = 0
    this.lastWindowTitle = ''
    this.lastTickAt = ''
    this.lastMicError = ''
    this.lastDetect = { inMeeting: false, reason: 'not-checked', evidence: {} }
    this.lastExit = null
    this.lastAutoStop = null
    this.stopReason = ''
    this.stopAt = ''
    this.stopEvidence = null
    // 刚收尾完的一小段时间里，不因为"麦克风残留"重新判定开会
    this.suppressUntil = 0
    this.history = []
    this.confirmTicks = Number(cfg.confirmTicks) || 3
    this.intervalMs = Number(cfg.intervalMs) || 5000
  }

  /**
   * 兼容旧调用：detect(wins) 默认用构造时注入的 apps；
   * 配置会变（自动跟随/用户改 apps），所以优先用 deps.getApps() 或 opts.apps。
   */
  detect(wins, opts = {}) {
    let apps = opts.apps
    if (!Array.isArray(apps)) {
      try { apps = typeof this.deps.getApps === 'function' ? this.deps.getApps() : this.cfg.apps } catch (e) { apps = this.cfg.apps }
    }
    const r = detectMeetingWindow(wins, apps)
    this.lastDetect = r
    return r
  }

  async tick() {
    const at = new Date().toISOString()
    try {
      const wins = await this.deps.listWindows()
      const d = this.detect(wins)
      // 麦克风是独立信号：移动会议的会中窗口标题不变，只能靠它
      let mic = ''
      if (typeof this.deps.micHeldByApp === 'function') {
        try {
          const held = await this.deps.micHeldByApp()
          mic = typeof held === 'string' ? held : (held ? 'mic' : '')
          this.lastMicError = ''
        } catch (e) {
          this.lastMicError = e.message
        }
      }
      let peak = null
      try {
        const v = await this.deps.meters()
        peak = Number.isFinite(v) ? v : null
      } catch (e) {
        peak = null // 读不到 ≠ 静音（保留上一次的 lastPeak 仅供展示）
      }
      if (peak != null) this.lastPeak = peak
      if (peak != null && peak >= AUDIO_MIN_PEAK) this.audioSeen = true
      this.lastTickAt = at

      const windowAlive = !!d.inMeeting
      // 收尾后 120 秒内不再因为麦克风残留重新"开始开会"（窗口重新出现仍可进入）
      const micAlive = !!mic && Date.now() >= this.suppressUntil
      if (d.window) this.lastWindowTitle = d.window.title

      if (this.state === 'idle') {
        if (!windowAlive && !micAlive) return
        const reason = windowAlive ? d.reason : 'mic:' + mic
        this.state = 'in-meeting'
        this.startedAt = at
        this.misses = 0
        this.audioSeen = false
        this.history.push({ at, event: 'enter', reason })
        if (this.history.length > 40) this.history = this.history.slice(-40)
        this.deps.logger?.info?.('[soulmirror] 检测到会议开始：' + reason)
        await this.deps.onEnter?.({ reason, window: d.window || null, evidence: d.evidence })
        return
      }

      if (windowAlive || micAlive) {
        this.misses = 0
        return
      }
      this.misses += 1
      if (this.misses < this.confirmTicks) {
        this.deps.logger?.info?.('[soulmirror] 会议窗口不见了 ' + this.misses + '/' + this.confirmTicks + ' 次，先不判结束（' + d.reason + '）')
        return
      }
      const ended = {
        startedAt: this.startedAt,
        endedAt: at,
        hadAudio: this.audioSeen,
        reason: 'no-window-no-mic',
        detectReason: d.reason,
        evidence: { detect: d.evidence, micHeld: mic, peak, misses: this.misses },
      }
      this.state = 'idle'
      this.startedAt = null
      this.misses = 0
      this.lastExit = ended
      this.history.push({ at, event: 'exit', hadAudio: ended.hadAudio, reason: ended.reason })
      if (this.history.length > 40) this.history = this.history.slice(-40)
      this.deps.logger?.info?.('[soulmirror] 检测到会议结束（窗口与麦克风都不在了）')
      await this.deps.onExit?.(ended)
    } catch (e) {
      this.deps.logger?.warn?.('[soulmirror] 生命周期检查失败: ' + e.message)
    }
  }

  /**
   * onExit 判定"证据不足，先别停"时调这里：回到 in-meeting，
   * 避免 /status 与日志里出现"结束 → 开始 → 结束"的抖动。
   */
  markStillInMeeting(reason = '') {
    const at = new Date().toISOString()
    this.state = 'in-meeting'
    this.startedAt = this.lastExit?.startedAt || at
    this.misses = 0
    this.history.push({ at, event: 'exit-vetoed', reason })
    if (this.history.length > 40) this.history = this.history.slice(-40)
  }

  /** 记录"自动停止"的决策与原因：/status 的 lifecycle.snapshot() 直接读它。 */
  noteAutoStop(verdict, evidence) {
    this.lastAutoStop = {
      at: new Date().toISOString(),
      stop: !!verdict?.stop,
      reason: verdict?.reason || '',
      evidence: evidence || verdict?.evidence || null,
    }
  }

  /** 采集被自动停止后调用：状态归 idle，写清"为什么停"，并压制麦克风残留的误判。 */
  markStopped({ reason = '', evidence = null } = {}) {
    const at = new Date().toISOString()
    const cooldown = Number(this.cfg.reenterCooldownMs)
    this.state = 'idle'
    this.startedAt = null
    this.misses = 0
    this.stopReason = reason
    this.stopAt = at
    this.stopEvidence = evidence
    this.suppressUntil = Date.now() + (Number.isFinite(cooldown) && cooldown >= 0 ? cooldown : 120000)
    this.history.push({ at, event: 'auto-stop', reason })
    if (this.history.length > 40) this.history = this.history.slice(-40)
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
      lastTickAt: this.lastTickAt,
      lastWindowTitle: this.lastWindowTitle,
      lastDetect: { inMeeting: !!this.lastDetect?.inMeeting, reason: this.lastDetect?.reason || '', evidence: this.lastDetect?.evidence || null },
      misses: this.misses,
      micError: this.lastMicError,
      intervalMs: this.intervalMs,
      confirmTicks: this.confirmTicks,
      // 为什么自动停：日志、/status、事后追查都认这一份
      stopReason: this.stopReason,
      stopAt: this.stopAt,
      stopEvidence: this.stopEvidence,
      autoStop: {
        enabled: this.cfg.autoStop !== false,
        graceSec: Number.isFinite(Number(this.cfg.autoStopGraceSec)) ? Number(this.cfg.autoStopGraceSec) : AUTO_STOP_DEFAULTS.graceSec,
        silenceSec: Number.isFinite(Number(this.cfg.autoStopSilenceSec)) ? Number(this.cfg.autoStopSilenceSec) : AUTO_STOP_DEFAULTS.silenceSec,
        last: this.lastAutoStop,
      },
      history: this.history.slice(-10),
    }
  }
}
