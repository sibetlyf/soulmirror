import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-sched-'))
process.env.SOULMIRROR_TEST = '1'
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const calls = { created: [], deleted: [] }
const scheduleStub = {
  async create(sessionId, req) {
    calls.created.push({ sessionId, ...req })
    return { id: 'schedule-test-1' }
  },
  async list() { return [] },
  async delete(req) { calls.deleted.push(req); return true },
}

const mod = await import('../index.js')
const plugin = mod.default || mod

const tools = []
const routes = []
plugin.apply({
  tools: { register(t) { tools.push(t) } },
  logger: { info() {}, warn() {} },
  get: (k) => {
    if (k === 'webServer') return { port: 3083 }
    if (k === 'schedule') return scheduleStub
    return undefined
  },
  webServer: { port: 3083, register(r) { routes.push(r) } },
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

const on = () => api('POST', '/api/soulmirror/auto', { action: 'start' })
const off = () => api('POST', '/api/soulmirror/auto', { action: 'stop' })

test('meeting_auto_attend 走 DSH 自动化任务（不是自建定时器）', async () => {
  await on()
  const t = tools.find((x) => x.name === 'meeting_auto_attend')
  const r = await t.execute({ at: '15:00', url: 'https://meeting.tencent.com/dm/AbC', title: '周会', sessionId: 'session-x' }, {})
  assert.equal(r.ok, true, r.result)
  assert.match(r.result, /自动化任务/)
  assert.equal(calls.created.length, 1)
  const req = calls.created[0]
  assert.equal(req.sessionId, 'session-x')
  assert.match(req.title, /替你去开会/)
  assert.match(req.prompt, /meeting_join/)
  assert.match(req.prompt, /meeting_agent_start/)
  assert.ok(req.at)
})

test('缺会议号/链接时拒绝', async () => {
  const t = tools.find((x) => x.name === 'meeting_auto_attend')
  const r = await t.execute({ at: '15:00', sessionId: 'session-x' }, {})
  assert.equal(r.ok, false)
  assert.match(String(r.result), /会议号|链接/)
})

test('时间解析：15:00 落到未来某个 15 点', async () => {
  const t = tools.find((x) => x.name === 'meeting_auto_attend')
  const before = calls.created.length
  const r = await t.execute({ at: '15:00', code: '206275219', sessionId: 'session-x' }, {})
  assert.equal(r.ok, true, r.result)
  const at = new Date(calls.created[before].at)
  assert.ok(at.getTime() > Date.now() - 60_000, '应该是未来时间')
  assert.equal(at.getHours(), 15)
  assert.equal(at.getMinutes(), 0)
})

test('取消任务会调用 delete', async () => {
  const t = tools.find((x) => x.name === 'meeting_schedule_cancel')
  const r = await t.execute({ id: 'schedule-test-1' }, {})
  assert.equal(r.ok, true)
  assert.equal(calls.deleted.length, 1)
  assert.equal(calls.deleted[0].id, 'schedule-test-1')
})

test('未开启时不允许安排', async () => {
  await off()
  const t = tools.find((x) => x.name === 'meeting_auto_attend')
  const r = await t.execute({ at: '15:00', code: '123456789', sessionId: 'session-x' }, {})
  assert.equal(r.ok, false)
  assert.match(String(r.result), /未开启/)
})

test.after(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ }
})
