/**
 * lib/dsh-session.js —— 在宿主进程内创建 / 驱动 DSH 会话
 *
 * 这套用法（ctx.get('sessionController') + session/event）参考了
 * sibetlyf/dsh-plugin-gateway 的 task-runner 实现。
 *
 * 和网关插件同样的做法：`ctx.get('sessionController')`
 *  - create() 建出来的会话直接出现在 Web 会话列表，端侧可见
 *  - prompt() 只是「投递消息」立即返回，**结果要等 session/event**：
 *      assistant/message 收文本，turn/end 表示这一轮结束
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, statSync, renameSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEBUG_LOG = join(homedir(), '.dsh', 'soulmirror', 'events.log')

/** 事件调试日志（超过 512KB 就轮转），只记类型与 turn，不记正文 */
export function debugLog(line) {
  try {
    mkdirSync(join(homedir(), '.dsh', 'soulmirror'), { recursive: true })
    if (existsSync(DEBUG_LOG) && statSync(DEBUG_LOG).size > 512 * 1024) {
      renameSync(DEBUG_LOG, DEBUG_LOG + '.1')
    }
    appendFileSync(DEBUG_LOG, new Date().toISOString().slice(11, 23) + ' ' + line + '\n', 'utf8')
  } catch { /* ignore */ }
}

export function getController(ctx) {
  try {
    const getter = ctx?.get ? ctx.get.bind(ctx) : null
    const c = getter ? getter('sessionController') : undefined
    if (c && typeof c.create === 'function') return c
  } catch { /* ignore */ }
  return null
}

/** 从消息内容里拼出纯文本 */
function textOf(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (typeof part === 'string') parts.push(part)
    else if (part && typeof part === 'object' && typeof part.text === 'string') parts.push(part.text)
  }
  return parts.join('').trim()
}

/** 建会话（传 sessionId 则收养已存在的） */
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
 * 往会话里投递一条消息，等这一轮真正结束再返回。
 */
export async function promptSession(ctx, sessionId, text, { timeoutMs = 180000, onEvent } = {}) {
  const controller = getController(ctx)
  if (!controller) throw new Error('宿主没有 sessionController')

  let final = ''
  let errorText = ''
  let ourTurn = 0
  const tools = []
  const events = []
  let settle
  const finished = new Promise((resolve) => { settle = resolve })

  const off = typeof ctx.on === 'function'
    ? ctx.on('session/event', (session, event) => {
      const id = String(session?.id ?? session?.sessionId ?? '')
      const dbgType = String(event?.type ?? '')
      debugLog('EVT ' + dbgType + ' session=' + id.slice(0, 16) + ' want=' + sessionId.slice(0, 16) + ' turn=' + (event?.data?.turn ?? '') + ' keys=' + Object.keys(event?.data ?? {}).join('|'))
      if (id !== sessionId) return
      const type = String(event?.type ?? '')
      const data = event?.data ?? {}
      events.push(type)
      // 关键：会话里可能还有上一轮没结束，只认我们投递之后开始的 turn
      if (type === 'turn/start') {
        ourTurn = Number(data?.turn ?? 0) || ourTurn
        return
      }
      if (type === 'assistant/message') {
        const turn = Number(data?.turn ?? 0)
        if (ourTurn && turn && turn !== ourTurn) return
        const t = textOf(data?.message?.content)
        if (t) { final = t; onEvent?.({ stage: 'text', text: t }) }
        return
      }
      if (type === 'tool/call') {
        const name = String(data?.name ?? 'tool')
        tools.push(name)
        onEvent?.({ stage: 'tool', name })
        return
      }
      if (type === 'turn/end') {
        const turn = Number(data?.turn ?? 0)
        if (!ourTurn || turn !== ourTurn) return
        const kind = data?.reason?.kind
        if (kind === 'error') errorText = String(data?.reason?.error?.message || '模型执行失败')
        onEvent?.({ stage: 'end', kind })
        settle({ kind })
      }
    })
    : () => {}

  const ac = new AbortController()
  const timer = setTimeout(() => {
    try { ac.abort() } catch { /* ignore */ }
    try { controller.cancel?.({ sessionId }) } catch { /* ignore */ }
    settle({ kind: 'timeout' })
  }, timeoutMs)
  try {
    await controller.prompt({
      requestId: randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text }],
    }, ac.signal)
    debugLog('PROMPT sent session=' + sessionId.slice(0, 16) + ' text=' + text.slice(0, 30))
    const outcome = await finished
    debugLog('SETTLE kind=' + (outcome && outcome.kind) + ' finalLen=' + final.length + ' ourTurn=' + ourTurn)
    // 收尾：再给事件 600ms 把最后一句 assistant/message 投递完
    await new Promise((r) => setTimeout(r, 600))
    if (!final && errorText) return { ok: false, error: errorText, text: '', tools, sessionId, outcome, events }
    return {
      ok: outcome.kind !== 'timeout' && outcome.kind !== 'error',
      text: final,
      error: outcome.kind === 'timeout' ? '等待回复超时' : errorText,
      tools,
      sessionId,
      outcome,
      events,
    }
  } catch (e) {
    return { ok: false, error: e.message, text: final, tools, sessionId, outcome: { kind: 'throw' }, events }
  } finally {
    clearTimeout(timer)
    try { off() } catch { /* ignore */ }
  }
}
