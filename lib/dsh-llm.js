/**
 * 用 DSH 自己的 llm 服务做补全（会议大脑的判定、纠错、风格润色、划词 QA 都走这里）。
 *
 * 升级特性（借鉴 OpenLess 低延迟工程实践）：
 *   1. 支持 onDelta 流式输出与 AbortSignal 取消，避免等全量返回才渲染
 *   2. 支持 fast / deep 双档位：实时场景（fast）默认关闭/降档 thinking，深度任务（deep）允许思考
 *   3. 进程级 HTTP Keep-Alive 连接池复用 + 瞬态连接重试，省去重复 TLS 握手开销
 */
import http from 'node:http'
import https from 'node:https'

/** 从 chunk 里提取文本：兼容 text-delta / delta / block-end(text) 三种形态 */
export function chunkText(chunk) {
  if (!chunk || typeof chunk !== 'object') return ''
  if (chunk.type === 'text-delta' && typeof chunk.text === 'string') return chunk.text
  if (chunk.type === 'delta' && typeof chunk.text === 'string') return chunk.text
  if (chunk.type === 'chunk' && chunk.chunk) return chunkText(chunk.chunk)
  if (chunk.type === 'block-end' && chunk.block && chunk.block.type === 'text') {
    return typeof chunk.block.text === 'string' ? chunk.block.text : ''
  }
  return ''
}

/** 从 finish chunk 里提取失败信息；没有失败返回 null */
export function finishFailure(chunk) {
  if (!chunk || chunk.type !== 'finish') return null
  const reason = chunk.reason || {}
  if (reason.kind !== 'error' && reason.kind !== 'aborted') return null
  const f = reason.failure || {}
  const parts = [f.message || '模型调用失败']
  if (f.code) parts.push('code=' + f.code)
  if (f.status) parts.push('status=' + f.status)
  return parts.join(' ')
}

/** 兼容旧导出：深度模式回退顺序 */
export const REASONING_FALLBACKS = Object.freeze(['medium', 'high', 'low', 'minimal'])

/** 极速模式回退顺序：优先最低思考档位，最后才退到无档位，绝不先试 medium/high */
export const FAST_REASONING_FALLBACKS = Object.freeze(['minimal', 'low', ''])

/** 深度模式回退顺序：允许推理模型充分思考 */
export const DEEP_REASONING_FALLBACKS = Object.freeze(['', 'medium', 'high', 'low', 'minimal'])

/** 判断是不是"推理档位/思考开关不被支持"这类错误 */
export function isUnsupportedReasoningError(message) {
  return /reasoning effort|UNSUPPORTED_REASONING_EFFORT|thinking.*not supported|unknown.*thinking/i.test(String(message || ''))
}

// ── 进程级 HTTP Keep-Alive 连接池（复用 TCP/TLS 握手，省掉 100-300ms） ────────

let sharedPool = null

/** 获取进程级共享 HTTP/HTTPS Keep-Alive 连接池 */
export function getSharedHttpPool() {
  if (!sharedPool) {
    const opts = {
      keepAlive: true,
      keepAliveMsecs: 30_000,
      maxSockets: 16,
      maxFreeSockets: 8,
      timeout: 90_000,
    }
    sharedPool = {
      httpAgent: new http.Agent(opts),
      httpsAgent: new https.Agent(opts),
      createdAt: Date.now(),
      reusedRequests: 0,
    }
  }
  return sharedPool
}

/** 关闭并重置连接池（测试或进程退出时调用） */
export function closeSharedHttpPool() {
  if (!sharedPool) return
  try { sharedPool.httpAgent.destroy() } catch { /* ignore */ }
  try { sharedPool.httpsAgent.destroy() } catch { /* ignore */ }
  sharedPool = null
}

/** 判断是否属于可重试的瞬态连接层故障（未到达服务端，幂等安全） */
function isTransientConnectError(err) {
  const code = String(err?.code || err?.cause?.code || '')
  const msg = String(err?.message || '')
  return /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|UND_ERR_CONNECT_TIMEOUT|socket hang up/i.test(code + ' ' + msg)
}

/**
 * 复用连接池的 HTTP 请求封装（支持自定义 fetchImpl 注入以便单测隔离）。
 * 仅对连接层瞬态故障做指数退避重试，不对 4xx/5xx 或业务超时重试。
 */
export async function pooledFetch(url, init = {}, { fetchImpl, maxAttempts = 3, timeoutMs = 15_000 } = {}) {
  const pool = getSharedHttpPool()
  pool.reusedRequests += 1
  const doFetch = fetchImpl || globalThis.fetch
  const headers = new Headers(init.headers || {})
  if (!headers.has('connection')) headers.set('connection', 'keep-alive')

  let attempt = 0
  while (true) {
    attempt += 1
    const reqInit = { ...init, headers }
    if (!reqInit.signal && timeoutMs > 0 && typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
      reqInit.signal = AbortSignal.timeout(timeoutMs)
    }
    try {
      return await doFetch(url, reqInit)
    } catch (err) {
      if (attempt >= maxAttempts || !isTransientConnectError(err) || init.signal?.aborted) {
        throw err
      }
      const backoffMs = Math.min(900, 150 * Math.pow(2, attempt - 1))
      await new Promise((r) => {
        const t = setTimeout(r, backoffMs)
        t.unref?.()
      })
    }
  }
}

/**
 * 按模式构造推理档位尝试队列。
 * @param {{ mode?: 'fast'|'deep', reasoningEffort?: string, thinkingEnabled?: boolean }} o
 * @returns {Array<{ effort: string, thinking?: boolean }>}
 */
export function resolveAttemptPlan({ mode = 'fast', reasoningEffort = '', thinkingEnabled } = {}) {
  if (reasoningEffort) {
    return [{ effort: String(reasoningEffort), thinking: thinkingEnabled }]
  }
  const normalizedMode = mode === 'deep' ? 'deep' : 'fast'
  if (normalizedMode === 'fast') {
    const useThinking = thinkingEnabled === true
    if (useThinking) return [{ effort: 'low', thinking: true }, { effort: '' }]
    // 实时场景：默认关闭 thinking，依次尝试 minimal / low / 默认
    return [
      { effort: 'minimal', thinking: false },
      { effort: 'low', thinking: false },
      { effort: '', thinking: false },
      { effort: '' },
    ]
  }
  // 深度场景：允许充分思考
  return DEEP_REASONING_FALLBACKS.map((effort) => ({ effort, thinking: thinkingEnabled }))
}

/**
 * 创建 DSH LLM 补全器（支持流式 onDelta + fast/deep 双档位 + Prompt Cache 路由键透传）。
 *
 * 兼容旧签名：`await complete(messages)` 返回完整字符串；
 * 新能力：`await complete(messages, { onDelta, mode, thinkingEnabled, signal, cacheKey })`
 * 或 `await complete.stream(messages, onDelta, callOpts)`。
 */
export function createDshCompleter({
  llm,
  resolveModel,
  provider = '',
  model = '',
  reasoningEffort = '',
  mode = 'fast',
  thinkingEnabled,
  onDelta: defaultOnDelta,
} = {}) {
  if (!llm || typeof llm.stream !== 'function') return null

  async function complete(messages, callOpts = {}) {
    let p = String(callOpts.provider || provider || '')
    let m = String(callOpts.model || model || '')
    if (!p || !m) {
      const picked = resolveModel ? await resolveModel() : null
      if (!picked?.provider || !picked?.model) throw new Error('DSH 没有可用的默认模型')
      p = p || picked.provider
      m = m || picked.model
    }

    const list = Array.isArray(messages) ? messages : []
    const system = list.filter((x) => x && x.role === 'system').map((x) => String(x.content || '')).join('\n')
    const user = list.filter((x) => x && x.role !== 'system').map((x) => String(x.content || '')).join('\n')

    const effectiveMode = callOpts.mode || mode || 'fast'
    const effectiveThinking = callOpts.thinkingEnabled !== undefined ? callOpts.thinkingEnabled : thinkingEnabled
    const effectiveEffort = callOpts.reasoningEffort !== undefined ? callOpts.reasoningEffort : reasoningEffort
    const onDelta = typeof callOpts.onDelta === 'function' ? callOpts.onDelta : (typeof defaultOnDelta === 'function' ? defaultOnDelta : null)
    const signal = callOpts.signal || null
    const cacheKey = callOpts.cacheKey ? String(callOpts.cacheKey) : ''

    const attempt = async (plan) => {
      if (signal?.aborted) {
        const err = new Error('流式请求已取消')
        err.name = 'AbortError'
        throw err
      }
      const opts = {
        provider: p,
        model: m,
        system: system || undefined,
        messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
      }
      if (plan.effort) opts.reasoningEffort = plan.effort
      if (plan.thinking === false) opts.thinking = { type: 'disabled' }
      if (cacheKey) opts.promptCacheKey = cacheKey
      if (signal) opts.signal = signal

      const stream = llm.stream(opts)
      let text = ''
      let fail = null
      for await (const chunk of stream) {
        if (signal?.aborted) {
          const err = new Error('流式请求已取消')
          err.name = 'AbortError'
          throw err
        }
        const f = finishFailure(chunk)
        if (f) { fail = f; continue }
        const delta = chunkText(chunk)
        if (delta) {
          text += delta
          if (onDelta) {
            try { onDelta(delta, { fullText: text, mode: effectiveMode }) } catch { /* ignore */ }
          }
        }
      }
      if (!text.trim()) throw new Error(fail || ('模型返回空内容（' + p + '/' + m + '）'))
      return text
    }

    let out = ''
    let lastError = null
    const plans = resolveAttemptPlan({
      mode: effectiveMode,
      reasoningEffort: effectiveEffort,
      thinkingEnabled: effectiveThinking,
    })
    for (const plan of plans) {
      try {
        out = await attempt(plan)
        break
      } catch (e) {
        lastError = e
        if (e?.name === 'AbortError') throw e
        if (!isUnsupportedReasoningError(e && e.message)) throw e
      }
    }
    if (!out.trim()) throw lastError || new Error('模型调用失败（' + p + '/' + m + '）')
    return out
  }

  /** 流式快捷入口：实时推送每个文本增量 */
  complete.stream = (messages, onDelta, callOpts = {}) => complete(messages, { ...callOpts, onDelta })
  /** 指定档位快捷入口 */
  complete.fast = (messages, callOpts = {}) => complete(messages, { ...callOpts, mode: 'fast', thinkingEnabled: false })
  complete.deep = (messages, callOpts = {}) => complete(messages, { ...callOpts, mode: 'deep' })

  return complete
}
