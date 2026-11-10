import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.SOULMIRROR_TEST = '1'

const { MeetingSession } = await import('../lib/session.js')
const { createResilientAsr } = await import('../lib/asr-stream.js')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function fakeChild({ dataMs = 20 } = {}) {
  const child = new EventEmitter()
  child.stdout = new Readable({ read() {} })
  child.stderr = new EventEmitter()
  child.kill = () => { child.emit('exit', 0, null) }
  const iv = setInterval(() => child.stdout.push(Buffer.alloc(3200)), dataMs)
  child._stop = () => clearInterval(iv)
  return child
}

test('音频能通过弹性 ASR 的 feed 送到识别（接口错配回归）', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'soulmirror-asr-wiring-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const sent = []
  const children = []
  const spawnFn = () => { const c = fakeChild(); children.push(c); return c }
  const createAsr = () => createResilientAsr({
    apiKey: 'x',
    onSentence: () => {},
    makeAsr: () => ({
      open: async () => {},
      send: (b) => { sent.push(b.length) },
      finish: async () => {},
    }),
  })

  const session = new MeetingSession(
    { dataDir: root, asr: { apiKey: 'x', apiKeyEnv: 'X' }, devices: {}, archive: {} },
    { info() {}, warn() {} },
    {
      backoffMs: [5], spawnFn, createAsr,
      loudestRenderDevice: async () => null,
      listDevices: async () => [],
      defaultRenderDevice: async () => '',
      sessionDevice: async () => null,
      ensureBridge: () => ({ ok: true }),
    },
  )
  session.dir = root
  session.deviceInUse = 'FakeDevice'
  t.after(async () => {
    session.running = false
    for (const c of children) c._stop?.()
    await session._closeAudioStream()
  })
  session.running = true
  session.capturing = true
  const loop = session._streamLoop()

  await wait(200)
  assert.ok(sent.length > 0, '识别应收到音频字节，实际 0 —— 接口名不匹配会静默丢音频')

  session.running = false
  await Promise.race([loop, wait(500)])
  for (const c of children) c._stop?.()
})

test('弹性 ASR 暴露 session 期望的接口名（start/feed/stop/online/closed）', () => {
  const asr = createResilientAsr({
    apiKey: 'x',
    onSentence: () => {},
    makeAsr: () => ({ open: async () => {}, send() {}, finish: async () => {} }),
  })
  assert.equal(typeof asr.start, 'function', '要暴露 start')
  assert.equal(typeof asr.feed, 'function', '要暴露 feed')
  assert.equal(typeof asr.stop, 'function', '要暴露 stop')
  assert.equal(typeof asr.snapshot, 'function', '要暴露 snapshot')
  assert.equal('online' in asr, true, '要暴露 online')
  assert.equal('closed' in asr, true, '要暴露 closed')
  assert.equal(asr.open, undefined, '不应有 open')
  assert.equal(asr.send, undefined, '不应有 send')
  assert.equal(asr.finish, undefined, '不应有 finish')
})
