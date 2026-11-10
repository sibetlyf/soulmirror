import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, appendFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MeetingSession } from '../lib/session.js'

function fixture(t, deps = {}) {
  const root = mkdtempSync(join(tmpdir(), 'soulmirror-durable-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const s = new MeetingSession({ dataDir: root, asr: { provider: 'none' }, devices: {} }, null, deps)
  s.dir = root
  // No process/network/device use in these tests.
  s._loopBody = async () => {}
  return { s, root }
}

test('append is persisted before memory and onLine publication', (t) => {
  let s, root, observed = 0
  ;({s, root} = fixture(t, { appendFileSync(file, text, enc) {
    assert.equal(s.transcript.length, 0)
    appendFileSync(file, text, enc)
  } }))
  s.onLine = () => { assert.equal(JSON.parse(readFileSync(join(root, 'transcript.jsonl'), 'utf8')).text, 'hello'); observed++ }
  assert.equal(s._pushLine({ t: new Date().toISOString(), text: 'hello' }), 'added')
  assert.equal(s.transcript.length, 1)
  assert.equal(observed, 1)
})

test('append failure exposes error but publishes neither memory nor onLine', (t) => {
  const { s } = fixture(t, { appendFileSync() { throw new Error('ENOSPC') } })
  let called = false; s.onLine = () => { called = true }
  assert.equal(s._pushLine({ t: new Date().toISOString(), text: 'hello' }), 'persist-failed')
  assert.equal(s.transcript.length, 0)
  assert.equal(called, false)
  assert.match(s.lastError, /ENOSPC/)
})

test('merge failure does not mutate previous object or discard partial', (t) => {
  const { s } = fixture(t, { appendFileSync() { throw new Error('disk unavailable') } })
  const previous = { t: new Date().toISOString(), text: '请你' }
  s.transcript.push(previous)
  assert.equal(s._pushLine({ t: new Date().toISOString(), text: '回复一下。' }), 'persist-failed')
  assert.equal(s.transcript[0], previous)
  assert.equal(previous.text, '请你')
  s.partial = '这是一条需要保留的中间结果'; s.partialAt = 1
  assert.equal(s._commitPartial('test'), false)
  assert.ok(s.partial)
  assert.match(s.lastError, /disk unavailable/)
})

test('upgrade failure leaves previous object intact', (t) => {
  const { s } = fixture(t, { appendFileSync() { throw new Error('upgrade full') } })
  const previous = { t: new Date(Date.now() - 5000).toISOString(), text: '这是一条已经结束的完整句子。' }
  s.transcript.push(previous)
  assert.equal(s._pushLine({ t: new Date().toISOString(), text: '这是一条已经结束的完整句子。再补一句' }), 'persist-failed')
  assert.equal(s.transcript[0], previous)
  assert.equal(previous.text, '这是一条已经结束的完整句子。')
})

test('audio stream close clears timeout and detaches its temporary listener', async (t) => {
  const { s, root } = fixture(t)
  s.audioFile = join(root, 'audio.pcm')
  s._writeAudio(Buffer.alloc(6400))
  const stream = s._audioStream
  await s._closeAudioStream()
  assert.equal(s._audioStream, null)
  assert.equal(stream.listenerCount('error'), 1) // permanent error reporting only
  await s._closeAudioStream() // idempotent
})

test('gap writes before display and failed gap remains unpublished', (t) => {
  let fail = true
  const { s } = fixture(t, { appendFileSync(file, text, enc) {
    if (fail) throw new Error('gap disk full')
    appendFileSync(file, text, enc)
  } })
  assert.equal(s._recordGap({ text: 'missing audio', droppedMs: 2000 }), false)
  assert.equal(s.transcript.length, 0)
  assert.match(s.lastError, /gap disk full/)
  fail = false
  assert.equal(s._recordGap({ text: 'missing audio', droppedMs: 2000 }), true)
  assert.equal(s.transcript[0].gap, true)
})

test('start closes old stream, resets session metrics and emits before flags', async (t) => {
  const events = []
  let s
  ;({ s } = fixture(t, { onEvent(type, data) {
    if (type === 'capture.start') { assert.equal(s.capturing, false); assert.ok(existsSync(join(data.run, 'audio.pcm'))) }
    events.push(type)
  } }))
  let closed = false
  s._closeAudioStream = async () => { closed = true }
  s.bytes = 9000; s.transcript.push({text:'old'}); s.silentSec = 99
  const r = await s.startCapture('isolated-test')
  assert.equal(r.ok, true); assert.equal(closed, true)
  assert.equal(s.bytes, 0); assert.equal(s.transcript.length, 0); assert.equal(s.silentSec, 0)
  assert.deepEqual(events, ['capture.start'])
  await s.stopCapture()
})

test('failed journal hook blocks start publication', async (t) => {
  const { s } = fixture(t, { onEvent() { throw new Error('journal full') } })
  const r = await s.startCapture('isolated-test')
  assert.equal(r.ok, false); assert.equal(s.capturing, false)
  assert.match(r.error, /journal full/)
})

test('PCM initialization failure returns start failure, not a successful recording', async (t) => {
  const { s, root } = fixture(t)
  const file = join(root, 'not-a-directory'); writeFileSync(file, 'x')
  s.cfg.dataDir = file
  const r = await s.startCapture('isolated-test')
  assert.equal(r.ok, false); assert.equal(s.capturing, false)
  assert.match(s.lastError, /录音启动失败/)
})

test('stop reports finalization failure and clears recovery timer', async (t) => {
  const { s } = fixture(t)
  s.running = s.capturing = true
  s._recoverTimer = setTimeout(() => {}, 60000)
  s.finalizeRecording = async () => { throw new Error('WAV write failed') }
  const r = await s.stopCapture()
  assert.equal(r.ok, false); assert.match(r.error, /WAV write failed/)
  assert.equal(s._recoverTimer, null); assert.equal(s.capturing, false)
})

test('stop hook precedes status publication and preserves WAV evidence', async (t) => {
  let s
  ;({s} = fixture(t, { onEvent(type, data) {
    if (type === 'capture.stop') { assert.equal(s.capturing, true); assert.ok(existsSync(data.audio)) }
  } }))
  s.capturing = true; s.audioFile = join(s.dir, 'audio.pcm'); s.bytes = 6400
  writeFileSync(s.audioFile, Buffer.alloc(6400, 1))
  const r = await s.stopCapture()
  assert.equal(r.ok, true); assert.ok(existsSync(r.audio)); assert.equal(s.capturing, false)
})

test('concurrent stop callers share one finalization and stop event', async (t) => {
  let stopEvents = 0
  const { s } = fixture(t, { onEvent(type) { if (type === 'capture.stop') stopEvents++ } })
  let release
  const gate = new Promise((r) => { release = r })
  let finalized = 0
  s.finalizeRecording = async () => { finalized++; await gate; return 'fake.wav' }
  s.capturing = true
  const first = s.stopCapture()
  const second = s.stopCapture()
  assert.equal(first, second)
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(a.ok, true); assert.equal(b.ok, true)
  assert.equal(finalized, 1); assert.equal(stopEvents, 1)
  assert.equal(s._stopPromise, null)
})

test('finalize failure is visible and throws without destroying PCM', async (t) => {
  const { s, root } = fixture(t)
  await assert.rejects(s.finalizeRecording(root), /ENOENT/)
  assert.match(s.lastError, /录音封装失败/)
})
