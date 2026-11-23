/**
 * lib/kb-index.js —— 知识库索引：把会议纪要/知识文档里的"专有名词与主题"抽出来，
 * 供词典候选与提示词上下文使用（对应「知识库索引」与「词典 × 知识库闭环」）。
 *
 * 只做本地、无网络的轻量索引：
 *   · ingest(doc) 把一篇文档切成"词条 + 主题句"
 *   · search(query) 用词项重叠加权打分（不需要 embedding，启动零成本）
 *   · extractTerms(docs) 抽专有名词候选 → 交给 dictionary.importFromKnowledge（仍需确认）
 *
 * 刻意不做的事：不联网、不读用户隐私文本、不把整篇文档塞进提示词（只给命中的句子）。
 */

/** 中文场景下按"非词字符"切分；英文/数字保留 */
const TOKEN_RE = /[A-Za-z][A-Za-z0-9_\-.]{1,31}|[\u4e00-\u9fff]{2,8}/g
/** 常见虚词/口水词，避免污染索引 */
const STOP = new Set([
  '我们', '你们', '他们', '这个', '那个', '就是', '然后', '可以', '需要', '因为', '所以',
  '但是', '现在', '今天', '一下', '一些', '东西', '事情', '问题', '大家', '刚才', '还是',
])

export function tokens(text = '') {
  const t = String(text || '').toLowerCase()
  const out = new Set()
  // 两段式抽取：英文/数字整词 + 完整中文串（不设长度上限）。
  // 为什么要"完整中文串"：若直接用 {2,8} 的贪婪分块，会把
  // "我们今天讨论了腾讯会议的录制问题" 切成 "我们今天讨论了腾" / "讯会议的录制问题"，
  // 跨块的词（腾讯）就丢了，检索与候选词全部失真。
  const wordRe = /[A-Za-z][A-Za-z0-9_\-.]{1,31}/g
  for (const m of t.matchAll(wordRe)) {
    if (m[0].length >= 2) out.add(m[0])
  }
  const cjkRe = /[\u4e00-\u9fff]+/g
  for (const m of t.matchAll(cjkRe)) {
    const w = m[0]
    if (w.length <= 8) out.add(w)
    if (w.length >= 3) {
      for (let i = 0; i + 3 <= w.length; i++) {
        const g = w.slice(i, i + 3)
        if (!STOP.has(g)) out.add(g)
      }
    }
    for (let i = 0; i + 2 <= w.length; i++) {
      const g = w.slice(i, i + 2)
      if (!STOP.has(g)) out.add(g)
    }
  }
  return [...out]
}

/**
 * 建一篇文档的索引条目。
 * @param {{id?:string, title?:string, text?:string, tags?:string[]}} doc
 */
export function ingestDoc(doc = {}) {
  const text = String(doc.text || '')
  const sentences = text
    .split(/[。！？\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6)
  const id = String(doc.id || doc.title || '').slice(0, 120) || 'doc'
  return {
    id,
    title: String(doc.title || '').slice(0, 200),
    tags: (doc.tags || []).map((t) => String(t)).slice(0, 8),
    tokens: tokens([doc.title, (doc.tags || []).join(' '), text.slice(0, 4000)].join(' ')),
    sentences: sentences.slice(0, 200),
  }
}

/**
 * 检索：按词项重叠数加权（标题/标签命中额外加分），返回命中的句子。
 * @param {Array} index ingestDoc 的集合
 * @returns {Array<{id:string,title:string,score:number,snippets:string[]}>}
 */
export function search(index = [], query = '', { limit = 3, maxSnippets = 2 } = {}) {
  const q = tokens(query)
  if (!q.length) return []
  const qset = new Set(q)
  const results = []
  for (const doc of index) {
    if (!doc) continue
    let score = 0
    for (const tk of doc.tokens || []) {
      if (qset.has(tk)) score += tk.length >= 4 ? 2 : 1
    }
    if (!score) continue
    // 标题/标签命中加权
    const titleTokens = tokens(doc.title || '')
    for (const tk of titleTokens) if (qset.has(tk)) score += 2
    const snippets = []
    for (const s of doc.sentences || []) {
      let hit = 0
      for (const tk of qset) if (s.toLowerCase().includes(tk)) hit++
      if (hit >= 2 || (hit >= 1 && s.length < 40)) snippets.push(s)
      if (snippets.length >= maxSnippets) break
    }
    results.push({ id: doc.id, title: doc.title, score, snippets })
  }
  return results.sort((a, b) => b.score - a.score).slice(0, Math.max(1, limit))
}

/** 把检索结果拼成提示词片段（只给命中的句子，不塞整篇） */
export function buildKnowledgeBlock(results = []) {
  const rows = (results || []).filter((r) => r && (r.snippets || []).length)
  if (!rows.length) return ''
  const lines = ['【知识库参考（只用于理解术语与背景，不要照抄成结论）】']
  for (const r of rows) {
    lines.push('- ' + (r.title || r.id) + '：' + (r.snippets || []).join('；'))
  }
  return lines.join('\n')
}

/**
 * 抽专有名词候选：优先"多次出现且带英文/大写特征"或"标签"，交给词典待确认队列。
 * 不做自动入库。
 */
export function extractTerms(index = [], { minDocs = 1, limit = 40 } = {}) {
  const freq = new Map()
  for (const doc of index) {
    for (const tk of doc && doc.tokens || []) {
      const isLikelyName = /[A-Za-z]/.test(tk) || tk.length >= 3
      if (!isLikelyName) continue
      const rec = freq.get(tk) || { word: tk, docs: 0 }
      rec.docs += 1
      freq.set(tk, rec)
    }
    for (const tag of doc && doc.tags || []) {
      const rec = freq.get(String(tag)) || { word: String(tag), docs: 0 }
      rec.docs += 1
      freq.set(String(tag), rec)
    }
  }
  const all = [...freq.values()].filter((r) => r.docs >= minDocs && r.word.length >= 2 && r.word.length <= 32)
  const strong = all.filter((r) => r.word.length >= 3 || /[A-Za-z]/.test(r.word))
  return (strong.length ? strong : all)
    .sort((a, b) => (b.docs - a.docs) || (b.word.length - a.word.length))
    .slice(0, limit)
    .map((r) => r.word)
}
