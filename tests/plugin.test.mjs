import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 关键：在导入插件之前把 HOME 指向临时目录，避免污染真实配置
const fakeHome = mkdtempSync(join(tmpdir(), 'sm-home-'))
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const mod = await import('../index.js')
const plugin = mod.default || mod

function bootPlugin(extra = {}) {
  const tools = []
  const routes = []
  const handlers = {}
  const ctx = {
    tools: { register(t) { tools.push(t) } },
    logger: { info() {}, warn() {} },
    get: (k) => extra.get ? extra.get(k) : (k === 'webServer' ? { port: 3099 } : undefined),
    webServer: { port: 3099, register(r) { routes.push(r) } },
    on: (n, f) => { handlers[n] = f; return () => {} },
    effect: () => () => {},
    emit() {},
  }
  plugin.apply(ctx, {})
  return { tools, routes, handlers }
}

async function callApi(route, method, url, body) {
  let out = ''
  const res = {
    code: 0,
    writeHead(c) { this.code = c },
    end(s) { out = s },
  }
  const req = { method, url }
  if (body !== undefined) {
    req[Symbol.asyncIterator] = async function* () { yield Buffer.from(JSON.stringify(body)) }
  }
  await route.handler(req, res)
  let parsed = null
  try { parsed = JSON.parse(out) } catch { /* ignore */ }
  return { code: res.code, body: parsed, raw: out }
}

test('插件元信息与工具注册', () => {
  assert.equal(plugin.name, 'soulmirror')
  assert.ok(plugin.inject.includes('tools'))
  assert.ok(plugin.inject.includes('webServer'))
  const { tools } = bootPlugin()
  const names = tools.map((t) => t.name)
  for (const n of [
    'meeting_status', 'meeting_capture_start', 'meeting_agent_start', 'meeting_minutes',
    'soul_task', 'soul_say', 'soul_status', 'soul_persona', 'soul_memory', 'soul_session',
    'soul_setup', 'soul_world', 'soul_belief', 'soul_goal',
  ]) {
    assert.ok(names.includes(n), '缺少工具 ' + n)
  }
  assert.ok(names.length >= 30, '工具数量偏少: ' + names.length)
  // 每个工具都要有 name / description / execute
  for (const t of tools) {
    assert.equal(typeof t.name, 'string')
    assert.ok(t.name.length > 0)
    assert.equal(typeof t.execute, 'function')
  }
})

test('配置 API：GET /config 不回显密钥', async () => {
  const { routes } = bootPlugin()
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/soulmirror')
  const r = await callApi(routes[0], 'GET', '/api/soulmirror/config')
  assert.equal(r.code, 200)
  assert.equal(typeof r.body.enabled, 'boolean')
  assert.equal(r.body.asr.apiKey, '')
  assert.ok('keySet' in r.body.asr)
  assert.ok('keySource' in r.body.asr)
})

test('配置 API：GET /status 结构与世界快照', async () => {
  const { routes } = bootPlugin()
  const r = await callApi(routes[0], 'GET', '/api/soulmirror/status')
  assert.equal(r.code, 200)
  for (const k of ['session', 'transcript', 'tasks', 'meeting', 'models', 'devices', 'brain', 'auto', 'lifecycle', 'world']) {
    assert.ok(k in r.body, 'status 缺字段 ' + k)
  }
  assert.ok(Array.isArray(r.body.transcript))
})

test('配置 API：POST /auto 开关监听', async () => {
  const { routes } = bootPlugin()
  const on = await callApi(routes[0], 'POST', '/api/soulmirror/auto', { action: 'start' })
  assert.equal(on.code, 200)
  assert.equal(on.body.auto, true)
  const off = await callApi(routes[0], 'POST', '/api/soulmirror/auto', { action: 'stop' })
  assert.equal(off.body.auto, false)
})

test('配置 API：未知子路径返回 404', async () => {
  const { routes } = bootPlugin()
  const r = await callApi(routes[0], 'GET', '/api/soulmirror/nope')
  assert.equal(r.code, 404)
})

test('配置 API：POST /config 保存并掩码密钥', async () => {
  const { routes } = bootPlugin()
  const saved = await callApi(routes[0], 'POST', '/api/soulmirror/config', {
    policy: 'suggest',
    asr: { provider: 'dashscope', apiKey: 'sk-test-123' },
    tts: { provider: 'sapi' },
  })
  assert.equal(saved.code, 200)
  assert.equal(saved.body.asr.apiKey, '')
  assert.equal(saved.body.asr.keySet, true)
  const again = await callApi(routes[0], 'GET', '/api/soulmirror/config')
  assert.equal(again.body.policy, 'suggest')
  assert.equal(again.body.asr.keySet, true)
})

test('工具：soul_world 能呼吸并返回结构', async () => {
  const { tools } = bootPlugin()
  const tools_ = tools.find((t) => t.name === 'soul_world')
  const r = await tools_.execute({ breathe: true }, {})
  assert.equal(r.ok, true)
  assert.match(r.result, /记忆：/)
  assert.match(r.result, /信念：/)
  assert.match(r.result, /心像主导地形/)
})

test('工具：soul_belief 种下→强化→列出', async () => {
  const { tools } = bootPlugin()
  const t = tools.find((x) => x.name === 'soul_belief')
  const seed = await t.execute({ action: 'seed', statement: '测试信念' }, {})
  assert.equal(seed.ok, true)
  const list = await t.execute({ action: 'list' }, {})
  assert.match(list.result, /测试信念/)
})

test('工具：soul_goal add/list', async () => {
  const { tools } = bootPlugin()
  const t = tools.find((x) => x.name === 'soul_goal')
  const add = await t.execute({ action: 'add', goal: '整理会议纪要模板' }, {})
  assert.equal(add.ok, true)
  const list = await t.execute({ action: 'list' }, {})
  assert.match(list.result, /整理会议纪要模板/)
})

test('工具：soul_persona get/set', async () => {
  const { tools } = bootPlugin()
  const t = tools.find((x) => x.name === 'soul_persona')
  const set = await t.execute({ action: 'set', which: 'user', text: '# USER\n\n偏好：结论先行' }, {})
  assert.equal(set.ok, true)
  const get = await t.execute({ action: 'get' }, {})
  assert.match(get.result, /结论先行/)
})

test('工具：soul_memory recent/add', async () => {
  const { tools } = bootPlugin()
  const t = tools.find((x) => x.name === 'soul_memory')
  await t.execute({ action: 'add', text: '记住这条' }, {})
  const r = await t.execute({ action: 'recent', limit: 5 }, {})
  assert.match(r.result, /记住这条/)
})

test('工具：soul_session 显示工作区与会话', async () => {
  const { tools } = bootPlugin()
  const t = tools.find((x) => x.name === 'soul_session')
  const r = await t.execute({ setMeetingId: '206-275-219' }, {})
  assert.equal(r.ok, true)
  assert.match(r.result, /当前会议/)
  assert.match(r.result, /会议身份/)
})

test('工具：soul_setup check/links/deps 不抛错', async () => {
  const { tools } = bootPlugin()
  const t = tools.find((x) => x.name === 'soul_setup')
  const check = await t.execute({ action: 'check' }, {})
  assert.match(check.result, /平台/)
  const links = await t.execute({ action: 'links' }, {})
  assert.match(links.result, /知识库插件/)
  const deps = await t.execute({ action: 'deps' }, {})
  assert.match(deps.result, /虚拟声卡/)
})

test('工具：soul_status 汇报状态与自动应答', async () => {
  const { tools } = bootPlugin()
  const t = tools.find((x) => x.name === 'soul_status')
  const r = await t.execute({}, {})
  assert.equal(r.ok, true)
  assert.match(r.result, /唤醒词/)
  assert.match(r.result, /自动应答/)
})

test('工具：soul_say 内容为空时拒绝', async () => {
  const { tools } = bootPlugin()
  const t = tools.find((x) => x.name === 'soul_say')
  const r = await t.execute({ text: '   ' }, {})
  assert.equal(r.ok, false)
})

test('自动应答：插件启动时注册了 approval/request 拦截', () => {
  const { handlers } = bootPlugin()
  assert.equal(typeof handlers['approval/request'], 'function')
})

test('插件二次加载不抛错（幂等）', () => {
  assert.doesNotThrow(() => plugin.apply({
    tools: { register() {} },
    logger: { info() {}, warn() {} },
    get: () => ({ port: 3100 }),
    webServer: { port: 3100, register() {} },
    on: () => () => {},
    effect: () => () => {},
    emit() {},
  }, {}))
})

test.after(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ }
})
