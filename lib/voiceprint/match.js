/**
 * 声纹匹配：原型构建 + 打分 + 双门槛 + 拒绝原因。
 *
 * 逐条照 OpenASR 的 `voice_id/{prototypes,matcher,naming}.rs` 落地，
 * 数值也照抄（它们是在 AliMeeting 评测语料上校准过的）：
 *
 *   每人每空间最多 3 个原型（MAX_PROTOTYPES_PER_PERSON）
 *   样本聚类用单链接 + 余弦距离 0.35（DEFAULT_CLUSTER_COSINE_DISTANCE）
 *   原型代表 = medoid **真实样本**（不是平均向量）
 *   score = medoid 余弦 + clamp(top2 成员余弦×质量权重 之和 × 0.08, 0, 0.06)
 *   接受 = score ≥ 0.60 且 (没有第二名 或 领先 ≥ 0.15)
 *   证据 = ≥ 3 秒可用语音，且窗口数够
 *
 * 关键产品判断：**误认比不认更糟**。所以门槛不满足时一律保留匿名标签，
 * 并且把"为什么没认出来"连同具体数字一起交给界面。
 */

export const ACCEPT_SIMILARITY = 0.60
export const MATCH_MARGIN = 0.15
export const MAX_PROTOTYPES_PER_PERSON = 3
export const CLUSTER_COSINE_DISTANCE = 0.35
export const MIN_NAMING_EVIDENCE_SECONDS = 3.0
export const SUPPORT_SCALE = 0.08
export const SUPPORT_CAP = 0.06

/** 余弦相似度（入参数组可已是归一化向量，但这里仍按通用公式算，避免假设） */
export function cosine(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** L2 归一化（调用方负责；参考实现也是这么要求的） */
export function l2normalize(vec) {
  const out = new Float32Array(vec.length)
  let norm = 0
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm)
  if (!norm) return out
  for (let i = 0; i < vec.length; i++) out[i] = vec[i] / norm
  return out
}

/** 质量加权平均（重建质心；仅用于"整簇代表"这类诊断与聚类，不用于原型 medoid） */
export function weightedMean(vectors, weights) {
  const dim = vectors[0] ? vectors[0].length : 0
  const out = new Float32Array(dim)
  let total = 0
  for (let i = 0; i < vectors.length; i++) {
    const w = Math.max(0.05, Number(weights && weights[i]) || 1)
    total += w
    for (let d = 0; d < dim; d++) out[d] += vectors[i][d] * w
  }
  if (total > 0) for (let d = 0; d < dim; d++) out[d] /= total
  return l2normalize(out)
}

/**
 * 单链接聚类（余弦距离阈值）。返回下标数组的簇。
 * 不引入 k-means：样本数很少（几十个），单链接够用且结果确定。
 */
export function clusterByCosine(vectors, distance = CLUSTER_COSINE_DISTANCE) {
  const n = vectors.length
  const parent = new Array(n).fill(0).map((_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = 1 - cosine(vectors[i], vectors[j])
      if (dist <= distance) union(i, j)
    }
  }
  const groups = new Map()
  for (let i = 0; i < n; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(i)
  }
  return Array.from(groups.values())
}

/**
 * 从一个人的多个样本构建原型：每个簇取 medoid（成员中到其他成员
 * 质量加权平均距离最小的**真实样本**），最多 3 个，按信息量排序保留。
 *
 * @param {{sampleId: string, embedding: Float32Array, weight?: number}[]} samples
 * @returns {{prototypeId: string, medoidSampleId: string, medoid: Float32Array, members: {sampleId, weight}[]}[]}
 */
export function buildPrototypes(samples, { maxPrototypes = MAX_PROTOTYPES_PER_PERSON, distance = CLUSTER_COSINE_DISTANCE } = {}) {
  const usable = (samples || []).filter((s) => s && s.embedding && s.embedding.length)
  if (!usable.length) return []
  const clusters = clusterByCosine(usable.map((s) => s.embedding), distance)
  const out = []
  for (const cluster of clusters) {
    const members = cluster.map((i) => usable[i])
    const weights = members.map((m) => Math.max(0.05, Number(m.weight) || 1))
    // medoid：使质量加权平均余弦距离最小的成员
    let bestIdx = 0, bestCost = Infinity
    for (let i = 0; i < members.length; i++) {
      let cost = 0, wsum = 0
      for (let j = 0; j < members.length; j++) {
        if (i === j) continue
        cost += (1 - cosine(members[i].embedding, members[j].embedding)) * weights[j]
        wsum += weights[j]
      }
      cost = wsum ? cost / wsum : 0
      if (cost < bestCost) { bestCost = cost; bestIdx = i }
    }
    const medoid = members[bestIdx]
    const rank = weights.reduce((a, b) => a + b, 0) + (weights[bestIdx] || 0) + members.length * 0.05
    out.push({
      prototypeId: 'proto-' + medoid.sampleId,
      medoidSampleId: medoid.sampleId,
      medoid: medoid.embedding,
      members: members.map((m) => ({ sampleId: m.sampleId, weight: Math.max(0.05, Number(m.weight) || 1) })),
      rank,
    })
  }
  return out.sort((a, b) => b.rank - a.rank).slice(0, maxPrototypes)
}

/**
 * 单个原型对 query 的打分：medoid 余弦 + 支持加分（最多 +0.06）。
 * 支持加分只在前两名成员上算，防止"传了一堆重复样本"靠数量取胜。
 */
export function scorePrototype(prototype, query, memberEmbeddings) {
  if (!prototype || !prototype.medoid || prototype.medoid.length !== query.length) return -Infinity
  const medoidSim = cosine(prototype.medoid, query)
  const scores = []
  for (const member of prototype.members || []) {
    const found = memberEmbeddings && memberEmbeddings[member.sampleId]
    if (!found || found.length !== query.length) continue
    scores.push(cosine(found, query) * Math.min(1, Math.max(0.05, member.weight || 1)))
  }
  scores.sort((a, b) => b - a)
  const support = scores.slice(0, 2).reduce((a, b) => a + b, 0)
  const supportBonus = Math.min(SUPPORT_CAP, Math.max(0, support * SUPPORT_SCALE))
  return medoidSim + supportBonus
}

/**
 * 在人员库里找最像的人。**双门槛**：分数够 + 领先够。
 *
 * @returns {{ok: true, match: object} | {ok: false, reason: string, detail: object}}
 */
export function matchPerson({ query, persons = [], memberEmbeddingsOf = () => ({}), accept = ACCEPT_SIMILARITY, margin = MATCH_MARGIN } = {}) {
  if (!query || !query.length) return { ok: false, reason: 'no-evidence', detail: {} }
  if (!persons.length) return { ok: false, reason: 'library-empty', detail: { bestScore: null, acceptThreshold: accept } }

  let best = null
  let runnerUp = null
  for (const person of persons) {
    const members = memberEmbeddingsOf(person.personId)
    let personBest = -Infinity
    let bestProto = null
    for (const proto of person.prototypes || []) {
      const score = scorePrototype(proto, query, members)
      if (Number.isFinite(score) && score > personBest) { personBest = score; bestProto = proto }
    }
    if (!Number.isFinite(personBest)) continue
    const candidate = {
      personId: person.personId,
      displayName: person.displayName,
      score: personBest,
      prototypeId: bestProto ? bestProto.prototypeId : '',
      sampleId: bestProto ? bestProto.medoidSampleId : '',
    }
    if (!best || candidate.score > best.score) {
      if (best && best.score > (runnerUp || -Infinity)) runnerUp = best.score
      best = candidate
    } else if (candidate.score > (runnerUp || -Infinity)) {
      runnerUp = candidate.score
    }
  }

  if (!best) {
    return { ok: false, reason: 'incomparable', detail: { acceptThreshold: accept } }
  }
  if (best.score < accept) {
    return {
      ok: false, reason: 'below-threshold',
      detail: { bestScore: round(best.score), acceptThreshold: accept, bestName: best.displayName },
    }
  }
  if (runnerUp !== null && best.score - runnerUp < margin) {
    return {
      ok: false, reason: 'ambiguous',
      detail: { bestScore: round(best.score), runnerUpScore: round(runnerUp), marginRequired: margin, bestName: best.displayName },
    }
  }
  return { ok: true, match: { ...best, score: round(best.score), runnerUpScore: runnerUp === null ? null : round(runnerUp) } }
}

const round = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v)

/**
 * 证据够不够给名字。
 * 少于 3 秒可用语音就不给——这是"宁可匿名"的核心约束。
 *
 * `requiredContinuousSeconds` 只能由引擎按窗口几何给出（参考项目的教训：
 * 不要拿 required_seconds 去告诉用户"再录 3 秒"，那会二次失败）。
 */
export function checkEvidence({ keptSeconds = 0, windows = 0, minWindows = 5, minSeconds = MIN_NAMING_EVIDENCE_SECONDS } = {}) {
  if (windows < minWindows || keptSeconds < minSeconds) {
    const byWindows = Math.ceil((minWindows - windows) / 2) * 1.0
    const bySeconds = Math.max(0, Math.ceil((minSeconds - keptSeconds) * 10) / 10)
    return {
      ok: false,
      reason: 'not-enough-speech',
      detail: {
        windows,
        requiredWindows: minWindows,
        seconds: Math.round(keptSeconds * 100) / 100,
        requiredSeconds: minSeconds,
        // 一句连续说多久才能同时满足两个门槛（窗口几何决定，取更严格的那个）
        requiredContinuousSeconds: Math.max(4, bySeconds + 2, byWindows + 2),
      },
    }
  }
  return { ok: true, detail: { windows, seconds: Math.round(keptSeconds * 100) / 100 } }
}

/**
 * 证据窗口规划（逐步照 evidence.rs 的规则）。
 *
 * 常量：2.0 秒窗口、1.0 秒步进、turn 首尾各修 0.5 秒、每人最多 20 个窗口；
 * 只在"这一处没有别人同时说话"的地方取窗口（重叠即污染，不靠更聪明的过滤补救）。
 *
 * @param {{begin:number,end:number,speaker:string}[]} lines 毫秒区间
 * @param {{window?:number, step?:number, trim?:number, maxWindows?:number}} [opts]
 */
export function planWindows(lines, opts = {}) {
  const window = Number(opts.window) || 2.0
  const step = Number(opts.step) || 1.0
  const trim = Number(opts.trim) || 0.5
  const maxWindows = Number(opts.maxWindows) || 20
  const segs = (lines || [])
    .filter((l) => l && l.speaker && Number.isFinite(l.begin) && Number.isFinite(l.end) && l.end > l.begin)
    .map((l) => ({ speaker: l.speaker, start: l.begin / 1000, end: l.end / 1000 }))
  const wanted = segs.length ? segs[0].speaker : ''
  // 每个目标说话人的 turn 合并：相邻同人段如果间隔很小就算同一段
  const turns = []
  for (const s of segs) {
    if (s.speaker !== wanted) continue
    const last = turns[turns.length - 1]
    if (last && s.start - last.end < 1.0) last.end = Math.max(last.end, s.end)
    else turns.push({ speaker: s.speaker, start: s.start, end: s.end })
  }
  // 别人说话的区间：窗口与它重叠就不要
  const others = segs.filter((s) => s.speaker !== wanted)
  const out = []
  for (const turn of turns) {
    const first = turn.start + trim
    const last = turn.end - trim
    let start = first
    while (start + window <= last + 1e-9) {
      const end = start + window
      const contaminated = others.some((o) => Math.min(end, o.end) - Math.max(start, o.start) > 0)
      if (!contaminated) {
        out.push({ start: round3(start), end: round3(end), speaker: wanted })
        if (out.length >= maxWindows) return out
      }
      start += step
    }
    if (out.length >= maxWindows) return out
  }
  return out
}

const round3 = (v) => Math.round(v * 1000) / 1000
