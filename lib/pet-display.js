/**
 * 桌宠的展示决策：会议室里那么多信息，什么时候该让宠物说什么。
 *
 * 为什么要单独一个模块：气泡只有一个，而会议里有三路内容在抢它——
 * 转写、建议、Agent 发言。谁优先、多久刷一次，是纯规则，不该散在宿主里。
 *
 * 优先级：Agent 发言 > 建议 > 转写
 * （发言是它正在对外说的话，最该被看见；转写只是环境音）
 */

export const BUBBLE_LIMITS = {
  transcriptChars: 48,
  adviceChars: 60,
  questionChars: 44,
}

/** 转写行太长时截断，保留尾部（人说话重点常在后面） */
export function formatTranscriptBubble(line, { max = BUBBLE_LIMITS.transcriptChars } = {}) {
  const text = String((line && line.text) || line || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const speaker = String((line && line.speaker) || '').trim()
  const body = Array.from(text).length > max
    ? '…' + Array.from(text).slice(-max + 1).join('')
    : text
  return speaker ? speaker + '：' + body : body
}

/** 建议气泡：只有第一条问题值得放上去 */
export function formatAdviceBubble(advice) {
  const a = advice || {}
  const first = Array.isArray(a.questions) ? a.questions[0] : null
  if (!first) return ''
  const q = String(first.question || first || '').trim()
  if (!q) return ''
  const chars = Array.from(q)
  return chars.length > BUBBLE_LIMITS.adviceChars
    ? chars.slice(0, BUBBLE_LIMITS.adviceChars - 1).join('') + '…'
    : q
}

/**
 * 该给气泡看什么。
 * @param {{speaking?: string, advice?: string, transcript?: string}} src
 * @returns {{ text: string, kind: 'speaking'|'advice'|'transcript'|'' }}
 */
export function pickBubble({ speaking = '', advice = '', transcript = '' } = {}) {
  if (speaking) return { text: speaking, kind: 'speaking' }
  if (advice) return { text: advice, kind: 'advice' }
  if (transcript) return { text: transcript, kind: 'transcript' }
  return { text: '', kind: '' }
}

/**
 * 转写气泡要节流：每句都推会把气泡刷成弹幕。
 * 同时：内容没变不推；太短的碎片不推。
 */
export function shouldPushTranscript(prev, next, { now = Date.now(), throttleMs = 8000, minChars = 4 } = {}) {
  const text = String(next || '').trim()
  if (!text) return false
  if (Array.from(text).length < minChars) return false
  if (prev && prev.text === text) return false
  if (prev && Number.isFinite(prev.at) && now - prev.at < throttleMs) return false
  return true
}

/**
 * 菜单点击「打开会议助手」如何让 UI 知道。
 *
 * 跨端信号只能靠轮询：宿主把 openRequest 的计数 +1，
 * 页面侧看到计数变化就打开面板（不需要新的通道）。
 */
export function bumpOpenRequest(state, { now = Date.now() } = {}) {
  const s = state || {}
  return { count: Number(s.count || 0) + 1, at: now }
}

export function shouldOpenPanel(prevCount, nextCount) {
  return Number(nextCount || 0) > Number(prevCount || 0)
}
