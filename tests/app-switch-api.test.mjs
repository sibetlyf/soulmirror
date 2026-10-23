import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-appapi-'))
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const mod = await import('../index.js')
const plugin = mod.default || mod

let routes = []
let tools = []
const ctx = {
  tools: { register(t) { tools.push(t) } },
  logger: { info() {}, warn() {} },
  get: (k) => (k === 'webServer' ? { port: 3096 } : undefined),
  webServer: { port: 3096, register(r) { routes.push(r) } },
  on: () => () => {},
  effect: () => () => {},
  emit() {},
}
plugin.apply(ctx, {})

async function api(method, url, body) {
  let out = ''
  const res = { code: 0, writeHead(c) { this.code = c }, end(s) { out = s } }
  const req = { method, url }
  if (body !== undefined) req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  await routes[0].handler(req, res)
  return { code: res.code, body: JSON.parse(out || '{}') }
}

test('status 带回会议软件列表与自动跟随状态', async () => {
  const r = await api('GET', '/api/soulmirror/status')
  assert.equal(r.code, 200)
  assert.ok(Array.isArray(r.body.apps))
  assert.ok(r.body.apps.length >= 2)
  assert.equal(typeof r.body.autoAppSelect, 'boolean')
  assert.ok('activeApp' in r.body)
})

test('POST /app 切到指定软件并关闭自动跟随', async () => {
  const r = await api('POST', '/api/soulmirror/app', { name: '移动会议' })
  assert.equal(r.code, 200)
  assert.equal(r.body.activeApp, '移动会议')
  const s = await api('GET', '/api/soulmirror/status')
  assert.equal(s.body.activeApp, '移动会议')
  assert.equal(s.body.autoAppSelect, false)
  const hit = s.body.apps.find((a) => a.name === '移动会议')
  assert.equal(hit.active, true)
})

test('POST /app 空串恢复自动跟随', async () => {
  const r = await api('POST', '/api/soulmirror/app', { name: '' })
  assert.equal(r.code, 200)
  assert.equal(r.body.activeApp, '')
  assert.equal(r.body.autoAppSelect, true)
})

test('POST /app 未知软件返回 400', async () => {
  const r = await api('POST', '/api/soulmirror/app', { name: '不存在的会议' })
  assert.equal(r.code, 400)
  assert.match(r.body.error, /未知会议软件/)
})

test('POST /app 可以直接切到内置预设（飞书会议会自动补进 apps）', async () => {
  const r = await api('POST', '/api/soulmirror/app', { name: '飞书会议' })
  assert.equal(r.code, 200)
  assert.equal(r.body.activeApp, '飞书会议')
  const s = await api('GET', '/api/soulmirror/status')
  assert.ok(s.body.apps.some((a) => a.name === '飞书会议'))
})

test.after(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ }
})
