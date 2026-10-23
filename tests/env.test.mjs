import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveApiKey, keyInfo, readEnv, clearEnvCache } from '../lib/env.js'

test('resolveApiKey：配置里的密钥优先', () => {
  const r = resolveApiKey({ apiKey: 'sk-from-config', apiKeyEnv: 'SOME_NOPE_VAR' })
  assert.equal(r.key, 'sk-from-config')
  assert.equal(r.source, 'config')
})

test('resolveApiKey：进程环境变量次之', () => {
  process.env.SM_TEST_KEY = 'sk-from-proc'
  clearEnvCache()
  const r = resolveApiKey({ apiKeyEnv: 'SM_TEST_KEY' })
  assert.equal(r.key, 'sk-from-proc')
  assert.equal(r.source, 'env')
  delete process.env.SM_TEST_KEY
})

test('resolveApiKey：找不到时明确报 missing', () => {
  clearEnvCache()
  const r = resolveApiKey({ apiKeyEnv: 'SM_DEFINITELY_NOT_SET_12345' })
  assert.equal(r.key, '')
  assert.equal(r.source, 'missing')
})

test('resolveApiKey：支持别名顺序', () => {
  process.env.SM_ALIAS_KEY = 'sk-alias'
  clearEnvCache()
  const r = resolveApiKey({ apiKeyEnv: 'SM_NOT_SET_ABC' }, ['SM_ALIAS_KEY'])
  assert.equal(r.key, 'sk-alias')
  assert.equal(r.envName, 'SM_ALIAS_KEY')
  delete process.env.SM_ALIAS_KEY
})

test('keyInfo：给出 set 与来源', () => {
  const info = keyInfo({ apiKey: 'sk-x' })
  assert.equal(info.set, true)
  assert.equal(info.source, 'config')
})

test('readEnv：进程环境优先，空名安全', () => {
  process.env.SM_READ_KEY = 'v1'
  assert.equal(readEnv('SM_READ_KEY'), 'v1')
  assert.equal(readEnv(''), '')
  delete process.env.SM_READ_KEY
})

test('readEnv：Windows 上能从用户级环境变量兜底读到大盘键名（不校验值）', () => {
  // 该用例只验证"不抛错且返回字符串"，具体有没有值取决于机器
  const v = readEnv('DASHSCOPE_API_KEY', { fresh: true })
  assert.equal(typeof v, 'string')
})
