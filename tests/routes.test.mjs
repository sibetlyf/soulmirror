import { isolatePlugin, applyIsolated } from './helpers/isolated-plugin.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 真跑一遍路由处理函数（不启动服务器、不重启 DSH）。
 * 覆盖：/health、/demo、/status 里的 demo 字段、mode 切换。
 */

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-routes-'))
isolatePlugin(fakeHome)

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
const tools = []

applyIsolated(plugin, {
  tools: { register(t) { tools.push(t) } },
  logger: { info() {}, warn() {}, error() {} },
  get: (k) => (k === 'webServer' ? { port: 3097 } : undefined),
  webServer: { port: 3097, register(r) { routes.push(r) } },
  on: () => () => {},
  effect: () => () => {},
  emit() {},
}, {})

const route = routes[0]

async function call(method, url, body) {
  let out = ''
  let status = 0
  const res = {
    writeHead(code) { status = code },
    end(s) { out = s },
    setHeader() {},
  }
  const req = { method, url }
  if (body !== undefined) {
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  }
  await route.handler(req, res)
  let parsed = null
  try { parsed = JSON.parse(out) } catch { parsed = out }
  return { status, body: parsed }
}

test('/health 返回结构完整且可判定', async () => {
  const r = await call('GET', '/api/soulmirror/health')
  assert.equal(r.status, 200)
  const b = r.body
  assert.equal(typeof b.ok, 'boolean')
  assert.ok(Array.isArray(b.problems), 'problems 必须是数组')
  assert.ok(b.capture && typeof b.capture.capturing === 'boolean')
  assert.ok(b.capture.device !== undefined, '要带采集设备（哪怕空串）')
  assert.ok(b.asr && typeof b.asr.phase === 'string')
  assert.ok(typeof b.asr.reconnects === 'number')
  assert.ok(b.transcript && typeof b.transcript.lines === 'number')
  assert.ok(b.budget && typeof b.budget.usedMinutes === 'number')
})

test('/health 关闭状态不误报（本来就不该连接）', async () => {
  const r = await call('GET', '/api/soulmirror/health')
  assert.equal(r.body.enabled, false)
  assert.ok(Array.isArray(r.body.problems))
  assert.doesNotMatch(r.body.problems.join('\n'), /断连|连接中断|连接失败/, '关闭时允许展示缺配置，但不应误报运行中断连')
})

test('演练 start → status 可见 → stop', async () => {
  const start = await call('POST', '/api/soulmirror/demo', { action: 'start', speed: 4 })
  assert.equal(start.status, 200)
  assert.equal(start.body.ok, true)
  assert.equal(start.body.demo.real, false, '默认必须离线，不能偷偷联网')
  assert.match(start.body.demo.banner, /演练中/)
  assert.ok(start.body.demo.running || start.body.demo.lines > 0, '演练应处于运行中')

  const st = await call('POST', '/api/soulmirror/demo', { action: 'status' })
  assert.ok(st.body.demo.running || st.body.demo.lines > 0)

  // /status 里也要能看到 demo，面板才能显示「演练中」
  const s = await call('GET', '/api/soulmirror/status')
  assert.ok(s.body.demo.running || s.body.demo.lines > 0)

  const stop = await call('POST', '/api/soulmirror/demo', { action: 'stop' })
  assert.equal(stop.body.demo.running, false)
})

test('演练跑完后有转写内容（离线模拟，不需要网络）', async () => {
  await call('POST', '/api/soulmirror/demo', { action: 'start', speed: 60 })
  for (let i = 0; i < 80; i++) {
    const st = await call('POST', '/api/soulmirror/demo', { action: 'status' })
    if (!st.body.demo.running) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const st = await call('POST', '/api/soulmirror/demo', { action: 'status' })
  assert.ok(st.body.demo.lines >= 2, '演练应产出至少两句，实际 ' + st.body.demo.lines)
  const text = st.body.demo.transcript.map((x) => x.text).join('')
  assert.match(text, /周会|字幕|评审/, '内容应是内置样例语料')
  await call('POST', '/api/soulmirror/demo', { action: 'stop' })
})

test('演练的句子要能到面板（/status.transcript 不能只读 session）', async () => {
  await call('POST', '/api/soulmirror/demo', { action: 'start', speed: 30 })
  for (let i = 0; i < 60; i++) {
    const st = await call('POST', '/api/soulmirror/demo', { action: 'status' })
    if (st.body.demo.lines >= 1) break
    await new Promise((r) => setTimeout(r, 100))
  }
  const s = await call('GET', '/api/soulmirror/status')
  assert.ok(Array.isArray(s.body.transcript))
  assert.ok(s.body.transcript.length >= 1, '演练期间 /status.transcript 应有内容，实际 ' + s.body.transcript.length)
  assert.match(s.body.transcript.map((x) => x.text).join(''), /周会|字幕|评审/)
  await call('POST', '/api/soulmirror/demo', { action: 'stop' })
})

test('模式切换在 /status 里可见', async () => {
  await call('POST', '/api/soulmirror/mode', { mode: 'agent' })
  let s = await call('GET', '/api/soulmirror/status')
  assert.equal(s.body.mode, 'agent')
  await call('POST', '/api/soulmirror/mode', { mode: 'transcribe' })
  s = await call('GET', '/api/soulmirror/status')
  assert.equal(s.body.mode, 'transcribe')
})

test('meeting_demo 工具已注册且参数可解析', () => {
  const t = tools.find((x) => x.name === 'meeting_demo')
  assert.ok(t, '缺少 meeting_demo 工具；已注册：' + tools.map((x) => x.name).join(','))
  assert.ok(t.parameters, '要有参数 schema')
  assert.equal(t.parameters.type, 'object')
  assert.ok(t.parameters.properties && t.parameters.properties.action, '要有 action 参数')
  assert.ok(t.parameters.properties.speed, '要有 speed 参数')
  assert.ok(t.parameters.properties.real, '要有 real 参数')
})

// Environment, effects and temporary files are cleaned by isolatePlugin().
