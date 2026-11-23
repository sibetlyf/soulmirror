/**
 * lib/latency.js —— 延迟统计（p50/p95/max），给"响应速度"一个可测量的口径。
 *
 * 为什么要它：语音输入最怕"感觉慢"，但"感觉"没法验收。
 * 把 ASR 出字、润色完成、落盘这几段分别记时间，才能说清是哪一步慢。
 *
 * 纯函数 + 固定容量环形缓冲：无 timer、无 IO，可单测；调用方给 clock 注入便于测试。
 */

/** 默认保留最近 200 个样本（够算 p50/p95，也不占内存） */
export const LATENCY_WINDOW = 200

export function emptyLatency() {
  return { version: 1, samples: {}, counts: {} }
}

function pushSample(list, ms, window = LATENCY_WINDOW) {
  const arr = Array.isArray(list) ? list.slice() : []
  arr.push(Math.max(0, Math.round(Number(ms) || 0)))
  return arr.length > window ? arr.slice(arr.length - window) : arr
}

/** 记一次耗时（name 例如 'asr.firstLine' / 'polish' / 'persist'） */
export function record(store, name, ms, { window = LATENCY_WINDOW } = {}) {
  const base = store && store.samples ? store : emptyLatency()
  const key = String(name || '').slice(0, 40)
  if (!key) return base
  const samples = { ...(base.samples || {}) }
  samples[key] = pushSample(samples[key], ms, window)
  const counts = { ...(base.counts || {}) }
  counts[key] = (Number(counts[key]) || 0) + 1
  return { ...base, samples, counts }
}

/** 线性插值分位数；样本不足返回 null（不假装有结论） */
export function quantile(sorted = [], q = 0.5) {
  const arr = Array.isArray(sorted) ? sorted : []
  if (!arr.length) return null
  if (arr.length === 1) return arr[0]
  const pos = Math.min(1, Math.max(0, q)) * (arr.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return arr[lo]
  return Math.round(arr[lo] + (arr[hi] - arr[lo]) * (pos - lo))
}

/** 每个通道的 p50/p95/max/样本数 */
export function summary(store) {
  const samples = (store && store.samples) || {}
  const out = {}
  for (const [name, list] of Object.entries(samples)) {
    const arr = (list || []).slice().sort((a, b) => a - b)
    if (!arr.length) continue
    out[name] = {
      n: arr.length,
      p50: quantile(arr, 0.5),
      p95: quantile(arr, 0.95),
      max: arr[arr.length - 1],
      min: arr[0],
    }
  }
  return out
}

/** 一行可读摘要（界面/日志直接用） */
export function describe(store) {
  const s = summary(store)
  const keys = Object.keys(s)
  if (!keys.length) return '（还没有延迟样本）'
  return keys.map((k) => k + ' p50=' + s[k].p50 + 'ms p95=' + s[k].p95 + 'ms (n=' + s[k].n + ')').join('｜')
}
