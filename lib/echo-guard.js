/**
 * 自我回环防护。
 *
 * 事故（实测）：会议助手把模型自己的输出当成了"会议发言"。
 * 起因有两层：
 *   1) 逐句纠错器返回的不是"改好的那句话"，而是它的**思考过程**
 *      （"Fix ASR errors: ... Hmm — ... Output as-is."），被当成纠正结果写进转写；
 *   2) 助手念出去的话经虚拟声卡回采，又被识别成新的一句。
 * 两者都会让转写越来越长，而转写一变就会再生成一次纪要 → 越滚越大。
 *
 * 这里只做纯判断：这段文字像不像"模型自己的话"，而不是人说的话。
 */

/** 模型思考/元指令的典型痕迹（英文为主，也覆盖常见中文说法） */
const META_PATTERNS = [
  /The input is/i,
  /Output as-is/i,
  /no names? to fix/i,
  /Fix ASR errors?/i,
  /Hmm\s*[—-]/i,
  /The current utterance/i,
  /not a real request/i,
  /Confidence (high|low|medium)/i,
  /Echo again/i,
  /self[- ]loop/i,
  /no task needed/i,
  /我给(?:出|的)?(?:回答|回复|思考)/,
  /(?:我|助手)(?:刚才|上一轮|上面)说/,
  /按照要求(?:我)?(?:应该|需要)/,
  /^(?:思考|分析|判断)[:：]/,
]

/** 这些不是"人说的话"，而是我们自己的产物 */
export function isModelCommentary(text) {
  const t = String(text || '')
  if (!t.trim()) return false
  let hits = 0
  for (const re of META_PATTERNS) if (re.test(t)) hits += 1
  if (hits >= 1) return true
  // 密集英文 + 结构化符号，通常是模型吐出的判定结果而非口语句子
  const cjk = (t.match(/[\u4e00-\u9fa5]/g) || []).length
  const en = (t.match(/[A-Za-z]/g) || []).length
  const total = t.length || 1
  if (en / total > 0.6 && cjk / total < 0.1 && total > 40) return true
  return false
}

/** 归一化：去空白与标点，只留内容，便于比对"是不是同一句" */
export function normalizeForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, '')
}

/**
 * 判断一句转写是不是"我们自己刚说过的话"的回声。
 * 用包含关系而不是完全相等：回声常被识别得残缺。
 * @param {string} text 新转写
 * @param {string[]} recentSaid 最近说过/写过的话（新到旧）
 * @param {{ minLen?: number }} opts
 */
export function isSelfEcho(text, recentSaid = [], { minLen = 4 } = {}) {
  const a = normalizeForCompare(text)
  if (a.length < minLen) return false
  for (const said of recentSaid) {
    const b = normalizeForCompare(said)
    if (b.length < minLen) continue
    if (a === b) return true
    // 一句被切碎时：较短的一句完全被较长的一句包含
    const [shortBody, longBody] = a.length <= b.length ? [a, b] : [b, a]
    if (shortBody.length >= minLen && longBody.includes(shortBody)) return true
  }
  return false
}

/**
 * 纠错器的输出必须"只是改好的那句话"。
 * 不是就丢掉（返回空串让调用方用原文），绝不把思考过程写进转写。
 */
export function sanitizeCorrection(original, corrected) {
  const src = String(original || '').trim()
  const out = String(corrected || '').trim()
  if (!out) return ''
  if (isModelCommentary(out)) return ''
  // 长度失控：纠错最多让句子变长一点点
  const limit = Math.max(24, Math.round(src.length * 2 + 12))
  if (out.length > limit) return ''
  // 句子被替换成一堆换行/列表，也不像纠错
  if (out.split('\n').filter(Boolean).length > 2) return ''
  return out
}
