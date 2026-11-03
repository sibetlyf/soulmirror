import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 采集监督：进程死了要自己起来，但**不能无限抖**。
 * 用注入的假 spawn 与假 ASR，全程不碰真实音频设备。
 */

process.env.SOULMIRROR_TEST = '1'
const { MeetingSession } = await import('../lib/session.js')

function fakeChild({ exitAfterMs = 5, emitData = false } = {}) {
  const child = new EventEmitter()
  child.stdout = new Readable({ read() {} })
  child.stderr = new EventEmitter()
  child.killed = false
  child.kill = () => { child.killed = true; child.emit('exit', 0, null) }
  setTimeout(() => {
    if (emitData) child.stdout.push(Buffer.alloc(3200))
    child.emit('exit', 1, null)
  }, exitAfterMs)
  return child
}

function makeSession({ spawns, backoffMs = [5, 5, 5], exitAfterMs = 5, emitData = false }) {
  const spawned = []
  const logs = []
  const session = new MeetingSession(
    {
      asr: { apiKey: 'test-key', apiKeyEnv: 'X', provider: 'dashscope' },
      devices: {},
      archive: {},
    },
    { info: (m) => logs.push(String(m)), warn: (m) => logs.push('W ' + m) },
    {
      backoffMs,
      spawnFn: () => {
        const c = fakeChild({ exitAfterMs, emitData })
        spawned.push(c)
        return c
      },
      createAsr: () => ({
        start: async () => {},
        feed: () => {},
        stop: async () => {},
        online: true,
        closed: false,
        snapshot: () => ({ phase: 'online' }),
      }),
    },
  )
  return { session, spawned, logs }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('采集进程退出 → 按退避重启，用尽后停止并给出可行动提示', async () => {
  const { session, spawned, logs } = makeSession({ backoffMs: [5, 5, 5] })
  session.deviceInUse = 'FakeDevice' // 跳过真实设备探测
  session.running = true
  session.capturing = true
  const loop = session._streamLoop()

  // 1 次正常 + 3 次重试 = 4 次 spawn，之后放弃
  for (let i = 0; i < 60 && session.running; i++) await wait(20)
  await Promise.race([loop, wait(500)])

  assert.equal(spawned.length, 4, '应为 1 次启动 + 3 次重试，实际 ' + spawned.length)
  assert.equal(session.running, false, '用尽后应停止，而不是无限重启')
  assert.match(session.lastError, /采集连续失败 3 次/)
  assert.ok(logs.some((l) => /第 3 次重启/.test(l)), '应记录重试次数')
  session.running = false
})

test('重启间隔递增（不是每 800ms 抖一次）', async () => {
  const { session, spawned } = makeSession({ backoffMs: [30, 120] })
  session.deviceInUse = 'FakeDevice'
  session.running = true
  session.capturing = true
  const loop = session._streamLoop()
  await wait(80)
  const mid = spawned.length
  await wait(200)
  await Promise.race([loop, wait(300)])
  assert.ok(spawned.length > mid, '退避后仍应继续重试')
  assert.ok(spawned.length <= 3)
  session.running = false
})

test('有音频流过就重置失败计数（长会里偶发中断不会累积到判死）', async () => {
  const { session, logs } = makeSession({ backoffMs: [5], emitData: true })
  session._captureAttempts = 2
  session.deviceInUse = 'FakeDevice'
  session.running = true
  session.capturing = true
  const loop = session._streamLoop()
  await wait(120)
  assert.equal(session._captureAttempts, 0, '收到音频后失败计数应清零')
  session.running = false // 主动停止：否则"恢复即重置"会让监督永远重试下去
  await Promise.race([loop, wait(500)])
  assert.ok(logs.some((l) => /采集已恢复/.test(l)), '应有恢复日志')
})
