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

/**
 * 从 /api/soulmirror/status 推导出"现在该给宠物看什么"。
 *
 * 纯函数、无副作用：原先这份逻辑跟一个自建窗口绑在一起，
 * 现在窗口删了，只保留推导——宠物由 dsh-pet 负责画，我们只负责判断状态。
 *
 * 优先级：会后整理 > 发言中 > 出错 > 在听 > 待命
 * （整理是长任务，说话是瞬时事件，出错必须盖过一切安静状态）
 */
const ACTIVE_MS = 20000

function ts(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const raw = String(value == null ? '' : value)
  if (/^\d{10,}$/.test(raw)) return Number(raw)
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : 0
}

/**
 * @param {object} status /api/soulmirror/status 的返回
 * @param {{ now?: number }} opts
 * @returns {{ key: string, label: string, text: string, hint: string }}
 */
export function derivePetState(status, { now = Date.now() } = {}) {
  const s = status || {}
  const mk = (key, label, text = '', hint = '') => ({ key, label, text, hint })

  const pm = s.postMeeting || {}
  if (pm.phase && pm.phase !== 'idle') {
    if (pm.phase === 'error') return mk('error', '整理失败', String(pm.error || '').slice(0, 60))
    if (pm.phase === 'done') {
      const bits = []
      if (pm.sentences) bits.push(pm.sentences + ' 句')
      if (pm.speakers) bits.push(pm.speakers + ' 位说话人')
      return mk('idle', '整理完成', bits.join(' · '), pm.minutesPath || '')
    }
    const stage = pm.phase === 'stopping' ? '收尾中' : pm.phase === 'offline' ? '重转写中' : '生成纪要中'
    return mk('sweeping', '会后整理中', stage)
  }

  const spokeAt = Math.max(ts(s.lastSpeakInfo && s.lastSpeakInfo.at), ts((s.replyState || {}).at))
  if (s.replyState && s.replyState.spoken && now - spokeAt < ACTIVE_MS) {
    return mk('speaking', '正在说话', String(s.replyState.spoken).slice(0, 60))
  }

  const err = s.lastSpeakError || s.lastLlmError
  if (err && err.message) return mk('error', '出问题了', String(err.message).slice(0, 60))

  const sess = s.session || {}
  if (sess.capturing) {
    const n = Number(sess.lines || 0)
    const title = (s.meeting && (s.meeting.title || s.meeting.app)) || ''
    return mk('listening', '在听会议', n ? '在听 · ' + n + ' 句' : '在听会议', title)
  }

  return mk('idle', '待命中', (s.reply && s.reply.enabled) ? 'Agent 已开' : '只转录')
}

/**
 * 菜单项定义（注册给 dsh-pet 的右键「更多」）。
 * 注意：label 就是回传事件里的键名，改动要同步 handlePetMenu。
 */
export const PET_MENU_ITEMS = [
  '开始录音',
  '结束录音（会后整理）',
  '打开会议助手',
  '切换 Agent 发言',
  '切换 建议卡片',
]

/** 把菜单点击翻译成动作，便于单测与宿主分发 */
export function menuAction(label) {
  switch (String(label || '')) {
    case '开始录音': return { type: 'auto', action: 'start' }
    case '结束录音（会后整理）': return { type: 'auto', action: 'stop' }
    case '打开会议助手': return { type: 'open' }
    case '切换 Agent 发言': return { type: 'toggle', target: 'reply' }
    case '切换 建议卡片': return { type: 'toggle', target: 'advice' }
    default: return { type: 'unknown' }
  }
}

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

    /**
     * 取占用锁：broadcast 需要它。
     * 上游契约（读实现得出，与文档摘要不同）：
     *   POST /lock?pet=<id>&surface=web   body {}
     *   POST /lock/release?pet=<id>       body { lockId }
     * surface 是查询参数且必填，缺了直接 bad-request。
     */
    async lock(pet, { surface = 'web' } = {}) {
      const qs = []
      if (pet) qs.push('pet=' + encodeURIComponent(pet))
      qs.push('surface=' + encodeURIComponent(surface))
      const r = await req('/lock?' + qs.join('&'), { method: 'POST', body: {} })
      const d = (r.data && (r.data.data || r.data)) || {}
      const lockId = d.lockId || ''
      return { ok: !!r.ok && !!lockId, lockId, error: r.ok ? '' : String(d.message || d.reason || '取锁失败') }
    },

    async release(lockId, pet) {
      const qs = []
      if (pet) qs.push('pet=' + encodeURIComponent(pet))
      const r = await req('/lock/release' + (qs.length ? '?' + qs.join('&') : ''), { method: 'POST', body: { lockId } })
      return { ok: !!r.ok }
    },

    /** 往气泡里说一句（需锁）；字段是 duration（毫秒），不是 durationMs */
    async broadcast(text, { lockId = '', pet = '', duration = 0, anim = '' } = {}) {
      const qs = []
      if (pet) qs.push('pet=' + encodeURIComponent(pet))
      if (lockId) qs.push('lock=' + encodeURIComponent(lockId))
      const body = { text: String(text || '').slice(0, 500) }
      if (duration > 0) body.duration = duration
      if (anim) body.anim = anim
      const r = await req('/broadcast' + (qs.length ? '?' + qs.join('&') : ''), { method: 'POST', body })
      const d = (r.data && (r.data.data || r.data)) || {}
      return {
        ok: !!r.ok,
        error: r.ok ? '' : String(d.message || d.error || d.reason || ('broadcast 失败（HTTP ' + r.status + '）')),
        lockRequired: !!(d.reason === 'lock-required' || d.error === 'lock-required'),
      }
    },
  }
}
