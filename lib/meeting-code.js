/**
 * 从一段界面文本里提取会议号。
 *
 * 现实的坑：
 *   1. 腾讯会议「快速会议」主界面的可访问树里根本没有会议号文本，
 *      号只在「会议信息」面板里 —— 这种情况必须主动去点开面板读（见 index.js 的主动探测）
 *   2. UI 树里塞满了自动化 ID（NXQtViewRoot:2190091415664），
 *      裸露的 9~11 位数字正则会把它们当成会议号 → 必须按上下文过滤
 *   3. 日期（2026-11-02）拼起来也像号码
 *
 * 所以这里按"可信度从高到低"分层，宁可不给，也不给错的。
 */

/** 明显的非会议号：自动化 ID、时间戳、坐标串 */
export function isJunkNumber(code, { raw = '' } = {}) {
  const s = String(code || '')
  if (!/^\d+$/.test(s)) return true
  if (s.length < 8 || s.length > 12) return true
  // 11 位且以 21/22 开头，通常是 Qt 的 widget id（2190262382768）
  if (s.length === 11 && /^2[12]/.test(s)) return true
  // 出现在自动化 ID / URL 里的一律不要
  if (/NXQt|Dialo\w*:|Widget:|:\s*$/.test(raw)) return true
  return false
}

/**
 * 是否像日期拼出来的假号（2026-11-02 → 2026110210）。
 * 必须"年 + 合法月 + 合法日"才判为日期：
 * 否则 206275219 这种以 20 开头的正常会议号会被误杀。
 */
export function looksLikeDate(code) {
  return /^(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{0,4}$/.test(String(code || ''))
}

/**
 * @param {string} text 界面文本（可含制表符/换行）
 * @returns {{ code: string, source: 'labeled'|'link'|'spaced'|'bare' }}
 */
export function extractMeetingCode(text) {
  const raw = String(text || '')
  if (!raw) return { code: '', source: 'labeled' }

  // 1) 带标签最可信：「会议号 206 275 219」「移动会议：379422987」「Meeting ID: ...」
  const labeled = /(?:会议号|会议\s*ID|会议ID|Meeting\s*ID|meeting_code|移动会议)[：:\s]*([0-9][0-9\s-]{6,}[0-9])/gi
  for (const m of raw.matchAll(labeled)) {
    const code = m[1].replace(/[^0-9]/g, '')
    if (isJunkNumber(code) || looksLikeDate(code)) continue
    return { code, source: 'labeled' }
  }

  // 2) 邀请链接：/share/379422987 或 /j/379422987
  const fromLink = raw.match(/\/(?:share|j)\/(\d{8,12})/)
  if (fromLink && !isJunkNumber(fromLink[1]) && !looksLikeDate(fromLink[1])) {
    return { code: fromLink[1], source: 'link' }
  }

  // 3) 三位一组的写法：206 275 219（很多界面只显示这个形态，没有"会议号"字样）
  for (const m of raw.matchAll(/(?:^|[^\d])(\d{3}[\s-]\d{3}[\s-]\d{3,4})(?:[^\d]|$)/g)) {
    const code = m[1].replace(/[^0-9]/g, '')
    if (isJunkNumber(code) || looksLikeDate(code)) continue
    return { code, source: 'spaced' }
  }

  // 4) 裸的连续数字：只有在不是自动化 ID 的一部分时才认
  for (const m of raw.matchAll(/(?:^|[^\d:])(\d{9,11})(?![\d])/g)) {
    const code = m[1]
    if (isJunkNumber(code) || looksLikeDate(code)) continue
    return { code, source: 'bare' }
  }

  return { code: '', source: 'labeled' }
}
