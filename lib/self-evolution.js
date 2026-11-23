/**
 * 双轨自进化引擎（纯本地 Diff 观察，绝不静默写入人格或词典）：
 *
 *   轨道 A（术语纠偏）：用户手动修改了专有名词/同音字（如"大鱼"→"大禹"、"阿哥诺"→"Agno"）
 *     → 生成待确认术语卡片 → 用户点头后写入本地词典（按命中率排序供 ASR 热词注入）
 *     → 并可一键同步沉淀到 dsh-knowledge 术语库。
 *
 *   轨道 B（风格/表达习惯纠偏）：用户反复删除客套话、把长句改短、把段落改成要点列表等
 *     → 本地累积信号，达到阈值（默认 3 次）后生成 SoulMirror 人格/风格包进化提案
 *     → 用户审批通过后写入 PROFILE.json（style 层）或追加到对应 Style Pack。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyProfile, mergeProfile } from './persona-growth.js'
import { loadProfile, saveProfile, appendPersonaSection } from './persona.js'
import { appendStylePackRule } from './style-packs.js'
import { depositToKnowledge } from './knowledge.js'

const DICT_FILE = 'dictionary.json'
const EVOLUTION_FILE = 'evolution-state.json'

/** 常见客套开场/收尾词（用于检测用户是否反感套话） */
const POLITENESS_PHRASES = [
  '非常感谢', '感谢您的理解', '不好意思打扰', '希望能帮到您', '综上所述',
  '总而言之', '顺祝商祺', '期待您的回复', '打扰一下', '如有任何问题请随时联系',
]

const HEDGE_PHRASES = ['或许可以', '也许可以', '建议考虑', '可能比较', '不妨尝试']

function readJson(file, fallback) {
  if (!existsSync(file)) return fallback
  try {
    return JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  } catch {
    return fallback
  }
}

function writeJson(file, data) {
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6)
}

/**
 * 局部公共前后缀裁剪：找出 before 与 after 之间发生替换的最小片段。
 */
export function extractMinimalReplacement(before, after) {
  const a = String(before || '')
  const b = String(after || '')
  if (a === b) return null

  let start = 0
  const minLen = Math.min(a.length, b.length)
  while (start < minLen && a[start] === b[start]) start += 1

  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1
    endB -= 1
  }

  return {
    wrong: a.slice(start, endA).trim(),
    correct: b.slice(start, endB).trim(),
    start,
  }
}

/**
 * 纯函数：分析一次「AI 原文 → 用户手改后文本」的本地 Diff，输出双轨信号。
 */
export function analyzeEditDiff(before, after, { maxTermLen = 16 } = {}) {
  const src = String(before || '').trim()
  const dst = String(after || '').trim()
  if (!src || !dst || src === dst) {
    return { termCandidates: [], styleSignals: [] }
  }

  const termCandidates = []
  const styleSignals = []

  // ── 轨道 A：局部短词替换（术语 / 专有名词 / 同音字） ──
  const diff = extractMinimalReplacement(src, dst)
  if (
    diff &&
    diff.wrong.length >= 1 &&
    diff.correct.length >= 2 &&
    diff.wrong.length <= maxTermLen &&
    diff.correct.length <= maxTermLen &&
    !/[\r\n]/.test(diff.correct) &&
    !/[，。！？；：]/.test(diff.correct) &&
    // 排除纯删除客套话
    !POLITENESS_PHRASES.some((p) => diff.wrong.includes(p))
  ) {
    // 整体长度变化不大时，更可能是专有名词/同音字替换
    const lenRatio = Math.abs(src.length - dst.length) / Math.max(1, src.length)
    if (lenRatio <= 0.45) {
      termCandidates.push({
        wrong: diff.wrong,
        correct: diff.correct,
        context: dst.slice(Math.max(0, diff.start - 12), diff.start + diff.correct.length + 12),
      })
    }
  }

  // ── 轨道 B：表达风格与结构习惯修改信号 ──
  // 1) 删除客套话
  const droppedPolite = POLITENESS_PHRASES.filter((p) => src.includes(p) && !dst.includes(p))
  if (droppedPolite.length > 0) {
    styleSignals.push({
      pattern: 'remove-politeness',
      rule: '避免客套开场白与收尾套话，直接表达核心内容',
      evidence: '删除了：' + droppedPolite.join('、'),
    })
  }

  // 2) 明显精简压短（字数减少 >= 25% 且至少删掉 10 字）
  if (src.length >= 24 && src.length - dst.length >= 10 && dst.length / src.length <= 0.75) {
    styleSignals.push({
      pattern: 'shorten-sentences',
      rule: '表达偏好简短干练，减少铺垫与修饰词',
      evidence: `从 ${src.length} 字精简到 ${dst.length} 字`,
    })
  }

  // 3) 把连续段落改成了编号/项目符号要点
  const hadBullets = /(^|\n)\s*(?:[-*•]|\d+[.、)])\s+/m.test(src)
  const hasBullets = /(^|\n)\s*(?:[-*•]|\d+[.、)])\s+/m.test(dst)
  if (!hadBullets && hasBullets) {
    styleSignals.push({
      pattern: 'bullet-structure',
      rule: '多点内容优先使用编号或项目符号分条呈现',
      evidence: '将连续段落改写为分条要点',
    })
  }

  // 4) 去掉委婉模糊词，改为直接肯定表达
  const droppedHedge = HEDGE_PHRASES.filter((p) => src.includes(p) && !dst.includes(p))
  if (droppedHedge.length > 0) {
    styleSignals.push({
      pattern: 'direct-tone',
      rule: '表达更偏好直接给结论，少用“或许/建议考虑”等模糊缓冲词',
      evidence: '移除了：' + droppedHedge.join('、'),
    })
  }

  return { termCandidates, styleSignals }
}

/**
 * 创建双轨自进化管理器（落盘在 dataDir 下的 dictionary.json 与 evolution-state.json）。
 */
export function createSelfEvolutionStore(dataDir, { proposalThreshold = 3 } = {}) {
  if (!dataDir) throw new Error('缺少 dataDir')
  mkdirSync(dataDir, { recursive: true })
  const dictPath = join(dataDir, DICT_FILE)
  const evoPath = join(dataDir, EVOLUTION_FILE)

  function loadDict() {
    const d = readJson(dictPath, { version: 1, entries: [] })
    if (!Array.isArray(d.entries)) d.entries = []
    return d
  }

  function saveDict(d) {
    d.updatedAt = new Date().toISOString()
    writeJson(dictPath, d)
    return d
  }

  function loadEvo() {
    const e = readJson(evoPath, {
      version: 1,
      termSuggestions: [],
      signalCounts: {},
      proposals: [],
    })
    if (!Array.isArray(e.termSuggestions)) e.termSuggestions = []
    if (!e.signalCounts || typeof e.signalCounts !== 'object') e.signalCounts = {}
    if (!Array.isArray(e.proposals)) e.proposals = []
    return e
  }

  function saveEvo(e) {
    e.updatedAt = new Date().toISOString()
    writeJson(evoPath, e)
    return e
  }

  return {
    /**
     * 观察一次用户手改事件：
     * - 术语替换 → 生成待确认的 termSuggestions（绝不静默进词典）
     * - 风格修改 → 累加 signalCounts，达阈值后生成待审批的 Persona/StylePack 提案
     */
    observeEdit({ before, after, stylePackId = '', source = 'dictation' } = {}) {
      const { termCandidates, styleSignals } = analyzeEditDiff(before, after)
      const evo = loadEvo()
      const dict = loadDict()
      const now = new Date().toISOString()
      const newTerms = []
      const newProposals = []

      for (const tc of termCandidates) {
        const alreadyInDict = dict.entries.some((x) => x.term.toLowerCase() === tc.correct.toLowerCase())
        const alreadyPending = evo.termSuggestions.some(
          (x) => x.status === 'pending' && x.correct.toLowerCase() === tc.correct.toLowerCase(),
        )
        if (alreadyInDict || alreadyPending) continue
        const item = {
          id: makeId('term'),
          wrong: tc.wrong,
          correct: tc.correct,
          context: tc.context,
          source,
          status: 'pending',
          createdAt: now,
        }
        evo.termSuggestions.push(item)
        newTerms.push(item)
      }

      for (const sig of styleSignals) {
        const key = stylePackId ? `${sig.pattern}@${stylePackId}` : sig.pattern
        const bucket = evo.signalCounts[key] || {
          pattern: sig.pattern,
          stylePackId,
          rule: sig.rule,
          count: 0,
          evidences: [],
        }
        bucket.count += 1
        bucket.lastAt = now
        if (sig.evidence) bucket.evidences = [...bucket.evidences.slice(-4), sig.evidence]
        evo.signalCounts[key] = bucket

        // 达阈值且没有同 key 的 pending/rejected 提案时，生成一条进化提案
        const existsProposal = evo.proposals.some(
          (p) => p.signalKey === key && (p.status === 'pending' || p.status === 'approved'),
        )
        if (bucket.count >= proposalThreshold && !existsProposal) {
          const proposal = {
            id: makeId('prop'),
            signalKey: key,
            pattern: sig.pattern,
            target: stylePackId ? 'style-pack' : 'persona',
            stylePackId,
            rule: sig.rule,
            count: bucket.count,
            evidences: bucket.evidences.slice(),
            status: 'pending',
            createdAt: now,
          }
          evo.proposals.push(proposal)
          newProposals.push(proposal)
        }
      }

      saveEvo(evo)
      return { newTerms, newProposals, termCandidates, styleSignals }
    },

    /** 列出待确认术语与待审批人格/风格包提案 */
    listPending() {
      const evo = loadEvo()
      return {
        terms: evo.termSuggestions.filter((x) => x.status === 'pending'),
        proposals: evo.proposals.filter((x) => x.status === 'pending'),
      }
    },

    /**
     * 轨道 A 确认：将术语写入本地词典（按命中数排序），并可选一键同步到 dsh-knowledge。
     */
    async confirmTerm(termId, { knowledge = null } = {}) {
      const evo = loadEvo()
      const item = evo.termSuggestions.find((x) => x.id === termId)
      if (!item) return { ok: false, error: '未找到该术语建议' }
      item.status = 'confirmed'
      item.confirmedAt = new Date().toISOString()

      const dict = loadDict()
      const existing = dict.entries.find((x) => x.term.toLowerCase() === item.correct.toLowerCase())
      if (existing) {
        existing.hits = (existing.hits || 1) + 1
        existing.lastAt = item.confirmedAt
        if (item.wrong && !existing.aliases.includes(item.wrong)) existing.aliases.push(item.wrong)
      } else {
        dict.entries.push({
          term: item.correct,
          aliases: item.wrong ? [item.wrong] : [],
          hits: 1,
          createdAt: item.confirmedAt,
          lastAt: item.confirmedAt,
        })
      }
      saveDict(dict)
      saveEvo(evo)

      // 可选：同步沉淀到 dsh-knowledge 术语库
      let kbResult = null
      if (knowledge && (knowledge.port || knowledge.origin)) {
        kbResult = await depositToKnowledge({
          title: `术语 · ${item.correct}`,
          content: `正确拼写：${item.correct}\n常见误识别：${item.wrong || '无'}\n示例上下文：${item.context || '无'}`,
          type: 'fact',
          tags: ['个人词典', '术语'],
          group: '个人词典',
          confidence: 0.95,
          evidence: 'confirmed',
          port: knowledge.port,
          origin: knowledge.origin,
          knowledgeBaseId: knowledge.knowledgeBaseId,
          fetchImpl: knowledge.fetchImpl,
        })
      }

      return { ok: true, term: item.correct, kbResult }
    },

    /** 忽略某条术语建议 */
    dismissTerm(termId) {
      const evo = loadEvo()
      const item = evo.termSuggestions.find((x) => x.id === termId)
      if (!item) return { ok: false, error: '未找到该术语建议' }
      item.status = 'dismissed'
      saveEvo(evo)
      return { ok: true }
    },

    /** 按命中次数优先返回 Top-N 热词，供流式 ASR hotwords 与 Prompt 注入 */
    getTopHotwords(limit = 40) {
      const dict = loadDict()
      return dict.entries
        .slice()
        .sort((a, b) => (b.hits || 0) - (a.hits || 0) || String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
        .slice(0, limit)
        .map((x) => x.term)
    },

    /**
     * 轨道 B 审批通过：将风格进化提案正式写入 SoulMirror PROFILE.json（style 层）、USER.md 或对应风格包。
     */
    approveProposal(proposalId, { personaDir, writeStylePack = true } = {}) {
      const evo = loadEvo()
      const prop = evo.proposals.find((x) => x.id === proposalId)
      if (!prop) return { ok: false, error: '未找到该进化提案' }

      const appliedTo = []
      if (personaDir) {
        const current = loadProfile(personaDir) || emptyProfile()
        const { profile } = mergeProfile(current, [{
          section: 'style',
          key: prop.pattern,
          value: prop.rule,
          confidence: 0.85,
        }], { source: 'self-evolution' })
        saveProfile(personaDir, profile)
        appendPersonaSection(personaDir, 'user', [prop.rule])
        appliedTo.push('persona:PROFILE.json', 'persona:USER.md')
      }

      if (writeStylePack && prop.stylePackId) {
        const updated = appendStylePackRule(dataDir, prop.stylePackId, prop.rule)
        if (updated) appliedTo.push('style-pack:' + prop.stylePackId)
      }

      prop.status = 'approved'
      prop.approvedAt = new Date().toISOString()
      prop.appliedTo = appliedTo
      saveEvo(evo)

      return { ok: true, proposal: prop, appliedTo }
    },

    /** 拒绝某条进化提案（不会反复弹窗） */
    rejectProposal(proposalId) {
      const evo = loadEvo()
      const prop = evo.proposals.find((x) => x.id === proposalId)
      if (!prop) return { ok: false, error: '未找到该进化提案' }
      prop.status = 'rejected'
      prop.rejectedAt = new Date().toISOString()
      saveEvo(evo)
      return { ok: true }
    },
  }
}
