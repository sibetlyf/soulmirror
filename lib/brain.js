/**
 * 会议大脑：持续吃转写流，判断"现在该不该说话、说什么"。
 *
 * 设计：
 *  - 规则先筛（点名 / 提问 / 议程），命中才调 LLM，省 token、降延迟
 *  - LLM 走 OpenAI 兼容 /chat/completions，返回严格 JSON
 *  - 没有 LLM 时退化为模板回复，保证链路可用
 */
const NAME_DEFAULT = ['DSH', '助手', '会议助手', '小助手']

const QUESTION_RE = /(吗|呢|怎么|为什么|谁|能不能|是不是|有没有|如何|多少|什么时候|对吗|好不好)[？?]?$|[？?]$/
const ASK_ME_RE = /(助手|dsh)[^。！？\\n]{0,20}(说|讲|介绍|汇报|同步|解释|总结|怎么看|意见)/i
const TODO_RE = /(帮我|给我|替我)(记|记一下|记录|提醒|安排|查|看看)|提醒我|记一下|记下来/

export class MeetingBrain {
  constructor(cfg = {}) {
    this.names = cfg.names && cfg.names.length ? cfg.names : NAME_DEFAULT
    this.window = []
    this.maxWindow = cfg.maxWindow || 40
    this.lastSpeakAt = 0
    this.muteUntil = 0
    this.lastSpokenText = ''
    this.minGapMs = cfg.minGapMs ?? 8000
    this.history = []
    this.stats = { seen: 0, triggered: 0, spoken: 0, skipped: 0 }
  }

  push(line) {
    // 自说自听保护：播报期间/刚播完忽略转写，否则会把 TTS 当成别人说话
    if (Date.now() < this.muteUntil) {
      this.stats.echoSkipped = (this.stats.echoSkipped || 0) + 1
      return null
    }
    this.stats.seen += 1
    this.window.push(line)
    if (this.window.length > this.maxWindow) this.window.shift()
    return this.detect(line)
  }

  /** 规则层：返回触发原因或 null */
  detect(line) {
    const text = (line.text || '').trim()
    if (!text) return null
    const now = Date.now()
    if (now - this.lastSpeakAt < this.minGapMs) return null

    const lower = text.toLowerCase()
    const hitName = this.names.find((n) => n && lower.includes(n.toLowerCase()))
    if (hitName) return { kind: 'name', reason: `被点名（${hitName}）`, line, confidence: 0.9 }
    if (TODO_RE.test(text)) return { kind: 'todo', reason: '被交代了事项', line, confidence: 0.85 }
    if (ASK_ME_RE.test(text)) return { kind: 'ask', reason: '被要求说明/汇报', line, confidence: 0.8 }
    if (QUESTION_RE.test(text)) return { kind: 'question', reason: '出现问句', line, confidence: 0.45 }
    return null
  }

  /** 决策层：LLM 判定，没 LLM 就模板化 */
  async decide(trigger, { complete, profile = '会议助手', persona = '', memory = '' } = {}) {
    this.stats.triggered += 1
    const context = this.window.slice(-12).map((l) => `${l.speaker || '发言人'}: ${l.text}`).join('\n')
    if (complete) {
      const prompt = [
        { role: 'system', content: `${persona ? persona + '\n\n' : ''}${memory ? '长期记忆（参考，不一定准确）：\n' + memory + '\n\n' : ''}你是会议里的 AI 助手「${profile}」，参会人会用这些称呼叫你：${this.names.join('、')}——**听到这些称呼就是在叫你本人**，不要当成别人。根据最近对话决定是否插话。只输出 JSON：{"speak":true|false,"text":"要说的话","confidence":0~1,"reason":"简短理由"}。规则：被上述称呼点名、被要求记录/提醒/总结、或能提供关键信息时 speak；对方只是叫名字寒暄也要回应一句；不要抢话、不要重复别人；一条不超过 60 字。` },
        { role: 'user', content: `触发原因：${trigger.reason}\n最近对话：\n${context}\n\n当前这句：${trigger.line.text}` },
      ]
      try {
        const raw = await complete(prompt)
        const json = JSON.parse(String(raw).replace(/^```(?:json)?|```$/g, '').trim())
        return {
          speak: !!json.speak,
          text: String(json.text || '').slice(0, 200),
          confidence: Number(json.confidence ?? 0.5),
          reason: json.reason || trigger.reason,
        }
      } catch (e) {
        return { speak: false, text: '', confidence: 0, reason: 'LLM 失败: ' + e.message }
      }
    }
    // 无 LLM：模板回复，仅对"被点名"生效
    if (trigger.kind === 'name' || trigger.kind === 'ask') {
      return { speak: true, text: `我在。关于「${trigger.line.text.slice(0, 24)}」，我记录下来了，稍后整理成要点。`, confidence: 0.6, reason: trigger.reason }
    }
    return { speak: false, text: '', confidence: 0.3, reason: '低置信，不插话' }
  }

  markSpoken(text = '') {
    this.lastSpeakAt = Date.now()
    this.lastSpokenText = text
    // 按字数估播报时长 + 4s 余量（覆盖 ASR 回传延迟），期间忽略转写
    const ms = Math.max(4000, Math.min(30000, text.length * 260 + 4000))
    this.muteUntil = Date.now() + ms
    this.stats.spoken += 1
    return ms
  }
}

/** OpenAI 兼容 chat completions 的 completer */
export function createCompleter(cfg = {}) {
  const baseUrl = cfg.baseUrl || process.env.BRAIN_BASE_URL || ''
  const apiKey = cfg.apiKey || process.env[cfg.apiKeyEnv || 'BRAIN_API_KEY'] || ''
  const model = cfg.model || process.env.BRAIN_MODEL || ''
  if (!baseUrl || !model) return null
  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions'
  return async (messages) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 200 }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`brain HTTP ${res.status}`)
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? ''
  }
}

/**
 * 生成"同音错字纠正器"：把识别出来的同音错字改回正确的人名/术语。
 * 需要 completer（OpenAI 兼容补全函数），没有则原样返回。
 */
export function makeCorrector({ names = [], context = '', completer } = {}) {
  if (!completer) return async (text) => text
  const list = Array.from(new Set(names.filter(Boolean)))
  const prompt = [
    '你是会议转写校对员。输入是一句中文语音识别结果，可能有同音错字。',
    list.length ? '必须修正的人名/产品名：' + list.join('、') + '。' : '',
    context ? '会议背景：' + context : '',
    '规则：只输出修正后的句子，不要解释、不要加引号；原句正确就原样输出；不要改变意思、不要增删内容。',
  ].filter(Boolean).join('\n')
  return async function correct(text) {
    const src = String(text || '').trim()
    if (!src) return src
    try {
      const out = await completer([
        { role: 'system', content: prompt },
        { role: 'user', content: src },
      ])
      const clean = String(out || '').trim()
        .replace(/^["'「]|["'」]$/g, '')
        .split(/\r?\n/)[0]
        .trim()
      if (!clean) return src
      if (clean.length < Math.min(4, src.length)) return src
      return clean
    } catch { return src }
  }
}