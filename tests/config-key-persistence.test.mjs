import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureConfigFile, mergeDefaults, stripSecrets } from '../lib/bootstrap.js'

/**
 * 语音 Key 跨运行丢失的回归。
 *
 * 真实故障链（已修）：
 *   1. 用户保存 Key → savePersisted 直接写 config.json（写进去了）
 *   2. 下次启动 → loadPersisted 读到了 → cfg 里有 Key
 *   3. 紧接着 ensureConfigFile(CONFIG_FILE, cfg) 发现"缺了新默认键" → 合并回写
 *   4. 回写时调用了 stripSecrets() → **apikey 被删**
 *   5. 于是下一轮启动文件里已是空 → 用户看到"每次都保存不上"
 *
 * 独立环境更容易命中：每次启动都可能补齐新键（不同版本/不同 profile）。
 */

const dir = () => mkdtempSync(join(tmpdir(), 'sm-keyfix-'))
const defaults = (extra = {}) => ({
  asr: { provider: 'dashscope', apiKey: '', apiKeyEnv: 'DASHSCOPE_API_KEY' },
  tts: { apiKey: '' },
  ...extra,
})

test('合并回写必须保留磁盘上已有的密钥', () => {
  const d = dir()
  try {
    const file = join(d, 'config.json')
    // 已有配置（用户保存过 Key）
    writeFileSync(file, JSON.stringify({
      asr: { apiKey: 'sk-asr-1', apiKeyEnv: 'DASHSCOPE_API_KEY' },
      tts: { apiKey: 'sk-tts-1' },
    }), 'utf8')

    // 新版带来新键 → 触发回写
    const r = ensureConfigFile(file, defaults({ brain: { minGapMs: 3000 } }))
    assert.equal(r.merged, true, '应补齐新键')

    const j = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(j.asr.apiKey, 'sk-asr-1', 'ASR Key 不能丢')
    assert.equal(j.tts.apiKey, 'sk-tts-1', 'TTS Key 不能丢')
    assert.ok(j.brain, '新键应补上')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('apiKeyEnv 不是密钥，不该被删', () => {
  const d = dir()
  try {
    const file = join(d, 'config.json')
    writeFileSync(file, JSON.stringify({ asr: { apiKeyEnv: 'MY_CUSTOM_KEY_NAME' } }), 'utf8')
    ensureConfigFile(file, defaults({ extraKey: 1 }))
    const j = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(j.asr.apiKeyEnv, 'MY_CUSTOM_KEY_NAME', '环境变量名是普通配置')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('首次新建文件时不写入密钥（默认值里本来也没有）', () => {
  const d = dir()
  try {
    const file = join(d, 'config.json')
    const r = ensureConfigFile(file, defaults())
    assert.equal(r.created, true)
    const j = JSON.parse(readFileSync(file, 'utf8'))
    assert.equal(j.asr.apiKey, undefined, '空 Key 不该落盘占位')
    assert.equal(j.asr.apiKeyEnv, 'DASHSCOPE_API_KEY', '非密钥配置应保留')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('连续两次启动：第一次补键后，第二次不再改文件', () => {
  const d = dir()
  try {
    const file = join(d, 'config.json')
    writeFileSync(file, JSON.stringify({ asr: { apiKey: 'sk-1' } }), 'utf8')
    ensureConfigFile(file, defaults({ a: 1 }))
    const first = readFileSync(file, 'utf8')
    const r2 = ensureConfigFile(file, defaults({ a: 1 }))
    assert.equal(r2.merged, false, '已补齐就不该再写')
    assert.equal(readFileSync(file, 'utf8'), first, '文件内容应稳定')
  } finally { rmSync(d, { recursive: true, force: true }) }
})

test('mergeDefaults：磁盘值优先，缺失才用默认（不覆盖用户设置）', () => {
  const merged = mergeDefaults(
    { asr: { provider: 'dashscope', apiKey: '', model: 'x' }, enabled: true },
    { asr: { provider: 'local', apiKey: 'sk-keep' }, enabled: false },
  )
  assert.equal(merged.asr.provider, 'local')
  assert.equal(merged.asr.apiKey, 'sk-keep')
  assert.equal(merged.asr.model, 'x', '缺失项应补默认')
  assert.equal(merged.enabled, false)
})

test('stripSecrets 仍能拦住真正的密钥（新建路径仍在用）', () => {
  const out = stripSecrets({ asr: { apiKey: 'sk-x', apiKeyEnv: 'E' }, token: 't', password: 'p' })
  assert.equal(out.asr.apiKey, undefined)
  assert.equal(out.asr.apiKeyEnv, 'E', '环境变量名应保留')
  assert.equal(out.token, undefined)
  assert.equal(out.password, undefined)
})

test('接线：/status 暴露配置落点与"磁盘上有没有 Key"（不含密钥）', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const at = src.indexOf('配置落点自查')
  assert.ok(at > 0, '找不到配置自查字段')
  const seg = src.slice(at, at + 900)
  assert.match(seg, /file: CONFIG_FILE/, '应给出写到哪里')
  assert.match(seg, /diskHasKey/, '应给出磁盘上有没有 Key（布尔）')
  assert.match(seg, /runtimeSource/, '应给出运行时 Key 来源')
  assert.equal(/apiKey:\s*(cfg|j)\./.test(seg), false, '不得把密钥原文暴露到状态里')
})

test('接线：SOULMIRROR_HOME 可把配置钉在固定目录（独立环境）', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const at = src.indexOf('SOULMIRROR_HOME')
  assert.ok(at > 0, '应支持 SOULMIRROR_HOME 覆盖')
  const seg = src.slice(at, at + 300)
  assert.match(seg, /pinned/, '应优先使用它')
})
