import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installAutoAnswer, pickRecommended, collectOptions } from '../lib/auto-answer.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

test('collectOptions 兼容多种形状', () => {
  const a = collectOptions({ options: [{ id: 'yes', label: '好（推荐）', recommended: true }] })
  assert.equal(a.length, 1)
  assert.equal(a[0].value, 'yes')
  const b = collectOptions({ questions: [{ options: ['允许', '拒绝'] }] })
  assert.equal(b.length, 2)
  assert.equal(b[0].label, '允许')
  assert.equal(collectOptions({}).length, 0)
})

test('pickRecommended 优先显式标记，其次标签', () => {
  assert.deepEqual(
    pickRecommended({ options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', recommended: true }] }).reason,
    'recommended-flag',
  )
  assert.equal(
    pickRecommended({ options: [{ id: 'x', label: '跳过' }, { id: 'y', label: '继续 (Recommended)' }] }).value,
    'y',
  )
  assert.equal(
    pickRecommended({ options: [{ id: 'p', label: '方案一（推荐）' }] }).value,
    'p',
  )
})

test('pickRecommended 无推荐项时：审批默认允许一次', () => {
  assert.equal(pickRecommended({ toolName: 'pwsh', options: [{ id: 'deny' }] }).value, 'allowed-once')
})

test('pickRecommended 问句无推荐项时取第一项', () => {
  const r = pickRecommended({ kind: 'question', questions: [{ options: [{ id: 'first' }, { id: 'second' }] }] })
  assert.equal(r.value, 'first')
  assert.equal(r.reason, 'first-option')
})

test('没人回答时超时自动选推荐项', async () => {
  const handlers = {}
  const ctx = { on: (name, fn) => { handlers[name] = fn; return () => {} } }
  const logs = []
  const inst = installAutoAnswer(ctx, { enabled: true, timeoutMs: 1200 }, { info: (m) => logs.push(m) })
  assert.equal(inst.enabled, true)
  const answer = await handlers['approval/request'](
    { toolName: 'ask_user_question', options: [{ id: 'go', label: '继续 (Recommended)' }] },
    () => new Promise(() => {}), // 人永远不回答
  )
  assert.equal(answer, 'go')
  assert.equal(inst.count, 1)
  assert.match(logs.join('\n'), /自动选择/)
})

test('有人先回答时用人的答案，不自动答', async () => {
  const handlers = {}
  const ctx = { on: (name, fn) => { handlers[name] = fn; return () => {} } }
  const inst = installAutoAnswer(ctx, { enabled: true, timeoutMs: 3000 }, { info: () => {} })
  setTimeout(() => {}, 10)
  const answer = await handlers['approval/request'](
    { options: [{ id: 'auto', label: '自动 (Recommended)' }] },
    async () => 'human-choice',
  )
  assert.equal(answer, 'human-choice')
  assert.equal(inst.count, 0)
})

test('禁用时不安装', () => {
  const ctx = { on: () => { throw new Error('should not subscribe') } }
  const inst = installAutoAnswer(ctx, { enabled: false }, {})
  assert.equal(inst.enabled, false)
  inst.dispose()
})
