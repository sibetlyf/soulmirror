import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 密钥存储接线：走 DSH 凭据服务，配置里只留名字。
 *
 * 对应 DSH 官方的做法（已在其源码与 .credentials.yaml 上核对）：
 *   refs（按环境变量名）+ records（<owner>/<id>），配置只写名字，
 *   界面 describe 只报状态不返回值。
 */

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

test('启动时建立密钥存储，并优先取 DSH 凭据服务', () => {
  const at = src.indexOf('密钥存储：优先 DSH 凭据服务')
  assert.ok(at > 0, '找不到密钥存储建立点')
  const seg = src.slice(at, at + 700)
  assert.match(seg, /ctx\.get\?\.\('credentials'\)/, '应尝试取 credentials 服务')
  assert.match(seg, /createKeyStore\(\{ credentials: credentialsService/, '应交给桥处理')
})

test('所有密钥读取点都经过 keyFor（先安全存储，再旧字段）', () => {
  const hits = src.match(/resolveDashScopeKey\(\{\s*\.\.\.cfg\.(asr|tts),\s*apiKey: keyFor\(/g) || []
  assert.ok(hits.length >= 8, '应有足够多的读取点走 keyFor，实际 ' + hits.length)
  // 不该再有裸的 resolveDashScopeKey(cfg.asr) / (cfg.tts)
  assert.equal(/resolveDashScopeKey\(cfg\.(asr|tts)\)/.test(src), false, '不该有绕过缓存的老写法')
})

test('保存密钥写进安全存储，并清掉配置里的明文', () => {
  const at = src.indexOf("if (action === 'key') {")
  const seg = src.slice(at, at + 1400)
  assert.match(seg, /keyStore\.set\('asr', value\)/, '应写入安全存储')
  assert.match(seg, /loadKeysIntoCache\(\)/, '写后应刷新缓存')
  assert.match(seg, /cfg\.asr\.apiKey = ''/, '应清掉内存明文')
  assert.match(seg, /stored\.asr\.apiKey = ''/, '应清掉待写明文')
  assert.match(seg, /keyStorage: wr\.mode/, '应回报实际存储位置')
})

test('启动迁移：把旧明文搬走并从配置删除', () => {
  const at = src.indexOf('const initKeys = async () => {')
  assert.ok(at > 0, '找不到初始化迁移')
  const seg = src.slice(at, at + 1200)
  assert.match(seg, /pickLegacyKeys\(cfg\)/, '应挑出旧明文')
  assert.match(seg, /keyStore\.migrate\(legacy\)/, '应迁移')
  assert.match(seg, /stored\[slot\]\.apiKey = ''/, '迁移后应从配置抹掉')
  assert.match(seg, /await loadKeysIntoCache\(\)/, '迁移后刷新缓存')
})

test('/status 暴露密钥存储位置与各槽位是否已配置（不含值）', () => {
  const at = src.indexOf('keyStorage: keyStore.mode')
  assert.ok(at > 0, '找不到 keyStorage 字段')
  const seg = src.slice(at, at + 400)
  assert.match(seg, /keyStoragePath/, '应给出存储路径')
  assert.match(seg, /keys: \{ asr: !!keyCache\.asr/, '应给出是否已配置（布尔）')
  assert.equal(/apiKey: keyCache/.test(seg), false, '状态里不得回显密钥')
})

test('凭据服务出错时直接报错，不回退到插件文件', () => {
  const at = src.indexOf('const keyErrors = ')
  assert.ok(at > 0, '应有 keyErrors 记录')
  const seg = src.slice(at, at + 1000)
  assert.match(seg, /source === 'error'/, '应识别 error 来源')
  assert.match(seg, /logger\?\.warn\?\./, '读失败要写日志，不静默')
  // 桥里不许出现"写入失败就回退文件"
  const bridge = readFileSync(new URL('../lib/credentials-bridge.js', import.meta.url), 'utf8')
  const setAt = bridge.indexOf('async set(slot, value) {')
  const setSeg = bridge.slice(setAt, setAt + 2200)
  assert.match(setSeg, /return \{ ok: false, mode: 'dsh-credentials', error: msg \}/, '失败应直接返回错误')
})

test('/status 暴露 keyErrors（不隐藏失败原因）', () => {
  assert.match(src, /keyErrors: \{ \.\.\.keyErrors \}/, '状态里应带错误原因')
  assert.equal(/apiKey: keyErrors/.test(src), false, '不得回显密钥')
})

test('缺 Key 的提示区分：未配置 vs 读取失败', () => {
  assert.match(src, /function keyProblem\(slot\)/, '应有统一的原因说明')
  assert.match(src, /密钥读取失败（/, '读失败要说明是读失败')
  assert.match(src, /缺少语音识别密钥（未配置）/, '未配置要说明是没配')
})
