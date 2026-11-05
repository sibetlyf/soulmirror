import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyProbeError, buildProbeReport } from '../lib/model-probe.js'

/**
 * 联通性测试的错误翻译。
 * 用户看到的必须是"我该做什么"，而不是 "ws handshake failed: HTTP/1.1 401 Unauthorized"。
 */

test('401 → Key 无效，并告诉去哪重新复制', () => {
  const c = classifyProbeError('ws handshake failed: HTTP/1.1 401 Unauthorized')
  assert.equal(c.kind, 'auth')
  assert.match(c.hint, /百炼控制台/)
  assert.equal(c.retryable, false)
})

test('403 → 无权限/被停用', () => {
  const c = classifyProbeError(new Error('403 Forbidden: model not authorized'))
  assert.equal(c.kind, 'forbidden')
  assert.match(c.hint, /开通|欠费|停用/)
})

test('404 → 模型名不对，给出默认名', () => {
  const c = classifyProbeError('404 model not found')
  assert.equal(c.kind, 'model')
  assert.match(c.hint, /paraformer-realtime-v2/)
  assert.match(c.hint, /cosyvoice-v2/)
})

test('429 → 限流，且可重试', () => {
  const c = classifyProbeError('429 Too Many Requests')
  assert.equal(c.kind, 'quota')
  assert.equal(c.retryable, true)
})

test('DNS/网络类 → 网络问题，提示代理与 443', () => {
  for (const msg of ['getaddrinfo ENOTFOUND dashscope.aliyuncs.com', 'connect ECONNREFUSED', 'read ECONNRESET']) {
    const c = classifyProbeError(msg)
    assert.equal(c.kind, 'network', msg)
    assert.match(c.hint, /443|代理/)
  }
})

test('超时单独成一类', () => {
  assert.equal(classifyProbeError('ws handshake timeout').kind, 'timeout')
})

test('没配 Key 时给出配置位置', () => {
  const c = classifyProbeError(new Error('缺少密钥：环境变量 DASHSCOPE_API_KEY 未设置'))
  assert.equal(c.kind, 'missing')
  assert.match(c.hint, /DASHSCOPE_API_KEY/)
})

test('无法归类的错误不吞掉原文', () => {
  const c = classifyProbeError('some weird internal failure')
  assert.equal(c.kind, 'unknown')
  assert.match(c.hint, /原始错误/)
})

test('报告：两个都通时 ok=true 且逐行列出', () => {
  const r = buildProbeReport({ asr: { ok: true, ms: 120 }, tts: { ok: true, ms: 300 } })
  assert.equal(r.ok, true)
  assert.match(r.text, /语音识别.*连通/)
  assert.match(r.text, /语音合成.*连通/)
  assert.match(r.text, /120ms/)
})

test('报告：有一个失败就 ok=false，并带上可操作提示与原错', () => {
  const r = buildProbeReport({
    asr: { ok: false, error: new Error('401 Unauthorized') },
    tts: { ok: true, ms: 88 },
  })
  assert.equal(r.ok, false)
  assert.match(r.text, /✅ 语音合成/)
  assert.match(r.text, /❌ 语音识别：Key 无效/)
  assert.match(r.text, /百炼控制台/)
  assert.match(r.text, /原始错误：401/)
})

test('报告：只测一个模型也能工作', () => {
  const r = buildProbeReport({ asr: { ok: true, ms: 50 } })
  assert.equal(r.ok, true)
  assert.match(r.text, /语音识别/)
  assert.equal(/语音合成/.test(r.text), false)
})
