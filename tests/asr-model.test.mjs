import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAsrModel, withSyncedModel, DASHSCOPE_MODELS } from '../lib/asr-model.js'

test('选了 v1 就必须是 v1（历史 bug：显示的还是 v2）', () => {
  assert.equal(resolveAsrModel({ provider: 'dashscope', model: 'paraformer-realtime-v1', dashscopeModel: 'paraformer-realtime-v2' }), 'paraformer-realtime-v1')
})

test('默认值 whisper-1 对 dashscope 无意义，回退到 dashscopeModel', () => {
  assert.equal(resolveAsrModel({ provider: 'dashscope', model: 'whisper-1', dashscopeModel: 'paraformer-realtime-v1' }), 'paraformer-realtime-v1')
})

test('两个都空 → 用 dashscope 默认模型', () => {
  assert.equal(resolveAsrModel({ provider: 'dashscope' }), 'paraformer-realtime-v2')
  assert.equal(resolveAsrModel({}), 'paraformer-realtime-v2')
})

test('非 dashscope 路径原样返回 model', () => {
  assert.equal(resolveAsrModel({ provider: 'openai', model: 'whisper-1' }), 'whisper-1')
  assert.equal(resolveAsrModel({ provider: 'none', model: '' }), '')
})

test('未知的新模型名不拦截，原样下发', () => {
  assert.equal(resolveAsrModel({ provider: 'dashscope', model: 'paraformer-realtime-v3' }), 'paraformer-realtime-v3')
})

test('withSyncedModel 让两个字段一致', () => {
  const out = withSyncedModel({ provider: 'dashscope', model: 'paraformer-realtime-v1', dashscopeModel: 'paraformer-realtime-v2' })
  assert.equal(out.model, 'paraformer-realtime-v1')
  assert.equal(out.dashscopeModel, 'paraformer-realtime-v1', '旧字段也要跟着更新')
})

test('可选模型清单包含 v2 与 v1', () => {
  assert.ok(DASHSCOPE_MODELS.includes('paraformer-realtime-v2'))
  assert.ok(DASHSCOPE_MODELS.includes('paraformer-realtime-v1'))
})
