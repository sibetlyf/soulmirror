import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-armed-'))
const envKeys = ['SOULMIRROR_TEST', 'SOULMIRROR_HOME', 'USERPROFILE', 'HOME']
const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]))
process.env.SOULMIRROR_TEST = '1'
// USERPROFILE/HOME alone do not isolate resolveDshHome: host DSH_HOME takes priority.
process.env.SOULMIRROR_HOME = fakeHome
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const disposers = []
const listeners = new Map()
test.after(async () => {
  try {
    for (const dispose of disposers.reverse()) await dispose()
  } finally {
    for (const k of envKeys) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    rmSync(fakeHome, { recursive: true, force: true })
  }
})

const mod = await import('../index.js')
const plugin = mod.default || mod
const routes = []
const tools = []
const logs = []
let windowCalls = 0
plugin.apply({
  tools: { register(t) { tools.push(t) } },
  logger: { info: (m) => logs.push(String(m)), warn: (m) => logs.push('W ' + m) },
  get: (k) => (k === 'webServer' ? { port: 3086 } : undefined),
  webServer: { port: 3086, register(r) { routes.push(r) } },
  on(name, fn) {
    const list = listeners.get(name) || []
    list.push(fn)
    listeners.set(name, list)
    return () => { const i = list.indexOf(fn); if (i >= 0) list.splice(i, 1) }
  },
  effect(register) {
    const dispose = register()
    if (typeof dispose === 'function') disposers.push(dispose)
    return dispose
  },
  emit() {},
}, { enabled: false, dataDir: join(fakeHome, 'meetings'), pet: { enabled: false } }, {
  listWindows: async () => { windowCalls += 1; return [] },
})

async function api(method, url, body) {
  let out = ''
  const res = { code: 0, writeHead(c) { this.code = c }, end(s) { out = s } }
  const req = { method, url }
  if (body !== undefined) req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  await routes[0].handler(req, res)
  return { code: res.code, body: JSON.parse(out || '{}') }
}

test('显式未开启配置：armed=false，且没有开始录音', async () => {
  const r = await api('GET', '/api/soulmirror/status')
  assert.equal(r.body.armed, false)
  assert.equal(r.body.session.capturing, false)
})

test('未开启时状态探测只使用注入的空窗口列表，不触发入会或录音', async () => {
  const before = windowCalls
  const r = await api('GET', '/api/soulmirror/status')
  assert.equal(r.body.armed, false)
  assert.equal(r.body.session.capturing, false)
  assert.ok(windowCalls >= before)
})

test('start 开启监听；off 真正关闭，stop 不再被误当关闭总开关', async () => {
  const on = await api('POST', '/api/soulmirror/auto', { action: 'start' })
  assert.equal(on.body.armed, true)
  assert.equal((await api('GET', '/api/soulmirror/status')).body.armed, true)
  await api('POST', '/api/soulmirror/auto', { action: 'stop' })
  assert.equal((await api('GET', '/api/soulmirror/status')).body.armed, true, 'stop 仅停本场录音，不能关闭总开关')

  const off = await api('POST', '/api/soulmirror/auto', { action: 'off' })
  assert.equal(off.body.armed, false)
  assert.equal((await api('GET', '/api/soulmirror/status')).body.armed, false)
})

test('未开启时 meeting_recalibrate 拒绝执行', async () => {
  const tool = tools.find((x) => x.name === 'meeting_recalibrate')
  const r = await tool.execute({ action: 'join' }, {})
  assert.equal(r.ok, false)
  assert.match(String(r.result), /未开启|没检测到|关闭/)
})
