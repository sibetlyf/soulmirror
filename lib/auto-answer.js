/**
 * lib/auto-answer.js —— 无人值守时的**问句**自动应答。
 *
 * 历史问题（安全审查发现，已修）：
 *   1. 默认开启（`cfg.enabled !== false`）
 *   2. 插件级监听所有 `approval/request`，不区分会话与工具
 *   3. 拿不到推荐项时默认返回 `allowed-once`
 *   → 别处会话的**权限请求**也会在 5 秒后被自动批准，
 *     等于把"会议助手无人值守"放大成"整个宿主自动授权器"。
 *
 * 现在的边界（刻意收窄）：
 *   · 默认**关闭**，必须显式 `enabled === true`
 *   · 只处理**问句类**请求（选择题），**权限审批一律不接管**
 *   · 必须配置会话范围（onlyForSessionId / onlyForSessionPrefix），
 *     没配就什么都不接管——宁可卡住等人，不可替人授权
 *   · 拿不到任何可选项 → 回 `cancelled`（放弃），绝不"默认允许"
 *   · 插件卸载时清掉所有待决定时器
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

/** 是否是"权限/授权"类请求（这类**绝不允许**自动通过） */
export function isApprovalRequest(request) {
  const kind = String(request?.kind ?? request?.type ?? '').toLowerCase()
  if (!kind) {
    // 没有种类信息时，用存在的字段判断：有权限/风险/scope 字样就当审批
    const blob = JSON.stringify(request || {}).toLowerCase()
    return /permission|approval|allow|deny|risk|scope|grant/.test(blob)
  }
  if (/question|ask/.test(kind)) return false
  return /approval|permission|confirm|grant|authorize|allow/.test(kind) || kind !== 'question'
}

/** 是否是问句类请求（只有这类才允许自动应答） */
export function isQuestionRequest(request) {
  if (isApprovalRequest(request)) return false
  const kind = String(request?.kind ?? request?.type ?? '').toLowerCase()
  if (/question|ask/.test(kind)) return true
  const hasOptions = collectOptions(request).length > 0
  return hasOptions && !/approval|permission/.test(kind)
}

/** 推荐项：标签里带 (Recommended) / （推荐），或显式 recommended 标记 */
export function pickRecommended(request) {
  const opts = collectOptions(request)
  const byFlag = opts.find((o) => o.recommended)
  if (byFlag) return { value: byFlag.value || byFlag.label, reason: 'recommended-flag', label: byFlag.label }
  const re = /\((?:recommended|recommend)\)|（推\s*荐）|\(推荐\)|推荐/i
  const byLabel = opts.find((o) => re.test(o.label))
  if (byLabel) return { value: byLabel.value || byLabel.label, reason: 'recommended-label', label: byLabel.label }
  // 没有任何推荐标记：只在这个"问句"里取第一个选项；
  // 再没有就**放弃**，绝不拿 allowed-once 兜底（那等于替人授权）
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
 * 是否属于本插件该接管的会话范围。
 * 没配范围 → 一律不接管（安全默认）。
 */
export function inScope(request, cfg = {}) {
  const sid = String(request?.sessionId ?? request?.agent?.id ?? '')
  const exact = String(cfg.onlyForSessionId || '').trim()
  const prefix = String(cfg.onlyForSessionPrefix || '').trim()
  if (exact) return sid === exact
  if (prefix) return sid.startsWith(prefix)
  return false
}

/**
 * 安装自动应答。返回 { enabled, count, dispose }。
 * @param {object} ctx cordis 上下文（需要 ctx.on）
 * @param {object} cfg { enabled, timeoutMs, onlyForSessionId, onlyForSessionPrefix }
 */
export function installAutoAnswer(ctx, cfg = {}, logger) {
  // 默认关闭：无人值守的便利不能以"可能替人授权"为代价
  const enabled = cfg.enabled === true
  const timeoutMs = Math.max(1000, Math.min(cfg.timeoutMs || 5000, 60000))
  if (!enabled || typeof ctx?.on !== 'function') {
    return { dispose() {}, enabled: false, get count() { return 0 } }
  }

  let autoAnswered = 0
  const timers = new Set()
  let disposed = false

  const off = ctx.on('approval/request', async (request, next) => {
    // 一、权限审批：一律不管，交回正常流程（等人来点）
    if (isApprovalRequest(request)) return next()
    // 二、不是问句：不管
    if (!isQuestionRequest(request)) return next()
    // 三、不在本插件范围内：不管
    if (!inScope(request, cfg)) return next()

    const target = pickRecommended(request)
    if (!target.value) {
      logger?.info?.('[soulmirror] 无人应答且无可选项，放弃自动回答：' + describe(request))
      return next()
    }

    return await new Promise((resolve) => {
      let settled = false
      const finish = (value, via) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        timers.delete(timer)
        try { request?.signal?.removeEventListener?.('abort', onAbort) } catch { /* ignore */ }
        if (via === 'auto') {
          autoAnswered += 1
          logger?.info?.('[soulmirror] 无人应答，自动选择（' + target.reason + '）：' + (target.label || target.value) + ' ' + describe(request))
        }
        resolve(value)
      }
      const onAbort = () => finish('cancelled', 'abort')
      const timer = setTimeout(() => {
        if (disposed) { finish('cancelled', 'disposed'); return }
        finish(target.value, 'auto')
      }, timeoutMs)
      timers.add(timer)
      try { request?.signal?.addEventListener?.('abort', onAbort, { once: true }) } catch { /* ignore */ }
      // 正常流程（等人来点）；人先答就用人的
      Promise.resolve()
        .then(() => next())
        .then((v) => finish(v ?? target.value, 'human'))
        .catch(() => { /* 人没答，交给定时器 */ })
    })
  }, true)

  return {
    enabled: true,
    get count() { return autoAnswered },
    dispose() {
      disposed = true
      for (const t of timers) clearTimeout(t)
      timers.clear()
      try { off?.() } catch { /* ignore */ }
    },
  }
}
