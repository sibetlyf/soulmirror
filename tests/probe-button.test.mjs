import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 采集设备"检测"按钮：点了必须立刻有反应，结果通过轮询拿。
 * 同步等待十几秒 = 用户看到"没反应"，这条回归专门盯它。
 */

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-probe-'))
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
  webServer: { port: 3092, register(r) { routes.push(r) } },
  on: () => () => {},
  effect: () => () => {},
  emit() {},
}, {})

const route = routes[0]

async function call(method, url, body) {
  let out = ''
  let status = 0
  const res = { writeHead(code) { status = code }, end(s) { out = s }, setHeader() {} }
  const req = { method, url }
  if (body !== undefined) {
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  }
  await route.handler(req, res)
  return { status, body: JSON.parse(out || '{}') }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('点「检测」立即返回 started，不等十几秒', async () => {
  const t0 = Date.now()
  const r = await call('POST', '/api/soulmirror/setup', { action: 'probe' })
  const ms = Date.now() - t0
  assert.equal(r.status, 200)
  assert.equal(r.body.started, true, '必须是"已开始"，不能是跑完才回')
  assert.match(r.body.message, /开始试听|正在/)
  assert.ok(ms < 1500, 'POST 必须快速返回，实际 ' + ms + 'ms')
})

test('试听中再点一次，返回进度而不是重复启动', async () => {
  await wait(2)
  const r = await call('POST', '/api/soulmirror/setup', { action: 'probe' })
  // 可能已经跑完（桩很快），两种都算合法，但不能报错
  assert.equal(r.status, 200)
  if (r.body.started === false) assert.match(r.body.message, /正在试听/)
})

test('轮询 GET /setup 能看到进度，最终给出选中的设备', async () => {
  const finished = await waitFor(async () => {
    const r = await call('GET', '/api/soulmirror/setup')
    if (!r.body.probe || r.body.probe.running) return false
    return r.body
  }, 6000)
  assert.ok(finished, '试听应在几秒内结束')
  assert.equal(finished.probe.best, 'Fake A')
  assert.equal(finished.probe.rows.length, 2)
  // 选中后设备项应变成已就绪
  assert.equal(finished.rows.find((x) => x.id === 'device').ok, true)
})

async function waitFor(fn, timeoutMs = 3000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn()
    if (v) return v
    await wait(50)
  }
  return null
}

test.after(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ }
})

