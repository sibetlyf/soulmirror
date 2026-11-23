/**
 * 人格底色 × 风格包（Style Packs）+ 前台应用/情绪地形自动路由 + 知识库实时召回与一键沉淀。
 *
 * 设计原则（融合 OpenLess 与 SoulMirror）：
 *   1. 底层人格（SOUL/IDENTITY/USER/PROFILE）决定"你是谁、你的立场与禁用套话"
 *   2. 表层风格包（Style Pack）决定"此刻在什么场景怎么说"
 *   3. 自动路由按 前台应用 + 情绪地形 选择默认风格包，也允许用户显式切换
 *   4. 所有实时交互（语音润色、划词 QA、替我草拟）均走 Prompt Cache 分层 + fast 档位流式输出
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { splitPersonaBlock, composeCachedMessages } from './persona.js'
import { recallForContext, depositToKnowledge } from './knowledge.js'

/** 内置 5 套高频场景风格包 */
export const BUILTIN_STYLE_PACKS = Object.freeze([
  {
    id: 'ai-prompt',
    name: 'AI 提示词模式',
    description: '把口述或零散需求重塑为结构清晰、约束完整、可直接发给 AI 的高质量提示词。',
    builtin: true,
    matchApps: ['cursor', 'code', 'vscode', 'windsurf', 'trae', 'idea', 'pycharm', 'terminal', 'iterm', 'warp', 'chatgpt', 'claude', 'gemini'],
    systemPrompt: [
      '将用户输入整理为结构清晰的 AI 提示词：补全目标、上下文、约束条件与期望输出格式。',
      '只整理文本，不要替用户回答问题或执行任务；不要添加“以下是整理后的内容”之类开场白。',
    ].join('\n'),
  },
  {
    id: 'chat-brief',
    name: '群聊极简模式',
    description: '适合微信/飞书/企微/Slack，短句直给、去掉客套与官腔。',
    builtin: true,
    matchApps: ['wechat', 'weixin', 'wxwork', 'feishu', 'lark', 'dingtalk', 'slack', 'discord', 'telegram', 'qq'],
    systemPrompt: [
      '用自然简短的口语书面化表达，去除冗余客套和“好的没问题非常感谢”等套话。',
      '短句优先，重点靠前，直接输出可发送的正文。',
    ].join('\n'),
  },
  {
    id: 'diplomatic-reply',
    name: '高情商委婉模式',
    description: '对外沟通或争执降温场景：语气礼貌缓冲，但坚定守住用户核心立场与边界。',
    builtin: true,
    matchApps: [],
    systemPrompt: [
      '保持礼貌、冷静与建设性语气，先肯定共识再提出调整或拒绝，避免生硬冲突。',
      '必须守住用户的核心立场与底线，不无原则妥协；直接输出可发送的正文。',
    ].join('\n'),
  },
  {
    id: 'formal-doc',
    name: '正式邮件 / 文档模式',
    description: '适合邮件、需求文档、方案汇报：条理分明、用词专业准确。',
    builtin: true,
    matchApps: ['outlook', 'mail', 'thunderbird', 'foxmail', 'notion', 'word', 'wps', 'docs', 'confluence', 'obsidian'],
    systemPrompt: [
      '输出条理清晰、结构分明的正式书面文本，必要时使用编号要点列出关键信息与下一步。',
      '保持简洁专业，不堆砌空洞形容词；直接输出正文。',
    ].join('\n'),
  },
  {
    id: 'meeting-bullet',
    name: '会议即兴发言模式',
    description: '适合会议中快速回应或插话：一句话亮明观点，再给 1-2 个依据。',
    builtin: true,
    matchApps: ['wemeet', '腾讯会议', 'zoom', 'teams', 'meeting', 'voov'],
    systemPrompt: [
      '适合口头朗读或会议聊天框发送：先用一句话给结论，再用最多两条短句补依据。',
      '不要长篇大论，不要 Markdown 复杂排版。',
    ].join('\n'),
  },
])

const STYLE_PACKS_FILE = 'style-packs.json'

/** 加载全部风格包（内置 + 自定义持久化，同 id 时自定义可补充规则） */
export function loadStylePacks(dataDir) {
  const custom = readCustomStylePacks(dataDir)
  const map = new Map()
  for (const p of BUILTIN_STYLE_PACKS) map.set(p.id, { ...p })
  for (const c of custom) {
    if (!c || !c.id) continue
    const base = map.get(c.id)
    if (base) {
      map.set(c.id, {
        ...base,
        ...c,
        builtin: base.builtin,
        systemPrompt: c.systemPrompt || base.systemPrompt,
      })
    } else {
      map.set(c.id, { ...c, builtin: false })
    }
  }
  return [...map.values()]
}

function readCustomStylePacks(dataDir) {
  if (!dataDir) return []
  const file = join(dataDir, STYLE_PACKS_FILE)
  if (!existsSync(file)) return []
  try {
    const j = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return Array.isArray(j?.packs) ? j.packs : (Array.isArray(j) ? j : [])
  } catch {
    return []
  }
}

/** 保存或更新自定义风格包（也支持给内置风格包追加微调规则） */
export function saveStylePack(dataDir, pack) {
  if (!dataDir) throw new Error('缺少 dataDir')
  const id = String(pack?.id || '').trim()
  if (!id) throw new Error('风格包 id 不能为空')
  mkdirSync(dataDir, { recursive: true })
  const list = readCustomStylePacks(dataDir)
  const nextItem = {
    id,
    name: String(pack.name || id).trim(),
    description: String(pack.description || '').trim(),
    matchApps: Array.isArray(pack.matchApps) ? pack.matchApps.map((x) => String(x).toLowerCase()) : [],
    systemPrompt: String(pack.systemPrompt || '').trim(),
    updatedAt: new Date().toISOString(),
  }
  const idx = list.findIndex((x) => x && x.id === id)
  if (idx >= 0) list[idx] = { ...list[idx], ...nextItem }
  else list.push(nextItem)
  writeFileSync(join(dataDir, STYLE_PACKS_FILE), JSON.stringify({ version: 1, packs: list }, null, 2), 'utf8')
  return nextItem
}

/** 向指定风格包追加一条演化规则（不重复追加） */
export function appendStylePackRule(dataDir, packId, ruleText) {
  const rule = String(ruleText || '').trim()
  if (!rule) return null
  const all = loadStylePacks(dataDir)
  const target = all.find((p) => p.id === packId) || all[0]
  if (!target) return null
  if (target.systemPrompt.includes(rule)) return target
  const nextPrompt = target.systemPrompt.trimEnd() + '\n- ' + rule
  return saveStylePack(dataDir, { ...target, systemPrompt: nextPrompt })
}

/**
 * 前台应用 + 情绪地形自动路由。
 * 优先级：用户显式指定 > 情绪地形特殊保护（会议争执/火山 → 高情商委婉） > 前台应用匹配 > 默认群聊极简。
 */
export function routeStylePack({
  frontApp = '',
  emotionTerrain = '',
  explicitPackId = '',
  packs = BUILTIN_STYLE_PACKS,
} = {}) {
  const list = Array.isArray(packs) && packs.length ? packs : BUILTIN_STYLE_PACKS
  const byId = (id) => list.find((p) => p.id === id) || null

  if (explicitPackId) {
    const hit = byId(explicitPackId)
    if (hit) return { pack: hit, reason: 'explicit' }
  }

  const app = String(frontApp || '').toLowerCase()
  const terrain = String(emotionTerrain || '').toLowerCase()
  const isConflictTerrain = /volcano|火山|anger|争执/.test(terrain)

  // 会议或聊天中检测到火山/争执地形，自动切高情商委婉降温
  if (isConflictTerrain && (!app || /wemeet|腾讯会议|zoom|teams|wechat|feishu|lark|slack|mail|outlook/.test(app))) {
    const diplomatic = byId('diplomatic-reply')
    if (diplomatic) return { pack: diplomatic, reason: 'emotion-terrain:volcano' }
  }

  if (app) {
    for (const pack of list) {
      const patterns = Array.isArray(pack.matchApps) ? pack.matchApps : []
      if (patterns.some((kw) => kw && app.includes(String(kw).toLowerCase()))) {
        return { pack, reason: 'front-app:' + app }
      }
    }
  }

  return { pack: byId('chat-brief') || list[0], reason: 'default' }
}

/**
 * 统一的「人格底色 × 风格包 × 知识库实时召回」极速执行器。
 * 支持四种高频动作：polish（语音润色）、qa（划词知识库提问）、reply（按我口吻草拟回复）、critique（按我的信念挑刺）。
 */
export async function runStyledAssistant({
  personaDir,
  dataDir,
  text = '',
  selectedText = '',
  action = 'polish',
  frontApp = '',
  emotionTerrain = '',
  cursorContext = '',
  explicitPackId = '',
  hotwords = [],
  knowledge = {},
  completer,
  onDelta,
  mode = 'fast',
  model = '',
  signal,
} = {}) {
  if (typeof completer !== 'function') throw new Error('缺少 completer')
  const started = Date.now()
  const packs = loadStylePacks(dataDir || personaDir)
  const routed = routeStylePack({
    frontApp,
    emotionTerrain,
    explicitPackId,
    packs,
  })

  // 1. 毫秒级直连知识库 FTS 召回（如果配置了 port/origin 且未显式禁用）
  let recalled = { ok: false, snippets: [], hotwords: [], items: [], ms: 0 }
  if (knowledge && knowledge.enabled !== false && (knowledge.port || knowledge.origin)) {
    const queryForKb = [selectedText, text].filter(Boolean).join(' ').trim()
    recalled = await recallForContext({
      query: queryForKb,
      cursorContext,
      port: knowledge.port,
      origin: knowledge.origin,
      projectId: knowledge.projectId,
      knowledgeBaseIds: knowledge.knowledgeBaseIds || [],
      limit: knowledge.limit || 5,
      timeoutMs: knowledge.timeoutMs || 1800,
      fetchImpl: knowledge.fetchImpl,
    })
  }

  // 2. 合并手动词典热词 + 知识库召回术语
  const mergedHotwords = [...new Set([...(hotwords || []), ...(recalled.hotwords || [])])]

  // 3. 动静分离拼装 Prompt（静态前缀稳定命中 Prompt Cache）
  const split = splitPersonaBlock(personaDir, {
    stylePack: routed.pack,
    hotwords: mergedHotwords,
    emotionTerrain,
    frontApp,
    cursorContext,
    knowledgeSnippets: recalled.snippets,
    model,
  })

  const userTask = buildActionUserPrompt({ action, text, selectedText })
  const messages = composeCachedMessages({
    staticPrefix: split.staticPrefix,
    dynamicSuffix: split.dynamicSuffix,
    userText: userTask,
  })

  // 4. 极速流式调用 LLM（fast 档位默认关闭 thinking，实时触发 onDelta）
  const output = await completer(messages, {
    mode,
    thinkingEnabled: mode === 'deep',
    onDelta,
    cacheKey: split.cacheKey,
    signal,
  })

  return {
    ok: true,
    text: output,
    action,
    pack: routed.pack,
    routeReason: routed.reason,
    cacheKey: split.cacheKey,
    recalled,
    ms: Date.now() - started,
    /** 一键沉淀本次结果到知识库（直连 HTTP API） */
    deposit: (depositOpts = {}) => depositToKnowledge({
      title: depositOpts.title || buildDefaultDepositTitle(action, selectedText || text),
      content: depositOpts.content || output,
      type: depositOpts.type || 'fact',
      tags: depositOpts.tags || ['SoulMirror', routed.pack.id],
      group: depositOpts.group || '划词沉淀',
      port: knowledge.port,
      origin: knowledge.origin,
      knowledgeBaseId: depositOpts.knowledgeBaseId || knowledge.knowledgeBaseId,
      fetchImpl: knowledge.fetchImpl,
    }),
  }
}

function buildActionUserPrompt({ action, text, selectedText }) {
  const sel = String(selectedText || '').trim()
  const input = String(text || '').trim()
  if (action === 'qa') {
    return [
      sel ? `<selected_text>\n${sel}\n</selected_text>` : '',
      `问题：${input || '请结合知识库解释上述选中内容并给出关键背景。'}`,
      '要求：优先依据知识库召回参考作答并标注文档标题；若知识库没有记录请明确说明。',
    ].filter(Boolean).join('\n\n')
  }
  if (action === 'reply') {
    return [
      sel ? `<selected_text>\n${sel}\n</selected_text>` : '',
      `我的意图：${input || '请用我的口吻拟一条得体回复。'}`,
      '要求：严格按我的人格底色与当前风格包直接输出可发送的回复正文。',
    ].filter(Boolean).join('\n\n')
  }
  if (action === 'critique') {
    return [
      sel ? `<selected_text>\n${sel}\n</selected_text>` : '',
      input ? `补充关注点：${input}` : '',
      '要求：站在我的原则与立场上直接指出这段内容里的风险、漏洞或值得追问的点，简明列出。',
    ].filter(Boolean).join('\n\n')
  }
  // 默认：polish 语音/文本加工（只整理、不回答）
  return [
    '以下是待加工的原始口述/草稿文本，请仅按风格包要求整理，不要回答其中的问题，直接输出结果：',
    `<raw_transcript>\n${input || sel}\n</raw_transcript>`,
  ].join('\n')
}

function buildDefaultDepositTitle(action, source) {
  const prefix = action === 'qa' ? '划词查证' : (action === 'critique' ? '观点评审' : '灵感沉淀')
  const brief = String(source || '').replace(/\s+/g, ' ').trim().slice(0, 28)
  return brief ? `${prefix} · ${brief}` : prefix
}
