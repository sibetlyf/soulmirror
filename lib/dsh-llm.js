/**
 * 用 DSH 自己的 llm 服务做补全（会议大脑的判定、纠错、目标润色都走这里）。
 *
 * 为什么单独抽成模块：这段逻辑出过真事故——
 * 原实现只收集 `text-delta`，模型报错时走的是 `finish.reason.kind === 'error'`，
 * 于是拿到的字符串是空的，上层只看到"模型返回空内容"，真实原因（欠费/模型不存在/限流）
 * 全被吞掉了。抽出来之后可以被单测直接钉住。
 */

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

/**
 * 创建补全函数。
 * @param {{ llm: any, resolveModel?: () => Promise<{provider:string, model:string}>, provider?: string, model?: string }} o
 * @returns {((messages: Array<{role:string, content:any}>) => Promise<string>) | null}
 */
export function createDshCompleter({ llm, resolveModel, provider = '', model = '' } = {}) {
  if (!llm || typeof llm.stream !== 'function') return null
  return async function complete(messages) {
    let p = String(provider || '')
    let m = String(model || '')
    if (!p || !m) {
      const picked = resolveModel ? await resolveModel() : null
      if (!picked?.provider || !picked?.model) throw new Error('DSH 没有可用的默认模型')
      p = p || picked.provider
      m = m || picked.model
    }

    const list = Array.isArray(messages) ? messages : []
    const system = list.filter((x) => x && x.role === 'system').map((x) => String(x.content || '')).join('\n')
    const user = list.filter((x) => x && x.role !== 'system').map((x) => String(x.content || '')).join('\n')

    const stream = llm.stream({
      provider: p,
      model: m,
      system: system || undefined,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    })

    let out = ''
    let failure = null
    for await (const chunk of stream) {
      const fail = finishFailure(chunk)
      if (fail) { failure = fail; continue }
      out += chunkText(chunk)
    }
    if (!out.trim()) {
      // 空结果必须带上真实原因，否则上层只能说"模型返回空内容"
      throw new Error(failure ? failure : ('模型返回空内容（' + p + '/' + m + '）'))
    }
    return out
  }
}
