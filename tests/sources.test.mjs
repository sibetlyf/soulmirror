import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  parseWav, silentPcm, wrapWav, rms,
  ScriptedSignalSource, PcmReplayAudioSource, ScriptedTranscriber,
} from '../lib/sources.js'
import { DemoController, DEMO_ASSET } from '../lib/demo.js'

/**
 * 这一组测试证明：不需要任何会议软件、不需要网络、不需要麦克风，
 * 也能把「检测 → 采集 → 转写 → 落库」整条链路跑完。
 */

test('WAV 往返：wrapWav → parseWav 一致', () => {
  const pcm = Buffer.alloc(3200)
  pcm.writeInt16LE(1234, 0)
  const wav = wrapWav(pcm, 16000)
  const back = parseWav(wav)
  assert.equal(back.rate, 16000)
  assert.equal(back.pcm.length, pcm.length)
  assert.equal(back.pcm.readInt16LE(0), 1234)
})

test('多声道会被混成单声道', () => {
  const frames = 100
  const stereo = Buffer.alloc(frames * 2 * 2)
  for (let i = 0; i < frames; i++) {
    stereo.writeInt16LE(1000, i * 4)
    stereo.writeInt16LE(3000, i * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + stereo.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22); h.writeUInt32LE(16000, 24); h.writeUInt32LE(16000 * 4, 28)
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(stereo.length, 40)
  const back = parseWav(Buffer.concat([h, stereo]))
  assert.equal(back.pcm.length, frames * 2)
  assert.equal(back.pcm.readInt16LE(0), 2000)  // (1000+3000)/2
})

test('rms：静音为 0，满幅接近 1', () => {
  assert.equal(rms(silentPcm(100)), 0)
  const loud = Buffer.alloc(200)
  for (let i = 0; i < 100; i++) loud.writeInt16LE(32767, i * 2)
  assert.ok(rms(loud) > 0.9)
})

test('假信号源：按脚本切换"是否在会中"', async () => {
  let now = 0
  const src = new ScriptedSignalSource([
    { ms: 1000, signal: { app: 'A', inMeeting: false } },
    { ms: 5000, signal: { app: 'A', code: '123456789', inMeeting: true } },
  ], { clock: () => now })

  assert.equal((await src.poll()).inMeeting, false)
  now = 1500
  const s = await src.poll()
  assert.equal(s.inMeeting, true)
  assert.equal(s.code, '123456789')
})

test('假信号源：脚本走完停在最后一项（不 loop）', async () => {
  let now = 0
  const src = new ScriptedSignalSource([
    { ms: 500, signal: { app: 'A', inMeeting: false } },
    { ms: 500, signal: { app: 'A', inMeeting: true } },
  ], { clock: () => now })
  now = 999999
  assert.equal((await src.poll()).inMeeting, true)
})

test('假音频源：吐出全部 PCM，且可以加速', async () => {
  const pcm = Buffer.alloc(32000) // 1 秒
  const src = new PcmReplayAudioSource(pcm, { chunkMs: 100, speed: 50 })
  await src.start()
  let got = 0
  for await (const c of src.chunks()) got += c.length
  assert.equal(got, pcm.length)
  assert.equal(src.health().bytes, pcm.length)
})

test('假转写器：按音频进度吐整句', async () => {
  const events = []
  const tr = new ScriptedTranscriber(['甲。', '乙。'], {
    msPerSentence: 200,
    partialPerSentence: 1,
    onEvent: (e) => events.push(e),
  })
  await tr.start()
  tr.feed(Buffer.alloc(32000)) // 1 秒音频 → 应产出约 2–5 句
  await new Promise((r) => setTimeout(r, 350))
  await tr.stop()
  const finals = events.filter((e) => e.sentenceEnd)
  assert.ok(finals.length >= 2, '至少两句，实际 ' + finals.length)
  assert.ok(events.some((e) => !e.sentenceEnd), '应该有中间结果')
})

test('演练：内置样例音频存在且是 16k 单声道', () => {
  assert.ok(existsSync(DEMO_ASSET), '缺少 assets/demo_meeting.wav')
  const { pcm, rate, channels } = parseWav(readFileSync(DEMO_ASSET))
  assert.equal(rate, 16000)
  assert.equal(channels, 1)
  assert.ok(pcm.length / 32000 > 10, '样例音频应长于 10 秒')
})

test('演练：不联网跑完全流程并落盘', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-demo-'))
  const lines = []
  const demo = new DemoController({ root, onLine: (it) => lines.push(it) })

  const s0 = await demo.start({ speed: 40 })   // 加速跑
  assert.equal(s0.running, true)
  assert.match(s0.banner, /演练中/)
  assert.equal(s0.real, false, '默认应是离线模拟，不该联网')

  // 1.5 秒后应进入"会议中"
  await new Promise((r) => setTimeout(r, 1700))
  const sig = await demo.poll()
  assert.equal(sig.inMeeting, true)
  assert.equal(sig.code, '983593253')

  // 等音频放完（26 秒 / 40 ≈ 0.65 秒）+ 收尾
  for (let i = 0; i < 60 && demo.snapshot().running; i++) {
    await new Promise((r) => setTimeout(r, 100))
  }
  const s1 = demo.snapshot()
  assert.ok(s1.lines >= 2, '至少两句转写，实际 ' + s1.lines)
  assert.ok(lines.length >= 2, 'onLine 回调应被触发')

  // 落盘检查
  assert.ok(existsSync(join(s1.dir, 'transcript.jsonl')), '应写出 transcript.jsonl')
  const first = readFileSync(join(s1.dir, 'transcript.jsonl'), 'utf8').split('\n')[0]
  assert.match(first, /"text"/)

  await demo.stop()
  assert.equal(demo.snapshot().running, false)
  rmSync(root, { recursive: true, force: true })
})

test('演练：重复 start 不会起两份', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sm-demo2-'))
  const demo = new DemoController({ root })
  const a = await demo.start({ speed: 40 })
  const b = await demo.start({ speed: 40 })
  assert.equal(a.startedAt, b.startedAt, '第二次 start 应返回同一场演练')
  await demo.stop()
  rmSync(root, { recursive: true, force: true })
})
