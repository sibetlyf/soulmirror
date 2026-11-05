/**
 * 会话闸门：同一时刻只让一个回合进会议会话，多的排队并合并。
 *
 * 为什么需要它：
 *   会议里"判定"类能力（建议、候选词、润色）都是走**完整 DSH 回合**实现的。
 *   一句话落地时，可能同时触发建议与候选词；一句话还可能被 ASR 切成两三行。
 *   如果每个触发都直接投递，用户就会在会话里看到 N 条排队消息——
 *   这就是"一次说话出现 N 次消息队列"的来源。
 *
 * 规则（刻意保守，宁可丢信息也不要刷屏）：
 *   1. 全局单飞：任何时刻只有 1 个回合在跑
 *   2. 同 key 合并：排队里已有同样的请求，就用新的替换它（最新为准）
 *   3. 队列有上限：超过就丢最老的排队项（不是丢正在跑的）
 *
 * 被丢掉的请求不算错误：判定是"锦上添花"，丢了最多这一轮没建议，
 * 而刷屏会直接毁掉可用性。
 */

/**
 * @param {{
 *   run: (args: any) => Promise<any>,
 *   maxPending?: number,
 *   now?: () => number,
 * }} input
 */
export function createSessionGate({ run, maxPending = 2, now = () => Date.now() } = {}) {
  if (typeof run !== 'function') throw new Error('createSessionGate 需要 run 函数')
  const cap = Math.max(0, Number(maxPending) || 0)

  /** 排队项：{ key, args, at, resolve, reject } */
  let queue = []
  let inFlight = null
  let stats = { submitted: 0, runs: 0, dropped: 0, replaced: 0, failed: 0, lastAt: 0 }

  function drain() {
    if (inFlight || queue.length === 0) return
    const item = queue.shift()
    inFlight = item
    stats.runs += 1
    stats.lastAt = now()
    Promise.resolve()
      .then(() => run(item.args))
      .then(
        (v) => { item.resolve(v) },
        (e) => { stats.failed += 1; item.reject(e) },
      )
      .finally(() => {
        inFlight = null
        drain()
      })
  }

  /**
   * 投递一次请求。永远返回 Promise：真正执行时用它自己的结果收尾；
   * 被合并/丢弃时用前一个（或一个明确的 skipped 值）收尾，调用方不会悬挂。
   */
  function submit(key, args) {
    stats.submitted += 1
    const k = String(key || '')

    // 同 key 已在排队：新值替换旧值，旧的那个直接作废（返回 skipped）
    const idx = queue.findIndex((x) => x.key === k)
    if (idx >= 0) {
      stats.replaced += 1
      const old = queue[idx]
      const item = { key: k, args, at: now(), resolve: old.resolve, reject: old.reject }
      queue[idx] = item
      old.resolve?.({ skipped: 'replaced' })
      return new Promise((resolve, reject) => { item.resolve = resolve; item.reject = reject })
    }

    // 队列满：丢最老的排队项（正在跑的那个不动）
    if (queue.length >= cap) {
      const droppedItem = queue.shift()
      stats.dropped += 1
      droppedItem.resolve?.({ skipped: 'dropped' })
    }

    return new Promise((resolve, reject) => {
      queue.push({ key: k, args, at: now(), resolve, reject })
      drain()
    })
  }

  return {
    submit,
    stats: () => ({ ...stats, pending: queue.length, busy: !!inFlight }),
    reset: () => { queue = []; inFlight = null },
  }
}

/** 给日志/排查用：一条短 key（同样内容不重复占位） */
export function keyOf(text, { max = 120 } = {}) {
  const t = String(text || '').replace(/\s+/g, ' ').trim()
  return t.slice(0, max)
}
