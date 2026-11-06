import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderPersonaDoc, syncPersonaDoc, profileThinness, PERSONA_KB_NAME } from '../lib/persona-kb.js'
import { emptyProfile, mergeProfile } from '../lib/persona-growth.js'

/**
 * 两个真问题的回归：
 *
 * ① 时间用 toISOString 是 UTC —— 用户看到"更新于 02:56"，本机却是 10:56
 * ② 没有内容门槛 —— 只有 2 条测试数据也会写进知识库，
 *    而知识库里那篇是"这个人是什么样"的对外印象，写错就等于认错人
 */

const NOW = new Date('2026-11-06T10:56:00')   // 本地时间

function profileWith(n) {
  const items = []
  for (let i = 0; i < n; i++) {
    items.push({ section: i % 2 ? 'style' : 'facts', key: 'k' + i, value: '第 ' + i + ' 条信息', confidence: 0.8 })
  }
  return mergeProfile(emptyProfile(), items).profile
}

test('渲染用本地时间，不是 UTC', () => {
  const md = renderPersonaDoc({ profile: profileWith(6), at: NOW.getTime() })
  assert.match(md, /2026-11-06 10:56/, '应显示本地时间')
  assert.equal(/2026-11-06 02:56/.test(md), false, '不该出现 UTC 时间')
})

test('薄画像判定：条数不足 → thin', () => {
  const r = profileThinness(profileWith(2))
  assert.equal(r.thin, true)
  assert.equal(r.items, 2)
  assert.match(r.reason, /至少 5 条/)
})

test('薄画像判定：条数够但相似程度太低 → 仍然 thin', () => {
  const r = profileThinness(profileWith(6), { minScore: 0.5, convergence: { score: 0.2 } })
  assert.equal(r.thin, true)
  assert.match(r.reason, /相似程度/)
})

test('厚画像放行', () => {
  const r = profileThinness(profileWith(8), { convergence: { score: 0.5 } })
  assert.equal(r.thin, false)
  assert.equal(r.items, 8)
})

test('syncPersonaDoc 带门槛时，薄画像直接跳过且不碰网络', async () => {
  let calls = 0
  const fetchImpl = async () => { calls += 1; return { ok: true, status: 200, json: async () => ([]), text: async () => '' } }
  const r = await syncPersonaDoc({
    origin: 'http://x', markdown: '# 画像', fetchImpl,
    profile: profileWith(2), minItems: 5,
  })
  assert.equal(r.ok, false)
  assert.equal(r.skipped, true)
  assert.equal(r.stage, 'gate')
  assert.equal(calls, 0, '被门槛拦下时不该发请求')
})

test('不带门槛时行为不变（单测可直接测同步）', async () => {
  const fetchImpl = async (url, opts = {}) => {
    const m = opts.method || 'GET'
    if (url.endsWith('/knowledge-bases')) return { ok: true, status: 200, json: async () => ([{ id: 'kb', name: PERSONA_KB_NAME }]), text: async () => '' }
    if (url.includes('/entries?knowledgeBaseId=')) return { ok: true, status: 200, json: async () => ({ items: [] }), text: async () => '' }
    if (m === 'POST') return { ok: true, status: 201, json: async () => ({ id: 'e1' }), text: async () => '' }
    return { ok: false, status: 404, json: async () => null, text: async () => '' }
  }
  const r = await syncPersonaDoc({ origin: 'http://x', markdown: '# 画像', fetchImpl })
  assert.equal(r.ok, true)
})

test('会后调用处带了门槛，且"暂不写入"如实报告', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const at = src.indexOf('人格画像 → 独立知识库')
  assert.ok(at > 0)
  const seg = src.slice(at, at + 2600)
  assert.match(seg, /minItems:/, '应传条数门槛')
  assert.match(seg, /minScore:/, '应传相似度门槛')
  assert.match(seg, /暂不写入/, '被拦下时要如实说"暂不写入"而不是"失败"或假装写过')
})
