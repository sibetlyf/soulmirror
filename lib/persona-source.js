/**
 * 人格提取的原料筛选。
 *
 * 用户定的规则（长期适用）：
 *   **没有说话人标注的会议转写，不许用来提取人格。**
 *
 * 为什么：
 *   人格画像是"她是谁"。没有标注时，转写里混着所有人的话——
 *   把同事的观点记成她的立场，比"没有画像"严重得多。
 *   宁可不长，也不能长错。
 *
 * 这个模块只做筛选与拼装（纯函数），不做任何 IO 或模型调用。
 */

/** 一条转写是否带说话人标注 */
export function hasSpeaker(line) {
  const s = String((line && line.speaker) || '').trim()
  return s.length > 0
}

/**
 * 从转写里挑出"可以进人格提取"的句子。
 *
 * 排除：
 *   · 没有说话人
 *   · 助手自己的话（role=assistant）
 *   · 断点标记（src=gap；那不是人说的话）
 *   · 空文本
 *
 * @param {Array<{text?: string, speaker?: string, role?: string, src?: string}>} lines
 * @returns {Array<{text: string, speaker: string}>}
 */
export function pickSpeakerLines(lines = []) {
  const out = []
  for (const it of Array.isArray(lines) ? lines : []) {
    if (!it) continue
    if (it.role === 'assistant') continue
    if (it.src === 'gap') continue
    const text = String(it.text || '').trim()
    if (!text) continue
    const speaker = String(it.speaker || '').trim()
    if (!speaker) continue
    out.push({ text, speaker })
  }
  return out
}

/** 这批转写里到底有没有可用的说话人标注 */
export function hasSpeakerLabels(lines = []) {
  return pickSpeakerLines(lines).length > 0
}

/**
 * 拼成给模型看的文本（带说话人前缀）。
 * 超长时保留首尾——开头定背景，结尾出结论。
 *
 * @param {Array} lines 原转写
 * @param {{maxChars?: number, headLines?: number, tailLines?: number}} [opts]
 * @returns {{text: string, used: number, omitted: number, speakers: string[]}}
 */
export function renderSpeakerTranscript(lines = [], opts = {}) {
  const { maxChars = 3000, headLines = 24, tailLines = 24 } = opts
  const picked = pickSpeakerLines(lines)
  const speakers = Array.from(new Set(picked.map((x) => x.speaker)))
  const rows = picked.map((x) => x.speaker + '：' + x.text)

  if (rows.length <= headLines + tailLines) {
    return { text: rows.join('\n').slice(0, maxChars), used: rows.length, omitted: 0, speakers }
  }
  const head = rows.slice(0, headLines)
  const tail = rows.slice(-tailLines)
  const omitted = rows.length - head.length - tail.length
  const text = (head.join('\n') + '\n…（中间省略 ' + omitted + ' 句）…\n' + tail.join('\n')).slice(0, maxChars)
  return { text, used: head.length + tail.length, omitted, speakers }
}

/**
 * 不能提取时，给用户一句人话说明（不要只说"跳过"）。
 * @returns {string} 空串表示可以提取
 */
export function whyNoPersona(lines = []) {
  const all = Array.isArray(lines) ? lines : []
  const usable = all.filter((x) => x && String(x.text || '').trim())
  if (!usable.length) return '本场没有可用的转写'
  if (!hasSpeakerLabels(all)) {
    return '本场转写没有说话人标注，跳过人格提取（否则会把别人的观点记成你的立场）'
  }
  return ''
}

/**
 * 从一句话里认出"是不是她本人"。
 *
 * 这里有两条独立线索，任一命中就够了：
 *   1. 说话人字段等于她（或她的别称）
 *   2. 文本里出现她的名字/称呼
 *
 * 认不出来就**不猜**——返回 false。
 *
 * @param {{speaker?: string, text?: string}} line
 * @param {{names?: string[]}} [o]
 */
export function isHerLine(line = {}, { names = [] } = {}) {
  const sp = String(line.speaker || '').trim()
  const text = String(line.text || '').trim()
  const pool = (Array.isArray(names) ? names : []).map((x) => String(x || '').trim()).filter(Boolean)
  if (!sp && !text) return false
  for (const n of pool) {
    if (!n) continue
    if (sp && (sp === n || sp.includes(n) || n.includes(sp))) return true
  }
  for (const n of pool) {
    if (n && text.includes(n)) return true
  }
  return false
}

/**
 * 择优：从几种原料里挑一个"带说话人标注"的来提取人格。
 *
 * 为什么要有优先级：
 *   实时转写默认不做说话人分离（省钱），所以多数会议没有标注；
 *   而**会后重转写会做说话人分离**，它的产物质量更好。
 *   所以按 离线产物 > 实时转写 的顺序挑。
 *
 * @param {{offline?: Array, live?: Array}} o
 * @returns {{lines: Array, source: 'offline'|'live'|'none', speakers: string[]}}
 */
export function choosePersonaSource({ offline = [], live = [] } = {}) {
  const off = pickSpeakerLines(offline)
  if (off.length) {
    return { lines: off, source: 'offline', speakers: Array.from(new Set(off.map((x) => x.speaker))) }
  }
  const lv = pickSpeakerLines(live)
  if (lv.length) {
    return { lines: lv, source: 'live', speakers: Array.from(new Set(lv.map((x) => x.speaker))) }
  }
  return { lines: [], source: 'none', speakers: [] }
}

/** 跳过时给出的开启方法（别只说"跳过"，要告诉人怎么开） */
export function enableHint() {
  return '要让人格生长：在配置里把 asr.speakerDiarization 打开（实时转写做说话人分离），' +
    '或让会后重转写跑成功（它自带分离）。没有说话人时宁可不提取。'
}
