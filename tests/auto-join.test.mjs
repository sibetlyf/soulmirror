import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findMeeting, findMeetingInEvent, AutoJoinGate } from '../lib/auto-join.js'
import { buildCalibrationPrompt, buildRecalibrationPrompt, CalibrationRunner } from '../lib/calibrate-agent.js'

test('findMeeting：优先识别入会链接', () => {
  const r = findMeeting('点击链接入会：https://meeting.tencent.com/dm/AbC123 或输入会议号 206-275-219')
  assert.equal(r.kind, 'url')
  assert.equal(r.url, 'https://meeting.tencent.com/dm/AbC123')
})

test('findMeeting：识别带"会议号"字样的号码', () => {
  assert.equal(findMeeting('会议号 206 275 219').value, '206275219')
  assert.equal(findMeeting('会议 ID：206-275-219').value, '206275219')
  assert.equal(findMeeting('meeting code 123456789').value, '123456789')
})

test('findMeeting：分组裸号也能认', () => {
  assert.equal(findMeeting('今晚 206-275-219 见').value, '206275219')
})

test('findMeeting：不像会议号的不认', () => {
  assert.equal(findMeeting('我的手机 13800138000'), null)
  assert.equal(findMeeting('预算是 12345 元'), null)
  assert.equal(findMeeting('随便聊聊'), null)
  assert.equal(findMeeting(''), null)
})

test('findMeetingInEvent：从事件对象里挖出会议信息', () => {
  const event = {
    type: 'user/message',
    data: { message: { content: [{ type: 'text', text: '会议链接 https://meeting.tencent.com/dm/XyZ' }] } },
  }
  const hit = findMeetingInEvent(event)
  assert.equal(hit.kind, 'url')
  assert.equal(hit.url, 'https://meeting.tencent.com/dm/XyZ')
})

test('findMeetingInEvent：没有会议信息返回 null', () => {
  assert.equal(findMeetingInEvent({ type: 'turn/end', data: { turn: 1 } }), null)
  assert.equal(findMeetingInEvent({ type: 'tool/result', data: { message: 'ok' } }), null)
})

test('findMeetingInEvent：跳过 usage 之类的大字段', () => {
  const event = { type: 'x', data: { usage: { note: 'https://meeting.tencent.com/dm/BIG' } } }
  assert.equal(findMeetingInEvent(event), null)
})

test('AutoJoinGate：同一条会议在冷却期内只放一次', () => {
  const gate = new AutoJoinGate({ cooldownMs: 1000 })
  const hit = { kind: 'url', url: 'https://meeting.tencent.com/dm/A' }
  assert.equal(gate.allow(hit, 1000).ok, true)
  gate.mark(hit, 1000)
  assert.equal(gate.allow(hit, 1500).ok, false)
  assert.equal(gate.allow(hit, 2100).ok, true)
})

test('AutoJoinGate：不同会议互不影响', () => {
  const gate = new AutoJoinGate({ cooldownMs: 1000 })
  const a = { kind: 'code', value: '206275219' }
  const b = { kind: 'code', value: '111222333' }
  gate.mark(a, 1000)
  assert.equal(gate.allow(b, 1000).ok, true)
})

test('校准提示：包含按钮说明与保存指令', () => {
  const p = buildCalibrationPrompt({ app: '腾讯会议', action: 'join', winSize: { w: 1226, h: 786 } })
  assert.match(p, /加入会议/)
  assert.match(p, /meeting_set_ui_map/)
  assert.match(p, /1226×786/)
  assert.match(p, /只点这一个按钮/)
})

test('重学提示：带上失败次数与原因', () => {
  const p = buildRecalibrationPrompt({ app: '腾讯会议', action: 'join', reason: '打不开对话框', failures: 3 })
  assert.match(p, /重新标定/)
  assert.match(p, /3 次/)
  assert.match(p, /打不开对话框/)
})

test('CalibrationRunner：单飞 + 冷却', async () => {
  let calls = 0
  const runner = new CalibrationRunner({
    run: async () => { calls += 1; return { ok: true, text: 'done' } },
    cooldownMs: 5000,
  })
  const first = await runner.trigger({ app: '腾讯会议', action: 'join' })
  assert.equal(first.started, true)
  await first.job
  assert.equal(calls, 1)
  const second = await runner.trigger({ app: '腾讯会议', action: 'join' })
  assert.equal(second.started, false)
  assert.equal(second.skipped, 'cooldown')
})

test('CalibrationRunner：没有 runner 时安全跳过', async () => {
  const runner = new CalibrationRunner({})
  const r = await runner.trigger({ app: 'x', action: 'join' })
  assert.equal(r.started, false)
  assert.equal(r.skipped, 'no-runner')
})

test('CalibrationRunner：失败不抛，记进 history', async () => {
  const runner = new CalibrationRunner({ run: async () => { throw new Error('boom') }, cooldownMs: 0 })
  const r = await runner.trigger({ app: '腾讯会议', action: 'join' })
  const entry = await r.job
  assert.equal(entry.ok, false)
  assert.match(entry.error, /boom/)
  assert.equal(runner.history.length, 1)
})
