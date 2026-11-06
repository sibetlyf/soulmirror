/**
 * 人格成长：把"每场会提取到的碎片"变成一份**稳定的用户画像**。
 *
 * 之前的问题（都是真问题）：
 *   1. 只有 user / state 两层在被更新，SOUL 与 IDENTITY 从不成长
 *   2. 追加式写入：只做**完全一样**的文本去重，近义句会越积越多
 *   3. 没有置信度：随口一句和反复强调的立场，权重相同
 *   4. 没有冲突处理：前后矛盾的两条会并存，模型只能二选一瞎猜
 *   5. state 永不过期：三个月前的项目进展会被当成"当前状态"
 *   6. 没有风格与立场：只能记住"事实"，记不住"她怎么说话、怎么判断"
 *   7. 拼接是原样 dump：长到 8000 字就砍最旧的一节，重要的可能刚好被砍掉
 *
 * 这个模块解决 1~7 的**数据结构部分**（纯函数，不碰文件、不调模型）：
 *   - 分五层：identity（身份）/ style（说话方式）/ stance（立场）/ facts（事实）/ state（近期状态）
 *   - 每条带 key、value、confidence、seen、firstAt、lastAt、history
 *   - 同 key 同义 → 强化；同 key 冲突 → 取代（旧值进 history）
 *   - state 有 TTL，过期自动淡出
 *   - 输出按 score（置信度 × 新近度）裁剪并限字数
 */

export const SECTIONS = ['identity', 'style', 'stance', 'facts', 'state']

/** 每层默认上限：越靠前越"稳定"，配额越大 */
export const DEFAULT_LIMITS = {
  identity: 12,
  style: 12,
  stance: 16,
  facts: 40,
  state: 12,
}

/** state 默认保留 21 天：项目进展会变，不该永久生效 */
export const DEFAULT_STATE_TTL_MS = 21 * 24 * 60 * 60 * 1000

/** 归一化：去空白、去标点、英文小写，便于判重 */
export function normKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：！？,.;:!?"'“”‘’()（）\[\]【】-]/g, '')
    .slice(0, 60)
}

/** 粗略相似：字符二元组重合率（中文场景够用，不引依赖） */
export function similarText(a, b) {
  const x = normKey(a)
  const y = normKey(b)
  if (!x || !y) return 0
  if (x === y) return 1
  const grams = (s) => {
    const out = new Map()
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2)
      out.set(g, (out.get(g) || 0) + 1)
    }
    return out
  }
  const gx = grams(x)
  const gy = grams(y)
  let hit = 0
  let total = 0
  for (const [g, c] of gx) {
    total += c
    const d = gy.get(g) || 0
    hit += Math.min(c, d)
  }
  for (const [, c] of gy) total += c
  if (!total) return 0
  return (2 * hit) / total
}

/**
 * 把模型吐出的一条条目规整成内部形状。
 * @returns {{section: string, key: string, value: string, confidence: number} | null}
 */
export function normalizeItem(raw) {
  if (!raw) return null
  const section = SECTIONS.includes(raw.section) ? raw.section : 'facts'
  const value = String(raw.value || raw.text || '').trim().slice(0, 120)
  if (!value) return null
  const key = normKey(raw.key || value).slice(0, 40)
  const conf = Number(raw.confidence)
  return {
    section,
    key,
    value,
    confidence: Number.isFinite(conf) ? Math.max(0.1, Math.min(1, conf)) : 0.5,
  }
}

/** 新建空画像 */
export function emptyProfile() {
  const p = { version: 1, updatedAt: '', sections: {} }
  for (const s of SECTIONS) p.sections[s] = []
  return p
}

function score(item, now) {
  const ageDays = item.lastAt ? (now - Date.parse(item.lastAt)) / 86400000 : 999
  // 新近度：21 天内几乎不衰减，之后快速下降
  const recency = 1 / (1 + Math.max(0, ageDays - 21) / 30)
  return (item.confidence || 0.5) * (1 + Math.log1p(item.seen || 1)) * recency
}

/**
 * 合并一批条目进画像（返回新对象，不修改入参）。
 *
 * 规则：
 *   - 同 key + 值相似（≥0.6）→ 强化：seen+1、置信度上抬、lastAt 更新
 *   - 同 key + 值不同      → 取代：旧值压进 history（最多 3 条）
 *   - 无 key 冲突但值高度相似（≥0.85）→ 视为同一条，强化
 *   - 每层超过配额时，按 score 保留（不是按时间砍最旧）
 *   - state 超过 TTL 直接丢弃
 *
 * @param {object} profile emptyProfile() 的结果
 * @param {Array} incoming normalizeItem 的结果数组
 * @param {{now?: number, limits?: object, stateTtlMs?: number}} [opts]
 */
export function mergeProfile(profile, incoming = [], opts = {}) {
  const now = opts.now || Date.now()
  const limits = { ...DEFAULT_LIMITS, ...(opts.limits || {}) }
  const stateTtlMs = opts.stateTtlMs == null ? DEFAULT_STATE_TTL_MS : opts.stateTtlMs
  const iso = new Date(now).toISOString()

  const next = {
    version: 1,
    updatedAt: iso,
    sections: {},
  }
  for (const s of SECTIONS) {
    next.sections[s] = (profile && profile.sections && profile.sections[s] ? profile.sections[s] : [])
      .map((x) => ({ ...x, history: Array.isArray(x.history) ? x.history.slice(-3) : [] }))
  }

  let reinforced = 0
  let superseded = 0
  let added = 0

  for (const raw of incoming) {
    const item = normalizeItem(raw)
    if (!item) continue
    const list = next.sections[item.section] || (next.sections[item.section] = [])

    const sameKey = list.find((x) => x.key === item.key)
    if (sameKey) {
      if (similarText(sameKey.value, item.value) >= 0.6) {
        sameKey.seen = (sameKey.seen || 1) + 1
        sameKey.confidence = Math.min(1, (sameKey.confidence || 0.5) + 0.15)
        sameKey.lastAt = iso
        // 保留更长、更具体的表述
        if (item.value.length > sameKey.value.length) sameKey.value = item.value
        reinforced += 1
      } else {
        sameKey.history = [...(sameKey.history || []), { value: sameKey.value, at: sameKey.lastAt || iso }].slice(-3)
        sameKey.value = item.value
        sameKey.seen = 1
        sameKey.confidence = Math.max(0.4, item.confidence)
        sameKey.lastAt = iso
        superseded += 1
      }
      continue
    }

    // 无 key 冲突，但值几乎一样（模型换了 key 的写法）→ 强化已有那条
    const near = list.find((x) => similarText(x.value, item.value) >= 0.85)
    if (near) {
      near.seen = (near.seen || 1) + 1
      near.confidence = Math.min(1, (near.confidence || 0.5) + 0.15)
      near.lastAt = iso
      reinforced += 1
      continue
    }

    list.push({
      key: item.key,
      value: item.value,
      confidence: item.confidence,
      seen: 1,
      firstAt: iso,
      lastAt: iso,
      history: [],
    })
    added += 1
  }

  // 过期与配额
  let expired = 0
  for (const s of SECTIONS) {
    let list = next.sections[s] || []
    if (s === 'state') {
      const before = list.length
      list = list.filter((x) => {
        const t = Date.parse(x.lastAt || '') || 0
        return now - t <= stateTtlMs
      })
      expired += before - list.length
    }
    list.sort((a, b) => score(b, now) - score(a, now))
    next.sections[s] = list.slice(0, limits[s] || 20)
  }

  return { profile: next, stats: { added, reinforced, superseded, expired } }
}

/**
 * 渲染成给模型看的紧凑块。
 *
 * 顺序有讲究：先"她是谁 / 怎么说话 / 站哪边"（决定口吻与判断），
 * 再"事实"，最后"近期状态"。超字数时从后往前丢，保证人格底色不丢。
 */
export function renderProfile(profile, { maxChars = 4000, now = Date.now() } = {}) {
  const order = ['identity', 'style', 'stance', 'facts', 'state']
  const title = {
    identity: '身份（长期不变）',
    style: '说话方式（照她的口吻）',
    stance: '立场与偏好（按她的角度判断）',
    facts: '已知事实',
    state: '近期状态（可能已变化）',
  }
  const blocks = []
  for (const s of order) {
    const list = (profile && profile.sections && profile.sections[s]) || []
    if (!list.length) continue
    const lines = list.map((x) => '- ' + x.value)
    blocks.push('### ' + title[s] + '\n' + lines.join('\n'))
  }
  if (!blocks.length) return ''

  // 从后往前丢块，直到满足字数
  let out = blocks.slice()
  while (out.length > 1 && out.join('\n\n').length > maxChars) out = out.slice(0, -1)
  let text = out.join('\n\n')
  if (text.length > maxChars) text = text.slice(0, maxChars) + '\n…（已截断）'
  return text
}
