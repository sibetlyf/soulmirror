/**
 * 接入 dsh-pet 桌面宠物。
 *
 * 为什么不自己造窗口：dsh-pet 已经把桌宠做透了（100+ 透明动画、物理、气泡、
 * 菜单、多开），而且**专门给第三方插件开了两个口子**：
 *   POST /dsh-pet-7340/work-status   { state, task? }   写工作状态（档位动画 + 头顶文字）
 *   POST /dsh-pet-7340/broadcast     { text }           往气泡里塞一句话（需锁）
 * 会议助手该做的是"把状态推给它"，而不是重复造一个窗口。
 *
 * 档位只认这几个值（与它 shared/work-status.ts 的常量严格一致）：
 *   thinking | working | result | waiting | success | error
 */

export const PET_BASE = 'http://127.0.0.1:3080/dsh-pet-7340'

/** dsh-pet 认可的档位 */
export const WORK_STATES = ['thinking', 'working', 'result', 'waiting', 'success', 'error']

/** 把会议助手的状态映射成桌宠档位 */
export function toWorkStatus(state) {
  const s = state || {}
  switch (s.key) {
    case 'speaking': return { state: 'success', task: s.text || '正在说话' }
    case 'listening': return { state: 'working', task: s.text || '在听会议' }
    case 'thinking': return { state: 'thinking', task: s.text || '在思考' }
    case 'sweeping': return { state: 'result', task: s.text || '会后整理中' }
    case 'error': return { state: 'error', task: s.text || '出问题了' }
    default: return { state: null, task: null }
  }
}

/** 该不该推一次（避免每秒都打接口，只在状态或文字变化时推） */
export function shouldPush(prev, next) {
  if (!prev) return next.state !== null || !!next.task
  return prev.state !== next.state || (prev.task || '') !== (next.task || '')
}

/**
 * HTTP 客户端。base 可覆盖（测试用）。
 */
export function createPetClient({ base = PET_BASE, fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const url = (path) => base.replace(/\/$/, '') + path

  async function req(path, { method = 'GET', body } = {}) {
    if (typeof fetchImpl !== 'function') throw new Error('没有可用的 fetch')
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
    try {
      const r = await fetchImpl(url(path), {
        method,
        headers: body ? { 'content-type': 'application/json; charset=utf-8' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl ? ctrl.signal : undefined,
      })
      if (r.status === 204) return { ok: true }
      const text = await r.text()
      let data = null
      try { data = text ? JSON.parse(text) : null } catch { data = { raw: text } }
      return { ok: r.ok, status: r.status, data }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  return {
    /** 注册右键菜单项（同一 owner 整体覆盖；第三方项收在「更多」下） */
    async registerMenu({ owner = 'soulmirror', labels = [], target = 'both' } = {}) {
      if (!owner) throw new Error('owner 必填')
      const clean = (Array.isArray(labels) ? labels : []).map((x) => String(x || '').trim()).filter(Boolean)
      const r = await req('/menu/item', { method: 'POST', body: { owner, labels: clean, target } })
      return { ok: !!r.ok, error: r.ok ? '' : 'menu/item 失败（HTTP ' + r.status + '）', labels: clean }
    },

    /** 清除本插件注册的菜单项（幂等） */
    async clearMenu({ owner = 'soulmirror' } = {}) {
      const r = await req('/menu/item?owner=' + encodeURIComponent(owner), { method: 'DELETE' })
      return { ok: !!r.ok, removed: (r.data && r.data.removed) || 0 }
    },

    /**
     * 查询菜单触发（读取即清空）。wait>0 时长轮询，适合挂在循环里。
     * @returns {Promise<{ok:boolean, clicked:string[], error?:string}>}
     */
    async pollMenu({ owner = 'soulmirror', waitMs = 0 } = {}) {
      const qs = ['owner=' + encodeURIComponent(owner)]
      if (waitMs > 0) qs.push('wait=' + Math.min(60000, Math.max(0, Math.round(waitMs))))
      const r = await req('/menu/events?' + qs.join('&'), { timeoutMs: Math.max(timeoutMs, waitMs + 3000) })
      if (!r.ok) return { ok: false, clicked: [], error: 'menu/events 失败（HTTP ' + r.status + '）' }
      const data = (r.data && (r.data.data || r.data)) || {}
      // 形状：{ 弹弓: "main", 钓鱼: null } —— 值为 target 或 null
      const clicked = Object.keys(data).filter((k) => data[k])
      return { ok: true, clicked }
    },

    /** 点播一次动画（需锁）；name 为池内名字，或给 url 播外部素材 */
    async playAnim({ name = '', url: srcUrl = '', facing = '', lockId = '', pet = '' } = {}) {
      const qs = []
      if (pet) qs.push('pet=' + encodeURIComponent(pet))
      if (lockId) qs.push('lock=' + encodeURIComponent(lockId))
      const body = {}
      if (srcUrl) body.url = srcUrl
      else if (name) body.name = name
      else return { ok: false, error: '要给 name 或 url' }
      if (facing) body.facing = facing
      const r = await req('/anim' + (qs.length ? '?' + qs.join('&') : ''), { method: 'POST', body })
      const playbackId = r.data && (r.data.playbackId || (r.data.data && r.data.data.playbackId))
      return { ok: !!r.ok, playbackId: playbackId || '', error: r.ok ? '' : 'anim 失败（HTTP ' + r.status + '）' }
    },

    /** 只读 /state（含工作状态与气泡，用于判断对方是否已经接住我们的推送） */
    async readState() {
      const r = await req('/state')
      const data = (r.data && (r.data.data || r.data)) || {}
      return { ok: !!r.ok, data }
    },

    /** 桌宠是否在跑（/state 能拿到就算在跑） */
    async available() {
      try {
        const r = await req('/state')
        return !!r.ok
      } catch { return false }
    },

    /** 写工作状态；state 为 null 表示清空回空闲 */
    async setWorkStatus(next) {
      if (!next || next.state === null) {
        const r = await req('/work-status', { method: 'DELETE' })
        return { ok: r.ok !== false, cleared: true }
      }
      if (!WORK_STATES.includes(next.state)) throw new Error('不认识的工作状态：' + next.state)
      const body = { state: next.state }
      if (next.task) body.task = String(next.task).slice(0, 120)
      const r = await req('/work-status', { method: 'POST', body })
      return { ok: !!r.ok, error: r.ok ? '' : 'work-status 失败（HTTP ' + r.status + '）' }
    },

    /** 取占用锁：broadcast 需要它 */
    async lock(pet) {
      const r = await req('/lock' + (pet ? '?pet=' + encodeURIComponent(pet) : ''), { method: 'POST', body: {} })
      const lockId = r.data && (r.data.lockId || (r.data.data && r.data.data.lockId))
      return { ok: !!r.ok && !!lockId, lockId: lockId || '', error: r.ok ? '' : '取锁失败' }
    },

    async release(lockId, pet) {
      const qs = []
      if (pet) qs.push('pet=' + encodeURIComponent(pet))
      if (lockId) qs.push('lockId=' + encodeURIComponent(lockId))
      const r = await req('/lock/release' + (qs.length ? '?' + qs.join('&') : ''), { method: 'POST', body: {} })
      return { ok: !!r.ok }
    },

    /** 往气泡里说一句（需锁） */
    async broadcast(text, { lockId = '', pet = '', durationMs = 0 } = {}) {
      const qs = []
      if (pet) qs.push('pet=' + encodeURIComponent(pet))
      if (lockId) qs.push('lock=' + encodeURIComponent(lockId))
      const body = { text: String(text || '').slice(0, 200) }
      if (durationMs > 0) body.durationMs = durationMs
      const r = await req('/broadcast' + (qs.length ? '?' + qs.join('&') : ''), { method: 'POST', body })
      return {
        ok: !!r.ok,
        error: r.ok ? '' : String((r.data && (r.data.error || r.data.message)) || ('broadcast 失败（HTTP ' + r.status + '）')),
        lockRequired: !!(r.data && r.data.error === 'lock-required'),
      }
    },
  }
}
