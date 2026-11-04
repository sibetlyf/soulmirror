import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readWavPcm, buildOfflineMinutes, transcribeOffline } from '../lib/offline-asr.js'

const dir = mkdtempSync(join(tmpdir(), 'sm-offline-'))

function makeWav({ sampleRate = 16000, channels = 1, seconds = 1 } = {}) {
  const frames = Math.round(sampleRate * seconds)
  const dataLen = frames * channels * 2
  const b = Buffer.alloc(44 + dataLen)
  b.write('RIFF', 0, 'ascii')
  b.writeUInt32LE(36 + dataLen, 4)
  b.write('WAVE', 8, 'ascii')
  b.write('fmt ', 12, 'ascii')
  b.writeUInt32LE(16, 16)
  b.writeUInt16LE(1, 20)
  b.writeUInt16LE(channels, 22)
  b.writeUInt32LE(sampleRate, 24)
  b.writeUInt32LE(sampleRate * channels * 2, 28)
  b.writeUInt16LE(channels * 2, 32)
  b.writeUInt16LE(16, 34)
  b.write('data', 36, 'ascii')
  b.writeUInt32LE(dataLen, 40)
  return b
}

test('readWavPcm 能读出时长与采样率', () => {
  const f = join(dir, 'a.wav')
  writeFileSync(f, makeWav({ seconds: 2 }))
  const r = readWavPcm(f)
  assert.equal(r.sampleRate, 16000)
  assert.equal(r.channels, 1)
  assert.equal(Math.round(r.seconds), 2)
  assert.equal(r.pcm.length, 2 * 16000 * 2)
})

test('readWavPcm 对非 WAV 也不崩', () => {
  const f = join(dir, 'raw.pcm')
  writeFileSync(f, Buffer.alloc(32000))
  const r = readWavPcm(f)
  assert.equal(r.pcm.length, 32000)
  assert.ok(r.seconds > 0)
})

test('transcribeOffline 空音频直接返回空', async () => {
  const r = await transcribeOffline({ apiKey: 'x', pcm: Buffer.alloc(0) })
  assert.deepEqual(r.sentences, [])
  assert.equal(r.text, '')
})

test('buildOfflineMinutes 无模型时退化为抽取式', async () => {
  const md = await buildOfflineMinutes({
    sentences: [{ text: '决定下周上线' }, { text: '小李负责回归' }],
    completer: null,
  })
  assert.match(md, /会议要点/)
  assert.match(md, /决定下周上线/)
})

test('buildOfflineMinutes 有模型时用模型输出', async () => {
  const md = await buildOfflineMinutes({
    sentences: [{ text: '随便' }],
    completer: async () => '## 决议\n上线',
  })
  assert.match(md, /## 决议/)
})

test('buildOfflineMinutes 模型抛错时退化而不是崩', async () => {
  const md = await buildOfflineMinutes({
    sentences: [{ text: 'A' }],
    completer: async () => { throw new Error('boom') },
  })
  assert.match(md, /会议要点/)
})

test.after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ } })
