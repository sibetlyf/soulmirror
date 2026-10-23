/**
 * lib/apps.js —— 会议软件注册表（内置预设 + 自动识别 + 手动切换）
 *
 * 设计目标：
 *  - 现在支持：腾讯会议、移动会议（云视讯）
 *  - 以后接入：飞书会议、钉钉会议、Zoom、Teams —— 只需在这里补一条预设
 *  - 用户也可以在配置里加自定义条目（proc / title / classes）
 *
 * 识别策略（从强到弱）：
 *  1. 进程名精确匹配（不区分大小写）
 *  2. 进程名包含匹配（例如 TencentMeeting 与 wemeetapp 的变体）
 *  3. 窗口标题命中 titleHints
 *  4. 窗口类名命中 classHints
 */

export const APP_PRESETS = [
  {
    id: 'wemeet',
    name: '腾讯会议',
    procs: ['wemeetapp', 'TencentMeeting', 'WeMeet'],
    titleHints: ['腾讯会议'],
    classHints: ['FloatSpeakingWnd', 'VideoMainWindow', 'MeetingMainWindow', 'MeetingView', 'BaseDialog'],
    caption: '（例：腾讯会议）',
    capabilities: { followDefaultMic: true, floatWindow: true, uiaMic: false },
  },
  {
    id: 'cloudvideo',
    name: '移动会议',
    procs: ['CloudVideo', 'ydmeeting', 'ChinaMobileMeeting'],
    titleHints: ['移动会议', '云视讯'],
    classHints: ['VideoMainWindow', 'MeetingMainWindow', 'BaseDialog'],
    caption: '（例：移动会议 / 中移动云视讯 CloudVideo.exe）',
    capabilities: { followDefaultMic: false, floatWindow: false, uiaMic: false },
  },
  {
    id: 'feishu',
    name: '飞书会议',
    procs: ['Feishu', 'Lark', 'feishu-meeting', 'LarkMeeting'],
    titleHints: ['飞书', 'Feishu', 'Lark', '视频会议'],
    classHints: ['VideoConference', 'MeetingWindow'],
    caption: '（预留：飞书 / Lark 桌面端）',
    capabilities: { followDefaultMic: false, floatWindow: false, uiaMic: false },
  },
  {
    id: 'dingtalk',
    name: '钉钉会议',
    procs: ['DingTalk', 'dingtalk64', 'DingTalkMeeting'],
    titleHints: ['钉钉', 'DingTalk', '视频会议'],
    classHints: ['MeetingWindow', 'DingTalkMeetingWindow'],
    caption: '（预留：钉钉桌面端）',
    capabilities: { followDefaultMic: false, floatWindow: false, uiaMic: false },
  },
  {
    id: 'zoom',
    name: 'Zoom',
    procs: ['Zoom', 'zoom', 'CptHost'],
    titleHints: ['Zoom Meeting', 'Zoom'],
    classHints: ['ZPBaseWndClass'],
    caption: '（预留：Zoom）',
    capabilities: { followDefaultMic: false, floatWindow: true, uiaMic: false },
  },
  {
    id: 'teams',
    name: 'Teams',
    procs: ['ms-teams', 'Teams', 'msteams'],
    titleHints: ['Microsoft Teams', 'Teams'],
    classHints: ['TeamsWebView'],
    caption: '（预留：Microsoft Teams）',
    capabilities: { followDefaultMic: false, floatWindow: false, uiaMic: false },
  },
]

export const DEFAULT_APP_NAME = '腾讯会议'

/** 这些类名太常见，不能当作"这是会议软件"的证据 */
export const GENERIC_CLASSES = ['basedialog', 'chrome_widgetwin_1', 'mozillawindowclass', 'window']

/** 把一条配置项与预设合并（配置优先） */
export function mergeApp(configApp = {}, preset) {
  const p = preset || APP_PRESETS.find((x) => x.name === configApp.name) || null
  return {
    id: p?.id || 'custom',
    name: configApp.name || p?.name || '未命名',
    proc: (configApp.proc || p?.procs?.[0] || '').trim(),
    title: configApp.title || p?.name || configApp.name || '',
    classes: configApp.classes || (p ? p.classHints.join('|') : ''),
    procs: p?.procs || [],
    titleHints: p?.titleHints || [configApp.name].filter(Boolean),
    classHints: p?.classHints || [],
    capabilities: p?.capabilities || {},
    preset: !!p,
  }
}

/** 归一化配置里的 apps：补齐预设信息，去重 */
export function normalizeApps(apps = []) {
  const list = Array.isArray(apps) && apps.length
    ? apps
    : APP_PRESETS.slice(0, 2).map((p) => ({ name: p.name, proc: p.procs[0], title: p.name, classes: p.classHints.join('|') }))
  const out = []
  const seen = new Set()
  for (const a of list) {
    const m = mergeApp(a)
    if (seen.has(m.name)) continue
    seen.add(m.name)
    out.push(m)
  }
  return out
}

/** 给一个窗口打分（0 = 不相干） */
export function scoreWindow(win, app) {
  const proc = String(win?.proc || '').toLowerCase()
  const title = String(win?.title || '')
  const cls = String(win?.cls || '')
  if (!proc && !title) return 0
  let score = 0
  const procs = [app.proc, ...(app.procs || [])].filter(Boolean).map((p) => p.toLowerCase())
  if (proc && procs.includes(proc)) score = Math.max(score, 100)
  else if (proc && procs.some((p) => proc.includes(p) || p.includes(proc))) score = Math.max(score, 80)
  for (const hint of app.titleHints || []) {
    if (hint && title.includes(hint)) score = Math.max(score, 60)
  }
  for (const hint of app.classHints || []) {
    const h = String(hint || '').toLowerCase()
    if (!h || GENERIC_CLASSES.includes(h)) continue
    if (cls.toLowerCase().includes(h)) score = Math.max(score, 40)
  }
  return score
}

/** 从窗口列表里识别哪些会议软件在跑 */
export function detectRunningApps(wins = [], apps = []) {
  const list = normalizeApps(apps)
  const found = []
  for (const app of list) {
    let best = null
    for (const w of wins) {
      const s = scoreWindow(w, app)
      if (s > 0 && (!best || s > best.score)) best = { score: s, window: w }
    }
    if (best) {
      found.push({
        app,
        score: best.score,
        proc: best.window.proc,
        title: best.window.title,
        confidence: best.score >= 100 ? 'exact' : best.score >= 80 ? 'proc-like' : best.score >= 60 ? 'title' : 'class',
      })
    }
  }
  return found.sort((a, b) => b.score - a.score)
}

/** 自动选择：优先"进程精确命中且窗口像会议"的那个 */
export function pickAutoApp(wins = [], apps = []) {
  const found = detectRunningApps(wins, apps)
  const strong = found.filter((f) => f.score >= 60)
  return strong.length ? strong[0] : null
}

/** 从运行中的窗口反推进程名（给未配置 proc 的预设用） */
export function inferProc(wins = [], app) {
  const hit = wins.find((w) => scoreWindow(w, app) >= 60)
  return hit ? hit.proc : ''
}

/** 内置预设清单（给面板/工具展示用） */
export function listPresets() {
  return APP_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    procs: p.procs,
    caption: p.caption,
    capabilities: p.capabilities,
  }))
}
