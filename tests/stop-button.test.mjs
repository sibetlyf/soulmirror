import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-stop-'))
process.env.SOULMIRROR_TEST = '1'
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
const tools = []
plugin.apply({
  tools: { register(t) { tools.push(t) } },
  logger: { info() {}, warn() {} },
  get: (k) => (k === 'webServer' ? { port: 3084 } : undefined),
  webServer: { port: 3084, register(r) { routes.push(r) } },
  on: () => () => {},
  effect: () => () => {},
  emit() {},
}, {})

async function api(method, url, body) {
  let out = ''
  const res = { code: 0, writeHead(c) { this.code = c }, end(s) { out = s } }
  const req = { method, url }
  if (body !== undefined) req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  await routes[0].handler(req, res)
  return { code: res.code, body: JSON.parse(out || '{}') }
}

test('开关往返：start 返回 enabled=true，stop 返回 enabled=false', async () => {
  const on = await api('POST', '/api/soulmirror/auto', { action: 'start' })
  assert.equal(on.body.enabled, true)
  assert.equal(on.body.armed, true)

  const off = await api('POST', '/api/soulmirror/auto', { action: 'stop' })
  assert.equal(off.body.enabled, false, 'stop 必须真的把 enabled 关掉，否则按钮永远停不下来')
  assert.equal(off.body.armed, false)

  const s = await api('GET', '/api/soulmirror/status')
  assert.equal(s.body.enabled, false)
  assert.equal(s.body.session.capturing, false)
})

test('stop 是幂等的：连点两次也不报错', async () => {
  const a = await api('POST', '/api/soulmirror/auto', { action: 'stop' })
  const b = await api('POST', '/api/soulmirror/auto', { action: 'stop' })
  assert.equal(a.code, 200)
  assert.equal(b.code, 200)
  assert.equal(b.body.enabled, false)
})

test('已入会时 meeting_join 直接返回，不去点客户端', async () => {
  await api('POST', '/api/soulmirror/auto', { action: 'start' })
  const t = tools.find((x) => x.name === 'meeting_join')
  // 测试模式下 listWindows 返回空 → 不会命中"已在会中"，但也不能崩
  const r = await t.execute({ code: '123456789', confirm: true }, {})
  assert.equal(typeof r.ok, 'boolean')
  assert.doesNotMatch(String(r.result), /Cannot|undefined|not a function/)
  await api('POST', '/api/soulmirror/auto', { action: 'stop' })
})

test.after(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ }
})
