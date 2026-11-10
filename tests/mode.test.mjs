import { isolatePlugin, applyIsolated } from './helpers/isolated-plugin.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-mode-'))
isolatePlugin(fakeHome)

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
applyIsolated(plugin, {
  tools: { register() {} },
  logger: { info() {}, warn() {} },
  get: (k) => (k === 'webServer' ? { port: 3082 } : undefined),
  webServer: { port: 3082, register(r) { routes.push(r) } },
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

test('默认是只转录模式', async () => {
  const s = await api('GET', '/api/soulmirror/status')
  assert.equal(s.body.mode, 'transcribe')
})

test('可以切到 Agent 模式', async () => {
  const r = await api('POST', '/api/soulmirror/mode', { mode: 'agent' })
  assert.equal(r.body.ok, true)
  assert.equal(r.body.mode, 'agent')
  const s = await api('GET', '/api/soulmirror/status')
  assert.equal(s.body.mode, 'agent')
})

test('切回只转录', async () => {
  const r = await api('POST', '/api/soulmirror/mode', { mode: 'transcribe' })
  assert.equal(r.body.mode, 'transcribe')
})

test('非法值一律当只转录（不会误开自动回复）', async () => {
  const r = await api('POST', '/api/soulmirror/mode', { mode: 'whatever' })
  assert.equal(r.body.mode, 'transcribe')
})

// Environment, effects and temporary files are cleaned by isolatePlugin().
