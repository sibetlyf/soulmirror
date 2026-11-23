/**
 * lib/pipeline-layers.js —— 「动静分层编排」：把提示词拆成"静态层"与"动态层"，按预算装配。
 *
 * 为什么分层（借鉴 openless 的提示词处理原则）：
 *   · 静态层 = 每次调用的规则骨架：任务定义、只重塑不回答、输出格式、词典、风格包。
 *     它几乎不变，可以复用、可以前缀缓存（Prompt Cache），省 token 也省延迟。
 *   · 动态层 = 每次都要变的上下文：这段转写、最近几轮、说话人、知识库检索片段、光标上下文。
 *     它才是"每次请求面对的东西"。
 *
 * 分层的好处不只是省 token：**能按层失效**。词典/风格包改了才重建静态层；
 * 转写变了只重建动态层。也让"哪个层超预算、被裁掉了什么"可观测，而不是悄悄截断。
 *
 * 本模块纯逻辑：输入各层片段与预算，输出装配文本 + 裁剪报告。
 */

/** 各层默认预算（字符）。真实提示词按这几个数字裁，不再"随便截断"。 */
export const LAYER_BUDGETS = Object.freeze({
  static: 2400,     // 规则 + 词典 + 风格包
  dynamic: 1600,    // 上下文 + 检索片段
  transcript: 2000, // 待加工文本（转写）
})

export function emptyReport() {
  return { layers: {}, truncated: {}, total: 0 }
}

/**
 * 装配提示词。
 * @param {{staticParts?: string[], dynamicParts?: string[], transcript?: string,
 *   budgets?: Partial<typeof LAYER_BUDGETS>}} o
 * @returns {{ system: string, user: string, report: object }}
 */
export function assemblePrompt({ staticParts = [], dynamicParts = [], transcript = '', budgets = {} } = {}) {
  const b = { ...LAYER_BUDGETS, ...budgets }
  const report = emptyReport()

  const joinLayer = (parts, budget, name) => {
    const text = parts.map((p) => String(p || '').trim()).filter(Boolean).join('\n\n')
    const cost = text.length
    report.layers[name] = { cost, budget }
    if (cost <= budget) return text
    // 超预算：按"段"裁（保留前面的段），并记录被裁掉的字数——不静默截断
    let out = ''
    for (const p of parts.map((x) => String(x || '').trim()).filter(Boolean)) {
      if (out.length + p.length + 2 > budget) {
        report.truncated[name] = (report.truncated[name] || 0) + p.length
        continue
      }
      out = out ? out + '\n\n' + p : p
    }
    if (!out && text) {
      out = text.slice(0, budget)
      report.truncated[name] = (report.truncated[name] || 0) + Math.max(0, cost - budget)
    }
    report.layers[name] = { cost: out.length, budget, dropped: report.truncated[name] || 0 }
    return out
  }

  const system = joinLayer(staticParts, b.static, 'static')
  const dyn = joinLayer(dynamicParts, b.dynamic, 'dynamic')
  // 转写层也按预算裁：超长就保留最新的（后面的内容更贴近当下）
  let tr = String(transcript || '').trim()
  let dropped = 0
  if (tr.length > b.transcript) {
    dropped = tr.length - b.transcript
    tr = tr.slice(-b.transcript)
    report.truncated.transcript = dropped
  }
  report.layers.transcript = { cost: tr.length, budget: b.transcript, dropped }

  const user = [dyn, tr ? '【待加工文本】\n' + tr : ''].filter(Boolean).join('\n\n')
  report.total = system.length + user.length
  return { system, user, report }
}

/**
 * 静态层的"指纹"：层内容没变就不必重建缓存。
 * 只取会影响输出的关键片段（规则、词典、风格包），不含时间戳。
 */
export function staticFingerprint(parts = []) {
  const s = parts.map((p) => String(p || '')).join('\u0000')
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0
  }
  return 'fp' + (h >>> 0).toString(36) + '-' + s.length
}

/** 上下文感知：把最近几轮对话压成一段（越近越重要，超预算先丢最旧的） */
export function buildRecentContext(turns = [], { maxTurns = 6, maxChars = 600 } = {}) {
  const list = (turns || [])
    .map((t) => String(typeof t === 'string' ? t : (t && t.text) || '').trim())
    .filter(Boolean)
    .slice(-Math.max(1, maxTurns))
  let out = list.join('\n')
  while (out.length > maxChars && list.length > 1) {
    list.shift()
    out = list.join('\n')
  }
  if (out.length > maxChars) out = out.slice(-maxChars)
  return out
}
