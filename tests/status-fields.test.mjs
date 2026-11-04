import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * "为什么没声音"必须能从 /status 看出来。
 *
 * 真实场景：agent 生成了 speak:true 的文本，但 autoSpeak 关着，
 * 于是既不说话也没有任何提示，用户只能疑惑"为什么没声音"。
 */
const fakeHome = mkdtempSync(join(tmpdir(), 'sm-status-'))
process.env.SOULMIRROR_TEST = '1'
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const mod = await import('../index.js')
const plugin = mod.default || mod
const routes = []
plugin.apply({
  tools: { register() {} },
  logger: { info() {}, warn() {}, error() {} },
  get: () => undefined,
  webServer: { port: 3088, register(r) { routes.push(r) } },
  on: () => () => {},
  effect: () => () => {},
  emit() {},
}, {})
const route = routes[0]

async function call(method, url, body) {
  let out = ''
  let status = 0
  const res = { writeHead(c) { status = c }, end(s) { out = s }, setHeader() {} }
  const req = { method, url }
  if (body !== undefined) {
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  }
  await route.handler(req, res)
  return { status, body: JSON.parse(out || '{}') }
}

test('/status 必须暴露两个开关与发言失败原因', async () => {
  const r = await call('GET', '/api/soulmirror/status')
  assert.equal(r.status, 200)
  for (const key of ['advice', 'reply', 'replyState', 'adviceState', 'lastSpeakError', 'lastLlmError', 'brainModel']) {
    assert.ok(key in r.body, '/status 缺少字段 ' + key)
  }
  assert.equal(typeof r.body.reply.autoSpeak, 'boolean', 'autoSpeak 要能被界面读到')
})

test('对话内容为空时发言失败要记进 lastSpeakError', async () => {
  const r = await call('POST', '/api/soulmirror/reply', { speak: '   ' })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, false)
  const st = await call('GET', '/api/soulmirror/status')
  // 空白内容会走到「没有内容可说」这条提前返回，也必须留下原因
  assert.equal(r.body.ok, false)
  assert.ok(st.body.lastSpeakError && st.body.lastSpeakError.message, '空白内容也要留下原因')
  assert.match(st.body.lastSpeakError.message, /没有内容/)
})


test('Agent 默认全自动开口：autoSpeak 默认 true', async () => {
  const cfg = await call('GET', '/api/soulmirror/config')
  assert.equal(cfg.body.reply.autoSpeak, true, 'Agent 不应该需要手动点才说话')
  assert.equal(cfg.body.reply.candidates, 1, '直接开口时给一条候选就够')
  assert.equal(cfg.body.advice.enabled, true, '建议卡片是默认开的（给用户看）')
})
test.after(() => { try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ } })
