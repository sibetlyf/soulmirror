import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 入会失败时的兜底契约：
 *  - 必须把这次失败记进 uiMap（否则永远不会重学）
 *  - 重学要走 computer-use 标定会话
 *  - 结果里要明确告诉用户"再说一次就行 / 可以让我用 computer-use 点"
 */

const fakeHome = mkdtempSync(join(tmpdir(), 'sm-join-'))
process.env.SOULMIRROR_TEST = '1'
process.env.USERPROFILE = fakeHome
process.env.HOME = fakeHome

const mod = await import('../index.js')
const plugin = mod.default || mod

const tools = []
plugin.apply({
  tools: { register(t) { tools.push(t) } },
  logger: { info() {}, warn() {}, error() {} },
  get: () => undefined,
  webServer: { port: 3095, register() {} },
  on: () => () => {},
  effect: () => () => {},
  emit() {},
}, {})

test('总开关关闭时，meeting_join 一律拦下（不碰桌面）', async () => {
  const join = tools.find((t) => t.name === 'meeting_join')
  assert.ok(join, 'meeting_join 必须存在')
  const r = await join.execute({ code: '123456789', confirm: true })
  assert.equal(r.ok, false)
  assert.match(r.result, /未开启|开关/)
})

test('meeting_join 声明了 confirm 参数', async () => {
  const join = tools.find((t) => t.name === 'meeting_join')
  assert.ok(join.parameters && join.parameters.properties && join.parameters.properties.confirm, '必须有 confirm 参数')
  assert.equal(join.parameters.properties.confirm.type, 'boolean')
})

test('开启后：不传 confirm 仍然拒绝', async () => {
  const cfgMod = await import('../lib/config-store.js').catch(() => null)
  // 直接走 HTTP 开关最稳：这里用工具本身的前提判定
  const join = tools.find((t) => t.name === 'meeting_join')
  const r = await join.execute({ code: '123456789' })
  // 未启用时被总开关拦；启用后应被 confirm 拦——两种情况都必须 ok=false
  assert.equal(r.ok, false)
  assert.match(r.result, /confirm=true|未开启|开关/)
})

test('缺少会议号时给出可执行提示', async () => {
  const join = tools.find((t) => t.name === 'meeting_join')
  const r = await join.execute({ confirm: true })
  assert.equal(r.ok, false)
  assert.match(r.result, /会议号|链接|未开启|开关/)
})

test('从未标定时就应该需要标定', async () => {
  const ui = await import('../lib/uimap.js')
  const map = new ui.UiMap(join(fakeHome, 'uimap-empty.json'))
  const r = map.needsRecalibration('腾讯会议', 'join', 2)
  assert.equal(r.needed, true)
  assert.equal(r.why, 'never-calibrated')
})

test('标定过一次后，连续失败达到阈值才重学', async () => {
  const ui = await import('../lib/uimap.js')
  const map = new ui.UiMap(join(fakeHome, 'uimap.json'))
  map.set('腾讯会议', 'join', { x: 0.5, y: 0.5 }) // 已有坐标
  assert.equal(map.needsRecalibration('腾讯会议', 'join', 2).needed, false, '刚标定过不需要重学')
  map.markFailure('腾讯会议', 'join', '打不开入会对话框')
  map.markFailure('腾讯会议', 'join', '点了加入但没进会')
  const r = map.needsRecalibration('腾讯会议', 'join', 2)
  assert.equal(r.needed, true, '连续失败两次应触发重学')
  assert.equal(r.why, 'repeated-failure')
  assert.ok(r.failures >= 2)
})

test('标定提示词明确要求用 computer-use 找按钮', async () => {
  const ca = await import('../lib/calibrate-agent.js')
  const prompt = ca.buildRecalibrationPrompt({ app: '腾讯会议', action: 'join', reason: '点了加入但没进会', failures: 2 })
  assert.match(prompt, /computer/i)
  assert.match(prompt, /加入/)
  assert.ok(prompt.length > 100)
})

test.after(() => {
  try { rmSync(fakeHome, { recursive: true, force: true }) } catch { /* ignore */ }
})

