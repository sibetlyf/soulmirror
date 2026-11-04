/**
 * Agent 发言的「候选词」。
 *
 * 和"建议卡片"的区别（用户明确要求分开）：
 *   - 建议卡片：给用户看，教他怎么说/问什么，不进入会议音频
 *   - 候选词：Agent 要说给会议里所有人听，所以要短、要口语、要能直接播报
 *
 * 只有涉及"称谓（叫到我的名字）"或"实际要做的事（待办）"时才启动 DSH 任务，
 * 其余情况只生成候选回复——避免每句话都去开一个任务。
 */

export const REPLY_LIMITS = {
  maxCandidates: 3,
  maxChars: 80,
}

/** 只要短句：说给会议听的回复不能长 */
export function buildReplyPrompt({ line = '', context = [], names = [], personaLines = [] } = {}) {
  const recent = (Array.isArray(context) ? context : [])
    .slice(-8)
    .map((l) => (l.speaker ? l.speaker + ': ' : '') + String(l.text || '').trim())
    .filter(Boolean)
    .join('\n')

  const who = (Array.isArray(names) && names.length) ? names.join('、') : '助手'
  const system = [
    `你是会议里正在发言的 AI 助手，别人会叫你：${who}。`,
    '现在要给会议上所有人**说出**一句回复，不是在聊天框里写字。',
    '要求：口语、简短（不超过 30 字）、不要说"我记录一下"之类的客套，不要说离线后的事。',
    '如果对方问的是事实而你并不确定，就直说"我确认一下"，不要编造。',
    `只输出 JSON：{"candidates":["候选1","候选2"],"needsTask":true|false,"task":"需要实际去做的事，没有就空字符串"}`,
    `candidates 最多 ${REPLY_LIMITS.maxCandidates} 条，彼此意思不要重复。`,
    'needsTask 只有在对方要求查资料/整理/执行操作，或问题必须查外部信息时才为 true。',
  ].join('')

  const user = [
    personaLines.length ? '关于你自己：' + personaLines.join('；') : '',
    recent ? '最近对话：\n' + recent : '',
    '当前这句：' + String(line || '').trim(),
  ].filter(Boolean).join('\n\n')

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

/** 从模型输出里取 JSON */
export function extractReplyJson(raw) {
  let s = String(raw || '').trim()
  if (!s) throw new Error('模型返回空内容')
  s = s.split(String.fromCharCode(96, 96, 96)).join('').trim()
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON 对象')
  return JSON.parse(s.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'))
}

/**
 * 校验候选词。
 * @returns {{candidates: string[], needsTask: boolean, task: string}}
 */
export function parseReply(raw) {
  const json = typeof raw === 'string' ? extractReplyJson(raw) : (raw || {})
  const list = Array.isArray(json.candidates) ? json.candidates : []
  const seen = new Set()
  const candidates = []
  for (const item of list) {
    const text = String(item == null ? '' : item).trim().slice(0, REPLY_LIMITS.maxChars)
    if (!text) continue
    const key = text.replace(/[\s，。！？、,.!?]/g, '')
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push(text)
    if (candidates.length >= REPLY_LIMITS.maxCandidates) break
  }
  const task = String(json.task || '').trim().slice(0, 300)
  return {
    candidates,
    needsTask: !!json.needsTask && !!task,
    task,
  }
}

/**
 * 是否该启动 DSH 任务。
 *
 * 用户要求：涉及"候选词里的可能称谓"或"实际要做的事"才启动。
 * 这里用规则判定，避免把"要不要开任务"也交给模型（多一次调用、还可能误开）。
 */
export function shouldStartTask({ needsTask = false, line = '', names = [] } = {}) {
  if (needsTask) return { start: true, why: '模型判断需要实际执行' }
  const text = String(line || '')
  for (const name of Array.isArray(names) ? names : []) {
    const n = String(name || '').trim()
    if (n && text.includes(n)) return { start: true, why: `提到称谓「${n}」` }
  }
  if (/(帮我|给我|替我)(查|找|整理|总结|算|写|跑|看)/.test(text)) {
    return { start: true, why: '被交代了具体事情' }
  }
  return { start: false, why: '' }
}
