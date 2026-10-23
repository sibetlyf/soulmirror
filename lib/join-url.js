/**
 * lib/join-url.js —— 入会链接（非屏幕方案）
 *
 * 屏幕坐标定位的痛点：换机器、换缩放、换布局就失效。
 * 更稳的做法是走链接：腾讯会议客户端能直接打开邀请链接入会，
 * 官方 API（get_meeting / 受邀人接口）也会返回 join_url。
 *
 * 这里只做纯逻辑：识别链接、拼常见形式、判断打开后是否真的进会。
 */

const MEETING_HOSTS = ['meeting.tencent.com', 'meeting.qq.com', 'voovmeeting.com']

/** 是不是一个能交给客户端打开的入会链接 */
export function isJoinUrl(value) {
  const s = String(value || '').trim()
  if (!s) return false
  if (/^wemeet:\/\//i.test(s)) return true
  if (!/^https?:\/\//i.test(s)) return false
  try {
    const u = new URL(s)
    return MEETING_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h))
  } catch {
    return false
  }
}

/** 纯会议号（允许 9 位、带横线/空格分组） */
export function isBareCode(value) {
  const s = String(value || '').replace(/[\s-]/g, '')
  return /^\d{9,12}$/.test(s)
}

/**
 * 从文本里抠出入会链接（用户常常直接粘贴一整段邀请文案）
 * 例："腾讯会议邀请你加入… 点击链接入会：https://meeting.tencent.com/dm/AbCdEf"
 */
export function extractJoinUrl(text) {
  const s = String(text || '')
  const m = s.match(/(?:https?:\/\/|wemeet:\/\/)[^\s"'<>）)，。]+/i)
  if (!m) return ''
  return isJoinUrl(m[0]) ? m[0] : ''
}

/** Tencent Meeting 的 dm 链接（需要会议方生成的 dm id，无法由会议号推导） */
export function looksLikeDmLink(url) {
  return /\/dm\//i.test(String(url || ''))
}

/**
 * 打开链接后是否算"已入会"：窗口标题不再是软件名，或出现会中窗口。
 * @param {Array<{title?:string, cls?:string, proc?:string}>} wins
 * @param {{name?:string,title?:string,proc?:string}} app
 */
export function joinedAfterOpening(wins = [], app = {}) {
  const proc = String(app.proc || '').toLowerCase()
  const appNames = [app.name, app.title].filter(Boolean)
  for (const w of wins) {
    if (proc && String(w.proc || '').toLowerCase() !== proc) continue
    const cls = String(w.cls || '')
    if (/VideoMainWindow|MeetingView|ParticipantWnd|VideoCellWnd|FloatSpeakingWnd/.test(cls)) return true
    const t = String(w.title || '').trim()
    if (!t) continue
    const isHome = appNames.some((n) => t === n)
    if (!isHome) return true
  }
  return false
}
