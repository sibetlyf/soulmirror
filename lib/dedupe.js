/**
 * 转写去重的纯逻辑：同一句话在短时间内重复到达时只处理一次。
 *
 * 为什么需要：ASR 断线重连会把环形缓冲里的音频补发一次（"至少一次"投递），
 * 服务端无法判断重没重；说话人也可能自己重复一句。
 * 不去重的后果是——同一句话触发两次完整决策链：两个任务、两次播报。
 */

/** 规范化：去空白/标点/大小写差异，只留可比较的骨架 */
/**
 * 判断两段文本是不是"同一句"。
 *
 * 真实场景：中间结果被提前落地成 "Hello可以听"，随后完整句 "Hello可以听到吗？" 到达。
 * 规范化后是前缀关系，精确比较抓不到，于是同一句话出现两行。
 */
export function similarText(a, b) {
  const x = normalizeText(a)
  const y = normalizeText(b)
  if (!x || !y) return false
  if (x === y) return true
  const short = x.length <= y.length ? x : y
  const long = x.length <= y.length ? y : x
  if (short.length < 4) return false
  // 前缀关系且短的占多数：视为同一句被截断
  if (long.startsWith(short) && short.length / long.length >= 0.45) return true
  // 包含关系（中间漏字/多字）
  if (long.includes(short) && short.length / long.length >= 0.7) return true
  return false
}

export function normalizeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、；：""''（）【】《》,.!?;:'"()\[\]<>]/g, '')
    .trim()
}

/**
 * 去重窗口。
 * @param {{ windowMs?: number, now?: () => number }} opts
 */
export class TranscriptDeduper {
  constructor({ windowMs = 8000, now = () => Date.now() } = {}) {
    this.windowMs = Math.max(1000, Number(windowMs) || 8000)
    this.now = now
    this.seen = new Map() // 规范化文本 → 最近一次时间
    this.dropped = 0
  }

  /** 返回 true 表示"重复，应丢弃" */
  isDuplicate(text) {
    const key = normalizeText(text)
    if (!key) return false
    const t = this.now()
    // 顺手清理过期项，避免长会里无限增长
    if (this.seen.size > 200) {
      for (const [k, at] of this.seen) {
        if (t - at > this.windowMs * 4) this.seen.delete(k)
      }
    }
    const last = this.seen.get(key)
    if (last !== undefined && t - last <= this.windowMs) {
      this.seen.set(key, t)
      this.dropped += 1
      return true
    }
    this.seen.set(key, t)
    return false
  }

  reset() {
    this.seen.clear()
    this.dropped = 0
  }
}

/**
 * 播报去重：同一段话在较长时间内不重复说。
 * 比转写去重窗口长得多（默认 5 分钟），因为它对应"说过就别再说"。
 */
export class SpeechDeduper {
  constructor({ windowMs = 5 * 60 * 1000, now = () => Date.now() } = {}) {
    this.windowMs = Math.max(1000, Number(windowMs) || 300000)
    this.now = now
    this.spoken = new Map()
    this.dropped = 0
  }

  /** 返回 true 表示"说过，别再说" */
  recentlySpoken(text) {
    const key = normalizeText(text)
    if (!key) return false
    const t = this.now()
    // 极短回复（"好""收到"）不参与去重，否则会显得很呆
    if (key.length < 4) return false
    const last = this.spoken.get(key)
    if (last !== undefined && t - last <= this.windowMs) {
      this.dropped += 1
      return true
    }
    this.spoken.set(key, t)
    if (this.spoken.size > 100) {
      for (const [k, at] of this.spoken) {
        if (t - at > this.windowMs) this.spoken.delete(k)
      }
    }
    return false
  }
}
