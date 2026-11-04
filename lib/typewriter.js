/**
 * 打字机效果的纯逻辑。
 *
 * 为什么单独抽出来：
 *   动画最容易写成一团 setInterval + 内部状态，既难测也容易抖。
 *   这里只保留"下一帧该显示到第几个字"这一个纯函数，UI 只负责按帧调用。
 *
 * 设计取舍：
 *   - 按**字符数**推进，而不是按时间线性插值：中文一句话长短不一，按字更自然
 *   - 目标文本变短（新的中间结果替换旧的）时直接跳到目标，不倒放
 *   - 速度有上限：落后太多时按比例加速，保证不会"越说越落后"
 */

/** 默认每秒显示多少字（中文语速约 4-6 字/秒，界面展示稍快一点更跟手） */
export const DEFAULT_CPS = 45

/**
 * 计算下一帧应显示的长度。
 * @param {number} current 当前已显示字符数
 * @param {number} target 目标字符数
 * @param {{cps?: number, dtMs?: number}} opts
 * @returns {number} 下一帧字符数（不超过 target）
 */
export function nextLength(current, target, { cps = DEFAULT_CPS, dtMs = 33 } = {}) {
  const cur = Number.isFinite(current) && current > 0 ? Math.floor(current) : 0
  const tgt = Number.isFinite(target) && target > 0 ? Math.floor(target) : 0
  if (tgt <= cur) return tgt            // 目标变短：立即收敛，不倒放
  const perFrame = Math.max(1, Math.round((Math.max(1, cps) * Math.max(1, dtMs)) / 1000))
  const gap = tgt - cur
  // 落后很多时加速，避免长句子永远追不上
  const speedUp = gap > 40 ? 3 : (gap > 15 ? 2 : 1)
  return Math.min(tgt, cur + perFrame * speedUp)
}

/**
 * 只取可见部分。
 * @param {string} text
 * @param {number} len
 */
export function sliceVisible(text, len) {
  const s = String(text || '')
  if (!Number.isFinite(len) || len <= 0) return ''
  if (len >= s.length) return s
  return s.slice(0, Math.floor(len))
}

/**
 * 是否应该播动画。
 * 尊重系统"减少动态效果"设置——这是无障碍要求，不是可选项。
 */
export function shouldAnimate(prefersReducedMotion) {
  return !prefersReducedMotion
}
