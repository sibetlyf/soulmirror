import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 模式与发言开关必须永远一致。
 *
 * 真实事故：小窗点「Agent」（写的是 cfg.mode），而发言链路读的是 cfg.reply.enabled，
 * 结果界面显示 Agent、后端认为发言关闭，叫了也不动。
 */
const fakeHome = mkdtempSync(join(tmpdir(), 'sm-mode-'))
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
  webServer: { port: 3087, register(r) { routes.push(r) } },
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

test('切到 Agent 模式，发言开关必须同时打开', async () => {
  const r = await call('POST', '/api/soulmirror/mode', { mode: 'agent' })
  assert.equal(r.status, 200)
  assert.equal(r.body.mode, 'agent')

  const cfg = await call('GET', '/api/soulmirror/config')
  assert.equal(cfg.body.reply.enabled, true, '界面显示 Agent，后端就必须允许发言')
})

test('切回只转录，发言开关必须关闭', async () => {
  await call('POST', '/api/soulmirror/mode', { mode: 'transcribe' })
  const cfg = await call('GET', '/api/soulmirror/config')
  assert.equal(cfg.body.reply.enabled, false)
})

test('直接开关发言，mode 也要跟着变', async () => {
  await call('POST', '/api/soulmirror/reply', { enabled: true })
  const st = await call('GET', '/api/soulmirror/status')
  assert.equal(st.body.mode, 'agent', '开了发言，模式就该是 agent')
  await call('POST', '/api/soulmirror/reply', { enabled: false })
  const st2 = await call('GET', '/api/soulmirror/status')
  assert.equal(st2.body.mode, 'transcribe')
})

test.after(() => { try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ } })
