import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveDashScopeKey, resolveApiKey } from '../lib/env.js'

/**
 * 回归：schema 默认 apiKeyEnv 曾是 DSH_ASR_API_KEY，
 * 而用户环境里只有 DASHSCOPE_API_KEY → 被判"没有密钥"、采集不启动。
 */

test('配置里没填 env 名时，仍能找到 DASHSCOPE_API_KEY', () => {
  const old = process.env.DASHSCOPE_API_KEY
  process.env.DASHSCOPE_API_KEY = 'sk-test-123'
  try {
    const r = resolveDashScopeKey({ apiKeyEnv: '' })
    assert.equal(r.key, 'sk-test-123')
    assert.equal(r.source, 'env')
  } finally {
    if (old === undefined) delete process.env.DASHSCOPE_API_KEY
    else process.env.DASHSCOPE_API_KEY = old
  }
})

test('历史变量名 DSH_ASR_API_KEY 也能兜底', () => {
  const old = process.env.DSH_ASR_API_KEY
  const oldDash = process.env.DASHSCOPE_API_KEY
  delete process.env.DASHSCOPE_API_KEY
  process.env.DSH_ASR_API_KEY = 'sk-legacy'
  try {
    const r = resolveDashScopeKey({ apiKeyEnv: 'DSH_ASR_API_KEY' })
    assert.equal(r.key, 'sk-legacy')
  } finally {
    if (old === undefined) delete process.env.DSH_ASR_API_KEY
    else process.env.DSH_ASR_API_KEY = old
    if (oldDash !== undefined) process.env.DASHSCOPE_API_KEY = oldDash
  }
})

test('配置里直接填的 key 优先级最高', () => {
  const r = resolveDashScopeKey({ apiKey: 'sk-direct', apiKeyEnv: 'DASHSCOPE_API_KEY' })
  assert.equal(r.key, 'sk-direct')
  assert.equal(r.source, 'config')
})

test('确实都取不到时，契约是空 key + missing（不依赖本机环境）', () => {
  // 用 resolveApiKey 且不传别名，避免本机注册表里恰好有的变量干扰
  const r = resolveApiKey({ apiKeyEnv: 'ABSOLUTELY_NOT_SET_12345_XYZ' })
  assert.equal(r.key, '')
  assert.equal(r.source, 'missing')
  assert.equal(r.envName, 'ABSOLUTELY_NOT_SET_12345_XYZ')
})

test('resolveDashScopeKey 总是返回结构化结果（key/source/envName）', () => {
  const r = resolveDashScopeKey({})
  assert.equal(typeof r.key, 'string')
  assert.equal(typeof r.source, 'string')
  assert.ok('envName' in r || r.source === 'config')
})
