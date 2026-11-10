import { isolatePlugin, applyIsolated } from './helpers/isolated-plugin.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-switch-'))
isolatePlugin(fakeHome)

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
const tools = []
applyIsolated(plugin, {
  tools: { register(t) { tools.push(t) } },
  logger: { info() {}, warn() {} },
  get: (k) => (k === 'webServer' ? { port: 3085 } : undefined),
  webServer: { port: 3085, register(r) { routes.push(r) } },
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

test('显式关闭配置：enabled=false', async () => {
  const r = await api('GET', '/api/soulmirror/status')
  assert.equal(r.body.enabled, false)
  assert.equal(r.body.armed, false)
})

test('关闭时：会动电脑/对外的工具被拦下', async () => {
  for (const name of ['meeting_join', 'meeting_calibrate', 'meeting_agent_start', 'soul_say']) {
    const t = tools.find((x) => x.name === name)
    const r = await t.execute(name === 'meeting_join' ? { code: '123456789', confirm: true } : { text: '测试' }, {})
    assert.equal(r.ok, false, name + ' 应被拦下')
    assert.match(String(r.result), /未开启|拦住|拦下/, name + ' 提示不对：' + r.result)
  }
})

test('只读类工具在关闭时仍可用（状态/软件列表）', { skip: process.env.SOULMIRROR_INTEGRATION !== '1' && 'Requires explicit SOULMIRROR_INTEGRATION=1: desktop/audio/device integration; not part of safe default suite' }, async () => {
  for (const name of ['meeting_status', 'meeting_apps']) {
    const t = tools.find((x) => x.name === name)
    const r = await t.execute({}, {})
    assert.equal(typeof r.ok, 'boolean')
  }
})

test('打开开关：enabled/armed 变 true，工具放行', { skip: process.env.SOULMIRROR_INTEGRATION !== '1' && 'Requires explicit SOULMIRROR_INTEGRATION=1: desktop/audio/device integration; not part of safe default suite' }, async () => {
  const on = await api('POST', '/api/soulmirror/auto', { action: 'start' })
  assert.equal(on.body.ok, true)
  assert.equal(on.body.enabled, true)
  assert.equal(on.body.armed, true)

  const s = await api('GET', '/api/soulmirror/status')
  assert.equal(s.body.enabled, true)

  const t = tools.find((x) => x.name === 'meeting_calibrate')
  const r = await t.execute({ action: 'join' }, {})
  // 已经放行，只是环境里没客户端/没会话服务
  assert.doesNotMatch(String(r.result), /未开启/)
})

test('关闭开关：回到 false 并重新拦截', async () => {
  const off = await api('POST', '/api/soulmirror/auto', { action: 'off' })
  assert.equal(off.body.enabled, false)
  const s = await api('GET', '/api/soulmirror/status')
  assert.equal(s.body.enabled, false)

  const t = tools.find((x) => x.name === 'meeting_agent_start')
  const r = await t.execute({}, {})
  assert.equal(r.ok, false)
})

// Environment, effects and temporary files are cleaned by isolatePlugin().
