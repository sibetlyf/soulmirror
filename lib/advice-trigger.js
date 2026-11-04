/**
 * 建议卡片的自动触发规则。
 *
 * 直接对齐参考项目 vianvio/dsh-plugin-meeting-assistant 的实现
 * （coach-types.ts 的 COACH_RULE + coach.ts 的 automaticReason）：
 *   - 新增字符数 ≥ characters（默认 500）→ 触发
 *   - 或有新增且距上次成功 ≥ intervalMs（默认 5 分钟）→ 触发
 *   - 但：正在生成、没有新句、上次同样的内容已经失败过、冷却期内 → 都不触发
 *
 * 为什么照抄而不是自创：
 *   这套阈值是它线上跑出来的，自己拍脑袋定数字的代价是"要么一直不生成，要么一直烧钱"。
 */

export const DEFAULT_ADVICE_RULE = {
  characters: 500,
  intervalMs: 5 * 60 * 1000,
  cooldownMs: 60 * 1000,
}

/** 去空白后的字符数（中文一字算一，与参考项目口径一致） */
export function countCharacters(text) {
  return Array.from(String(text || '').replace(/\s/g, '')).length
}

/**
 * 判断现在该不该自动生成建议。
 * @param {{running?: boolean, throughLine?: number, failedThroughLine?: number,
 *          lastAttemptAt?: number, lastSuccessAt?: number}} state
 * @param {{latestLine: number, newChars: number, now: number}} input
 * @param {{characters?: number, intervalMs?: number, cooldownMs?: number}} rule
 * @returns {'characters'|'time'|null} 触发原因，null 表示不生成
 */
export function automaticReason(state, input, rule = DEFAULT_ADVICE_RULE) {
  const r = { ...DEFAULT_ADVICE_RULE, ...(rule || {}) }
  const s = state || {}
  const { latestLine = 0, newChars = 0, now = Date.now() } = input || {}

  if (s.running) return null
  if (latestLine <= (s.throughLine || 0)) return null
  if (latestLine <= (s.failedThroughLine ?? -1)) return null
  if (s.lastAttemptAt > 0 && now - s.lastAttemptAt < r.cooldownMs) return null

  if (newChars >= r.characters) return 'characters'
  if (newChars > 0 && now - (s.lastSuccessAt || 0) >= r.intervalMs) return 'time'
  return null
}
