import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderPersonaDoc, ensurePersonaKB, syncPersonaDoc, PERSONA_KB_NAME, PERSONA_DOC_TITLE,
} from '../lib/persona-kb.js'
import { emptyProfile, mergeProfile } from '../lib/persona-growth.js'

/**
 * 人格画像 → 独立知识库。
 *
 * 用户要求：人格管线同时落盘在知识库，作为单独的一个库存在。
 *
 * 关键约束：
 *   · 画像是"同一篇文档反复更新"，不是每场会新增一篇（否则会被纪要淹没）
 *   · 必须建**独立的知识库**，不混进会议纪要
 *   · 绝不谎报成功：任何一步失败都要带阶段与原因
 */

const ORIGIN = 'http://127.0.0.1:3080'
const NOW = Date.parse('2026-11-06T10:00:00Z')

function profileWith() {
  return mergeProfile(emptyProfile(), [
    { section: 'identity', key: '角色', value: '产品负责人，带 5 人小组', confidence: 0.9 },
    { section: 'style', key: '语气', value: '说话直接，先给结论', confidence: 0.85 },
    { section: 'stance', key: '节奏', value: '先小范围验证再全量', confidence: 0.8 },
  ], { now: NOW }).profile
}

test('渲染：含标题、相似程度、各层与规则', () => {
  const md = renderPersonaDoc({
    profile: profileWith(),
    layers: { warm: 3, cold: 2, episodicDays: 1, journalDays: 2 },
    convergence: { score: 0.42, label: '略有印象' },
    rules: [{ topic: '延期处理', items: ['先给替代方案再报风险'] }],
    at: NOW,
  })
  assert.match(md, /她是谁（自动画像）/)
  assert.match(md, /42%（略有印象）/)
  assert.match(md, /暖态 3 条/)
  assert.match(md, /## 身份/)
  assert.match(md, /产品负责人/)
  assert.match(md, /## 说话方式/)
  assert.match(md, /## 立场与偏好/)
  assert.match(md, /## 经验规则/)
  assert.match(md, /延期处理/)
})

test('渲染：空画像不炸，也不产生空小节', () => {
  const md = renderPersonaDoc({ profile: emptyProfile(), at: NOW })
  assert.match(md, /她是谁/)
  assert.equal(/## 身份/.test(md), false, '没有内容就不该出现空小节')
})

test('建库：已存在则复用，不重复创建', async () => {
  const calls = []
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' })
    return {
      ok: true, status: 200,
      json: async () => ([{ id: 'kb-1', name: PERSONA_KB_NAME }]),
      text: async () => '',
    }
  }
  const r = await ensurePersonaKB({ origin: ORIGIN, fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.id, 'kb-1')
  assert.equal(r.created, false)
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0, '不该重复建库')
})

test('建库：不存在时创建，并带上专属描述', async () => {
  let posted = null
  const fetchImpl = async (url, opts = {}) => {
    if ((opts.method || 'GET') === 'GET') {
      return { ok: true, status: 200, json: async () => ([]), text: async () => '' }
    }
    posted = JSON.parse(opts.body)
    return { ok: true, status: 201, json: async () => ({ id: 'kb-new' }), text: async () => '' }
  }
  const r = await ensurePersonaKB({ origin: ORIGIN, fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.id, 'kb-new')
  assert.equal(r.created, true)
  assert.equal(posted.draft.name, PERSONA_KB_NAME)
  assert.match(posted.draft.description, /人格画像|画像/)
})

test('同步：库里有同标题条目 → 更新（PUT），不新增', async () => {
  const seen = []
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET'
    seen.push(method + ' ' + url.replace(ORIGIN, ''))
    if (url.endsWith('/knowledge-bases')) return { ok: true, status: 200, json: async () => ([{ id: 'kb-1', name: PERSONA_KB_NAME }]), text: async () => '' }
    if (url.includes('/entries?knowledgeBaseId=')) {
      return { ok: true, status: 200, json: async () => ({ items: [{ id: 'e-1', title: PERSONA_DOC_TITLE, version: 3 }] }), text: async () => '' }
    }
    if (/\/entries\/e-1$/.test(url) && method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ id: 'e-1', version: 4 }), text: async () => '' }
    }
    if (/\/entries\/e-1$/.test(url) && method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({ id: 'e-1' }), text: async () => '' }
    }
    if (url.endsWith('/entries') && method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 'e-new' }), text: async () => '' }
    }
    return { ok: false, status: 404, json: async () => null, text: async () => '' }
  }
  const r = await syncPersonaDoc({ origin: ORIGIN, markdown: '# 画像', fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.action, 'updated')
  assert.equal(r.kbId, 'kb-1')
  assert.equal(seen.some((s) => s.startsWith('POST /knowledge-local/v1/entries')), false, '不该新增重复条目')
})

test('同步：库里没有 → 新建（POST）', async () => {
  let created = null
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET'
    if (url.endsWith('/knowledge-bases')) return { ok: true, status: 200, json: async () => ([{ id: 'kb-1', name: PERSONA_KB_NAME }]), text: async () => '' }
    if (url.includes('/entries?knowledgeBaseId=')) return { ok: true, status: 200, json: async () => ({ items: [] }), text: async () => '' }
    if (url.endsWith('/entries') && method === 'POST') {
      created = JSON.parse(opts.body)
      return { ok: true, status: 201, json: async () => ({ id: 'e-new' }), text: async () => '' }
    }
    return { ok: false, status: 404, json: async () => null, text: async () => '' }
  }
  const r = await syncPersonaDoc({ origin: ORIGIN, markdown: '# 画像', fetchImpl })
  assert.equal(r.ok, true)
  assert.equal(r.action, 'created')
  assert.equal(created.draft.knowledgeBaseId, 'kb-1', '必须写进专属库')
  assert.equal(created.draft.title, PERSONA_DOC_TITLE)
})

test('不谎报：更新失败返回 ok:false 并带阶段', async () => {
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET'
    if (url.endsWith('/knowledge-bases')) return { ok: true, status: 200, json: async () => ([{ id: 'kb-1', name: PERSONA_KB_NAME }]), text: async () => '' }
    if (url.includes('/entries?knowledgeBaseId=')) return { ok: true, status: 200, json: async () => ({ items: [{ id: 'e-1', title: PERSONA_DOC_TITLE, version: 1 }] }), text: async () => '' }
    if (method === 'PUT') return { ok: false, status: 409, json: async () => null, text: async () => 'version conflict' }
    return { ok: true, status: 200, json: async () => ({ id: 'e-1', version: 1 }), text: async () => '' }
  }
  const r = await syncPersonaDoc({ origin: ORIGIN, markdown: '# 画像', fetchImpl })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'entry-update')
  assert.match(r.error, /409/)
})

test('不谎报：拿不到宿主地址时直接失败', async () => {
  const r = await syncPersonaDoc({ origin: '', markdown: '# 画像' })
  assert.equal(r.ok, false)
  assert.match(r.error, /宿主地址/)
})

test('空文档不写入（避免把知识库清空）', async () => {
  const r = await syncPersonaDoc({ origin: ORIGIN, markdown: '   ' })
  assert.equal(r.ok, false)
  assert.equal(r.stage, 'render')
})

test('库名与文档标题是稳定的常量（便于反复更新同一篇）', () => {
  assert.equal(PERSONA_KB_NAME, 'SoulMirror · 人格画像')
  assert.equal(PERSONA_DOC_TITLE, '她是谁（自动画像）')
})
