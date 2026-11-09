import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createKeyStore, pickLegacyKeys, fileStorePath, SLOTS } from '../lib/credentials-bridge.js'

/**
 * 密钥存储桥：优先 DSH 凭据服务，没有才回退插件文件。
 *
 * 动机（对比 DSH 官方做法）：官方把机密放在 <DSH_HOME>/.credentials.yaml，
 * 配置里只写名字，界面只报状态不返回值。我们原来把明文塞在 config.json 里，
 * 和设置同一个文件、可同步可备份，还出过"启动补齐被 strip 掉"的事故。
 */

const dir = () => mkdtempSync(join(tmpdir(), 'sm-cred-'))

/** 假的 ctx.credentials：记录调用，模拟 DSH 的两套空间 */
function fakeService() {
  const records = new Map()
  const refs = new Map()
  const calls = []
  return {
    calls,
    records,
    refs,
    async modifyRecord(key, fn) {
      calls.push('modifyRecord:' + key)
      const next = await fn(records.get(key))
      records.set(key, next)
      return next
    },
    async readRecord(key) { return records.get(key) },
    async deleteRecord(key) { records.delete(key) },
    async describeRecord(key) { return { configured: records.has(key) } },
    async resolve(ref) { return refs.has(ref) ? { value: refs.get(ref), source: 'managed' } : undefined },
    async set(ref, v) { refs.set(ref, v) },
    async unset(ref) { refs.delete(ref) },
  }
}

test('有 DSH 凭据服务时：写进 records，不落插件文件', async () => {
  const d = dir()
  try {
    const svc = fakeService()
    const store = createKeyStore({ credentials: svc, configDir: d })
    assert.equal(store.mode, 'dsh-credentials')

    const r = await store.set('asr', 'sk-asr-1')
    assert.equal(r.ok, true)
    assert.equal(svc.records.get('soulmirror/asr').payload.token, 'sk-asr-1')
    assert.equal(existsSync(fileStorePath(d)), false, '不该同时写插件文件')

    const got = await store.get('asr')
    assert.equal(got.value, 'sk-asr-1')
    assert.match(got.source, /dsh-credentials/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('没有凭据服务时：回退插件文件，且只属主可读', async () => {
  const d = dir()
  try {
    const store = createKeyStore({ credentials: null, configDir: d })
    assert.equal(store.mode, 'plugin-file')

    const r = await store.set('tts', 'sk-tts-1')
    assert.equal(r.ok, true)
    const file = fileStorePath(d)
    assert.ok(existsSync(file), '应写入 credentials.json')
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).tts, 'sk-tts-1')

    const got = await store.get('tts')
    assert.equal(got.value, 'sk-tts-1')
    assert.equal(got.source, 'plugin-file')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('describe 只报状态不返回值', async () => {
  const d = dir()
  try {
    const store = createKeyStore({ credentials: null, configDir: d })
    assert.equal((await store.describe('asr')).configured, false)
    await store.set('asr', 'sk-x')
    const desc = await store.describe('asr')
    assert.equal(desc.configured, true)
    assert.equal(JSON.stringify(desc).includes('sk-x'), false, '状态里不能带出密钥')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('空字符串等于清除（两套存储都要支持）', async () => {
  const d = dir()
  try {
    const svc = fakeService()
    const a = createKeyStore({ credentials: svc, configDir: d })
    await a.set('brain', 'sk-brain')
    assert.equal((await a.get('brain')).value, 'sk-brain')
    await a.clear('brain')
    assert.equal((await a.get('brain')).value, '')

    const b = createKeyStore({ credentials: null, configDir: d })
    await b.set('brain', 'sk-brain2')
    await b.set('brain', '')
    assert.equal((await b.get('brain')).value, '')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('DSH 里按命名引用存过的值也能读到（resolve 兜底）', async () => {
  const d = dir()
  try {
    const svc = fakeService()
    svc.refs.set('SOULMIRROR_ASR_KEY', 'sk-from-ref')
    const store = createKeyStore({ credentials: svc, configDir: d })
    const got = await store.get('asr')
    assert.equal(got.value, 'sk-from-ref')
    assert.match(got.source, /ref:SOULMIRROR_ASR_KEY/)
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('服务写入抛错时回退文件（不让 Key 无处可去）', async () => {
  const d = dir()
  try {
    const svc = fakeService()
    svc.modifyRecord = async () => { throw new Error('宿主拒绝写入') }
    const store = createKeyStore({ credentials: svc, configDir: d })
    const r = await store.set('asr', 'sk-fallback')
    assert.equal(r.ok, true)
    assert.equal(r.mode, 'plugin-file', '应回退到文件')
    assert.equal(JSON.parse(readFileSync(fileStorePath(d), 'utf8')).asr, 'sk-fallback')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('迁移：config.json 里的明文搬到安全存储，且不覆盖已有值', async () => {
  const d = dir()
  try {
    const svc = fakeService()
    const store = createKeyStore({ credentials: svc, configDir: d })
    await store.set('tts', 'sk-tts-new')     // 用户已经在新位置存过

    const legacy = { asr: 'sk-asr-old', tts: 'sk-tts-old', brain: '' }
    const r = await store.migrate(legacy)
    assert.deepEqual(r.failed, [])
    assert.ok(r.migrated.some((x) => x.startsWith('asr')), '空槽应迁移')
    assert.ok(r.migrated.some((x) => x.includes('已存在')), '已有值应跳过')

    assert.equal((await store.get('asr')).value, 'sk-asr-old')
    assert.equal((await store.get('tts')).value, 'sk-tts-new', '不该被旧值覆盖')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('pickLegacyKeys 只挑三个槽位，不误伤别的设置', () => {
  const keys = pickLegacyKeys({
    asr: { apiKey: 'a', provider: 'dashscope' },
    tts: { apiKey: 't' },
    brain: {},
    enabled: true,
  })
  assert.deepEqual(keys, { asr: 'a', tts: 't', brain: '' })
})

test('槽位定义稳定（ref 名可被 DSH 界面复用）', () => {
  assert.equal(SLOTS.asr.ref, 'SOULMIRROR_ASR_KEY')
  assert.equal(SLOTS.tts.ref, 'SOULMIRROR_TTS_KEY')
  assert.equal(SLOTS.brain.ref, 'SOULMIRROR_BRAIN_KEY')
})

test('文件损坏时不崩，按"没有密钥"处理', async () => {
  const d = dir()
  try {
    writeFileSync(fileStorePath(d), '{ 坏掉的 json', 'utf8')
    const store = createKeyStore({ credentials: null, configDir: d })
    assert.equal((await store.get('asr')).value, '')
    assert.equal((await store.describe('asr')).configured, false)
  } finally { rmSync(d, { recursive: true, force: true }) }
})
