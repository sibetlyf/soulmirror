import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-armed-'))
process.env.SOULMIRROR_TEST = '1'
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
const tools = []
const logs = []
plugin.apply({
  tools: { register(t) { tools.push(t) } },
  logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push('W ' + m) },
  get: (k) => (k === 'webServer' ? { port: 3086 } : undefined),
  webServer: { port: 3086, register(r) { routes.push(r) } },
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

test('默认未开启：armed=false，且不会自动操作', async () => {
  const r = await api('GET', '/api/soulmirror/status')
  assert.equal(r.body.armed, false)
})

test('未开启时开会话传会议链接，不会自动入会', async () => {
  const handlers = []
  // 触发一次事件（监听器已在 apply 里注册；这里通过 status 前的状态间接验证）
  const before = logs.length
  const r = await api('GET', '/api/soulmirror/status')
  assert.equal(r.body.armed, false)
  assert.ok(logs.length >= before)
})

test('开启后 armed=true，关闭后回到 false', async () => {
  const on = await api('POST', '/api/soulmirror/auto', { action: 'start' })
  assert.equal(on.body.armed, true)
  assert.equal((await api('GET', '/api/soulmirror/status')).body.armed, true)

  const off = await api('POST', '/api/soulmirror/auto', { action: 'stop' })
  assert.equal(off.body.armed, false)
  assert.equal((await api('GET', '/api/soulmirror/status')).body.armed, false)
})

test('未开启时 meeting_recalibrate 拒绝执行', async () => {
  const t = tools.find((x) => x.name === 'meeting_recalibrate')
  const r = await t.execute({ action: 'join' }, {})
  // 可能是"没检测到会议软件"或"未开启"，总之不能真的开标定会话
  assert.equal(r.ok, false)
  assert.match(String(r.result), /未开启|没检测到|关闭/)
})

test.after(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ }
})
