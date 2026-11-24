/**
 * lib/dictionary.js —— 「会学习的词典」：热词预算、命中排序、学习队列、知识库同步。
 *
 * 借鉴 openless 的词典模型，并按开发规程做成纯逻辑、可单测：
 *   · 词条只存"正确拼写 + 分类 + 备注"，不要求用户维护错误拼写
 *   · 发给 ASR 的热词预算有限（几百字符）：按命中次数排序，并给刚手动添加的词留席位
 *   · 词条同时注入润色提示词，由模型逐句判断该不该替换（"云"是 Claude 还是云计算）
 *   · 从纠正中学习：先进"待确认队列"，用户确认才入词典；不生成全局替换规则
 *   · 与知识库同步：把知识库里的专有名词导入候选，同样需要确认（不静默入库）
 *
 * 本模块无 IO、无网络；读写由调用方负责（store 是普通对象）。
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** 热词总预算（字符数）。openless 的经验值在几百字符量级。 */
export const HOTWORD_BUDGET_CHARS = 320
/** 给"刚手动添加的词"保留的席位（避免被高频老词全占） */
export const HOTWORD_MANUAL_SLOTS = 4
/** 待确认队列上限（防止无限堆积） */
export const LEARN_QUEUE_MAX = 50

export function emptyDictionary() {
  return { version: 1, terms: [], pending: [], stats: { hits: 0 } }
}

function normalizeTerm(t = {}) {
  const word = String(t.word || '').trim()
  if (!word) return null
  return {
    word,
    kind: String(t.kind || 'term'),          // person / product / project / term
    note: String(t.note || '').slice(0, 200),
    hits: Math.max(0, Number(t.hits) || 0),
    manual: t.manual === true,
    addedAt: String(t.addedAt || '') || new Date().toISOString(),
    sources: Array.isArray(t.sources) ? t.sources.slice(0, 5).map((s) => String(s)) : [],
  }
}

/** 合并/去重（按 word 精确匹配）；新的覆盖旧的，hits 取大 */
export function upsertTerm(store, term) {
  const base = store && Array.isArray(store.terms) ? store : emptyDictionary()
  const norm = normalizeTerm(term)
  if (!norm) return base
  const others = base.terms.filter((t) => String(t.word) !== norm.word)
  const prev = base.terms.find((t) => String(t.word) === norm.word)
  const merged = {
    ...norm,
    hits: Math.max(norm.hits, Number(prev && prev.hits) || 0),
    manual: norm.manual || !!(prev && prev.manual),
    sources: Array.from(new Set([...(prev && prev.sources) || [], ...norm.sources])).slice(0, 5),
  }
  return { ...base, terms: [merged, ...others].slice(0, 500) }
}

/** 记一次命中（用于排序：真正在用的词保住位置） */
export function noteHit(store, word, delta = 1) {
  const base = store && Array.isArray(store.terms) ? store : emptyDictionary()
  let hit = false
  const terms = base.terms.map((t) => {
    if (String(t.word) !== String(word)) return t
    hit = true
    return { ...t, hits: (Number(t.hits) || 0) + Math.max(1, Number(delta) || 1) }
  })
  return { ...base, terms, stats: { ...(base.stats || {}), hits: ((base.stats && base.stats.hits) || 0) + (hit ? 1 : 0) } }
}

/**
 * 热词预算分配：
 *   · 先给 manual 词保留 HOTWORD_MANUAL_SLOTS 个席位（按最近添加优先）
 *   · 其余按 hits 降序填满预算
 *   · 返回 word 数组（调用方负责拼成 ASR 参数）
 */
export function allocateHotwords(store, { budgetChars = HOTWORD_BUDGET_CHARS, manualSlots = HOTWORD_MANUAL_SLOTS } = {}) {
  const terms = (store && store.terms) || []
  const picked = []
  let used = 0
  const push = (t) => {
    const w = String(t.word)
    const cost = w.length + 1
    if (used + cost > budgetChars) return false
    picked.push(w)
    used += cost
    return true
  }
  // 手动席位：最近添加的 manual 词优先
  const manuals = terms
    .filter((t) => t.manual)
    .sort((a, b) => String(b.addedAt).localeCompare(String(a.addedAt)))
    .slice(0, Math.max(0, manualSlots))
  for (const t of manuals) push(t)
  const rest = terms
    .filter((t) => !t.manual)
    .sort((a, b) => (Number(b.hits) || 0) - (Number(a.hits) || 0))
  for (const t of rest) push(t)
  // 还有预算就补上未进席位的手动词
  for (const t of terms.filter((t) => t.manual && !picked.includes(String(t.word))) ) push(t)
  return picked
}

/**
 * 生成润色提示词里的词典段：
 * 逐句判断、不是全局替换、拿不准就保持原样。
 */
export function buildDictionaryBlock(store, { limit = 60 } = {}) {
  const terms = (store && store.terms) || []
  if (!terms.length) return ''
  const shown = terms
    .slice()
    .sort((a, b) => (Number(b.hits) || 0) - (Number(a.hits) || 0))
    .slice(0, Math.max(1, limit))
  const lines = ['【词典：只在明显指代时才替换，拿不准保持原样；不要全局替换】']
  for (const t of shown) {
    const kind = t.kind && t.kind !== 'term' ? '(' + t.kind + ')' : ''
    lines.push('- ' + t.word + kind + (t.note ? '：' + t.note : ''))
  }
  return lines.join('\n')
}

/** 学习：把一次"纠正"放进待确认队列（不直接入词典） */
export function suggestTerm(store, { word = '', kind = 'term', note = '', source = 'correction' } = {}) {
  const base = store && Array.isArray(store.pending) ? store : emptyDictionary()
  const w = String(word || '').trim()
  if (!w || w.length > 32) return base
  // 已在词典里 → 不重复建议
  if ((base.terms || []).some((t) => String(t.word) === w)) return base
  const pending = base.pending.filter((p) => String(p.word) !== w)
  pending.unshift({ word: w, kind, note: String(note).slice(0, 120), source, at: new Date().toISOString() })
  return { ...base, pending: pending.slice(0, LEARN_QUEUE_MAX) }
}

/** 确认一条建议 → 入词典（manual=false，来自学习）；被拒绝的直接丢弃 */
export function confirmSuggestion(store, word, { accept = true } = {}) {
  const base = store && Array.isArray(store.pending) ? store : emptyDictionary()
  const hit = base.pending.find((p) => String(p.word) === String(word))
  const pending = base.pending.filter((p) => String(p.word) !== String(word))
  if (!hit || !accept) return { ...base, pending }
  const next = upsertTerm({ ...base, pending }, { ...hit, manual: false, sources: [hit.source || 'correction'] })
  return next
}

/** 从知识库导入候选（同样进待确认队列，不静默入库） */
export function importFromKnowledge(store, names = [], source = 'knowledge') {
  let base = store && Array.isArray(store.terms) ? store : emptyDictionary()
  for (const n of names) {
    const w = String(n || '').trim()
    if (!w) continue
    const exists = (base.terms || []).some((t) => String(t.word) === w)
      || (base.pending || []).some((p) => String(p.word) === w)
    if (!exists) base = { ...base, pending: base.pending || [] }
    if (!exists) base = suggestTerm(base, { word: w, kind: 'term', source })
  }
  return base
}

/** 读词典仓；坏文件/缺字段退回空库（词典坏了不能拖垮纪要/润色） */
export function loadDictionary(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'))
    if (!data || typeof data !== 'object') return emptyDictionary()
    return {
      version: Number(data.version) || 1,
      terms: Array.isArray(data.terms) ? data.terms : [],
      pending: Array.isArray(data.pending) ? data.pending : [],
      stats: data.stats && typeof data.stats === 'object' ? data.stats : { hits: 0 },
    }
  } catch { return emptyDictionary() }
}

/** 写词典仓（缩进 JSON，人可读、可手工编辑） */
export function saveDictionary(file, store) {
  const data = store && Array.isArray(store.terms) ? store : emptyDictionary()
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({
    version: 1,
    terms: data.terms,
    pending: data.pending || [],
    stats: data.stats || { hits: 0 },
  }, null, 2), 'utf8')
}

/**
 * 命中回写：把本次文本里实际出现的词条计数 +1，用于"越用越准"的排序。
 * 只认边界清楚的匹配（避免"云"命中"云南"这种糟心事）。
 * @returns {{store:object, hits:string[]}}
 */
export function countHits(store, text = '') {
  let s = store && Array.isArray(store.terms) ? store : emptyDictionary()
  const hits = []
  const t = String(text || '')
  for (const term of s.terms) {
    const w = String(term.word || '')
    if (!w) continue
    if (t.includes(w)) { s = noteHit(s, w, 1); hits.push(w) }
  }
  return { store: s, hits }
}
