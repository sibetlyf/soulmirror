/**
 * lib/auto-answer.js —— 无人值守时的自动应答 / 自动继续
 *
 * 场景：分身半夜在开会、在跑任务，DSH 弹出「需要你确认」的卡片（approval /
 * ask_user_question）。人不在电脑前，卡片就把整轮卡死。
 *
 * 做法（参考 dsh-plugin-auto-answer）：
 *  - 拦截 `approval/request`
 *  - 先让正常流程等一会儿（有人答就用手答）
 *  - 超过 timeoutMs 没人答，就按「推荐选项」自动答掉，agent 继续跑
 */

/** 从请求里掏出可选项（兼容几种形状） */
export function collectOptions(request) {
  const cands = []
  const push = (arr) => {
    if (!Array.isArray(arr)) return
    for (const o of arr) {
      if (!o) continue
      if (typeof o === 'string') cands.push({ value: o, label: o })
      else if (typeof o === 'object') {
        cands.push({
          value: o.id ?? o.value ?? o.key ?? o.label ?? o.text ?? '',
          label: String(o.label ?? o.title ?? o.text ?? o.id ?? o.value ?? ''),
          recommended: !!(o.recommended ?? o.isRecommended ?? o.default ?? o.preferred),
        })
      }
    }
  }
  push(request?.options)
  push(request?.choices)
  push(request?.answers)
  push(request?.questions?.[0]?.options)
  push(request?.question?.options)
  return cands.filter((c) => c.value !== '' || c.label)
}

/** 推荐项：标签里带 (Recommended) / （推荐），或显式 recommended 标记 */
export function pickRecommended(request) {
  const opts = collectOptions(request)
  const byFlag = opts.find((o) => o.recommended)
  if (byFlag) return { value: byFlag.value || byFlag.label, reason: 'recommended-flag', label: byFlag.label }
  const re = /\((?:recommended|recommend)\)|（推\s*荐）|\(推荐\)|推荐/i
  const byLabel = opts.find((o) => re.test(o.label))
  if (byLabel) return { value: byLabel.value || byLabel.label, reason: 'recommended-label', label: byLabel.label }
  // 没有任何推荐标记：退化为"允许一次"，让流程能继续
  const kind = String(request?.kind ?? request?.type ?? '')
  const isQuestion = /question|ask/i.test(kind)
  if (!isQuestion) return { value: 'allowed-once', reason: 'default-allow', label: 'allowed-once' }
  if (opts.length) return { value: opts[0].value || opts[0].label, reason: 'first-option', label: opts[0].label }
  return { value: '', reason: 'no-options', label: '' }
}

/** 给日志用的一句话描述 */
export function describe(request) {
  const tool = String(request?.toolName ?? request?.tool ?? '')
  const reason = String(request?.reason ?? request?.displayReason?.zh ?? request?.displayReason?.en ?? '')
  const agent = String(request?.agent?.id ?? request?.sessionId ?? '')
  return (tool ? tool + ' ' : '') + (reason ? '· ' + reason.slice(0, 60) : '') + (agent ? ' [' + agent.slice(0, 16) + ']' : '')
}

/**
 * 安装自动应答。返回卸载函数。
 * @param {object} ctx cordis 上下文（需要 ctx.on）
 * @param {object} cfg { enabled, timeoutMs }
 */
export function installAutoAnswer(ctx, cfg = {}, logger) {
  const enabled = cfg.enabled !== false
  const timeoutMs = Math.max(1000, Math.min(cfg.timeoutMs || 5000, 60000))
  if (!enabled || typeof ctx?.on !== 'function') {
    return { dispose() {}, enabled: false }
  }

  let autoAnswered = 0
  const off = ctx.on('approval/request', async (request, next) => {
    const target = pickRecommended(request)
    return await new Promise((resolve) => {
      let settled = false
      const finish = (value, via) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { request?.signal?.removeEventListener?.('abort', onAbort) } catch { /* ignore */ }
        if (via === 'auto') {
          autoAnswered += 1
          logger?.info?.('[soulmirror] 无人应答，自动选择（' + target.reason + '）：' + (target.label || target.value) + ' ' + describe(request))
        }
        resolve(value)
      }
      const onAbort = () => finish('cancelled', 'abort')
      const timer = setTimeout(() => finish(target.value || 'allowed-once', 'auto'), timeoutMs)
      try { request?.signal?.addEventListener?.('abort', onAbort, { once: true }) } catch { /* ignore */ }
      // 正常流程（等人来点）；人先答就用人的
      Promise.resolve()
        .then(() => next())
        .then((v) => finish(v || 'allowed-once', 'human'))
        .catch(() => { /* 人没答，交给定时器 */ })
    })
  }, true)

  return {
    enabled: true,
    get count() { return autoAnswered },
    dispose() { try { off?.() } catch { /* ignore */ } },
  }
}
