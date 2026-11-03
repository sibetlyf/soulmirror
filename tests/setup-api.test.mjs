import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 安装体检接口：GET 给清单，POST 点按钮执行。
 * 只跑路由处理函数，不启服务、不碰真实设备。
 */

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-setup-'))
process.env.SOULMIRROR_TEST = '1'
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const mod = await import('../index.js')
const plugin = mod.default || mod

const routes = []
plugin.apply({
  tools: { register() {} },
  logger: { info() {}, warn() {}, error() {} },
  get: (k) => (k === 'webServer' ? { port: 3096 } : undefined),
  webServer: { port: 3096, register(r) { routes.push(r) } },
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

test('GET /setup 返回 6 项体检与提示语', async () => {
  const r = await call('GET', '/api/soulmirror/setup')
  assert.equal(r.status, 200)
  assert.ok(Array.isArray(r.body.rows))
  assert.equal(r.body.rows.length, 6)
  assert.ok(typeof r.body.hint === 'string' && r.body.hint.length > 0)
  const ids = r.body.rows.map((x) => x.id)
  assert.deepEqual(ids, ['config', 'bridge', 'key', 'device', 'vm', 'calib'])
  for (const row of r.body.rows) {
    assert.ok('ok' in row && row.what && row.fix, '行结构不完整：' + JSON.stringify(row))
  }
})

test('POST /setup config 生成配置文件并回到最新清单', async () => {
  const r = await call('POST', '/api/soulmirror/setup', { action: 'config' })
  assert.equal(r.status, 200)
  assert.ok(r.body.rows, '应带回最新清单')
  assert.equal(r.body.action, 'config')
  assert.ok(existsSync(join(fakeHome, '.dsh', 'soulmirror', 'config.json')), '应真的生成配置')
})

test('POST /setup key 允许留空（清空），不当作错误', async () => {
  const r = await call('POST', '/api/soulmirror/setup', { action: 'key', value: '' })
  assert.equal(r.status, 200)
  assert.match(r.body.message, /清空|留空|不可用|已保存/)
  const key = r.body.rows.find((x) => x.id === 'key')
  // 配置里的 key 清空后：若环境变量仍提供 key，ok 仍为 true（这是正确行为）
  const src = r.body.state.keySource || ''
  assert.equal(key.ok, !!src && src !== 'missing' && src !== 'none',
    '密钥可用性应跟随实际来源，来源=' + src)
})

test('POST /setup 未知动作返回 400 而不是静默成功', async () => {
  const r = await call('POST', '/api/soulmirror/setup', { action: 'nonsense' })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /未知动作/)
})

test('POST /setup vb-cable 不尝试静默装驱动，只给指引', async () => {
  const r = await call('POST', '/api/soulmirror/setup', { action: 'vb-cable' })
  assert.equal(r.status, 200)
  assert.equal(r.body.manual, true)
  assert.match(r.body.message, /管理员|手动/)
})

test.after(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ }
})
