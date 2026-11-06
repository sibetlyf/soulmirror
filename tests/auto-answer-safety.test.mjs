import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectOptions, isApprovalRequest, isQuestionRequest, pickRecommended, inScope, installAutoAnswer,
} from '../lib/auto-answer.js'

/**
 * 自动应答的安全边界（安全审查 P0）。
 *
 * 原实现：默认开启 + 插件级监听所有 approval/request + 无障碍时回 allowed-once
 * → 别处会话的**权限请求**也会在 5 秒后被自动批准。
 * 现在：默认关、只处理问句、必须限定会话范围、无选项就放弃、卸载清定时器。
 */

const question = { kind: 'question', sessionId: 'meet-1', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
const approval = { kind: 'approval', sessionId: 'meet-1', toolName: 'shell', options: [{ id: 'allow', label: '允许' }] }

test('权限审批与问句要能区分', () => {
  assert.equal(isApprovalRequest(approval), true)
  assert.equal(isQuestionRequest(approval), false, '审批绝不当问句')
  assert.equal(isQuestionRequest(question), true)
  assert.equal(isApprovalRequest(question), false)
})

test('没有 kind 时，靠字段里的权限字样判断为审批', () => {
  assert.equal(isApprovalRequest({ toolName: 'x', risk: 'high' }), true)
  assert.equal(isApprovalRequest({ permission: 'fs.write' }), true)
})

test('无推荐、无选项 → 放弃（不再用 allowed-once 兜底）', () => {
  const r = pickRecommended({ kind: 'approval' })
  assert.equal(r.value, '', '审批不该给出默认允许值')
  assert.equal(r.reason, 'no-options')
})

test('问句有选项时按推荐/第一个回答', () => {
  const a = pickRecommended({ kind: 'question', options: [{ id: 'x', label: 'X (Recommended)' }, { id: 'y', label: 'Y' }] })
  assert.equal(a.value, 'x')
  assert.equal(a.reason, 'recommended-label')

  const b = pickRecommended(question)
  assert.equal(b.value, 'a')
  assert.equal(b.reason, 'first-option')
})

test('会话范围：没配就不接管（安全默认）', () => {
  assert.equal(inScope(question, {}), false, '不配范围等于不接管')
  assert.equal(inScope(question, { onlyForSessionId: 'meet-1' }), true)
  assert.equal(inScope(question, { onlyForSessionId: 'other' }), false)
  assert.equal(inScope(question, { onlyForSessionPrefix: 'meet-' }), true)
  assert.equal(inScope(question, { onlyForSessionPrefix: 'other-' }), false)
})

test('默认关闭：不传 enabled 时完全不安装监听', () => {
  let registered = 0
  const ctx = { on: () => { registered += 1; return () => {} } }
  const a = installAutoAnswer(ctx, {})
  assert.equal(a.enabled, false)
  assert.equal(registered, 0, '默认不该注册任何监听')
})

test('权限审批请求：即使开了自动应答也直接放行给正常流程', async () => {
  let handler = null
  const ctx = { on: (name, fn) => { handler = fn; return () => {} } }
  const a = installAutoAnswer(ctx, { enabled: true, onlyForSessionPrefix: 'meet-', timeoutMs: 5000 })
  assert.equal(a.enabled, true)

  let nextCalled = 0
  const out = await handler(approval, async () => { nextCalled += 1; return 'human-answer' })
  assert.equal(nextCalled, 1, '应交给正常流程')
  assert.equal(out, 'human-answer')
  assert.equal(a.count, 0, '不该计为自动回答')
  a.dispose()
})

test('范围外的问句：不接管', async () => {
  let handler = null
  const ctx = { on: (name, fn) => { handler = fn; return () => {} } }
  const a = installAutoAnswer(ctx, { enabled: true, onlyForSessionPrefix: 'meet-', timeoutMs: 5000 })
  const out = await handler({ ...question, sessionId: 'other-session' }, async () => 'human')
  assert.equal(out, 'human')
  assert.equal(a.count, 0)
  a.dispose()
})

test('范围内的问句：人答优先；卸载后待决定时器被清掉', async () => {
  let handler = null
  const ctx = { on: (name, fn) => { handler = fn; return () => {} } }
  const a = installAutoAnswer(ctx, { enabled: true, onlyForSessionId: 'meet-1', timeoutMs: 5000 })

  const out = await handler(question, async () => 'b')
  assert.equal(out, 'b', '人先答就用人的')
  assert.equal(a.count, 0)

  // 卸载不应抛错，也不应留下会把流程拖 5 秒的定时器
  a.dispose()
})

test('无人应答时自动选推荐项，并计数', async () => {
  let handler = null
  const ctx = { on: (name, fn) => { handler = fn; return () => {} } }
  const a = installAutoAnswer(ctx, { enabled: true, onlyForSessionId: 'meet-1', timeoutMs: 1000 })

  // next 永不解决 → 触发定时器
  const p = handler(question, () => new Promise(() => {}))
  const out = await p
  assert.equal(out, 'a')
  assert.equal(a.count, 1)
  a.dispose()
})
