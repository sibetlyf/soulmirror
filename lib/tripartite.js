/**
 * 三分法：会议里捞到的东西，不该都塞进同一个袋子。
 *
 * 借鉴 syyr1987/dsh-linghun 的"三分法"（AGPL-3.0）：
 *   技术知识  → 知识本体（knowledge.md）   — 与具体项目无关的通用知识
 *   项目场景  → 记忆（memory）             — 这场会/这个项目的事，会过期
 *   总结经验  → 规则本体（rules.md）       — "以后遇到这种情况就这么做"
 *
 * 为什么必须分开（这是 linghun 的核心洞见）：
 *   三类的**寿命与用途完全不同**。
 *   · 知识可以长期复用，越多越好
 *   · 项目记忆会过期，过期了继续注入就是污染
 *   · 规则是行为纪律，必须少而稳，混进一堆琐事就不叫规则了
 *
 * 混在一起的后果：三个月前的项目进展被当成"当前状态"，
 * 一条随口说的偏好被当成"规则"，模型只能一起信。
 *
 * 本模块只做分类与文件读写（纯逻辑 + 简单 IO），不调模型。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const KIND = { knowledge: 'knowledge', memory: 'memory', rule: 'rule' }

const KNOWLEDGE_FILE = 'knowledge.md'
const RULES_FILE = 'rules.md'
const MEMORY_DIR = 'memory'

/** 规则类信号：总结经验、纪律、红线、教训 */
const RULE_HINT = /以后|下次|别再|不能再|必须|不允许|绝不|红线|教训|原则|教训是|经验是|规矩|纪律|always|never/i

/** 知识类信号：原理、方法、术语解释、工具用法 */
const KNOW_HINT = /原理|机制|实现方式|API|字段|接口|术语|定义|方法|工具用法|配置项|文档|协议|架构|框架/i

/** 记忆类信号：进展、排期、人、待办 */
const MEM_HINT = /进展|排期|deadline|本周|下周|这个月|今天|昨天|明天|负责|待办|跟进|上线|延期|会议|项目/i

/**
 * 判断一条信息属于哪一类。
 *
 * 顺序有意义：先看"是不是经验纪律"（最容易被误判成普通事实），
 * 再看"是不是通用知识"，剩下的归为项目记忆。
 *
 * @param {{text?: string, section?: string}} o
 * @returns {'knowledge'|'memory'|'rule'}
 */
export function classifyKind({ text = '', section = '' } = {}) {
  const s = String(text || '')
  // 立场/红线本质上就是规则
  if (section === 'stance') return KIND.rule
  // 状态天然是记忆
  if (section === 'state') return KIND.memory
  if (RULE_HINT.test(s)) return KIND.rule
  if (KNOW_HINT.test(s)) return KIND.knowledge
  if (MEM_HINT.test(s)) return KIND.memory
  // 其余按"知识"处理：中性事实更适合长期保留
  return KIND.knowledge
}

function ensureDir(dir) {
  try { mkdirSync(dir, { recursive: true }) } catch { /* ignore */ }
}

function ensureMemoryDir(dir) {
  ensureDir(join(dir, MEMORY_DIR))
}

function readOr(file, fallback = '') {
  try { return readFileSync(file, 'utf8') } catch { return fallback }
}

function dedupeAppend(file, line) {
  const body = readOr(file)
  const norm = (x) => x.replace(/^[-*]\s*/, '').trim()
  const exists = body.split('\n').map(norm).filter(Boolean).includes(norm(line))
  if (exists) return { added: false }
  const prefix = body.endsWith('\n') || !body ? '' : '\n'
  appendFileSync(file, prefix + line.replace(/\s+$/, '') + '\n', 'utf8')
  return { added: true }
}

/**
 * 写一条知识本体。按主题聚合，同主题不同条目追加在下面。
 * @param {{dir: string, topic?: string, text: string}} o
 */
export function writeKnowledge({ dir, topic = '通用', text = '' }) {
  ensureDir(dir)
  const clean = String(text || '').trim()
  if (!clean) return { added: false, file: join(dir, KNOWLEDGE_FILE) }
  const file = join(dir, KNOWLEDGE_FILE)
  const body = readOr(file)
  const head = '## ' + String(topic || '通用').trim()
  if (!body.includes(head)) {
    const prefix = body && !body.endsWith('\n') ? '\n' : ''
    appendFileSync(file, prefix + (body ? '\n' : '') + head + '\n', 'utf8')
  }
  return { ...dedupeAppend(file, '- ' + clean), file }
}

/**
 * 写一条规则本体。同主题聚合；规则要少而稳，所以有配额，超了就丢最旧的。
 * @param {{dir: string, topic?: string, text: string, maxPerTopic?: number}} o
 */
export function writeRule({ dir, topic = '一般', text = '', maxPerTopic = 8 }) {
  ensureDir(dir)
  const clean = String(text || '').trim()
  if (!clean) return { added: false, file: join(dir, RULES_FILE) }
  const file = join(dir, RULES_FILE)
  const body = readOr(file)
  const head = '## ' + String(topic || '一般').trim()

  const lines = body.split('\n')
  const at = lines.findIndex((l) => l.trim() === head)
  if (at < 0) {
    const prefix = body && !body.endsWith('\n') ? '\n' : ''
    const next = body + prefix + (body ? '\n' : '') + head + '\n- ' + clean + '\n'
    writeFileSync(file, next, 'utf8')
    return { added: true, file }
  }

  // 同主题段落：收集现有条目，去重后裁剪到配额
  let end = lines.length
  for (let i = at + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) { end = i; break }
  }
  const items = lines.slice(at + 1, end)
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean)
  if (items.includes(clean)) return { added: false, file }
  items.push(clean)
  const kept = items.slice(-maxPerTopic)
  const rebuilt = [
    ...lines.slice(0, at + 1),
    ...kept.map((x) => '- ' + x),
    ...lines.slice(end),
  ].join('\n')
  writeFileSync(file, rebuilt, 'utf8')
  return { added: true, file }
}

/**
 * 写一条项目记忆（按日期分文件，天然带时间边界）。
 * @param {{dir: string, text: string, at?: number}} o
 */
export function writeMemory({ dir, text = '', at = Date.now() }) {
  ensureMemoryDir(dir)
  const clean = String(text || '').trim()
  if (!clean) return { added: false }
  const day = new Date(at).toISOString().slice(0, 10)
  const file = join(dir, MEMORY_DIR, day + '.md')
  return { ...dedupeAppend(file, '- ' + clean), file }
}

/** 把一条提取结果按三分法落到对应文件 */
export function routeItem({ dir, item = {}, at = Date.now() }) {
  const text = String(item.value || item.text || '').trim()
  if (!text) return { kind: '', added: false }
  const kind = item.kind && KIND[item.kind] ? item.kind : classifyKind({ text, section: item.section })
  const topic = String(item.topic || item.key || '').trim() || '通用'
  if (kind === KIND.rule) return { kind, ...writeRule({ dir, topic, text }) }
  if (kind === KIND.knowledge) return { kind, ...writeKnowledge({ dir, topic, text }) }
  return { kind, ...writeMemory({ dir, text, at }) }
}

/**
 * 读回规则主题（注入用）。只取每主题最后几条，控制 token。
 * @param {{dir: string, maxTopics?: number, maxPerTopic?: number}} o
 */
export function readRules({ dir, maxTopics = 6, maxPerTopic = 4 } = {}) {
  const body = readOr(join(dir, RULES_FILE))
  if (!body.trim()) return []
  const out = []
  let cur = null
  for (const line of body.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line.trim())
    if (h) { cur = { topic: h[1].trim(), items: [] }; out.push(cur); continue }
    const li = /^[-*]\s+(.+)$/.exec(line.trim())
    if (li && cur) cur.items.push(li[1].trim())
  }
  return out
    .filter((x) => x.items.length)
    .slice(-maxTopics)
    .map((x) => ({ topic: x.topic, items: x.items.slice(-maxPerTopic) }))
}

/** 渲染规则块（给模型看）。没有规则时返回空串。 */
export function renderRules(rules = []) {
  if (!rules.length) return ''
  const lines = ['# 经验规则（以后遇到同类情况就这么做）']
  for (const r of rules) {
    lines.push('### ' + r.topic)
    for (const it of r.items) lines.push('- ' + it)
  }
  return lines.join('\n')
}

/** 别名命中：问题里出现某主题名/条目关键词，就算命中（比 BM25 简单，够会议用） */
export function hitRules(text, rules = []) {
  const s = String(text || '')
  if (!s.trim()) return []
  // 主题整串命中，或主题的任意二字片段出现在问题里（"延期处理" ↔ "这个延期怎么处理"）
  const bigrams = (t) => {
    const out = []
    for (let i = 0; i < t.length - 1; i++) out.push(t.slice(i, i + 2))
    return out
  }
  return rules.filter((r) => {
    const topic = String(r.topic || '')
    if (topic.length >= 2) {
      if (s.includes(topic)) return true
      if (bigrams(topic).some((g) => s.includes(g))) return true
    }
    return r.items.some((it) => it.length >= 4 && s.includes(it.slice(0, 6)))
  })
}

/** 目录里有哪些本体文件（诊断用） */
export function ontologyStatus(dir) {
  const k = join(dir, KNOWLEDGE_FILE)
  const r = join(dir, RULES_FILE)
  const mdir = join(dir, MEMORY_DIR)
  let memFiles = 0
  try {
    memFiles = existsSync(mdir) ? readdirSync(mdir).length : 0
  } catch { memFiles = 0 }
  return {
    knowledge: existsSync(k),
    rules: existsSync(r),
    memoryFiles: memFiles,
  }
}
