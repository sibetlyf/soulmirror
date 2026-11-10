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
  const timer = setTimeout(() => {
    if (emitData) child.stdout.push(Buffer.alloc(3200))
    child.emit('exit', 1, null)
  }, exitAfterMs)
  child.dispose = () => { clearTimeout(timer); child.stdout.destroy(); child.removeAllListeners(); child.stderr.removeAllListeners() }
  return child
}

const probes = {
  loudestRenderDevice: async () => null,
  defaultRenderDevice: async () => '',
  listDevices: async () => [],
  sessionDevice: async () => null,
  ensureBridge: () => ({ ok: true }),
}
function tempRoot(t) {
  const root = mkdtempSync(join(tmpdir(), 'soulmirror-supervision-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}

function makeSession(t, { backoffMs = [5, 5, 5], exitAfterMs = 5, emitData = false }) {
  const root = tempRoot(t)
  const spawned = []
  const logs = []
  const spawnTimes = []
  let signalFeed
  const fed = new Promise((r) => { signalFeed = r })
  const session = new MeetingSession(
    {
      dataDir: root,
      asr: { apiKey: 'test-key', apiKeyEnv: 'X', provider: 'dashscope' },
      devices: {},
      archive: {},
    },
    { info: (m) => logs.push(String(m)), warn: (m) => logs.push('W ' + m) },
    {
      ...probes,
      backoffMs,
      spawnFn: () => {
        const c = fakeChild({ exitAfterMs, emitData })
        spawned.push(c)
        spawnTimes.push(performance.now())
        return c
      },
      createAsr: () => ({
        start: async () => {},
        feed: () => { signalFeed() },
        stop: async () => {},
        online: true,
        closed: false,
        snapshot: () => ({ phase: 'online' }),
      }),
    },
  )
  session.dir = root
  t.after(async () => {
    session.running = session.wanted = false
    await session.stopCapture()
    for (const c of spawned) c.dispose()
  })
  return { session, spawned, logs, fed, spawnTimes }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('采集进程退出 → 按退避重启，用尽后停止并给出可行动提示', async (t) => {
  const { session, spawned, logs } = makeSession(t, { backoffMs: [5, 5, 5] })
  session.deviceInUse = 'FakeDevice' // 跳过真实设备探测
  session.running = true
  session.capturing = true
  const loop = session._streamLoop()

  // 1 次正常 + 3 次重试 = 4 次 spawn，之后放弃
  await loop

  assert.equal(spawned.length, 4, '应为 1 次启动 + 3 次重试，实际 ' + spawned.length)
  assert.equal(session.running, false, '用尽后应停止，而不是无限重启')
  assert.match(session.lastError, /采集连续失败 3 次/)
  assert.ok(logs.some((l) => /第 3 次重启/.test(l)), '应记录重试次数')
  session.running = false
})

test('重启间隔递增（不是每 800ms 抖一次）', async (t) => {
  const { session, spawned, spawnTimes } = makeSession(t, { backoffMs: [30, 120] })
  session.deviceInUse = 'FakeDevice'
  session.running = true
  session.capturing = true
  const loop = session._streamLoop()
  await loop
  assert.equal(spawned.length, 3, '应为初始启动加两次重试，不能无限抖')
  assert.ok(spawnTimes[1] - spawnTimes[0] >= 30, '第一次退避不能提前')
  assert.ok(spawnTimes[2] - spawnTimes[1] >= 120, '第二次退避必须采用递增配置')
  session.running = false
})

test('有音频流过就重置失败计数（长会里偶发中断不会累积到判死）', async (t) => {
  const { session, logs, fed } = makeSession(t, { backoffMs: [5], emitData: true })
  session._captureAttempts = 2
  session.deviceInUse = 'FakeDevice'
  session.running = true
  session.capturing = true
  const loop = session._streamLoop()
  await fed
  assert.equal(session._captureAttempts, 0, '收到音频后失败计数应清零')
  session.running = false // 主动停止：否则"恢复即重置"会让监督永远重试下去
  await loop
  assert.ok(logs.some((l) => /采集已恢复/.test(l)), '应有恢复日志')
})

// ── 真实事故：采集在会议中途死了，界面却仍显示"已连接"，用户以为在采 ──
test('采集连续失败后标记 captureFailed，并安排自动恢复（而不是永久躺平）', async (t) => {
  const root = tempRoot(t)
  const children = []
  const { MeetingSession } = await import('../lib/session.js')
  const { EventEmitter } = await import('node:events')

  let spawned = 0
  const spawnFn = () => {
    spawned++
    const c = new EventEmitter()
    c.stdout = new EventEmitter()
    c.stderr = new EventEmitter()
    c.kill = () => {}
    // 每次都立刻退出，模拟设备不可用
    const timer = setTimeout(() => c.emit('exit', 1), 5)
    c.dispose = () => { clearTimeout(timer); c.removeAllListeners(); c.stdout.removeAllListeners(); c.stderr.removeAllListeners() }
    children.push(c)
    return c
  }

  const cfg = {
    asr: { provider: 'dashscope', apiKey: 'x', model: 'paraformer-realtime-v2' },
    devices: { capture: '', captureMode: 'loopback', captureAuto: true },
    dataDir: root,
    meetingProcs: [],
    processName: 'x',
  }
  const s = new MeetingSession(cfg, { info() {}, warn() {} }, {
    ...probes,
    spawnFn,
    backoffMs: [5, 5],
    createAsr: () => ({
      start: async () => {},
      feed: () => {},
      stop: async () => {},
      snapshot: () => ({ phase: 'online', online: true }),
      get closed() { return false },
    }),
  })
  t.after(async () => { await s.stopCapture(); for (const c of children) c.dispose() })
  s.correctText = null
  // 让设备解析立刻返回，避免依赖真实设备
  s.deviceInUse = 'fake'

  await s.startCapture('t')
  // 等它把两次退避用完
  await s._loop

  assert.equal(s.captureFailed, true, '应当标记采集失败')
  assert.match(s.lastError, /自动重试|暂停/)
  assert.ok(s.recoveries === 0, '此时还没开始恢复')
  assert.ok(spawned >= 2, '应当尝试过重启')

  const snap = s.snapshot()
  assert.equal(snap.captureFailed, true, 'snapshot 要暴露 captureFailed 给界面')

  await s.stopCapture()
  assert.equal(s.wanted, false, '停止后不应再自动恢复')
})

test('停止采集会取消待执行的自动恢复', async (t) => {
  const root = tempRoot(t)
  const { MeetingSession } = await import('../lib/session.js')
  const cfg = {
    asr: { provider: 'dashscope', apiKey: 'x' },
    devices: { capture: '', captureMode: 'loopback', captureAuto: true },
    dataDir: root,
    meetingProcs: [], processName: 'x',
  }
  const s = new MeetingSession(cfg, { info() {}, warn() {} }, { ...probes, spawnFn: () => { throw new Error('nope') } })
  t.after(() => s.stopCapture())
  s.wanted = true
  s.captureFailed = true
  s._scheduleRecover()
  assert.ok(s._recoverTimer, '应当安排了恢复定时器')
  await s.stopCapture()
  assert.equal(s._recoverTimer, null, '停止后定时器要清掉')
})
