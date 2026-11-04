import { test } from 'node:test'
import assert from 'node:assert/strict'
import { petStateFromStatus, petMenuFromStatus, PET_FACES } from '../lib/pet-state.js'

const now = Date.parse('2026-11-04T12:00:00.000Z')

test('空闲时显示待命', () => {
  const r = petStateFromStatus({}, { now })
  assert.equal(r.key, 'idle')
  assert.equal(r.color, PET_FACES.idle.color)
})

test('采集中显示在听，并带上句数', () => {
  const r = petStateFromStatus({ session: { capturing: true, lines: 12 }, meeting: { title: '周会' } }, { now })
  assert.equal(r.key, 'listening')
  assert.match(r.text, /12 句/)
  assert.equal(r.hint, '周会')
})

test('刚说过话显示说话中', () => {
  const r = petStateFromStatus({
    session: { capturing: true, lines: 3 },
    replyState: { spoken: '我在，你说。', at: now - 3000 },
  }, { now })
  assert.equal(r.key, 'speaking')
  assert.match(r.text, /我在/)
})

test('说话过去很久就回到在听', () => {
  const r = petStateFromStatus({
    session: { capturing: true, lines: 3 },
    replyState: { spoken: '我在，你说。', at: now - 60000 },
  }, { now })
  assert.equal(r.key, 'listening')
})

test('会后整理优先于一切，并区分阶段', () => {
  const off = petStateFromStatus({ session: { capturing: true, lines: 9 }, postMeeting: { phase: 'offline' } }, { now })
  assert.equal(off.key, 'sweeping')
  assert.equal(off.text, '重转写中')

  const done = petStateFromStatus({ postMeeting: { phase: 'done', sentences: 42, speakers: 3 } }, { now })
  assert.equal(done.key, 'idle')
  assert.match(done.text, /42 句/)
  assert.match(done.text, /3 位说话人/)

  const err = petStateFromStatus({ postMeeting: { phase: 'error', error: '识别失败' } }, { now })
  assert.equal(err.key, 'error')
  assert.match(err.text, /识别失败/)
})

test('发言失败会显示错误形态', () => {
  const r = petStateFromStatus({ lastSpeakError: { message: '未配置语音合成 Key' } }, { now })
  assert.equal(r.key, 'error')
  assert.match(r.text, /语音合成/)
})

test('菜单状态反映两个开关与采集状态', () => {
  const m = petMenuFromStatus({
    session: { capturing: true },
    reply: { enabled: true, autoSpeak: false },
    advice: { enabled: true },
  })
  assert.deepEqual(m, { capturing: true, replyEnabled: true, adviceEnabled: true, autoSpeak: false })
})

test('没有 advice 字段时建议默认开启（与后端默认一致）', () => {
  assert.equal(petMenuFromStatus({}).adviceEnabled, true)
})
