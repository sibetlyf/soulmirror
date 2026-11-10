import { isolatePlugin, applyIsolated } from './helpers/isolated-plugin.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 「采集设备」按钮的契约：
 *   默认 = 对齐会议正在用的设备（秒级，不需要先出声）
 *   deep = 逐个设备试听（慢，返回 started 后轮询）
 */

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-probe-'))
isolatePlugin(fakeHome)

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
applyIsolated(plugin, {
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

test('点「检测」直接对齐设备：秒级、不用先出声', async () => {
  const t0 = Date.now()
  const r = await call('POST', '/api/soulmirror/setup', { action: 'probe' })
  const ms = Date.now() - t0
  assert.equal(r.status, 200)
  assert.ok(r.body.picked, '应直接给出设备，而不是让用户等')
  assert.match(r.body.message, /已对齐/)
  assert.ok(ms < 3000, '默认对齐必须秒级返回，实际 ' + ms + 'ms')
})

test('对齐后设备项变成已就绪', async () => {
  const r = await call('GET', '/api/soulmirror/setup')
  assert.equal(r.body.rows.find((x) => x.id === 'device').ok, true, '对齐后设备项应就绪')
})

test('deep 模式才逐个试听：立即返回 started，再轮询结果', async () => {
  const r = await call('POST', '/api/soulmirror/setup', { action: 'probe', deep: true })
  assert.equal(r.body.started, true, 'deep 应返回"已开始"，不能同步跑完')

  const finished = await waitFor(async () => {
    const g = await call('GET', '/api/soulmirror/setup')
    if (!g.body.probe || g.body.probe.running) return false
    return g.body
  }, 6000)
  assert.ok(finished, '试听应在几秒内结束')
  assert.equal(finished.probe.rows.length, 2)
  assert.equal(finished.probe.best, 'Fake A')
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

// Environment, effects and temporary files are cleaned by isolatePlugin().
