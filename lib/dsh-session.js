/**
 * lib/dsh-session.js —— 在宿主进程内创建 / 驱动 DSH 会话
 *
 * 为什么这样做：网关插件就是这么干的（`ctx.get('sessionController')`），
 * 建出来的会话会直接出现在 Web 界面的会话列表里，端侧能看、能点进去。
 * 相比 spawn 一个 headless 进程：
 *  - 不占额外进程、不用额外安装插件（直接用宿主 profile 里已有的工具）
 *  - 会话可见
 *  - 结果通过 session 事件实时拿到
 *
 * 拿不到 sessionController 时返回 null，调用方回退到 headless 子进程。
 */
import { randomUUID } from 'node:crypto'

export function getController(ctx) {
  try {
    const getter = ctx?.get ? ctx.get.bind(ctx) : null
    const c = getter ? getter('sessionController') : undefined
    if (c && typeof c.create === 'function') return c
  } catch { /* ignore */ }
  return null
}

/** 把消息内容里的纯文本拼出来 */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (typeof part === 'string') parts.push(part)
    else if (part && typeof part === 'object' && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join('').trim()
}

/**
 * 建会话（幂等：传入已存在的 sessionId 就收养它）
 * @returns {Promise<string>} sessionId
 */
export async function createSession(ctx, { cwd, title, sessionId } = {}) {
  const controller = getController(ctx)
  if (!controller) throw new Error('宿主没有 sessionController')
  const created = await controller.create({ ...(cwd ? { cwd } : {}), ...(sessionId ? { sessionId } : {}) })
  const id = created && created.sessionId
  if (!id) throw new Error('sessionController.create 没有返回 sessionId')
  if (title) {
    try { await controller.rename({ sessionId: id, title }) } catch { /* 改名失败不影响使用 */ }
  }
  return id
}

/**
 * 往会话里发一条消息并等这一轮结束，收集助手文本与工具调用。
 */
export async function promptSession(ctx, sessionId, text, { timeoutMs = 180000, onEvent, signal } = {}) {
  const controller = getController(ctx)
  if (!controller) throw new Error('宿主没有 sessionController')

  let final = ''
  const tools = []
  const ac = new AbortController()
  const timer = setTimeout(() => { try { ac.abort() } catch { /* ignore */ } }, timeoutMs)
  if (signal) {
    if (signal.aborted) ac.abort()
    else signal.addEventListener('abort', () => ac.abort(), { once: true })
  }

  let done
  const finished = new Promise((resolve) => { done = resolve })

  const off = typeof ctx.on === 'function'
    ? ctx.on('session/event', (session, event) => {
      const id = String(session?.id ?? '')
      if (id !== sessionId) return
      const type = String(event?.type ?? '')
      const data = (event?.data ?? {})
      if (type === 'assistant/message') {
        const t = textOf(data.message?.content)
        if (t) { final = t; onEvent?.({ stage: 'text', text: t }) }
        return
      }
      if (type === 'tool/call') {
        const name = String(data.name ?? 'tool')
        tools.push(name)
        onEvent?.({ stage: 'tool', name })
        return
      }
      if (type === 'turn/end') {
        const kind = data?.reason?.kind
        onEvent?.({ stage: 'end', kind })
        done(kind === 'error' ? new Error(String(data?.reason?.error?.message || '模型执行失败')) : undefined)
      }
    })
    : () => {}

  try {
    await controller.prompt({
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }, ac.signal)
    // prompt 已返回说明这一轮结束；事件可能稍晚，给 1.5s 收尾
    await Promise.race([finished, new Promise((r) => setTimeout(r, 1500))])
    return { ok: true, text: final, tools, sessionId }
  } catch (e) {
    return { ok: false, error: e.message, text: final, tools, sessionId }
  } finally {
    clearTimeout(timer)
    try { off() } catch { /* ignore */ }
  }
}
