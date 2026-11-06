/**
 * 四层记忆：暖态 / 冷储 / 归档 / 流水。
 *
 * 布局借鉴 syyr1987/dsh-linghun（AGPL-3.0），按会议场景裁剪：
 *
 *   memory/
 *   ├── warm.md           暖态：最近几场会捞到的候选（会被遗忘）
 *   ├── cold.md           冷储：反复出现、已经稳定的结论（注入优先）
 *   ├── episodic/         归档：从暖态过期移出的按日存档
 *   └── journal/          流水：每场会原始记录（不筛选、只追加）
 *
 * 为什么要四层，而不是一个文件：
 *   一层 = 所有东西同等信用。三个月前的随口一句和反复强调的红线同权，
 *   模型只能一起信。四层把"信用等级"显式化：
 *     流水（原始） → 暖态（候选） → 冷储（稳定） → 人格（画像）
 *
 * "越用越像"靠的就是这条晋升链：
 *   同一件事在**不同会议**里反复出现 → seen 增加 → 晋升到冷储
 *   → 到达阈值后写进人格画像 → 下次开口就带上了
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

export const LAYOUT = {
  warm: 'warm.md',
  cold: 'cold.md',
  episodic: 'episodic',
  journal: 'journal',
}

/** 暖态默认保留 14 天：比它旧的移进归档 */
export const WARM_TTL_MS = 14 * 24 * 60 * 60 * 1000
/** 晋升到冷储：至少在不同会议里出现 2 次，且置信度够 */
export const PROMOTE_MIN_SEEN = 2
export const PROMOTE_MIN_CONF = 0.6
/** 冷储最多保留多少条（注入时还会再截断） */
export const COLD_MAX = 60

function ensure(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
  try { mkdirSync(join(dir, LAYOUT.episodic), { recursive: true }) } catch { /* ignore */ }
  try { mkdirSync(join(dir, LAYOUT.journal), { recursive: true }) } catch { /* ignore */ }
}

function readOr(file, fallback = '') {
  try { return readFileSync(file, 'utf8').replace(/^\uFEFF/, '') } catch { return fallback }
}

function dayKey(at) {
  return new Date(at).toISOString().slice(0, 10)
}

/** 归一化：用于判重（与 persona-growth 的口径一致） */
export function normalizeMemoryText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：！？,.;:!?"'“”‘’()（）\[\]【】-]/g, '')
    .slice(0, 80)
}

/** 条目序列化：人可读 + 机器可读（meta 放注释里） */
function serialize(item) {
  const meta = [
    'kind=' + (item.kind || 'fact'),
    'conf=' + Number(item.confidence || 0.5).toFixed(2),
    'seen=' + (item.seen || 1),
    'last=' + (item.lastAt || new Date().toISOString()),
  ].join(' ')
  return '- ' + String(item.text || '').trim() + ' <!-- ' + meta + ' -->'
}

/** 解析一层 markdown 里的条目 */
export function parseEntries(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    const m = /^[-*]\s+(.+?)(?:\s*<!--\s*(.*?)\s*-->)?\s*$/.exec(line.trim())
    if (!m) continue
    const meta = m[2] || ''
    const kv = {}
    for (const part of meta.split(/\s+/)) {
      const [k, v] = part.split('=')
      if (k && v) kv[k] = v
    }
    out.push({
      text: m[1].trim(),
      kind: kv.kind || 'fact',
      confidence: Number(kv.conf) || 0.5,
      seen: Number(kv.seen) || 1,
      lastAt: kv.last || '',
      key: normalizeMemoryText(m[1]),
    })
  }
  return out
}

/**
 * 写一条暖态记忆。
 * 同一件事再次出现时：seen+1、置信度上抬、刷新时间——**这就是"越用越像"的计数**。
 *
 * @param {{dir: string, text: string, kind?: string, confidence?: number, at?: number, source?: string}} o
 * @returns {{added: boolean, reinforced: boolean, seen: number}}
 */
export function appendWarm({ dir, text = '', kind = 'fact', confidence = 0.5, at = Date.now(), source = '' }) {
  ensure(dir)
  const clean = String(text || '').trim()
  if (!clean) return { added: false, reinforced: false, seen: 0 }
  const file = join(dir, LAYOUT.warm)
  const items = parseEntries(readOr(file))
  const key = normalizeMemoryText(clean)
  const iso = new Date(at).toISOString()

  const hit = items.find((x) => x.key === key)
  if (hit) {
    hit.seen += 1
    hit.confidence = Math.min(1, hit.confidence + 0.1)
    hit.lastAt = iso
    if (clean.length > hit.text.length) hit.text = clean
    writeFileSync(file, items.map(serialize).join('\n') + '\n', 'utf8')
    return { added: false, reinforced: true, seen: hit.seen }
  }

  items.push({ text: clean, kind, confidence, seen: 1, lastAt: iso })
  writeFileSync(file, items.map(serialize).join('\n') + '\n', 'utf8')
  return { added: true, reinforced: false, seen: 1 }
}

/** 读暖态（按 seen × 新近度排序，最近的在前） */
export function readWarm({ dir, limit = 40 } = {}) {
  const items = parseEntries(readOr(join(dir, LAYOUT.warm)))
  const now = Date.now()
  const score = (x) => {
    const ageDays = x.lastAt ? (now - Date.parse(x.lastAt)) / 86400000 : 999
    return x.confidence * (1 + Math.log1p(x.seen)) / (1 + Math.max(0, ageDays) / 30)
  }
  return items.sort((a, b) => score(b) - score(a)).slice(0, limit)
}

/** 读冷储（注入用） */
export function readCold({ dir, limit = 20 } = {}) {
  return parseEntries(readOr(join(dir, LAYOUT.cold))).slice(0, limit)
}

/** 追加流水：一场会的原始记录（不筛选、只追加） */
export function appendJournal({ dir, lines = [], at = Date.now(), title = '' } = {}) {
  ensure(dir)
  const arr = (Array.isArray(lines) ? lines : [lines]).map((x) => String(x || '').trim()).filter(Boolean)
  if (!arr.length) return { added: 0, file: '' }
  const day = dayKey(at)
  const file = join(dir, LAYOUT.journal, day + '.md')
  const body = readOr(file)
  const prefix = body ? '' : '# ' + day + '\n'
  const head = title ? '## ' + new Date(at).toISOString().slice(11, 19) + ' ' + title + '\n' : ''
  appendFileSync(file, prefix + head + arr.map((x) => '- ' + x).join('\n') + '\n', 'utf8')
  return { added: arr.length, file }
}

/**
 * 读流水，支持秒级范围（借鉴 linghun v0.4.2 的 journal_read 修复：
 * 单日流水可能很大，必须能按时间段取，否则被上下文窗口截断）。
 */
export function readJournal({ dir, day, start = '', end = '', limit = 200 } = {}) {
  const d = day || dayKey(Date.now())
  const body = readOr(join(dir, LAYOUT.journal, d + '.md'))
  if (!body.trim()) return []
  const out = []
  let clock = ''
  for (const line of body.split('\n')) {
    const h = /^##\s+(\d{2}:\d{2}:\d{2})/.exec(line.trim())
    if (h) { clock = h[1]; continue }
    const li = /^[-*]\s+(.+)$/.exec(line.trim())
    if (!li) continue
    if (start && clock && clock < start) continue
    if (end && clock && clock > end) continue
    out.push({ clock, text: li[1].trim() })
  }
  return out.slice(-limit)
}

/**
 * 整理：暖态 → （过期的）归档 / （够稳的）冷储。
 *
 * 这是"越用越像"的关键一步：
 *   只有**跨会议**反复出现（seen ≥ 2）且置信度够的，才配进冷储；
 *   冷储会被注入人格块，于是下一次开口就带上了。
 *
 * @returns {{archived: number, promoted: object[], kept: number}}
 */
export function consolidate({
  dir,
  now = Date.now(),
  warmTtlMs = WARM_TTL_MS,
  minSeen = PROMOTE_MIN_SEEN,
  minConf = PROMOTE_MIN_CONF,
} = {}) {
  ensure(dir)
  const items = parseEntries(readOr(join(dir, LAYOUT.warm)))
  if (!items.length) return { archived: 0, promoted: [], kept: 0 }

  const keep = []
  const promote = []
  const archive = []
  for (const it of items) {
    const age = now - (Date.parse(it.lastAt) || 0)
    const stable = it.seen >= minSeen && it.confidence >= minConf
    if (stable) { promote.push(it); keep.push(it); continue }
    if (age > warmTtlMs) { archive.push(it); continue }
    keep.push(it)
  }

  // 过期 → 归档（按它最后出现那天）
  for (const it of archive) {
    const day = dayKey(Date.parse(it.lastAt) || now)
    const file = join(dir, LAYOUT.episodic, day + '.md')
    const body = readOr(file)
    appendFileSync(file, (body ? '' : '# ' + day + '\n') + serialize(it) + '\n', 'utf8')
  }

  // 晋升 → 冷储（去重；超出上限时保留 seen 最多的）
  if (promote.length) {
    const cold = parseEntries(readOr(join(dir, LAYOUT.cold)))
    for (const it of promote) {
      const hit = cold.find((x) => x.key === it.key)
      if (hit) {
        hit.seen = Math.max(hit.seen, it.seen)
        hit.confidence = Math.max(hit.confidence, it.confidence)
        hit.lastAt = it.lastAt
        if (it.text.length > hit.text.length) hit.text = it.text
      } else {
        cold.push(it)
      }
    }
    cold.sort((a, b) => b.seen * b.confidence - a.seen * a.confidence)
    writeFileSync(join(dir, LAYOUT.cold), cold.slice(0, COLD_MAX).map(serialize).join('\n') + '\n', 'utf8')
  }

  writeFileSync(join(dir, LAYOUT.warm), keep.map(serialize).join('\n') + (keep.length ? '\n' : ''), 'utf8')
  return { archived: archive.length, promoted: promote.map((x) => x.text), kept: keep.length }
}

/**
 * 收敛度：0~1，用来回答"它现在有多像我"。
 *
 * 两个来源：
 *   覆盖度 —— 画像五层里有几层已经有内容
 *   沉淀量 —— 冷储里有多少条稳定结论
 *
 * 刻意不给"上限 1"的宣传口径：0.9 以上才是"相当像"。
 */
export function convergence({ profile, dir = '' } = {}) {
  const sections = (profile && profile.sections) || {}
  const names = ['identity', 'style', 'stance', 'facts', 'state']
  const covered = names.filter((n) => Array.isArray(sections[n]) && sections[n].length > 0).length
  const stability = names.reduce((acc, n) => {
    const list = sections[n] || []
    // 只算"稳定"的：seen ≥ 2 或置信度 ≥ 0.75
    return acc + list.filter((x) => (x.seen || 1) >= 2 || (x.confidence || 0) >= 0.75).length
  }, 0)
  const coldCount = dir ? parseEntries(readOr(join(dir, LAYOUT.cold))).length : 0

  const coverage = covered / names.length
  const depth = Math.min(1, (stability + coldCount) / 24)
  const score = Math.round((0.55 * coverage + 0.45 * depth) * 100) / 100

  const label =
    score >= 0.85 ? '相当熟悉' :
    score >= 0.6 ? '渐渐熟悉' :
    score >= 0.3 ? '略有印象' :
    score > 0 ? '初次接触' : '还不认识'

  return { score, label, coverage, stability, coldCount }
}

/** 层状态（诊断 / 面板展示） */
export function layersStatus(dir) {
  const countDirs = (sub) => {
    try { return readdirSync(join(dir, sub)).filter((f) => f.endsWith('.md')).length } catch { return 0 }
  }
  return {
    warm: parseEntries(readOr(join(dir, LAYOUT.warm))).length,
    cold: parseEntries(readOr(join(dir, LAYOUT.cold))).length,
    episodicDays: countDirs(LAYOUT.episodic),
    journalDays: countDirs(LAYOUT.journal),
    paths: {
      warm: join(dir, LAYOUT.warm),
      cold: join(dir, LAYOUT.cold),
      episodic: join(dir, LAYOUT.episodic),
      journal: join(dir, LAYOUT.journal),
    },
    exists: existsSync(join(dir, LAYOUT.warm)) || existsSync(join(dir, LAYOUT.cold)),
  }
}
