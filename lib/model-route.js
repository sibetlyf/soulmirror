/** Explicit, per-run model routing. No ambient 'last active Agent' inference. */
export function modelSelection(value) {
  if (!value || typeof value.provider !== 'string' || !value.provider.trim() || typeof value.model !== 'string' || !value.model.trim()) return null
  return { provider: value.provider.trim(), model: value.model.trim(), ...(typeof value.reasoningEffort === 'string' && value.reasoningEffort ? { reasoningEffort: value.reasoningEffort } : {}) }
}

/** Only committed request/header events prove the source Session's used configuration. */
export function selectionFromInspection(inspection) {
  const events = inspection && Array.isArray(inspection.events) ? inspection.events : []
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'request/header') continue
    const selection = modelSelection(e.data?.header?.config)
    if (selection) return selection
  }
  return null
}

/** Resolve through inspected contracts only. Explicit binding fails closed when unavailable. */
export async function resolveModelRoute({ sourceSessionId = '', snapshot, inspect, catalog } = {}) {
  const saved = modelSelection(snapshot)
  if (saved) return { ...saved, source: snapshot.source || 'snapshot', ...(snapshot.sourceSessionId ? {sourceSessionId:snapshot.sourceSessionId} : {}) }
  const sid = String(sourceSessionId || '').trim()
  if (sid) {
    if (typeof inspect !== 'function') throw new Error('宿主不支持读取绑定会话模型')
    const selected = selectionFromInspection(await inspect(sid))
    if (!selected) throw new Error('绑定 DSH 会话尚无已提交的模型请求；请先在该会话发送一条消息')
    return { ...selected, source: 'session', sourceSessionId: sid }
  }
  const selected = modelSelection((await catalog?.())?.default)
  if (!selected) throw new Error('未绑定来源会话，且 DSH 默认模型不可用')
  return { ...selected, source: 'dsh-default' }
}

/** Coalesce concurrent callers for a meeting; snapshot must commit before publication. */
export function createModelRouteStore({ readSnapshot, commitSnapshot, resolve } = {}) {
  const pending = new Map()
  return {
    async forRun(run = '') {
      const key = String(run || '')
      if (pending.has(key)) return pending.get(key)
      const task = Promise.resolve().then(async () => {
        const snapshot = key ? readSnapshot?.(key) : null
        const route = await resolve(snapshot)
        if (key && !modelSelection(snapshot)) await commitSnapshot(key, route)
        return Object.freeze({...route})
      })
      pending.set(key,task)
      try { return await task } finally { if(pending.get(key)===task) pending.delete(key) }
    },
  }
}

/** Apply only to an explicitly registered internal Agent; unrelated requests are untouched. */
export function overrideOwnedModel(agentId, base, ownedSelections) {
  const selected = ownedSelections.get(agentId)
  return selected ? {...base,...modelSelection(selected)} : base
}
