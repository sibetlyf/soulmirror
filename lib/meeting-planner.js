/**
 * lib/meeting-planner.js —— 插件自己的「会议计划表」：到点自己入会，不依赖对话。
 *
 * 用户要求：「插件自己完成，不是我跟你对话一次才完成」。
 * 也就是说：把会议信息（主题/会议号/链接/起止时间）**交给插件**，由插件内部的定时器
 * 在开始前 leadMs（默认 60 秒）自己打开入会链接、开始采集；散会后自己停并出纪要。
 *
 * 本模块只做纯逻辑（无 IO、无 timer、无网络）：
 *   · 计划条目的归一化与去重
 *   · `dueNow()`：现在该不该入会（提前 leadMs 触发，只触发一次）
 *   · `planStatus()`：未开始 / 应入会 / 进行中 / 已结束
 *   · `markJoined()` / `prune()`：状态推进与旧条目清理
 * 读写与定时器在 index.js 里（避免测试碰真实文件/时钟）。
 */

/** 默认提前量：开始前 60 秒入会（用户经验："提前一分钟最稳妥"） */
export const DEFAULT_LEAD_MS = 60 * 1000
/** 结束多久后清理计划条目 */
export const PLAN_KEEP_AFTER_MS = 6 * 60 * 60 * 1000

export function emptyPlanner() {
  return { version: 1, plans: [] }
}

const toMs = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const t = Date.parse(String(v || ''))
  return Number.isFinite(t) ? t : 0
}

/** 归一化一条计划；缺开始时间或缺（链接+会议号）直接丢弃 */
export function normalizePlan(input = {}) {
  const url = String(input.url || '').trim()
  const code = String(input.code || '').replace(/[^\d]/g, '')
  const startMs = toMs(input.start || input.startAt || input.startTime)
  if (!startMs) return null
  if (!url && !code) return null
  const durationMin = Math.max(1, Number(input.durationMin) || 30)
  const endMs = toMs(input.end || input.endAt) || (startMs + durationMin * 60 * 1000)
  const leadMs = Math.max(0, Number(input.leadMs ?? DEFAULT_LEAD_MS) || 0)
  return {
    id: String(input.id || '').trim() || ('plan-' + startMs + '-' + (code || url.slice(-6))),
    title: String(input.title || input.subject || '会议').slice(0, 80),
    url,
    code,
    startMs,
    endMs: Math.max(endMs, startMs + 60 * 1000),
    durationMin,
    leadMs,
    joinedAt: Number(input.joinedAt) || 0,
    joinTries: Number(input.joinTries) || 0,
    status: String(input.status || 'upcoming'),
    lastResult: String(input.lastResult || ''),
  }
}

/** 加入计划（同 id / 同会议号+同开始时间视为同一条，新值覆盖） */
export function addPlan(planner, input) {
  const base = planner && Array.isArray(planner.plans) ? planner : emptyPlanner()
  const plan = normalizePlan(input)
  if (!plan) return { planner: base, added: false, reason: 'invalid' }
  const same = (p) => p.id === plan.id || (p.startMs === plan.startMs && ((plan.code && p.code === plan.code) || (plan.url && p.url === plan.url)))
  const others = base.plans.filter((p) => !same(p))
  const prev = base.plans.find(same)
  const merged = prev ? { ...plan, joinedAt: prev.joinedAt || 0, joinTries: prev.joinTries || 0, status: prev.joinedAt ? prev.status : plan.status } : plan
  return { planner: { version: 1, plans: [merged, ...others].slice(0, 50) }, added: true, plan: merged }
}

/**
 * 现在该不该入会？
 * 规则：已入会过 → 不再触发；当前时间 ≥ startMs - leadMs 且 < endMs → 该入会；
 * 已经过了 endMs 就不再尝试（避免散会后还在点链接）。
 */
export function dueNow(plan, now = Date.now()) {
  const p = plan || {}
  if (p.joinedAt) return { due: false, why: 'already-joined' }
  if (!p.startMs) return { due: false, why: 'no-start' }
  const lead = Number(p.leadMs) >= 0 ? Number(p.leadMs) : DEFAULT_LEAD_MS
  if (now < p.startMs - lead) return { due: false, why: 'too-early' }
  if (now > p.endMs) return { due: false, why: 'already-ended' }
  return { due: true, why: 'in-window' }
}

/** 计划状态（给界面/日志） */
export function planStatus(plan, now = Date.now()) {
  const p = plan || {}
  if (p.joinedAt) return now > p.endMs ? 'ended' : 'joined'
  if (!p.startMs) return 'invalid'
  const lead = Number(p.leadMs) >= 0 ? Number(p.leadMs) : DEFAULT_LEAD_MS
  if (now < p.startMs - lead) return 'upcoming'
  if (now > p.endMs) return 'missed'
  return 'due'
}

/** 标记已入会（记录时间与尝试次数，避免重复触发） */
export function markJoined(planner, id, { now = Date.now(), result = 'joined' } = {}) {
  const base = planner && Array.isArray(planner.plans) ? planner : emptyPlanner()
  return {
    version: 1,
    plans: base.plans.map((p) => (p.id === id
      ? { ...p, joinedAt: now, joinTries: (Number(p.joinTries) || 0) + 1, status: 'joined', lastResult: String(result).slice(0, 120) }
      : p)),
  }
}

/** 记录一次失败尝试（不设置 joinedAt，下个 tick 还能再试） */
export function markAttempt(planner, id, { now = Date.now(), result = '' } = {}) {
  const base = planner && Array.isArray(planner.plans) ? planner : emptyPlanner()
  return {
    version: 1,
    plans: base.plans.map((p) => (p.id === id
      ? { ...p, joinTries: (Number(p.joinTries) || 0) + 1, lastResult: String(result).slice(0, 120), lastAttemptAt: now }
      : p)),
  }
}

/** 清理：结束超过 keepMs 的条目丢掉（避免文件无限增长） */
export function prune(planner, { now = Date.now(), keepMs = PLAN_KEEP_AFTER_MS } = {}) {
  const base = planner && Array.isArray(planner.plans) ? planner : emptyPlanner()
  return { version: 1, plans: base.plans.filter((p) => now < (p.endMs || 0) + keepMs) }
}

/** 找出当前所有该入会的计划 */
export function duePlans(planner, now = Date.now()) {
  const base = planner && Array.isArray(planner.plans) ? planner : emptyPlanner()
  return base.plans.filter((p) => dueNow(p, now).due)
}
