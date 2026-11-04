import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 会前准备 / 回看 的接口契约。
 * 参考原项目工作流：准备（会邀+目标+润色）→ 录音 → 结束 → 回看。
 */

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-prep-'))
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
  webServer: { port: 3085, register(r) { routes.push(r) } },
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

test('GET /prepare 在没有会议目录时返回空准备信息', async () => {
  const r = await call('GET', '/api/soulmirror/prepare')
  assert.equal(r.status, 200)
  assert.equal(r.body.goal, '')
  assert.equal(r.body.invite, '')
})

test('POST /prepare 没有会议目录时明确拒绝，而不是静默丢失', async () => {
  const r = await call('POST', '/api/soulmirror/prepare', { goal: 'x' })
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, false)
  assert.match(r.body.error, /开始一次录音/)
})

test('POST /polish 空目标返回 400', async () => {
  const r = await call('POST', '/api/soulmirror/polish', { goal: '   ' })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /目标/)
})

test('GET /records 返回列表结构（空也可以）', async () => {
  const r = await call('GET', '/api/soulmirror/records')
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.ok(Array.isArray(r.body.records))
})

test('GET /record 拒绝越权目录', async () => {
  const r = await call('GET', '/api/soulmirror/record?dir=C:/Windows')
  assert.equal(r.status, 400)
  assert.match(r.body.error, /不合法/)
})

test.after(() => { try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ } })
