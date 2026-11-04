/**
 * 会中建议：追问 / 回应。
 *
 * 参考 vianvio/dsh-plugin-meeting-assistant 的两视图设计：
 *   - 追问：结合讨论，给出"我可以问什么"以及为什么值得问
 *   - 回应：预判"可能被问到什么"，给出简短版与委婉版两种回答
 *
 * 这里只做两件事：拼提示词、严格校验模型输出。
 * 校验是必须的——模型很容易多给几条、缺字段、或写出超长文本，
 * 直接把裸 JSON 丢给界面会在渲染时炸。
 */

export const ADVICE_LIMITS = {
  maxQuestions: 3,
  maxReplies: 3,
  maxQuestionChars: 60,
  maxWhyChars: 80,
  maxAnswerChars: 220,
}

/** 拼提示词：把会议背景与最近转写交给模型 */
export function buildAdvicePrompt({ goal = '', invite = '', lines = [], maxLines = 40 } = {}) {
  const rows = (Array.isArray(lines) ? lines : [])
    .filter((l) => String(l?.text || '').trim())
    .slice(-maxLines)
    .map((l) => (l.speaker ? l.speaker + ': ' : '') + String(l.text).trim())
    .join('\n')

  const system = [
    '你是会议里的参谋。根据会议目标与最近的讨论，给出两类建议。',
    '只输出 JSON，结构为：{"questions":[{"q":"要问的问题","why":"为什么值得问"}],"replies":[{"q":"可能被问到的问题","short":"简短回答","smooth":"委婉/得体回答"}]}',
    `questions 最多 ${ADVICE_LIMITS.maxQuestions} 条，replies 最多 ${ADVICE_LIMITS.maxReplies} 条。`,
    '要求：紧贴上面讨论的内容，不要空泛套话；不要编造未出现的数字、人名、结论；',
    '如果内容太少不足以给出建议，两个数组都给空数组。',
  ].join('')

  const user = [
    goal ? '会议目标：' + goal : '会议目标：（未填写）',
    invite ? '会邀：' + invite : '',
    '最近讨论：',
    rows || '（还没有转写）',
  ].filter(Boolean).join('\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 从模型输出里抠 JSON（容忍代码围栏与前后废话） */
export function extractAdviceJson(raw) {
  let s = String(raw || '').trim()
  if (!s) throw new Error('模型返回空内容')
  s = s.split(String.fromCharCode(96, 96, 96)).join('').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 对象')
  s = s.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1')
  return JSON.parse(s)
}

function clip(s, n) {
  return String(s == null ? '' : s).trim().slice(0, n)
}

/**
 * 校验并归一化模型输出。
 * 任何一条不合规就丢掉那一条，而不是整份失败——部分可用比全空好。
 */
export function parseAdvice(raw) {
  const json = typeof raw === 'string' ? extractAdviceJson(raw) : (raw || {})
  const questions = []
  const replies = []

  for (const item of Array.isArray(json.questions) ? json.questions : []) {
    const q = clip(item && (item.q || item.question), ADVICE_LIMITS.maxQuestionChars)
    if (!q) continue
    questions.push({ q, why: clip(item.why, ADVICE_LIMITS.maxWhyChars) })
    if (questions.length >= ADVICE_LIMITS.maxQuestions) break
  }

  for (const item of Array.isArray(json.replies) ? json.replies : []) {
    const q = clip(item && (item.q || item.question), ADVICE_LIMITS.maxQuestionChars)
    if (!q) continue
    const short = clip(item.short, ADVICE_LIMITS.maxAnswerChars)
    const smooth = clip(item.smooth, ADVICE_LIMITS.maxAnswerChars)
    if (!short && !smooth) continue
    replies.push({ q, short, smooth })
    if (replies.length >= ADVICE_LIMITS.maxReplies) break
  }

  return { questions, replies, empty: questions.length === 0 && replies.length === 0 }
}

/** 建议是否值得替换现有内容（全空就不覆盖） */
export function shouldReplaceAdvice(next) {
  if (!next) return false
  return next.questions.length > 0 || next.replies.length > 0
}
