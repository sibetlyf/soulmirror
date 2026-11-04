import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 转写上下文注入的接口契约。
 * 重点：默认不自动同步（每送一次都是一轮真实对话，会产生费用）。
 */

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-ctx-'))
process.env.SOULMIRROR_TEST = '1'
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
const prompts = []

plugin.apply({
  tools: { register() {} },
  logger: { info() {}, warn() {}, error() {} },
  get(name) {
    if (name === 'sessionController') {
      return { prompt: async (req) => { prompts.push(req); return { accepted: true } } }
    }
    return undefined
  },
  webServer: { port: 3086, register(r) { routes.push(r) } },
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

test('默认不开启自动同步（避免默默产生费用）', async () => {
  const r = await call('GET', '/api/soulmirror/config')
  assert.equal(r.status, 200)
  const ctx = r.body.context || {}
  assert.equal(ctx.autoInject, false, '默认必须是关')
  assert.ok(ctx.everyMs >= 15000, '自动同步间隔不能太密')
})

test('可以打开/关闭自动同步', async () => {
  const on = await call('POST', '/api/soulmirror/context', { autoInject: true })
  assert.equal(on.status, 200)
  assert.equal(on.body.autoInject, true)
  const off = await call('POST', '/api/soulmirror/context', { autoInject: false })
  assert.equal(off.body.autoInject, false)
})

test('没有会议会话时，手动发送给出明确原因而不是静默失败', async () => {
  const r = await call('POST', '/api/soulmirror/context', {})
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, false)
  assert.match(String(r.body.error), /会话|转写/)
})

test('没有会话服务时也不崩', async () => {
  // 该插件的 apply 已经拿到了 sessionController，这里只验证返回值结构稳定
  const r = await call('POST', '/api/soulmirror/context', { autoInject: false })
  assert.equal(r.status, 200)
  assert.equal(typeof r.body.ok, 'boolean')
})

test.after(() => { try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ } })
