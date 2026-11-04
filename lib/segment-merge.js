/**
 * 碎片化转写的合并。
 *
 * 现场：一句话被切成好几行——
 *   "喂，hello hello。" / "你先加那个。" / "你这。" / "嗯你现在听到话。" / "回我一下。"
 * 原因是 400ms 静音就断句，加上中间结果被提前落地。
 *
 * 这份逻辑只做"事后合并"：如果相邻两行在时间上紧挨着、且都很短，
 * 就把它们合成一行，而不是在界面上刷出一堆残句。
 */

/** 句末标点（有这些通常会自然断开，但过短时仍可合并） */
const TERMINAL = /[。！？!?…]$/
/** 很短的碎片阈值（去掉标点后） */
const SHORT_CHARS = 6

function bareLen(text) {
  return Array.from(String(text || '').replace(/[\s，。！？、；：,.!?;:]/g, '')).length
}

/**
 * 判断新句是否应该并进上一行。
 * @param {{text:string, t?:string, speaker?:string}} prev
 * @param {{text:string, t?:string, speaker?:string}} next
 * @param {{maxGapMs?:number}} opts
 */
export function shouldMerge(prev, next, { maxGapMs = 4000 } = {}) {
  if (!prev || !next) return false
  const a = String(prev.text || '').trim()
  const b = String(next.text || '').trim()
  if (!a || !b) return false
  if (prev.speaker && next.speaker && prev.speaker !== next.speaker) return false

  const gap = Math.abs((Date.parse(next.t || '') || 0) - (Date.parse(prev.t || '') || 0))
  if (gap > maxGapMs) return false

  // 任一边是很短的碎片 → 合并
  if (bareLen(a) <= SHORT_CHARS || bareLen(b) <= SHORT_CHARS) return true
  // 上一行没有句末标点 → 说明还没说完
  if (!TERMINAL.test(a)) return true
  return false
}

/**
 * 把一段话并到上一行：避免出现 "回我一下。" + "对，没错。" 这种断裂。
 * 中文直接拼接，中间的标点由原句自带。
 */
export function joinTexts(a, b) {
  const x = String(a || '').trim()
  const y = String(b || '').trim()
  if (!x) return y
  if (!y) return x
  const left = TERMINAL.test(x) ? x : x + '，'
  return left + y
}
