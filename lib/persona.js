/**
 * lib/persona.js —— 四层人格文件（SOUL / IDENTITY / USER / STATE）
 *
 * 结构借鉴自 yuhui-sama/dsh-agentsoul：
 *  - 四个 markdown 文件，缺失只补种子、绝不覆盖
 *  - 改动即时生效（每次读取都从磁盘读，用 mtime 判断缓存）
 *  - 组合成一段可注入的 system prompt 片段
 */
import { createHash } from 'node:crypto'
import { renderProfile } from './persona-growth.js'
import { resolveUserCard, composeSoulPrompt, ensureSoulCard } from './soul-card.js'
import { readRules, renderRules } from './tripartite.js'
import { readCold } from './memory-layers.js'

export { ensureSoulCard, resolveUserCard, composeSoulPrompt } from './soul-card.js'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export const PERSONA_FILES = {
  soul: 'SOUL.md',
  identity: 'IDENTITY.md',
  user: 'USER.md',
  state: 'STATE.md',
}

const SEEDS = {
  soul: `# SOUL

## 第一原则

帮助对方把事办成。

优先级：正确 > 可靠 > 效率 > 表达。

## 判断原则

发现方案有问题时直接说，讲清依据并给替代方案；没有把握就说不确定。
不迎合、不编造、不堆砌形容词。

## 表达

说的是人话，短句优先；会议里一句话讲完一个意思。
`,
  identity: `# IDENTITY

名字：SoulMirror
角色：用户的数字分身
能力：参加会议、听懂对话、记录要点、执行任务、必要时替你发言
`,
  user: `# USER

（在这里记录用户长期信息：称呼、偏好、常用术语、说话风格。）
`,
  state: `# STATE

（当前正在推进的事：项目、进度、下一步。任务结束就清掉。）
`,
}

/** 结构化画像（比 markdown 层更适合机器读写；由 lib/persona-growth.js 维护） */
export const PROFILE_FILE = 'PROFILE.json'

/** 读画像；不存在返回 null */
export function loadProfile(dir) {
  try {
    const raw = readFileSync(join(dir, PROFILE_FILE), 'utf8').replace(/^\uFEFF/, '')
    const j = JSON.parse(raw)
    return j && j.sections ? j : null
  } catch {
    return null
  }
}

/** 写画像（原子感：先写再返回，失败抛错） */
export function saveProfile(dir, profile) {
  ensurePersona(dir)
  writeFileSync(join(dir, PROFILE_FILE), JSON.stringify(profile, null, 1), 'utf8')
  return profile
}

/**
 * 完整的人格块：markdown 四层（手写底色）+ 结构化画像（自动成长）。
 * 顺序：SOUL → IDENTITY → 画像（身份/口吻/立场/事实/状态）。
 */
export function fullPersonaBlock(dir, { maxChars = 6000 } = {}) {
  const parts = []
  // 灵魂卡：用户卡（她是谁）+ 认知架构（纪律）——两层分开，用户只填四个空
  try {
    ensureSoulCard(dir)
    const card = resolveUserCard({ dir })
    parts.push(composeSoulPrompt({ userCard: card.text }))
  } catch {
    try {
      const p = loadPersona(dir)
      if (p.soul) parts.push(p.soul)
      if (p.identity) parts.push(p.identity)
    } catch { /* ignore */ }
  }
  try {
    const profile = loadProfile(dir)
    if (profile) {
      const r = renderProfile(profile, { maxChars: Math.max(800, maxChars - 1200) })
      if (r) parts.push('# 关于她（自动积累，按此判断与口吻）\n' + r)
    }
  } catch { /* ignore */ }
  // 冷储：跨会议反复出现、已经稳定的结论 —— 越用越像就靠这一段
  try {
    const cold = readCold({ dir: join(dir, 'memory'), limit: 12 })
    if (cold.length) {
      parts.push('# 已经稳定的认识（跨多场会议沉淀）\n' +
        cold.map((x) => '- ' + x.text).join('\n'))
    }
  } catch { /* ignore */ }

  // 经验规则：只取最近的几个主题，短而稳，避免 token 膨胀
  try {
    const rules = readRules({ dir: join(dir, 'ontology'), maxTopics: 5, maxPerTopic: 3 })
    const block = renderRules(rules)
    if (block) parts.push(block)
  } catch { /* ignore */ }

  const text = parts.join('\n\n')
  return text.length > maxChars ? text.slice(0, maxChars) + '\n…（已截断）' : text
}

export function ensurePersona(dir) {
  mkdirSync(dir, { recursive: true })
  for (const [k, file] of Object.entries(PERSONA_FILES)) {
    const p = join(dir, file)
    if (!existsSync(p)) writeFileSync(p, SEEDS[k], 'utf8')
  }
  return dir
}

let cache = { at: 0, data: null }

export function loadPersona(dir, { cacheMs = 1500 } = {}) {
  ensurePersona(dir)
  const now = Date.now()
  let newest = 0
  for (const file of Object.values(PERSONA_FILES)) {
    try { newest = Math.max(newest, statSync(join(dir, file)).mtimeMs) } catch { /* ignore */ }
  }
  if (cache.data && cache.at >= newest && now - cache.at < cacheMs) return cache.data
  const data = { dir, at: now }
  for (const [k, file] of Object.entries(PERSONA_FILES)) {
    try { data[k] = readFileSync(join(dir, file), 'utf8').trim() } catch { data[k] = '' }
  }
  cache = { at: now, data }
  return data
}

export function readPersonaFile(dir, key) {
  const file = PERSONA_FILES[key]
  if (!file) throw new Error('未知人格文件：' + key)
  const p = join(dir, file)
  ensurePersona(dir)
  return existsSync(p) ? readFileSync(p, 'utf8') : ''
}

export function writePersonaFile(dir, key, text) {
  const file = PERSONA_FILES[key]
  if (!file) throw new Error('未知人格文件：' + key)
  ensurePersona(dir)
  writeFileSync(join(dir, file), String(text || ''), 'utf8')
  cache = { at: 0, data: null }
  return join(dir, file)
}

/** 组合成注入用的文本块（跳过空文件） */
export function personaBlock(persona, maxChars = 6000) {
  const parts = []
  if (persona.soul) parts.push(persona.soul)
  if (persona.identity) parts.push(persona.identity)
  if (persona.user) parts.push(persona.user)
  if (persona.state) parts.push(persona.state)
  const text = parts.join('\n\n')
  return text.length > maxChars ? text.slice(0, maxChars) + '\n…（已截断）' : text
}


/**
 * 追加一段"自动积累"，带日期、去重、限制总长。
 * 同一条内容不会重复写；超过 maxChars 时丢掉最旧的自动小节。
 */
export function appendPersonaSection(dir, key, items, opts = {}) {
  if (!items || !items.length) return { added: 0, skipped: 0 }
  const file = PERSONA_FILES[key]
  if (!file) throw new Error('未知人格文件：' + key)
  ensurePersona(dir)
  let body = ''
  try { body = readFileSync(join(dir, file), 'utf8') } catch { body = '' }
  const stamp = opts.stamp || new Date().toISOString().slice(0, 16).replace('T', ' ')
  const existing = new Set(body.split(/\r?\n/).map((l) => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean))
  const fresh = []
  let skipped = 0
  for (const raw of items) {
    const text = String(raw || '').trim()
    if (!text) continue
    if (existing.has(text)) { skipped += 1; continue }
    existing.add(text)
    fresh.push(text)
  }
  if (!fresh.length) return { added: 0, skipped }
  let next = body.trimEnd() + '\n\n## 自动积累 · ' + stamp + '\n' + fresh.map((x) => '- ' + x).join('\n') + '\n'
  const maxChars = opts.maxChars || 8000
  if (next.length > maxChars) {
    // 砍掉最旧的自动小节，保留手写部分
    const idx = next.indexOf('## 自动积累')
    if (idx > 0) {
      const head = next.slice(0, idx)
      const auto = next.slice(idx)
      const keep = auto.slice(Math.max(0, auto.length - (maxChars - head.length)))
      next = head + keep
    }
  }
  writeFileSync(join(dir, file), next, 'utf8')
  cache = { at: 0, data: null }
  return { added: fresh.length, skipped }
}

/**
 * 计算静态前缀的稳定 Prompt Cache 路由键（不含原文/凭据，仅截断 SHA-256）。
 */
export function computePromptCacheKey(staticPrefix, { model = '', stylePackId = '' } = {}) {
  const h = createHash('sha256')
    .update(String(model || ''))
    .update('\0')
    .update(String(stylePackId || ''))
    .update('\0')
    .update(String(staticPrefix || ''))
    .digest('hex')
    .slice(0, 16)
  return 'sm-pc-' + h
}

/**
 * 将人格与上下文严格拆分为「静态前缀（命中云端 Prompt Cache）」与「动态后缀（每次变化）」。
 *
 * 静态前缀（Static Prefix，极少变化，放最前面）：
 *   1. SOUL / IDENTITY（或灵魂卡）
 *   2. PROFILE.json 稳定四层（identity / style / stance / facts，不含 state）
 *   3. 跨会议冷记忆（稳定结论）
 *   4. 当前激活的风格包（Style Pack）与核心词典热词
 *
 * 动态后缀（Dynamic Suffix，放后面，不破坏前缀缓存）：
 *   1. STATE.md 与 PROFILE.json 的 state 层
 *   2. 近期经验规则（ontology）
 *   3. 当前情绪地形（emotionTerrain）
 *   4. 前台应用与光标上下文（frontApp / cursorContext）
 *   5. 知识库实时 FTS 召回片段（knowledgeSnippets）
 */
export function splitPersonaBlock(dir, opts = {}) {
  const {
    maxStaticChars = 4200,
    maxDynamicChars = 2200,
    stylePack = null,
    hotwords = [],
    emotionTerrain = '',
    frontApp = '',
    cursorContext = '',
    knowledgeSnippets = [],
    model = '',
  } = opts

  const staticParts = []
  const dynamicParts = []

  // ── 静态层 1：灵魂卡 / SOUL + IDENTITY ──
  try {
    ensureSoulCard(dir)
    const card = resolveUserCard({ dir })
    staticParts.push(composeSoulPrompt({ userCard: card.text }))
  } catch {
    try {
      const p = loadPersona(dir)
      if (p.soul) staticParts.push(p.soul)
      if (p.identity) staticParts.push(p.identity)
    } catch { /* ignore */ }
  }

  // ── 静态层 2：PROFILE.json 稳定四层（排除动态 state） ──
  let loadedProfile = null
  try {
    loadedProfile = loadProfile(dir)
    if (loadedProfile && loadedProfile.sections) {
      const stableProfile = {
        ...loadedProfile,
        sections: {
          identity: loadedProfile.sections.identity || [],
          style: loadedProfile.sections.style || [],
          stance: loadedProfile.sections.stance || [],
          facts: loadedProfile.sections.facts || [],
          state: [],
        },
      }
      const rendered = renderProfile(stableProfile, { maxChars: Math.max(800, maxStaticChars - 1600) })
      if (rendered) staticParts.push('# 关于用户（稳定画像，按此立场与口吻表达）\n' + rendered)
    }
  } catch { /* ignore */ }

  // ── 静态层 3：跨会议稳定冷记忆 ──
  try {
    const cold = readCold({ dir: join(dir, 'memory'), limit: 10 })
    if (cold.length) {
      staticParts.push('# 稳定沉淀（跨会议共识）\n' + cold.map((x) => '- ' + x.text).join('\n'))
    }
  } catch { /* ignore */ }

  // ── 静态层 4：激活的风格包（Style Pack） ──
  if (stylePack && stylePack.systemPrompt) {
    const packTitle = stylePack.name || stylePack.id || '自定义风格'
    staticParts.push(`# 当前场景风格包：${packTitle}\n${String(stylePack.systemPrompt).trim()}`)
  }

  // ── 静态层 5：核心词典热词 ──
  const cleanHotwords = (Array.isArray(hotwords) ? hotwords : [])
    .map((w) => String(w || '').trim())
    .filter(Boolean)
    .slice(0, 40)
  if (cleanHotwords.length) {
    staticParts.push('# 专有名词词典（识别与润色时优先保留正确拼写）\n' + cleanHotwords.join('、'))
  }

  // ── 动态层 1：STATE.md 与 PROFILE.state ──
  try {
    const p = loadPersona(dir)
    const stateText = String(p.state || '').trim()
    if (stateText && !stateText.includes('任务结束就清掉')) {
      dynamicParts.push('# 当前进展（STATE）\n' + stateText.slice(0, 600))
    }
  } catch { /* ignore */ }

  try {
    if (loadedProfile?.sections?.state?.length) {
      const stateOnly = {
        ...loadedProfile,
        sections: { identity: [], style: [], stance: [], facts: [], state: loadedProfile.sections.state },
      }
      const r = renderProfile(stateOnly, { maxChars: 600 })
      if (r) dynamicParts.push('# 近期动态状态\n' + r)
    }
  } catch { /* ignore */ }

  // ── 动态层 2：近期经验规则 ──
  try {
    const rules = readRules({ dir: join(dir, 'ontology'), maxTopics: 4, maxPerTopic: 3 })
    const block = renderRules(rules)
    if (block) dynamicParts.push(block)
  } catch { /* ignore */ }

  // ── 动态层 3：情绪地形（决定表达分寸） ──
  if (emotionTerrain && String(emotionTerrain).trim()) {
    dynamicParts.push('# 当前气氛与情绪地形\n' + String(emotionTerrain).trim())
  }

  // ── 动态层 4：前台应用与光标上下文 ──
  if (frontApp && String(frontApp).trim()) {
    dynamicParts.push('# 当前前台应用\n' + String(frontApp).trim())
  }
  if (cursorContext && String(cursorContext).trim()) {
    dynamicParts.push('# 光标附近上下文（仅用于消歧与连贯，勿原样照抄）\n' + String(cursorContext).trim().slice(0, 500))
  }

  // ── 动态层 5：知识库实时召回片段 ──
  const snippets = (Array.isArray(knowledgeSnippets) ? knowledgeSnippets : [])
    .map((s) => {
      if (typeof s === 'string') return s.trim()
      if (!s || typeof s !== 'object') return ''
      const title = String(s.title || s.relPath || '知识片段').trim()
      const body = String(s.snippet || s.body || '').trim()
      return body ? `- [${title}] ${body}` : ''
    })
    .filter(Boolean)
  if (snippets.length) {
    dynamicParts.push('# 知识库实时召回参考\n' + snippets.join('\n'))
  }

  const rawStatic = staticParts.join('\n\n')
  const staticPrefix = rawStatic.length > maxStaticChars
    ? rawStatic.slice(0, maxStaticChars) + '\n…（已截断）'
    : rawStatic

  const rawDynamic = dynamicParts.join('\n\n')
  const dynamicSuffix = rawDynamic.length > maxDynamicChars
    ? rawDynamic.slice(0, maxDynamicChars) + '\n…（已截断）'
    : rawDynamic

  const cacheKey = computePromptCacheKey(staticPrefix, {
    model,
    stylePackId: stylePack?.id || '',
  })

  return {
    staticPrefix,
    dynamicSuffix,
    cacheKey,
    staticChars: staticPrefix.length,
    dynamicChars: dynamicSuffix.length,
  }
}

/**
 * 按 Prompt Cache 最佳实践拼装消息数组：
 * 静态前缀放 system（稳定命中 KV Cache），动态后缀与本次输入放 user 尾部。
 */
export function composeCachedMessages({ staticPrefix = '', dynamicSuffix = '', userText = '' } = {}) {
  const messages = []
  if (staticPrefix.trim()) {
    messages.push({ role: 'system', content: staticPrefix.trim() })
  }
  const userParts = []
  if (dynamicSuffix.trim()) userParts.push(dynamicSuffix.trim())
  if (String(userText || '').trim()) userParts.push(String(userText).trim())
  messages.push({ role: 'user', content: userParts.join('\n\n') })
  return messages
}
