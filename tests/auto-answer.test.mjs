import { test } from 'node:test'
import assert from 'node:assert/strict'
import { installAutoAnswer, pickRecommended, collectOptions } from '../lib/auto-answer.js'

function installed(t, cfg = {}) {
  const handlers = {}
  const logs = []
  const inst = installAutoAnswer({ on(name, fn) { handlers[name] = fn; return () => {} } },
    { enabled: true, timeoutMs: 1000, onlyForSessionId: 'meeting-test', ...cfg }, { info: (m) => logs.push(m) })
  t.after(() => inst.dispose())
  return { handlers, logs, inst }
}

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
  assert.equal(pickRecommended({ options: [{ id: 'a' }, { id: 'b', recommended: true }] }).reason, 'recommended-flag')
  assert.equal(pickRecommended({ options: [{ id: 'x', label: '跳过' }, { id: 'y', label: '继续 (Recommended)' }] }).value, 'y')
  assert.equal(pickRecommended({ options: [{ id: 'p', label: '方案一（推荐）' }] }).value, 'p')
})

test('pickRecommended 不制造 allowed-once；无推荐项只返回已有选项', () => {
  assert.equal(pickRecommended({ toolName: 'pwsh', options: [{ id: 'deny' }] }).value, 'deny')
  assert.equal(pickRecommended({ toolName: 'pwsh' }).value, '')
})

test('问句无推荐项仅在已有选项中取第一项', () => {
  const r = pickRecommended({ kind: 'question', questions: [{ options: [{ id: 'first' }, { id: 'second' }] }] })
  assert.equal(r.value, 'first')
  assert.equal(r.reason, 'first-option')
})

test('同一显式范围的问句无人回答，才超时选推荐项', async (t) => {
  const { handlers, logs, inst } = installed(t)
  // Production timer is unref'd: this bounded sentinel keeps only this isolated test alive.
  const keepAlive = setTimeout(() => {}, 2000)
  t.after(() => clearTimeout(keepAlive))
  const answer = await handlers['approval/request']({ kind: 'question', sessionId: 'meeting-test',
    options: [{ id: 'go', label: '继续 (Recommended)' }] }, () => new Promise(() => {}))
  assert.equal(answer, 'go')
  assert.equal(inst.count, 1)
  assert.match(logs.join('\n'), /自动选择/)
})

test('人先回答时使用人的答案，不自动答', async (t) => {
  const { handlers, inst } = installed(t)
  const answer = await handlers['approval/request']({ kind: 'question', sessionId: 'meeting-test',
    options: [{ id: 'auto', recommended: true }] }, async () => 'human-choice')
  assert.equal(answer, 'human-choice')
  assert.equal(inst.count, 0)
})

test('审批即使有推荐允许项也绝不自动通过', async (t) => {
  const { handlers, inst } = installed(t)
  const answer = await handlers['approval/request']({ kind: 'approval', sessionId: 'meeting-test',
    options: [{ id: 'allowed-once', recommended: true }] }, async () => 'human-required')
  assert.equal(answer, 'human-required')
  assert.equal(inst.count, 0)
})

test('无范围或其它会话问句不自动接管', async (t) => {
  for (const cfg of [{ onlyForSessionId: '' }, { onlyForSessionId: 'other-session' }]) {
    const { handlers, inst } = installed(t, cfg)
    const answer = await handlers['approval/request']({ kind: 'question', sessionId: 'meeting-test',
      options: [{ id: 'auto', recommended: true }] }, async () => 'human-required')
    assert.equal(answer, 'human-required')
    assert.equal(inst.count, 0)
  }
})

test('默认与显式禁用均不安装', () => {
  const ctx = { on() { throw new Error('should not subscribe') } }
  for (const cfg of [{}, { enabled: false }]) {
    const inst = installAutoAnswer(ctx, cfg, {})
    assert.equal(inst.enabled, false)
    inst.dispose()
  }
})
