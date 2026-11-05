/**
 * 判定"现在该抓哪个会议软件"。
 *
 * 事故：用户只在使用移动会议，插件却抓腾讯会议——因为腾讯会议的主窗口还开着
 * （BaseDialog 937x637），而旧逻辑是**按配置顺序取第一个有窗口的**，
 * 腾讯会议排在前面就永远赢。
 *
 * 正确的判据不是"有没有窗口"，而是"谁真的在开会"：
 *   · 出现了会议中才有的窗口类（VideoMainWindow / ParticipantWnd / FloatSpeakingWnd…）
 *   · 谁占着麦克风（最强的在会信号）
 *   · 谁在前台
 *   · 谁的窗口是正常大小（不是托盘小窗/提示条）
 */

/** 只有真正在会里才出现的窗口类 */
export const MEETING_WINDOW_CLASSES = [
  'VideoMainWindow',
  'ParticipantWnd',
  'VideoCellWnd',
  'FloatSpeakingWnd',
  'MeetingMainWindow',
  'MeetingView',
  'MeetingViewWnd',
]

const MEETING_CLASS_RE = new RegExp(MEETING_WINDOW_CLASSES.join('|'), 'i')

/** 窗口面积够大才算"正常可见"（小于这个多半是托盘/提示条） */
export const BIG_WINDOW_AREA = 120000

function procMatches(windowProc, appProc) {
  const a = String(windowProc || '').toLowerCase().replace(/\.exe$/, '')
  const b = String(appProc || '').toLowerCase().replace(/\.exe$/, '')
  return !!a && !!b && a === b
}

/**
 * 给每个候选软件打分。
 * @param {{
 *   apps: Array<{name:string, proc?:string, title?:string, classes?:string}>,
 *   windows: Array<{proc?:string, cls?:string, title?:string, w?:number, h?:number}>,
 *   micProcs?: string[],       // 正在占麦克风的进程名（小写）
 *   foregroundProc?: string,   // 前台窗口的进程名
 * }} input
 * @returns {Array<{app:object, score:number, reasons:string[]}>} 分数从高到低（同分保持配置顺序）
 */
export function rankApps({ apps = [], windows = [], micProcs = [], foregroundProc = '' } = {}) {
  const mic = new Set((micProcs || []).map((p) => String(p || '').toLowerCase().replace(/\.exe$/, '')))
  const fg = String(foregroundProc || '').toLowerCase().replace(/\.exe$/, '')

  return apps.map((app, index) => {
    const reasons = []
    let score = 0
    const mine = windows.filter((w) => procMatches(w.proc, app.proc))

    if (mine.some((w) => (MEETING_CLASS_RE.test(String(w.cls || '')) || MEETING_CLASS_RE.test(String(app.classes || '')) && false))) {
      score += 100
      reasons.push('有会议中窗口')
    }
    if (mic.size && mic.has(String(app.proc || '').toLowerCase().replace(/\.exe$/, ''))) {
      score += 60
      reasons.push('占着麦克风')
    }
    if (fg && procMatches(fg, app.proc)) {
      score += 40
      reasons.push('在前台')
    }
    const big = mine.some((w) => Number(w.w || 0) * Number(w.h || 0) >= BIG_WINDOW_AREA)
    if (big) {
      score += 20
      reasons.push('窗口正常可见')
    }
    if (mine.some((w) => {
      const t = String(w.title || '')
      return (app.title && t.includes(app.title)) || (app.name && t.includes(app.name))
    })) {
      score += 10
      reasons.push('标题匹配')
    }

    return { app, score, reasons, index }
  })
  .sort((a, b) => (b.score - a.score) || (a.index - b.index))
}

/**
 * 选出"现在该抓的那个"。
 * 全是 0 分时返回 null（表示没有证据，交给调用方按旧规则兜底）。
 */
export function pickApp({ apps, windows, micProcs, foregroundProc } = {}) {
  const ranked = rankApps({ apps, windows, micProcs, foregroundProc })
  if (!ranked.length) return null
  if (ranked[0].score <= 0) return null
  // 同分且都只有"标题匹配"这种弱证据时，保持配置顺序（ranked 已按 index 稳定排序）
  return ranked[0]
}

/** 某个软件是否"在用"（用于界面上的 active 标记） */
export function appIsActive(app, ctx = {}) {
  const ranked = rankApps({ apps: [app], windows: ctx.windows, micProcs: ctx.micProcs, foregroundProc: ctx.foregroundProc })
  return ranked.length > 0 && ranked[0].score > 0
}
