/**
 * lib/living.js —— 活数据层（Living Data）
 *
 * 概念（记忆呼吸 / 信念进化 / 情绪地形）来自本项目需求方；
 * 四层人格文件的组织方式借鉴自 yuhui-sama/dsh-agentsoul。
 *
 * 三个核心隐喻，全部落成可计算的数据结构：
 *  1. 记忆会呼吸：每段记忆有 vitality（0~1），随时间衰减、被回想时复苏；
 *     低于阈值进入 sleep（沉睡），再次被召回会重新绽放（bloom）。
 *  2. 信念会进化：一条信念从 seed 长成 sprout → sapling → tree，
 *     反复被强化会长大，长期被反驳会枯萎直至 dead（保留墓碑）。
 *  3. 情绪成地形：情绪事件按时间衰减后聚合成一张心像地图，
 *     不同情绪塑造不同地形（平原/山谷/火山/雾/湖），信念则长成建筑。
 *
 * 全部持久化到 JSON，纯本地、可解释、可回放。
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const DAY = 86400000

function loadJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return raw && typeof raw === 'object' ? raw : fallback
  } catch {
    return fallback
  }
}

function saveJson(file, data) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 1), 'utf8')
  } catch { /* ignore */ }
}

function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 10)
}

// ── 记忆：会呼吸 ────────────────────────────────────────────────────────
export class LivingMemory {
  constructor(file, opts = {}) {
    this.file = file
    this.halfLifeMs = opts.halfLifeMs || 3 * DAY
    this.sleepBelow = opts.sleepBelow ?? 0.15
    this.max = opts.max || 2000
    const raw = loadJson(file, { version: 1, entries: [] })
    this.entries = Array.isArray(raw.entries) ? raw.entries : []
  }

  save() { saveJson(this.file, { version: 1, entries: this.entries.slice(-this.max) }) }

  add(text, { kind = 'talk', weight = 1, at = Date.now(), source = '' } = {}) {
    const clean = String(text || '').trim()
    if (!clean) return null
    const v = Math.max(0.2, Math.min(1, weight))
    const entry = {
      id: uid('mem'),
      text: clean.slice(0, 500),
      kind,
      source,
      bornAt: at,
      lastAt: at,
      lastRecallAt: at,
      recalls: 0,
      vitality: v,
      stage: 'bloom',
    }
    this.entries.push(entry)
    if (this.entries.length > this.max) this.entries = this.entries.slice(-this.max)
    this.save()
    return entry
  }

  /** 时间流逝：指数衰减 + 阶段迁移 */
  decay(now = Date.now()) {
    let slept = 0
    for (const e of this.entries) {
      const dt = Math.max(0, now - (e.lastAt || e.bornAt || now))
      if (dt <= 0) continue
      const factor = Math.pow(0.5, dt / this.halfLifeMs)
      e.vitality = Math.max(0, (e.vitality ?? 0.5) * factor)
      e.lastAt = now
      const before = e.stage
      e.stage = e.vitality >= 0.6 ? 'bloom' : e.vitality >= this.sleepBelow ? 'awake' : 'sleep'
      if (e.stage === 'sleep' && before !== 'sleep') slept += 1
    }
    this.save()
    return { slept, total: this.entries.length }
  }

  /** 被想起：复苏 + 计数 */
  recall(idOrText, boost = 0.3, now = Date.now()) {
    const hits = []
    for (const e of this.entries) {
      if (e.id === idOrText || (idOrText && e.text.includes(String(idOrText)))) hits.push(e)
    }
    for (const e of hits.slice(0, 5)) {
      e.vitality = Math.min(1, (e.vitality ?? 0) + boost)
      e.recalls += 1
      e.lastRecallAt = now
      e.lastAt = now
      e.stage = e.vitality >= 0.6 ? 'bloom' : e.vitality >= this.sleepBelow ? 'awake' : 'sleep'
    }
    if (hits.length) this.save()
    return hits
  }

  /** 注入上下文时自动复苏：按活性取前 n 条，并顺手 revive */
  breathe(n = 8, now = Date.now()) {
    const sorted = [...this.entries].sort((a, b) => (b.vitality ?? 0) - (a.vitality ?? 0))
    const top = sorted.slice(0, n)
    for (const e of top) this.recall(e.id, 0.08, now)
    return top
  }

  stats() {
    const out = { total: this.entries.length, bloom: 0, awake: 0, sleep: 0 }
    for (const e of this.entries) out[e.stage || 'awake'] = (out[e.stage || 'awake'] || 0) + 1
    const avg = this.entries.length
      ? this.entries.reduce((s, e) => s + (e.vitality ?? 0), 0) / this.entries.length
      : 0
    return { ...out, avgVitality: Number(avg.toFixed(3)) }
  }

  top(n = 10) {
    return [...this.entries].sort((a, b) => (b.vitality ?? 0) - (a.vitality ?? 0)).slice(0, n)
  }
}

// ── 信念：会进化 ────────────────────────────────────────────────────────
const BELIEF_STAGES = ['seed', 'sprout', 'sapling', 'tree', 'dead']

export class BeliefGarden {
  constructor(file) {
    this.file = file
    const raw = loadJson(file, { version: 1, beliefs: [] })
    this.beliefs = Array.isArray(raw.beliefs) ? raw.beliefs : []
  }

  save() { saveJson(this.file, { version: 1, beliefs: this.beliefs }) }

  seed(statement, { source = 'meeting', at = Date.now() } = {}) {
    const text = String(statement || '').trim()
    if (!text) return null
    const dup = this.beliefs.find((b) => b.statement === text && b.stage !== 'dead')
    if (dup) return this.reinforce(dup.id, source)
    const b = {
      id: uid('bel'),
      statement: text.slice(0, 200),
      stage: 'seed',
      strength: 0.3,
      evidence: [{ at, source, delta: 0.3 }],
      bornAt: at,
      lastAt: at,
    }
    this.beliefs.push(b)
    this.save()
    return b
  }

  reinforce(id, source = 'reinforce', delta = 0.2, at = Date.now()) {
    const b = this.beliefs.find((x) => x.id === id)
    if (!b) return null
    b.strength = Math.min(1, b.strength + delta)
    b.evidence.push({ at, source, delta })
    b.lastAt = at
    this.evolve()
    return b
  }

  weaken(id, source = 'contradict', delta = 0.25, at = Date.now()) {
    const b = this.beliefs.find((x) => x.id === id)
    if (!b) return null
    b.strength = Math.max(0, b.strength - delta)
    b.evidence.push({ at, source, delta: -delta })
    b.lastAt = at
    this.evolve()
    return b
  }

  /** 按强度把信念推进到对应阶段；强度归零则死亡 */
  evolve() {
    for (const b of this.beliefs) {
      if (b.stage === 'dead') continue
      if (b.strength <= 0.02) { b.stage = 'dead'; continue }
      if (b.strength >= 0.85) b.stage = 'tree'
      else if (b.strength >= 0.6) b.stage = 'sapling'
      else if (b.strength >= 0.35) b.stage = 'sprout'
      else b.stage = 'seed'
    }
    this.save()
    return this.summary()
  }

  /** 长期没被强化的信念缓慢退化 */
  wither(now = Date.now(), halfLifeMs = 30 * DAY) {
    let died = 0
    for (const b of this.beliefs) {
      if (b.stage === 'dead') continue
      const dt = Math.max(0, now - (b.lastAt || b.bornAt || now))
      if (dt > halfLifeMs) {
        b.strength *= 0.5
        b.lastAt = now
        if (b.strength <= 0.02) { b.stage = 'dead'; died += 1 }
      }
    }
    this.evolve()
    return { died }
  }

  alive() { return this.beliefs.filter((b) => b.stage !== 'dead') }

  summary() {
    const out = {}
    for (const s of BELIEF_STAGES) out[s] = 0
    for (const b of this.beliefs) out[b.stage] = (out[b.stage] || 0) + 1
    return out
  }
}

// ── 情绪：成地形 ────────────────────────────────────────────────────────
const EMOTIONS = ['joy', 'sadness', 'anger', 'fear', 'calm', 'surprise']
const BIOME = {
  joy: { name: '光原', color: '#f6d365' },
  sadness: { name: '幽谷', color: '#6b7280' },
  anger: { name: '火山', color: '#ef4444' },
  fear: { name: '迷雾', color: '#8b9dc3' },
  calm: { name: '静湖', color: '#60a5fa' },
  surprise: { name: '风原', color: '#a78bfa' },
}

export class EmotionWorld {
  constructor(file, opts = {}) {
    this.file = file
    this.halfLifeMs = opts.halfLifeMs || 1.5 * DAY
    this.grid = opts.grid || 8
    const raw = loadJson(file, { version: 1, log: [] })
    this.log = Array.isArray(raw.log) ? raw.log : []
  }

  save() { saveJson(this.file, { version: 1, log: this.log.slice(-3000) }) }

  feel(emotion, intensity = 0.5, { source = '', at = Date.now() } = {}) {
    const e = EMOTIONS.includes(emotion) ? emotion : 'calm'
    const row = { at, emotion: e, intensity: Math.max(0, Math.min(1, intensity)), source }
    this.log.push(row)
    this.save()
    return row
  }

  /** 最近 windowMs 的情绪权重（带衰减） */
  weights(now = Date.now(), windowMs = 3 * DAY) {
    const w = Object.fromEntries(EMOTIONS.map((e) => [e, 0]))
    for (const r of this.log) {
      const dt = now - r.at
      if (dt < 0 || dt > windowMs) continue
      w[r.emotion] += r.intensity * Math.pow(0.5, dt / this.halfLifeMs)
    }
    return w
  }

  /** 心像地形：grid×grid，每格归属主导情绪，形成 biome 地图 */
  terrain(now = Date.now()) {
    const n = this.grid
    const w = this.weights(now)
    const total = Object.values(w).reduce((a, b) => a + b, 0) || 1
    const dominant = Object.entries(w).sort((a, b) => b[1] - a[1])[0][0]
    const cells = []
    for (let y = 0; y < n; y++) {
      const row = []
      for (let x = 0; x < n; x++) {
        // 用位置噪声 + 情绪权重决定每格地形，保证同一情绪风格一致又可重复
        const seed = ((x * 73856093) ^ (y * 19349663)) >>> 0
        const r = (seed % 1000) / 1000
        let e = dominant
        let acc = 0
        for (const [em, v] of Object.entries(w).sort((a, b) => b[1] - a[1])) {
          acc += v / total
          if (r <= acc) { e = em; break }
        }
        row.push({ biome: BIOME[e].name, color: BIOME[e].color, emotion: e, height: Number((w[e] / total).toFixed(2)) })
      }
      cells.push(row)
    }
    return { grid: n, dominant, weights: w, cells, legend: BIOME }
  }

  /** 情绪议会：最近 24h 前几名的票数 */
  council(now = Date.now()) {
    const w = this.weights(now, DAY)
    return Object.entries(w)
      .sort((a, b) => b[1] - a[1])
      .filter(([, v]) => v > 0)
      .map(([emotion, score]) => ({ emotion, score: Number(score.toFixed(2)), biome: BIOME[emotion].name }))
  }
}

/** 语言里的情绪线索（轻量启发式，避免每句都调模型） */
const EMOTION_WORDS = {
  joy: ['太好了', '不错', '开心', '喜欢', '赞', '顺利', '搞定', '哈哈', '棒'],
  sadness: ['可惜', '遗憾', '难过', '算了', '没戏', '失败', '延期'],
  anger: ['生气', '凭什么', '离谱', '不能接受', '烦', '投诉'],
  fear: ['担心', '风险', '怕', '不确定', '有问题', '隐患'],
  surprise: ['没想到', '居然', '突然', '意外'],
  calm: ['好的', '可以', '没问题', '按计划'],
}

export function detectEmotion(text) {
  const t = String(text || '')
  let best = { emotion: 'calm', intensity: 0.2, hits: 0 }
  for (const [emotion, words] of Object.entries(EMOTION_WORDS)) {
    let hits = 0
    for (const w of words) if (t.includes(w)) hits += 1
    if (hits > best.hits) best = { emotion, intensity: Math.min(1, 0.3 + hits * 0.2), hits }
  }
  return best
}

// ── 组合：分身的内在宇宙 ────────────────────────────────────────────────
export class LivingWorld {
  constructor(dir) {
    this.dir = dir
    this.memory = new LivingMemory(dir + '/memory-living.json')
    this.beliefs = new BeliefGarden(dir + '/beliefs.json')
    this.emotion = new EmotionWorld(dir + '/emotions.json')
  }

  /** 消化一句话：记忆 + 情绪 */
  absorb(text, { source = '', speaker = '' } = {}) {
    const clean = String(text || '').trim()
    if (!clean) return null
    const mem = this.memory.add(clean, { kind: 'talk', source, weight: 0.8 })
    const emo = detectEmotion(clean)
    this.emotion.feel(emo.emotion, emo.intensity, { source: speaker || source })
    return { mem, emotion: emo }
  }

  /** 一天的呼吸：衰减记忆、退化信念 */
  breathe() {
    const decay = this.memory.decay()
    const wither = this.beliefs.wither()
    this.beliefs.evolve()
    return { decay, wither }
  }

  /** 心像世界快照 */
  snapshot() {
    const terrain = this.emotion.terrain()
    const council = this.emotion.council()
    const buildings = this.beliefs.alive().map((b) => ({
      id: b.id,
      name: b.statement,
      stage: b.stage,
      height: Number(b.strength.toFixed(2)),
    }))
    return {
      memory: this.memory.stats(),
      beliefs: this.beliefs.summary(),
      council,
      terrain: { dominant: terrain.dominant, grid: terrain.grid },
      buildings,
      topMemories: this.memory.top(5).map((m) => ({ text: m.text, vitality: Number((m.vitality ?? 0).toFixed(2)), stage: m.stage })),
    }
  }
}
