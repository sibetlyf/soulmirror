/**
 * 人格画像 → 独立知识库。
 *
 * 为什么单独建一个库，而不是混进「会议纪要」：
 *   1. 纪要面向"这场会发生什么"，画象面向"这个人是什么样"，检索语义完全不同
 *   2. 画像是**持续更新的一份文档**（同一篇反复覆盖），纪要是不断新增
 *   3. 混在一起时，画像会被几十篇纪要淹没，召回几乎不可能命中
 *
 * 接口（来自 dsh-knowledge 的 /knowledge-local/v1）：
 *   GET  /knowledge-bases                     列出知识库
 *   POST /knowledge-bases   { draft }         建库
 *   GET  /entries?knowledgeBaseId=…           列条目
 *   GET  /entries/:id                         取单条（拿 version）
 *   POST /entries           { draft }         新建条目
 *   PUT  /entries/:id       { draft, expectedVersion }  更新条目
 *
 * 设计原则：**绝不谎报成功**。任何一步失败都返回 ok:false 并带上原因与阶段。
 */

export const PERSONA_KB_NAME = 'SoulMirror · 人格画像'
export const PERSONA_DOC_TITLE = '她是谁（自动画像）'

const SEC = ['identity', 'style', 'stance', 'facts', 'state']
const TITLE = {
  identity: '身份',
  style: '说话方式',
  stance: '立场与偏好',
  facts: '已知事实',
  state: '近期状态',
}

/**
 * 把画像渲染成一篇给人看也给人搜的文档。
 * @param {{profile: object, layers?: object, convergence?: object, rules?: Array, at?: number}} o
 */
export function renderPersonaDoc({ profile, layers = null, convergence = null, rules = [], at = Date.now() } = {}) {
  const d = new Date(at)
  const stamp = d.toISOString().slice(0, 16).replace('T', ' ')
  const out = ['# 她是谁（自动画像）', '', '> 由 SoulMirror 在每场会议后自动更新。', '> 更新于 ' + stamp, '']

  if (convergence && typeof convergence.score === 'number') {
    out.push('## 相似程度', '', '-' + ' ' + Math.round(convergence.score * 100) + '%（' + convergence.label + '）', '')
  }
  if (layers) {
    out.push('## 记忆规模', '',
      '- 暖态 ' + (layers.warm || 0) + ' 条 · 冷储 ' + (layers.cold || 0) + ' 条 · 归档 ' +
      (layers.episodicDays || 0) + ' 天 · 流水 ' + (layers.journalDays || 0) + ' 天', '')
  }

  const sections = (profile && profile.sections) || {}
  for (const s of SEC) {
    const list = Array.isArray(sections[s]) ? sections[s] : []
    if (!list.length) continue
    out.push('## ' + TITLE[s], '')
    for (const it of list) {
      const seen = it.seen && it.seen > 1 ? '（' + it.seen + ' 次）' : ''
      out.push('- ' + String(it.value || '').trim() + seen)
    }
    out.push('')
  }

  if (Array.isArray(rules) && rules.length) {
    out.push('## 经验规则', '')
    for (const r of rules) {
      out.push('### ' + (r.topic || '一般'))
      for (const it of r.items || []) out.push('- ' + it)
    }
    out.push('')
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

function jsonOf(res) {
  return res.json().catch(() => null)
}

/**
 * 找到或创建「人格画像」知识库。
 * @returns {Promise<{ok: boolean, id?: string, name?: string, created?: boolean, error?: string, stage?: string}>}
 */
export async function ensurePersonaKB({ origin, name = PERSONA_KB_NAME, fetchImpl = fetch } = {}) {
  if (!origin) return { ok: false, error: '拿不到宿主地址', stage: 'kb' }
  const headers = { 'x-dsh-knowledge-client': 'management-web' }
  try {
    const listRes = await fetchImpl(origin + '/knowledge-local/v1/knowledge-bases', { headers })
    if (!listRes.ok) return { ok: false, error: '列知识库失败 HTTP ' + listRes.status, stage: 'kb-list' }
    const list = await jsonOf(listRes)
    const hit = Array.isArray(list) ? list.find((x) => x && x.name === name) : null
    if (hit) return { ok: true, id: hit.id, name, created: false }

    const createRes = await fetchImpl(origin + '/knowledge-local/v1/knowledge-bases', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        draft: {
          name,
          description: '由 SoulMirror 自动维护：用户的画像、说话方式、立场偏好与工作模式。每场会议后更新同一篇文档。',
          defaultTags: ['人格画像', 'SoulMirror'],
        },
      }),
    })
    if (!createRes.ok) {
      const t = await createRes.text().catch(() => '')
      return { ok: false, error: '建知识库失败 HTTP ' + createRes.status + ' ' + t.slice(0, 120), stage: 'kb-create' }
    }
    const created = await jsonOf(createRes)
    if (!created || !created.id) return { ok: false, error: '建知识库返回体缺 id', stage: 'kb-create' }
    return { ok: true, id: created.id, name, created: true }
  } catch (e) {
    return { ok: false, error: e.message, stage: 'kb-throw' }
  }
}

/**
 * 同步画像文档：同一标题存在就覆盖，不存在就新建。
 * @returns {Promise<{ok: boolean, action?: 'created'|'updated', id?: string, kbId?: string, kbName?: string, error?: string, stage?: string}>}
 */
export async function syncPersonaDoc({
  origin,
  name = PERSONA_KB_NAME,
  title = PERSONA_DOC_TITLE,
  markdown = '',
  fetchImpl = fetch,
} = {}) {
  const body = String(markdown || '').trim()
  if (!body) return { ok: false, error: '画像文档为空，未写入', stage: 'render' }

  const kb = await ensurePersonaKB({ origin, name, fetchImpl })
  if (!kb.ok) return { ok: false, error: kb.error, stage: kb.stage }

  const headers = { 'x-dsh-knowledge-client': 'management-web', 'content-type': 'application/json' }

  try {
    // 找同一标题的既有条目
    const listRes = await fetchImpl(
      origin + '/knowledge-local/v1/entries?knowledgeBaseId=' + encodeURIComponent(kb.id) + '&limit=100',
      { headers: { 'x-dsh-knowledge-client': 'management-web' } },
    )
    if (!listRes.ok) return { ok: false, error: '列条目失败 HTTP ' + listRes.status, stage: 'entry-list' }
    const listing = await jsonOf(listRes)
    const items = (listing && (listing.items || listing)) || []
    const existing = Array.isArray(items) ? items.find((x) => x && x.title === title) : null

    if (existing) {
      // 取最新 version，避免并发覆盖
      let version = existing.version
      try {
        const one = await fetchImpl(origin + '/knowledge-local/v1/entries/' + existing.id, {
          headers: { 'x-dsh-knowledge-client': 'management-web' },
        })
        if (one.ok) {
          const j = await jsonOf(one)
          if (j && j.version) version = j.version
        }
      } catch { /* 用列表里的 version 兜底 */ }

      const res = await fetchImpl(origin + '/knowledge-local/v1/entries/' + existing.id, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          draft: {
            title,
            body,
            type: 'decision',
            tags: ['人格画像', 'SoulMirror'],
            group: '人格画像',
            knowledgeBaseId: kb.id,
            scope: { kind: 'global' },
            confidence: 0.9,
            source: { evidence: 'verified' },
          },
          ...(version ? { expectedVersion: version } : {}),
        }),
      })
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        return { ok: false, error: '更新失败 HTTP ' + res.status + ' ' + t.slice(0, 120), stage: 'entry-update', id: existing.id, kbId: kb.id, kbName: kb.name }
      }
      const j = await jsonOf(res)
      return { ok: true, action: 'updated', id: (j && j.id) || existing.id, kbId: kb.id, kbName: kb.name }
    }

    const res = await fetchImpl(origin + '/knowledge-local/v1/entries', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        draft: {
          title,
          body,
          type: 'decision',
          tags: ['人格画像', 'SoulMirror'],
          group: '人格画像',
          knowledgeBaseId: kb.id,
          scope: { kind: 'global' },
          confidence: 0.9,
          source: { evidence: 'verified' },
        },
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { ok: false, error: '新建失败 HTTP ' + res.status + ' ' + t.slice(0, 120), stage: 'entry-create', kbId: kb.id, kbName: kb.name }
    }
    const j = await jsonOf(res)
    return { ok: true, action: 'created', id: (j && j.id) || '', kbId: kb.id, kbName: kb.name }
  } catch (e) {
    return { ok: false, error: e.message, stage: 'entry-throw', kbId: kb.id, kbName: kb.name }
  }
}
