import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MeetingSession } from '../lib/session.js'

/**
 * 故障：界面同时显示「采集链路就绪」与「上次采集错误：缺少密钥」。
 * 根因：体检用 keyFor()（凭据库 → 统一 Key → 配置），采集只看 cfg.asr.apiKey + 环境变量。
 * 用户在设置页填的 Key 存进了凭据库，体检看得到，采集看不到。
 */

const ENV = 'SOULMIRROR_TEST_NO_SUCH_KEY_ENV'
const baseCfg = () => ({
  asr: { provider: 'dashscope', apiKeyEnv: ENV, apiKey: '' },
  devices: { capture: '' },
  dataDir: '',
})

test('采集取 Key 与体检同源：注入的 getKey 优先', () => {
  delete process.env[ENV]
  const s = new MeetingSession(baseCfg(), null, { getKey: () => 'sk-from-credentials' })
  assert.equal(s.resolveAsrKey(), 'sk-from-credentials')
})

test('没有任何 Key 时 startCapture 同步失败并给出原因，不再假装在采集', async () => {
  // 本机可能真有 DASHSCOPE_API_KEY（用户级环境变量），这里把解析结果固定为"没有"
  const s = new MeetingSession(baseCfg(), null, { getKey: () => '' })
  s.resolveAsrKey = () => ''
  const r = await s.startCapture('test')
  assert.equal(r.ok, false)
  assert.match(r.error, /百炼 Key/)
  assert.equal(s.capturing, false, '失败时不能把 capturing 置为 true')
  assert.match(s.lastError, /设置 → 会议助手/)
})

test('宿主把 keyFor 注入 MeetingSession', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.match(src, /new MeetingSession\(cfg, logger, \{ getKey: \(\) => keyFor\(cfg\.asr, 'asr'\) \}\)/)
})

test('session 的流式循环不再单独解析 Key', () => {
  const src = readFileSync(new URL('../lib/session.js', import.meta.url), 'utf8')
  assert.equal(/resolveDashScopeKey\(\{ apiKey: asrCfg\.apiKey, apiKeyEnv: asrCfg\.apiKeyEnv \}\)/.test(src), false)
  assert.match(src, /const key = this\.resolveAsrKey\(\)/)
})

test('宿主过期检测按请求实时计算，而不是只在加载时算一次', () => {
  const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  assert.equal(/HOST_STALE/.test(src), false, '不应再有加载时固定的 HOST_STALE')
  assert.match(src, /function hostState\(\)/)
  assert.match(src, /host: hostState\(\)/)
})
